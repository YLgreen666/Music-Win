import type { MusicProvider, Track } from './types.ts';

/** Dispatch by stable source identity; local and online entries share one queue. */
export class MusicProviders implements MusicProvider {
  readonly id = 'providers';
  private providers: Map<string, MusicProvider>;
  constructor(providers: MusicProvider[]) { this.providers = new Map(providers.map(provider => [provider.id, provider])); }
  private forTrack(track: Track) {
    const provider = this.providers.get(track.providerId);
    if (!provider) throw new Error('这个音乐来源暂不可用');
    return provider;
  }
  async search(query: string, signal?: AbortSignal) { return (await Promise.all([...this.providers.values()].map(provider => provider.search(query, signal)))).flat(); }
  resolveMedia(track: Track, signal?: AbortSignal) { return this.forTrack(track).resolveMedia(track, signal); }
  getCover(track: Track, signal?: AbortSignal) { return this.forTrack(track).getCover(track, signal); }
  getLyrics(track: Track, signal?: AbortSignal) { return this.forTrack(track).getLyrics(track, signal); }
}
