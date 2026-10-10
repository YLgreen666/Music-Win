import { defaultPlayback, defaultPreferences } from './database.ts';
import { reconcilePlayback } from './domain.ts';
import type { Collection, LibrarySnapshot, MusicPreferences, PlaybackState, Track } from './types.ts';

export type MusicBackup = { format: 'rhine-music'; version: 1; createdAt: string; tracks: (Omit<Track, 'cover' | 'handle' | 'desktopFile'> & { picture?: { type: string; data: string } })[]; playlists: Collection[]; favorites: string[]; playback: PlaybackState; preferences: MusicPreferences };
const textFields = ['id', 'providerId', 'sourceId', 'title', 'artist', 'album', 'albumArtist', 'format', 'fileName', 'folder', 'coverUrl', 'albumId', 'lyrics', 'rootId', 'relativePath'] as const;
const numberFields = ['trackNumber', 'duration', 'size', 'modified'] as const;
function portableTrack(track: Track) {
  const copy = {} as Track;
  for (const key of textFields) if (track[key] !== undefined) (copy as unknown as Record<string, unknown>)[key] = track[key];
  for (const key of numberFields) copy[key] = track[key];
  copy.availability = track.providerId === 'local' ? 'missing' : 'ready'; return copy;
}
export async function exportBackup(snapshot: LibrarySnapshot): Promise<MusicBackup> {
  const tracks: MusicBackup['tracks'] = [];
  for (const track of snapshot.tracks) {
    const copy: MusicBackup['tracks'][number] = portableTrack(track);
    if (track.cover) {
      const bytes = new Uint8Array(await track.cover.arrayBuffer());
      let binary = ''; for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      copy.picture = { type: track.cover.type, data: btoa(binary) };
    }
    tracks.push(copy);
  }
  return { format: 'rhine-music', version: 1, createdAt: new Date().toISOString(), tracks,
    playlists: structuredClone(snapshot.playlists), favorites: [...snapshot.favorites],
    playback: structuredClone(snapshot.playback), preferences: structuredClone(snapshot.preferences) };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('备份格式无效'); return value as Record<string, unknown>;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('备份中的歌曲关系无效'); return value;
}
/** Read only known fields. Imported JSON cannot authorize native file access. */
export function readBackup(input: unknown): LibrarySnapshot {
  const raw = record(input);
  if (raw.format !== 'rhine-music' || raw.version !== 1 || !Array.isArray(raw.tracks) || raw.tracks.length > 100000 || !Array.isArray(raw.playlists)) throw new Error('备份版本或格式不受支持');
  const ids = new Set<string>();
  const tracks: Track[] = raw.tracks.map(value => {
    const object = record(value), track = {} as Track;
    for (const key of textFields) {
      if (object[key] !== undefined && typeof object[key] !== 'string') throw new Error('备份歌曲信息无效');
      if (object[key] !== undefined) (track as unknown as Record<string, unknown>)[key] = object[key];
    }
    if (!track.id || !['local', 'netease'].includes(track.providerId) || !track.sourceId || ids.has(track.id)) throw new Error('备份歌曲 ID 重复或来源无效');
    ids.add(track.id);
    for (const key of ['title', 'artist', 'album', 'albumArtist', 'format', 'fileName', 'folder'] as const) track[key] ??= '';
    for (const key of numberFields) { const number = object[key] ?? 0; if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) throw new Error('备份歌曲数值无效'); track[key] = number; }
    if (track.coverUrl && !/^https:\/\//i.test(track.coverUrl)) delete track.coverUrl;
    if (object.picture) {
      const picture = record(object.picture);
      if (typeof picture.type !== 'string' || !/^image\/(png|jpeg|webp|gif)$/.test(picture.type) || typeof picture.data !== 'string' || picture.data.length > 7 * 1024 * 1024) throw new Error('备份封面格式无效或过大');
      try { track.cover = new Blob([Uint8Array.from(atob(picture.data), char => char.charCodeAt(0))], { type: picture.type }); } catch { throw new Error('备份封面数据损坏'); }
    }
    track.availability = track.providerId === 'local' ? 'missing' : 'ready'; return track;
  });
  const listIds = new Set<string>();
  const playlists = raw.playlists.map(value => {
    const list = record(value);
    if (typeof list.id !== 'string' || !list.id || typeof list.name !== 'string' || listIds.has(list.id)) throw new Error('备份歌单无效');
    listIds.add(list.id);
    const collection: Collection = { id: list.id, name: list.name, kind: 'playlist', trackIds: [...new Set(strings(list.trackIds))].filter(id => ids.has(id)) };
    for (const key of ['providerId', 'sourceId', 'accountId'] as const) if (typeof list[key] === 'string') collection[key] = list[key];
    if (list.readOnly === true) collection.readOnly = true; return collection;
  });
  const playbackRaw = record(raw.playback), queue = playbackRaw.queue;
  if (!Array.isArray(queue)) throw new Error('备份队列无效');
  const queueIds = new Set<string>();
  const playback = defaultPlayback();
  playback.queue = queue.map(value => {
    const entry = record(value); if (typeof entry.id !== 'string' || typeof entry.trackId !== 'string' || queueIds.has(entry.id)) throw new Error('备份队列条目无效');
    queueIds.add(entry.id); return { id: entry.id, trackId: entry.trackId };
  }).filter(entry => ids.has(entry.trackId));
  Object.assign(playback, reconcilePlayback(playback.queue, typeof playbackRaw.currentEntryId === 'string' ? playbackRaw.currentEntryId : null, ids));
  playback.position = typeof playbackRaw.position === 'number' && Number.isFinite(playbackRaw.position) ? Math.max(0, playbackRaw.position) : 0;
  playback.volume = typeof playbackRaw.volume === 'number' && Number.isFinite(playbackRaw.volume) ? Math.max(0, Math.min(1, playbackRaw.volume)) : .75;
  if (['sequence', 'repeat-all', 'repeat-one', 'shuffle'].includes(String(playbackRaw.mode))) playback.mode = playbackRaw.mode as PlaybackState['mode'];
  const preferences = defaultPreferences(), incoming = record(raw.preferences);
  for (const key of ['rhythm', 'sound', 'backgroundMusic', 'seenIntro', 'reduced', 'closeToTray'] as const) if (typeof incoming[key] === 'boolean') preferences[key] = incoming[key];
  const allowed = { theme: ['light', 'dark'], cardStyle: ['original', 'cover'], intro: ['first', 'always', 'short'], quality: ['performance', 'original', 'high', 'ultra'], collectionMode: ['albums', 'playlists'] };
  for (const [key, values] of Object.entries(allowed)) if (values.includes(String(incoming[key]))) (preferences as unknown as Record<string, unknown>)[key] = incoming[key];
  if (typeof incoming.soundVolume === 'number' && Number.isFinite(incoming.soundVolume)) preferences.soundVolume = Math.max(0, Math.min(1, incoming.soundVolume));
  // Quality normalization happens in the normal UI path; read numeric known fields only.
  if (incoming.rendering && typeof incoming.rendering === 'object') {
    const rendering = record(incoming.rendering), clean: Record<string, unknown> = {};
    for (const key of ['scale', 'pixelRatio', 'shadows', 'aoSamples', 'aoResolution', 'depthOfField', 'transmission', 'anisotropy']) if (typeof rendering[key] === 'number' && Number.isFinite(rendering[key])) clean[key] = rendering[key];
    if (['off', 'smaa'].includes(String(rendering.antialias))) clean.antialias = rendering.antialias;
    preferences.rendering = clean as unknown as MusicPreferences['rendering'];
  }
  return { tracks, playlists, favorites: [...new Set(strings(raw.favorites))].filter(id => ids.has(id)), playback, preferences };
}
export function mergeBackup(current: LibrarySnapshot, incoming: LibrarySnapshot, overwriteSettings = false): LibrarySnapshot {
  const tracks = new Map(current.tracks.map(track => [track.id, track]));
  for (const track of incoming.tracks) {
    const previous = tracks.get(track.id);
    tracks.set(track.id, { ...previous, ...track, cover: track.cover || previous?.cover, handle: previous?.handle, desktopFile: previous?.desktopFile, availability: previous?.availability ?? track.availability });
  }
  const playlists = new Map(current.playlists.map(list => [list.id, list]));
  for (const list of incoming.playlists) playlists.set(list.id, list);
  return { roots: current.roots, tracks: [...tracks.values()], playlists: [...playlists.values()], favorites: [...new Set([...current.favorites, ...incoming.favorites])], playback: incoming.playback, preferences: overwriteSettings ? incoming.preferences : current.preferences };
}
