import type { Road } from "./types";
export type RoadAsset = {
  id: string;
  name: string;
  category: "city" | "oneway" | "highway" | "transition";
  description: string;
  action?: "split" | "merge";
  options: Partial<Road>;
};
export const ROAD_ASSETS: RoadAsset[] = [
  {
    id: "city-2",
    name: "双向两车道",
    category: "city",
    description: "每方向 1 车道 · 50 km/h",
    options: {
      twoWay: true,
      lanesStart: 1,
      lanesEnd: 1,
      width: 3.5,
      speed: 50,
      kind: "road",
      align: "center",
    },
  },
  {
    id: "city-4",
    name: "双向四车道",
    category: "city",
    description: "每方向 2 车道 · 60 km/h",
    options: {
      twoWay: true,
      lanesStart: 2,
      lanesEnd: 2,
      width: 3.5,
      speed: 60,
      kind: "road",
      align: "center",
    },
  },
  {
    id: "city-6",
    name: "双向六车道",
    category: "city",
    description: "每方向 3 车道 · 60 km/h",
    options: {
      twoWay: true,
      lanesStart: 3,
      lanesEnd: 3,
      width: 3.5,
      speed: 60,
      kind: "road",
      align: "center",
    },
  },
  {
    id: "one-1",
    name: "单向单车道",
    category: "oneway",
    description: "1 车道 · 50 km/h",
    options: {
      twoWay: false,
      lanesStart: 1,
      lanesEnd: 1,
      width: 3.5,
      speed: 50,
      kind: "road",
      align: "center",
    },
  },
  {
    id: "one-2",
    name: "单向两车道",
    category: "oneway",
    description: "2 车道 · 60 km/h",
    options: {
      twoWay: false,
      lanesStart: 2,
      lanesEnd: 2,
      width: 3.5,
      speed: 60,
      kind: "road",
      align: "center",
    },
  },
  {
    id: "one-3",
    name: "单向三车道",
    category: "oneway",
    description: "3 车道 · 70 km/h",
    options: {
      twoWay: false,
      lanesStart: 3,
      lanesEnd: 3,
      width: 3.5,
      speed: 70,
      kind: "road",
      align: "center",
    },
  },
  {
    id: "one-4",
    name: "单向四车道",
    category: "oneway",
    description: "4 车道 · 70 km/h",
    options: {
      twoWay: false,
      lanesStart: 4,
      lanesEnd: 4,
      width: 3.5,
      speed: 70,
      kind: "road",
      align: "center",
    },
  },
  {
    id: "highway-2",
    name: "两车道高速",
    category: "highway",
    description: "单向 2 车道 · 100 km/h",
    options: {
      twoWay: false,
      lanesStart: 2,
      lanesEnd: 2,
      width: 3.6,
      speed: 100,
      kind: "road",
      align: "center",
    },
  },
  {
    id: "highway-3",
    name: "三车道高速",
    category: "highway",
    description: "单向 3 车道 · 100 km/h",
    options: {
      twoWay: false,
      lanesStart: 3,
      lanesEnd: 3,
      width: 3.6,
      speed: 100,
      kind: "road",
      align: "center",
    },
  },
  {
    id: "ramp-1",
    name: "单车道匝道",
    category: "highway",
    description: "单向 1 车道 · 60 km/h",
    options: {
      twoWay: false,
      lanesStart: 1,
      lanesEnd: 1,
      width: 3.6,
      speed: 60,
      kind: "ramp",
      align: "center",
    },
  },
  {
    id: "ramp-2",
    name: "双车道匝道",
    category: "highway",
    description: "单向 2 车道 · 60 km/h",
    options: {
      twoWay: false,
      lanesStart: 2,
      lanesEnd: 2,
      width: 3.6,
      speed: 60,
      kind: "ramp",
      align: "center",
    },
  },
  {
    id: "widen-23",
    name: "两车道扩为三车道",
    category: "transition",
    description: "向右平滑拓宽 · 100 km/h",
    options: {
      twoWay: false,
      lanesStart: 2,
      lanesEnd: 3,
      width: 3.6,
      speed: 100,
      kind: "road",
      align: "left",
    },
  },
  {
    id: "narrow-32",
    name: "三车道并为两车道",
    category: "transition",
    description: "右侧车道平滑并入 · 100 km/h",
    options: {
      twoWay: false,
      lanesStart: 3,
      lanesEnd: 2,
      width: 3.6,
      speed: 100,
      kind: "road",
      align: "left",
    },
  },
  {
    id: "exit-21",
    name: "两车道主线＋匝道",
    category: "transition",
    description: "2→3 拓宽，再连续分离为 2＋1",
    action: "split",
    options: {
      twoWay: false,
      lanesStart: 2,
      lanesEnd: 3,
      width: 3.6,
      speed: 100,
      kind: "road",
      align: "left",
    },
  },
  {
    id: "merge-32",
    name: "匝道汇入并道",
    category: "transition",
    description: "2＋1 汇为三车道，再并为两车道",
    action: "merge",
    options: {
      twoWay: false,
      lanesStart: 3,
      lanesEnd: 2,
      width: 3.6,
      speed: 100,
      kind: "road",
      align: "left",
    },
  },
];
// Highway behavior is asset metadata, independent of a player's speed setting.
for (const asset of ROAD_ASSETS)
  if (asset.category !== "transition")
    asset.options.highwayRules = asset.category === "highway";

export const getAsset = (id: string) =>
  ROAD_ASSETS.find((a) => a.id === id) || ROAD_ASSETS[0];
export const assetForRoad = (r: Road) =>
  ROAD_ASSETS.find(
    (a) =>
      a.options.twoWay === r.twoWay &&
      a.options.lanesStart === r.lanesStart &&
      a.options.lanesEnd === r.lanesEnd &&
      a.options.kind === r.kind &&
      a.options.speed === r.speed,
  ) ||
  ROAD_ASSETS.find(
    (a) =>
      a.options.twoWay === r.twoWay &&
      a.options.lanesStart === r.lanesStart &&
      a.options.lanesEnd === r.lanesEnd &&
      a.options.kind === r.kind,
  );
