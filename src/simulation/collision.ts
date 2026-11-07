import type { V } from "../core/types";
export type Body = { position: V; heading: number; id: number };
export function bodiesOverlap(a: Body, b: Body, padding = 0.12) {
  if (Math.abs(a.position.y - b.position.y) > 1.8) return false;
  const dx = b.position.x - a.position.x,
    dz = b.position.z - a.position.z;
  if (dx * dx + dz * dz > 32) return false;
  const ac = Math.cos(a.heading),
    as = Math.sin(a.heading),
    bc = Math.cos(b.heading),
    bs = Math.sin(b.heading),
    halfL = 1.9 + padding,
    halfW = 0.825 + padding;
  for (const [x, z] of [
    [ac, as],
    [-as, ac],
    [bc, bs],
    [-bs, bc],
  ]) {
    const distance = Math.abs(dx * x + dz * z),
      ra =
        halfL * Math.abs(ac * x + as * z) + halfW * Math.abs(-as * x + ac * z),
      rb =
        halfL * Math.abs(bc * x + bs * z) + halfW * Math.abs(-bs * x + bc * z);
    if (distance >= ra + rb) return false;
  }
  return true;
}
export class TrafficIndex<T extends Body> {
  constructor(private padding = 0.12) {}
  private cells = new Map<string, Set<T>>();
  private keys = new Map<number, string>();
  private key(p: V) {
    return `${Math.floor(p.x / 10)},${Math.floor(p.z / 10)}`;
  }
  add(body: T) {
    const key = this.key(body.position);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = new Set();
      this.cells.set(key, cell);
    }
    cell.add(body);
    this.keys.set(body.id, key);
  }
  update(body: T) {
    const old = this.keys.get(body.id);
    if (old) this.cells.get(old)?.delete(body);
    this.add(body);
  }
  remove(body: T) {
    const key = this.keys.get(body.id);
    if (key) this.cells.get(key)?.delete(body);
    this.keys.delete(body.id);
  }
  near(p: V) {
    const x = Math.floor(p.x / 10),
      z = Math.floor(p.z / 10),
      result: T[] = [];
    for (let a = x - 1; a <= x + 1; a++)
      for (let b = z - 1; b <= z + 1; b++) {
        const cell = this.cells.get(`${a},${b}`);
        if (cell) result.push(...cell);
      }
    return result;
  }
  blocked(body: T) {
    return this.near(body.position).some(
      (other) =>
        other.id !== body.id && bodiesOverlap(body, other, this.padding),
    );
  }
}
