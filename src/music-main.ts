import './style.css';
import './responsive.css';
import './startup.css';
import './decryption.css';
import './document-decryption.css';
import '@kitlangton/rolling-number/styles.css';
import './music.css';
import { createRollingNumber, createRollingText } from '@kitlangton/rolling-number';
import { musicShell } from './music-shell';
import { ArchiveScene } from './scene';
import { BootSequence } from './boot';
import { ModelViewer } from './model-viewer';
import { TerminalAudio } from './audio';
import { StartupGate } from './startup';
import { loadBootWebfonts } from './boot-lettering';
import { viewportLayout, openingLayout } from './viewport-layout';
import { paintTheme } from './theme-ui';
import { fullMotion, reducedMotion } from './motion-preferences';
import { normalizeQuality, qualityPresets, type QualityPreset } from './render-quality';
import { syncQualityUI } from './quality-settings';
import { settingsContent } from './music/settings';
import { SurfaceTransition, ContentTransition } from './ui-transitions';
import { DocumentDecryption } from './document-decryption';
import { InspectionOverlay } from './inspection-overlay';
import { createRollingClock } from './rolling-clock';
import { initPwa } from './pwa';
import { escapeHtml as esc } from './html';
import { MusicLibrary } from './music/library';
import { MusicPlayer } from './music/player';
import { PageLifecycle } from './music/lifecycle';
import { NeteasePanel } from './music/netease-panel';
import { setMusicCoverLoader } from './music/assets';
import { activeLyric, formatTime, matchesTrack, parseLrc } from './music/domain';
import { archiveColumns, columnFiles, fileLocation, musicColumns, musicTrack, records, setMusicCatalog } from './data';
import { wrap, type ArchiveNavigation } from './archive-loop';
import type { Collection, ImportItem, ImportProgress, LyricLine, PlaybackMode, Track } from './music/types';
import { isDesktop } from './desktop/detect';
import { exportBackup, mergeBackup, readBackup } from './music/backup';
import type { LibrarySnapshot } from './music/types';

const desktop = isDesktop ? new (await import('./desktop/host')).DesktopHost() : undefined;
let desktopHidden = false;
let pendingBackup: LibrarySnapshot | undefined;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
$('#stage').innerHTML = musicShell;
$('#boot-background').insertAdjacentHTML('beforeend', '<div class="boot-white"></div>');
$('.system-nav').innerHTML = `<button data-action="import" title="导入音乐">＋ <span>导入音乐</span></button><button data-action="search" title="搜索音乐 /">⌕ <span>MUSIC INDEX</span></button><button data-action="netease" title="网易云音乐" aria-label="网易云音乐，扫码登录">♫ <span>网易云</span></button><button data-action="playlists" title="管理歌单">≡ <span>歌单</span></button><button data-action="settings" class="settings-button" aria-label="系统设置"><span class="settings-glyph">◷</span><span class="settings-label">设置</span></button>`;
$('#stage').insertAdjacentHTML('beforeend', `
  <div class="collection-switch" role="group" aria-label="音乐库浏览方式"><button data-action="albums">专辑</button><i>／</i><button data-action="lists">歌单</button></div>
  <section id="empty-library" class="empty-library" hidden><span>LOCAL MUSIC / INITIALIZE</span><h2>你的音乐，等待归档。</h2><p>导入音乐文件或文件夹，让玻璃阵列成为你的音乐库。</p><button data-action="import">导入音乐 <span>↗</span></button><button data-action="netease">连接网易云 <span>↗</span></button><small>音频保留在原位置 · 支持 MP3 / FLAC / M4A / WAV / OGG</small></section>
  <div id="fallback-note" hidden>三维场景暂不可用，音乐仍可通过索引列表播放。<button data-action="search">打开音乐列表 ↗</button></div>`);
$('#viewport').insertAdjacentHTML('afterend', `
  <section id="player-bar" class="player-bar" aria-label="音乐播放控制">
    <button id="now-playing" class="now-playing" data-action="now"><div id="mini-cover" class="mini-cover" aria-hidden="true">∞</div><span><strong id="mini-title">尚未播放</strong><small id="mini-artist">RHINE LAB / LOCAL MUSIC</small></span></button>
    <div class="transport"><button data-action="player-prev" aria-label="上一首">Ⅰ◁</button><button data-action="toggle" id="play-toggle" aria-label="播放" class="play-toggle">▷</button><button data-action="player-next" aria-label="下一首">▷Ⅰ</button></div>
    <div class="progress-control"><span id="elapsed">0:00</span><input id="seek" type="range" min="0" max="1" step="0.1" value="0" aria-label="播放进度"><span id="duration">0:00</span></div>
    <button data-action="mode" id="play-mode" aria-label="播放模式">顺序</button><label class="volume-control"><span>VOL</span><input id="volume" type="range" min="0" max="1" step="0.01" value="0.75" aria-label="音量"></label><button data-action="queue" class="queue-button">队列 <span id="queue-count">00</span></button>
  </section>
  <div id="music-modal" class="music-modal" hidden><section class="music-panel" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><div><small id="modal-eyebrow">RHINE LAB / MUSIC INDEX</small><h2 id="modal-title"></h2></div><button data-action="close-modal" class="modal-close" aria-label="关闭弹窗">×</button></header><div id="modal-body"></div></section></div>
  <div id="import-progress" class="import-progress" hidden role="status"><span id="import-label"></span><progress id="import-meter" max="1" value="0"></progress><button data-action="cancel-import">取消</button></div>
  <input id="file-input" type="file" accept="audio/*,.flac,.m4a,.opus,.lrc" multiple hidden>
  <input id="folder-input" type="file" webkitdirectory multiple hidden>
  <input id="lyrics-input" type="file" accept=".lrc,text/plain" hidden>
  <input id="relink-input" type="file" accept="audio/*,.flac,.m4a,.opus" hidden>
  <input id="backup-input" type="file" accept=".json,application/json" hidden>
  <div id="music-toast" class="music-toast" role="status"></div>`);

const library = new MusicLibrary(desktop ? { files: desktop.files, fetch: desktop.fetch, login: desktop.login } : {});
let player: MusicPlayer;
let scene: ArchiveScene | undefined;
let viewer: ModelViewer | undefined;
let mode: 'boot' | 'archive' | 'detail' = 'boot';
let selected = 0, ready = false, started = false, bootStart = 0;
let activeTab: 'lyrics' | 'info' | 'collection' = 'lyrics';
let selectedTrackId: string | undefined;
let selectedCollectionId: string | undefined;
const columnMemory = new Map<string, string>();
const boot = new BootSequence($('#stage'));
const clock = createRollingClock($('#clock'));
let clockSecond = -1;
const audio = new TerminalAudio();
const inspection = new InspectionOverlay();
const documentReveal = new DocumentDecryption();
const detailTransition = new SurfaceTransition($('#detail-ui'), undefined, 180, 180);
const tabTransition = new ContentTransition();
const modalTransition = new SurfaceTransition($('#music-modal'), $('.music-panel'));
let modalType: 'search' | 'import' | 'settings' | 'playlists' | 'playlist' | 'add-playlist' | 'queue' | 'netease' | null = null;
let modalPlaylist: string | null = null;
let modalTrackId: string | null = null;
let previousFocus: HTMLElement | null = null;
let modalClosing = false;
let toastTimer: ReturnType<typeof setTimeout>;
let lyricsTarget: string | undefined;
let relinkTarget: string | undefined;
let detailCoverUrl: string | undefined;
let miniCoverUrl: string | undefined;
let miniCoverBlob: Blob | undefined;
let miniTrackId: string | undefined;
let lyricLines: LyricLine[] = [];
let lyricIndex = -2;
let searchQuery = '';
let detailAssetsAbort: AbortController | undefined;
let playbackAssetsAbort: AbortController | undefined;
const neteasePanel = new NeteasePanel(library, () => player, { open: (title, body) => openModal('netease', title, body), close: closeModal, show: showTrack, tell, active: () => modalType === 'netease' && !modalClosing && !lifecycle.closed });
setMusicCoverLoader((track, signal) => library.ensureCover(track, signal));
let lastFrame = 0;
const pageEvents = new AbortController();
const eventOptions = { signal: pageEvents.signal };
let pwaTimer: ReturnType<typeof setTimeout> | undefined;
const lifecycle = new PageLifecycle(frame, () => {
  ready = false; started = false;
  desktop?.dispose();
  pageEvents.abort(); clearTimeout(toastTimer); clearTimeout(pwaTimer);
  neteasePanel.cancel(); detailAssetsAbort?.abort(); playbackAssetsAbort?.abort(); setMusicCoverLoader();
  modalTransition.dispose(); detailTransition.dispose(); tabTransition.cancel();
  titleRolling.destroy(); artistRolling.destroy(); selectedNumber.destroy(); columnNumber.destroy(); clock.dispose();
  // Stop rendering first, detach audio callbacks, then release GPU resources.
  const positionChanged = player?.capturePosition();
  player?.dispose(); audio.dispose(); viewer?.dispose(); viewer = undefined;
  scene?.dispose(); scene = undefined;
  if (positionChanged) library.scheduleSave();
  library.dispose();
  if (miniCoverUrl) URL.revokeObjectURL(miniCoverUrl);
  if (detailCoverUrl) URL.revokeObjectURL(detailCoverUrl);
});
const prefs = () => library.snapshot.preferences;
const selectedTrack = () => musicTrack(selected);
const currentCollection = () => musicColumns[fileLocation(selected).lane];
const ease = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
function configureAudio() { audio.configure({ sound: prefs().sound, music: prefs().backgroundMusic && !player?.playing, soundVolume: prefs().soundVolume, musicVolume: .15 }); }
function tell(message: string) {
  if (lifecycle.closed) return;
  $('#music-toast').textContent = message; $('#music-toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#music-toast').classList.remove('visible'), 4500);
}
function fit() {
  if (lifecycle.closed) return;
  const viewport = $('#viewport'), stage = $('#stage'), coarse = matchMedia('(pointer: coarse)').matches;
  const layout = mode === 'boot' ? openingLayout(viewport.clientWidth, viewport.clientHeight) : viewportLayout(viewport.clientWidth, viewport.clientHeight, coarse);
  stage.style.width = `${layout.width}px`; stage.style.height = `${layout.height}px`;
  stage.style.transform = `translate(-50%, -50%) scale(${layout.scale})`;
  stage.dataset.layout = layout.kind; stage.dataset.touch = String(coarse);
  stage.style.setProperty('--stage-scale', String(layout.scale)); stage.style.setProperty('--opening-width', `${layout.width}px`); stage.style.setProperty('--opening-height', `${layout.height}px`);
  stage.style.setProperty('--opening-scan-scale', String(Math.min(1, layout.width / 1920))); stage.dataset.openingPortrait = String(layout.width < layout.height);
  scene?.resize(); viewer?.resize(); documentReveal.refresh();
}
function applyPreferences(immediate = false) {
  const preferences = prefs();
  $('#stage').dataset.reduced = String(preferences.reduced); document.documentElement.dataset.musicReduced = String(preferences.reduced);
  scene?.setTheme(preferences.theme === 'dark', immediate);
  if (!scene) paintTheme(preferences.theme === 'dark' ? 1 : 0);
  const quality = normalizeQuality(preferences.rendering || qualityPresets[preferences.quality]);
  scene?.setMotion(preferences.reduced ? reducedMotion() : fullMotion()); scene?.setQuality(quality); scene?.setCardStyle(preferences.cardStyle === 'cover');
  const cardToggle = $('#card-style-toggle');
  cardToggle.textContent = preferences.cardStyle === 'cover' ? '封面已显示 ✓' : '显示封面';
  cardToggle.setAttribute('aria-pressed', String(preferences.cardStyle === 'cover'));
  cardToggle.title = preferences.cardStyle === 'cover' ? '切回原双环内构' : '在玻璃卡片内显示歌曲封面';
  cardToggle.hidden = !scene;
  viewer?.setMotion(preferences.reduced ? reducedMotion() : fullMotion()); viewer?.setQuality(quality);
  configureAudio(); syncQualityUI(quality);
  titleRolling.update({ duration: preferences.reduced ? 0 : 460 }); artistRolling.update({ duration: preferences.reduced ? 0 : 460 });
  library.scheduleSave();
}
const titleRolling = createRollingText($('#selected-title'), { text: '等待导入音乐', duration: 460, transition: 'direct', stagger: 'none' });
const artistRolling = createRollingText($('#selected-clearance'), { text: 'LOCAL MUSIC', duration: 460, transition: 'direct', stagger: 'none' });
const selectedNumber = createRollingNumber($('#selected-number'), { value: 0, duration: 460, format: { minimumIntegerDigits: 2, useGrouping: false } });
const columnNumber = createRollingNumber($('#column-index'), { value: 0, duration: 460, format: { minimumIntegerDigits: 2, useGrouping: false } });

function syncCatalog() {
  const previousId = selectedTrackId, previousColumn = selectedCollectionId;
  setMusicCatalog(library.tracks, library.collections());
  selected = records.findIndex(record => record.id === previousId && record.category === previousColumn);
  if (selected < 0) selected = Math.max(0, records.findIndex(record => record.id === previousId));
  scene?.refreshCatalog(selected);
  if (mode === 'detail' && (!selectedTrack() || selectedTrack()?.id !== previousId)) setMode('archive');
  updateSelection();
  if (mode === 'detail') {
    const button = document.querySelector<HTMLButtonElement>('[data-action="favorite"]');
    if (button) { const favorite = library.snapshot.favorites.includes(selectedTrack()!.id); button.textContent = favorite ? '已收藏 ✓' : '＋ 收藏'; button.setAttribute('aria-pressed', String(favorite)); }
  }
  if (player) player.reconcile(new Set(library.tracks.map(track => track.id)));
}
function updateSelection() {
  const track = selectedTrack(), collection = currentCollection(), location = fileLocation(selected), files = columnFiles(location.lane);
  selectedTrackId = track?.id; selectedCollectionId = collection?.id;
  if (track && collection) columnMemory.set(collection.id, track.id);
  titleRolling.update({ text: track?.title || '等待导入音乐' }); artistRolling.update({ text: track?.artist || 'LOCAL MUSIC' });
  const instant = prefs().reduced;
  selectedNumber.update({ value: track ? files.indexOf(selected) + 1 : 0, duration: instant ? 0 : 460 });
  columnNumber.update({ value: track ? location.lane + 1 : 0, duration: instant ? 0 : 460 });
  $('#archive-category').textContent = collection?.kind === 'album' || !collection && prefs().collectionMode === 'albums' ? '专辑' : '歌单';
  $('#column-name').textContent = collection?.name || '本地音乐库';
  $('#column-number').lastChild!.textContent = ` / ${String(musicColumns.length).padStart(2, '0')}`;
  $('.count-total').textContent = String(track ? files.length : 0).padStart(2, '0');
  $('.tiny-label').textContent = 'TRACK / SELECT'; $('.read-file').innerHTML = 'ACCESS TRACK <span>→</span>';
  $('.archive-hint').innerHTML = '<kbd>←</kbd> <kbd>→</kbd> 切换专辑 / 歌单 <span>／</span> <kbd>↑</kbd> <kbd>↓</kbd> 浏览歌曲 <span>／</span> <kbd>ENTER</kbd> 读取';
  $('#empty-library').hidden = !!track || mode === 'boot'; $('#archive-ui').classList.toggle('music-empty', !track);
  $('#empty-library h2').textContent = library.tracks.length ? '这个视图还没有歌曲。' : '你的音乐，等待归档。';
  $('#empty-library p').textContent = library.tracks.length ? '切换专辑视图，或在歌单管理中添加歌曲。' : '导入音乐文件或文件夹，让玻璃阵列成为你的音乐库。';
  $('[data-action="albums"]').setAttribute('aria-pressed', String(prefs().collectionMode === 'albums'));
  $('[data-action="lists"]').setAttribute('aria-pressed', String(prefs().collectionMode === 'playlists'));
  $('#file-ticks').innerHTML = files.length <= 24 && track ? files.map((index, row) => `<button data-select="${index}" class="${index === selected ? 'selected' : ''}" aria-pressed="${index === selected}" aria-label="选择歌曲 ${esc(records[index].title)}" title="${esc(records[index].title)}"></button>`).join('') : track ? `<span class="many-tracks">${files.indexOf(selected) + 1} / ${files.length}</span>` : '';
  for (const button of document.querySelectorAll<HTMLButtonElement>('.archive-navigation button, .column-navigation button, .read-file, .file-title')) button.disabled = !track;
  if (!scene && library.tracks.length && modalType === 'search') renderSearchResults();
}
function setMode(next: typeof mode) {
  const previous = mode; if (next !== 'detail') detailAssetsAbort?.abort(); mode = next; $('#stage').dataset.mode = next; $('#stage').dataset.boot = next === 'boot' ? 'access' : 'done';
  $('#boot').inert = next !== 'boot'; $('#boot').setAttribute('aria-hidden', String(next !== 'boot'));
  $('#archive-ui').inert = next !== 'archive' || !!modalType; $('#detail-ui').inert = next !== 'detail' || !!modalType;
  $('.system-nav').inert = next === 'boot' || !!modalType; $('.collection-switch').inert = next === 'boot' || !!modalType;
  $('#player-bar').hidden = next === 'boot'; $('#empty-library').hidden = next === 'boot' || !!selectedTrack();
  document.documentElement.dataset.musicBoot = String(next === 'boot');
  if (next !== 'boot') { boot.reset(); $('#stage').style.setProperty('--entry-opacity', '1'); $('.callout-rule').style.transform = 'scaleX(1)'; }
  if (next === 'detail' && previous !== next) { renderDetail(); detailTransition.show(prefs().reduced); }
  else if (next !== 'detail' && previous === 'detail') detailTransition.hide(prefs().reduced);
  scene?.setMode(next === 'boot' ? 'hidden' : next); audio.setScene(next === 'boot' ? 'boot' : next);
  fit(); updateSelection();
}
function select(index: number, navigation?: ArchiveNavigation) {
  if (!musicTrack(index)) return;
  if (mode === 'detail') setMode('archive');
  selected = index; scene?.select(index, navigation); activeTab = 'lyrics'; updateSelection(); audio.play(navigation && 'axis' in navigation && navigation.axis === 'lane' ? 'column' : 'tick');
}
function stepFile(direction: number) {
  const files = columnFiles(fileLocation(selected).lane); if (!selectedTrack() || files.length < 2) return;
  select(files[wrap(files.indexOf(selected) + direction, files.length)], { axis: 'row', direction });
}
function stepColumn(direction: number) {
  if (!selectedTrack() || archiveColumns.length < 2) return;
  const lane = wrap(fileLocation(selected).lane + direction, archiveColumns.length), collection = musicColumns[lane], files = columnFiles(lane);
  const remembered = columnMemory.get(collection.id); select(files.find(index => records[index].id === remembered) ?? files[0], { axis: 'lane', direction });
}
function openTrack() { if (selectedTrack()) { setMode('detail'); audio.play('open'); } }
function showTrack(id: string) {
  let index = records.findIndex(record => record.id === id);
  if (index < 0) { prefs().collectionMode = 'albums'; syncCatalog(); index = records.findIndex(record => record.id === id); }
  if (index >= 0) { select(index); openTrack(); }
}
function trackRow(track: Track, context: 'search' | 'queue' | 'playlist' | 'cloud', index: number, entryId?: string) {
  const current = player?.currentTrack?.id === track.id;
  return `<div class="music-row ${current ? 'is-playing' : ''}" data-track-row="${esc(track.id)}"><span class="row-index">${String(index + 1).padStart(2, '0')}</span><button class="row-track" data-action="${context === 'queue' ? 'play-entry' : 'show-track'}" data-id="${esc(entryId || track.id)}"><strong>${esc(track.title)}</strong><small>${esc(track.artist)} <i>／</i> ${esc(track.album || track.folder)}</small></button><span class="row-duration">${formatTime(track.duration)}</span><div class="row-actions">${context === 'cloud' ? `<button data-action="cloud-list-play" data-id="${esc(track.id)}" aria-label="播放 ${esc(track.title)}">▷</button>` : context === 'search' ? `<button data-action="row-play" data-id="${esc(track.id)}" title="播放" aria-label="播放 ${esc(track.title)}">▷</button><button data-action="row-next" data-id="${esc(track.id)}" title="下一首播放">＋</button><button data-action="row-add" data-id="${esc(track.id)}" title="加入歌单">≡</button><button data-action="row-remove" data-id="${esc(track.id)}" title="从库移除，不删除文件">×</button>` : `<button data-action="${context}-up" data-id="${esc(entryId || track.id)}" aria-label="上移">↑</button><button data-action="${context}-down" data-id="${esc(entryId || track.id)}" aria-label="下移">↓</button><button data-action="${context}-remove" data-id="${esc(entryId || track.id)}" aria-label="移除">×</button>`}</div></div>`;
}
function renderDetail() {
  const track = selectedTrack(); if (!track) return;
  detailAssetsAbort?.abort(); detailAssetsAbort = new AbortController();
  loadTrackAssets(track, detailAssetsAbort.signal);
  if (detailCoverUrl) URL.revokeObjectURL(detailCoverUrl);
  detailCoverUrl = track.cover ? URL.createObjectURL(track.cover) : undefined;
  $('#object-id').textContent = `NO.${String(selected + 1).padStart(3, '0')}`;
  $('.object-caption small').innerHTML = 'DRAG TO INSPECT <span>↔</span>';
  $('.viewer-open').innerHTML = '360° 查看歌曲卡片 <span>↗</span>'; $('.viewer-open').hidden = !scene;
  const favorite = library.snapshot.favorites.includes(track.id);
  $('#detail-content').innerHTML = `<div class="detail-kicker">${track.providerId === 'netease' ? 'NETEASE CLOUD MUSIC' : 'LOCAL MUSIC'} <span>${esc(track.format)}</span></div><div class="song-heading"><div class="song-art">${detailCoverUrl ? `<img src="${detailCoverUrl}" alt="${esc(track.title)} 的封面">` : '<span>∞</span>'}</div><div><h2>${esc(track.title)}</h2><div class="detail-title-cn">${esc(track.artist)}</div><p>${esc(track.album || track.folder)}</p></div></div><dl class="metadata"><div><dt>DURATION / 时长</dt><dd>${formatTime(track.duration)}</dd></div><div><dt>COLLECTION / 当前列</dt><dd>${esc(currentCollection()?.name || '')}</dd></div><div><dt>SOURCE / 来源</dt><dd>${track.providerId === 'netease' ? esc(track.playbackNotice || '网易云在线歌曲') : `本地文件 · ${track.availability === 'temporary' ? '本次打开有效' : track.availability === 'ready' ? '可读取' : '需要恢复访问'}`}</dd></div><div><dt>ARTIST / 歌手</dt><dd>${esc(track.artist)}</dd></div></dl><div class="song-actions"><button class="primary-action" data-action="play-selected">▷ 播放歌曲</button><button data-action="favorite" aria-pressed="${favorite}">${favorite ? '已收藏 ✓' : '＋ 收藏'}</button><button data-action="add-playlist">加入歌单</button><button data-action="enqueue">加入队列</button></div><nav class="detail-tabs" role="tablist" aria-label="歌曲详情"><button data-tab="lyrics" role="tab">01 歌词</button><button data-tab="info" role="tab">02 歌曲信息</button><button data-tab="collection" role="tab">03 当前专辑 / 歌单</button></nav><section id="tab-panel" class="tab-panel song-tab-panel" role="tabpanel"></section>`;
  renderTab(); documentReveal.reset($('#detail-content'), prefs().reduced);
}
function renderTab() {
  const track = selectedTrack(); if (!track) return;
  for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) { const active = tab.dataset.tab === activeTab; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; }
  const panel = $('#tab-panel'); panel.setAttribute('aria-label', activeTab === 'lyrics' ? '歌词' : activeTab === 'info' ? '歌曲信息' : '当前专辑或歌单');
  lyricLines = parseLrc(track.lyrics || ''); lyricIndex = -2;
  if (activeTab === 'lyrics') {
    panel.innerHTML = `<div class="lyric-tools"><span>LYRICS / 歌词</span>${track.providerId === 'netease' ? '<button data-action="retry-cloud-lyrics">获取歌词 ↻</button>' : ''}<button data-action="attach-lyrics">关联 LRC ↗</button></div><div class="lyrics-scroll">${lyricLines.length ? lyricLines.map((line, index) => `<button class="lyric-line" data-lyric="${index}">${esc(line.text || '♪')}</button>`).join('') : `<div class="lyric-empty"><strong>${track.lyrics ? '歌词没有时间标签' : '还没有歌词'}</strong><p>${track.lyrics ? esc(track.lyrics.replace(/\[[^\]]*\]/g, '').slice(0, 6000)).replace(/\n/g, '<br>') : track.providerId === 'netease' ? (track.lyrics === undefined ? '正在获取网易云歌词，可点击重试；也可关联本地 LRC。' : '网易云未提供歌词，可关联本地 LRC。') : '导入同名 LRC 文件，或手动关联歌词。'}</p></div>`}</div>`;
    updateLyrics(true);
  } else if (activeTab === 'info') {
    if (track.providerId === 'netease') { panel.innerHTML = `<dl class="track-info"><dt>来源</dt><dd>网易云音乐</dd><dt>歌曲 ID</dt><dd>${esc(track.sourceId)}</dd><dt>专辑</dt><dd>${esc(track.album)}</dd><dt>状态</dt><dd>${esc(track.playbackNotice || '播放时按当前账号权限获取音频')}</dd></dl><div class="info-actions"><button data-action="netease">网易云连接 ↗</button><button data-action="remove-selected">从库移除</button></div><p class="help-note">音频通过网易云地址直接播放。移除索引不修改网易云歌单。</p>`; tabTransition.reveal(panel, prefs().reduced); return; }
    panel.innerHTML = `<dl class="track-info"><dt>文件</dt><dd>${esc(track.fileName)}</dd><dt>目录</dt><dd>${esc(track.folder)}</dd><dt>格式</dt><dd>${esc(track.format)}</dd><dt>曲序</dt><dd>${track.trackNumber || '—'}</dd><dt>大小</dt><dd>${(track.size / 1048576).toFixed(2)} MB</dd></dl><div class="info-actions"><button data-action="restore-access">恢复访问 ↗</button><button data-action="relink">重新关联文件 ↗</button><button data-action="remove-selected">从库移除</button></div><p class="help-note">文件始终保留在原位置。从库中移除不会删除磁盘文件。</p>`;
  } else {
    const collection = currentCollection(); panel.innerHTML = `<div class="lyric-tools"><span>${esc(collection?.name || '')}</span><button data-action="play-collection">播放全部 ▷</button></div><div class="collection-tracks">${(collection?.trackIds || []).map((id, index) => { const song = library.track(id)!; return `<button data-action="detail-row-play" data-id="${esc(id)}" class="collection-track"><span>${String(index + 1).padStart(2, '0')}</span><strong>${esc(song.title)}</strong><small>${formatTime(song.duration)}</small></button>`; }).join('')}</div>`;
  }
  tabTransition.reveal(panel, prefs().reduced);
}
function loadTrackAssets(track: Track, signal: AbortSignal) {
  if (track.providerId !== 'netease') return;
  void library.ensureCover(track, signal).catch(() => {});
  void library.ensureLyrics(track, signal).catch(error => { if (!signal.aborted && !lifecycle.closed && mode === 'detail' && selectedTrack()?.id === track.id) tell(error.message); });
}
function updateLyrics(force = false) {
  if (mode !== 'detail' || activeTab !== 'lyrics' || !lyricLines.length) return;
  const time = player?.currentTrack?.id === selectedTrack()?.id ? player.state.position : 0;
  const index = activeLyric(lyricLines, time); if (index === lyricIndex && !force) return;
  lyricIndex = index;
  const container = document.querySelector<HTMLElement>('.lyrics-scroll'); if (!container) return;
  for (const [i, line] of [...container.querySelectorAll<HTMLElement>('.lyric-line')].entries()) { line.classList.toggle('current', i === index); line.setAttribute('aria-current', i === index ? 'true' : 'false'); }
  const active = container.querySelector<HTMLElement>('.current');
  if (active) container.scrollTo({ top: active.offsetTop - container.offsetTop - container.clientHeight / 2 + active.clientHeight / 2, behavior: prefs().reduced ? 'instant' : 'smooth' });
}

function openModal(type: NonNullable<typeof modalType>, title: string, body: string) {
  if (type !== 'netease') neteasePanel.cancel();
  if (!modalType && !modalClosing) previousFocus = document.activeElement as HTMLElement;
  modalClosing = false; modalType = type; $('#modal-title').textContent = title; $('#modal-body').innerHTML = body;
  $('#stage').inert = true; $('#player-bar').inert = true; modalTransition.show(prefs().reduced); audio.play('page-open');
  requestAnimationFrame(() => { if (!lifecycle.closed) ($('#modal-body').querySelector<HTMLElement>('input:not([type="hidden"]),button,select') || $('.modal-close')).focus(); });
}
function closeModal(after?: () => void) {
  neteasePanel.cancel();
  if (!modalType && !modalClosing) { after?.(); return; }
  modalClosing = true; modalTransition.hide(prefs().reduced, () => {
    modalType = null; modalClosing = false; $('#stage').inert = false; $('#player-bar').inert = false;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); after?.();
  }); audio.play('page-close');
}
function importModal() {
  if (desktop) { openModal('import', '归档你的音乐', '<p class="panel-intro">选择音乐文件或整个文件夹，也可以把文件或文件夹拖入窗口。保存文件位置，音频保留在原目录。</p><div class="import-options"><button data-action="choose-files"><strong>选择音乐与 LRC ↗</strong></button><button data-action="choose-folder"><strong>扫描音乐文件夹 ↗</strong></button></div><p class="help-note">文件移动或磁盘离线时保留音乐索引，重新关联原文件即可恢复。迁移来的歌曲也可以通过重新选择原目录恢复。</p>'); return; }
  openModal('import', '归档你的音乐', `<p class="panel-intro">选择音乐文件或整个文件夹，也可以把文件拖入窗口。音频在本机读取。</p><div class="import-options"><button data-action="choose-files"><span>01 / FILES</span><strong>选择音乐文件 ↗</strong><small>支持同时选择歌曲和 LRC</small></button><button data-action="choose-folder"><span>02 / DIRECTORY</span><strong>导入音乐文件夹 ↗</strong><small>扫描子目录，记住文件位置</small></button></div><p class="help-note">Chrome / Edge 可保存文件访问句柄；重新打开时可能需要恢复读取权限。普通文件选择和拖入文件在不支持句柄的浏览器中仅本次打开有效。</p><button data-action="choose-temporary">兼容导入（本次打开） ↗</button>`);
}
function searchModal() {
  openModal('search', '音乐索引', `<div class="search-field"><span>⌕</span><input id="music-search" placeholder="搜索歌曲、歌手、专辑或文件名" value="${esc(searchQuery)}" autocomplete="off" aria-label="搜索音乐"><span id="search-count"></span></div><div id="search-results" class="music-results"></div>`);
  renderSearchResults();
}
function renderSearchResults() {
  if (!document.querySelector('#search-results')) return;
  const tracks = library.tracks.filter(track => matchesTrack(track, searchQuery));
  $('#search-count').textContent = `${tracks.length} TRACKS`;
  $('#search-results').innerHTML = tracks.length ? tracks.map((track, index) => trackRow(track, 'search', index)).join('') : '<div class="panel-empty">没有匹配的歌曲。<button data-action="import">导入音乐 ↗</button></div>';
}
function playlistsModal() {
  const lists = library.snapshot.playlists;
  openModal('playlists', '歌单管理', `<div class="playlist-toolbar"><span>本地歌单与同步的网易云歌单</span><button data-action="cloud-playlists">读取网易云歌单 ↓</button></div><form id="create-playlist" class="playlist-form"><input name="name" placeholder="新歌单名称" maxlength="80" aria-label="新歌单名称" required><button class="primary-action" type="submit">＋ 新建歌单</button></form><div class="music-results">${lists.length ? lists.map((list, index) => `<button class="playlist-card" data-action="edit-playlist" data-id="${esc(list.id)}"><span>${String(index + 1).padStart(2, '0')}</span><strong>${esc(list.name)}</strong><small>${list.readOnly ? '网易云 · ' : ''}${list.trackIds.length} TRACKS</small><b>↗</b></button>`).join('') : '<div class="panel-empty">创建一个歌单，成为阵列中的新一列。</div>'}</div>`);
}
function playlistModal(id: string) {
  const list = library.snapshot.playlists.find(list => list.id === id); if (!list) { playlistsModal(); return; }
  modalPlaylist = id;
  if (list.readOnly) { openModal('playlist', list.name, `<p class="help-note">网易云歌单 · 本地只读索引${list.accountId !== String(library.netease.account?.uid) ? ' · 请连接原账号后同步' : ''}</p><div class="playlist-toolbar"><button data-action="sync-cloud-playlist" ${list.accountId !== String(library.netease.account?.uid) ? 'disabled' : ''}>重新同步 ↻</button><button data-action="copy-cloud-playlist">复制为本地歌单</button><button data-action="browse-playlist">在阵列中浏览 ↗</button><button data-action="playlist-play">播放全部 ▷</button><button data-action="delete-playlist">移除本地索引</button></div><div class="music-results">${list.trackIds.map((trackId, index) => { const track = library.track(trackId); return track ? trackRow(track, 'cloud', index) : ''; }).join('') || '<p class="panel-empty">这个歌单没有可读取的歌曲。</p>'}</div>`); return; }
  openModal('playlist', list.name, `<form id="rename-playlist" class="playlist-form"><input name="name" value="${esc(list.name)}" maxlength="80" aria-label="歌单名称" required><button type="submit">保存名称</button><button type="button" data-action="delete-playlist">删除歌单</button></form><div class="playlist-toolbar"><button data-action="playlist-add-songs">＋ 添加歌曲</button><button data-action="browse-playlist">在阵列中浏览 ↗</button><button data-action="playlist-play">播放全部 ▷</button></div><div class="music-results">${list.trackIds.length ? list.trackIds.map((trackId, index) => trackRow(library.track(trackId)!, 'playlist', index)).join('') : '<div class="panel-empty">这个歌单还没有歌曲。点击添加歌曲开始归档。</div>'}</div>`);
}
function addPlaylistModal(trackId: string) {
  modalTrackId = trackId;
  openModal('add-playlist', '加入歌单', `<form id="create-and-add" class="playlist-form"><input name="name" placeholder="新歌单名称" maxlength="80" aria-label="新歌单名称" required><button type="submit">新建并加入</button></form><div class="music-results">${library.snapshot.playlists.filter(list => !list.readOnly).map(list => `<button class="playlist-card" data-action="add-to-list" data-id="${esc(list.id)}"><strong>${esc(list.name)}</strong><small>${list.trackIds.length} TRACKS</small><b>＋</b></button>`).join('') || '<div class="panel-empty">先创建一个歌单。</div>'}</div>`);
}
function queueModal() {
  openModal('queue', '播放队列', `<div class="playlist-toolbar"><span>${player.state.queue.length} TRACKS</span><button data-action="clear-queue">清空队列</button></div><div class="music-results">${player.state.queue.length ? player.state.queue.map((entry, index) => { const track = library.track(entry.trackId); return track ? trackRow(track, 'queue', index, entry.id) : ''; }).join('') : '<div class="panel-empty">选择一首歌曲播放，或将歌曲加入队列。</div>'}</div>`);
}
function settingsModal() {
  const p = prefs();
  openModal('settings', '系统设置', settingsContent(p));
}
async function downloadBackup(value: unknown, name = 'rhine-music-backup') {
  const json = JSON.stringify(value), filename = `${name}-${new Date().toISOString().slice(0, 10)}.json`;
  if (desktop) { await desktop.saveBackup(json, filename); return; }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function updatePlayer() {
  if (!player) return;
  configureAudio();
  const track = player.currentTrack;
  if (miniTrackId !== track?.id) { playbackAssetsAbort?.abort(); playbackAssetsAbort = new AbortController(); if (track) loadTrackAssets(track, playbackAssetsAbort.signal); }
  $('#mini-title').textContent = track?.title || '尚未播放'; $('#mini-artist').textContent = track?.artist || 'RHINE LAB / LOCAL MUSIC';
  if (miniTrackId !== track?.id || miniCoverBlob !== track?.cover) {
    miniTrackId = track?.id; miniCoverBlob = track?.cover; if (miniCoverUrl) URL.revokeObjectURL(miniCoverUrl);
    miniCoverUrl = track?.cover ? URL.createObjectURL(track.cover) : undefined; $('#mini-cover').innerHTML = miniCoverUrl ? `<img src="${miniCoverUrl}" alt="">` : '∞';
  }
  $('#play-toggle').textContent = player.busy ? '·' : player.playing ? 'Ⅱ' : '▷'; $('#play-toggle').setAttribute('aria-label', player.playing || player.busy && player.wantsPlayback ? '暂停' : '播放');
  $('#queue-count').textContent = String(player.state.queue.length).padStart(2, '0');
  const labels: Record<PlaybackMode, string> = { sequence: '顺序', 'repeat-all': '列表循环', 'repeat-one': '单曲循环', shuffle: '随机' };
  $('#play-mode').textContent = labels[player.state.mode]; $('#play-mode').setAttribute('aria-label', `播放模式：${labels[player.state.mode]}`);
  $('#play-mode').title = '点击切换播放模式'; $<HTMLInputElement>('#volume').value = String(player.state.volume);
  updateTime();
}
function updateTime() {
  if (!player) return;
  $('#elapsed').textContent = formatTime(player.state.position); $('#duration').textContent = formatTime(player.duration);
  const seek = $<HTMLInputElement>('#seek'); if (document.activeElement !== seek) { seek.max = String(player.duration || 1); seek.value = String(player.state.position); }
  seek.disabled = !player.currentTrack; updateLyrics();
}
async function playSelected() {
  const track = selectedTrack(), collection = currentCollection(); if (track) await player.playQueue(collection?.trackIds || [track.id], track.id);
}
async function runAction(button: HTMLElement) {
  const action = button.dataset.action, id = button.dataset.id;
  if (!ready && !['skip', 'close-modal'].includes(action || '')) return;
  if (action === 'skip') { if (ready) setMode('archive'); return; }
  if (action === 'close-modal') { closeModal(); return; }
  if (action === 'netease') { neteasePanel.open(); return; }
  if (action === 'cloud-list-play' && id && modalPlaylist) { const list = library.snapshot.playlists.find(list => list.id === modalPlaylist); if (list) await player.playQueue(list.trackIds, id); return; }
  if (action?.startsWith('cloud-')) { await neteasePanel.action(action, id); return; }
  if (action === 'sync-cloud-playlist' && modalPlaylist) { const list = library.snapshot.playlists.find(list => list.id === modalPlaylist); if (list?.sourceId) await neteasePanel.importPlaylist(list.sourceId); return; }
  if (action === 'copy-cloud-playlist' && modalPlaylist) { const source = library.snapshot.playlists.find(list => list.id === modalPlaylist); if (source) { const copy = library.createPlaylist(`${source.name}（本地副本）`); library.addToPlaylist(copy.id, source.trackIds); playlistModal(copy.id); tell('已复制为可编辑的本地歌单'); } return; }
  if (action === 'retry-cloud-lyrics') { const track = selectedTrack(); if (track && detailAssetsAbort) { await library.ensureLyrics(track, detailAssetsAbort.signal); renderTab(); } return; }
  if (action === 'import') { importModal(); return; }
  if (action === 'search') { searchModal(); return; }
  if (action === 'settings') { settingsModal(); return; }
  if (action === 'backup-export') { player.capturePosition(); await downloadBackup(await exportBackup(library.snapshot)); return; }
  if (action === 'backup-previous') { const value = await library.previousImportBackup(); if (value) await downloadBackup(value, 'rhine-music-before-import'); else tell('尚无导入前的资料备份'); return; }
  if (action === 'backup-import') { $('#backup-input').click(); return; }
  if (action === 'backup-apply' && pendingBackup) {
    if (library.importing) throw new Error('请等待音乐导入完成后再迁移资料');
    player.capturePosition(); const previous = await exportBackup(library.snapshot);
    await library.protectImport(previous);
    const merged = mergeBackup(library.snapshot, pendingBackup, $<HTMLInputElement>('#backup-overwrite').checked);
    player.stop(); await library.restoreBackup(merged); pendingBackup = undefined;
    player.setVolume(library.snapshot.playback.volume); applyPreferences(true);
    await desktop?.setCloseToTray(prefs().closeToTray !== false);
    await player.restore(); closeModal(); tell('资料已合并，队列保持暂停。本地歌曲请重新选择原目录关联。'); return;
  }
  if (action === 'card-style') { prefs().cardStyle = prefs().cardStyle === 'cover' ? 'original' : 'cover'; applyPreferences(); tell(prefs().cardStyle === 'cover' ? '已切换封面卡片' : '已切换原双环内构'); return; }
  if (action === 'playlists') { playlistsModal(); return; }
  if (action === 'queue') { queueModal(); return; }
  if (action === 'choose-files') { if (!desktop && !(window as Window & { showOpenFilePicker?: unknown }).showOpenFilePicker) $('#file-input').click(); else { closeModal(); await library.chooseFiles(); } return; }
  if (action === 'choose-temporary') { $('#file-input').click(); return; }
  if (action === 'choose-folder') { if (!desktop && !(window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker) $('#folder-input').click(); else { closeModal(); await library.chooseDirectory(); } return; }
  if (action === 'cancel-import') { library.cancelImport(); return; }
  if (action === 'albums' || action === 'lists') { prefs().collectionMode = action === 'albums' ? 'albums' : 'playlists'; if (mode === 'detail') setMode('archive'); syncCatalog(); library.scheduleSave(); return; }
  if (action === 'open') { openTrack(); return; }
  if (action === 'back') { setMode('archive'); audio.play('back'); return; }
  if (action === 'prev' || action === 'next') { stepFile(action === 'prev' ? -1 : 1); return; }
  if (action === 'column-prev' || action === 'column-next') { stepColumn(action === 'column-prev' ? -1 : 1); return; }
  if (action === 'toggle') { if (player.currentTrack || player.state.queue.length) await player.toggle(); else await playSelected(); return; }
  if (action === 'player-prev' || action === 'player-next') { await player.advance(action === 'player-prev' ? -1 : 1); return; }
  if (action === 'play-selected' || action === 'play-collection') { await playSelected(); return; }
  if (action === 'mode') { const modes: PlaybackMode[] = ['sequence', 'repeat-all', 'repeat-one', 'shuffle']; player.setMode(modes[(modes.indexOf(player.state.mode) + 1) % modes.length]); return; }
  if (action === 'now') { if (player.currentTrack) showTrack(player.currentTrack.id); return; }
  if (action === 'favorite') { const track = selectedTrack(); if (track) library.favorite(track.id); return; }
  if (action === 'enqueue') { const track = selectedTrack(); if (track) { player.enqueue(track.id); tell('已加入播放队列'); } return; }
  if (action === 'add-playlist') { if (selectedTrack()) addPlaylistModal(selectedTrack()!.id); return; }
  if (action === 'attach-lyrics') { lyricsTarget = selectedTrack()?.id; if (desktop) { const text = await desktop.chooseLyrics(); if (text !== undefined && lyricsTarget) { library.setLyrics(lyricsTarget, text); renderDetail(); } } else $('#lyrics-input').click(); return; }
  if (action === 'restore-access') { const track = selectedTrack(); if (track) tell(await library.restoreAccess(track) ? '文件读取访问已恢复' : '访问未恢复，请重新关联文件'); return; }
  if (action === 'relink') {
    relinkTarget = selectedTrack()?.id; if (!relinkTarget) return;
    if (desktop) { const items = await desktop.files.choose(false); const item = items.find(item => !/\.lrc$/i.test(item.file.name)); if (item) { await library.relinkDesktop(relinkTarget, item); renderDetail(); tell('文件已重新关联'); } return; }
    const picker = (window as Window & { showOpenFilePicker?: (options: object) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker;
    if (picker) { const [handle] = await picker({ multiple: false }); await library.relink(relinkTarget, await handle.getFile(), handle); renderDetail(); tell('文件已重新关联'); } else $('#relink-input').click(); return;
  }
  if (action === 'remove-selected') { if (selectedTrack()) { const trackId = selectedTrack()!.id; if (player.currentTrack?.id === trackId) player.stop(); library.removeTrack(trackId); setMode('archive'); tell('已从音乐库移除，磁盘文件保留'); } return; }
  if (action === 'show-track' && id) { closeModal(() => showTrack(id)); return; }
  if ((action === 'row-play' || action === 'detail-row-play') && id) { const collection = action === 'detail-row-play' ? currentCollection()?.trackIds : library.tracks.filter(track => matchesTrack(track, searchQuery)).map(track => track.id); await player.playQueue(collection || [id], id); return; }
  if (action === 'row-next' && id) { player.enqueue(id, true); tell('已加入下一首播放'); return; }
  if (action === 'row-add' && id) { addPlaylistModal(id); return; }
  if (action === 'row-remove' && id) { if (player.currentTrack?.id === id) player.stop(); library.removeTrack(id); renderSearchResults(); tell('已从音乐库移除，磁盘文件保留'); return; }
  if (action === 'edit-playlist' && id) { playlistModal(id); return; }
  if (action === 'add-to-list' && id && modalTrackId) { library.addToPlaylist(id, [modalTrackId]); tell('已加入歌单'); closeModal(); return; }
  if (action === 'delete-playlist' && modalPlaylist) { library.deletePlaylist(modalPlaylist); playlistsModal(); return; }
  if (action === 'playlist-up' || action === 'playlist-down' || action === 'playlist-remove') { if (modalPlaylist && id) { action === 'playlist-remove' ? library.removeFromPlaylist(modalPlaylist, id) : library.moveInPlaylist(modalPlaylist, id, action === 'playlist-up' ? -1 : 1); playlistModal(modalPlaylist); } return; }
  if (action === 'playlist-add-songs' && modalPlaylist) {
    const list = library.snapshot.playlists.find(list => list.id === modalPlaylist)!;
    $('#modal-body').innerHTML = `<form id="add-songs"><div class="playlist-toolbar"><span>选择要加入的歌曲</span><button type="submit" class="primary-action">加入歌单</button></div><div class="music-results">${library.tracks.map(track => `<label class="song-choice"><input name="track" type="checkbox" value="${esc(track.id)}" ${list.trackIds.includes(track.id) ? 'disabled checked' : ''}><span><strong>${esc(track.title)}</strong><small>${esc(track.artist)}</small></span></label>`).join('') || '<p>请先导入音乐。</p>'}</div></form>`; return;
  }
  if (action === 'browse-playlist' && modalPlaylist) {
    const target = modalPlaylist, list = library.snapshot.playlists.find(list => list.id === target);
    if (!list?.trackIds.length) { tell('先为这个歌单添加歌曲'); return; }
    closeModal(() => { prefs().collectionMode = 'playlists'; selectedCollectionId = target; selectedTrackId = list.trackIds[0]; syncCatalog(); setMode('archive'); scene?.select(selected); }); return;
  }
  if (action === 'playlist-play' && modalPlaylist) { const list = library.snapshot.playlists.find(list => list.id === modalPlaylist); if (list?.trackIds.length) await player.playQueue(list.trackIds, list.trackIds[0]); return; }
  if (action === 'play-entry' && id) { await player.playEntry(id); return; }
  if (action === 'queue-up' || action === 'queue-down' || action === 'queue-remove') { if (id) { action === 'queue-remove' ? player.removeEntry(id) : player.moveEntry(id, action === 'queue-up' ? -1 : 1); queueModal(); } return; }
  if (action === 'clear-queue') { player.clearQueue(); queueModal(); return; }
  if (action === 'replay') { closeModal(() => { audio.restartBoot(); bootStart = performance.now() / 1000 - 1.76; setMode('boot'); }); return; }
  if (action === 'full-screen') { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); return; }
  if (action === 'model-viewer' && scene && selectedTrack()) {
    viewer ??= new ModelViewer($('#stage'), () => { audio.setScene('detail'); }, sound => audio.play(sound));
    viewer.setMotion(prefs().reduced ? reducedMotion() : fullMotion()); viewer.setQuality(normalizeQuality(prefs().rendering || qualityPresets[prefs().quality]));
    viewer.open(`NO.${String(selected + 1).padStart(3, '0')}`, selectedTrack()!.title, () => scene!.createAssemblyModel(), prefs().reduced); audio.setScene('viewer');
  }
}
document.addEventListener('click', event => {
  const target = event.target as Element;
  if (modalClosing) return;
  const button = target.closest<HTMLElement>('[data-action]');
  if (button) { void runAction(button).catch(error => { if (!(error instanceof DOMException && error.name === 'AbortError')) tell(error instanceof Error ? error.message : '操作失败'); }); return; }
  const selectedButton = target.closest<HTMLElement>('[data-select]'); if (selectedButton && !modalType) select(Number(selectedButton.dataset.select));
  const tab = target.closest<HTMLElement>('[data-tab]'); if (tab) { activeTab = tab.dataset.tab as typeof activeTab; renderTab(); }
  const line = target.closest<HTMLElement>('[data-lyric]'); if (line && player.currentTrack?.id === selectedTrack()?.id) player.seek(lyricLines[Number(line.dataset.lyric)].time);
  if (target === $('#music-modal')) closeModal();
}, eventOptions);
document.addEventListener('submit', event => {
  if ((event.target as HTMLFormElement).id === 'cloud-search-form') { event.preventDefault(); const query = String(new FormData(event.target as HTMLFormElement).get('query') || ''); void neteasePanel.search(query).catch(error => tell(error.message)); return; }
  const form = event.target as HTMLFormElement; if (!['create-playlist', 'rename-playlist', 'create-and-add', 'add-songs'].includes(form.id)) return;
  event.preventDefault(); const data = new FormData(form), name = String(data.get('name') || '').trim();
  if (form.id === 'create-playlist') { if (name) playlistModal(library.createPlaylist(name).id); }
  if (form.id === 'rename-playlist' && modalPlaylist && name) { library.renamePlaylist(modalPlaylist, name); playlistModal(modalPlaylist); }
  if (form.id === 'create-and-add' && name && modalTrackId) { const list = library.createPlaylist(name); library.addToPlaylist(list.id, [modalTrackId]); tell('已创建歌单并加入歌曲'); closeModal(); }
  if (form.id === 'add-songs' && modalPlaylist) { library.addToPlaylist(modalPlaylist, data.getAll('track').map(String)); playlistModal(modalPlaylist); }
}, eventOptions);
document.addEventListener('input', event => {
  const input = event.target as HTMLInputElement;
  if (input.id === 'music-search') { searchQuery = input.value; renderSearchResults(); }
  if (input.id === 'seek' && player) { $('#elapsed').textContent = formatTime(Number(input.value)); }
  if (input.id === 'volume' && player) player.setVolume(Number(input.value));
}, eventOptions);
document.addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  if (input.id === 'seek') player.seek(Number(input.value));
  if (input.dataset.preference) {
    const preference = input.dataset.preference as keyof ReturnType<typeof prefs>;
    (prefs() as unknown as Record<string, unknown>)[preference] = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
    applyPreferences(); tell('设置已保存');
    if (preference === 'closeToTray') void desktop?.setCloseToTray(prefs().closeToTray !== false);
  }
  if (input.id === 'remember-login') library.netease.setRememberLogin(input.checked);
  if (input.id === 'quality-preset' && Object.hasOwn(qualityPresets, input.value)) {
    prefs().quality = input.value as QualityPreset; prefs().rendering = { ...qualityPresets[prefs().quality] }; applyPreferences();
  } else if (input.dataset.quality) {
    const key = input.dataset.quality;
    prefs().rendering = normalizeQuality({ ...(prefs().rendering || qualityPresets[prefs().quality]), [key]: key === 'antialias' ? input.value : Number(input.value) }); applyPreferences();
  }
}, eventOptions);
document.addEventListener('keydown', event => {
  if (!started || viewer?.isOpen) return;
  if (modalType || modalClosing) {
    if (event.key === 'Escape') { event.preventDefault(); if (!modalClosing) closeModal(); }
    if (event.key === 'Tab') {
      const nodes = [...$('.music-panel').querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select,a[href]')].filter(node => node.getClientRects().length > 0);
      const index = nodes.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); nodes.at(-1)?.focus(); } else if (!event.shiftKey && index === nodes.length - 1) { event.preventDefault(); nodes[0]?.focus(); }
    } return;
  }
  const target = event.target as HTMLElement;
  if (target.matches('input,textarea,select') || target.isContentEditable) return;
  if (event.key === 'Escape') { if (mode === 'boot') setMode('archive'); else if (mode === 'detail') setMode('archive'); return; }
  if (mode === 'boot') { if (event.key === 'Enter') { event.preventDefault(); setMode('archive'); } return; }
  if (event.key === '/') { event.preventDefault(); searchModal(); return; }
  if (event.code === 'Space' && target.tagName !== 'BUTTON') { event.preventDefault(); void (player.currentTrack ? player.toggle() : playSelected()); return; }
  if (mode === 'archive') {
    const directions: Record<string, () => void> = { ArrowLeft: () => stepColumn(-1), ArrowRight: () => stepColumn(1), ArrowUp: () => stepFile(-1), ArrowDown: () => stepFile(1) };
    if (directions[event.key]) { event.preventDefault(); directions[event.key](); }
    if (event.key === 'Enter' && (target === document.body || target === $('#viewport') || target.matches('.read-file,.file-title,[data-select]'))) { event.preventDefault(); openTrack(); }
  }
}, eventOptions);
function inputImport(input: HTMLInputElement) {
  const items: ImportItem[] = [...input.files || []].map(file => ({ file, relativePath: file.webkitRelativePath || file.name })); input.value = '';
  if (!items.length) return; closeModal(); void library.importItems(items).catch(error => tell(error.message));
}
$<HTMLInputElement>('#file-input').addEventListener('change', () => inputImport($('#file-input')));
$<HTMLInputElement>('#folder-input').addEventListener('change', () => inputImport($('#folder-input')));
$<HTMLInputElement>('#lyrics-input').addEventListener('change', async () => { const input = $<HTMLInputElement>('#lyrics-input'), file = input.files?.[0]; input.value = ''; if (file && lyricsTarget) { library.setLyrics(lyricsTarget, await file.text()); if (selectedTrack()?.id === lyricsTarget && mode === 'detail') renderDetail(); tell('歌词已关联'); } });
$<HTMLInputElement>('#relink-input').addEventListener('change', async () => { const input = $<HTMLInputElement>('#relink-input'), file = input.files?.[0]; input.value = ''; if (file && relinkTarget) { await library.relink(relinkTarget, file); if (mode === 'detail') renderDetail(); tell('文件已重新关联'); } });
$<HTMLInputElement>('#backup-input').addEventListener('change', () => {
  const input = $<HTMLInputElement>('#backup-input'), file = input.files?.[0]; input.value = ''; if (!file) return;
  void (async () => {
    if (file.size > 200 * 1024 * 1024) throw new Error('备份文件超过 200 MB，请分批迁移');
    pendingBackup = readBackup(JSON.parse(await file.text()));
    openModal('settings', '导入音乐资料', `<p class="panel-intro">将合并 ${pendingBackup.tracks.length} 首歌曲与 ${pendingBackup.playlists.length} 个歌单。同 ID 更新，收藏合并，队列恢复后保持暂停。</p><p class="help-note">导入前自动保存当前资料，可在设置中导出恢复。音频和登录保持独立；本地文件需要重新关联。</p><label class="check-setting"><input id="backup-overwrite" type="checkbox">同时覆盖当前界面与播放设置</label><button class="primary-action" data-action="backup-apply">确认合并资料 ↓</button>`);
  })().catch(error => { pendingBackup = undefined; tell(error.message); });
}, eventOptions);
document.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); document.documentElement.dataset.musicDrop = 'true'; } }, eventOptions);
document.addEventListener('dragleave', event => { if (!event.relatedTarget) delete document.documentElement.dataset.musicDrop; }, eventOptions);
document.addEventListener('drop', event => {
  if (!event.dataTransfer?.types.includes('Files')) return; event.preventDefault(); delete document.documentElement.dataset.musicDrop;
  if (!ready || library.importing) return;
  const data = event.dataTransfer;
  // Capture handles inside the drop gesture, before awaiting anything.
  const handles = [...data.items].map(item => { const extended = item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }; return extended.getAsFileSystemHandle?.(); });
  const files = [...data.files];
  void (async () => {
    const items: ImportItem[] = [];
    const walk = async (handle: FileSystemHandle, path: string) => {
      if (handle.kind === 'file') items.push({ file: await (handle as FileSystemFileHandle).getFile(), handle: handle as FileSystemFileHandle, relativePath: path });
      else for await (const child of (handle as FileSystemDirectoryHandle & { values(): AsyncIterableIterator<FileSystemHandle> }).values()) await walk(child, `${path}/${child.name}`);
    };
    for (const promise of handles) { const handle = await promise; if (handle) await walk(handle, handle.name); }
    if (!items.length) for (const file of files) items.push({ file, relativePath: file.name });
    await library.importItems(items);
  })().catch(error => tell(error.message));
}, eventOptions);
library.addEventListener('change', () => { if (!ready) return; syncCatalog(); if (modalType === 'search') renderSearchResults(); });
library.addEventListener('error', event => tell((event as CustomEvent<string>).detail));
library.netease.addEventListener('auth', () => { const button = document.querySelector('[data-action="netease"]'); if (button) { button.setAttribute('aria-label', library.netease.account ? `网易云音乐，已登录 ${library.netease.account.nickname}` : '网易云音乐，扫码登录'); button.classList.toggle('cloud-connected', !!library.netease.account); } }, eventOptions);
library.addEventListener('asset', event => {
  const asset = (event as CustomEvent<{ id: string; kind: string }>).detail;
  if (!ready) return;
  if (asset.kind === 'cover') {
    scene?.refreshMusicAssets(); player?.refreshMediaMetadata(asset.id); updatePlayer();
    if (mode === 'detail' && selectedTrack()?.id === asset.id) { const track = selectedTrack()!; if (detailCoverUrl) URL.revokeObjectURL(detailCoverUrl); detailCoverUrl = URL.createObjectURL(track.cover!); const art = document.querySelector('.song-art'); if (art) art.innerHTML = `<img src="${detailCoverUrl}" alt="${esc(track.title)} 的封面">`; }
  }
  if (asset.kind === 'lyrics' && mode === 'detail' && activeTab === 'lyrics' && selectedTrack()?.id === asset.id) renderTab();
}, eventOptions);
library.addEventListener('progress', event => {
  const progress = (event as CustomEvent<ImportProgress>).detail; $('#import-progress').hidden = false;
  $('#import-label').textContent = `${progress.name} · ${progress.completed}/${progress.total}${progress.failed ? ` · ${progress.failed} 个标签未读取` : ''}`;
  const meter = $<HTMLProgressElement>('#import-meter'); meter.max = progress.total || 1; meter.value = progress.completed;
});
library.addEventListener('importend', () => { $('#import-progress').hidden = true; tell(`音乐库已更新，共 ${library.tracks.length} 首歌曲`); });
window.addEventListener('resize', fit, eventOptions); window.visualViewport?.addEventListener('resize', fit, eventOptions);
document.addEventListener('visibilitychange', () => {
  lifecycle.setHidden(document.hidden || desktopHidden); lastFrame = performance.now();
  if (document.hidden && ready) { if (player?.capturePosition()) library.scheduleSave(); void library.flush(); }
}, eventOptions);
window.addEventListener('pagehide', event => {
  if (event.persisted) { player?.pause(); if (ready) void library.flush(); }
  lifecycle.pageHide(event.persisted);
}, eventOptions);
window.addEventListener('pageshow', () => { lastFrame = performance.now(); lifecycle.setHidden(document.hidden || desktopHidden); }, eventOptions);
document.fonts.addEventListener('loadingdone', () => documentReveal.refresh(), eventOptions);

function frame(ms: number) {
  if (!started || lifecycle.closed || document.hidden || desktopHidden) { lastFrame = ms; return; }
  const time = ms / 1000, dt = Math.min(.1, Math.max(0, (ms - lastFrame) / 1000)); lastFrame = ms;
  if (Math.floor(time) !== clockSecond) { clockSecond = Math.floor(time); clock(new Date(), !prefs().reduced); }
  let cinema: { reveal: number; lift: number; zoom: number; time: number } | undefined;
  if (mode === 'boot') {
    const t = time - bootStart, motion = boot.update(t); audio.updateBoot(t, false);
    $('#stage').dataset.boot = t >= 28.3 ? 'inspect' : t >= 25.68 ? 'select' : t >= 22 ? 'array' : motion.step;
    $('#stage').style.setProperty('--entry-opacity', String(ease((t - 21.9) / .13))); $('.callout-rule').style.transform = `scaleX(${ease((t - 22.08) / .9)})`;
    cinema = { reveal: ease((t - 22) / .4), lift: ease((t - 26) / 1.8), zoom: .55 * ease((t - 27.3) / 1.65) + .45 * ease((t - 29) / 5), time: t };
    if (t >= 35) { setMode('archive'); cinema = undefined; }
  }
  const theme = scene?.themeAmount ?? (prefs().theme === 'dark' ? 1 : 0); paintTheme(theme); viewer?.setTheme(theme);
  scene?.setPlayfield(prefs().rhythm && !prefs().reduced && mode !== 'boot', player.bands(dt), .7, 0, null);
  if (!viewer?.isOpen && (!cinema || cinema.time >= 21.9)) scene?.update(time, cinema);
  viewer?.update(time);
  if (scene && mode === 'detail') {
    const content = $('#detail-content'), opacity = String(scene.detailVisibility), translate = `0 ${(1 - scene.detailVisibility) * 18}px`;
    if (content.style.opacity !== opacity) content.style.opacity = opacity;
    if (content.style.translate !== translate) content.style.translate = translate;
    const inert = scene.detailVisibility < .1; if (content.inert !== inert) content.inert = inert;
    documentReveal.update(time, scene.decryptionFrame, prefs().reduced);
  }
  const shade = String(mode === 'boot' ? 0 : scene?.detailVisibility ?? (mode === 'detail' ? 1 : 0)), stage = $('#stage');
  if (stage.style.getPropertyValue('--detail-shade') !== shade) stage.style.setProperty('--detail-shade', shade);
  if (scene) inspection.render(scene.decryptionFrame, (x, y) => scene!.projectCard(x, y), !!cinema, !prefs().reduced);
}
async function initialize() {
  if (desktop) await desktop.attach({
    player: () => player,
    hidden: hidden => { desktopHidden = hidden; lifecycle.setHidden(hidden || document.hidden); lastFrame = performance.now(); if (hidden && player?.capturePosition()) { library.scheduleSave(); void library.flush(); } },
    quit: async () => { player?.capturePosition(); library.scheduleSave(); await library.flush(true); await library.netease.flushLogin(); lifecycle.dispose(); },
    drop: async items => { if (ready) { closeModal(); await library.importItems(items); } },
    tell,
  });
  try { await library.initialize(); } catch (error) { tell(`本地索引暂未恢复：${error instanceof Error ? error.message : error}`); }
  if (lifecycle.closed) return;
  player = new MusicPlayer(library.snapshot.playback, library.provider, id => library.track(id), new Audio(), !desktop);
  if (desktop) {
    await desktop.setCloseToTray(prefs().closeToTray !== false);
    player.addEventListener('change', () => desktop.syncMedia(player, true), eventOptions);
    player.addEventListener('time', () => desktop.syncMedia(player), eventOptions);
  }
  library.netease.addEventListener('credential-error', event => tell((event as CustomEvent<string>).detail), eventOptions);
  player.addEventListener('change', updatePlayer); player.addEventListener('time', updateTime); player.addEventListener('persist', () => library.scheduleSave()); player.addEventListener('error', event => tell((event as CustomEvent<string>).detail));
  syncCatalog();
  try { const loadingScene = new ArchiveScene($('#three-scene')); scene = loadingScene; await loadingScene.load(); if (lifecycle.closed) return; loadingScene.refreshCatalog(selected); }
  catch (error) { scene?.dispose(); scene = undefined; $('#fallback-note').hidden = false; tell('三维场景载入失败，仍可通过音乐索引播放歌曲。'); console.error(error); }
  if (lifecycle.closed) return;
  if (scene) {
    scene.onSelect = (index, cell) => { if (mode === 'archive' && !modalType && !viewer?.isOpen) select(index, cell ? { cell } : undefined); };
    scene.onNavigate = (axis, direction) => { if (mode === 'archive' && !modalType && !viewer?.isOpen) axis === 'lane' ? stepColumn(direction) : stepFile(direction); };
    scene.onHover = index => { const label = $('#hover-label'); label.hidden = index === null || !musicTrack(index); if (index !== null && musicTrack(index)) label.textContent = `NO.${String(index + 1).padStart(3, '0')} / ${musicTrack(index)!.title}`; };
  }
  await Promise.allSettled([loadBootWebfonts(), document.fonts.load('400 20px MiSans', '音乐播放器导入专辑歌单歌词0123456789'), document.fonts.load('700 20px MiSans', 'RHINE LAB')]);
  if (lifecycle.closed) return;
  applyPreferences(true); updateSelection(); updatePlayer(); ready = true;
  void library.netease.restoreSession().catch(error => { if (!lifecycle.closed) tell(error.message); });
  const complete = (silent = false) => {
    if (started || lifecycle.closed) return; started = true; if (silent) { prefs().sound = false; applyPreferences(); }
    const full = !prefs().reduced && (prefs().intro === 'always' || prefs().intro === 'first' && !prefs().seenIntro);
    prefs().seenIntro = true; library.scheduleSave();
    $('#loading').remove(); $('#stage').inert = false; audio.releaseEntry(); audio.restartBoot();
    bootStart = performance.now() / 1000 - 1.76; setMode(full ? 'boot' : 'archive');
    if (!full) { scene?.revealImmediately(); if (!prefs().reduced) $('#viewport').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, easing: 'ease-out' }); }
    lifecycle.setHidden(document.hidden || desktopHidden); lifecycle.start();
    void player.restore(); if (!desktop) pwaTimer = setTimeout(() => { if (!lifecycle.closed) void initPwa(tell); }, 1500);
  };
  const full = !prefs().reduced && (prefs().intro === 'always' || prefs().intro === 'first' && !prefs().seenIntro);
  if (full && prefs().sound) { const gate = new StartupGate({ root: $('#loading'), unlock: () => audio.unlock(), cancel: () => audio.cancelEntry(), start: complete }); gate.ready(); }
  else complete();
  document.addEventListener('pointerdown', () => { if (started && prefs().sound) void audio.unlock(); }, { once: true, ...eventOptions });
  fit();
  if (import.meta.env.DEV) Object.assign(window, { rhineMusic: { stats: () => ({ ready, started, mode, tracks: library.tracks.map(track => ({ id: track.id, title: track.title, artist: track.artist, album: track.album, availability: track.availability, duration: track.duration, cover: !!track.cover, lyrics: !!track.lyrics })), collections: musicColumns, selected: selectedTrack()?.id, preferences: prefs(), playback: { ...player.state, playing: player.playing, busy: player.busy }, scene: scene?.getStats() }) } });
}
$('#viewport').append($('#loading')); $('#stage').inert = true; $('#player-bar').hidden = true; document.documentElement.dataset.musicBoot = 'true'; fit();
void initialize().catch(error => { if (lifecycle.closed) return; console.error(error); $('#loading').innerHTML = `<div class="error-state"><strong>INITIALIZATION INTERRUPTED</strong><p>${esc(error instanceof Error ? error.message : '初始化失败')}</p><button data-action="reload">刷新后重试 ↗</button></div>`; $('[data-action="reload"]').addEventListener('click', () => location.reload(), eventOptions); });
if (import.meta.hot) import.meta.hot.dispose(() => lifecycle.dispose());
