import { expect, test, type Page } from "@playwright/test";

async function seed(page: Page, smooth = true) {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.evaluate(async (smooth) => {
    const path = "/src/core/model.ts",
      { makeRoad, emptyProject } = await import(path),
      e = (window as any).lab.editor,
      point = (x: number, z = 0) => ({ x, y: 0, z }),
      options = {
        lanesStart: 3,
        lanesEnd: 3,
        transitionMode: smooth ? "smooth" : "direct",
      };
    e.project = emptyProject();
    e.edit(() => {
      e.project.roads = [
        makeRoad(point(-100), point(0), { ...options, id: "a" }),
        makeRoad(point(0), point(100), { ...options, id: "b" }),
        makeRoad(point(-100, -70), point(100, -70), { id: "unrelated" }),
      ];
    });
    e.scene.fit(e.project.roads);
    e.scene.top();
  }, smooth);
}

async function shiftMapping(page: Page) {
  await page.evaluate(async () => {
    const path = "/src/core/junction-lane-connections.ts",
      { setJunctionLaneRule } = await import(path),
      e = (window as any).lab.editor;
    e.edit(() => {
      for (const [from, to] of [
        [0, [1]],
        [1, [2]],
        [2, []],
      ] as [number, number[]][])
        setJunctionLaneRule(
          e.project,
          { road: "a", lane: from, end: 1 },
          to.map((lane) => ({ road: "b", lane, end: 0 })),
        );
    });
  });
}

const paint = async (page: Page) =>
  page.evaluate(() => {
    const e = (window as any).lab.editor,
      out: any = {
        boundaries: {},
        pavement: {},
        dashed: [],
        modes: e.project.roads.map((r: any) => r.transitionMode),
        visualNodes: e.project.roadVisuals?.nodes.length ?? 0,
      };
    e.scene.details.traverse((o: any) => {
      if (o.userData.markingBoundary !== undefined) {
        const p = o.geometry.attributes.position;
        out.boundaries[`${o.userData.road}:${o.userData.markingBoundary}`] = {
          start: [p.getX(0), p.getZ(0)],
          end: [p.getX(p.count - 1), p.getZ(p.count - 1)],
        };
      }
      if (o.material?.isLineDashedMaterial)
        out.dashed.push({ dash: o.material.dashSize, gap: o.material.gapSize });
    });
    e.scene.roads.traverse((o: any) => {
      if (o.isMesh && o.userData.road && !o.userData.median)
        out.pavement[o.userData.road] = o.geometry.uuid;
    });
    return out;
  });

test("real authored successor mapping withdraws conflicting smooth paint, survives history/reload, and invalidates only related roads", async ({
  page,
}) => {
  await seed(page);
  const before = await paint(page);
  expect(before.boundaries["a:1"].end[1]).toBe(-2);
  expect(before.pavement.unrelated).toBeTruthy();
  await shiftMapping(page);
  const after = await paint(page);
  expect(after.boundaries["a:1"].end).toEqual([-24, -2]);
  expect(after.boundaries["b:2"].start).toEqual([24, 2]);
  expect(after.boundaries["a:2"].end[0]).toBeCloseTo(-24, 5);
  expect(after.pavement.unrelated).toBe(before.pavement.unrelated);
  expect(after.dashed.every((m: any) => m.dash === 3 && m.gap === 6)).toBe(
    true,
  );
  const successors = await page.evaluate(async () => {
    const path = "/src/core/model.ts",
      { connections } = await import(path);
    return connections((window as any).lab.editor.project)
      .filter((c: any) => c.from.road === "a")
      .map((c: any) => [c.from.lane, c.to.lane]);
  });
  expect(successors).toEqual([
    [0, 1],
    [1, 2],
  ]);
  await page.locator('[data-action="undo"]').click();
  expect((await paint(page)).boundaries["a:1"].end[1]).toBe(-2);
  await page.locator('[data-action="redo"]').click();
  await page.locator("#viewport").focus();
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  expect((await paint(page)).boundaries["a:1"].end[0]).toBeCloseTo(-24, 5);
  await page.locator('[data-tool="upgrade"]').click();
  await page.locator('[data-upgrade-mode="smooth"]').click();
  const p = await page.evaluate(() =>
    (window as any).lab.worldToScreen({ x: 0, y: 0, z: 0 }),
  );
  await page.mouse.click(p.x, p.y, { button: "right" });
  expect((await paint(page)).modes.slice(0, 2)).toEqual(["direct", "direct"]);
  expect((await paint(page)).visualNodes).toBe(0);
  expect((await paint(page)).boundaries["a:1"].end[1]).toBe(-2);
});

test("editing a direct continuation keeps ordinary physical paint and does not enable smooth", async ({
  page,
}) => {
  await seed(page, false);
  await shiftMapping(page);
  const after = await paint(page);
  expect(after.modes.every((mode: string) => mode === "direct")).toBe(true);
  expect(after.boundaries["a:1"].end[1]).toBe(-2);
  expect(after.boundaries["b:2"].start[1]).toBe(2);
});

test("a real four-lane merge removes only conflicting collar paint and preserves the supported partition", async ({
  page,
}, testInfo) => {
  await seed(page);
  await page.evaluate(() => {
    const e = (window as any).lab.editor;
    e.edit(() =>
      e.project.roads.slice(0, 2).forEach((r: any) => {
        r.lanesStart = r.lanesEnd = 4;
      }),
    );
    e.scene.fit(e.project.roads.slice(0, 2));
    e.scene.top();
  });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const before = await paint(page);
  await page.screenshot({ path: testInfo.outputPath("transition-before.png") });
  await page.evaluate(async () => {
    const path = "/src/core/junction-lane-connections.ts",
      { setJunctionLaneRule } = await import(path),
      e = (window as any).lab.editor;
    e.edit(() =>
      setJunctionLaneRule(e.project, { road: "a", lane: 0, end: 1 }, [
        { road: "b", lane: 1, end: 0 },
      ]),
    );
  });
  const after = await paint(page);
  for (const boundary of [1, 2]) {
    expect(before.boundaries[`a:${boundary}`].end[0]).toBe(0);
    expect(after.boundaries[`a:${boundary}`].end[0]).toBe(-24);
    expect(after.boundaries[`a:${boundary}`].start).toEqual(
      before.boundaries[`a:${boundary}`].start,
    );
  }
  expect(after.boundaries["a:3"]).toEqual(before.boundaries["a:3"]);
  expect(after.boundaries["a:3"].end[0]).toBe(0);
  expect(after.pavement.unrelated).toBe(before.pavement.unrelated);
  await page.screenshot({ path: testInfo.outputPath("transition-after.png") });
  const network = await page.evaluate(async () => {
    const path = "/src/core/model.ts",
      { connections } = await import(path),
      e = (window as any).lab.editor;
    e.simulation.prepareForRun();
    const network = e.simulation.sourceEngine.network;
    return {
      actual: connections(e.project)
        .filter((c: any) => c.from.road === "a")
        .map((c: any) => c.id)
        .sort(),
      newRoute: network.connectionLaneIds.has("a:0>b:1"),
      oldRoute: network.connectionLaneIds.has("a:0>b:0"),
    };
  });
  expect(network.actual).toEqual(["a:0>b:1", "a:1>b:1", "a:2>b:2", "a:3>b:3"]);
  expect(network.newRoute).toBe(true);
  expect(network.oldRoute).toBe(false);
  await page.locator('[data-action="undo"]').click();
  expect((await paint(page)).boundaries["a:1"].end[0]).toBe(0);
  await page.locator('[data-action="redo"]').click();
  await page.locator("#viewport").focus();
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  expect((await paint(page)).boundaries["a:1"].end[0]).toBe(-24);
  expect((await paint(page)).boundaries["a:3"].end[0]).toBe(0);
});

test("ghost contains pavement boundaries, real divider and sparse full-curve arrows; cancellation clears it", async ({
  page,
}) => {
  await seed(page);
  const before = await paint(page);
  const result = await page.evaluate(async () => {
    const path = "/src/core/model.ts",
      { makeRoad } = await import(path),
      e = (window as any).lab.editor,
      p = (x: number, z = 0) => ({ x, y: 0, z }),
      road = makeRoad(p(-120, 35), p(120, 35), {
        id: "curve-ghost",
        lanesStart: 2,
        lanesEnd: 2,
      }),
      median = makeRoad(p(-100, 80), p(100, 80), {
        id: "median-ghost",
        twoWay: true,
        median: { kind: "concrete", width: 2 },
      });
    road.knots[0].outgoing = p(-100, 95);
    road.knots[1].incoming = p(100, -25);
    const state = JSON.stringify(e.project);
    e.scene.showPreviews([road, median]);
    const read = () =>
      e.scene.preview.children
        .filter((o: any) => o.userData.previewMarking)
        .map((o: any) => ({
          ...o.userData,
          opacity: o.material.opacity,
          color: o.material.color.getHex(),
        }));
    const valid = read(),
      divider = e.scene.preview.children.some(
        (o: any) => o.userData.median === "median-ghost",
      );
    e.scene.showPreviews([road], true);
    const invalid = read();
    e.scene.showPreviews([road, median]);
    return {
      valid,
      divider,
      invalid,
      unchanged: JSON.stringify(e.project) === state,
    };
  });
  expect(result.unchanged).toBe(true);
  expect(result.divider).toBe(true);
  expect(
    result.valid.filter(
      (m: any) =>
        m.road === "curve-ghost" && m.previewMarking === "lane-boundary",
    ),
  ).toHaveLength(1);
  const arrows = result.valid.filter(
    (m: any) => m.road === "curve-ghost" && m.previewMarking === "direction",
  );
  expect(arrows.length).toBeGreaterThan(8);
  expect(Math.min(...arrows.map((m: any) => m.at))).toBeLessThan(0.2);
  expect(Math.max(...arrows.map((m: any) => m.at))).toBeGreaterThan(0.8);
  expect(arrows.every((m: any) => m.opacity < 0.6)).toBe(true);
  expect(result.invalid.every((m: any) => m.color === 0xff7765)).toBe(true);
  expect((await paint(page)).pavement).toEqual(before.pavement);
  await page.locator('[data-tool="select"]').click();
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.scene.preview.children.length,
    ),
  ).toBe(0);
});

for (const model of ["compatible", "source"] as const)
  test(`${model} bidirectional asymmetric lane snap cycles with real Tab and commits the shown reverse-lane geometry`, async ({
    page,
  }) => {
    await seed(page, false);
    const setup = await page.evaluate(async (model) => {
      const module = "/src/core/model.ts",
        math = "/src/core/math.ts",
        { makeRoad } = await import(module),
        { lanePoint, tangent } = await import(math),
        e = (window as any).lab.editor,
        p = (x: number, z = 0) => ({ x, y: 0, z });
      e.edit(() => {
        e.project.roads = [
          makeRoad(p(-75, 20), p(0), {
            id: "snap-reference",
            twoWay: true,
            lanesStart: 3,
            lanesEnd: 3,
            backwardLanesStart: 2,
            backwardLanesEnd: 2,
            sectionOffset: 2,
            median: { kind: "concrete", width: 2 },
          }),
        ];
      });
      e.roadConstructionModel = model;
      e.chooseAsset("city-2");
      Object.assign(e.draw, {
        sectionOffset: -3,
        median: { kind: "concrete", width: 2 },
      });
      e.settings.grid = false;
      e.scene.fit([...e.project.roads, makeRoad(p(0), p(80, 20))]);
      e.scene.top();
      const show = e.scene.showPreviews.bind(e.scene);
      e.scene.showPreviews = (roads: any[], ...args: any[]) => {
        if (roads.length)
          (window as any).latestLanePreview = structuredClone(roads[0]);
        return show(roads, ...args);
      };
      const reference = e.project.roads[0],
        raw = lanePoint(reference, 0, 1);
      return { raw, tangent: tangent(reference, 1) };
    }, model);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const screen = await page.evaluate(
      (p) => (window as any).lab.worldToScreen(p),
      setup.raw,
    );
    await page.mouse.move(screen.x, screen.y);
    await page.locator("#viewport").focus();
    const read = () =>
      page.evaluate(async () => {
        const path = "/src/core/math.ts",
          { laneDirection } = await import(path),
          e = (window as any).lab.editor;
        return {
          snap: structuredClone(e.snapInfo),
          count: e.laneCandidateCount,
          direction: e.snapInfo?.lanes
            ? laneDirection(e.project.roads[0], e.snapInfo.lanes[0])
            : 0,
        };
      });
    const initial = await read();
    expect(initial.snap.kind).toBe("lane");
    expect(initial.count).toBeGreaterThan(1);
    await page.keyboard.press("Tab");
    let selected = await read();
    expect(selected.snap.lanes).not.toEqual(initial.snap.lanes);
    for (let i = 0; i < selected.count && selected.direction !== -1; i++) {
      await page.keyboard.press("Tab");
      selected = await read();
    }
    expect(selected.direction).toBe(-1);
    expect(selected.snap.text).toContain("反向");
    await page.mouse.move(screen.x + 0.2, screen.y + 0.2);
    expect((await read()).snap.lanes).toEqual(selected.snap.lanes);
    await page.mouse.click(screen.x + 0.2, screen.y + 0.2);
    expect(
      await page.evaluate(() => (window as any).lab.editor.drawPoints.length),
    ).toBe(1);
    const end = {
        x: selected.snap.position.x + setup.tangent.x * 65,
        y: 0,
        z: selected.snap.position.z + setup.tangent.z * 65,
      },
      target = await page.evaluate(
        (p) => (window as any).lab.worldToScreen(p),
        end,
      );
    await page.keyboard.down("Alt");
    await page.mouse.move(target.x, target.y);
    const preview = await page.evaluate(() =>
      structuredClone((window as any).latestLanePreview),
    );
    await page.mouse.click(target.x, target.y);
    await page.keyboard.up("Alt");
    const result = await page.evaluate(async (preview) => {
      const path = "/src/core/math.ts",
        { lanePoint, laneCount, dist } = await import(path),
        e = (window as any).lab.editor,
        road = e.project.roads.find((r: any) => r.id !== "snap-reference");
      return {
        debug: {
          points: e.drawPoints,
          tool: e.tool,
          screen: e.scene.project(e.pointer),
        },
        count: e.project.roads.length,
        attachment: road?.attachments?.start,
        error: road
          ? Math.max(
              ...[0, 1].flatMap((t) =>
                Array.from({ length: laneCount(road) }, (_, lane) =>
                  dist(lanePoint(road, lane, t), lanePoint(preview, lane, t)),
                ),
              ),
            )
          : Infinity,
        taper: road?.autoTaper,
      };
    }, preview);
    expect(result.count, JSON.stringify({ result, screen, target, end })).toBe(
      2,
    );
    expect(result.attachment.lanes).toEqual(
      expect.arrayContaining(selected.snap.lanes),
    );
    for (const [i, ownLane] of selected.snap.ownLanes.entries())
      expect(
        result.attachment.lanes[result.attachment.ownLanes.indexOf(ownLane)],
      ).toBe(selected.snap.lanes[i]);
    expect(result.error).toBeLessThan(1e-5);
    expect(result.taper).toBeUndefined();
  });
