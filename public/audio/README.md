# Observatory / 观测室

三个 Ogg 文件为本项目原创程序编配的同步循环声部，MP3 是带首尾淡变的独立试听版。配乐无原片采样、无外部录音、无人声。

源谱及合成：`scripts/render-audio.mjs`；音效合成：`src/audio.ts`。
生成数据：`score.json`。随项目采用仓库 LICENSE。

## 逐字输入短音

音乐播放器版本的逐字输入音效由 Web Audio 振荡器和滤波噪声生成，不再使用上游视频采样。`typing-source.json` 与提取脚本仅保留历史来源说明；采样音频及其编码模块已移除。背景配乐默认关闭，交互音效独立控制。

提取脚本：`scripts/extract-typing-audio.mjs`。原片短音仅去直流、做边缘淡变和统一增益，没有变调、变速或合成替换。`reference/typing-original.wav` 为本地对照片段，不属于生产配乐。
