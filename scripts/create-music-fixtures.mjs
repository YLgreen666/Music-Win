import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('.cache/music-fixtures');
await mkdir(root, { recursive: true });
const chunk = (id, data) => { const header = Buffer.alloc(8); header.write(id); header.writeUInt32LE(data.length, 4); return Buffer.concat([header, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]); };
const text = value => Buffer.concat([Buffer.from([3]), Buffer.from(value)]);
const syncSafe = n => Buffer.from([(n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127]);
const frame = (id, data) => Buffer.concat([Buffer.from(id), syncSafe(data.length), Buffer.alloc(2), data]);
// Original test audio, generated from sine waves. No third-party music is bundled.
for (let song = 1; song <= 3; song++) {
  const sampleRate = 22050, seconds = 12, pcm = Buffer.alloc(sampleRate * seconds * 2);
  for (let i = 0; i < sampleRate * seconds; i++) { const envelope = Math.min(1, i / 1200, (sampleRate * seconds - i) / 1200); pcm.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * (220 + song * 55) / sampleRate) * 2000 * envelope), i * 2); }
  const format = Buffer.alloc(16); format.writeUInt16LE(1); format.writeUInt16LE(1, 2); format.writeUInt32LE(sampleRate, 4); format.writeUInt32LE(sampleRate * 2, 8); format.writeUInt16LE(2, 12); format.writeUInt16LE(16, 14);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrrsAAAAASUVORK5CYII=', 'base64');
  const tags = Buffer.concat([frame('TIT2', text(`观测室 ${song}`)), frame('TPE1', text('Rhine Test')), frame('TALB', text(song < 3 ? '玻璃之声' : '静谧轨道')), frame('TRCK', text(`${song}`)), frame('APIC', Buffer.concat([Buffer.from([3]), Buffer.from('image/png\0'), Buffer.from([3, 0]), png]))]);
  const id3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0]), syncSafe(tags.length), tags]);
  const body = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', format), chunk('id3 ', id3), chunk('data', pcm)]);
  const header = Buffer.alloc(8); header.write('RIFF'); header.writeUInt32LE(body.length, 4);
  await writeFile(resolve(root, `track-${song}.wav`), Buffer.concat([header, body]));
  await writeFile(resolve(root, `track-${song}.lrc`), `[ar:Rhine Test]\n[00:00.00]观测室 ${song}\n[00:02.00]玻璃映出音乐的轮廓\n[00:05.00]在安静中继续播放\n[00:08.00]下一段旅程即将开始\n`);
}
await writeFile(resolve(root, 'broken.mp3'), 'This fixture is intentionally not decodable audio.');
console.log(root);
