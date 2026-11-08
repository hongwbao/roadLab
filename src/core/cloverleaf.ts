import { v } from "./math";
import { LANE_WIDTH } from "./road-standards";
import type { Project, Road, V } from "./types";

type RoadFactory = (
  start: V,
  end: V,
  options?: Partial<Road>,
  first?: V,
  second?: V,
) => Road;

/** Free-flow cloverleaf: two through lanes plus two collector lanes per direction. */
export function cloverleafExample(makeRoad: RoadFactory): Project {
  const project: Project = {
    version: 1,
    name: "苜蓿叶立交 · 2主线＋2辅道",
    roads: [],
    connections: [],
    ports: [],
    templates: [],
    trafficMultiplier: 1,
  };
  const directions = ["东行", "南行", "西行", "北行"];
  const keys = ["east", "south", "west", "north"];
  const collectors: Road[][] = [];
  const nodes = [-440, -380, -82, 82, 380, 440];
  const height = (direction: number) => (direction % 2 ? 12 : 0);
  const rotate = (x: number, z: number, y: number, direction: number): V => {
    switch (direction % 4) {
      case 1:
        return v(-z, x, y);
      case 2:
        return v(-x, -z, y);
      case 3:
        return v(z, -x, y);
      default:
        return v(x, z, y);
    }
  };
  const add = (road: Road) => {
    project.roads.push(road);
    return road;
  };
  for (let direction = 0; direction < 4; direction++) {
    const name = directions[direction],
      key = keys[direction],
      y = height(direction);
    const at = (x: number, z: number) => rotate(x, z, y, direction);
    const options = { width: LANE_WIDTH, highwayRules: true, speed: 100 };
    const incoming = add(
      makeRoad(at(-540, 16), at(-440, 16), {
        ...options,
        id: `cloverleaf-${key}-in`,
        name: `${name} · 入口（4车道）`,
        lanesStart: 4,
        lanesEnd: 4,
      }),
    );
    const outgoing = add(
      makeRoad(at(440, 16), at(540, 16), {
        ...options,
        id: `cloverleaf-${key}-out`,
        name: `${name} · 出口（4车道）`,
        lanesStart: 4,
        lanesEnd: 4,
      }),
    );
    const main = add(
      makeRoad(at(-440, 12), at(440, 12), {
        ...options,
        id: `cloverleaf-${key}-main`,
        name: `${name} · 独立直行主线（2车道）`,
        attachments: {
          start: { road: incoming.id, end: 1, lanes: [0, 1], ownLanes: [0, 1] },
          end: { road: outgoing.id, end: 0, lanes: [0, 1], ownLanes: [0, 1] },
        },
      }),
    );
    const mainXs = [-440, -380, 380, 440];
    const mainZs = [12, 8, 8, 12];
    main.knots = mainXs.map((x, index) => ({
      p: at(x, mainZs[index]),
      incoming: at(
        index === 0 ? x : x - (x - mainXs[index - 1]) / 3,
        mainZs[index],
      ),
      outgoing: at(
        index === 3 ? x : x + (mainXs[index + 1] - x) / 3,
        mainZs[index],
      ),
      at: (x + 440) / 880,
    }));
    const parts = nodes.slice(0, -1).map((from, index) =>
      add(
        makeRoad(
          at(from, index === 0 ? 20 : 24),
          at(nodes[index + 1], index === nodes.length - 2 ? 20 : 24),
          {
            ...options,
            speed: 70,
            id: `cloverleaf-${key}-collector-${index}`,
            name: `${name} · 辅道 ${index + 1}（2车道）`,
            attachments: {
              ...(index === 0
                ? {
                    start: {
                      road: incoming.id,
                      end: 1 as const,
                      lanes: [2, 3],
                      ownLanes: [0, 1],
                    },
                  }
                : {}),
              ...(index === nodes.length - 2
                ? {
                    end: {
                      road: outgoing.id,
                      end: 0 as const,
                      lanes: [2, 3],
                      ownLanes: [0, 1],
                    },
                  }
                : {}),
            },
          },
          at(from + (nodes[index + 1] - from) / 3, index === 0 ? 20 : 24),
          at(
            nodes[index + 1] - (nodes[index + 1] - from) / 3,
            index === nodes.length - 2 ? 20 : 24,
          ),
        ),
      ),
    );
    collectors.push(parts);
    project.ports.push(
      { road: incoming.id, end: "start", type: "source", rate: 72 },
      { road: outgoing.id, end: "end", type: "sink", rate: 1 },
    );
  }
  const ramp = (direction: number, left: boolean) => {
    const target = (direction + (left ? 3 : 1)) % 4;
    const segments = left ? 3 : 1;
    const radius = left ? 56 : 354;
    const cx = left ? 82 : -380,
      cz = left ? 82 : 380;
    const delta = height(target) - height(direction);
    const step = Math.PI / 2;
    // Stay level until the fork's full paved footprint has separated. Then
    // ease into the grade, keeping both endpoint tangents horizontal.
    const flat = (left ? 28 : 64) / (radius * step * segments);
    const fractions = [
      ...new Set([
        0,
        flat,
        ...Array.from({ length: segments - 1 }, (_, i) => (i + 1) / segments),
        1 - flat,
        1,
      ]),
    ].sort((a, b) => a - b);
    const knots = fractions.map((t, index) => {
      const angle = -Math.PI / 2 + t * step * segments;
      const x = cx + radius * Math.cos(angle),
        z = cz + radius * Math.sin(angle);
      const q = Math.max(0, Math.min(1, (t - flat) / (1 - 2 * flat)));
      const y = height(direction) + delta * q * q * (3 - 2 * q);
      const dy = (delta * 6 * q * (1 - q)) / (1 - 2 * flat);
      const control = (other: number, sign: number) => {
        const dt = Math.abs(other - t),
          handle = ((radius * 4) / 3) * Math.tan((dt * step * segments) / 4);
        return rotate(
          x - sign * Math.sin(angle) * handle,
          z + sign * Math.cos(angle) * handle,
          y + (sign * dy * dt) / 3,
          direction,
        );
      };
      const p = rotate(x, z, y, direction);
      return {
        p,
        incoming: index ? control(fractions[index - 1], -1) : { ...p },
        outgoing:
          index < fractions.length - 1
            ? control(fractions[index + 1], 1)
            : { ...p },
        at: t,
      };
    });
    const road = makeRoad(knots[0].p, knots.at(-1)!.p, {
      id: `cloverleaf-${keys[direction]}-${left ? "left" : "right"}`,
      name: `${directions[direction]} → ${directions[target]} · ${left ? "苜蓿叶环形" : "外侧右转"}匝道`,
      lanesStart: 1,
      lanesEnd: 1,
      width: LANE_WIDTH,
      kind: "ramp",
      speed: left ? 35 : 60,
      highwayRules: true,
      attachments: {
        start: {
          road: collectors[direction][left ? 2 : 0].id,
          end: 1,
          lanes: [1],
          ownLanes: [0],
        },
        end: {
          road: collectors[target][left ? 2 : 4].id,
          end: 0,
          lanes: [1],
          ownLanes: [0],
        },
      },
    });
    road.knots = knots;
    add(road);
  };
  for (let direction = 0; direction < 4; direction++) {
    ramp(direction, true);
    ramp(direction, false);
  }
  return project;
}
