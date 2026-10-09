/** Only finished resources are pooled. Active animations are never capped. */
export class ResourcePool<T> {
  private idle: T[] = [];
  private limit: number;
  private destroy: (value: T) => void;
  constructor(limit: number, destroy: (value: T) => void) { this.limit = limit; this.destroy = destroy; }
  acquire() { return this.idle.pop(); }
  release(value: T) { if (this.idle.length < this.limit) this.idle.push(value); else this.destroy(value); }
  get size() { return this.idle.length; }
  dispose() { this.idle.forEach(this.destroy); this.idle.length = 0; }
}
