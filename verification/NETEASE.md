# 网易云接入验证

接口：`https://wy-yapi-enhanced.vercel.app`。复用原 TypeScript / Three.js / Vite 音乐播放器，没有新增本地 API 服务或依赖。

## 已实现

- 右上网易云入口、空库入口及设置入口；扫码、刷新二维码、取消轮询、登录状态恢复及退出本站连接。
- 凭据通过 POST 请求体发送，存放于当前标签页 sessionStorage；不写入 IndexedDB、音乐库快照、URL 或 Git。关闭页面取消所有请求和轮询。
- 30 首一页搜索及加载更多、播放、读取卡片、下一首播放、加入音乐库；本地/在线稳定 ID 分发，共用队列、播放模式、收藏和本地歌单。
- 账号歌单分页读取；按原歌单 ID 顺序分批取得歌曲信息（每批 200），支持千首以上；同步为只读索引，重新同步保持 ID，可复制为本地可编辑歌单，不写回网易云。
- 在线封面按视口请求及回收请求，最多四个同时下载；缩略图和歌词缓存于 IndexedDB。原双环/封面外观、查看器、歌词跳转、Web Audio 律动及 Media Session 复用既有实现。
- 播放地址逐次解析，HTTPS 音频直连网易云；在设置 src 前设置 anonymous CORS，避免 MediaElementAudioSource 在跨域未授权时静默输出。404 无资源明确提示，试听标记单独提示，自动队列跳过失败项。
- Service Worker 仅缓存已有同源应用白名单，不缓存第三方 API、认证或音频。

## 自动验证

`npm test`：29 项通过（此前 21 项加 8 项网易云/混合来源测试）。覆盖映射与专辑身份、扫码及刷新会话、POST 凭据和无 URL 泄露、404/试听、过期凭据竞争及释放、千首歌单分页与顺序、重复同步及持久化恢复、混合队列/CORS/暂停恢复、四路封面并发和取消；保留原阵列、LRC、本地导入和关闭清理测试。

`npm run typecheck` 和 `npm run build` 通过。Vite 在本机沙箱内 realpath 遇 EPERM，允许的沙箱外构建通过；保留既有大包警告。API 未打包为依赖，没有增加播放器后台服务。

## 线上及浏览器验证边界

2026-10-09：用和播放器相同的 POST JSON/noCookie/独立时间戳请求确认 cloudsearch 返回 200，三个 Monody 结果，响应允许 `http://127.0.0.1:5173` 跨域；POST 二维码 key 返回 200。

此前用户扫码的一次性测试会话已确认登录状态为有效账号；Monody（36308916）返回完整 MP3/128 kbps、音频 HEAD 200、Access-Control-Allow-Origin `*`。稻香（185709）返回无资源 404，按用户确认的正常歌曲资源状态处理。这次会话随后结束，凭据未转移到播放器。

当前应用内自动化浏览器可打开播放器，验证入口、模态焦点/关闭及错误状态，但请求该 Vercel 域名失败；不能据此声称真实账号在播放器中的扫码及播放已经通过。普通 Chrome/Edge 的扫码、实际播放、私有歌单、刷新恢复需用户完成登录后验证。模拟/单元测试不替代实际账号验证。

播放器真实浏览器回归：导入原创 `.cache/music-fixtures/track-1.wav` 与同名 LRC，metadata Worker 成功解析为「观测室 1 / Rhine Test」和 12 秒时长；播放按钮变为暂停，进度实际推进至 9 秒，进入三维详情时保持播放。没有导入第三方歌曲文件。

布局检查：1920×1080 和 390×844；窄屏 modal 宽 366px、x=12px，高约 490px，文档无横向溢出。截图：`netease-desktop.png`、`netease-mobile.png`。检查后恢复默认浏览器视口。

## 扫码连接错误诊断修订（2026-10-09）

- 用户在普通 Edge 的测试站点上反馈二维码生成前报“无法连接”。对 `/login/qr/key` 与 `/login/qr/create` 逐一检查 OPTIONS/POST：预检均 204，POST 均 200，允许测试站点 Origin 和 Content-Type，Vary 为 Origin。原 JSON POST 的跨域配置在检查时有效。
- 当前应用内浏览器直接打开 `/login/qr/key` 返回 `net::ERR_BLOCKED_BY_CLIENT`；播放器 fetch 也失败。这证明本地自动化浏览器的客户端拦截，但不能直接推定用户 Edge 的拦截原因。未尝试代理绕过浏览器的拦截；用户 Edge 的直接访问结果仍待反馈。
- 移除仅用于缓存随机值的 `crypto.randomUUID` 依赖；只在 fetch 的 TypeError 时标记网络连接失败，准备请求失败、HTTP 错误和非 JSON 响应分别处理。原先整个请求中的 TypeError 都误归为“网络或跨域设置”。兼容性修订不代表已经定位用户浏览器的实际故障。
- 扫码失败提供直接检查二维码接口的入口，仅包含公开路径、noCookie 和时间戳，不携带凭据。
- `npm test` 30 项通过，TypeScript 和生产构建通过。真实浏览器核对新错误说明与检查链接，见 `netease-connection-diagnostic.png`。实际 Edge 扫码尚未确认恢复。
