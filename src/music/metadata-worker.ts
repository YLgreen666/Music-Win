import { parseBlob } from 'music-metadata';

self.onmessage = async (event: MessageEvent<{ id: number; file: File }>) => {
  const { id, file } = event.data;
  try {
    const metadata = await parseBlob(file, { duration: true, skipCovers: false });
    const picture = metadata.common.picture?.[0];
    let cover: Blob | undefined;
    if (picture) {
      const raw = new Blob([new Uint8Array(picture.data)], { type: picture.format });
      try {
        const bitmap = await createImageBitmap(raw);
        const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
        const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        cover = await canvas.convertToBlob({ type: 'image/webp', quality: .85 });
      } catch { if (raw.size < 5 * 1024 * 1024) cover = raw; }
    }
    self.postMessage({ id, metadata: {
      title: metadata.common.title, artist: metadata.common.artist,
      album: metadata.common.album, albumArtist: metadata.common.albumartist,
      trackNumber: metadata.common.track.no ?? 0, duration: metadata.format.duration ?? 0,
      format: metadata.format.codec || metadata.format.container || file.name.split('.').pop(), cover,
    } });
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : '无法读取音乐标签' }); }
};
