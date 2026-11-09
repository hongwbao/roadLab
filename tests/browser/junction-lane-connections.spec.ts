import { expect, test, type Page } from "@playwright/test";

async function junction(page: Page, twoLanes = false) {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-action="example-junction"]').click();
  await page.locator("#confirm-yes").click();
  if (twoLanes)
    await page.evaluate(() => {
      const editor = (window as any).lab.editor;
      // Explicit multi-lane test fixture; subsequent connections use real pointer input.
      editor.edit(() => {
        for (const road of editor.project.roads) {
          road.lanesStart = road.lanesEnd = 2;
          delete road.profile;
          delete road.widthOrigin;
          delete road.autoTaper;
        }
      });
    });
  await page.locator('[data-action="top"]').click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.locator('[data-tool="turn"]').click();
  const p = await page.evaluate(() =>
    (window as any).lab.worldToScreen({ x: 0, y: 0, z: 0 }),
  );
  await page.mouse.click(p.x, p.y);
  await expect(page.locator("#turn-panel h2")).toHaveText("路口车道连线");
}
const prepare = (page: Page) =>
  page.evaluate(() => (window as any).lab.editor.simulation.prepareForRun());
const project = (page: Page) =>
  page.evaluate(() => (window as any).lab.getState().project);
const point = (page: Page, p: { x: number; y: number; z: number }) =>
  page.evaluate((p) => (window as any).lab.worldToScreen(p), p);

test("a lateral and graded seam stays selectable after all exits close, then restores and saves its functional connection", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  const position = await page.evaluate(() => {
    const e = (window as any).lab.editor,
      road = (id: string, x0: number, x1: number, z: number, y: number) => ({
        id,
        name: id,
        width: 4,
        speed: 60,
        kind: "road",
        align: "center",
        lanesStart: 2,
        lanesEnd: 2,
        twoWay: false,
        transitionStart: 0,
        transitionEnd: 1,
        transitionMode: "direct",
        knots: [
          {
            p: { x: x0, y, z },
            incoming: { x: x0, y, z },
            outgoing: { x: x0 + (x1 - x0) / 3, y, z },
            at: 0,
          },
          {
            p: { x: x1, y, z },
            incoming: { x: x1 - (x1 - x0) / 3, y, z },
            outgoing: { x: x1, y, z },
            at: 1,
          },
        ],
      });
    e.edit(() => {
      e.project.roads = [
        road("offset-a", -80, 0, 0, 0),
        road("offset-b", 0, 80, 1, 0.49),
      ];
      e.project.ports = [];
      delete e.project.junctionLaneConnections;
      delete e.project.signals;
    });
    e.scene.fit(e.project.roads);
    e.scene.top();
    const nodes = e.junctionLaneTool.nodes;
    if (nodes.length !== 1 || nodes[0].kind !== "continuation")
      throw new Error("Expected one actual offset seam");
    return nodes[0].position;
  });
  const selectNode = async () => {
    await page.locator('[data-tool="turn"]').click();
    const p = await point(page, position);
    await page.mouse.click(p.x, p.y);
    if (
      await page.evaluate(
        () => !!(window as any).lab.editor.junctionLaneTool.selectedFrom,
      )
    )
      await page.mouse.click(p.x + 70, p.y + 70, { button: "right" });
    await expect(page.locator("#turn-panel")).toContainText(
      "道路接头（2 条道路）",
    );
    if (
      (await page.locator(".junction-lane-keyboard").getAttribute("open")) ===
      null
    )
      await page.locator(".junction-lane-keyboard summary").click();
  };
  await selectNode();
  const sources = await page
    .locator('[data-junction-lane-action="choose-source"]')
    .evaluateAll((buttons) =>
      buttons.map((button) => (button as HTMLElement).dataset.junctionLaneKey!),
    );
  expect(sources).toHaveLength(2);
  for (const key of sources) {
    await page
      .locator(
        `[data-junction-lane-action="choose-source"][data-junction-lane-key="${key}"]`,
      )
      .click();
    await page.locator('[data-junction-lane-action="ban-lane"]').click();
  }
  expect(
    (await project(page)).junctionLaneConnections.every(
      (rule: any) => rule.to.length === 0,
    ),
  ).toBe(true);
  await prepare(page);
  expect(
    await page.evaluate(() => [
      ...(
        window as any
      ).lab.editor.simulation.sourceEngine.network.connectionLaneIds.keys(),
    ]),
  ).toEqual([]);
  await page.locator('[data-tool="select"]').click();
  await selectNode();
  await page
    .locator(
      '[data-junction-lane-action="choose-source"][data-junction-lane-key="offset-a:1:0"]',
    )
    .click();
  await page.locator('[data-junction-lane-action="restore-lane"]').click();
  await prepare(page);
  expect(
    await page.evaluate(() => [
      ...(
        window as any
      ).lab.editor.simulation.sourceEngine.network.connectionLaneIds.keys(),
    ]),
  ).toEqual(["offset-a:0>offset-b:0"]);
  const link = await page.evaluate(() =>
    (window as any).lab.editor.junctionLaneTool.layout.candidates.find(
      (l: any) => l.id === "offset-a:0>offset-b:1",
    ),
  );
  expect(link).toBeTruthy();
  const from = await point(page, link.from.position),
    to = await point(page, link.to.position);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.locator("#viewport").focus();
  await page.keyboard.press("Control+s");
  const saved = (await project(page)).junctionLaneConnections;
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  expect((await project(page)).junctionLaneConnections).toEqual(saved);
  await prepare(page);
  const actual = await page.evaluate(() => {
    const e = (window as any).lab.editor,
      engine = e.simulation.sourceEngine;
    return {
      links: [...engine.network.connectionLaneIds.keys()],
      trims: [...engine.trims.values()],
      junctions: engine.junctions.length,
      nodes: e.junctionLaneTool.nodes.length,
      curves: [...engine.network.lanes.values()]
        .filter((lane: any) => lane.connection && lane.role !== "master")
        .map((lane: any) => lane.curve.points),
    };
  });
  expect(actual.links.sort()).toEqual([
    "offset-a:0>offset-b:0",
    "offset-a:0>offset-b:1",
  ]);
  expect(actual.trims[0].start).toBe(0);
  expect(actual.trims[1].end).toBe(0);
  expect(actual.trims[0].end).toBeGreaterThan(0);
  expect(actual.trims[1].start).toBeGreaterThan(0);
  expect(actual.trims[0].end).toBeLessThanOrEqual(32 + 1e-6);
  expect(actual.trims[1].start).toBeLessThanOrEqual(32 + 1e-6);
  expect(actual.curves).toHaveLength(2);
  for (const points of actual.curves)
    for (let i = 1; i < 4; i++)
      expect(points[i].x).toBeGreaterThan(points[i - 1].x);
  expect(actual.junctions).toBe(0);
  expect(actual.nodes).toBe(1);
  expect(errors).toEqual([]);
});

test("ordinary bidirectional seams support real drag, reject invalid drops and preserve camera, history and save", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.evaluate(() => {
    const e = (window as any).lab.editor,
      road = (id: string, x0: number, x1: number) => ({
        id,
        name: id,
        width: 4,
        speed: 60,
        kind: "road",
        align: "center",
        lanesStart: 3,
        lanesEnd: 3,
        backwardLanesStart: 2,
        backwardLanesEnd: 2,
        twoWay: true,
        median: { kind: "concrete", width: 2 },
        sectionOffset: 1,
        transitionStart: 0,
        transitionEnd: 1,
        transitionMode: "direct",
        knots: [
          {
            p: { x: x0, y: 0, z: 0 },
            incoming: { x: x0, y: 0, z: 0 },
            outgoing: { x: x0 + (x1 - x0) / 3, y: 0, z: 0 },
            at: 0,
          },
          {
            p: { x: x1, y: 0, z: 0 },
            incoming: { x: x1 - (x1 - x0) / 3, y: 0, z: 0 },
            outgoing: { x: x1, y: 0, z: 0 },
            at: 1,
          },
        ],
      });
    e.edit(() => {
      e.project.roads = [road("seam-a", -100, 0), road("seam-b", 0, 100)];
      e.project.ports = [];
      delete e.project.junctionLaneConnections;
      delete e.project.signals;
    });
    e.scene.fit(e.project.roads);
    e.scene.top();
  });
  await page.locator('[data-tool="turn"]').click();
  const node = await point(page, { x: 0, y: 0, z: 0 });
  await page.mouse.click(node.x, node.y);
  await expect(page.locator("#turn-panel")).toContainText(
    "道路接头（2 条道路）",
  );
  const link = await page.evaluate(() => {
    const t = (window as any).lab.editor.junctionLaneTool;
    return t.layout.candidates.find((l: any) => l.id === "seam-a:2>seam-b:4");
  });
  expect(link).toBeTruthy();
  let source = await point(page, link.from.position),
    target = await point(page, link.to.position);
  const camera = () =>
      page.evaluate(() => {
        const s = (window as any).lab.editor.scene;
        return {
          p: s.camera.position.toArray(),
          target: s.controls.target.toArray(),
          enabled: s.controls.enabled,
        };
      }),
    before = await camera();
  await page.mouse.move(source.x, source.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await page.mouse.up();
  expect(await camera()).toEqual(before);
  const rules = () => project(page).then((p) => p.junctionLaneConnections);
  expect(await rules()).toEqual([
    {
      from: { road: "seam-a", lane: 2, end: 1 },
      to: [
        { road: "seam-b", lane: 2, end: 0 },
        { road: "seam-b", lane: 4, end: 0 },
      ],
    },
  ]);
  await prepare(page);
  expect(
    await page.evaluate(
      (id) =>
        (
          window as any
        ).lab.editor.simulation.sourceEngine.network.connectionLaneIds.has(id),
      link.id,
    ),
  ).toBe(true);
  const afterDrag = await rules();
  // Authored lane changes can allocate a real connection region. Reacquire
  // current ports after the graph edit; style-only edits still keep them fixed.
  const updated = await page.evaluate(
    (id) =>
      (window as any).lab.editor.junctionLaneTool.layout.candidates.find(
        (l: any) => l.id === id,
      ),
    link.id,
  );
  source = await point(page, updated.from.position);
  target = await point(page, updated.to.position);
  // Incoming targets and blank terrain never create rules or move the camera.
  const invalid = await page.evaluate(() =>
    (window as any).lab.editor.junctionLaneTool.ports.find(
      (p: any) => p.road === "seam-b" && p.kind === "in",
    ),
  );
  const invalidPoint = await point(page, invalid.position);
  for (const end of [invalidPoint, { x: target.x + 90, y: target.y + 70 }]) {
    await page.mouse.move(source.x, source.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    expect(await rules()).toEqual(afterDrag);
    expect(await camera()).toEqual(before);
  }
  // Dragging an existing connection remains idempotent; a target click removes it.
  await page.mouse.move(source.x, source.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await page.mouse.up();
  expect(await rules()).toEqual(afterDrag);
  await page.mouse.click(target.x, target.y);
  expect((await rules())[0].to).toEqual([{ road: "seam-b", lane: 2, end: 0 }]);
  await page.locator('[data-action="undo"]').click();
  expect(await rules()).toEqual(afterDrag);
  await page.locator('[data-action="undo"]').click();
  expect(await rules()).toBeUndefined();
  await page.locator('[data-action="redo"]').click();
  expect(await rules()).toEqual(afterDrag);
  await page.locator("#viewport").focus();
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  expect(await rules()).toEqual(afterDrag);
  expect(errors).toEqual([]);
});

test("junction dots add a previously unavailable destination, remove it, save a closed lane and restore auto", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await junction(page, true);
  const link = await page.evaluate(() => {
    const tool = (window as any).lab.editor.junctionLaneTool,
      existing = new Set(tool.layout.links.map((link: any) => link.id));
    return tool.layout.candidates.find((link: any) => !existing.has(link.id));
  });
  expect(link).toBeTruthy();
  const source = await point(page, link.from.position),
    target = await point(page, link.to.position);
  await page.mouse.click(source.x, source.y);
  await page.mouse.move(target.x, target.y);
  await page.mouse.click(target.x, target.y);
  const rule = () =>
    project(page).then((p) =>
      p.junctionLaneConnections?.find(
        (rule: any) =>
          rule.from.road === link.from.road &&
          rule.from.lane === link.from.lane,
      ),
    );
  expect((await rule()).to).toContainEqual({
    road: link.to.road,
    lane: link.to.lane,
    end: link.to.end,
  });
  await prepare(page);
  expect(
    await page.evaluate(
      (id) =>
        (
          window as any
        ).lab.editor.simulation.sourceEngine.network.connectionLaneIds.has(id),
      link.id,
    ),
  ).toBe(true);
  await page.mouse.click(target.x, target.y);
  expect((await rule()).to).not.toContainEqual({
    road: link.to.road,
    lane: link.to.lane,
    end: link.to.end,
  });
  await page.locator('[data-junction-lane-action="ban-lane"]').click();
  expect((await rule()).to).toEqual([]);
  const prefix = `${link.from.road}:${link.from.lane}>`;
  await prepare(page);
  expect(
    await page.evaluate(
      (prefix) =>
        [
          ...(
            window as any
          ).lab.editor.simulation.sourceEngine.network.connectionLaneIds.keys(),
        ].some((id: any) => id.startsWith(prefix)),
      prefix,
    ),
  ).toBe(false);
  await page.locator('[data-action="undo"]').click();
  expect((await rule()).to.length).toBeGreaterThan(0);
  await page.locator('[data-action="redo"]').click();
  expect((await rule()).to).toEqual([]);
  await page.locator("#viewport").focus();
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  expect((await rule()).to).toEqual([]);
  await page.locator('[data-tool="turn"]').click();
  const centre = await point(page, { x: 0, y: 0, z: 0 });
  await page.mouse.click(centre.x, centre.y);
  const sourcePoint = await page.evaluate(
      (key) =>
        (window as any).lab.editor.junctionLaneTool.ports.find(
          (port: any) => port.key === key,
        ).position,
      link.from.key,
    ),
    screen = await point(page, sourcePoint);
  await page.mouse.click(screen.x, screen.y);
  await expect(page.locator(".junction-lane-closed")).toBeVisible();
  await page.locator('[data-junction-lane-action="restore-lane"]').click();
  expect(await rule()).toBeUndefined();
  await prepare(page);
  expect(
    await page.evaluate(
      (prefix) =>
        [
          ...(
            window as any
          ).lab.editor.simulation.sourceEngine.network.connectionLaneIds.keys(),
        ].some((id: any) => id.startsWith(prefix)),
      prefix,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("keyboard lane names preserve focus and the open helper across graph edits on a compact viewport", async ({
  page,
}) => {
  await junction(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".junction-lane-keyboard summary").click();
  const source = page
      .locator('[data-junction-lane-action="choose-source"]')
      .first(),
    sourceId = await source.getAttribute("id");
  await source.click();
  await expect(page.locator(`[id="${sourceId}"]`)).toBeFocused();
  await expect(page.locator(".junction-lane-keyboard")).toHaveAttribute(
    "open",
    "",
  );
  const target = page
      .locator('[data-junction-lane-action="toggle-target"]')
      .first(),
    targetId = await target.getAttribute("id"),
    pressed = await target.getAttribute("aria-pressed");
  await target.click();
  await expect(page.locator(`[id="${targetId}"]`)).toBeFocused();
  await expect(page.locator(`[id="${targetId}"]`)).toHaveAttribute(
    "aria-pressed",
    pressed === "true" ? "false" : "true",
  );
  await expect(page.locator(".junction-lane-keyboard")).toHaveAttribute(
    "open",
    "",
  );
  await prepare(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator('[data-junction-lane-action="leave"]').click();
  await expect(page.locator("#turn-panel")).toBeHidden();
  await prepare(page);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.junctionLaneTool.overlay.group.visible,
    ),
  ).toBe(false);
});
