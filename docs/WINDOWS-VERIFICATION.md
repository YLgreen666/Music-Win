# Windows 首包验证记录

日期：2026-10-10。音乐播放器基线 `17b4a7f`，应用代码 `ee6f4f0`，分支 `codex/windows-app`，仅上传用户仓库 `YLgreen666/Music-Win`。上游 `origin` 未推送，未恢复临时网站。

## 自动检查

最终构建：[Windows app #2](https://github.com/YLgreen666/Music-Win/actions/runs/38052802134)。构建环境为 GitHub 托管 Windows 2022，目标 `x86_64-pc-windows-msvc`。

| 检查 | 结果 |
| --- | --- |
| 共享播放器测试 | 50 项通过，包含迁移合并、原生访问适配、导入取消、登录存储与 Media Session 隔离 |
| TypeScript | 通过 |
| 网页生产构建 | 通过 |
| 桌面生产资源构建 | 通过，包含诊断页、模型、MiSans、署名与 Worker；移除 PWA 更新资源和独立许可 Webfont |
| Rust 格式检查 | 通过 |
| Rust 测试 | 2 项通过：支持的扩展名与 Windows DPAPI 加解密 |
| Clippy | 通过，警告视为错误 |
| Windows x64 NSIS 打包与上传 | 通过，最终工作流总耗时 5 分 48 秒 |

前端构建仍有既有的大模块体积提示，未改变画质或拆除光影来消除提示。Rust 测试覆盖有限，不能代替原生运行验证。

## 安装包与使用

Actions 产物仅包含 Windows x64 NSIS 安装器与 SHA256，不创建公开 Release。Artifact 保留 14 天；下载后的本地副本不依赖该期限。安装包未签名，按当前用户安装。使用现有 WebView2，缺失时安装器通过微软引导程序安装。运行时不需要 Node、Vite、Rust 或 C++ 编译工具。

最终文件 `Rhine Music_0.1.0_x64-setup.exe`，35,568,160 字节（33.92 MiB）。已下载到 `release/windows-cloud/`，安装器 SHA256 与云端结果一致：`10F0B6CC7AD20F90DBA7D72D9DEE2DB9C251501A711A89BECC23E1D93F8735F9`。ZIP SHA256 也已与 GitHub Artifact 摘要校验一致。

安装、升级、文件重新关联、网页数据迁移及开发说明见 [WINDOWS-APP.md](WINDOWS-APP.md)。默认关闭收起托盘，彻底退出使用托盘“退出”；重启恢复队列和进度时保持暂停。

## 尚待实机验收

本记录没有把云端构建当作 WebView2 播放验证。尚未实际安装或运行此包，也未取得真实 GPU、帧间隔和进度跳转数据。

- 在本机验证原始画质、两种外观、拖动/抽取/归位/查看器和中文路径导入。
- 验证 MP3/FLAC/M4A/WAV/OGG 解码、Web Audio、较大音频的 Range 跳转、快速切歌及混合队列。
- 验证隐藏窗口连续播放、托盘、单实例、系统媒体键、退出释放、断开磁盘后的索引和重新关联。
- 验证网易云扫码、DPAPI 登录恢复、失效重新登录；《100种生活》须用真实账号区分资源权限与加载错误。
- 在朋友电脑验证首次安装、覆盖升级、数据保留和 WebView2 缺失时的安装路径。

性能诊断入口使用合成歌曲，可查看 WebView2 实际 GPU 和帧间隔；诊断时主场景暂停渲染，音乐继续。不能由请求高性能 GPU 推断已经使用 RTX 5070 Ti。
