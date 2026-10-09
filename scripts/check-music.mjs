import test from 'node:test';
import assert from 'node:assert/strict';
import { activeLyric, albumCollections, matchesTrack, nextQueueIndex, parseLrc, reconcilePlayback } from '../src/music/domain.ts';
import { setMusicCatalog, records, archiveColumns, fileLocation, columnFiles, musicTrack, rowRebasePeriod } from '../src/data.ts';
import { fileAtCell, selectionCell } from '../src/archive-loop.ts';
import { MusicPlayer } from '../src/music/player.ts';
import 'fake-indexeddb/auto';
import { MusicDatabase } from '../src/music/database.ts';
import { BrowserFileAccess } from '../src/music/file-access.ts';
import { MusicLibrary } from '../src/music/library.ts';
import { PageLifecycle } from '../src/music/lifecycle.ts';
import { coverFrame, coverCrop, dominantCoverColor, placeholderColor } from '../src/music/cover-design.ts';
import { setCoverSurface, coverSurfaceState } from '../src/music/card-appearance.ts';
import { NeteaseMusicProvider, neteaseTrack, secureMediaUrl } from '../src/music/netease.ts';
import { MusicProviders } from '../src/music/providers.ts';
import * as THREE from 'three';

test('cover frame leaves equal narrow margins and crops without stretching the source', () => {
  assert.ok(Math.abs((5 - coverFrame.width) / 2 - .12) < 1e-6);
  assert.ok(Math.abs((3.7 - coverFrame.height) / 2 - .12) < 1e-6);
  for (const [width, height] of [[1000, 1000], [1600, 900], [500, 1200]]) {
    const crop = coverCrop(width, height);
    assert.ok(crop.x >= 0 && crop.y >= 0);
    assert.ok(Math.abs(crop.width / crop.height - coverFrame.width / coverFrame.height) < 1e-6);
    assert.ok(crop.width <= width && crop.height <= height);
  }
});

test('cover color follows the dominant region and ignores transparent pixels', () => {
  const pixels = [...Array(80).fill([35, 100, 190, 255]).flat(), ...Array(20).fill([220, 65, 45, 255]).flat(), ...Array(200).fill([255, 0, 0, 0]).flat()];
  const blue = dominantCoverColor(pixels);
  assert.ok(blue[2] > blue[1] && blue[1] > blue[0]);
  assert.deepEqual(dominantCoverColor([0, 0, 0, 0]), placeholderColor);
  assert.deepEqual(dominantCoverColor([255, 255, 255, 255]), [1, 1, 1]);
});

test('cover glass mode restores original properties and keeps per-instance tint shaders', () => {
  const material = new THREE.MeshPhysicalMaterial({ transmission: .78, thickness: .12, roughness: .28, attenuationDistance: 2 });
  const original = material.onBeforeCompile, tint = new THREE.Color('#3678bb');
  setCoverSurface(material, 'Frosted_Polymer', false, tint, true); assert.equal(material.onBeforeCompile, original);
  setCoverSurface(material, 'Frosted_Polymer', true, tint, true);
  assert.equal(material.transmission, .975); assert.equal(material.thickness, .024);
  const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <metalnessmap_fragment>' };
  material.onBeforeCompile(shader, {});
  assert.match(shader.vertexShader, /attribute vec3 musicBorderColor/); assert.match(shader.fragmentShader, /vMusicBorderColor/);
  setCoverSurface(material, 'Frosted_Polymer', false, tint, true);
  assert.equal(material.transmission, .78); assert.equal(material.thickness, .12); assert.equal(material.roughness, .28); assert.equal(material.attenuationDistance, 2);
  assert.equal(coverSurfaceState(material).enabled.value, 0);
  material.dispose();
});

const track = (id, extra = {}) => ({ id, providerId: 'local', sourceId: id, title: id, artist: 'Test Artist', albumArtist: 'Test Artist', album: 'Album', trackNumber: 0, duration: 30, format: 'WAV', fileName: `${id}.wav`, folder: 'Music', size: 100, modified: 1, availability: 'ready', ...extra });
test('IndexedDB restores tracks, covers, lyrics, playlists, root identities, queue and preferences', async () => {
  const database = new MusicDatabase();
  const initial = await database.load();
  assert.equal(initial.playback.position, 0); assert.equal(initial.preferences.cardStyle, 'original');
  const snapshot = { ...initial, roots: [{ id: 'root-a', handle: { kind: 'directory', name: 'Music' } }], tracks: [track('a', { cover: new Blob(['cover'], { type: 'image/webp' }), lyrics: '[00:01]Hello', rootId: 'root-a' })], playlists: [{ id: 'list-a', kind: 'playlist', name: '收藏测试', trackIds: ['a'] }], favorites: ['a'], playback: { queue: [{ id: 'entry-a', trackId: 'a' }], currentEntryId: 'entry-a', position: 12, volume: .4, mode: 'repeat-all' }, preferences: { ...initial.preferences, theme: 'dark', cardStyle: 'cover', seenIntro: true } };
  await database.save(snapshot);
  const reopened = await new MusicDatabase().load();
  assert.equal(reopened.roots[0].id, 'root-a'); assert.equal(reopened.tracks[0].rootId, 'root-a');
  assert.equal(await reopened.tracks[0].cover.text(), 'cover'); assert.equal(reopened.tracks[0].lyrics, '[00:01]Hello');
  assert.deepEqual(reopened.playlists, snapshot.playlists); assert.deepEqual(reopened.favorites, ['a']);
  assert.deepEqual(reopened.playback, snapshot.playback); assert.equal(reopened.preferences.cardStyle, 'cover');
});
test('LRC supports multiple timestamps, decimals, offsets and unsorted input', () => {
  const lines = parseLrc('[offset:-500]\n[00:03.25]第三句\n[00:01.000][00:02.5]重复句\n[ar:artist]\n[00:70]invalid');
  assert.deepEqual(lines, [{ time: .5, text: '重复句' }, { time: 2, text: '重复句' }, { time: 2.75, text: '第三句' }]);
  assert.equal(activeLyric(lines, .49), -1); assert.equal(activeLyric(lines, 2), 1); assert.equal(activeLyric(lines, 100), 2);
  assert.deepEqual(parseLrc('普通无时间歌词'), []);
});
test('album identity uses album artist; missing albums fall back to folders and tracks sort numerically', () => {
  const collections = albumCollections([track('two', { trackNumber: 2 }), track('one', { trackNumber: 1, artist: 'Guest Artist' }), track('other', { albumArtist: 'Other' }), track('unknown-a', { album: '', folder: 'A' }), track('unknown-b', { album: '', folder: 'B' })]);
  assert.equal(collections.length, 4); assert.deepEqual(collections.find(group => group.name === 'Album' && group.trackIds.includes('one')).trackIds, ['one', 'two']);
});
test('search normalizes fullwidth and combines keywords', () => {
  assert.equal(matchesTrack(track('Hello', { artist: '世界' }), 'ＨＥＬＬＯ 世界'), true);
  assert.equal(matchesTrack(track('Hello'), 'Hello Unknown'), false);
});
test('queue mode boundaries and shuffle avoid the current entry', () => {
  const queue = [0, 1, 2].map(value => ({ id: `${value}`, trackId: `${value}` }));
  assert.equal(nextQueueIndex([], 0, 'sequence', 1, true), -1);
  assert.equal(nextQueueIndex(queue, 2, 'sequence', 1, true), -1);
  assert.equal(nextQueueIndex(queue, 2, 'repeat-all', 1, true), 0);
  assert.equal(nextQueueIndex(queue, 1, 'repeat-one', 1, true), 1);
  assert.equal(nextQueueIndex(queue, 1, 'repeat-one', 1, false), 2);
  for (const random of [0, .1, .7, 1]) assert.notEqual(nextQueueIndex(queue, 1, 'shuffle', 1, true, () => random), 1);
  assert.deepEqual(reconcilePlayback(queue, '1', new Set(['0', '2'])), { queue: [queue[0], queue[2]], currentEntryId: null });
});
test('dynamic scene supports zero, one, variable column lengths, more than 32 rows and thousands of tracks', () => {
  setMusicCatalog([], []); assert.equal(fileAtCell({ lane: -100, row: -100 }), 0); assert.equal(musicTrack(0), undefined);
  const tracks = Array.from({ length: 1000 }, (_, i) => track(`t${i}`));
  const collections = Array.from({ length: 17 }, (_, i) => ({ id: `p${i}`, name: `Playlist ${i}`, kind: 'playlist', trackIds: tracks.slice(i * 53, i * 53 + 53).map(track => track.id) }));
  collections.push({ id: 'single', name: 'One', kind: 'playlist', trackIds: ['t999'] });
  setMusicCatalog(tracks, collections); assert.equal(archiveColumns.length, 18);
  for (let lane = 0; lane < 17; lane++) {
    const files = columnFiles(lane); assert.equal(files.length, 53);
    const final = fileLocation(files[52]); assert.equal(final.lane, lane); assert.equal(final.row, 64);
    assert.equal(fileAtCell({ lane, row: 65 }), files[0]); assert.equal(fileAtCell({ lane, row: 11 }), files[52]);
    const cell = selectionCell(files[0], final, { axis: 'row', direction: 1 }); assert.deepEqual(cell, { lane, row: 65 });
  }
  assert.equal(musicTrack(fileAtCell({ lane: 17, row: -10000 })).id, 't999');
  assert.equal(rowRebasePeriod(), 53); assert.equal(records.length, 902);
  setMusicCatalog([track('a'), track('b'), track('c')], [{ id: 'two', name: '', kind: 'playlist', trackIds: ['a', 'b'] }, { id: 'three', name: '', kind: 'playlist', trackIds: ['a', 'b', 'c'] }]);
  assert.equal(rowRebasePeriod(), 6);
});

class FakeAudio extends EventTarget {
  src = ''; paused = true; ended = false; duration = 30; currentTime = 0; volume = 1; playbackRate = 1;
  loadRevision = 0;
  load() { const revision = ++this.loadRevision, src = this.src; if (src) queueMicrotask(() => { if (revision === this.loadRevision) this.dispatchEvent(new Event(src.startsWith('bad') ? 'error' : 'loadedmetadata')); }); }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  async play() { this.paused = false; this.dispatchEvent(new Event('play')); }
}
const state = () => ({ queue: [], currentEntryId: null, position: 0, volume: .75, mode: 'sequence' });
const tick = () => new Promise(resolve => setImmediate(resolve));

const sessionStorageFake = () => { const items = new Map(); return { getItem: key => items.get(key) || null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key), items }; };
const jsonResponse = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const cloudSong = id => ({ id, name: `Cloud ${id}`, ar: [{ name: 'Singer A' }, { name: 'Singer B' }], al: { id: 7, name: 'Cloud Album', picUrl: 'http://p1.music.126.net/cover.jpg' }, dt: 60000 });
const loggedProvider = (fetcher, storage = sessionStorageFake()) => { storage.setItem('rhine-netease-session:https://api.test', JSON.stringify({ cookie: 'MUSIC_U=test-session', uid: 8, nickname: 'Test' })); return new NeteaseMusicProvider('https://api.test', fetcher, storage); };

test('online IDs, albums and duration are stable across API shapes and do not merge with local albums', () => {
  const song = neteaseTrack(cloudSong(42));
  assert.equal(song.id, 'netease:42'); assert.equal(song.duration, 60); assert.equal(song.artist, 'Singer A / Singer B'); assert.equal(song.coverUrl, 'https://p1.music.126.net/cover.jpg');
  assert.equal(secureMediaUrl('javascript:alert(1)'), undefined);
  const other = neteaseTrack({ id: 43, name: 'Legacy', artists: [{ name: 'Guest' }], album: { id: 7, name: 'Cloud Album' }, duration: 30000 });
  const groups = albumCollections([song, other, track('local', { album: 'Cloud Album', artist: song.artist })]);
  assert.equal(groups.length, 2); assert.deepEqual(groups.find(list => list.id === 'album:netease:7').trackIds.sort(), ['netease:42', 'netease:43']);
});

test('QR login and refresh use private POST credentials, fresh requests and a tab-scoped session', async () => {
  const storage = sessionStorageFake(), calls = [];
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname, body = JSON.parse(options.body); calls.push({ url, options, body });
    if (path === '/login/qr/key') return jsonResponse({ code: 200, data: { unikey: 'qr-key' } });
    if (path === '/login/qr/create') return jsonResponse({ code: 200, data: { qrimg: 'data:image/png;base64,test' } });
    if (path === '/login/qr/check') return jsonResponse({ code: 803, cookie: 'MUSIC_U=private-token' });
    return jsonResponse({ data: { code: 200, account: { id: 8 }, profile: { nickname: 'Tester' } } });
  };
  const provider = new NeteaseMusicProvider('https://api.test', fetcher, storage);
  const qr = await provider.createQr(); assert.equal(await provider.checkQr(qr.key), 803); assert.equal(provider.account.uid, 8);
  assert.ok(calls.every(call => call.options.method === 'POST' && call.options.credentials === 'omit' && call.options.cache === 'no-store' && call.body.noCookie));
  assert.ok(calls.every(call => !call.url.includes('private-token'))); assert.equal(calls.at(-1).body.cookie, 'MUSIC_U=private-token');
  const restored = new NeteaseMusicProvider('https://api.test', fetcher, storage); assert.equal(await restored.restoreSession(), true);
  restored.disconnect(); assert.equal(storage.items.size, 0); assert.equal(restored.account, undefined);
  provider.dispose(); restored.dispose();
});

test('online playback handles unavailable songs and trial permissions without persisting expiring URLs', async () => {
  let playable = false;
  const provider = loggedProvider(async () => jsonResponse({ code: 200, data: [{ code: playable ? 200 : 404, url: playable ? 'http://m801.music.126.net/song.mp3' : null, freeTrialInfo: playable ? { start: 0, end: 30 } : null }] }));
  const song = neteaseTrack(cloudSong(42)); await assert.rejects(provider.resolveMedia(song), /暂无/); assert.equal(song.playbackNotice, '暂无可播放资源');
  playable = true; const resource = await provider.resolveMedia(song); assert.equal(resource.crossOrigin, 'anonymous'); assert.match(resource.notice, /试听/); assert.equal(resource.url, 'https://m801.music.126.net/song.mp3'); assert.equal(song.url, undefined);
  provider.disconnect(); await assert.rejects(provider.resolveMedia(song), /扫码/); provider.dispose();
});

test('late credential errors cannot disconnect a newly scanned account and requests are canceled on disposal', async () => {
  let failOld;
  const provider = loggedProvider((url, options) => new Promise((resolve, reject) => { failOld = () => resolve(jsonResponse({ code: 301 })); options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); }));
  const pending = provider.request('/lyric'); await tick(); provider.disconnect();
  provider.session = { cookie: 'MUSIC_U=new', uid: 9, nickname: 'New' }; provider.sessionRevision++;
  failOld(); await assert.rejects(pending, /登录已失效/); assert.equal(provider.account.uid, 9);
  const canceled = provider.request('/cloudsearch'); await tick(); provider.dispose(); await assert.rejects(canceled, { name: 'AbortError' });
});

test('playlist pagination keeps server order, stable identities and complete batches beyond 1000 songs', async () => {
  const ids = Array.from({ length: 1003 }, (_, id) => id + 1), calls = [];
  const provider = loggedProvider(async (url, options) => {
    const path = new URL(url).pathname, params = JSON.parse(options.body); calls.push({ path, params });
    if (path === '/user/playlist') return jsonResponse({ code: 200, playlist: [{ id: params.offset + 1, name: 'List', trackCount: ids.length }], more: params.offset === 0 });
    if (path === '/playlist/detail') return jsonResponse({ code: 200, playlist: { name: 'Long List', trackIds: ids.map(id => ({ id })) } });
    return jsonResponse({ code: 200, songs: params.ids.split(',').reverse().map(id => cloudSong(Number(id))) });
  });
  assert.equal((await provider.playlists()).length, 2);
  const result = await provider.readPlaylist('77'); assert.equal(result.tracks.length, 1003); assert.equal(result.tracks[0].id, 'netease:1'); assert.equal(result.tracks.at(-1).id, 'netease:1003'); assert.equal(result.collection.id, 'netease-playlist:8:77'); assert.equal(result.collection.readOnly, true);
  assert.equal(calls.filter(call => call.path === '/song/detail').length, 6); provider.dispose();
});

test('synced playlists update in place, remain read-only and survive restoration alongside local files', async () => {
  const library = new MusicLibrary(), song = neteaseTrack(cloudSong(42)), list = { id: 'netease-playlist:8:77', name: 'Cloud List', kind: 'playlist', trackIds: [song.id], providerId: 'netease', sourceId: '77', accountId: '8', readOnly: true };
  library.snapshot.tracks.push(track('local-file')); library.syncOnlinePlaylist([song], list); const identity = library.track(song.id);
  identity.lyrics = '[00:01]Manual'; identity.cover = new Blob(['thumb'], { type: 'image/png' });
  library.syncOnlinePlaylist([neteaseTrack(cloudSong(42))], { ...list, name: 'Renamed' }); assert.equal(library.tracks.length, 2); assert.equal(library.track(song.id), identity); assert.equal(identity.lyrics, '[00:01]Manual'); assert.ok(identity.cover);
  library.renamePlaylist(list.id, 'Wrong'); library.addToPlaylist(list.id, ['local-file']); library.removeFromPlaylist(list.id, song.id); assert.equal(library.snapshot.playlists[0].name, 'Renamed'); assert.deepEqual(library.snapshot.playlists[0].trackIds, [song.id]);
  await library.flush(); library.dispose(); const restored = new MusicLibrary(); await restored.initialize(); assert.equal(restored.track(song.id).availability, 'ready'); assert.equal(restored.track('local-file').availability, 'missing'); assert.equal(restored.snapshot.playlists[0].readOnly, true); restored.dispose();
});

test('mixed queues route each source and set CORS before online media loading, then restore paused', async () => {
  const cloud = neteaseTrack(cloudSong(42)), local = track('local'), tracks = new Map([cloud, local].map(track => [track.id, track])), seen = [];
  class CorsAudio extends FakeAudio { removeAttribute(name) { if (name === 'crossorigin') this.crossOrigin = null; else super.removeAttribute(name); } load() { if (this.src === 'cloud') assert.equal(this.crossOrigin, 'anonymous'); if (this.src === 'local') assert.equal(this.crossOrigin, null); super.load(); } }
  const providers = new MusicProviders([{ id: 'local', resolveMedia: async track => { seen.push(track.providerId); return { url: 'local', release() {} }; } }, { id: 'netease', resolveMedia: async track => { seen.push(track.providerId); return { url: 'cloud', crossOrigin: 'anonymous', release() {} }; } }]);
  const player = new MusicPlayer(state(), providers, id => tracks.get(id), new CorsAudio()); await player.playQueue([cloud.id, local.id], cloud.id); await player.advance(1); assert.deepEqual(seen, ['netease', 'local']);
  const saved = structuredClone(player.state), restored = new MusicPlayer(saved, providers, id => tracks.get(id), new CorsAudio()); await restored.restore(); assert.equal(restored.playing, false); player.dispose(); restored.dispose();
});

test('cover requests use at most four connections and abort queued work when the viewport changes', async () => {
  let active = 0, peak = 0; const releases = [];
  const provider = new NeteaseMusicProvider('https://api.test', (url, options) => new Promise((resolve, reject) => { active++; peak = Math.max(peak, active); const cancel = () => { active--; reject(options.signal.reason); }; options.signal.addEventListener('abort', cancel, { once: true }); releases.push(() => { active--; options.signal.removeEventListener('abort', cancel); resolve(new Response(new Blob(['image'], { type: 'image/png' }))); }); }), sessionStorageFake());
  const controller = new AbortController(); const canceled = provider.getCover(neteaseTrack(cloudSong(5)), controller.signal);
  const first = [1, 2, 3].map(id => provider.getCover(neteaseTrack(cloudSong(id)))); await tick(); const queued = provider.getCover(neteaseTrack(cloudSong(6)), controller.signal); await tick(); assert.equal(peak, 4);
  controller.abort(); await assert.rejects(canceled, { name: 'AbortError' }); await assert.rejects(queued, { name: 'AbortError' });
  for (const release of releases.slice(1)) release(); await Promise.all(first); assert.equal(peak, 4); provider.dispose();
});

test('closing a page cancels rendering before one-time cleanup; cached pages can return', () => {
  const pending = new Map(); let id = 0, frames = 0, cleaned = 0;
  const lifecycle = new PageLifecycle(() => frames++, () => { assert.equal(pending.size, 0); cleaned++; }, callback => { pending.set(++id, callback); return id; }, handle => pending.delete(handle));
  lifecycle.start(); lifecycle.start(); assert.equal(pending.size, 1);
  const step = () => { const [handle, callback] = pending.entries().next().value; pending.delete(handle); callback(100); };
  step(); assert.equal(frames, 1); assert.equal(pending.size, 1);
  lifecycle.pageHide(true); assert.equal(pending.size, 0); assert.equal(cleaned, 0);
  lifecycle.setHidden(false); step(); assert.equal(frames, 2);
  const staleCallback = pending.values().next().value;
  lifecycle.pageHide(false); assert.equal(cleaned, 1); assert.equal(lifecycle.closed, true);
  staleCallback(200); lifecycle.start(); lifecycle.setHidden(false); lifecycle.dispose();
  assert.equal(frames, 2); assert.equal(pending.size, 0); assert.equal(cleaned, 1);
});

test('player shutdown keeps resume state, releases once and cannot advance on late media events', async () => {
  const song = track('shutdown'), audio = new FakeAudio(); let released = 0, attempts = 0;
  const player = new MusicPlayer(state(), { resolveMedia: async () => { attempts++; return { url: song.id, release() { released++; } }; } }, id => id === song.id ? song : undefined, audio);
  await player.playQueue([song.id], song.id); const entry = player.state.currentEntryId;
  audio.currentTime = 17; let changes = 0, persists = 0;
  player.addEventListener('change', () => changes++); player.addEventListener('persist', () => persists++);
  player.dispose(); player.dispose();
  audio.dispatchEvent(new Event('ended')); audio.dispatchEvent(new Event('timeupdate')); audio.dispatchEvent(new Event('error'));
  await player.resume(); await player.advance(); await tick();
  assert.equal(audio.paused, true); assert.equal(audio.src, ''); assert.equal(released, 1); assert.equal(attempts, 1);
  assert.equal(player.state.currentEntryId, entry); assert.equal(player.state.position, 17); assert.equal(player.state.queue.length, 1);
  assert.equal(changes, 0); assert.equal(persists, 0);
});

test('closing during media resolution releases the late result without starting audio', async () => {
  let resolve, released = 0; const song = track('pending'), audio = new FakeAudio();
  const player = new MusicPlayer(state(), { resolveMedia: () => new Promise(done => { resolve = done; }) }, () => song, audio);
  const loading = player.playQueue([song.id], song.id); await tick(); player.dispose();
  resolve({ url: song.id, release() { released++; } }); await loading;
  assert.equal(released, 1); assert.equal(audio.src, ''); assert.equal(audio.paused, true);
});

test('visibility and pagehide saves coalesce and library shutdown terminates its worker once', async () => {
  const library = new MusicLibrary(); let writes = 0, closed = 0, terminated = 0;
  library.database.save = async () => { writes++; };
  library.database.close = () => { closed++; };
  library.worker = { terminate() { terminated++; } };
  library.scheduleSave(); await Promise.all([library.flush(), library.flush()]); assert.equal(writes, 1);
  library.snapshot.playback.position = 23; library.scheduleSave(); library.dispose(); library.dispose();
  await tick(); assert.equal(writes, 2); assert.equal(closed, 1); assert.equal(terminated, 1);
  library.changed(); await library.flush(); assert.equal(writes, 2);
});
test('player restores paused, keeps browsing independent and preserves queue entry identity during reordering', async () => {
  const tracks = new Map([track('a'), track('b')].map(track => [track.id, track]));
  const provider = { resolveMedia: async track => ({ url: track.id, release() {} }) };
  const player = new MusicPlayer(state(), provider, id => tracks.get(id), new FakeAudio());
  await player.playQueue(['a', 'b'], 'a'); assert.equal(player.playing, true);
  const entryId = player.state.currentEntryId; player.moveEntry(entryId, 1); assert.equal(player.currentIndex, 1); assert.equal(player.currentTrack.id, 'a');
  player.seek(12); player.pause(); assert.equal(player.state.position, 12);
  const restored = new MusicPlayer(structuredClone(player.state), provider, id => tracks.get(id), new FakeAudio());
  await restored.restore(); assert.equal(restored.playing, false); assert.equal(restored.state.position, 12);
  player.stop(); restored.stop();
});
test('rapid song switching releases stale resources and only plays the latest request', async () => {
  let releaseA = 0, releaseB = 0, resolveA;
  const tracks = new Map([track('a'), track('b')].map(track => [track.id, track]));
  const provider = { resolveMedia: track => track.id === 'a' ? new Promise(resolve => { resolveA = resolve; }) : Promise.resolve({ url: 'b', release() { releaseB++; } }) };
  const player = new MusicPlayer(state(), provider, id => tracks.get(id), new FakeAudio());
  const first = player.playQueue(['a', 'b'], 'a'); await tick();
  await player.playQueue(['a', 'b'], 'b');
  resolveA({ url: 'a', release() { releaseA++; } }); await first;
  assert.equal(player.currentTrack.id, 'b'); assert.equal(player.audio.src, 'b'); assert.equal(player.playing, true); assert.equal(releaseA, 1);
  player.stop(); assert.equal(releaseB, 1);
});
test('automatic playback skips failed media and stops after one bounded pass', async () => {
  const tracks = new Map([track('a'), track('bad'), track('good')].map(track => [track.id, track]));
  let attempts = 0;
  const provider = { resolveMedia: async track => { attempts++; return { url: track.id, release() {} }; } };
  const player = new MusicPlayer(state(), provider, id => tracks.get(id), new FakeAudio());
  await player.playQueue(['a', 'bad', 'good'], 'a'); await player.advance(1, true); assert.equal(player.currentTrack.id, 'good'); assert.equal(player.playing, true);
  player.clearQueue(); player.state.queue = [{ id: 'bad-1', trackId: 'bad' }, { id: 'bad-2', trackId: 'bad' }]; player.state.mode = 'repeat-one';
  attempts = 0; await player.advance(1, true); assert.equal(attempts, 2); assert.equal(player.playing, false);
  player.stop();
});
test('remove current entry stops its resource; removal of another entry leaves playback intact', async () => {
  const tracks = new Map([track('a'), track('b')].map(track => [track.id, track])); let released = 0;
  const player = new MusicPlayer(state(), { resolveMedia: async track => ({ url: track.id, release() { released++; } }) }, id => tracks.get(id), new FakeAudio());
  await player.playQueue(['a', 'b'], 'a'); player.removeEntry(player.state.queue[1].id); assert.equal(player.playing, true); assert.equal(released, 0);
  player.removeEntry(player.state.currentEntryId); assert.equal(player.playing, false); assert.equal(released, 1); assert.equal(player.currentTrack, undefined);
});
test('file access never requests permission while restoring and detects moved files', async () => {
  const access = new BrowserFileAccess(); let requests = 0, permission = 'prompt';
  const file = new File(['audio'], 'song.wav');
  const handle = { queryPermission: async () => permission, requestPermission: async () => { requests++; permission = 'granted'; return permission; }, getFile: async () => file };
  const song = track('permission', { handle });
  await access.refreshAvailability([song]); assert.equal(song.availability, 'permission'); assert.equal(requests, 0);
  await assert.rejects(access.read(song), /权限/); assert.equal(requests, 0);
  assert.equal(await access.requestAccess(song), true); assert.equal(requests, 1); assert.equal(await access.read(song), file);
  handle.getFile = async () => { throw new Error('NotFound'); };
  await access.refreshAvailability([song]); assert.equal(song.availability, 'missing');
  const temporary = track('temporary'); access.temporary.set(temporary.id, file);
  assert.equal(await access.read(temporary), file);
  await new BrowserFileAccess().refreshAvailability([temporary]); assert.equal(temporary.availability, 'missing');
});
test('import updates stable IDs, falls back to folder names, associates LRC and keeps completed work on cancel', async () => {
  const library = new MusicLibrary();
  library.parse = async () => ({ title: '', album: '', duration: 10 });
  const first = { file: new File(['wav'], 'untagged.wav', { lastModified: 5 }), relativePath: 'Root/Nested/untagged.wav', rootId: 'root' };
  const lrc = { file: new File(['[00:02]歌词'], 'untagged.lrc'), relativePath: 'Root/Nested/untagged.lrc' };
  await library.importItems([first, lrc]); const id = library.tracks[0].id;
  assert.equal(library.tracks[0].title, 'untagged'); assert.equal(library.collections()[0].name, 'Root/Nested'); assert.equal(library.tracks[0].lyrics, '[00:02]歌词');
  await library.importItems([first]); assert.equal(library.tracks.length, 1); assert.equal(library.tracks[0].id, id);
  const list = library.createPlaylist('测试'); library.addToPlaylist(list.id, [id]); library.favorite(id);
  library.parse = async file => { if (file.name === 'cancel.wav') { library.cancelImport(); throw new Error('canceled'); } return {}; };
  await library.importItems([{ file: new File(['ok'], 'ok.wav'), relativePath: 'ok.wav' }, { file: new File(['cancel'], 'cancel.wav'), relativePath: 'cancel.wav' }]);
  assert.equal(library.tracks.length, 2); assert.equal(library.importing, false);
  library.removeTrack(id); assert.deepEqual(list.trackIds, []); assert.deepEqual(library.snapshot.favorites, []);
  await library.flush();
});
test('an appended queue can start without a current entry; sequence errors do not wrap to earlier songs', async () => {
  const tracks = new Map([track('a'), track('bad')].map(track => [track.id, track]));
  const player = new MusicPlayer(state(), { resolveMedia: async track => ({ url: track.id, release() {} }) }, id => tracks.get(id), new FakeAudio());
  player.enqueue('a'); player.enqueue('bad'); await player.resume(); assert.equal(player.currentTrack.id, 'a');
  await player.advance(1, true); assert.equal(player.currentTrack.id, 'bad'); assert.equal(player.playing, false);
  player.stop();
});
test('pausing a pending load prevents late autoplay and a later resume plays the same entry', async () => {
  class DelayedAudio extends FakeAudio { load() {} }
  const song = track('a'), audio = new DelayedAudio();
  const player = new MusicPlayer(state(), { resolveMedia: async () => ({ url: 'a', release() {} }) }, id => id === 'a' ? song : undefined, audio);
  const pending = player.playQueue(['a'], 'a'); await tick(); assert.equal(player.busy, true);
  await player.toggle(); assert.equal(player.wantsPlayback, false);
  audio.dispatchEvent(new Event('loadedmetadata')); await pending; assert.equal(player.playing, false);
  await player.resume(); assert.equal(player.playing, true); assert.equal(player.currentTrack.id, 'a'); player.stop();
});
