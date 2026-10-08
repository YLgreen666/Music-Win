import * as THREE from 'three';
import type { Track } from './types.ts';
type CoverInstance = { matrix: THREE.Matrix4; track?: Track };
async function decodeCover(blob: Blob): Promise<{ image: CanvasImageSource; width: number; height: number; close(): void }> {
  try { const bitmap = await createImageBitmap(blob); return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }; }
  catch {
    // Some image variants decode in the browser image element but not ImageBitmap.
    const url = URL.createObjectURL(blob), image = new Image(); image.src = url;
    try { await image.decode(); return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => { image.src = ''; URL.revokeObjectURL(url); } }; }
    catch (error) { URL.revokeObjectURL(url); throw error; }
  }
}
/** One GPU batch, 64 atlas slots. Library size never determines texture memory. */
export class MusicCoverLayer {
  readonly mesh: THREE.InstancedMesh;
  private canvas = document.createElement('canvas');
  private texture: THREE.CanvasTexture;
  private slots = new Map<string, number>();
  private sources = new Map<string, Blob | undefined>();
  private uvSlots: THREE.InstancedBufferAttribute;
  private ticket = 0;
  private placement = new THREE.Matrix4().makeTranslation(0, 1.55, .12);
  private matrix = new THREE.Matrix4();
  private capacity = 512;
  constructor() {
    this.canvas.width = this.canvas.height = 2048;
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 4;
    for (let slot = 0; slot < 64; slot++) this.placeholder(slot);
    this.uvSlots = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    const geometry = new THREE.PlaneGeometry(2.55, 2.55); geometry.setAttribute('musicSlot', this.uvSlots);
    const material = new THREE.MeshBasicMaterial({ map: this.texture, side: THREE.DoubleSide, toneMapped: false });
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute float musicSlot;\nvarying float vMusicSlot;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvMusicSlot = musicSlot;');
      shader.fragmentShader = 'varying float vMusicSlot;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec2 tile = vec2(mod(vMusicSlot, 8.0), 7.0 - floor(vMusicSlot / 8.0));
          vec2 atlasUV = (tile + vec2(0.008) + vMapUv * 0.984) / 8.0;
          diffuseColor *= texture2D(map, atlasUV);
        #endif`);
    };
    material.customProgramCacheKey = () => 'rhine-music-cover-atlas-v1';
    this.mesh = new THREE.InstancedMesh(geometry, material, this.capacity); this.mesh.frustumCulled = false;
    this.mesh.count = 0; this.mesh.visible = false; this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  private placeholder(slot: number, title = 'RHINE LAB') {
    const context = this.canvas.getContext('2d')!, x = slot % 8 * 256, y = Math.floor(slot / 8) * 256;
    context.fillStyle = '#d8d0c4'; context.fillRect(x, y, 256, 256);
    context.strokeStyle = '#b6a58d'; context.lineWidth = 2;
    context.beginPath(); context.arc(x + 128, y + 117, 64, 0, Math.PI * 2); context.arc(x + 128, y + 117, 21, 0, Math.PI * 2); context.stroke();
    context.fillStyle = '#6b6051'; context.font = '600 13px MiSans'; context.textAlign = 'center'; context.fillText(title.slice(0, 20), x + 128, y + 218, 228);
    this.texture.needsUpdate = true;
  }
  private async paint(track: Track, slot: number) {
    this.placeholder(slot, track.title); if (!track.cover) return;
    const ticket = this.ticket;
    try {
      const bitmap = await decodeCover(track.cover);
      if (ticket !== this.ticket || this.slots.get(track.id) !== slot || this.sources.get(track.id) !== track.cover) { bitmap.close(); return; }
      const size = Math.min(bitmap.width, bitmap.height);
      this.canvas.getContext('2d')!.drawImage(bitmap.image, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, slot % 8 * 256, Math.floor(slot / 8) * 256, 256, 256);
      bitmap.close(); this.texture.needsUpdate = true;
    } catch { /* A damaged cover keeps its placeholder. */ }
  }
  update(instances: CoverInstance[], enabled: boolean) {
    this.mesh.visible = enabled; if (!enabled) { this.mesh.count = 0; return; }
    const desired = new Map<string, Track>();
    for (const instance of instances) if (instance.track && desired.size < 63) desired.set(instance.track.id, instance.track);
    for (const id of this.slots.keys()) if (!desired.has(id)) { this.slots.delete(id); this.sources.delete(id); }
    const used = new Set(this.slots.values());
    for (const [id, track] of desired) {
      if (!this.slots.has(id)) { let slot = 1; while (used.has(slot)) slot++; this.slots.set(id, slot); used.add(slot); }
      if (!this.sources.has(id) || this.sources.get(id) !== track.cover) { this.sources.set(id, track.cover); void this.paint(track, this.slots.get(id)!); }
    }
    if (instances.length > this.capacity) {
      this.capacity = Math.max(instances.length, this.capacity * 2);
      this.mesh.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 16), 16).setUsage(THREE.DynamicDrawUsage);
      this.uvSlots = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1); this.mesh.geometry.setAttribute('musicSlot', this.uvSlots);
    }
    let changed = this.mesh.count !== instances.length;
    for (const [index, instance] of instances.entries()) {
      this.matrix.copy(instance.matrix).multiply(this.placement);
      const slot = instance.track ? this.slots.get(instance.track.id) ?? 0 : 0, array = this.mesh.instanceMatrix.array;
      for (let j = 0; j < 16; j++) if (array[index * 16 + j] !== Math.fround(this.matrix.elements[j])) { changed = true; break; }
      if (this.uvSlots.array[index] !== slot) changed = true;
      this.mesh.setMatrixAt(index, this.matrix); this.uvSlots.setX(index, slot);
    }
    this.mesh.count = instances.length;
    if (changed) { this.mesh.instanceMatrix.needsUpdate = true; this.uvSlots.needsUpdate = true; }
  }
  async viewerCover(track?: Track) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const context = canvas.getContext('2d')!; context.fillStyle = '#d8d0c4'; context.fillRect(0, 0, 512, 512);
    context.fillStyle = '#6b6051'; context.font = '32px MiSans'; context.textAlign = 'center'; context.fillText(track?.title || 'RHINE LAB', 256, 270, 460);
    if (track?.cover) try { const bitmap = await decodeCover(track.cover); const size = Math.min(bitmap.width, bitmap.height); context.drawImage(bitmap.image, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 512, 512); bitmap.close(); } catch { /* placeholder */ }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.55, 2.55), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false }));
    mesh.position.set(0, 1.55, .12); mesh.userData.assemblyPart = 'optical-core'; mesh.userData.surface = 'Music_Cover';
    return { mesh, texture };
  }
  dispose() { this.ticket++; this.slots.clear(); this.sources.clear(); this.texture.dispose(); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
