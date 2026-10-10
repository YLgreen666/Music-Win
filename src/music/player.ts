import { nextQueueIndex, reconcilePlayback } from './domain.ts';
import type { MediaResource, MusicProvider, PlaybackMode, PlaybackState, QueueEntry, Track } from './types.ts';

class MediaLoadError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) { super(message); this.retryable = retryable; }
}

export class MusicPlayer extends EventTarget {
  readonly audio: HTMLAudioElement;
  readonly state: PlaybackState;
  private provider: MusicProvider;
  private findTrack: (id: string) => Track | undefined;
  private resource?: MediaResource;
  private generation = 0;
  private loading = false;
  private playIntent = false;
  private cancelLoad?: () => void;
  private resolveAbort?: AbortController;
  private context?: AudioContext;
  private analyser?: AnalyserNode;
  private source?: MediaElementAudioSourceNode;
  private disposed = false;
  private events = new AbortController();
  private mediaActions: MediaSessionAction[] = [];
  private frequency?: Uint8Array<ArrayBuffer>;
  private mediaCover?: string;
  private persistedAt = 0;
  // Keep failures across metadata-successful loads: a stream can fail later.
  private failedEntries = new Set<string>();
  private loadedPosition = 0;
  private bandValues = { low: 0, mid: 0, high: 0, activity: 0 };
  private browserMediaSession: boolean;
  constructor(state: PlaybackState, provider: MusicProvider, findTrack: (id: string) => Track | undefined, audio = new Audio(), browserMediaSession = true) {
    super(); this.browserMediaSession = browserMediaSession; this.state = state; this.provider = provider; this.findTrack = findTrack; this.audio = audio;
    audio.preload = 'metadata'; audio.volume = state.volume;
    audio.addEventListener('timeupdate', () => {
      if (this.loading || this.disposed) return;
      this.state.position = audio.currentTime || 0;
      if (this.playing && audio.currentTime > this.loadedPosition + 1) this.failedEntries.clear();
      this.dispatchEvent(new Event('time'));
      if (Date.now() - this.persistedAt > 5000) { this.persistedAt = Date.now(); this.dispatchEvent(new Event('persist')); }
      this.syncMediaPosition();
    }, { signal: this.events.signal });
    for (const event of ['play', 'pause', 'durationchange', 'waiting', 'playing']) audio.addEventListener(event, () => { this.notify(); }, { signal: this.events.signal });
    audio.addEventListener('ended', () => { if (!this.loading) void this.advance(1, true); }, { signal: this.events.signal });
    audio.addEventListener('error', () => {
      if (this.loading || this.disposed || !this.resource) return;
      const track = this.currentTrack;
      if (track) this.report(this.mediaFailure(track).message);
      if (this.state.currentEntryId) this.failedEntries.add(this.state.currentEntryId);
      const shouldContinue = this.playIntent;
      this.capturePosition(); this.releaseMedia();
      if (shouldContinue) void this.advanceQueue(1, true, true);
      else this.notify(true);
    }, { signal: this.events.signal });
    if (this.browserMediaSession && typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      const actions: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
        play: () => { void this.resume(); }, pause: () => this.pause(),
        previoustrack: () => { void this.advance(-1); }, nexttrack: () => { void this.advance(1); },
        seekto: details => this.seek(details.seekTime ?? 0),
        seekbackward: details => this.seek(this.audio.currentTime - (details.seekOffset ?? 10)),
        seekforward: details => this.seek(this.audio.currentTime + (details.seekOffset ?? 10)),
      };
      for (const [action, handler] of Object.entries(actions)) try { navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler!); this.mediaActions.push(action as MediaSessionAction); } catch { /* optional platform action */ }
    }
  }
  get currentIndex() { return this.state.queue.findIndex(entry => entry.id === this.state.currentEntryId); }
  get currentTrack() { const entry = this.state.queue[this.currentIndex]; return entry ? this.findTrack(entry.trackId) : undefined; }
  get playing() { return !this.audio.paused && !this.audio.ended; }
  get busy() { return this.loading; }
  get wantsPlayback() { return this.playIntent; }
  get duration() { return Number.isFinite(this.audio.duration) ? this.audio.duration : this.currentTrack?.duration || 0; }
  capturePosition() {
    if (!this.resource || this.loading || this.disposed) return false;
    const position = this.audio.currentTime || 0, changed = position !== this.state.position;
    this.state.position = position;
    return changed;
  }
  private report(message: string) { this.dispatchEvent(new CustomEvent('error', { detail: message })); }
  private mediaFailure(track: Track) {
    const online = track.providerId === 'netease', code = this.audio.error?.code;
    const reasons: Record<number, string> = {
      1: '音频加载被中止，请重新播放',
      2: online ? '音频下载失败，可能是网络中断或播放地址失效' : '文件读取中断，请检查文件访问',
      3: '音频解码失败，文件可能损坏或浏览器不支持此编码',
      4: online ? '音频地址不可用，可能是服务器拒绝访问、跨域限制或格式不支持' : '音频格式不受当前浏览器支持',
    };
    let host = '';
    if (online && this.resource) try { host = ` · ${new URL(this.resource.url).hostname}`; } catch { /* No full signed URL in diagnostics. */ }
    const detail = `${reasons[code || 0] || (online ? '在线音频加载失败，请检查网络和音频服务器响应' : '音频无法解码，当前浏览器可能不支持这个格式')}（${code ? `MEDIA_ERR_${code}` : '无浏览器错误码'}${host}）`;
    if (online) track.playbackNotice = detail;
    return new MediaLoadError(`${track.title}：${detail}`, online && (code === 2 || code === 4));
  }
  private releaseMedia() {
    const resource = this.resource; this.resource = undefined;
    this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    resource?.release();
  }
  private notify(persist = false) {
    if (this.disposed) return;
    this.dispatchEvent(new Event('change'));
    if (persist) this.dispatchEvent(new Event('persist'));
    if (this.browserMediaSession && typeof navigator !== 'undefined' && 'mediaSession' in navigator) navigator.mediaSession.playbackState = this.playing ? 'playing' : 'paused';
  }
  private unlockAudio() {
    if (this.disposed) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 256; this.analyser.smoothingTimeConstant = .75;
        this.source = this.context.createMediaElementSource(this.audio);
        this.source.connect(this.analyser); this.analyser.connect(this.context.destination);
        this.frequency = new Uint8Array(this.analyser.frequencyBinCount);
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch { /* Playback remains available when Web Audio is unavailable. */ }
  }
  async playQueue(trackIds: string[], selectedId: string) {
    this.failedEntries.clear();
    this.unlockAudio();
    this.state.queue = trackIds.filter(id => !!this.findTrack(id)).map(trackId => ({ id: crypto.randomUUID(), trackId }));
    const entry = this.state.queue.find(entry => entry.trackId === selectedId);
    if (!entry) return;
    this.state.currentEntryId = entry.id; this.state.position = 0; this.notify(true);
    await this.loadEntry(entry, true);
  }
  enqueue(trackId: string, next = false) {
    if (!this.findTrack(trackId)) return;
    const entry = { id: crypto.randomUUID(), trackId };
    if (next) this.state.queue.splice(Math.max(0, this.currentIndex + 1), 0, entry); else this.state.queue.push(entry);
    this.notify(true);
  }
  async playEntry(id: string) {
    this.failedEntries.clear();
    this.unlockAudio(); const entry = this.state.queue.find(entry => entry.id === id);
    if (entry) { this.state.position = 0; await this.loadEntry(entry, true); }
  }
  async resume() {
    if (this.disposed) return;
    this.unlockAudio();
    this.playIntent = true;
    if (this.loading) { this.notify(); return; }
    if (this.currentIndex < 0 && this.state.queue.length) this.state.currentEntryId = this.state.queue[0].id;
    const entry = this.state.queue[this.currentIndex];
    if (!entry) return;
    this.failedEntries.clear();
    if (!this.resource) { await this.loadEntry(entry, true, this.state.position); return; }
    const generation = this.generation;
    try {
      await this.audio.play();
      if (generation !== this.generation || this.disposed) return;
      if (!this.playIntent) this.audio.pause();
      this.notify(true);
    } catch (error) {
      if (generation !== this.generation || this.disposed || !this.playIntent) return;
      if (error instanceof Error && error.name === 'NotAllowedError') { this.playIntent = false; this.report('请点击播放按钮，允许浏览器播放音乐。'); this.notify(); }
      else if (this.currentTrack?.providerId === 'netease') {
        // A paused CDN URL can expire. Resolve again instead of asking to relink a local file.
        this.capturePosition(); await this.loadEntry(entry, true, this.state.position, false);
      } else { this.playIntent = false; this.report('无法播放当前歌曲，请检查文件访问或重新关联文件。'); this.notify(); }
    }
  }
  pause() { this.playIntent = false; this.audio.pause(); this.notify(true); }
  async toggle() { if (this.playing || this.loading && this.playIntent) this.pause(); else await this.resume(); }
  seek(position: number) {
    const value = Math.max(0, Math.min(this.duration || Infinity, position));
    this.state.position = value;
    if (this.resource && Number.isFinite(this.audio.duration)) this.audio.currentTime = value;
    this.dispatchEvent(new Event('time')); this.notify(true);
  }
  setVolume(value: number) { this.audio.volume = this.state.volume = Math.max(0, Math.min(1, value)); this.notify(true); }
  setMode(mode: PlaybackMode) { this.state.mode = mode; this.notify(true); }
  moveEntry(id: string, direction: number) {
    const index = this.state.queue.findIndex(entry => entry.id === id), next = index + direction;
    if (index < 0 || next < 0 || next >= this.state.queue.length) return;
    [this.state.queue[index], this.state.queue[next]] = [this.state.queue[next], this.state.queue[index]]; this.notify(true);
  }
  removeEntry(id: string) {
    if (id === this.state.currentEntryId) this.stop();
    this.state.queue = this.state.queue.filter(entry => entry.id !== id); this.notify(true);
  }
  clearQueue() { this.stop(); this.state.queue = []; this.notify(true); }
  reconcile(trackIds: Set<string>) {
    if (this.resource && !this.currentTrack) this.stop();
    Object.assign(this.state, reconcilePlayback(this.state.queue, this.state.currentEntryId, trackIds)); this.notify();
  }
  stop() {
    this.playIntent = false;
    this.failedEntries.clear();
    ++this.generation; this.resolveAbort?.abort(); this.cancelLoad?.(); this.cancelLoad = undefined; this.loading = false;
    this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    this.resource?.release(); this.resource = undefined;
    this.state.currentEntryId = null; this.state.position = 0; this.notify(true);
  }
  async restore() {
    const entry = this.state.queue[this.currentIndex];
    if (entry && this.currentTrack?.availability === 'ready') await this.loadEntry(entry, false, this.state.position);
    else this.notify();
  }
  async advance(direction = 1, ended = false) {
    this.failedEntries.clear();
    await this.advanceQueue(direction, ended, false);
  }
  private async advanceQueue(direction: number, ended: boolean, afterFailure: boolean) {
    if (this.disposed) return;
    this.unlockAudio();
    // A broken single-repeat song must move on; successful endings still repeat it.
    const mode = afterFailure && this.state.mode === 'repeat-one' ? 'repeat-all' : this.state.mode;
    const index = nextQueueIndex(this.state.queue, this.currentIndex, mode, direction, ended);
    if (index < 0) { this.playIntent = false; this.audio.pause(); this.seek(0); this.notify(true); return; }
    const visited = this.failedEntries;
    let candidate = index, inspected = 0;
    while (inspected++ < this.state.queue.length) {
      const entry = this.state.queue[candidate]; if (!entry) break;
      if (!visited.has(entry.id)) {
        const success = await this.loadEntry(entry, true);
        if (success === 'superseded' || success === 'blocked') return;
        if (success === 'ready') return;
        visited.add(entry.id);
      }
      if (ended && this.state.mode === 'sequence' && candidate + direction >= this.state.queue.length) break;
      candidate = (candidate + (direction < 0 ? -1 : 1) + this.state.queue.length) % this.state.queue.length;
    }
    this.releaseMedia(); this.playIntent = false; this.report('本轮队列没有可播放的歌曲，请检查文件访问、网易云登录或歌曲权限。'); this.notify(true);
  }
  private async loadEntry(entry: QueueEntry, play: boolean, position = 0, renewOnline = true): Promise<'ready' | 'failed' | 'superseded' | 'blocked'> {
    if (this.disposed) return 'superseded';
    const generation = ++this.generation;
    this.resolveAbort?.abort(); this.resolveAbort = new AbortController();
    this.cancelLoad?.(); this.cancelLoad = undefined;
    this.loading = true; this.playIntent = play; this.audio.pause();
    this.resource?.release(); this.resource = undefined;
    this.audio.removeAttribute('src'); this.audio.load();
    this.state.currentEntryId = entry.id; this.state.position = position; this.notify(true);
    this.loadedPosition = position;
    let resource: MediaResource | undefined;
    try {
      const track = this.findTrack(entry.trackId); if (!track) throw new Error('歌曲已从音乐库移除');
      resource = await this.provider.resolveMedia(track, this.resolveAbort.signal);
      if (generation !== this.generation) { resource.release(); return 'superseded'; }
      this.resource = resource;
      if (resource.notice) this.report(resource.notice);
      const metadataReady = new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>;
        const cleanup = () => { clearTimeout(timer); this.audio.removeEventListener('loadedmetadata', loaded); this.audio.removeEventListener('error', failed); if (generation === this.generation) this.cancelLoad = undefined; };
        const loaded = () => { cleanup(); resolve(); };
        const failed = () => { const error = this.mediaFailure(track); cleanup(); reject(error); };
        this.cancelLoad = () => { cleanup(); reject(new Error('播放请求已替换')); };
        this.audio.addEventListener('loadedmetadata', loaded); this.audio.addEventListener('error', failed);
        timer = setTimeout(() => { cleanup(); reject(new Error('音频加载超时')); }, 20000);
      });
      if (resource.crossOrigin) this.audio.crossOrigin = resource.crossOrigin; else this.audio.removeAttribute('crossorigin');
      this.audio.src = resource.url; this.audio.load();
      await metadataReady;
      if (generation !== this.generation) return 'superseded';
      if (position > 0) this.audio.currentTime = Math.min(position, Math.max(0, this.audio.duration - .05));
      if (Number.isFinite(this.audio.duration)) track.duration = this.audio.duration;
      this.syncMediaMetadata(track);
      if (this.playIntent) await this.audio.play();
      if (generation !== this.generation) return 'superseded';
      if (!this.playIntent) this.audio.pause();
      this.loading = false; this.notify(true); return 'ready';
    } catch (error) {
      if (generation !== this.generation) return 'superseded';
      this.loading = false;
      if (error instanceof Error && error.name === 'NotAllowedError') {
        this.playIntent = false; this.report('请点击播放按钮，允许浏览器播放音乐。'); this.notify(true); return 'blocked';
      }
      const track = this.findTrack(entry.trackId);
      const failure = this.audio.error && track ? this.mediaFailure(track) : error;
      const retry = renewOnline && failure instanceof MediaLoadError && failure.retryable;
      const intent = this.playIntent;
      this.releaseMedia();
      if (retry) { this.report(`${track!.title}：音频地址加载失败，正在重新获取播放地址…`); return this.loadEntry(entry, intent, position, false); }
      this.playIntent = false;
      this.report(failure instanceof Error ? failure.message : '歌曲播放失败'); this.notify(true);
      return 'failed';
    }
  }
  refreshMediaMetadata(trackId: string) {
    if (this.disposed) return;
    const entry = this.state.queue.find(item => item.id === this.state.currentEntryId);
    if (entry?.trackId !== trackId) return;
    const track = this.findTrack(trackId);
    if (track) this.syncMediaMetadata(track);
  }
  private syncMediaMetadata(track: Track) {
    if (!this.browserMediaSession || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (this.mediaCover) URL.revokeObjectURL(this.mediaCover);
    this.mediaCover = track.cover ? URL.createObjectURL(track.cover) : undefined;
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: track.album, artwork: this.mediaCover ? [{ src: this.mediaCover, type: track.cover!.type }] : [] });
  }
  private syncMediaPosition() {
    if (!this.browserMediaSession || typeof navigator === 'undefined' || !('mediaSession' in navigator) || !navigator.mediaSession.setPositionState || !this.duration) return;
    try { navigator.mediaSession.setPositionState({ duration: this.duration, playbackRate: this.audio.playbackRate, position: Math.min(this.duration, this.audio.currentTime) }); } catch { /* browser capability */ }
  }
  bands(dt: number) {
    const targets = { low: 0, mid: 0, high: 0, activity: 0 };
    if (this.playing && this.analyser && this.frequency) {
      this.analyser.getByteFrequencyData(this.frequency);
      const sampleRate = this.context!.sampleRate, size = this.analyser.fftSize;
      const energy = (low: number, high: number) => {
        const start = Math.max(1, Math.floor(low * size / sampleRate)), end = Math.min(this.frequency!.length, Math.max(start + 1, Math.ceil(high * size / sampleRate)));
        let sum = 0; for (let i = start; i < end; i++) sum += (this.frequency![i] / 255) ** 2;
        return Math.sqrt(sum / Math.max(1, end - start));
      };
      targets.low = energy(20, 500); targets.mid = energy(500, 4000); targets.high = energy(4000, 16000);
      targets.activity = Math.max(targets.low, targets.mid, targets.high) > .015 ? 1 : 0;
    }
    for (const key of ['low', 'mid', 'high', 'activity'] as const) this.bandValues[key] += (targets[key] - this.bandValues[key]) * (1 - Math.exp(-Math.min(dt, .1) * (targets[key] > this.bandValues[key] ? 12 : 3)));
    return { ...this.bandValues };
  }
  dispose() {
    if (this.disposed) return;
    // Shutdown preserves the queue and resume position; stop() deliberately clears them.
    this.capturePosition();
    this.disposed = true; this.playIntent = false; ++this.generation;
    this.events.abort(); this.resolveAbort?.abort(); this.cancelLoad?.(); this.cancelLoad = undefined; this.loading = false;
    this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    this.resource?.release(); this.resource = undefined;
    this.source?.disconnect(); this.analyser?.disconnect();
    this.source = undefined; this.analyser = undefined; this.frequency = undefined;
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    if (this.mediaCover) URL.revokeObjectURL(this.mediaCover);
    this.mediaCover = undefined;
    if (this.browserMediaSession && typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      for (const action of this.mediaActions) try { navigator.mediaSession.setActionHandler(action, null); } catch { /* optional action */ }
      navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none';
    }
  }
}
