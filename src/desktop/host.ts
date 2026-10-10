import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { BrowserFileAccess } from '../music/file-access';
import { thumbnail } from '../music/thumbnail';
import type { ImportItem, LibraryFileAccess, Track, TrackMetadata } from '../music/types';
import type { LoginVault } from '../music/netease';
import type { MusicPlayer } from '../music/player';
import './titlebar.css';

type Entry = { path: string; name: string; relativePath: string; size: number; modified: number };
function abort(signal?: AbortSignal) { signal?.throwIfAborted(); }
const decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
async function importEntries(entries: Entry[]): Promise<ImportItem[]> {
  const items: ImportItem[] = [];
  for (const entry of entries) {
    const lyrics = /\.lrc$/i.test(entry.name) ? await invoke<string>('read_lyrics', { path: entry.path }) : '';
    items.push({ file: new File([lyrics], entry.name, { lastModified: entry.modified }), relativePath: entry.relativePath,
      desktopFile: { path: entry.path, size: entry.size, modified: entry.modified } });
  }
  return items;
}
class DesktopFiles extends BrowserFileAccess implements LibraryFileAccess {
  async choose(directory: boolean) { return importEntries(await invoke<Entry[]>('choose_files', { directory })); }
  cancelImport() { void invoke('cancel_import').catch(() => {}); }
  async parse(item: ImportItem): Promise<TrackMetadata> {
    if (!item.desktopFile) throw new Error('桌面版请使用原生文件导入');
    const result = await invoke<Omit<TrackMetadata, 'cover'> & { cover?: string; coverType?: string }>('parse_metadata', { path: item.desktopFile.path });
    const { cover, coverType, ...metadata } = result;
    return { ...metadata, cover: typeof cover === 'string' ? await thumbnail(new Blob([decode(cover)], { type: coverType || 'image/jpeg' })) : undefined };
  }
  async refreshAvailability(tracks: Track[]) {
    const native = tracks.filter(track => track.desktopFile), browser = tracks.filter(track => !track.desktopFile);
    await super.refreshAvailability(browser);
    const available = await invoke<boolean[]>('file_available', { paths: native.map(track => track.desktopFile!.path) });
    native.forEach((track, i) => { track.availability = available[i] ? 'ready' : 'missing'; });
  }
  async requestAccess(track: Track) {
    if (!track.desktopFile) return super.requestAccess(track);
    const [available] = await invoke<boolean[]>('file_available', { paths: [track.desktopFile.path] });
    track.availability = available ? 'ready' : 'missing'; return available;
  }
  async resolveMedia(track: Track, signal?: AbortSignal) {
    abort(signal);
    if (!track.desktopFile) { const url = URL.createObjectURL(await this.read(track)); return { url, release: () => URL.revokeObjectURL(url) }; }
    if (!await this.requestAccess(track)) throw new Error('文件已移动、磁盘离线或尚未授权，请重新关联文件。');
    abort(signal);
    // HTMLAudioElement requests byte ranges directly; no audio bytes cross IPC.
    return { url: convertFileSrc(track.desktopFile.path), crossOrigin: 'anonymous' as const, release() {} };
  }
}

export class DesktopHost {
  readonly files = new DesktopFiles();
  readonly login: LoginVault = {
    load: () => invoke<string | null>('load_login'),
    save: value => invoke('save_login', { value }),
  };
  readonly fetch: typeof fetch = (input, options) => nativeFetch(input, { ...options, maxRedirections: 0 });
  private listeners: UnlistenFn[] = [];
  private events = new AbortController();
  private disposed = false;
  private mediaRevision = 0;
  private mediaTimer = 0;
  private covers = new WeakMap<Blob, Promise<string>>();
  async attach(hooks: { player(): MusicPlayer | undefined; hidden(value: boolean): void; quit(): Promise<void>; drop(items: ImportItem[]): Promise<void>; tell(message: string): void }) {
    const window = getCurrentWindow();
    document.documentElement.dataset.desktop = 'true';
    document.body.insertAdjacentHTML('afterbegin', '<header class="desktop-titlebar"><div class="desktop-drag" data-tauri-drag-region><span>RHINE LAB</span><small>MUSIC PLAYER</small></div><div class="desktop-window-buttons"><button data-window="minimize" aria-label="最小化">−</button><button data-window="maximize" aria-label="最大化或还原">□</button><button data-window="close" aria-label="关闭窗口">×</button></div></header>');
    const options = { signal: this.events.signal };
    document.querySelector('.desktop-drag')!.addEventListener('dblclick', () => { void window.toggleMaximize(); }, options);
    document.querySelector('.desktop-titlebar')!.addEventListener('click', event => {
      const action = (event.target as Element).closest<HTMLElement>('[data-window]')?.dataset.window;
      if (action) void (action === 'minimize' ? window.minimize() : action === 'maximize' ? window.toggleMaximize() : window.close()).catch(error => hooks.tell(String(error)));
    }, options);
    document.addEventListener('click', event => {
      const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
      if (anchor && new URL(anchor.href).origin !== location.origin) { event.preventDefault(); void openUrl(anchor.href).catch(() => hooks.tell('这个外部地址暂不能打开')); }
    }, options);
    const register = async <T>(name: string, callback: (value: T) => void) => {
      const stop = await listen<T>(name, event => { if (!this.disposed) callback(event.payload); });
      if (this.disposed) stop(); else this.listeners.push(stop);
    };
    await register<boolean>('host-hidden', hooks.hidden);
    await register<string>('host-warning', hooks.tell);
    await register<Entry[]>('host-drop', entries => { void importEntries(entries).then(hooks.drop).catch(error => hooks.tell(error.message)); });
    await register<{ action: string; position?: number; offset?: number }>('host-media-action', value => {
      const player = hooks.player(); if (!player) return;
      void (async () => {
        if (value.action === 'toggle') await player.toggle();
        if (value.action === 'play') await player.resume();
        if (value.action === 'pause') player.pause();
        if (value.action === 'next' || value.action === 'previous') await player.advance(value.action === 'next' ? 1 : -1);
        if (value.action === 'seek') player.seek(value.position ?? 0);
        if (value.action === 'seek-by') player.seek(player.state.position + (value.offset ?? 0));
      })().catch(error => hooks.tell(error.message));
    });
    await register<null>('host-quit', () => {
      void hooks.quit().then(() => invoke('finish_quit')).catch(async () => {
        await invoke('cancel_quit').catch(() => {}); hooks.tell('保存失败，暂未退出。请重试退出。');
      });
    });
  }
  async setCloseToTray(enabled: boolean) { await invoke('set_close_to_tray', { enabled }); }
  async showDiagnostics() { await invoke('show_diagnostics'); }
  async saveBackup(value: string, name: string) { await invoke('save_backup', { value, name }); }
  async chooseLyrics() {
    const items = await this.files.choose(false); return items.find(item => /\.lrc$/i.test(item.file.name))?.file.text();
  }
  syncMedia(player: MusicPlayer, force = false) {
    if (this.disposed || !force && Date.now() - this.mediaTimer < 1000) return;
    this.mediaTimer = Date.now(); const revision = ++this.mediaRevision, track = player.currentTrack;
    let cover: Promise<string | undefined> = Promise.resolve(undefined);
    if (track?.cover) {
      let value = this.covers.get(track.cover);
      if (!value) {
        const source = track.cover;
        value = (async () => {
          const bitmap = await createImageBitmap(source);
          try {
            const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height)), canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
            canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const png = await canvas.convertToBlob({ type: 'image/png' });
            let text = ''; for (const byte of new Uint8Array(await png.arrayBuffer())) text += String.fromCharCode(byte); return btoa(text);
          } finally { bitmap.close(); }
        })(); this.covers.set(source, value);
      }
      cover = value;
    }
    const state = { title: track?.title || '', artist: track?.artist || '', album: track?.album || '', position: player.state.position, duration: player.duration, playing: player.playing };
    void cover.then(value => { if (!this.disposed && revision === this.mediaRevision) return invoke('update_media', { state: { ...state, cover: value ?? null } }); }).catch(() => {});
  }
  dispose() { this.disposed = true; ++this.mediaRevision; this.events.abort(); this.listeners.splice(0).forEach(stop => stop()); }
}
