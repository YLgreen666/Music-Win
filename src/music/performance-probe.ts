import type { WebGLRenderer } from 'three';

export function distribution(values: number[]) {
  const sorted = values.slice().sort((a, b) => a - b);
  const percentile = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : null;
  return { count: sorted.length, p50: percentile(.5), p95: percentile(.95), over50: sorted.filter(value => value > 50).length };
}

/** Opt-in only. Queries are polled asynchronously, never gl.finish/readPixels. */
export class PerformanceProbe {
  private gl: WebGL2RenderingContext;
  private extension: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private pending: { query: WebGLQuery; generation: number }[] = [];
  private active?: WebGLQuery;
  private generation = 0;
  private previous = 0;
  private started = 0;
  private cpu: number[] = [];
  private intervals: number[] = [];
  private gpu: number[] = [];
  private uploads = 0;
  private hooks: (() => void)[] = [];
  private sample(values: number[], value: number) { if (values.length >= 20000) values.splice(0, 10000); values.push(value); }
  constructor(private renderer: WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.extension = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }
  watchTexture(texture: { onUpdate: ((texture: any) => void) | null }) {
    const previous = texture.onUpdate;
    const callback = (value: unknown) => { this.uploads++; previous?.(value); };
    texture.onUpdate = callback;
    this.hooks.push(() => { if (texture.onUpdate === callback) texture.onUpdate = previous; });
  }
  reset() { this.generation++; this.previous = 0; this.cpu.length = this.intervals.length = this.gpu.length = 0; this.uploads = 0; }
  begin(ms: number) {
    this.poll();
    if (this.previous) this.sample(this.intervals, ms - this.previous);
    this.previous = ms; this.started = performance.now();
    if (this.extension && this.pending.length < 8) {
      const query = this.gl.createQuery();
      if (query) { this.active = query; this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query); }
    }
  }
  end() {
    if (this.active && this.extension) {
      this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
      this.pending.push({ query: this.active, generation: this.generation }); this.active = undefined;
    }
    this.sample(this.cpu, performance.now() - this.started);
  }
  private poll() {
    if (!this.extension) return;
    const disjoint = this.gl.getParameter(this.extension.GPU_DISJOINT_EXT);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const item = this.pending[i];
      if (!disjoint && !this.gl.getQueryParameter(item.query, this.gl.QUERY_RESULT_AVAILABLE)) continue;
      if (!disjoint && item.generation === this.generation) this.sample(this.gpu, this.gl.getQueryParameter(item.query, this.gl.QUERY_RESULT) / 1e6);
      this.gl.deleteQuery(item.query); this.pending.splice(i, 1);
    }
  }
  report() {
    this.poll(); const debug = this.gl.getExtension('WEBGL_debug_renderer_info');
    return {
      gpuName: debug ? this.gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : '浏览器未公开显卡型号',
      resolution: [this.gl.drawingBufferWidth, this.gl.drawingBufferHeight], dpr: devicePixelRatio,
      cpu: distribution(this.cpu), interval: distribution(this.intervals), gpu: this.extension ? distribution(this.gpu) : null,
      atlasUploads: this.uploads, memory: { ...this.renderer.info.memory }, programs: this.renderer.info.programs?.length,
    };
  }
  dispose() { for (const item of this.pending) this.gl.deleteQuery(item.query); this.pending.length = 0; this.hooks.forEach(restore => restore()); this.hooks.length = 0; }
}
