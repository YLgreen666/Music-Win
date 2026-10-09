import * as THREE from 'three';
import type { Track } from './types.ts';
import { coverFrame, coverCrop, dominantCoverColor, placeholderColor } from './cover-design.ts';
import { loadMusicCover } from './assets.ts';
import { CoverSlots } from './cover-slots.ts';
import { InstanceUpdates } from '../instance-updates.ts';
import { copyAtlasTile } from './atlas-pixels.ts';
export type CoverInstance = { matrix?: THREE.Matrix4; array?: ArrayLike<number>; offset?: number; track?: Track; priority?: number };
type DecodedCover = Awaited<ReturnType<typeof decodeCover>>;
type CoverJob = { track: Track; source?: Blob; sourceUrl?: string; slot: number; generation: number; ticket: number; controller: AbortController };
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
  private texture: THREE.DataTexture;
  private pixels = new Uint8Array(2048 * 2048 * 4);
  private dirtySlots = new Set<number>();
  private forceFullUpload = true;
  private uploadedVersion = -1;
  private residency = new CoverSlots();
  private slots = this.residency.slots;
  private sources = new Map<string, Blob | undefined>();
  private sourceUrls = new Map<string, string | undefined>();
  private colors = new Map<string, THREE.Color>();
  private fallbackColor = new THREE.Color().setRGB(...placeholderColor, THREE.SRGBColorSpace);
  private uvSlots: THREE.InstancedBufferAttribute;
  private ticket = 0;
  private loading = new Map<string, AbortController>();
  private desired = new Map<string, Track>();
  private priorities = new Map<string, number>();
  private candidates: Track[] = [];
  private jobs: CoverJob[] = [];
  private completed: { job: CoverJob; bitmap: DecodedCover }[] = [];
  private active = 0;
  private dirty = false;
  private matrixUpdates: InstanceUpdates;
  private slotUpdates: InstanceUpdates;
  private sample = document.createElement('canvas');
  private stats = { decodes: 0, commits: 0, evictions: 0, matrixCommits: 0, slotCommits: 0, stagedBytes: 0 };
  private placement = new THREE.Matrix4().makeTranslation(0, coverFrame.centerY, coverFrame.depth);
  private matrix = new THREE.Matrix4();
  private capacity = 512;
  constructor() {
    this.canvas.width = this.canvas.height = 2048;
    // Color sampling reads this canvas. Keep it on the CPU from the first draw,
    // avoiding a GPU -> CPU readback of the atlas during every cover completion.
    this.canvas.getContext('2d', { willReadFrequently: true });
    this.texture = new THREE.DataTexture(this.pixels, 2048, 2048, THREE.RGBAFormat);
    this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 4;
    this.texture.magFilter = THREE.LinearFilter; this.texture.minFilter = THREE.LinearMipmapLinearFilter; this.texture.generateMipmaps = true;
    this.texture.onUpdate = () => { this.forceFullUpload = false; };
    for (let slot = 0; slot < 64; slot++) this.placeholder(slot);
    this.uvSlots = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    const geometry = new THREE.PlaneGeometry(coverFrame.width, coverFrame.height); geometry.setAttribute('musicSlot', this.uvSlots);
    const material = new THREE.MeshBasicMaterial({ map: this.texture, side: THREE.DoubleSide, toneMapped: false });
    material.onBeforeCompile = shader => {
      // Slot IDs are discrete per instance. Perspective interpolation can put
      // 8 just below 8, making mod/floor sample the previous atlas row/column.
      shader.vertexShader = 'attribute float musicSlot;\nflat varying float vMusicSlot;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvMusicSlot = musicSlot;');
      shader.fragmentShader = 'flat varying float vMusicSlot;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          float slot = floor(vMusicSlot + 0.5);
          vec2 tile = vec2(mod(slot, 8.0), 7.0 - floor(slot / 8.0));
          vec2 atlasUV = (tile + vec2(0.008) + vMapUv * 0.984) / 8.0;
          diffuseColor *= texture2D(map, atlasUV);
        #endif`);
    };
    material.customProgramCacheKey = () => 'rhine-music-cover-atlas-v2';
    this.mesh = new THREE.InstancedMesh(geometry, material, this.capacity); this.mesh.frustumCulled = false;
    this.mesh.count = 0; this.mesh.visible = false; this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.uvSlots.setUsage(THREE.DynamicDrawUsage);
    this.matrixUpdates = new InstanceUpdates(this.mesh.instanceMatrix); this.slotUpdates = new InstanceUpdates(this.uvSlots);
    this.sample.width = this.sample.height = 32;
  }
  private placeholder(slot: number, title = 'RHINE LAB') {
    const context = this.canvas.getContext('2d')!, x = slot % 8 * 256, y = Math.floor(slot / 8) * 256;
    context.fillStyle = '#d8d0c4'; context.fillRect(x, y, 256, 256);
    context.strokeStyle = '#b6a58d'; context.lineWidth = 2;
    context.beginPath(); context.arc(x + 128, y + 117, 64, 0, Math.PI * 2); context.arc(x + 128, y + 117, 21, 0, Math.PI * 2); context.stroke();
    context.fillStyle = '#6b6051'; context.font = '600 13px MiSans'; context.textAlign = 'center'; context.fillText(title.slice(0, 20), x + 128, y + 218, 228);
    this.dirty = true;
    this.dirtySlots.add(slot);
  }
  private valid(job: CoverJob) {
    return job.ticket === this.ticket && !job.controller.signal.aborted && this.residency.valid(job.track.id, job.slot, job.generation) && this.sources.get(job.track.id) === job.source && job.track.cover === job.source && job.track.coverUrl === job.sourceUrl;
  }
  private cancel(id: string) {
    this.loading.get(id)?.abort(); this.loading.delete(id); this.sources.delete(id);
  }
  private schedule(track: Track, slot: number) {
    this.cancel(track.id); this.sources.set(track.id, track.cover); this.sourceUrls.set(track.id, track.coverUrl); this.colors.set(track.id, this.fallbackColor); this.placeholder(slot, track.title);
    if (!track.cover && !track.coverUrl) return;
    const controller = new AbortController(); this.loading.set(track.id, controller);
    this.jobs.push({ track, source: track.cover, sourceUrl: track.coverUrl, slot, generation: this.residency.generations[slot], ticket: this.ticket, controller });
  }
  private async decode(job: CoverJob) {
    try {
      if (!job.source && job.track.coverUrl) {
        await loadMusicCover(job.track, job.controller.signal);
        if (job.controller.signal.aborted || job.ticket !== this.ticket || job.track.coverUrl !== job.sourceUrl || !this.residency.valid(job.track.id, job.slot, job.generation)) return;
        job.source = job.track.cover; this.sources.set(job.track.id, job.source);
      }
      if (!job.source || !this.valid(job)) return;
      this.stats.decodes++; const bitmap = await decodeCover(job.source);
      if (this.valid(job)) this.completed.push({ job, bitmap }); else bitmap.close();
    } catch { /* Failed covers stay as placeholders; retry after source changes. */ }
    finally { this.active--; if (this.loading.get(job.track.id) === job.controller) this.loading.delete(job.track.id); }
  }
  private flush() {
    for (const { job, bitmap } of this.completed) {
      try {
        if (!this.valid(job)) continue;
        const crop = coverCrop(bitmap.width, bitmap.height), x = job.slot % 8 * 256, y = Math.floor(job.slot / 8) * 256;
        this.canvas.getContext('2d')!.drawImage(bitmap.image, crop.x, crop.y, crop.width, crop.height, x, y, 256, 256);
        this.colors.set(job.track.id, this.sampleColor(this.canvas, x, y, 256)); this.dirty = true; this.dirtySlots.add(job.slot);
      } finally { bitmap.close(); }
    }
    this.completed.length = 0;
  }
  private pump() {
    while (this.active < 2 && this.jobs.length) {
      let priority = -1;
      for (const id of this.desired.keys()) { priority = this.jobs.findIndex(job => job.track.id === id); if (priority >= 0) break; }
      const job = this.jobs.splice(priority < 0 ? 0 : priority, 1)[0];
      if (!this.valid(job)) continue;
      this.active++; void this.decode(job);
    }
  }
  update(instances: CoverInstance[], enabled: boolean, count = instances.length) {
    this.mesh.visible = enabled;
    if (!enabled) {
      this.mesh.count = 0; for (const id of this.loading.keys()) this.cancel(id); this.jobs.length = 0;
      for (const { bitmap, job } of this.completed) { bitmap.close(); this.sources.delete(job.track.id); } this.completed.length = 0; return;
    }
    this.desired.clear(); this.priorities.clear(); this.candidates.length = 0;
    for (let i = 0; i < count; i++) {
      const instance = instances[i], track = instance.track; if (!track) continue;
      const priority = instance.priority ?? i;
      if (!this.priorities.has(track.id)) { this.candidates.push(track); this.priorities.set(track.id, priority); }
      else if (priority < this.priorities.get(track.id)!) this.priorities.set(track.id, priority);
    }
    this.candidates.sort((a, b) => this.priorities.get(a.id)! - this.priorities.get(b.id)! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (let i = 0; i < Math.min(63, this.candidates.length); i++) this.desired.set(this.candidates[i].id, this.candidates[i]);
    this.residency.reconcile(this.desired.keys(), id => { this.cancel(id); this.sourceUrls.delete(id); this.colors.delete(id); this.stats.evictions++; });
    for (const id of this.loading.keys()) if (!this.desired.has(id)) this.cancel(id);
    this.flush();
    // Discard cancelled queue entries even while both decoder slots are busy.
    for (let i = this.jobs.length - 1; i >= 0; i--) if (!this.valid(this.jobs[i])) {
      const job = this.jobs[i]; this.jobs.splice(i, 1); if (this.loading.get(job.track.id) === job.controller) this.cancel(job.track.id);
    }
    for (const [id, track] of this.desired) if (!this.loading.has(id) && (!this.sources.has(id) || this.sources.get(id) !== track.cover || this.sourceUrls.get(id) !== track.coverUrl)) this.schedule(track, this.slots.get(id)!);
    this.pump();
    if (count > this.capacity) {
      // Release the old instance/UV GPU buffers before replacing their attributes.
      this.mesh.dispose(); this.mesh.geometry.dispose();
      this.capacity = Math.max(count, this.capacity * 2);
      this.mesh.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 16), 16).setUsage(THREE.DynamicDrawUsage);
      this.uvSlots = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1); this.mesh.geometry.setAttribute('musicSlot', this.uvSlots);
      this.uvSlots.setUsage(THREE.DynamicDrawUsage); this.matrixUpdates = new InstanceUpdates(this.mesh.instanceMatrix); this.slotUpdates = new InstanceUpdates(this.uvSlots);
    }
    for (let index = 0; index < count; index++) {
      const instance = instances[index];
      if (instance.matrix) this.matrix.copy(instance.matrix); else this.matrix.fromArray(instance.array!, instance.offset ?? 0);
      this.matrix.multiply(this.placement);
      const slot = instance.track ? this.slots.get(instance.track.id) ?? 0 : 0;
      this.matrixUpdates.set(index * 16, this.matrix.elements); this.slotUpdates.scalar(index, slot);
    }
    this.mesh.count = count;
    if (this.matrixUpdates.commit()) this.stats.matrixCommits++;
    if (this.slotUpdates.commit()) this.stats.slotCommits++;
    if (this.dirty) {
      for (const slot of this.dirtySlots) {
        const x = slot % 8 * 256, y = Math.floor(slot / 8) * 256;
        const rgba = this.canvas.getContext('2d')!.getImageData(x, y, 256, 256).data;
        copyAtlasTile(this.pixels, rgba, x, y, 256, 2048, 2048);
        for (let row = 0; row < 256; row++) this.texture.addUpdateRange(((2047 - y - row) * 2048 + x) * 4, 256 * 4);
        this.stats.stagedBytes += 256 * 256 * 4;
      }
      // Large first uploads are cheaper as one transfer. Later uploads touch only
      // changed tiles; mipmaps and filtering stay identical to the original atlas.
      if (this.forceFullUpload || this.texture.updateRanges.length > 2048) this.texture.clearUpdateRanges();
      this.dirtySlots.clear(); this.texture.needsUpdate = true; this.dirty = false; this.stats.commits++;
    }
  }
  get revision() { return [this.texture.version, this.uvSlots.version]; }
  upload(renderer: THREE.WebGLRenderer) {
    if (!this.mesh.visible || this.uploadedVersion === this.texture.version) return;
    // Upload before shadow/beauty draws, rather than interrupting an active pass.
    renderer.initTexture(this.texture); this.uploadedVersion = this.texture.version;
  }
  restoreTexture() { this.uploadedVersion = -1; this.forceFullUpload = true; this.texture.clearUpdateRanges(); this.texture.needsUpdate = true; }
  getStats() { return { ...this.stats, resident: this.slots.size, active: this.active, queued: this.jobs.length, ready: this.completed.length }; }
  async viewerCover(track?: Track) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const context = canvas.getContext('2d')!; context.fillStyle = '#d8d0c4'; context.fillRect(0, 0, 512, 512);
    context.fillStyle = '#6b6051'; context.font = '32px MiSans'; context.textAlign = 'center'; context.fillText(track?.title || 'RHINE LAB', 256, 270, 460);
    if (track?.cover) try {
      const bitmap = await decodeCover(track.cover);
      try { const crop = coverCrop(bitmap.width, bitmap.height); context.drawImage(bitmap.image, crop.x, crop.y, crop.width, crop.height, 0, 0, 512, 512); }
      finally { bitmap.close(); }
    } catch { /* placeholder */ }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(coverFrame.width, coverFrame.height), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false }));
    mesh.position.set(0, coverFrame.centerY, coverFrame.depth); mesh.userData.assemblyPart = 'optical-core'; mesh.userData.surface = 'Music_Cover';
    return { mesh, texture, color: track?.cover ? this.sampleColor(canvas, 0, 0, 512) : this.fallbackColor };
  }
  colorFor(track?: Track) { return track ? this.colors.get(track.id) ?? this.fallbackColor : this.fallbackColor; }
  private sampleColor(image: CanvasImageSource, x: number, y: number, size: number) {
    const context = this.sample.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(image, x, y, size, size, 0, 0, 32, 32);
    return new THREE.Color().setRGB(...dominantCoverColor(context.getImageData(0, 0, 32, 32).data), THREE.SRGBColorSpace);
  }
  dispose() { this.ticket++; for (const request of this.loading.values()) request.abort(); this.loading.clear(); this.jobs.length = 0; for (const { bitmap } of this.completed) bitmap.close(); this.completed.length = 0; this.residency.clear(); this.sources.clear(); this.sourceUrls.clear(); this.colors.clear(); this.desired.clear(); this.priorities.clear(); this.candidates.length = 0; this.dirtySlots.clear(); this.texture.dispose(); this.mesh.dispose(); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.canvas.width = this.canvas.height = this.sample.width = this.sample.height = 1; }
}
