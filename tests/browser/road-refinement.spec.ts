import { expect, test, type Page } from "@playwright/test";
async function seed(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.evaluate(() => {
    const e = (window as any).lab.editor;
    const road = (id: string, x: number, end: number, z = 0) => ({
      id,
      name: id,
      knots: [
        {
          p: { x, y: 0, z },
          incoming: { x, y: 0, z },
          outgoing: { x: x + (end - x) / 3, y: 0, z },
          at: 0,
        },
        {
          p: { x: end, y: 0, z },
          incoming: { x: x + (2 * (end - x)) / 3, y: 0, z },
          outgoing: { x: end, y: 0, z },
          at: 1,
        },
      ],
      lanesStart: 2,
      lanesEnd: 2,
      twoWay: false,
      width: 4,
      speed: 60,
      kind: "road",
      align: "center",
      transitionStart: 0,
      transitionEnd: 1,
      transitionMode: "direct",
    });
    e.edit(() => {
      e.project.roads = [
        road("speed-road", -60, 60),
        road("long", -150, 150, -28),
      ];
      e.project.ports = [];
      e.project.connections = [];
      delete e.project.signals;
      delete e.project.junctionLaneConnections;
    });
    e.scene.fit(e.project.roads);
    e.scene.top();
  });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}
async function at(page: Page, z = 0, x = 0) {
  return page.evaluate((p) => (window as any).lab.worldToScreen(p), {
    x,
    y: 0,
    z,
  });
}
test("edits the actual road speed limit, validates input and retains it after undo and save/reload", async ({
  page,
}) => {
  await seed(page);
  let p = await at(page);
  await page.mouse.click(p.x, p.y);
  const input = page.getByRole("spinbutton", { name: "道路最高限速" });
  await input.fill("35");
  await input.press("Tab");
  const state = () =>
    page.evaluate(() => {
      const e = (window as any).lab.editor;
      e.simulation.prepareForRun();
      return {
        speed: e.project.roads[0].speed,
        limits: [...e.simulation.sourceEngine.network.lanes.values()]
          .filter((l: any) => l.road === "speed-road" && l.role !== "master")
          .map((l: any) => l.maxSpeed),
      };
    });
  expect((await state()).speed).toBe(35);
  expect((await state()).limits.length).toBeGreaterThan(0);
  expect(
    (await state()).limits.every((s: number) => Math.abs(s - 35 / 3.6) < 1e-4),
  ).toBe(true);
  await input.fill("200");
  await input.press("Tab");
  expect((await state()).speed).toBe(35);
  await page.locator('[data-action="undo"]').click();
  expect((await state()).speed).toBe(60);
  await page.locator('[data-action="redo"]').click();
  await page.locator("#viewport").focus();
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  expect((await state()).speed).toBe(35);
});
test("uses metre-based dashed paint after extending a road without scaling its dash/gap", async ({
  page,
}) => {
  await seed(page);
  const marks = () =>
    page.evaluate(() => {
      const e = (window as any).lab.editor,
        read = () => {
          const out: any[] = [];
          e.scene.details.traverse((o: any) => {
            if (o.material?.isLineDashedMaterial) {
              const a = o.geometry.attributes.lineDistance.array;
              out.push({
                dash: o.material.dashSize,
                gap: o.material.gapSize,
                length: a[a.length - 1],
              });
            }
          });
          return out;
        };
      const before = read();
      e.edit(() => {
        const r = e.project.roads[0];
        r.knots[1].p.x = 180;
        r.knots[1].outgoing.x = 180;
        r.knots[1].incoming.x = 100;
        r.knots[0].outgoing.x = 20;
      });
      return { before, after: read() };
    });
  const m = await marks();
  expect(
    m.before.map((x) => Math.round(x.length)).sort((a, b) => a - b),
  ).toEqual([120, 300]);
  expect(m.after.map((x) => Math.round(x.length))).toEqual([240, 300]);
  expect(
    [...m.before, ...m.after].every((x) => x.dash === 3 && x.gap === 6),
  ).toBe(true);
});
test("previews both retained lanes and center, hides old pavement, cycles with Tab, and commits that exact offset", async ({
  page,
}) => {
  await seed(page);
  await page.locator('[data-category="oneway"]').click();
  await page.locator('[data-asset="one-1"]').click();
  await page.locator('[data-tool="upgrade"]').click();
  const snapshot = await page.evaluate(() =>
    JSON.stringify((window as any).lab.editor.project),
  );
  const preview = () =>
    page.evaluate(() => {
      const e = (window as any).lab.editor;
      const target = e.replacementTarget;
      let visible = false;
      e.scene.roads.traverse((o: any) => {
        if (o.userData.road === "speed-road" && o.isMesh)
          visible = o.parent.visible;
      });
      return {
        offset: target?.selected.offset,
        visible,
        road: target?.next,
        ghost: e.scene.preview.children.some(
          (o: any) => o.isMesh && o.material.opacity === 0.45,
        ),
        state: JSON.stringify(e.project),
      };
    });
  let p = await at(page, -2);
  await page.mouse.move(p.x, p.y);
  expect((await preview()).offset).toBe(-2);
  expect((await preview()).visible).toBe(false);
  expect((await preview()).ghost).toBe(true);
  expect((await preview()).state).toBe(snapshot);
  p = await at(page, 2);
  await page.mouse.move(p.x, p.y);
  expect((await preview()).offset).toBe(2);
  p = await at(page);
  await page.mouse.move(p.x, p.y);
  expect((await preview()).offset).toBe(0);
  await page.locator("#viewport").focus();
  await page.keyboard.press("Tab");
  expect((await preview()).offset).toBe(0);
  await page.keyboard.press("Tab");
  expect((await preview()).offset).toBe(-2);
  await page.keyboard.press("Tab");
  expect((await preview()).offset).toBe(2);
  const next = (await preview()).road;
  await page.mouse.click(p.x, p.y);
  const committed = await page.evaluate(
    () => (window as any).lab.editor.project.roads[0],
  );
  expect({ ...committed, replacedSection: undefined }).toEqual({
    ...next,
    replacedSection: undefined,
  });
  await page.mouse.click(p.x, p.y, { button: "right" });
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.project.roads[0].sectionOffset,
    ),
  ).toBeUndefined();
  // Leaving the map hides the preview; returning to the identical candidate restores it.
  await page.mouse.move(p.x, p.y);
  await page.mouse.move(450, 35);
  await page.mouse.move(p.x, p.y);
  expect((await preview()).ghost).toBe(true);
});
test("the cloverleaf renderer has no overlapping shared asphalt or legacy transverse stripes at forks", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-action="example-elevated"]').click();
  await page.locator("#confirm-yes").click();
  const read = async (targetId: string) =>
    page.evaluate(async (targetId) => {
      const forkModule = "/src/core/road-forks.ts",
        surfaceModule = "/src/core/junction-crosswalks.ts",
        { roadForks, forkSurfaces } = await import(forkModule),
        { roadSurfaceTriangles } = await import(surfaceModule),
        e = (window as any).lab.editor,
        s = e.scene,
        groups = roadForks(e.project.roads),
        meshes = new Map<string, any>();
      s.roads.traverse((o: any) => {
        if (o.isMesh && o.userData.road && !o.userData.median)
          meshes.set(o.userData.road, o);
      });
      const centroid = (a: any, i = 0) => ({
        x: (a[i] + a[i + 3] + a[i + 6]) / 3,
        y: (a[i + 1] + a[i + 4] + a[i + 7]) / 3,
        z: (a[i + 2] + a[i + 5] + a[i + 8]) / 3,
      });
      // Independent barycentric containment and interpolated height check.
      // A previous fixed rectangle described the obsolete 40-road map.
      const inside = (q: any, piece: any) => {
        if (
          q.x < piece.minX ||
          q.x > piece.maxX ||
          q.z < piece.minZ ||
          q.z > piece.maxZ
        )
          return false;
        const [a, b, c] = piece.polygon,
          area = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x),
          u = ((q.x - a.x) * (c.z - a.z) - (q.z - a.z) * (c.x - a.x)) / area,
          v = ((b.x - a.x) * (q.z - a.z) - (b.z - a.z) * (q.x - a.x)) / area;
        return (
          u > 1e-5 &&
          v > 1e-5 &&
          u + v < 1 - 1e-5 &&
          Math.abs(q.y - (a.y + u * (b.y - a.y) + v * (c.y - a.y))) < 0.014
        );
      };
      let testedForks = 0,
        triangles = 0,
        rawSharedSamples = 0,
        overlaps = 0,
        indexed = false;
      let target:
        | { triangles: number; obstacles: number; rawSharedSamples: number }
        | undefined;
      for (const [id, group] of groups as Map<string, { pavement: any[] }>) {
        if (!group.pavement.length) continue;
        const mesh = meshes.get(id),
          road = e.project.roads.find((r: any) => r.id === id);
        if (!mesh) throw new Error(`Missing actual fork mesh: ${id}`);
        const positions = mesh.geometry.attributes.position.array,
          obstacles = forkSurfaces(group.pavement),
          raw = roadSurfaceTriangles(road, { start: 0, end: 1 });
        const shared = raw.filter((t: any) =>
          obstacles.some((piece: any) =>
            inside(
              centroid(t.polygon.flatMap((p: any) => [p.x, p.y, p.z])),
              piece,
            ),
          ),
        ).length;
        testedForks++;
        rawSharedSamples += shared;
        triangles += positions.length / 9;
        indexed ||= !!mesh.geometry.index;
        for (let i = 0; i < positions.length; i += 9)
          if (
            obstacles.some((piece: any) =>
              inside(centroid(positions, i), piece),
            )
          )
            overlaps++;
        if (id === targetId)
          target = {
            triangles: positions.length / 9,
            obstacles: obstacles.length,
            rawSharedSamples: shared,
          };
      }
      return {
        testedForks,
        triangles,
        rawSharedSamples,
        overlaps,
        indexed,
        target,
        legacyStripes: s.overlays.children.some((o: any) => o.isLineSegments),
      };
    }, targetId);
  const info = await read("cloverleaf-east-right");
  expect(info.target).toBeTruthy();
  expect(info.target!.triangles).toBeGreaterThan(0);
  expect(info.target!.obstacles).toBeGreaterThan(0);
  expect(info.testedForks).toBeGreaterThanOrEqual(16);
  expect(info.triangles).toBeGreaterThan(0);
  expect(info.overlaps).toBe(0);
  expect(info.indexed).toBe(false);
  expect(info.legacyStripes).toBe(false);
  // The improved map's forks now meet at their ends without positive raw
  // shared centroid samples. Exercise real subtraction on a bounded scene
  // whose ramp deliberately shares a level collar with the continuing trunk.
  await page.evaluate(async () => {
    const path = "/src/core/model.ts",
      { makeRoad } = await import(path),
      e = (window as any).lab.editor,
      p = (x: number, z = 0) => ({ x, y: 0, z });
    e.edit(() => {
      e.project.roads = [
        makeRoad(p(0), p(100), { id: "trunk" }),
        makeRoad(p(-40), p(0), { id: "ref" }),
        makeRoad(
          p(0, 2),
          p(100, 25),
          {
            id: "branch",
            lanesStart: 1,
            lanesEnd: 1,
            attachments: {
              start: { road: "ref", end: 1, lanes: [1], ownLanes: [0] },
            },
          },
          p(35, 2),
          p(70, 8),
        ),
      ];
      e.project.junctionLaneConnections = [];
    });
  });
  const bounded = await read("branch");
  expect(bounded.target).toBeTruthy();
  expect(bounded.target!.triangles).toBeGreaterThan(0);
  expect(bounded.target!.obstacles).toBeGreaterThan(0);
  expect(bounded.target!.rawSharedSamples).toBeGreaterThan(0);
  expect(bounded.rawSharedSamples).toBeGreaterThan(0);
  expect(bounded.overlaps).toBe(0);
  expect(bounded.indexed).toBe(false);
  expect(bounded.legacyStripes).toBe(false);
});

test("recognizes a five-arm junction for lane links and replaces its old pavement in upgrade previews", async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(() => {
    const e = (window as any).lab.editor,
      base = e.project.roads[0];
    e.edit(() => {
      e.project.roads = Array.from({ length: 5 }, (_, i) => {
        const angle = (i * 2 * Math.PI) / 5,
          outer = { x: 100 * Math.cos(angle), y: 0, z: 100 * Math.sin(angle) },
          inner = { x: 0, y: 0, z: 0 };
        const start = i % 2 ? inner : outer,
          end = i % 2 ? outer : inner;
        return {
          ...structuredClone(base),
          id: `arm-${i}`,
          knots: [
            {
              p: start,
              incoming: start,
              outgoing: {
                x: start.x + (end.x - start.x) / 3,
                y: 0,
                z: start.z + (end.z - start.z) / 3,
              },
              at: 0,
            },
            {
              p: end,
              outgoing: end,
              incoming: {
                x: start.x + (2 * (end.x - start.x)) / 3,
                y: 0,
                z: start.z + (2 * (end.z - start.z)) / 3,
              },
              at: 1,
            },
          ],
        };
      });
    });
    e.scene.fit(e.project.roads);
    e.scene.top();
  });
  await page.locator('[data-tool="turn"]').click();
  let p = await at(page);
  await page.mouse.click(p.x, p.y);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.junctionLaneTool.junction.arms.length,
    ),
  ).toBe(5);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.junctionLaneTool.ports.length,
    ),
  ).toBe(10);
  await page.locator('[data-tool="select"]').click();
  await page.locator('[data-category="oneway"]').click();
  await page.locator('[data-asset="one-1"]').click();
  await page.locator('[data-tool="upgrade"]').click();
  p = await at(page, 0, 50);
  await page.mouse.move(p.x, p.y);
  const view = await page.evaluate(() => {
    const s = (window as any).lab.editor.scene;
    return {
      oldVisible: s.junctionMesh.children.some((o: any) => o.visible),
      newVisible: s.preview.children.some(
        (o: any) => o.userData.previewJunction,
      ),
    };
  });
  expect(view.oldVisible).toBe(false);
  expect(view.newVisible).toBe(true);
  await page.locator('[data-tool="select"]').click();
  expect(
    await page.evaluate(() =>
      (window as any).lab.editor.scene.junctionMesh.children.every(
        (o: any) => o.visible,
      ),
    ),
  ).toBe(true);
});
