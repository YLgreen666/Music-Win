import {
  SCAN_FROM,
  SCAN_TO,
  SCAN_CORNERS,
  type DecryptionFrame,
} from "./decryption";

export function inspectionSegments(frame: DecryptionFrame) {
  const point = (t: number): [number, number] => [
    SCAN_FROM[0] + (SCAN_TO[0] - SCAN_FROM[0]) * t,
    SCAN_FROM[1] + (SCAN_TO[1] - SCAN_FROM[1]) * t,
  ];
  return frame.intervals.map(([a, b]) => [point(a), point(b)] as const);
}

export class InspectionOverlay {
  private setAttribute(node: Element, key: string, value: string) { if (node.getAttribute(key) !== value) node.setAttribute(key, value); }
  private opacity(node: SVGElement | HTMLElement, value: number) { const text = String(value); if (node.style.opacity !== text) node.style.opacity = text; }
  private root = document.querySelector<SVGSVGElement>("#inspection-marks")!;
  private line = this.root.querySelector<SVGPathElement>("#inspection-lines")!;
  private corners = this.root.querySelector<SVGGElement>(
    "#inspection-corners",
  )!;
  private point =
    this.root.querySelector<SVGCircleElement>("#inspection-point")!;
  private label = document.querySelector<HTMLElement>("#inspection-text")!;
  private cornerNodes = SCAN_CORNERS.map(() => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    node.setAttribute('width', '8'); node.setAttribute('height', '8'); this.corners.appendChild(node); return node;
  });

  render(
    frame: DecryptionFrame,
    project: (x: number, y: number) => number[],
    showLabel: boolean,
    enabled = true,
  ) {
    const host = document.querySelector<HTMLElement>("#three-scene")!;
    this.setAttribute(this.root, "viewBox", `0 0 ${host.clientWidth} ${host.clientHeight}`);
    this.opacity(this.root,
      enabled && (frame.intervals.length || frame.markers > 0 || frame.point > 0)
        ? 1
        : 0);
    if (this.root.dataset.phase !== frame.phase) this.root.dataset.phase = frame.phase;
    const referenceTime = frame.time.toFixed(3); if (this.root.dataset.referenceTime !== referenceTime) this.root.dataset.referenceTime = referenceTime;
    this.setAttribute(this.line,
      "d",
      inspectionSegments(frame)
        .map(([a, b]) => `M${project(...a)}L${project(...b)}`)
        .join(""),
    );
    this.opacity(this.corners, frame.markers);
    if (frame.markers > 0) SCAN_CORNERS.forEach(([x, y], i) => {
      const [px, py] = project(x, y); this.setAttribute(this.cornerNodes[i], 'x', String(px - 4)); this.setAttribute(this.cornerNodes[i], 'y', String(py - 4));
    });
    if (frame.point > 0) {
      const [cx, cy] = project(
        (SCAN_FROM[0] + SCAN_TO[0]) / 2,
        (SCAN_FROM[1] + SCAN_TO[1]) / 2,
      );
      this.setAttribute(this.point, "cx", String(cx)); this.setAttribute(this.point, "cy", String(cy));
    }
    this.opacity(this.point, frame.point); this.opacity(this.label, enabled && showLabel ? frame.label : 0);
    this.opacity(this.label.querySelector<HTMLElement>('strong')!, frame.labelValue);
  }
}
