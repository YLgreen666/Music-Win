# RHINE LAB · 本地音乐播放器

基于 [LBEILC / RhineLabUI](https://github.com/LBEILC/RhineLabUI) 提交 `af8563bbc7ee60ffdad5635fec91e9ba7cc93a47` 的网页音乐播放器。保留原品牌、MiSans、完整开场、玻璃阵列、抽取、解密与 360° 查看器。使用 TypeScript、Three.js、Vite，没有引入前端框架。

## 本地启动

需要 Node.js 22.18+（或 Node.js 24+）和 npm。在项目目录运行：

```powershell
npm ci
npm run dev
```

在 Windows Chrome / Edge 打开终端显示的 `http://127.0.0.1:5173/`。本机回环地址支持安全上下文文件选择，不要直接双击 `index.html`。

```powershell
npm run typecheck
npm test
npm run build
npm run preview -- --port 4173
```

生产文件位于 `dist/`。部署时使用 HTTPS，将整个目录作为静态网站提供。音乐库属于当前站点来源，换域名或端口会得到独立音乐库。

## 导入与音乐库

- “导入音乐”支持多文件选择、文件夹递归扫描和窗口拖入；可以与音乐同时选择同名 `.lrc`。
- Chrome / Edge 的文件选择 API 保存只读文件句柄，音频保留在原位置。重新打开时仅检查权限，不自动申请；在歌曲信息中点击“恢复访问”或“重新关联文件”。失效文件保留索引。
- 不支持文件句柄时提供普通文件/文件夹选择；“兼容导入”也可主动使用临时文件。刷新后元数据、封面、歌词和歌单保留，音频需要重新导入或关联。普通文件选择器无法读取未选中的旁置 LRC，请一起选择。
- 支持 MP3、FLAC、M4A/AAC、WAV、OGG 等文件。标签在 Worker 中解析，显示进度并支持取消，已完成的歌曲保留。损坏标签回退到文件名，无专辑标签按文件夹分组。实际解码依赖浏览器，失败时显示原因。
- 重复导入同一文件句柄或同一目录路径更新记录并保留歌曲 ID；临时文件按名称、大小、修改时间识别。不会复制音频，也不会删除磁盘文件。
- IndexedDB 保存索引、文件和目录句柄、最多 512px 的封面缩略图、LRC、歌单、收藏、队列、进度及设置。

## 使用

“专辑／歌单”切换浏览列。左右切列，上下切歌，支持拖动惯性、滚轮和方向键，并记住当前会话每列选曲。空歌单可在管理界面添加歌曲，加入歌曲后出现在阵列。

点击卡片只选择，Enter 或 ACCESS TRACK 读取详情；明确点击播放按钮才播放。浏览与播放状态独立，返回、切换外观和查看模型持续保留音频。点击播放条歌曲标题可回到正在播放歌曲的详情。

播放条提供进度、音量、上一首、播放/暂停、下一首、顺序/列表循环/单曲循环/随机与队列。详情可追加队列，索引中的“＋”设为下一首。队列支持排序、移除和清空。刷新恢复队列和进度时保持暂停。自动播放跳过不能读取或解码的歌曲，一轮无可播放项时停止。

歌单管理支持创建、重命名、添加、移除、排序及播放；“全部歌曲”“收藏”为内置歌单。LRC 支持多时间标签、毫秒、offset、自动滚动、高亮及点击跳转。歌曲信息提供恢复访问与重新关联入口。

设置提供亮暗主题、原双环内构/玻璃内封面、画质、减少动态效果、音乐律动、独立交互音效和开场偏好。首次完整开场，之后短入场；Enter/Esc 或 ENTER SYSTEM 可跳过，REINITIALIZE 可重播。背景配乐默认关闭，逐字输入音效采用程序生成声音。

三维阵列按视口裁剪，不为千首索引创建千个模型。封面按需解码，采用固定 64 格纹理图集并回收位图。WebGL 不可用时保留音乐索引和播放控制。窄屏上方模型、下方滚动详情。

## PWA 安装与更新

运行生产预览或 HTTPS 生产站点，等待设置显示“离线资源已就绪”。Chrome / Edge 可通过地址栏安装图标或浏览器菜单安装；可用时设置也显示安装入口。开发模式不注册离线缓存。

仅缓存界面、字体、模型和解析 Worker 等应用资源，不缓存导入音频。离线播放仍需要原文件和读取权限。新版本等待用户在设置点击“更新并重启”，不会主动重载播放页面。

## 扩展与工程结构

| 文件 | 职责 |
| --- | --- |
| `src/music-main.ts`、`src/music.css` | 原舞台上的音乐交互、播放条与弹窗 |
| `src/music/types.ts` | Track、Collection、PlaybackState、MusicProvider、FileAccessAdapter |
| `src/music/library.ts`、`database.ts` | 导入、歌单、收藏、IndexedDB、权限恢复 |
| `src/music/metadata-worker.ts` | music-metadata 浏览器解析与封面缩略图 |
| `src/music/player.ts` | 独立 HTMLAudioElement、队列、Web Audio、Media Session |
| `src/data.ts` | 以稳定歌曲 ID 连接场景列与音乐库 |
| `src/music/cover-layer.ts` | 固定内存的封面图集及查看器封面 |
| `scripts/check-music.mjs` | 阵列、队列、LRC、文件访问、导入与恢复测试 |

首版只实现本地来源。桌面宿主可替换 FileAccessAdapter；第三方平台可实现 MusicProvider 的查询、播放资源、封面和歌词接口。平台登录、接口服务与桌面安装包留到后续阶段。

运行 `npm run test:fixtures` 在忽略目录 `.cache/music-fixtures` 生成原创合成 WAV、标签、封面、LRC 与损坏音频样本。真实浏览器回归记录见 [verification/MUSIC-PLAYER.md](verification/MUSIC-PLAYER.md)。

## 来源与许可证

上游作者 **LBEILC**，源码采用 [MIT License](LICENSE)。原说明保留于 [UPSTREAM-README.md](UPSTREAM-README.md)，设计基准见 [DESIGN.md](DESIGN.md)。这是《明日方舟》相关终端视觉的非官方改造，保留上游品牌与美术来源说明。

MiSans 按随附许可使用，见 `public/fonts/NOTICE.txt`、`public/fonts/MiSans-license.pdf`；其他第三方许可在 `public/licenses/`。上游视频逐字音效采样及编码模块已移除。原 Blender/视觉工具仍保留，默认网页入口为音乐播放器，旧壁纸脚本不属于本版本验收范围。
