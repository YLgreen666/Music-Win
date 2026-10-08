import type { FileAccessAdapter, MediaResource, MusicProvider, Track } from './types.ts';
import { matchesTrack } from './domain.ts';

type PermissionHandle = FileSystemFileHandle & {
  queryPermission(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'read' }): Promise<PermissionState>;
};
export class BrowserFileAccess implements FileAccessAdapter {
  readonly temporary = new Map<string, File>();
  async read(track: Track) {
    const temporary = this.temporary.get(track.id);
    if (temporary) return temporary;
    if (!track.handle) throw new Error('请重新选择这个音乐文件，恢复播放访问。');
    const handle = track.handle as PermissionHandle;
    if (typeof handle.queryPermission === 'function' && await handle.queryPermission({ mode: 'read' }) !== 'granted') {
      track.availability = 'permission';
      throw new Error('需要恢复文件读取权限，请点击“恢复访问”。');
    }
    try { const file = await track.handle.getFile(); track.availability = 'ready'; return file; }
    catch { track.availability = 'missing'; throw new Error('文件已移动或不可访问，请重新关联文件。'); }
  }
  async requestAccess(track: Track) {
    if (this.temporary.has(track.id)) return true;
    if (!track.handle) return false;
    const handle = track.handle as PermissionHandle;
    try {
      const allowed = typeof handle.requestPermission !== 'function' || await handle.requestPermission({ mode: 'read' }) === 'granted';
      track.availability = allowed ? 'ready' : 'permission';
      return allowed;
    } catch { return false; }
  }
  async refreshAvailability(tracks: Track[]) {
    for (const track of tracks) {
      if (!track.handle) { track.availability = this.temporary.has(track.id) ? 'temporary' : 'missing'; continue; }
      const handle = track.handle as PermissionHandle;
      try {
        if (typeof handle.queryPermission === 'function' && await handle.queryPermission({ mode: 'read' }) !== 'granted') track.availability = 'permission';
        else { await handle.getFile(); track.availability = 'ready'; }
      }
      catch { track.availability = 'missing'; }
    }
  }
}
export class LocalMusicProvider implements MusicProvider {
  readonly id = 'local';
  private tracks: () => Track[];
  readonly files: FileAccessAdapter;
  constructor(tracks: () => Track[], files: FileAccessAdapter) { this.tracks = tracks; this.files = files; }
  async search(query: string) { return this.tracks().filter(track => matchesTrack(track, query)); }
  async resolveMedia(track: Track): Promise<MediaResource> {
    const url = URL.createObjectURL(await this.files.read(track));
    return { url, release: () => URL.revokeObjectURL(url) };
  }
  async getCover(track: Track) { return track.cover; }
  async getLyrics(track: Track) { return track.lyrics; }
}
