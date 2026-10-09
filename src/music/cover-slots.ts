/** Bounded atlas residency; current priority order always wins over cached songs. */
export class CoverSlots {
  readonly slots = new Map<string, number>();
  readonly generations = new Uint32Array(64);
  private recent = new Map<string, number>();
  private wanted = new Set<string>();
  private used = new Set<number>();
  private clock = 0;
  reconcile(ids: Iterable<string>, evict: (id: string) => void) {
    this.clock++; this.wanted.clear(); this.used.clear();
    for (const id of ids) { if (this.wanted.size === 63 && !this.wanted.has(id)) continue; this.wanted.add(id); }
    for (const slot of this.slots.values()) this.used.add(slot);
    for (const id of this.wanted) {
      if (this.slots.has(id)) { this.recent.set(id, this.clock); continue; }
      let slot = 1;
      while (this.used.has(slot) && slot < 64) slot++;
      if (slot === 64) {
        let oldest: string | undefined, age = Infinity;
        for (const candidate of this.slots.keys()) if (!this.wanted.has(candidate) && (this.recent.get(candidate) ?? 0) < age) { oldest = candidate; age = this.recent.get(candidate) ?? 0; }
        if (oldest === undefined) continue;
        slot = this.slots.get(oldest)!; this.slots.delete(oldest); this.recent.delete(oldest); evict(oldest);
      }
      this.generations[slot]++; this.slots.set(id, slot); this.used.add(slot); this.recent.set(id, this.clock);
    }
    return this.wanted;
  }
  valid(id: string, slot: number, generation: number) { return this.slots.get(id) === slot && this.generations[slot] === generation; }
  clear() { this.slots.clear(); this.recent.clear(); this.wanted.clear(); this.used.clear(); for (let i = 0; i < 64; i++) this.generations[i]++; }
}
