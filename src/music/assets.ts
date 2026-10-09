import type { Track } from './types.ts';
type CoverLoader = (track: Track, signal: AbortSignal) => Promise<Blob | undefined>;
let loader: CoverLoader | undefined;
export function setMusicCoverLoader(value?: CoverLoader) { loader = value; }
export function loadMusicCover(track: Track, signal: AbortSignal) { return loader?.(track, signal); }
