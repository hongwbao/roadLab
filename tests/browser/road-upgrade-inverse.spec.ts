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
      };
    });
  const before = await mesh();
  expect(before.start).toBeCloseTo(1.5);
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

test("right click reverses lane additions and both transition upgrade modes on the clicked road", async ({
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
  await expect(page.locator("#upgrade-description")).toContainText("隔离带");
  await clickRoad(page, -40);
  expect((await road()).transitionMode).toBe("smooth");
  await clickRoad(page, -40, 0, "right");
  expect((await road()).transitionMode).toBe("direct");
  await page.locator('[data-upgrade-mode="direct"]').click();
  await clickRoad(page, -40, 0, "right");
  expect((await road()).transitionMode).toBe("smooth");
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

test("equal-count median transitions change actual curb, pavement and source-lane curves; hovering keeps the saved map unchanged", async ({
  page,
}) => {
  await seed(page);
  await page.locator('[data-tool="upgrade"]').click();
  await page.locator('[data-upgrade-mode="smooth"]').click();
  await clickRoad(page, -40);
  const geometry = await page.evaluate(() => {
    const editor = (window as any).lab.editor;
    let curb: any, pavement: any;
    editor.scene.roads.traverse((item: any) => {
      if (item.userData.median === "seam-b") curb = item;
      else if (item.userData.road === "seam-b" && item.isMesh) pavement = item;
    });
    const a = Array.from(curb.geometry.attributes.position.array) as number[];
    const widths: number[] = [];
    for (let index = 0; index < a.length; index += 12)
      widths.push(Math.abs(a[index + 5] - a[index + 2]));
    const road = Array.from(
      pavement.geometry.attributes.position.array,
    ) as number[];
    editor.simulation.prepareForRun();
    const lane = [
      ...editor.simulation.sourceEngine.network.lanes.values(),
    ].find(
      (lane: any) =>
        lane.road === "seam-b" && lane.lane === 2 && lane.roadInterval[0] === 0,
    ) as any;
    return {
      widths,
      pavementStart: Math.abs(road[5] - road[2]),
      laneStartZ: lane.curve.points[0].z,
      taper: editor.project.roads[1].autoTaper.start,
    };
  });
  expect(geometry.taper.medianWidth).toBe(0);
  expect(geometry.widths[0]).toBeCloseTo(0);
  expect(geometry.widths.some((width) => width > 0.1 && width < 1.9)).toBe(
    true,
  );
  expect(Math.max(...geometry.widths)).toBeCloseTo(2);
  expect(geometry.pavementStart).toBeCloseTo(16.7);
  expect(geometry.laneStartZ).toBeCloseTo(2);
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
