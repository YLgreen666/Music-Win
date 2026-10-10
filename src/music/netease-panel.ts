import { escapeHtml as esc } from '../html';
import { formatTime } from './domain';
import type { MusicLibrary } from './library';
import type { MusicPlayer } from './player';
import type { Track } from './types';
import { NeteaseConnectionError } from './netease';
type PanelHooks = { open(title: string, body: string): void; close(after?: () => void): void; show(id: string): void; tell(message: string): void; active(): boolean };

/** Remote screens use the existing modal, focus handling and visual vocabulary. */
export class NeteasePanel {
  private controller?: AbortController;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private results: Track[] = [];
  private total = 0;
  private query = '';
  private offset = 0;
  private screen: 'home' | 'qr' | 'search' | 'playlists' = 'home';
  private generation = 0;
  constructor(private library: MusicLibrary, private player: () => MusicPlayer, private hooks: PanelHooks) {}
  cancel() { ++this.generation; this.controller?.abort(); this.controller = undefined; clearTimeout(this.pollTimer); }
  private operation() { this.cancel(); this.controller = new AbortController(); return { signal: this.controller.signal, generation: this.generation }; }
  private current(generation: number) { return this.generation === generation && this.hooks.active(); }
  private connectionHelp(error: unknown) {
    if (!(error instanceof NeteaseConnectionError)) return '';
    const url = new URL('/login/qr/key', this.library.netease.endpoint); url.searchParams.set('noCookie', 'true'); url.searchParams.set('timestamp', String(Date.now()));
    return `<p class="help-note">二维码还未生成。可先在当前浏览器直接检查接口是否能打开，再返回重试。</p><p><a class="cloud-connection-check" href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">打开二维码接口检查 ↗</a></p>`;
  }
  private header() {
    const account = this.library.netease.account;
    return `<div class="cloud-toolbar"><span>${account ? `已登录 · ${esc(account.nickname)}` : '尚未登录网易云'}</span><div><button data-action="cloud-login">${account ? '切换账号 / 扫码' : '扫码登录'}</button>${account ? '<button data-action="cloud-playlists">我的网易云歌单</button><button data-action="cloud-logout">退出连接</button>' : ''}</div></div><form id="cloud-search-form" class="search-field"><span>⌕</span><input name="query" id="cloud-query" aria-label="搜索网易云音乐" placeholder="搜索网易云歌曲、歌手" value="${esc(this.query)}" autocomplete="off" required maxlength="200"><button class="primary-action" type="submit">搜索</button></form>`;
  }
  open() { this.cancel(); this.screen = 'home'; this.hooks.open('网易云音乐', `${this.header()}<p class="panel-intro">扫码连接网易云后，可搜索播放歌曲、读取你的歌单，并与本地音乐一起加入队列。</p><p class="help-note">${this.library.netease.desktopLogin ? '记住登录时由 Windows 加密保存，退出连接会清除凭据。' : '登录保存在当前标签页，刷新可恢复，关闭标签页后需要重新扫码。'}音频直接从网易云加载；可播放范围以账号和歌曲权限为准。</p><p class="help-note">API 服务：${esc(this.library.netease.endpoint)}</p>`); }
  async login() {
    const { signal, generation } = this.operation(); this.screen = 'qr';
    this.hooks.open('扫码登录网易云', '<div class="panel-empty" role="status">正在生成登录二维码…</div>');
    try {
      const qr = await this.library.netease.createQr(signal); if (!this.current(generation)) return;
      this.hooks.open('扫码登录网易云', `<div class="cloud-login"><img src="${esc(qr.image)}" alt="网易云音乐登录二维码"><div><p>用网易云音乐 App 扫码，并在手机上确认登录。</p>${this.library.netease.desktopLogin ? `<label class="check-setting"><input id="remember-login" type="checkbox" ${this.library.netease.rememberLogin ? 'checked' : ''}>记住登录</label>` : ''}<p id="cloud-login-status" role="status">等待扫码</p><button data-action="cloud-login">刷新二维码 ↻</button><p class="help-note">二维码失效后可刷新。登录仅用于连接你的 API 服务和网易云。</p></div></div>`);
      const deadline = Date.now() + 180000;
      const poll = async () => {
        if (!this.current(generation) || signal.aborted) return;
        try {
          const code = await this.library.netease.checkQr(qr.key, signal); if (!this.current(generation)) return;
          const status = document.querySelector('#cloud-login-status');
          if (code === 803) { this.hooks.tell('网易云登录成功'); this.open(); return; }
          if (code === 800 || Date.now() > deadline) { if (status) status.textContent = '二维码已过期，请刷新'; return; }
          if (status) status.textContent = code === 802 ? '已扫码，请在手机上确认登录' : '等待扫码';
          this.pollTimer = setTimeout(() => { void poll(); }, 2500);
        } catch (error) { if (this.current(generation) && !signal.aborted) { const status = document.querySelector('#cloud-login-status'); if (status) status.textContent = error instanceof Error ? error.message : '登录检查失败，请刷新二维码'; } }
      };
      void poll();
    } catch (error) { if (this.current(generation) && !signal.aborted) this.hooks.open('扫码登录网易云', `<p class="panel-empty" role="status">${esc(error instanceof Error ? error.message : '二维码加载失败')}</p>${this.connectionHelp(error)}<button data-action="cloud-login">重试 ↻</button>`); }
  }
  private searchBody(message?: string) {
    return `${this.header()}<div class="cloud-results-heading"><span>${this.results.length} / ${this.total} TRACKS</span>${this.results.length ? '<button data-action="cloud-play-results">播放已加载歌曲 ▷</button>' : ''}</div>${message ? `<p role="status" class="help-note">${esc(message)}</p>` : ''}<div class="music-results">${this.results.map((track, index) => `<div class="music-row"><span class="row-index">${index + 1}</span><button class="row-track" data-action="cloud-show" data-id="${esc(track.id)}"><strong>${esc(track.title)}</strong><small>${esc(track.artist)} ／ ${esc(track.album)}${track.playbackNotice ? ` · ${esc(track.playbackNotice)}` : ''}</small></button><span class="row-duration">${formatTime(track.duration)}</span><div class="row-actions"><button data-action="cloud-play" data-id="${esc(track.id)}" aria-label="播放 ${esc(track.title)}" title="播放">▷</button><button data-action="cloud-enqueue" data-id="${esc(track.id)}" aria-label="下一首播放 ${esc(track.title)}" title="下一首播放">＋</button><button data-action="cloud-add" data-id="${esc(track.id)}" aria-label="归档 ${esc(track.title)}" title="加入音乐库">↓</button></div></div>`).join('') || '<p class="panel-empty">没有匹配的歌曲。</p>'}</div>${this.offset < this.total ? '<button class="cloud-more" data-action="cloud-more">加载更多 ↓</button>' : ''}<p class="help-note">点击歌名可读取歌曲卡片。播放、读取和加入队列会将对应歌曲加入音乐库。</p>`;
  }
  async search(query: string, more = false) {
    if (!query.trim()) return;
    const { signal, generation } = this.operation(); this.screen = 'search';
    if (!more) { this.query = query.trim(); this.results = []; this.offset = 0; this.total = 0; }
    this.hooks.open('网易云音乐 · 搜索', this.searchBody('正在搜索…'));
    try {
      const result = await this.library.netease.searchPage(this.query, this.offset, signal); if (!this.current(generation)) return;
      const map = new Map(this.results.map(track => [track.id, track]));
      for (const track of result.tracks) map.set(track.id, this.library.track(track.id) || track);
      this.results = [...map.values()]; this.offset += result.tracks.length; this.total = result.tracks.length ? result.total : this.offset;
      this.hooks.open('网易云音乐 · 搜索', this.searchBody());
    } catch (error) { if (this.current(generation) && !signal.aborted) this.hooks.open('网易云音乐 · 搜索', this.searchBody(error instanceof Error ? error.message : '搜索失败')); }
  }
  async playlists() {
    const { signal, generation } = this.operation(); this.screen = 'playlists';
    this.hooks.open('我的网易云歌单', `${this.header()}<p class="panel-empty" role="status">正在读取歌单…</p>`);
    try {
      const lists = await this.library.netease.playlists(signal); if (!this.current(generation)) return;
      this.hooks.open('我的网易云歌单', `${this.header()}<p class="help-note">同步后成为阵列中的歌单列。网易云歌单只读；可复制为本地歌单后编辑。</p><div class="music-results">${lists.map((list, index) => `<button class="playlist-card" data-action="cloud-import" data-id="${esc(String(list.id))}"><span>${index + 1}</span><strong>${esc(list.name)}</strong><small>${list.trackCount} 首 · ${esc(list.creator?.nickname || '')}</small><b>同步 ↓</b></button>`).join('') || '<p class="panel-empty">这个账号还没有可读取的歌单。</p>'}</div>`);
    } catch (error) { if (this.current(generation) && !signal.aborted) this.hooks.open('我的网易云歌单', `${this.header()}<p class="panel-empty">${esc(error instanceof Error ? error.message : '歌单读取失败')}</p>`); }
  }
  async importPlaylist(id: string) {
    const { signal, generation } = this.operation();
    this.hooks.open('同步网易云歌单', '<p id="cloud-progress" class="panel-empty" role="status">正在读取歌单…</p><p class="help-note">关闭弹窗可以取消。已有本地音乐和歌单会保留。</p>');
    try {
      const result = await this.library.netease.readPlaylist(id, (done, total) => { if (this.current(generation)) { const status = document.querySelector('#cloud-progress'); if (status) status.textContent = `正在读取歌曲 ${done} / ${total}`; } }, signal);
      if (!this.current(generation)) return;
      this.library.syncOnlinePlaylist(result.tracks, result.collection);
      this.hooks.tell(`已同步「${result.collection.name}」· ${result.tracks.length} 首${result.missing ? `，${result.missing} 首信息不可读取` : ''}`);
      await this.playlists();
    } catch (error) { if (this.current(generation) && !signal.aborted) { this.hooks.tell(error instanceof Error ? error.message : '同步失败'); await this.playlists(); } }
  }
  async action(action: string, id?: string) {
    if (action === 'cloud-login') return this.login();
    if (action === 'cloud-home') return this.open();
    if (action === 'cloud-logout') { this.cancel(); this.library.netease.disconnect(); this.open(); this.hooks.tell('已退出网易云连接'); return; }
    if (action === 'cloud-playlists') return this.playlists();
    if (action === 'cloud-more') return this.search(this.query, true);
    if (action === 'cloud-import' && id) return this.importPlaylist(id);
    if (action === 'cloud-play-results') { this.library.upsertOnlineTracks(this.results); if (this.results.length) await this.player().playQueue(this.results.map(track => track.id), this.results[0].id); return; }
    const track = this.results.find(track => track.id === id); if (!track) return;
    this.library.upsertOnlineTracks([track]);
    if (action === 'cloud-show') this.hooks.close(() => this.hooks.show(track.id));
    if (action === 'cloud-play') { await this.player().playQueue([track.id], track.id); if (this.screen === 'search' && this.hooks.active()) this.hooks.open('网易云音乐 · 搜索', this.searchBody()); }
    if (action === 'cloud-enqueue') { this.player().enqueue(track.id, true); this.hooks.tell('已加入下一首播放'); }
    if (action === 'cloud-add') this.hooks.tell('已加入音乐库，可收藏或加入本地歌单');
  }
}
