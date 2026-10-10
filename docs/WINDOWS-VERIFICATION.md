# Windows 首包验证记录

日期：2026-10-10。音乐播放器基线 `17b4a7f`，应用代码 `ee6f4f0`，分支 `codex/windows-app`，仅上传用户仓库 `YLgreen666/Music-Win`。上游 `origin` 未推送，未恢复临时网站。

## 自动检查

首包构建：[Windows app #2](https://github.com/YLgreen666/Music-Win/actions/runs/38052802134)。构建环境为 GitHub 托管 Windows 2022，目标 `x86_64-pc-windows-msvc`。

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

当前实机修正版文件 `Rhine Music_0.1.0_x64-setup.exe`，35,568,487 字节（33.92 MiB），放在 `release/windows-cloud/`。安装器 SHA256 与云端结果一致：`71DE7E29A802B0E238181295BE4FFFEAC61A17C4D08CC1F389B57C224545A603`。首包已被此修正版替换。

安装、升级、文件重新关联、网页数据迁移及开发说明见 [WINDOWS-APP.md](WINDOWS-APP.md)。默认关闭收起托盘，彻底退出使用托盘“退出”；重启恢复队列和进度时保持暂停。

## 尚待实机验收

本记录没有把云端构建当作 WebView2 播放验证。首轮云端交付时未实际安装或运行；后续本机启动检查见下文。大文件进度跳转、账号播放与朋友电脑验收仍待完成。

- 在本机验证原始画质、两种外观、拖动/抽取/归位/查看器和中文路径导入。
- 验证 MP3/FLAC/M4A/WAV/OGG 解码、Web Audio、较大音频的 Range 跳转、快速切歌及混合队列。
- 验证隐藏窗口连续播放、托盘、单实例、系统媒体键、退出释放、断开磁盘后的索引和重新关联。
- 验证网易云扫码、DPAPI 登录恢复、失效重新登录；《100种生活》须用真实账号区分资源权限与加载错误。
- 在朋友电脑验证首次安装、覆盖升级、数据保留和 WebView2 缺失时的安装路径。

性能诊断入口使用合成歌曲，可查看 WebView2 实际 GPU 和帧间隔；诊断时主场景暂停渲染，音乐继续。不能由请求高性能 GPU 推断已经使用 RTX 5070 Ti。

## 本机安装检查（2026-10-10）

用户指定安装目录 `C:\TxApp\Code\Codes\Music Player\Win`。NSIS 当前用户安装返回 0，卸载记录的 InstallLocation 与该目录一致，生成 `rhine-music.exe` 和 `uninstall.exe`。本地 `Win/` 通过 Git 的本地 exclude 排除，不上传运行文件。

实际启动主窗口、WebView2 和完整开场。初版进入主界面后发现 viewport 的百分比高度没有确定的父高度，内容被裁掉；`411d3ef` 改为 `100dvh`，覆盖安装后主界面、三维背景、导航和播放条均完整显示。第二次启动沿用已完成首次开场的偏好，直接短入场。

Windows 原生音乐与 LRC 选择框成功打开，并用 Escape 取消；没有导入个人音乐或改变网页音乐库。应用自身及直接/次级子进程为 `rhine-music.exe`、`msedgewebview2.exe`，未产生 Node 服务。

诊断窗口实测发现同步命令创建 WebView2 会停在白屏；`695b9ba` 将创建命令改为 async，遵循 [Tauri 的 Windows 窗口创建约束](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html)。

最终修正版：[Windows app #4](https://github.com/YLgreen666/Music-Win/actions/runs/38055106793)，应用代码 `695b9ba`。50 项播放器测试、TypeScript、网页/桌面构建、Rust 格式、2 项 Rust 测试、Clippy 与 NSIS 打包全部通过。再次覆盖安装返回 0，主窗口保持响应。

修正版诊断窗口实际加载成功。WebGL 报告 `ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti Laptop GPU (0x00002F58), Direct3D11)`，确认本次 WebView2 使用独显；原始画质保持不变。诊断页面生成的 WAV 测试音频通过 HTMLAudioElement 播放，显示“播放中”及递增进度，Web Audio 驱动的 spectrumActivity 响应。关闭诊断后测试音频停止，主窗口恢复，未将测试歌曲写入个人音乐库。

这次仅确认启动、原生选择框、GPU、合成 WAV 与诊断开关；没有完成三轮性能基准或音频格式/Range/网易云/托盘连续播放的完整回归。离开时保持主窗口打开，应用音乐库仍为空，可导入文件、迁移网页备份或自行连接网易云。
