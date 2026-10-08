import type { Collection, LyricLine, PlaybackMode, QueueEntry, Track } from './types.ts';

export function parseLrc(source: string): LyricLine[] {
  const offset = Number(source.match(/\[offset:([+-]?\d+)\]/i)?.[1] ?? 0) / 1000;
  const lines: LyricLine[] = [];
  for (const raw of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const stamp of stamps) {
      const seconds = Number(stamp[2]);
      if (seconds >= 60) continue;
      lines.push({ time: Math.max(0, Number(stamp[1]) * 60 + seconds + Number(`0.${stamp[3] ?? '0'}`) + offset), text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

export function activeLyric(lines: LyricLine[], time: number): number {
  let lo = 0, hi = lines.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (lines[mid].time <= time) lo = mid + 1; else hi = mid; }
  return lo - 1;
}

export function albumCollections(tracks: Track[]): Collection[] {
  const groups = new Map<string, Collection>();
  const trackMap = new Map(tracks.map(track => [track.id, track]));
  for (const track of tracks) {
    const key = track.album ? `${track.albumArtist || track.artist}\u0000${track.album}` : `folder:${track.folder}`;
    const id = `album:${key}`;
    let group = groups.get(id);
    if (!group) { group = { id, name: track.album || track.folder || '未命名专辑', kind: 'album', trackIds: [] }; groups.set(id, group); }
    group.trackIds.push(track.id);
  }
  for (const group of groups.values()) group.trackIds.sort((a, b) => {
    const first = trackMap.get(a)!, second = trackMap.get(b)!;
    return (first.trackNumber || Infinity) - (second.trackNumber || Infinity) || first.fileName.localeCompare(second.fileName, 'zh-CN', { numeric: true });
  });
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
}

export function nextQueueIndex(queue: QueueEntry[], current: number, mode: PlaybackMode, direction: number, ended: boolean, random = Math.random): number {
  if (!queue.length) return -1;
  if (ended && mode === 'repeat-one' && current >= 0) return current;
  if (mode === 'shuffle' && queue.length > 1) {
    const candidate = Math.floor(Math.min(.999999, Math.max(0, random())) * (queue.length - 1));
    return candidate >= current && current >= 0 ? candidate + 1 : candidate;
  }
  const next = current < 0 ? 0 : current + direction;
  if (next >= 0 && next < queue.length) return next;
  return mode === 'repeat-all' || !ended ? ((next % queue.length) + queue.length) % queue.length : -1;
}

export function reconcilePlayback(queue: QueueEntry[], currentEntryId: string | null, trackIds: Set<string>) {
  const retained = queue.filter(entry => trackIds.has(entry.trackId));
  return { queue: retained, currentEntryId: retained.some(entry => entry.id === currentEntryId) ? currentEntryId : null };
}

export function formatTime(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function normalizedSearch(value: string) { return value.normalize('NFKC').toLocaleLowerCase().trim(); }
export function matchesTrack(track: Track, query: string) {
  const words = normalizedSearch(query).split(/\s+/).filter(Boolean);
  const text = normalizedSearch(`${track.title} ${track.artist} ${track.album} ${track.fileName}`);
  return words.every(word => text.includes(word));
}
