import { expect, test, type Page } from "@playwright/test";

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function world(page: Page, point: { x: number; y: number; z: number }) {
  await settle(page);
  return page.evaluate((p) => (window as any).lab.worldToScreen(p), point);
}
async function seed(
  page: Page,
  from = 3,
  to = 4,
  smooth = false,
  twoWay = false,
) {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.evaluate(
    async ({ from, to, smooth, twoWay }) => {
      const path = "/src/core/model.ts",
        { makeRoad, emptyProject } = await import(path),
        e = (window as any).lab.editor,
        point = (x: number) => ({ x, y: 0, z: 0 }),
        common = twoWay
          ? {
              twoWay: true,
              backwardLanesStart: 2,
              backwardLanesEnd: 2,
              median: { kind: "concrete", width: 2 },
            }
          : {};
      e.edit(() => {
        e.project = emptyProject();
        e.project.roads = [
          makeRoad(point(-120), point(0), {
            ...common,
            id: "a",
            name: "三车道进口",
            lanesStart: from,
            lanesEnd: from,
          }),
          makeRoad(point(0), point(120), {
            ...common,
            id: "b",
            name: "四车道出口",
            lanesStart: to,
            lanesEnd: to,
            transitionMode: smooth ? "smooth" : "direct",
          }),
        ];
        e.project.ports = [
          { road: "a", end: "start", type: "source", rate: 12 },
          { road: "b", end: "end", type: "sink", rate: 1 },
        ];
      });
      e.scene.fit(e.project.roads);
      e.scene.top();
    },
    { from, to, smooth, twoWay },
  );
  await settle(page);
}
async function openNode(page: Page) {
  await page.locator('[data-tool="turn"]').click();
  if (
    !(await page.evaluate(
      () => !!(window as any).lab.editor.junctionLaneTool.junction,
    ))
  ) {
    const p = await world(page, { x: 0, y: 0, z: 0 });
    await page.mouse.click(p.x, p.y);
  }
  await expect(page.locator("#turn-panel h2")).toHaveText("路口车道连线");
}
const ports = (page: Page) =>
  page.evaluate(() => (window as any).lab.editor.junctionLaneTool.ports);
const rules = (page: Page) =>
  page.evaluate(
    () => (window as any).lab.editor.project.junctionLaneConnections,
  );
async function drag(page: Page, fromLane: number, toLane: number) {
  const all = await ports(page),
    from = all.find(
      (p: any) => p.road === "a" && p.lane === fromLane && p.kind === "in",
    ),
    to = all.find(
      (p: any) => p.road === "b" && p.lane === toLane && p.kind === "out",
    );
  expect(from).toBeTruthy();
  expect(to).toBeTruthy();
  const a = await world(page, from.position),
    b = await world(page, to.position);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}
async function onlyFourth(page: Page) {
  await drag(page, 2, 3);
  const all = await ports(page),
    old = all.find(
      (p: any) => p.road === "b" && p.lane === 2 && p.kind === "out",
    ),
    p = await world(page, old.position);
  await page.mouse.click(p.x, p.y);
  for (const lane of [0, 1]) {
    const source = all.find(
        (p: any) => p.road === "a" && p.lane === lane && p.kind === "in",
      ),
      q = await world(page, source.position);
    await page.mouse.click(q.x, q.y);
    await page.locator('[data-junction-lane-action="ban-lane"]').click();
  }
  const source = all.find(
      (p: any) => p.road === "a" && p.lane === 2 && p.kind === "in",
    ),
    q = await world(page, source.position);
  await page.mouse.click(q.x, q.y);
  expect((await rules(page)).find((r: any) => r.from.lane === 2).to).toEqual([
    { road: "b", lane: 3, end: 0 },
  ]);
}
async function upgrade(page: Page, cancel = false) {
  await page.locator('[data-tool="select"]').click();
  if (!(await page.locator('[data-tool="upgrade"]').isVisible()))
    await page.locator('[data-action="roads"]').click();
  await page.locator('[data-tool="upgrade"]').click();
  await page.locator('[data-upgrade-mode="smooth"]').click();
  const p = await world(page, { x: 80, y: 0, z: 0 });
  await page.mouse.click(p.x, p.y, cancel ? { button: "right" } : {});
}

test("3 to 4 smooth join keeps four real destinations and drives the authored fourth lane", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page);
  await openNode(page);
  let all = await ports(page);
  expect(all.filter((p: any) => p.kind === "in")).toHaveLength(3);
  expect(all.filter((p: any) => p.kind === "out")).toHaveLength(4);
  await upgrade(page);
  await openNode(page);
  all = await ports(page);
  expect(all.filter((p: any) => p.kind === "in")).toHaveLength(3);
  expect(
    all.filter((p: any) => p.kind === "out").map((p: any) => p.lane),
  ).toEqual([0, 1, 2, 3]);
  await onlyFourth(page);
  await expect(page.locator("#turn-panel")).toContainText(
    "自定义连接 · 1 个出口",
  );
  const evidence = await page.evaluate(async () => {
    const path = "/src/simulation/cs2-simulation.ts",
      { Cs2TrafficSimulation } = await import(path),
      p = (window as any).lab.editor.project,
      sim = new Cs2TrafficSimulation({ synchronousPathsOnlyForTests: true });
    sim.configure(p);
    const network = sim.network,
      id = network.connectionLaneIds.get("a:2>b:3"),
      connector = network.lanes.get(id),
      targets = (network.successors.get(id) ?? []).map((v: string) =>
        network.lanes.get(v),
      ),
      seen = new Set<number>();
    let traversed = false;
    sim.running = true;
    for (let i = 0; i < 1200; i++) {
      sim.update(0.05);
      for (const car of sim.vehicles) {
        if (car.connector?.id === "a:2>b:3") traversed = true;
        if (!car.connector && car.route[car.step]?.road === "b")
          seen.add(Math.round(car.lane));
      }
    }
    const out = {
      id,
      to: connector?.to,
      targets: targets.map((v: any) => ({ road: v.road, lane: v.lane })),
      warnings: network.warnings,
      completed: sim.completed,
      traversed,
      seen: [...seen],
    };
    sim.dispose();
    return out;
  });
  expect(evidence.id).toBeTruthy();
  expect(evidence.to).toEqual({ road: "b", lane: 3 });
  expect(evidence.targets).toContainEqual({ road: "b", lane: 3 });
  expect(
    evidence.warnings.filter((s: string) =>
      /a:2>b:3.*(fades|mismatch)/.test(s),
    ),
  ).toEqual([]);
  expect(evidence.traversed).toBe(true);
  expect(evidence.seen).toContain(3);
  expect(evidence.completed).toBeGreaterThan(0);
  await page.screenshot({
    path: "artifacts/smooth-join-four-real-targets.png",
  });
  expect(errors).toEqual([]);
});

test("existing fourth-lane permission and closures survive smooth undo, reload and right-click cancellation", async ({
  page,
}) => {
  await seed(page);
  await openNode(page);
  await onlyFourth(page);
  const saved = await rules(page);
  await upgrade(page);
  expect(await rules(page)).toEqual(saved);
  await openNode(page);
  expect((await ports(page)).filter((p: any) => p.kind === "out")).toHaveLength(
    4,
  );
  await page.screenshot({ path: "artifacts/smooth-fourth-rule-kept.png" });
  await page.locator('[data-action="undo"]').click();
  expect(await rules(page)).toEqual(saved);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.project.roads[1].autoTaper,
    ),
  ).toBeUndefined();
  await page.locator('[data-action="redo"]').click();
  expect(await rules(page)).toEqual(saved);
  await page.locator("#viewport").focus();
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  expect(await rules(page)).toEqual(saved);
  expect(
    await page.evaluate(
      () => !!(window as any).lab.editor.project.roads[1].autoTaper,
    ),
  ).toBe(true);
  await page.locator('[data-action="top"]').click();
  await upgrade(page, true);
  expect(await rules(page)).toEqual(saved);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.project.roads[1].autoTaper,
    ),
  ).toBeUndefined();
  await openNode(page);
  expect((await ports(page)).filter((p: any) => p.kind === "out")).toHaveLength(
    4,
  );
});

test("4 to 3 also exposes the real fading source lane and compiles its authored connection", async ({
  page,
}) => {
  await seed(page, 4, 3, true);
  await openNode(page);
  const all = await ports(page);
  expect(all.filter((p: any) => p.kind === "in")).toHaveLength(4);
  expect(all.filter((p: any) => p.kind === "out")).toHaveLength(3);
  await drag(page, 3, 2);
  const info = await page.evaluate(() => {
    const e = (window as any).lab.editor;
    e.simulation.prepareForRun();
    const n = e.simulation.sourceEngine.network,
      id = n.connectionLaneIds.get("a:3>b:2");
    return { id, from: n.lanes.get(id)?.from, warnings: n.warnings };
  });
  expect(info.id).toBeTruthy();
  expect(info.from).toEqual({ road: "a", lane: 3 });
  expect(
    info.warnings.filter((s: string) => /a:3>b:2.*(fades|mismatch)/.test(s)),
  ).toEqual([]);
});

test("asymmetric median-separated join keeps nominal ports without presenting reverse lanes as exits", async ({
  page,
}) => {
  await seed(page, 2, 3, true, true);
  await openNode(page);
  const all = await ports(page),
    a = all.filter((p: any) => p.road === "a"),
    b = all.filter((p: any) => p.road === "b");
  expect([
    a.filter((p: any) => p.kind === "in").length,
    a.filter((p: any) => p.kind === "out").length,
    b.filter((p: any) => p.kind === "in").length,
    b.filter((p: any) => p.kind === "out").length,
  ]).toEqual([2, 2, 2, 3]);
  await drag(page, 3, 4);
  expect(
    (await rules(page)).find(
      (r: any) => r.from.road === "a" && r.from.lane === 3,
    ).to,
  ).toContainEqual({ road: "b", lane: 4, end: 0 });
  expect(
    (await rules(page))
      .flatMap((r: any) => r.to)
      .every((to: any) => to.road !== "b" || to.lane >= 2),
  ).toBe(true);
});
