import type { Collection, Track } from './music/types.ts';

export interface ArchiveRecord {
  id: string;
  title: string;
  en: string;
  department: string;
  category: string;
  date: string;
  lead: string;
  clearance: string;
  abstract: string;
  findings: string[];
  source: string;
}

const placeholder: ArchiveRecord = { id: 'empty', title: '等待导入音乐', en: 'YOUR MUSIC, ARCHIVED', department: '', category: 'empty', date: '', lead: '', clearance: 'LOCAL LIBRARY', abstract: '', findings: [], source: '' };
export let records: ArchiveRecord[] = [placeholder];
export let archiveColumns = ['empty'];
export let categories = ['全部档案'];
let lanes: number[][] = [[0]];
let locations = [{ lane: 0, row: 12, slot: 0 }];
let trackEntries: (Track | undefined)[] = [undefined];
export let musicColumns: Collection[] = [];
export let catalogVersion = 0;

export function setMusicCatalog(tracks: Track[], collections: Collection[]) {
  const map = new Map(tracks.map(track => [track.id, track]));
  musicColumns = collections.map(collection => ({ ...collection, trackIds: collection.trackIds.filter(id => map.has(id)) })).filter(collection => collection.trackIds.length > 0);
  records = []; archiveColumns = musicColumns.map(collection => collection.id); lanes = []; locations = []; trackEntries = [];
  for (const [lane, collection] of musicColumns.entries()) {
    const files: number[] = [];
    for (const [offset, id] of collection.trackIds.entries()) {
      const track = map.get(id)!; const index = records.length; files.push(index); trackEntries.push(track);
      records.push({ id: track.id, title: track.title, en: track.artist, department: track.album, category: collection.id, date: '', lead: track.artist, clearance: track.format, abstract: track.fileName, findings: [], source: '' });
      locations.push({ lane, row: 12 + offset, slot: index });
    }
    lanes.push(files);
  }
  if (!records.length) { records = [placeholder]; archiveColumns = ['empty']; lanes = [[0]]; locations = [{ lane: 0, row: 12, slot: 0 }]; trackEntries = [undefined]; }
  categories = ['全部档案', ...musicColumns.map(collection => collection.name)]; catalogVersion++;
}
export function musicTrack(index: number) { return trackEntries[index]; }

export function columnFiles(lane: number) {
  return lanes[lane] ?? lanes[0] ?? [0];
}
export function fileLocation(index: number) {
  return locations[index] ?? locations[0];
}
export function fileAtSlot(slot: number) {
  return Math.max(0, Math.min(records.length - 1, slot));
}
export function rowRebasePeriod() {
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  let period = 1;
  for (const lane of lanes) { period = period / gcd(period, lane.length) * lane.length; if (period > 1_000_000) return Infinity; }
  return period;
}
