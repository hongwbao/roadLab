import { expect, it } from "vitest";
import { emptyProject } from "../src/core/model";
import {
  deleteNamedMap,
  listSavedMaps,
  loadNamedMap,
  saveNamedMap,
} from "../src/core/saved-maps";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    data,
  };
}

it("creates, loads, overwrites and deletes named maps without changing the live map", () => {
  const storage = memoryStorage();
  const project = emptyProject();
  project.name = "原地图";
  const first = saveNamedMap(storage, project, "实验 A");
  project.name = "正在编辑的地图";
  expect(loadNamedMap(storage, first.id).name).toBe("原地图");
  expect(listSavedMaps(storage)).toHaveLength(1);

  const updated = saveNamedMap(storage, project, "实验 A");
  expect(updated.id).toBe(first.id);
  expect(listSavedMaps(storage)).toHaveLength(1);
  expect(loadNamedMap(storage, first.id).name).toBe("正在编辑的地图");

  const second = saveNamedMap(storage, project, "实验 B");
  deleteNamedMap(storage, first.id);
  expect(listSavedMaps(storage).map((save) => save.id)).toEqual([second.id]);
  expect(project.name).toBe("正在编辑的地图");
  expect(() => loadNamedMap(storage, first.id)).toThrow("存档不存在");
});

it("rejects invalid names and reports damaged storage without replacing it", () => {
  const storage = memoryStorage();
  expect(() => saveNamedMap(storage, emptyProject(), " ")).toThrow("存档名称");
  storage.setItem("roadlab:named-maps:v1", "{");
  expect(() => listSavedMaps(storage)).toThrow("无法读取");
  expect(storage.getItem("roadlab:named-maps:v1")).toBe("{");
});
