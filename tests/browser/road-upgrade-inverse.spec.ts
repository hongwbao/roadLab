import { expect, test, type Page } from "@playwright/test";

async function clickRoad(
  page: Page,
  x: number,
  z = 0,
  button: "left" | "right" = "left",
) {
  const point = await page.evaluate(
    (p) => (window as any).lab.worldToScreen(p),
    { x, y: 0, z },
  );
  await page.mouse.click(point.x, point.y, { button });
}
async function seed(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.evaluate(() => {
    const editor = (window as any).lab.editor;
    const road = (id: string, start: number, end: number, median = false) => ({
      id,
      name: id,
      knots: [
        {
          p: { x: start, y: 0, z: 0 },
          incoming: { x: start, y: 0, z: 0 },
          outgoing: { x: start + (end - start) / 3, y: 0, z: 0 },
          at: 0,
        },
        {
          p: { x: end, y: 0, z: 0 },
          incoming: { x: start + (2 * (end - start)) / 3, y: 0, z: 0 },
          outgoing: { x: end, y: 0, z: 0 },
          at: 1,
        },
      ],
      twoWay: true,
      lanesStart: 2,
      lanesEnd: 2,
      width: 4,
      speed: 60,
      kind: "road",
      align: "center",
      transitionStart: 0,
      transitionEnd: 1,
      transitionMode: "direct",
      ...(median ? { median: { kind: "concrete", width: 2 } } : {}),
    });
    editor.edit(() => {
      editor.project.roads = [
        road("seam-a", -80, 0),
        road("seam-b", 0, 80, true),
      ];
      editor.project.ports = [];
      editor.project.templates = [];
      delete editor.project.signals;
      delete editor.project.junctionLaneConnections;
      delete editor.project.roadVisuals;
    });
    editor.scene.fit(editor.project.roads);
    editor.scene.top();
  });
}

test("adding the neighbouring median rebuilds the already-rendered curb instead of retaining a black nose gap", async ({
  page,
}) => {
  await seed(page);
  const mesh = () =>
    page.evaluate(() => {
      let found: any;
      (window as any).lab.editor.scene.roads.traverse((item: any) => {
        if (item.userData.median === "seam-b") found = item;
      });
      const coordinates = Array.from(
        found.geometry.attributes.position.array,
      ) as number[];
      return {
        id: found.geometry.uuid,
        start: Math.min(...coordinates.filter((_, i) => i % 3 === 0)),
        actualRoadStart:
          (window as any).lab.editor.scene.ranges.get("seam-b").start * 80,
      };
    });
  const before = await mesh();
  expect(before.actualRoadStart).toBeGreaterThan(1.5);
  expect(before.start).toBeCloseTo(before.actualRoadStart);
  await page.locator('[data-tool="upgrade"]').click();
  await page.locator('[data-upgrade-mode="median"]').click();
  await clickRoad(page, -40);
  await page.mouse.move(1000, 180);
  const after = await mesh();
  expect(after.id).not.toBe(before.id);
  expect(after.start).toBeCloseTo(0);
});

test("right click removes only a median, stays in upgrade mode and supports undo", async ({
  page,
}) => {
  await seed(page);
  await page.locator('[data-tool="upgrade"]').click();
  await page.locator('[data-upgrade-mode="median"]').click();
  await clickRoad(page, -40);
  await clickRoad(page, -40, 0, "right");
  const state = () =>
    page.evaluate(() => ({
      road: (window as any).lab.editor.project.roads[0],
      tool: (window as any).lab.editor.tool,
    }));
  expect((await state()).road.median).toBeUndefined();
  expect((await state()).road.lanesStart).toBe(2);
  expect((await state()).tool).toBe("upgrade");
  await page.locator('[data-action="undo"]').click();
  expect((await state()).road.median.width).toBe(2);
});

test("right click reverses lane additions and cancels only the selected node's visual smoothing", async ({
  page,
}) => {
  await seed(page);
  await page.locator('[data-tool="upgrade"]').click();
  await page.locator('[data-upgrade-mode="widen"]').click();
  await clickRoad(page, -40, 6);
  const road = () =>
    page.evaluate(() => (window as any).lab.editor.project.roads[0]);
  expect((await road()).lanesStart).toBe(3);
  await clickRoad(page, -40, 9, "right");
  expect((await road()).lanesStart).toBe(2);
  await page.locator('[data-upgrade-mode="smooth"]').click();
  await expect(page.locator("#asset-list")).toBeHidden();
  await expect(page.locator("#upgrade-description")).toContainText("连接节点");
  const count = () =>
    page.evaluate(
      () => (window as any).lab.editor.project.roadVisuals?.nodes.length ?? 0,
    );
  await clickRoad(page, -40);
  expect(await count()).toBe(0);
  await clickRoad(page, 0);
  expect(await count()).toBe(1);
  await clickRoad(page, 0, 0, "right");
  expect(await count()).toBe(0);
  expect((await road()).transitionMode).toBe("direct");
  await clickRoad(page, 0);
  expect(await count()).toBe(1);
  await page.locator('[data-upgrade-mode="direct"]').click();
  await clickRoad(page, 0, 0, "right");
  expect(await count()).toBe(0);
  expect((await road()).transitionMode).toBe("direct");
});

test("right click restores the last replaced section after a save and reload", async ({
  page,
}) => {
  await seed(page);
  await page.locator('[data-asset="city-6"]').click();
  await page.locator('[data-tool="upgrade"]').click();
  await page.locator('[data-upgrade-mode="replace"]').click();
  await clickRoad(page, -40);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.project.roads[0].lanesStart,
    ),
  ).toBe(3);
  await page.locator("#viewport").focus();
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  await page.locator('[data-tool="upgrade"]').click();
  await page.locator('[data-upgrade-mode="replace"]').click();
  await clickRoad(page, -40, 0, "right");
  const restored = await page.evaluate(
    () => (window as any).lab.editor.project.roads[0],
  );
  expect(restored.lanesStart).toBe(2);
  expect(restored.width).toBe(4);
  expect(restored.replacedSection).toBeUndefined();
});

test("node display smoothing preserves the true median, pavement and compiled lanes; upgrade hover never writes the map", async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(() => {
    const e = (window as any).lab.editor;
    e.simulation.prepareForRun();
    (window as any).medianEngineBefore = e.simulation.sourceEngine;
    (window as any).medianNetworkBefore = e.simulation.sourceEngine.network;
  });
  const capture = () =>
    page.evaluate(() => {
      const editor = (window as any).lab.editor;
      let curb: any, pavement: any;
      editor.scene.roads.traverse((item: any) => {
        if (item.userData.median === "seam-b") curb = item;
        else if (item.userData.road === "seam-b" && item.isMesh)
          pavement = item;
      });
      const points = Array.from(
          pavement.geometry.attributes.position.array,
        ) as number[],
        zs = points.filter((_, i) => i % 3 === 2),
        lane = [...editor.simulation.sourceEngine.network.lanes.values()].find(
          (lane: any) =>
            lane.road === "seam-b" &&
            lane.lane === 2 &&
            lane.kind === "road" &&
            lane.role !== "master",
        ) as any;
      return {
        curb: Array.from(curb.geometry.attributes.position.array),
        curbId: curb.geometry.uuid,
        pavement: points,
        pavementId: pavement.geometry.uuid,
        width: Math.max(...zs) - Math.min(...zs),
        laneStartZ: lane.curve.points[0].z,
        median: editor.project.roads[1].median.width,
        sameEngine:
          editor.simulation.sourceEngine === (window as any).medianEngineBefore,
        sameNetwork:
          editor.simulation.sourceEngine.network ===
          (window as any).medianNetworkBefore,
      };
    });
  const beforeGeometry = await capture();
  await page.locator('[data-tool="upgrade"]').click();
  await page.locator('[data-upgrade-mode="smooth"]').click();
  await clickRoad(page, 0);
  const geometry = await capture();
  expect(geometry).toEqual(beforeGeometry);
  expect(geometry.median).toBe(2);
  expect(geometry.width).toBeCloseTo(18.7, 4);
  expect(geometry.laneStartZ).toBeCloseTo(3);
  await page.locator('[data-upgrade-mode="median"]').click();
  const before = await page.evaluate(() =>
    JSON.stringify((window as any).lab.editor.project),
  );
  const point = await page.evaluate(() =>
    (window as any).lab.worldToScreen({ x: -40, y: 0, z: 0 }),
  );
  await page.mouse.move(point.x, point.y);
  expect(
    await page.evaluate(() =>
      JSON.stringify((window as any).lab.editor.project),
    ),
  ).toBe(before);
  expect(
    await page.evaluate(
      () =>
        (window as any).lab.editor.scene.preview.children.filter(
          (item: any) => item.userData.median,
        ).length,
    ),
  ).toBe(2);
});
