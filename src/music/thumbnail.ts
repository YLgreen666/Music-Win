export async function thumbnail(raw: Blob): Promise<Blob | undefined> {
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(raw);
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvas.convertToBlob({ type: 'image/webp', quality: .85 });
  } catch { return raw.size < 5 * 1024 * 1024 ? raw : undefined; }
  finally { bitmap?.close(); }
}
