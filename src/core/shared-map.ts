import { v } from "./math";
import { emptyProject, makeRoad } from "./model";
import type { Port, Project, Road, V } from "./types";

// Transcribed from the map JSON shared in chat. Straight control points that
// lie on the same line use makeRoad's equivalent cubic controls.
const road = (
  id: string,
  name: string,
  start: V,
  end: V,
  options: Partial<Road>,
  first?: V,
  second?: V,
) => makeRoad(start, end, { id, name, ...options }, first, second);

export function sharedRoadMap(): Project {
  const p = emptyProject();
  p.name = "车道过渡实验";
  p.trafficMultiplier = 4;
  p.roads = [
    road(
      "r-mw3lvb4e-4nt",
      "双向四车道",
      v(-90, 155, 8),
      v(37.70132054827303, 155, 8),
      { twoWay: true, lanesStart: 2, lanesEnd: 2, width: 3.5, speed: 60 },
    ),
    road(
      "r-mw3lwff9-1vwh",
      "双向六车道",
      v(37.70132054827303, 155, 8),
      v(111.1716955142971, 155, 8),
      { twoWay: true, lanesStart: 3, lanesEnd: 3, width: 3.5, speed: 60 },
    ),
    road(
      "r-mw3lwrlf-23jp",
      "双向四车道",
      v(111.1716955142971, 155, 8),
      v(186.03930430204525, 155, 8),
      { twoWay: true, lanesStart: 2, lanesEnd: 2, width: 3.5, speed: 60 },
    ),
    road(
      "r-mw3lxibt-2pcw",
      "双向六车道",
      v(186.77264323298425, 155.1231435504194),
      v(320.4807838269488, 155.1231435504194),
      { twoWay: true, lanesStart: 3, lanesEnd: 3, width: 3.5, speed: 60 },
    ),
    road(
      "r-mw3ni79w-ikv",
      "匝道汇入并道",
      v(-74.55644880099267, -23.15158109233075),
      v(-19.40674762241381, -23.15158109233075),
      { lanesStart: 3, lanesEnd: 2, width: 3.6, speed: 100, align: "left" },
    ),
    road(
      "r-mw3ni79w-ikw",
      "合流主线",
      v(-139.55644880099265, -24.951581092330752),
      v(-74.55644880099267, -24.951581092330752),
      { lanesStart: 2, lanesEnd: 2, width: 3.6, speed: 100 },
    ),
    road(
      "r-mw3ni79w-ikx",
      "平滑汇入匝道",
      v(-139.55644880099265, 12.44841890766925),
      v(-74.55644880099267, -19.55158109233075),
      { lanesStart: 1, lanesEnd: 1, width: 3.6, speed: 40, kind: "ramp" },
      v(-113.55644880099265, 12.44841890766925),
      v(-103.80644880099267, -19.55158109233075),
    ),
    road(
      "r-mw3nidly-jzq",
      "单向两车道",
      v(-200, -25),
      v(-139.55644880099265, -24.85158109233075),
      { lanesStart: 2, lanesEnd: 2, width: 3.5, speed: 60 },
      v(-179.8521496003309, -24.950527030776918),
      v(-159.7043599409131, -24.851581092330747),
    ),
    road(
      "r-mw3nk6ej-oh1",
      "匝道汇入并道",
      v(-75, 25),
      v(30.724350208196697, 25),
      { lanesStart: 3, lanesEnd: 2, width: 3.6, speed: 100, align: "left" },
    ),
    road("r-mw3nk6ej-oh2", "合流主线", v(-140, 23.2), v(-75, 23.2), {
      lanesStart: 2,
      lanesEnd: 2,
      width: 3.6,
      speed: 100,
    }),
    road(
      "r-mw3nk6ej-oh3",
      "平滑汇入匝道",
      v(-140, 60.6),
      v(-75, 28.6),
      { lanesStart: 1, lanesEnd: 1, width: 3.6, speed: 40, kind: "ramp" },
      v(-114, 60.6),
      v(-104.25, 28.6),
    ),
    road(
      "r-mw3nkjvc-t3l",
      "单向两车道",
      v(-200, 25),
      v(-140, 23.3),
      { lanesStart: 2, lanesEnd: 2, width: 3.5, speed: 60 },
      v(-180, 24.433333333333334),
      v(-160.00802616729374, 23.3),
    ),
    road(
      "r-mw3no3vs-16nq",
      "单向两车道",
      v(-200, -65),
      v(-129.63929992268834, -65),
      { lanesStart: 2, lanesEnd: 2, width: 3.5, speed: 60 },
    ),
    road(
      "r-mw3no79n-1aus",
      "单向单车道",
      v(-129.63929992268834, -66.75),
      v(-69.9403009484131, -66.75),
      { lanesStart: 1, lanesEnd: 1, width: 3.5, speed: 50 },
    ),
    road(
      "r-mw3npj7k-1sf7",
      "单向单车道",
      v(-129.63929992268834, -63.25),
      v(-90, -55),
      { lanesStart: 1, lanesEnd: 1, width: 3.5, speed: 50 },
      v(-116.14305930061205, -63.25),
      v(-99.16703056392603, -60.5),
    ),
    road(
      "r-mw3nprtf-23nb",
      "单向单车道",
      v(-90, -55),
      v(-60.131845982986476, -47.38410708402954),
      { lanesStart: 1, lanesEnd: 1, width: 3.5, speed: 50 },
      v(-81.18950224849952, -49.713911195633756),
      v(-70.30334372895067, -46.86603913419975),
    ),
    road("r-mw3nqf5l-2fjj", "单向两车道", v(-280, -65), v(-200, -65), {
      lanesStart: 2,
      lanesEnd: 2,
      width: 3.5,
      speed: 60,
    }),
    road(
      "r-mw3nxjzp-4oc",
      "双向四车道",
      v(-280, -100),
      v(-79.506365765422, -100),
      { twoWay: true, lanesStart: 2, lanesEnd: 2, width: 3.5, speed: 60 },
    ),
  ];
  const port = (
    road: string,
    end: Port["end"],
    type: Port["type"],
    rate = 30,
  ): Port => ({ road, end, type, rate });
  p.ports = [
    port("r-mw3nidly-jzq", "start", "source"),
    port("r-mw3ni79w-ikx", "start", "source"),
    port("r-mw3ni79w-ikv", "end", "sink", 1),
    port("r-mw3lvb4e-4nt", "start", "both"),
    port("r-mw3lwrlf-23jp", "end", "both"),
    port("r-mw3lxibt-2pcw", "start", "both"),
    port("r-mw3lxibt-2pcw", "end", "both"),
    port("r-mw3nk6ej-oh1", "end", "sink", 1),
    port("r-mw3nk6ej-oh3", "start", "source"),
    port("r-mw3nkjvc-t3l", "start", "source"),
    port("r-mw3no79n-1aus", "end", "sink", 1),
    port("r-mw3nprtf-23nb", "end", "sink", 1),
    port("r-mw3nqf5l-2fjj", "start", "source"),
    port("r-mw3nxjzp-4oc", "start", "both"),
    port("r-mw3nxjzp-4oc", "end", "both"),
  ];
  return p;
}
