import { parseBlob } from 'music-metadata';
import { thumbnail } from './thumbnail';

self.onmessage = async (event: MessageEvent<{ id: number; file: File }>) => {
  const { id, file } = event.data;
  try {
    const metadata = await parseBlob(file, { duration: true, skipCovers: false });
    const picture = metadata.common.picture?.[0];
    let cover: Blob | undefined;
    if (picture) cover = await thumbnail(new Blob([new Uint8Array(picture.data)], { type: picture.format }));
    self.postMessage({ id, metadata: {
      title: metadata.common.title, artist: metadata.common.artist,
      album: metadata.common.album, albumArtist: metadata.common.albumartist,
      trackNumber: metadata.common.track.no ?? 0, duration: metadata.format.duration ?? 0,
      format: metadata.format.codec || metadata.format.container || file.name.split('.').pop(), cover,
    } });
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : '无法读取音乐标签' }); }
};
