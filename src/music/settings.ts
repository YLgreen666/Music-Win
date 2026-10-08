import type { MusicPreferences } from './types';
import { qualityMarkup } from '../quality-settings';
import { qualityPresets } from '../render-quality';
import { pwaSettingsMarkup } from '../pwa';
import '../quality-settings.css';
export function settingsContent(p: MusicPreferences) {
  return `<div class="settings-grid">
    <label><span>界面配色 / THEME</span><select data-preference="theme"><option value="light" ${p.theme === 'light' ? 'selected' : ''}>亮色</option><option value="dark" ${p.theme === 'dark' ? 'selected' : ''}>暗色</option></select></label>
    <label><span>卡片外观 / CARD</span><select data-preference="cardStyle"><option value="original" ${p.cardStyle === 'original' ? 'selected' : ''}>原双环内构</option><option value="cover" ${p.cardStyle === 'cover' ? 'selected' : ''}>玻璃内展示封面</option></select></label>
    <label><span>开场 / STARTUP</span><select data-preference="intro"><option value="first" ${p.intro === 'first' ? 'selected' : ''}>首次完整，以后短入场</option><option value="always" ${p.intro === 'always' ? 'selected' : ''}>每次完整，可跳过</option><option value="short" ${p.intro === 'short' ? 'selected' : ''}>始终短入场</option></select></label>
    <label><span>交互音效音量</span><input type="range" min="0" max="1" step="0.01" data-preference="soundVolume" aria-label="交互音效音量" value="${p.soundVolume}"></label>
    <label class="check-setting"><span>音乐驱动三维律动</span><input type="checkbox" data-preference="rhythm" ${p.rhythm ? 'checked' : ''}></label>
    <label class="check-setting"><span>减少动态效果</span><input type="checkbox" data-preference="reduced" ${p.reduced ? 'checked' : ''}></label>
    <label class="check-setting"><span>交互音效</span><input type="checkbox" data-preference="sound" ${p.sound ? 'checked' : ''}></label>
    <label class="check-setting"><span>空闲背景配乐（播放歌曲时关闭）</span><input type="checkbox" data-preference="backgroundMusic" ${p.backgroundMusic ? 'checked' : ''}></label>
  </div>${qualityMarkup(p.rendering || qualityPresets[p.quality])}
  <div class="playlist-toolbar"><button data-action="replay">重播完整开场 ↗</button><button data-action="full-screen">全屏 ↗</button></div>
  ${pwaSettingsMarkup()}
  <section class="attribution"><h3>ABOUT / 来源与许可</h3><p>基于 LBEILC / RhineLabUI 的三维档案设计，源码基线 af8563bbc7ee。保留原品牌；音乐由本机文件提供。</p><a href="https://github.com/LBEILC/RhineLabUI" target="_blank" rel="noopener">原项目 ↗</a><a href="/licenses/rhine-lab.txt" target="_blank">MIT 许可 ↗</a><a href="/fonts/NOTICE.txt" target="_blank">字体说明 ↗</a><a href="/fonts/MiSans-license.pdf" target="_blank">MiSans 许可 ↗</a><a href="/licenses/rolling-number.txt" target="_blank">Rolling Number ↗</a></section>`;
}
