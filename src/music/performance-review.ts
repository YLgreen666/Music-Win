import '../style.css'; import '../responsive.css'; import '../music.css';
import { ArchiveScene } from '../scene';
import { ModelViewer } from '../model-viewer';
import { musicShell } from '../music-shell';
import { setMusicCatalog, records } from '../data';
import { PageLifecycle } from './lifecycle';
import { fullMotion } from '../motion-preferences';
import { qualityPresets } from '../render-quality';
import { PerformanceProbe, distribution } from './performance-probe';
import type { Track } from './types';
import { MusicPlayer } from './player';

const get = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const stage = get('#stage'); stage.innerHTML = musicShell;
get('#loading').remove(); get('#boot').hidden = get('#skip').hidden = true;
const scene = new ArchiveScene(get('#three-scene'));
const selectionCosts: Record<string, number[]> = {};
const timedScene = scene as unknown as Record<string, (...args: unknown[]) => unknown>;
for (const name of ['select', 'drawLabel', 'setCardStyle', 'acquireReturningModel']) {
  const original = timedScene[name]; if (!original) continue;
  selectionCosts[name] = [];
  timedScene[name] = function (...args) {
    const start = performance.now(); try { return original.apply(scene, args); }
    finally { const values = selectionCosts[name]; if (values.length < 20000) values.push(performance.now() - start); }
  };
}
let viewer: ModelViewer | undefined, cover = true, detail = false, dark = true, selected = 0, running = false;
let segment: { start: number; duration: number; style: boolean; pass: number; warm: boolean } | undefined;
let probe: PerformanceProbe, lastAction = -1;
let player: MusicPlayer | undefined, previousTime = 0;
const results: unknown[] = [];
const tracks: Track[] = Array.from({ length: 1000 }, (_, i) => ({
  id: `performance-${i}`, providerId: 'local', sourceId: String(i), title: `TRACK ${i}`, artist: 'Rhine Test', album: `Album ${i % 30}`,
  albumArtist: 'Rhine Test', trackNumber: i, duration: 30, format: 'WAV', fileName: `${i}.wav`, folder: 'Performance', size: 0, modified: 0, availability: 'missing',
  cover: new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="hsl(${i * 37 % 360} 45% 50%)"/><circle cx="300" cy="200" r="140" fill="#d8d0c4"/><text x="30" y="420" font-size="60">${i}</text></svg>`], { type: 'image/svg+xml' }),
}));
function catalog(count: number) {
  const subset = tracks.slice(0, count);
  setMusicCatalog(subset, Array.from({ length: 30 }, (_, lane) => ({ id: `lane-${lane}`, kind: 'album', name: `Album ${lane}`, trackIds: subset.filter((_, i) => i % 30 === lane).map(track => track.id) })));
  selected = 0; scene.refreshCatalog(0);
}
function fit() {
  const scale = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.width = '1920px'; stage.style.height = '1080px'; stage.style.transform = `translate(-50%,-50%) scale(${scale})`;
  stage.style.setProperty('--stage-scale', String(scale)); scene.resize(); viewer?.resize();
}
function mode(value: boolean) { detail = value; stage.dataset.mode = value ? 'detail' : 'archive'; scene.setMode(value ? 'detail' : 'archive'); }
function nextSegment() {
  const index = results.length, pass = Math.floor(index / 4), style = index % 4 < 2, warm = index % 2 === 1;
  if (pass >= 3) { running = false; segment = undefined; scene.setPlayfield(false, {low:0,mid:0,high:0,activity:0}, .7, 0, null); get<HTMLButtonElement>('#run').disabled = false; get('#status').textContent = '对比完成（毫秒；GPU=null 表示不支持计时）'; return; }
  cover = style; scene.setCardStyle(style); mode(false);
  segment = { start: performance.now(), duration: 8000, style, pass, warm }; lastAction = -1; probe.reset();
  for (const values of Object.values(selectionCosts)) values.length = 0;
  get('#status').textContent = `第 ${pass + 1}/3 轮 · ${style ? '封面' : '内构'} · ${warm ? '重复路线' : '首次路线'}（选曲/抽取/律动；拖动手动检查）`;
}
function exercise(ms: number) {
  if (!segment) return;
  const elapsed = ms - segment.start, step = Math.floor(elapsed / 160);
  if (elapsed >= segment.duration) {
    const stats = scene.getStats();
    results.push({ pass: segment.pass + 1, cover: segment.style, warm: segment.warm, ...probe.report(), cards: stats.archiveCount, calls: stats.drawCalls, triangles: stats.triangles, covers: stats.covers, pooledModels: stats.pooledModels, selectionCPU: Object.fromEntries(Object.entries(selectionCosts).map(([name, values]) => [name, distribution(values)])) });
    get('#result').textContent = JSON.stringify(results, null, 2); nextSegment(); return;
  }
  if (step !== lastAction && records.length > 1) {
    lastAction = step;
    // Repeat the identical route on the second segment; later passes use new songs.
    selected = ((segment.pass * 137 + (step < 25 ? step : 50 - step)) % records.length + records.length) % records.length;
    scene.select(selected); if (step === 25) mode(true); if (step === 35) mode(false);
  }
  const activity = elapsed > 6000;
  scene.setPlayfield(activity, { low: .3, mid: .2, high: .1, activity: Number(activity) }, .7, 0, null);
}
await scene.load(); catalog(1000); scene.setQuality(qualityPresets.original); scene.setMotion(fullMotion()); scene.setCardStyle(true); scene.setTheme(true, true); scene.revealImmediately(); fit();
probe = new PerformanceProbe(scene.renderer);
// Standalone diagnostic only; no database, personal songs, login or network API.
const layer = (scene as unknown as { covers: { texture: Parameters<PerformanceProbe['watchTexture']>[0] } }).covers;
probe.watchTexture(layer.texture);
if (new URLSearchParams(location.search).has('uploads')) {
  const source = scene as unknown as { labelTexture: import('three').Texture; covers: { update: (...args: unknown[]) => unknown; texture: import('three').Texture } };
  const label = timedScene.drawLabel, covers = source.covers.update;
  const upload = (name: string, texture: import('three').Texture) => {
    const start = performance.now(); scene.renderer.initTexture(texture);
    (selectionCosts[name] ??= []).push(performance.now() - start);
  };
  timedScene.drawLabel = (...args) => { const value = label.apply(scene, args); upload('labelUpload', source.labelTexture); return value; };
  source.covers.update = function (...args) { const value = covers.apply(this, args); upload('atlasUpload', this.texture); return value; };
}
scene.onSelect = (index, cell) => { selected = index; scene.select(index, cell ? { cell } : undefined); };
get<HTMLButtonElement>('#run').disabled = false; get('#status').textContent = JSON.stringify(probe.report());
get('#run').onclick = () => { if (running) return; results.length = 0; get('#result').textContent = ''; running = true; get<HTMLButtonElement>('#run').disabled = true; nextSegment(); };
get('#stop').onclick = () => { running = false; segment = undefined; scene.setPlayfield(false, {low:0,mid:0,high:0,activity:0}, .7, 0, null); get<HTMLButtonElement>('#run').disabled = false; mode(false); get('#status').textContent = '已停止'; };
get('#style').onclick = () => { cover = !cover; scene.setCardStyle(cover); };
get('#detail').onclick = () => mode(!detail);
get('#dark').onclick = () => { dark = !dark; scene.setTheme(dark); };
get('#viewer').onclick = () => { viewer ??= new ModelViewer(stage, () => {}); viewer.setQuality(qualityPresets.original); viewer.open(String(selected), '性能检查', () => scene.createAssemblyModel(), false); };
get('#sample').onclick = () => { get('#result').textContent = JSON.stringify({ ...probe.report(), scene: scene.getStats() }, null, 2); probe.reset(); };
get('#audio').onclick = async () => {
  if (!player) {
    const buffer = new ArrayBuffer(44 + 8000 * 30 * 2), view = new DataView(buffer);
    const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, buffer.byteLength - 44, true);
    for (let i = 0; i < 8000 * 30; i++) view.setInt16(44 + i * 2, Math.sin(i / 8000 * Math.PI * 440) * 6000, true);
    const blob = new Blob([buffer], { type: 'audio/wav' });
    player = new MusicPlayer({ queue: [], currentEntryId: null, position: 0, volume: .03, mode: 'repeat-one' }, {
      id: 'review', search: async () => [], getCover: async track => track.cover, getLyrics: async () => undefined,
      resolveMedia: async () => { const url = URL.createObjectURL(blob); return { url, release: () => URL.revokeObjectURL(url) }; },
    }, id => tracks.find(track => track.id === id));
    player.addEventListener('time', () => { get('#audio-status').textContent = `HTMLAudio：${player!.playing ? '播放中' : '暂停'} · ${player!.audio.currentTime.toFixed(1)}s · ${player!.currentTrack?.id}`; });
    player.addEventListener('error', event => { get('#audio-status').textContent = (event as CustomEvent<string>).detail; });
  }
  await player.playQueue([tracks[0].id], tracks[0].id);
};
get<HTMLSelectElement>('#size').onchange = event => catalog(Number((event.target as HTMLSelectElement).value));
window.addEventListener('resize', fit);
const lifecycle = new PageLifecycle(ms => {
  exercise(ms); probe.begin(ms);
  if (!running && player) scene.setPlayfield(player.playing, player.bands(Math.min(.1, (ms - previousTime) / 1000)), .7, 0, null);
  previousTime = ms;
  if (!viewer?.isOpen) scene.update(ms / 1000); viewer?.setTheme(scene.themeAmount); viewer?.update(ms / 1000); probe.end();
}, () => { probe.dispose(); player?.dispose(); viewer?.dispose(); scene.dispose(); });
document.addEventListener('visibilitychange', () => { lifecycle.setHidden(document.hidden); if (document.hidden && running) get('#stop').click(); });
window.addEventListener('pagehide', event => lifecycle.pageHide(event.persisted)); lifecycle.start();
