# 网易云部分歌曲加载失败（2026-10-10）

## 已知情况与限制

用户截图为卢广仲《100种生活》，旧提示“在线音频加载失败，请检查网络、播放权限或音频跨域访问”。该提示来自 HTMLAudioElement 的 error 事件，发生在获取播放资源之后；旧代码没有保留浏览器错误码，不能据此判断为版权限制或跨域故障。

使用现有 Vercel API 的公开表单 POST 验证：搜索匹配原版歌曲 ID 109616，以及现场版 26601382、109607；未登录的 `/song/url/v1` 均返回歌曲 code 404、url null。这只能说明匿名请求无资源，不能代替用户账号的结果。未读取或转移用户凭据。

公开样本 27591651 返回 MP3、歌曲 code 200。命令行检查 HTTPS 音频为 206/audio-mpeg、Access-Control-Allow-Origin `*`；真实浏览器另一次解析到 m7.music.126.net 后成功播放。不能把所有歌曲加载失败归因于 API 整体故障。

## 修改

- 区分浏览器 MediaError 1/2/3/4，错误包含歌曲标题、错误码与音频服务器主机名。网易云歌曲信息保留本次失败说明；不展示签名播放 URL、路径、参数或账号凭据。
- 在线初次加载遇网络或资源不支持错误时重新获取地址一次；解码失败、无资源或登录失败不反复请求。持续失败清空无效音频资源，恢复可点击的暂停状态。
- 暂停后的在线地址无法恢复播放时重新解析，保留进度。旧的 resume 请求迟到失败不能覆盖已经切换的新歌。
- metadata 成功后的流读取失败也计入连续失败记录，单曲循环、列表循环与随机模式均有界跳过。歌曲实际推进超过一秒后重置连续失败记录；正常播放结束仍遵守原播放模式。
- 已暂停的音频随后报错时释放资源并保留进度，不自动开始下一首。关闭时继续释放音频、Web Audio 与请求。

没有调整原始画质、玻璃、封面或三维动效；没有新增 Node API 服务、代理、音频缓存或部署。

## 验证

`npm test`：44 项通过（新增 6 项），覆盖刷新地址与释放、持续网络/资源失败及解码错误、不泄露签名 URL、metadata 后失败的队列上限、暂停状态晚到错误、过期地址恢复进度、旧 resume 竞争。

`npm run typecheck`、`npm run build` 通过，PWA 离线发行包正常生成；保留既有 Vite 大包提示。

独立浏览器页 `verification/music-playback.html`：不访问账号或 IndexedDB，不改变音乐库。通过本机 Vite 打开后点击按钮，使用真实 Audio 与 MusicPlayer：

| 场景 | 结果 |
| --- | --- |
| 初始地址为同源不存在的音频，刷新后使用程序生成 WAV | 解析 2 次，旧资源释放 1 次，音频进度 1.17 秒，PASS |
| 两次均为不存在的音频 | MEDIA_ERR_4，解析 2 次、释放 2 次，src 清空且暂停，PASS |
| 无登录凭据公开网易云样本 27591651 | MP3 / m7.music.126.net，解析 1 次，实际进度 1.22 秒，PASS |

浏览器验证使用当前应用内 Chromium；不能代替用户 Edge、账号权限和网络环境下《100种生活》的复测。新版需重新点击该歌曲；如果仍失败，以 MEDIA_ERR 编号和主机名继续定位，不应直接推断为会员、下架或跨域问题。

浏览器错误码依据：[MDN MediaError.code](https://developer.mozilla.org/en-US/docs/Web/API/MediaError/code)。API 模块：[song_url_v1.js](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/main/module/song_url_v1.js)。
