# Rhine Music · Windows 测试版

基于音乐播放器基线 `17b4a7f`，桌面分支 `codex/windows-app`。保留上游 RhineLabUI 署名与 MIT 许可，网页继续独立构建。桌面运行使用 Tauri 2 + WebView2，不需要 Node、Vite、Rust 或 C++ Build Tools。

## 云端打包（推荐）

仓库：`https://github.com/YLgreen666/Music-Win`。进入 Actions → Windows app。推送到 `codex/windows-app` 会自动构建；也可以 Run workflow 手动构建。首次空仓库推送后该分支会成为默认分支。

工作流运行共享播放器测试、TypeScript、网页构建、桌面资源构建、Rust 格式检查、Rust 测试及 Clippy，最后生成 Windows 10/11 x64 NSIS 安装器。全部通过后在当前运行的 Artifacts 下载 `rhine-music-windows-x64-运行编号`，解压 `.exe`。同时提供 SHA256。构建产物保留 14 天；不创建公开 Release，不启用网站托管。

构建机使用 GitHub 托管的 Windows 2022，编译工具只在云端使用。本机不必安装 MSVC。安装包暂未签名；这是供本人和朋友验证的测试包。用户指定的仓库目前是公开仓库，源码和构建日志公开，Artifacts 需要登录 GitHub 下载；不要向仓库加入个人音乐、资料备份或凭据。

## 安装、使用和升级

运行安装器，默认安装到当前用户。Windows 已有 WebView2 时直接使用；缺少时安装器包含微软引导程序，联网下载安装运行时。默认不注册文件关联，也不开机启动。

关闭窗口默认收起到托盘；托盘菜单可显示、播放暂停、上一首、下一首和退出。设置可关闭“关闭窗口时收起到托盘”。最小化/隐藏暂停三维帧循环，歌曲与队列继续运行。再次启动显示已有窗口。

应用标识固定为 `cc.rhine.music-player`，Windows 资源来源固定使用 HTTPS Tauri 来源。后续覆盖安装使用相同标识及来源，保持 IndexedDB 音乐库、设置和原生文件授权记录。升级前先在设置导出资料；退出播放器后运行新安装器覆盖安装。没有自动更新功能。

原生选择或拖入歌曲和文件夹，扫描子目录；音频保留原位置，经 Tauri 受限 asset 协议播放，不把整首音频经 IPC 发送。文件路径授权只来自原生选择或系统拖入，导入备份无法授权任意路径。歌词支持同名 LRC 和手动选择。文件移动、断开磁盘或从网页迁移后，可重新选择原目录或在歌曲详情重新关联文件。

网易云 API 使用原有 Vercel 服务；桌面原生 HTTP 权限只允许该 API 和网易云封面域名，不内置 Node 服务。音频仍通过 WebView2 直接加载网易云音频。可播放范围由账号和资源权限决定，打包成功不代表每首网易云歌曲均可播放。

扫码默认勾选记住登录，Windows DPAPI 按当前 Windows 用户加密保存凭据；取消记住登录或退出连接清除持久凭据。凭据不进入备份、日志或 Git。

## 网页与应用互迁

设置 → 资料迁移 → 导出资料，得到版本化 JSON。包含歌曲索引、封面、歌词、歌单、收藏、队列与设置，排除音频、文件句柄和登录信息。目标端导入时按歌曲/歌单 ID 合并，默认保留当前界面设置；只有主动勾选才覆盖设置。队列恢复后保持暂停。

导入前自动将当前资料备份到 IndexedDB，设置中可导出“上次导入前的资料”。本地歌曲需要重新关联；目录扫描仅对唯一匹配的文件名、大小、相对路径恢复原 ID，存在歧义时单独关联。导入不删除磁盘文件。

## 本地前端检查

```powershell
npm ci
npm test
npm run typecheck
npm run build
npm run build:desktop
```

网页开发仍用 `npm run dev`。这些检查不需要系统 C++ 编译工具。只有选择在本机编译原生宿主时才需要 Rust MSVC 工具链和微软 C++ Build Tools，随后使用 `npm run desktop:dev` / `npm run desktop:build`；当前推荐云端构建，不要求本机安装。

桌面资源输出 `dist-desktop`，网页输出 `dist`。桌面不注册 PWA、不提供网站更新入口，也不分发独立授权的 Novecento Webfont kit，沿用已有固定图形后备；模型、MiSans、许可证和 Worker 本地打包。

## 必须实测的项目

云端测试和构建只是第一层验证。首包生成后仍需在 WebView2 验证实际 GPU、原始画质、两种外观、音频格式、大文件 Range 跳转、Web Audio、隐藏窗口连续播放、托盘与媒体键、扫码及登录恢复、退出释放、覆盖升级和数据保留。朋友电脑需独立复测。《100种生活》需在真实账号下确认资源限制与加载错误；不以匿名 API 或安装包成功替代该测试。

设置中“打开性能诊断”会在独立 WebView2 窗口打开已有合成歌曲测试场景，显示实际 GPU、渲染分辨率、CPU/GPU 计时、P50/P95 和纹理上传信息。诊断期间主场景暂停渲染，歌曲继续播放；关闭诊断后恢复。诊断不读取音乐库或凭据，不自动改变原始画质。

来源：[Tauri GitHub 构建](https://v2.tauri.app/distribute/pipelines/github/)、[Windows 安装器](https://v2.tauri.app/distribute/windows-installer/)、[asset Range 实现](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/protocol/asset.rs)、[lofty](https://docs.rs/lofty/latest/lofty/)、[souvlaki](https://github.com/Sinono3/souvlaki)、[DPAPI](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)。
