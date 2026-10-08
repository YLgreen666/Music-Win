/** Own the render loop so hidden, cached and disposed pages cannot keep rendering. */
export class PageLifecycle {
  private frameId: number | undefined;
  private active = false;
  private hidden = false;
  private disposed = false;
  private render: FrameRequestCallback;
  private cleanup: () => void;
  private request: typeof requestAnimationFrame;
  private cancel: typeof cancelAnimationFrame;
  constructor(
    render: FrameRequestCallback,
    cleanup: () => void,
    request: typeof requestAnimationFrame = callback => requestAnimationFrame(callback),
    cancel: typeof cancelAnimationFrame = handle => cancelAnimationFrame(handle),
  ) { this.render = render; this.cleanup = cleanup; this.request = request; this.cancel = cancel; }
  get closed() { return this.disposed; }
  start() { if (this.disposed) return; this.active = true; this.schedule(); }
  private schedule() {
    if (!this.active || this.hidden || this.disposed || this.frameId !== undefined) return;
    this.frameId = this.request(time => {
      this.frameId = undefined;
      if (this.disposed || this.hidden || !this.active) return;
      this.render(time);
      this.schedule();
    });
  }
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    if (hidden) this.cancelFrame(); else this.schedule();
  }
  pageHide(persisted: boolean) {
    if (persisted) this.setHidden(true); else this.dispose();
  }
  private cancelFrame() {
    if (this.frameId !== undefined) this.cancel(this.frameId);
    this.frameId = undefined;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.active = false;
    this.cancelFrame();
    this.cleanup();
  }
}
