import type { Collection, MediaResource, MusicProvider, Track } from './types.ts';

export const NETEASE_API = 'https://wy-yapi-enhanced.vercel.app';
type Artist = { name?: string };
export type NeteaseSong = { id: number; name?: string; ar?: Artist[]; artists?: Artist[]; al?: { id?: number; name?: string; picUrl?: string }; album?: { id?: number; name?: string; picUrl?: string; artist?: Artist }; dt?: number; duration?: number; no?: number };
export type NeteasePlaylist = { id: number; name: string; trackCount: number; creator?: { nickname?: string }; subscribed?: boolean };
type Session = { cookie: string; uid: number; nickname: string };
type ApiBody = { code?: number; message?: string; msg?: string; [key: string]: unknown };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export class NeteaseUnavailableError extends Error { constructor() { super('网易云暂无这首歌的可播放资源，可能已下架或受账号权限、地区限制。'); this.name = 'NeteaseUnavailableError'; } }
export function secureMediaUrl(value?: string) {
  if (!value) return undefined;
  try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) return undefined; url.protocol = 'https:'; return url.href; } catch { return undefined; }
}
export function neteaseTrack(song: NeteaseSong): Track {
  const artists = song.ar || song.artists || [], album = song.al || song.album;
  const title = song.name || `歌曲 ${song.id}`, artist = artists.map(item => item.name).filter(Boolean).join(' / ') || '未知歌手';
  return { id: `netease:${song.id}`, sourceId: String(song.id), providerId: 'netease', title, artist, album: album?.name || '网易云音乐', albumArtist: '', albumId: album?.id ? String(album.id) : undefined, trackNumber: song.no || 0, duration: (song.dt || song.duration || 0) / 1000, format: 'ONLINE', fileName: title, folder: '网易云音乐', size: 0, modified: 0, availability: 'ready', coverUrl: secureMediaUrl(album?.picUrl) };
}

/** Credentials stay in the current tab; playback URLs are resolved anew, never persisted. */
export class NeteaseMusicProvider extends EventTarget implements MusicProvider {
  readonly id = 'netease';
  readonly endpoint: string;
  private session?: Session;
  private storage?: StorageLike;
  private storageKey: string;
  private requests = new Set<AbortController>();
  private sessionRevision = 0;
  private closed = false;
  private coverActive = 0;
  private coverQueue: (() => void)[] = [];
  private fetcher: typeof fetch;
  constructor(endpoint = NETEASE_API, fetcher: typeof fetch = fetch, storage?: StorageLike) {
    super(); this.fetcher = fetcher; this.endpoint = endpoint.replace(/\/$/, ''); this.storageKey = `rhine-netease-session:${this.endpoint}`;
    try { this.storage = storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined); const stored = JSON.parse(this.storage?.getItem(this.storageKey) || 'null'); if (stored && typeof stored.cookie === 'string' && typeof stored.uid === 'number' && typeof stored.nickname === 'string') this.session = stored; } catch { /* Storage may be disabled. */ }
  }
  get account() { return this.session ? { uid: this.session.uid, nickname: this.session.nickname } : undefined; }
  private persist() { try { if (this.session) this.storage?.setItem(this.storageKey, JSON.stringify(this.session)); else this.storage?.removeItem(this.storageKey); } catch { /* Keep an in-memory session when storage is blocked. */ } this.dispatchEvent(new Event('auth')); }
  disconnect() { ++this.sessionRevision; this.session = undefined; this.persist(); }
  async request<T extends ApiBody>(path: string, params: Record<string, unknown> = {}, signal?: AbortSignal, cookie = this.session?.cookie): Promise<T> {
    if (this.closed) throw new DOMException('页面已关闭', 'AbortError');
    const controller = new AbortController(), abort = () => controller.abort(signal?.reason);
    this.requests.add(controller); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const timeout = setTimeout(() => controller.abort(new DOMException('接口请求超时，请重试', 'TimeoutError')), 25000);
    const revision = this.sessionRevision;
    try {
      // Cookie in POST body avoids credentials in URLs, history and server access logs.
      const response = await this.fetcher(`${this.endpoint}${path}?timestamp=${Date.now()}&requestId=${crypto.randomUUID()}`, { method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...params, noCookie: true, ...(cookie ? { cookie } : {}) }), signal: controller.signal });
      if (!response.ok) throw new Error(`网易云接口暂不可用（HTTP ${response.status}）`);
      const body = await response.json() as T;
      if (body.code === 301) { if (revision === this.sessionRevision && this.session) this.disconnect(); throw new Error('网易云登录已失效，请重新扫码'); }
      if (body.code && body.code !== 200 && !(path === '/login/qr/check' && [800, 801, 802, 803].includes(body.code))) throw new Error('网易云接口未能完成请求，请稍后重试');
      return body;
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason || new DOMException('请求已取消', 'AbortError');
      if (error instanceof TypeError) throw new Error('无法连接网易云接口，请检查网络或跨域设置');
      throw error;
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); this.requests.delete(controller); }
  }
  async restoreSession(signal?: AbortSignal) {
    if (!this.session) return false;
    const revision = this.sessionRevision;
    const result = await this.request<ApiBody & { data: { account?: { id: number }; profile?: { nickname: string } } }>('/login/status', {}, signal);
    if (revision !== this.sessionRevision) return false;
    if (!result.data?.account) { this.disconnect(); return false; }
    this.session.uid = result.data.account.id; this.session.nickname = result.data.profile?.nickname || '网易云用户'; this.persist(); return true;
  }
  async createQr(signal?: AbortSignal) {
    const result = await this.request<ApiBody & { data: { unikey: string } }>('/login/qr/key', {}, signal, '');
    if (!result.data?.unikey) throw new Error('登录二维码生成失败，请重试');
    const key = result.data.unikey;
    const image = await this.request<ApiBody & { data: { qrimg: string } }>('/login/qr/create', { key, qrimg: true }, signal, '');
    if (!image.data?.qrimg?.startsWith('data:image/png;base64,')) throw new Error('登录二维码生成失败，请重试');
    return { key, image: image.data.qrimg };
  }
  async checkQr(key: string, signal?: AbortSignal) {
    const revision = this.sessionRevision;
    const result = await this.request<ApiBody & { cookie?: string }>('/login/qr/check', { key }, signal, '');
    if (result.code === 803 && result.cookie && revision === this.sessionRevision) {
      const status = await this.request<ApiBody & { data: { account?: { id: number }; profile?: { nickname: string } } }>('/login/status', {}, signal, result.cookie);
      if (revision !== this.sessionRevision || signal?.aborted) throw new DOMException('登录请求已取消', 'AbortError');
      if (!status.data?.account) throw new Error('登录未生效，请刷新二维码重试');
      ++this.sessionRevision; this.session = { cookie: result.cookie, uid: status.data.account.id, nickname: status.data.profile?.nickname || '网易云用户' }; this.persist();
    } else if (result.code === 803) throw new Error('登录未返回有效凭据，请刷新二维码重试');
    return result.code;
  }
  async search(query: string, signal?: AbortSignal) { return (await this.searchPage(query, 0, signal)).tracks; }
  async searchPage(query: string, offset = 0, signal?: AbortSignal) {
    const result = await this.request<ApiBody & { result?: { songs?: NeteaseSong[]; songCount?: number } }>('/cloudsearch', { keywords: query, type: 1, limit: 30, offset }, signal);
    const tracks = (result.result?.songs || []).map(neteaseTrack); return { tracks, total: result.result?.songCount ?? tracks.length };
  }
  async resolveMedia(track: Track, signal?: AbortSignal): Promise<MediaResource> {
    if (!this.account) throw new Error('请先在网易云入口扫码登录，再播放在线歌曲');
    const revision = this.sessionRevision;
    const result = await this.request<ApiBody & { data: { url?: string; code: number; freeTrialInfo?: unknown; type?: string }[] }>('/song/url/v1', { id: track.sourceId, level: 'standard' }, signal);
    if (revision !== this.sessionRevision) throw new DOMException('网易云账号已切换，请重新播放', 'AbortError');
    const item = result.data?.[0], url = secureMediaUrl(item?.url);
    if (!url || item.code !== 200) { track.playbackNotice = '暂无可播放资源'; throw new NeteaseUnavailableError(); }
    const notice = item.freeTrialInfo ? '当前账号仅可播放试听片段' : undefined;
    track.playbackNotice = notice; return { url, crossOrigin: 'anonymous', notice, release() {} };
  }
  async getCover(track: Track, signal?: AbortSignal) {
    if (track.cover || !track.coverUrl) return track.cover;
    if (this.closed) throw new DOMException('页面已关闭', 'AbortError');
    const url = new URL(track.coverUrl); url.searchParams.set('param', '320y320');
    const controller = new AbortController(), abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort(); this.requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 15000);
    let acquired = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const canceled = () => { const index = this.coverQueue.indexOf(start); if (index >= 0) this.coverQueue.splice(index, 1); reject(controller.signal.reason); };
        const start = () => { controller.signal.removeEventListener('abort', canceled); if (controller.signal.aborted) { reject(controller.signal.reason); return; } this.coverActive++; acquired = true; resolve(); };
        if (controller.signal.aborted) reject(controller.signal.reason);
        else if (this.coverActive < 4) start();
        else { this.coverQueue.push(start); controller.signal.addEventListener('abort', canceled, { once: true }); }
      });
      const response = await this.fetcher(url.href, { credentials: 'omit', signal: controller.signal }); if (!response.ok) return;
      const blob = await response.blob(); return blob.type.startsWith('image/') && blob.size <= 2 * 1024 * 1024 ? blob : undefined;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.requests.delete(controller); if (acquired) { this.coverActive--; this.coverQueue.shift()?.(); } }
  }
  async getLyrics(track: Track, signal?: AbortSignal) {
    if (track.lyrics !== undefined) return track.lyrics;
    const result = await this.request<ApiBody & { lrc?: { lyric?: string } }>('/lyric', { id: track.sourceId }, signal); return result.lrc?.lyric || '';
  }
  async playlists(signal?: AbortSignal) {
    if (!this.account) throw new Error('请先扫码登录网易云');
    const lists: NeteasePlaylist[] = []; let offset = 0;
    while (true) {
      const result = await this.request<ApiBody & { playlist?: NeteasePlaylist[]; more?: boolean }>('/user/playlist', { uid: this.account.uid, limit: 100, offset }, signal);
      const page = result.playlist || []; lists.push(...page); if (!result.more || !page.length) break; offset += page.length;
    }
    return lists;
  }
  async readPlaylist(id: string, progress?: (done: number, total: number) => void, signal?: AbortSignal) {
    if (!this.account) throw new Error('请先扫码登录网易云');
    const accountId = String(this.account.uid);
    const detail = await this.request<ApiBody & { playlist: { name: string; trackIds: { id: number }[] } }>('/playlist/detail', { id }, signal);
    if (!detail.playlist) throw new Error('歌单暂不可读取');
    const ids = detail.playlist.trackIds || [], songs = new Map<string, Track>(); progress?.(0, ids.length);
    for (let offset = 0; offset < ids.length; offset += 200) {
      const chunk = ids.slice(offset, offset + 200);
      const result = await this.request<ApiBody & { songs?: NeteaseSong[] }>('/song/detail', { ids: chunk.map(item => item.id).join(',') }, signal);
      for (const song of result.songs || []) songs.set(String(song.id), neteaseTrack(song)); progress?.(Math.min(offset + 200, ids.length), ids.length);
    }
    if (String(this.account?.uid) !== accountId) throw new DOMException('账号已切换，请重新读取歌单', 'AbortError');
    const tracks = ids.map(item => songs.get(String(item.id))).filter((track): track is Track => !!track);
    const collection: Collection = { id: `netease-playlist:${accountId}:${id}`, name: detail.playlist.name, kind: 'playlist', trackIds: tracks.map(track => track.id), providerId: this.id, sourceId: id, accountId, readOnly: true };
    return { tracks, collection, missing: ids.length - tracks.length };
  }
  dispose() { this.closed = true; ++this.sessionRevision; for (const request of this.requests) request.abort(); this.requests.clear(); this.session = undefined; }
}
