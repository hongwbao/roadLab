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
  const info = await page.evaluate(() => {
    const s = (window as any).lab.editor.scene;
    let mesh: any;
    s.roads.traverse((o: any) => {
      if (o.userData.road === "cloverleaf-east-right" && o.isMesh) mesh = o;
    });
    const a = mesh.geometry.attributes.position.array;
    let clipped = true;
    for (let i = 0; i < a.length; i += 9) {
      const x = (a[i] + a[i + 3] + a[i + 6]) / 3,
        z = (a[i + 2] + a[i + 5] + a[i + 8]) / 3;
      if (x > -380.01 && x < -340 && z > 19.66 && z < 28.34) clipped = false;
    }
    return {
      clipped,
      indexed: !!mesh.geometry.index,
      legacyStripes: s.overlays.children.some((o: any) => o.isLineSegments),
    };
  });
  expect(info.clipped).toBe(true);
  expect(info.indexed).toBe(false);
  expect(info.legacyStripes).toBe(false);
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
