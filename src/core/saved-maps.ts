import { parseProject } from "./model";
import type { Project } from "./types";

const key = "roadlab:named-maps:v1";
type StoragePort = Pick<Storage, "getItem" | "setItem">;
type SavedMap = {
  id: string;
  name: string;
  savedAt: number;
  project: Project;
};
export type SavedMapInfo = Pick<SavedMap, "id" | "name" | "savedAt"> & {
  roads: number;
};

function read(storage: StoragePort): SavedMap[] {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (
      !Array.isArray(data) ||
      !data.every(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          typeof item.savedAt === "number" &&
          Number.isFinite(item.savedAt) &&
          item.project &&
          Array.isArray(item.project.roads),
      )
    )
      throw new Error();
    return data as SavedMap[];
  } catch {
    throw new Error("本机存档列表无法读取。请检查浏览器存储。");
  }
}

export function listSavedMaps(storage: StoragePort): SavedMapInfo[] {
  return read(storage)
    .map(({ id, name, savedAt, project }) => ({
      id,
      name,
      savedAt,
      roads: project.roads.length,
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function saveNamedMap(
  storage: StoragePort,
  project: Project,
  name: string,
): SavedMapInfo {
  const title = name.trim();
  if (!title || title.length > 80)
    throw new Error("请输入 1–80 字的存档名称。");
  const validProject = parseProject(JSON.stringify(project));
  const saves = read(storage);
  const existing = saves.find((save) => save.name === title);
  const savedAt = Date.now();
  const entry: SavedMap = {
    id: existing?.id ?? crypto.randomUUID(),
    name: title,
    savedAt,
    project: validProject,
  };
  if (existing) saves[saves.indexOf(existing)] = entry;
  else saves.push(entry);
  try {
    storage.setItem(key, JSON.stringify(saves));
  } catch {
    throw new Error("浏览器存储不可用或空间不足，请删除旧存档或导出备份。");
  }
  return { id: entry.id, name: title, savedAt, roads: project.roads.length };
}

export function loadNamedMap(storage: StoragePort, id: string): Project {
  const save = read(storage).find((item) => item.id === id);
  if (!save) throw new Error("存档不存在，请刷新列表后重试。");
  return parseProject(JSON.stringify(save.project));
}

export function deleteNamedMap(storage: StoragePort, id: string): void {
  const saves = read(storage);
  const next = saves.filter((save) => save.id !== id);
  if (next.length === saves.length)
    throw new Error("存档不存在，请刷新列表后重试。");
  try {
    storage.setItem(key, JSON.stringify(next));
  } catch {
    throw new Error("浏览器存储不可用，未能删除存档。");
  }
}
