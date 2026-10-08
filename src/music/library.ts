import { MusicDatabase, defaultPlayback, defaultPreferences } from './database.ts';
import { BrowserFileAccess, LocalMusicProvider } from './file-access.ts';
import { albumCollections, reconcilePlayback } from './domain.ts';
import type { Collection, ImportItem, ImportProgress, LibrarySnapshot, Track } from './types.ts';

type PickerWindow = Window & {
  showOpenFilePicker?: (options: object) => Promise<FileSystemFileHandle[]>;
  showDirectoryPicker?: (options: object) => Promise<FileSystemDirectoryHandle>;
};
type Root = { id: string; handle: FileSystemDirectoryHandle };
type Metadata = Partial<Pick<Track, 'title' | 'artist' | 'album' | 'albumArtist' | 'trackNumber' | 'duration' | 'format' | 'cover'>>;
const audioPattern = /\.(mp3|flac|m4a|aac|wav|ogg|opus|aiff?|wma)$/i;
export const isAudioFile = (name: string) => audioPattern.test(name);
export class MusicLibrary extends EventTarget {
  snapshot: LibrarySnapshot = { tracks: [], playlists: [], favorites: [], playback: defaultPlayback(), preferences: defaultPreferences() };
  readonly files = new BrowserFileAccess();
  readonly provider = new LocalMusicProvider(() => this.snapshot.tracks, this.files);
  private database = new MusicDatabase();
  private worker?: Worker;
  private parseRequest = 0;
  private pendingReject?: (reason: Error) => void;
  private saving = Promise.resolve();
  private saveTimer?: ReturnType<typeof setTimeout>;
  private cancelRequested = false;
  importing = false;
  private roots: Root[] = [];
  private dirty = false;
  private disposed = false;
  async initialize() {
    const snapshot = await this.database.load();
    if (this.disposed) { this.database.close(); return; }
    this.snapshot = snapshot;
    this.roots = this.snapshot.roots ?? [];
    await this.files.refreshAvailability(this.snapshot.tracks);
    Object.assign(this.snapshot.playback, reconcilePlayback(this.snapshot.playback.queue, this.snapshot.playback.currentEntryId, new Set(this.snapshot.tracks.map(track => track.id))));
  }
  get tracks() { return this.snapshot.tracks; }
  track(id: string) { return this.tracks.find(track => track.id === id); }
  collections(mode = this.snapshot.preferences.collectionMode): Collection[] {
    if (mode === 'albums') return albumCollections(this.tracks);
    return [
      { id: 'all', name: '全部歌曲', kind: 'builtin', trackIds: this.tracks.map(track => track.id) },
      { id: 'favorites', name: '收藏', kind: 'builtin', trackIds: this.snapshot.favorites },
      ...this.snapshot.playlists,
    ];
  }
  changed() { if (this.disposed) return; this.scheduleSave(); this.dispatchEvent(new Event('change')); }
  scheduleSave() {
    if (this.disposed) return;
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { void this.flush(); }, 350);
  }
  async flush() {
    clearTimeout(this.saveTimer);
    if (!this.dirty) return this.saving;
    this.dirty = false;
    const snapshot = { ...this.snapshot, roots: this.roots };
    this.saving = this.saving.catch(() => {}).then(() => this.database.save(snapshot));
    try { await this.saving; }
    catch (error) { this.dirty = true; if (!this.disposed) this.dispatchEvent(new CustomEvent('error', { detail: `音乐库保存失败：${error instanceof Error ? error.message : error}。请检查浏览器存储空间。` })); }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; clearTimeout(this.saveTimer); this.cancelImport();
    void this.flush().catch(() => {}).finally(() => this.database.close());
    this.files.temporary.clear();
  }
  createPlaylist(name: string) {
    const playlist: Collection = { id: crypto.randomUUID(), name: name.trim() || '新歌单', kind: 'playlist', trackIds: [] };
    this.snapshot.playlists.push(playlist); this.changed(); return playlist;
  }
  renamePlaylist(id: string, name: string) { const list = this.snapshot.playlists.find(list => list.id === id); if (list && name.trim()) { list.name = name.trim(); this.changed(); } }
  deletePlaylist(id: string) { this.snapshot.playlists = this.snapshot.playlists.filter(list => list.id !== id); this.changed(); }
  addToPlaylist(id: string, trackIds: string[]) {
    const list = this.snapshot.playlists.find(list => list.id === id);
    if (!list) return;
    list.trackIds = [...new Set([...list.trackIds, ...trackIds.filter(trackId => !!this.track(trackId))])]; this.changed();
  }
  removeFromPlaylist(id: string, trackId: string) {
    const list = this.snapshot.playlists.find(list => list.id === id); if (!list) return;
    list.trackIds = list.trackIds.filter(value => value !== trackId); this.changed();
  }
  moveInPlaylist(id: string, trackId: string, direction: number) {
    const list = this.snapshot.playlists.find(list => list.id === id); if (!list) return;
    const from = list.trackIds.indexOf(trackId), to = from + direction;
    if (from < 0 || to < 0 || to >= list.trackIds.length) return;
    [list.trackIds[from], list.trackIds[to]] = [list.trackIds[to], list.trackIds[from]]; this.changed();
  }
  favorite(id: string) {
    if (this.snapshot.favorites.includes(id)) this.snapshot.favorites = this.snapshot.favorites.filter(value => value !== id);
    else this.snapshot.favorites.push(id);
    this.changed();
  }
  removeTrack(id: string) {
    this.snapshot.tracks = this.tracks.filter(track => track.id !== id);
    this.snapshot.favorites = this.snapshot.favorites.filter(value => value !== id);
    for (const list of this.snapshot.playlists) list.trackIds = list.trackIds.filter(value => value !== id);
    Object.assign(this.snapshot.playback, reconcilePlayback(this.snapshot.playback.queue, this.snapshot.playback.currentEntryId, new Set(this.tracks.map(track => track.id))));
    this.files.temporary.delete(id); this.changed();
  }
  setLyrics(id: string, lyrics: string) { const track = this.track(id); if (track) { track.lyrics = lyrics; this.changed(); } }
  async restoreAccess(track: Track) { const restored = await this.files.requestAccess(track); this.changed(); return restored; }
  async relink(id: string, file: File, handle?: FileSystemFileHandle) {
    const track = this.track(id); if (!track) return;
    track.handle = handle; track.fileName = file.name; track.size = file.size; track.modified = file.lastModified;
    track.availability = handle ? 'ready' : 'temporary';
    if (!handle) this.files.temporary.set(id, file); else this.files.temporary.delete(id);
    this.changed();
  }
  async chooseFiles() {
    const picker = (window as PickerWindow).showOpenFilePicker;
    if (!picker) return false;
    const handles = await picker({ multiple: true, types: [{ description: '音乐与歌词', accept: { 'audio/*': ['.mp3', '.flac', '.m4a', '.aac', '.wav', '.ogg', '.opus'], 'text/plain': ['.lrc'] } }] });
    const items: ImportItem[] = [];
    for (const handle of handles) items.push({ file: await handle.getFile(), handle, relativePath: handle.name });
    await this.importItems(items); return true;
  }
  async chooseDirectory() {
    const picker = (window as PickerWindow).showDirectoryPicker;
    if (!picker) return false;
    const handle = await picker({ mode: 'read', id: 'rhine-music', startIn: 'music' });
    let root = undefined as Root | undefined;
    for (const candidate of this.roots) if (await handle.isSameEntry(candidate.handle)) { root = candidate; break; }
    if (!root) { root = { id: crypto.randomUUID(), handle }; this.roots.push(root); }
    await this.importDirectory(handle, root.id); return true;
  }
  private async importDirectory(handle: FileSystemDirectoryHandle, rootId: string) {
    if (this.importing) throw new Error('已有导入任务正在运行');
    this.importing = true; this.cancelRequested = false;
    try {
      const items: ImportItem[] = [];
      const walk = async (directory: FileSystemDirectoryHandle, prefix: string) => {
        for await (const child of (directory as FileSystemDirectoryHandle & { values(): AsyncIterableIterator<FileSystemHandle> }).values()) {
          if (this.cancelRequested) return;
          const relativePath = `${prefix}${child.name}`;
          if (child.kind === 'directory') await walk(child as FileSystemDirectoryHandle, `${relativePath}/`);
          else if (isAudioFile(child.name) || /\.lrc$/i.test(child.name)) {
            try { items.push({ file: await (child as FileSystemFileHandle).getFile(), handle: child as FileSystemFileHandle, rootId, relativePath }); }
            catch { this.dispatchEvent(new CustomEvent('error', { detail: `无法读取 ${relativePath}，已跳过` })); }
          }
          this.progress({ completed: 0, total: items.length, name: `扫描文件夹：${relativePath}`, failed: 0, canceled: false });
        }
      };
      await walk(handle, `${handle.name}/`);
      if (!this.cancelRequested) await this.processItems(items);
    } finally { this.importing = false; this.dispatchEvent(new Event('importend')); this.changed(); }
  }
  async importItems(items: ImportItem[]) {
    if (this.importing) throw new Error('已有导入任务正在运行');
    this.importing = true; this.cancelRequested = false;
    try { await this.processItems(items); }
    finally { this.importing = false; this.dispatchEvent(new Event('importend')); this.changed(); }
  }
  cancelImport() { this.cancelRequested = true; this.worker?.terminate(); this.worker = undefined; this.pendingReject?.(new Error('导入已取消')); this.pendingReject = undefined; }
  private progress(detail: ImportProgress) { this.dispatchEvent(new CustomEvent('progress', { detail })); }
  private async parse(file: File): Promise<Metadata> {
    this.worker ??= new Worker(new URL('./metadata-worker.ts', import.meta.url), { type: 'module' });
    const worker = this.worker, id = ++this.parseRequest;
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const clean = () => { clearTimeout(timer); worker.removeEventListener('message', message); worker.removeEventListener('error', error); this.pendingReject = undefined; };
      const message = (event: MessageEvent) => { if (event.data.id !== id) return; clean(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.metadata); };
      const error = () => { clean(); worker.terminate(); this.worker = undefined; reject(new Error('标签读取失败')); };
      this.pendingReject = reason => { clean(); reject(reason); };
      worker.addEventListener('message', message); worker.addEventListener('error', error);
      timer = setTimeout(() => { clean(); worker.terminate(); this.worker = undefined; reject(new Error('标签读取超时')); }, 20000);
      worker.postMessage({ id, file });
    });
  }
  private async processItems(items: ImportItem[]) {
    const lyrics = new Map<string, string>();
    for (const item of items) if (/\.lrc$/i.test(item.file.name)) lyrics.set(item.relativePath.replace(/\.lrc$/i, '').toLowerCase(), await item.file.text());
    const audioItems = items.filter(item => isAudioFile(item.file.name));
    let completed = 0, failed = 0;
    for (const item of audioItems) {
      if (this.cancelRequested) break;
      this.progress({ completed, total: audioItems.length, name: item.file.name, failed, canceled: false });
      let metadata: Metadata = {};
      try { metadata = await this.parse(item.file); }
      catch { if (this.cancelRequested) break; failed++; }
      const sourceId = item.rootId ? `${item.rootId}:${item.relativePath}` : `${item.file.name}:${item.file.size}:${item.file.lastModified}`;
      let existing = this.tracks.find(track => track.sourceId === sourceId);
      if (!existing && item.handle) for (const track of this.tracks) {
        if (!track.handle || track.fileName !== item.file.name) continue;
        try { if (await item.handle.isSameEntry(track.handle)) { existing = track; break; } } catch { /* unavailable old handle */ }
      }
      const folder = item.relativePath.includes('/') ? item.relativePath.slice(0, item.relativePath.lastIndexOf('/')) : '导入的音乐';
      const track: Track = {
        ...existing, id: existing?.id ?? crypto.randomUUID(), providerId: 'local', sourceId,
        title: metadata.title || item.file.name.replace(/\.[^.]+$/, ''), artist: metadata.artist || '未知歌手',
        album: metadata.album || '', albumArtist: metadata.albumArtist || '', trackNumber: metadata.trackNumber || 0,
        duration: metadata.duration || 0, format: metadata.format || item.file.name.split('.').pop()!.toUpperCase(),
        fileName: item.file.name, folder, size: item.file.size, modified: item.file.lastModified,
        cover: metadata.cover || existing?.cover, lyrics: lyrics.get(item.relativePath.replace(/\.[^.]+$/, '').toLowerCase()) || existing?.lyrics,
        handle: item.handle, rootId: item.rootId, relativePath: item.relativePath, availability: item.handle ? 'ready' : 'temporary',
      };
      if (existing) this.snapshot.tracks[this.tracks.indexOf(existing)] = track; else this.snapshot.tracks.push(track);
      if (!item.handle) this.files.temporary.set(track.id, item.file);
      completed++;
      if (completed % 20 === 0) { this.changed(); await new Promise(resolve => setTimeout(resolve, 0)); }
    }
    // Dropping just a sidecar LRC also attaches it to an already imported song.
    for (const track of this.tracks) {
      const path = (track.relativePath || track.fileName).replace(/\.[^.]+$/, '').toLowerCase();
      if (lyrics.has(path)) track.lyrics = lyrics.get(path);
    }
    this.progress({ completed, total: audioItems.length, name: this.cancelRequested ? '导入已取消，已完成的歌曲已保留' : '导入完成', failed, canceled: this.cancelRequested });
    this.changed();
  }
}
