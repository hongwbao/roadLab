import type { DriverProfile } from "./driving";
export type LaneVehicle = {
  id: number;
  s: number;
  speed: number;
  lane: number;
  step: number;
  route: { road: string; direction: 1 | -1 }[];
  laneChange?: { from: number; to: number };
  connector?: { id?: string; progress: number; length: number };
  driver?: DriverProfile;
};
export type LaneSample = {
  id: number;
  s: number;
  speed: number;
  changing: boolean;
  driver?: DriverProfile;
};
/** Immutable lane occupancy for one integration step, including reserved target lanes. */
export class LaneTraffic {
  private lanes = new Map<string, LaneSample[]>();
  private connectors = new Map<string, LaneSample[]>();
  constructor(cars: LaneVehicle[]) {
    for (const car of cars) {
      const step = car.route[car.step];
      if (!step) continue;
      const from = car.laneChange?.from ?? car.lane,
        to = car.laneChange?.to ?? car.lane;
      const sample: LaneSample = {
        id: car.id,
        s:
          car.s -
          (car.connector
            ? (1 - car.connector.progress) * car.connector.length
            : 0),
        speed: car.speed,
        changing: !!car.laneChange,
        driver: car.driver,
      };
      if (car.connector?.id) {
        const list = this.connectors.get(car.connector.id) ?? [];
        list.push({
          ...sample,
          s: car.connector.progress * car.connector.length,
        });
        this.connectors.set(car.connector.id, list);
      }
      for (
        let lane = Math.floor(Math.min(from, to));
        lane <= Math.ceil(Math.max(from, to));
        lane++
      ) {
        const key = `${step.road}:${step.direction}:${lane}`;
        let list = this.lanes.get(key);
        if (!list) {
          list = [];
          this.lanes.set(key, list);
        }
        list.push(sample);
      }
    }
    for (const list of [...this.lanes.values(), ...this.connectors.values()])
      list.sort((a, b) => a.s - b.s || a.id - b.id);
  }
  neighbours(
    road: string,
    direction: number,
    lane: number,
    s: number,
    exclude: number,
  ) {
    return this.around(
      this.lanes.get(`${road}:${direction}:${lane}`) ?? [],
      s,
      exclude,
    );
  }
  onConnector(id: string, s: number, exclude: number) {
    return this.around(this.connectors.get(id) ?? [], s, exclude);
  }
  /** Source navigation costs count lane objects, including stationary cars. */
  count(
    road: string,
    direction: number,
    lane: number,
    after = -Infinity,
    exclude?: number,
  ) {
    const list = this.lanes.get(`${road}:${direction}:${lane}`) ?? [];
    let lo = 0,
      hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (list[mid].s < after) lo = mid + 1;
      else hi = mid;
    }
    let count = list.length - lo;
    if (exclude !== undefined)
      for (let i = lo; i < list.length; i++)
        if (list[i].id === exclude) {
          count--;
          break;
        }
    return count;
  }
  private around(list: LaneSample[], s: number, exclude: number) {
    let lo = 0,
      hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (list[mid].s < s) lo = mid + 1;
      else hi = mid;
    }
    let leader: LaneSample | undefined, follower: LaneSample | undefined;
    for (let i = lo; i < list.length; i++)
      if (list[i].id !== exclude) {
        leader = list[i];
        break;
      }
    for (let i = lo - 1; i >= 0; i--)
      if (list[i].id !== exclude) {
        follower = list[i];
        break;
      }
    return { leader, follower };
  }
}
