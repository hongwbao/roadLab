import { test, expect, type Page } from "@playwright/test";
async function ready(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
}
async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}
async function clickWorld(page: Page, p: { x: number; y: number; z: number }) {
  await settle(page);
  const q = await page.evaluate((p) => (window as any).lab.worldToScreen(p), p);
  await page.mouse.click(q.x, q.y);
}
async function chooseLink(
  page: Page,
  fromRoad: string,
  fromLane: number,
  toRoad: string,
  toLane: number,
) {
  const link = await page.evaluate(
    ({ fromRoad, fromLane, toRoad, toLane }) => {
      const t = (window as any).lab.editor.junctionLaneTool;
      return t.layout.candidates.find(
        (l: any) =>
          l.from.road === fromRoad &&
          l.from.lane === fromLane &&
          l.to.road === toRoad &&
          l.to.lane === toLane,
      );
    },
    { fromRoad, fromLane, toRoad, toLane },
  );
  expect(link).toBeTruthy();
  await clickWorld(page, link.from.position);
  await clickWorld(page, link.to.position);
  return link;
}
async function seeded(page: Page, merge = false, twoRoads = false) {
  await ready(page);
  await page.evaluate(
    ({ merge, twoRoads }) => {
      const e = (window as any).lab.editor;
      const road = (
        id: string,
        a: { x: number; y: number; z: number },
        b: { x: number; y: number; z: number },
        single = false,
      ) => ({
        id,
        name: id,
        knots: [
          {
            p: a,
            incoming: a,
            outgoing: { x: a.x + (b.x - a.x) / 3, y: 0, z: a.z },
            at: 0,
          },
          {
            p: b,
            outgoing: b,
            incoming: { x: a.x + (2 * (b.x - a.x)) / 3, y: 0, z: b.z },
            at: 1,
          },
        ],
        lanesStart: single ? 1 : 2,
        lanesEnd: single ? 1 : 2,
        twoWay: false,
        width: 4,
        speed: 50,
        kind: single ? "ramp" : "road",
        align: "center",
        transitionStart: 0,
        transitionEnd: 1,
        transitionMode: "direct",
      });
      const origin = { x: 0, y: 0, z: 0 },
        up = road("up", { x: -120, y: 0, z: 0 }, origin),
        through = road("through", origin, { x: 140, y: 0, z: 0 });
      const ramp: any = merge
        ? road("ramp", { x: -140, y: 0, z: 50 }, { x: 0, y: 0, z: 2 }, true)
        : road("ramp", { x: 0, y: 0, z: 2 }, { x: 140, y: 0, z: 50 }, true);
      ramp.attachments = merge
        ? { end: { road: "through", end: 0, lanes: [1], ownLanes: [0] } }
        : { start: { road: "up", end: 1, lanes: [1], ownLanes: [0] } };
      e.edit(() => {
        e.project.roads = twoRoads ? [up, ramp] : [up, through, ramp];
        e.project.ports = [];
        e.project.name = merge ? "偏移汇流连线" : "偏移分流连线";
        delete e.project.junctionLaneConnections;
        delete e.project.signals;
      });
      e.scene.fit(e.project.roads);
      e.scene.top();
    },
    { merge, twoRoads },
  );
  await page.locator('[data-tool="turn"]').click();
  await clickWorld(page, { x: 0, y: 0, z: 0.7 });
}
test("cloverleaf offset fork allows point-to-point lane edits, real routing, undo, save and restoration", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-action="example-elevated"]').click();
  await page.locator("#confirm-yes").click();
  const node = await page.evaluate(() => {
    const e = (window as any).lab.editor,
      n = e.junctionLaneTool.nodes.find(
        (n: any) =>
          n.kind === "attachment" &&
          n.arms.length === 3 &&
          n.arms.some((a: any) => /-right$/.test(a.road)),
      );
    if (!n)
      throw new Error(
        "The current map must contain an editable three-road right-ramp fork",
      );
    const s = e.scene;
    s.controls.target.set(n.position.x, n.position.y, n.position.z);
    s.camera.position.set(n.position.x, n.position.y + 110, n.position.z + 60);
    s.controls.update();
    return { position: n.position, count: e.junctionLaneTool.nodes.length };
  });
  await page.locator('[data-tool="turn"]').click();
  await clickWorld(page, node.position);
  await expect(page.locator("#turn-panel")).toContainText(
    "偏移连接路口（3 条道路）",
  );
  await expect(page.locator("#scene-summary")).toContainText(
    `${node.count} 处连接节点`,
  );
  const movement = await page.evaluate(() => {
    const e = (window as any).lab.editor,
      layout = e.junctionLaneTool.layout,
      existing = new Set(layout.links.map((l: any) => l.id));
    const candidate = layout.candidates.find(
      (l: any) =>
        l.from.lane === 0 && /-right$/.test(l.to.road) && !existing.has(l.id),
    );
    if (!candidate)
      throw new Error(
        "Fork must allow a real non-default lane-to-ramp connection",
      );
    return { from: candidate.from.road, to: candidate.to.road };
  });
  const { from, to } = movement,
    link = await chooseLink(page, from, 0, to, 0);
  const rule = () =>
    page.evaluate(
      ({ from, to }) => {
        const e = (window as any).lab.editor;
        return e.project.junctionLaneConnections
          ?.find((r: any) => r.from.road === from && r.from.lane === 0)
          ?.to.some((r: any) => r.road === to && r.lane === 0);
      },
      { from, to },
    );
  expect(await rule()).toBe(true);
  const geometry = await page.evaluate((id) => {
    const e = (window as any).lab.editor;
    e.simulation.prepareForRun();
    const n = e.simulation.sourceEngine.network,
      l = n.lanes.get(n.connectionLaneIds.get(id));
    return {
      points: l.curve.points,
      warnings: n.warnings.filter((w: string) =>
        w.includes("endpoint mismatch"),
      ),
      crosswalks: e.simulation.junctions.length,
    };
  }, link.id);
  expect(geometry.points[3].x).toBeGreaterThan(geometry.points[0].x + 15);
  expect(geometry.warnings).toEqual([]);
  expect(geometry.crosswalks).toBe(0);
  await page.locator('[data-action="undo"]').click();
  expect(await rule()).toBeUndefined();
  await page.locator('[data-action="redo"]').click();
  expect(await rule()).toBe(true);
  await page.locator("#viewport").focus();
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  expect(await rule()).toBe(true);
  await page.evaluate((position) => {
    const s = (window as any).lab.editor.scene;
    s.controls.target.set(position.x, position.y, position.z);
    s.camera.position.set(position.x, position.y + 110, position.z + 60);
    s.controls.update();
  }, node.position);
  await page.locator('[data-tool="turn"]').click();
  await clickWorld(page, node.position);
  await page.locator('[data-junction-lane-action="restore-junction"]').click();
  expect(await rule()).toBeUndefined();
  expect(errors).toEqual([]);
});
test("two-road offset attachment exposes both parent lanes and supports closing, restoring and deleting a link", async ({
  page,
}) => {
  await seeded(page, false, true);
  await expect(page.locator("#turn-panel")).toContainText(
    "偏移连接路口（2 条道路）",
  );
  const link = await chooseLink(page, "up", 0, "ramp", 0);
  await page.locator('[data-junction-lane-action="ban-lane"]').click();
  await expect(page.locator("#turn-panel")).toContainText(
    "此入车道已禁止全部出口",
  );
  await page.locator('[data-junction-lane-action="restore-lane"]').click();
  await chooseLink(page, "up", 0, "ramp", 0);
  const mid = link.samples[24];
  const q = await page.evaluate(
    (p) => (window as any).lab.worldToScreen(p),
    mid,
  );
  await page.mouse.click(q.x, q.y, { button: "right" });
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.project.junctionLaneConnections[0].to,
    ),
  ).toEqual([]);
});
test("offset merge can connect the incoming ramp to another destination lane and survives live-network preparation", async ({
  page,
}) => {
  await seeded(page, true);
  await expect(page.locator("#turn-panel")).toContainText("偏移连接路口");
  const link = await chooseLink(page, "ramp", 0, "through", 0);
  expect(
    await page.evaluate((id) => {
      const e = (window as any).lab.editor;
      e.simulation.prepareForRun();
      return e.simulation.sourceEngine.network.connectionLaneIds.has(id);
    }, link.id),
  ).toBe(true);
  await page.locator('[data-junction-lane-action="restore-junction"]').click();
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.project.junctionLaneConnections,
    ),
  ).toBeUndefined();
});
