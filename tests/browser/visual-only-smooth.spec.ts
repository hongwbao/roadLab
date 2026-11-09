import { expect, test, type Page } from "@playwright/test";

async function world(page: Page, x = 0, z = 0) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  return page.evaluate((p) => (window as any).lab.worldToScreen(p), {
    x,
    y: 0,
    z,
  });
}
async function smoothTool(page: Page) {
  await page.locator('[data-tool="select"]').click();
  if (!(await page.locator('[data-tool="upgrade"]').isVisible()))
    await page.locator('[data-action="roads"]').click();
  await page.locator('[data-tool="upgrade"]').click();
  await page.locator('[data-upgrade-mode="smooth"]').click();
}
async function clickWorld(page: Page, x: number, z = 0, right = false) {
  const p = await world(page, x, z);
  await page.mouse.click(p.x, p.y, right ? { button: "right" } : {});
}

test("real construction of a 3-to-5 node keeps all five ports fixed through smooth, drag and reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-action="new"]').click();
  await page.locator("#confirm-yes").click();
  await page.locator('[data-action="top"]').click();
  await page.locator('[data-category="oneway"]').click();
  await page.locator('[data-asset="one-3"]').click();
  if (
    (await page.locator("#lane-snap-toggle").getAttribute("aria-pressed")) ===
    "true"
  )
    await page.locator("#lane-snap-toggle").click();
  await clickWorld(page, -100);
  await clickWorld(page, 0);
  await page.mouse.click(960, 190, { button: "right" });
  await page.locator('[data-asset="one-3"]').click();
  for (let i = 0; i < 2; i++)
    await page
      .locator('[data-build-direction="forward"][data-delta="1"]')
      .click();
  await clickWorld(page, 0);
  await clickWorld(page, 100);
  await page.mouse.click(960, 190, { button: "right" });
  await page.locator('[data-tool="turn"]').click();
  await clickWorld(page, 0);
  const before = await page.evaluate(() => {
    const e = (window as any).lab.editor;
    return { roads: e.project.roads, ports: e.junctionLaneTool.ports };
  });
  expect(before.roads).toHaveLength(2);
  const outs = before.ports.filter((p: any) => p.kind === "out");
  expect(outs).toHaveLength(5);
  // Straight construction: one station, five lateral points 4m apart.
  expect(new Set(outs.map((p: any) => p.position.x.toFixed(8))).size).toBe(1);
  const zs = outs
    .map((p: any) => p.position.z)
    .sort((a: number, b: number) => a - b);
  for (let i = 1; i < zs.length; i++)
    expect(zs[i] - zs[i - 1]).toBeCloseTo(4, 7);
  await smoothTool(page);
  const hover = await world(page);
  await page.mouse.move(hover.x, hover.y);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.scene.nodeVisualPreview.children.length,
    ),
  ).toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.project.roadVisuals?.nodes ?? [],
    ),
  ).toEqual([]);
  await page.locator('[data-upgrade-mode="smooth"]').hover();
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.scene.nodeVisualPreview.children.length,
    ),
  ).toBe(0);
  await clickWorld(page, 0);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.project.roadVisuals.nodes.length,
    ),
  ).toBe(1);
  await page.locator('[data-tool="turn"]').click();
  await clickWorld(page, 0);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.junctionLaneTool.ports,
    ),
  ).toEqual(before.ports);
  const seamBefore = await page.evaluate(() => {
    const group = (window as any).lab.editor.scene.seamPavement;
    const positions: number[][] = [];
    group.traverse((mesh: any) => {
      if (mesh.isMesh)
        positions.push(Array.from(mesh.geometry.attributes.position.array));
    });
    return JSON.stringify(positions);
  });
  const from = before.ports.find((p: any) => p.kind === "in" && p.lane === 0),
    to = outs[4];
  const a = await world(page, from.position.x, from.position.z),
    b = await world(page, to.position.x, to.position.z);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  const authored = await page.evaluate(
    () => (window as any).lab.editor.project.junctionLaneConnections,
  );
  expect(authored.some((r: any) => r.to.some((t: any) => t.lane === 4))).toBe(
    true,
  );
  const surface = await page.evaluate(async () => {
    const path = "/src/render/road-visual-geometry.ts",
      { visibleRoadSurfaceTriangles } = await import(path),
      e = (window as any).lab.editor,
      actual: number[] = [];
    for (const group of [
      e.scene.roads,
      e.scene.junctionMesh,
      e.scene.seamPavement,
      e.scene.visualPavement,
    ])
      group.traverse((mesh: any) => {
        if (
          !mesh.isMesh ||
          !(
            mesh.userData.road ||
            mesh.userData.junction ||
            mesh.userData.visualSeam ||
            mesh.userData.visualRoad
          )
        )
          return;
        const vertices = mesh.geometry.attributes.position,
          index = mesh.geometry.index;
        for (let i = 0; i < (index?.count ?? vertices.count); i++) {
          const n = index ? index.getX(i) : i;
          actual.push(vertices.getX(n), vertices.getY(n), vertices.getZ(n));
        }
      });
    const expected = visibleRoadSurfaceTriangles(e.project).flatMap(
      (triangle: any) => triangle.flatMap((p: any) => [p.x, p.y, p.z]),
    );
    const normalize = (values: number[]) => {
      const triangles: string[] = [];
      for (let i = 0; i < values.length; i += 9) {
        const points = [0, 3, 6].map((j) =>
          values
            .slice(i + j, i + j + 3)
            // Match the Float32 upload used by the actual Three.js buffers
            // before rounding; half-millimetre values can straddle that boundary.
            .map((n) => Math.round(Math.fround(n) * 1000))
            .join(","),
        );
        triangles.push(points.sort().join("|"));
      }
      return triangles.sort();
    };
    return {
      actual: normalize(actual),
      expected: normalize(expected),
      seams: (() => {
        const positions: number[][] = [];
        e.scene.seamPavement.traverse((mesh: any) => {
          if (mesh.isMesh)
            positions.push(Array.from(mesh.geometry.attributes.position.array));
        });
        return JSON.stringify(positions);
      })(),
    };
  });
  expect(surface.actual.length).toBeGreaterThan(0);
  expect(surface.actual).toEqual(surface.expected);
  expect(surface.seams).not.toBe(seamBefore);
  await smoothTool(page);
  await clickWorld(page, 0, 0, true);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.project.roadVisuals.nodes,
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() => (window as any).lab.editor.project.roads),
  ).toEqual(before.roads);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.project.junctionLaneConnections,
    ),
  ).toEqual(authored);
  await page.locator('[data-action="undo"]').click();
  await page.locator("#viewport").focus();
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.project.roadVisuals.nodes.length,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.project.junctionLaneConnections,
    ),
  ).toEqual(authored);
  expect(errors).toEqual([]);
});

test("live visual apply, undo, redo and cancel preserve vehicles, graph, controller and live setting bindings", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-action="example-junction"]').click();
  await page.locator("#confirm-yes").click();
  await page.locator('[data-action="top"]').click();
  await page.locator('[data-tool="signal"]').click();
  await clickWorld(page, 0);
  await page.getByRole("button", { name: "添加红绿灯", exact: true }).click();
  // Enable the selected intersection through the real signal controls.
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).lab.editor.project.signals?.length ?? 0,
      ),
    )
    .toBeGreaterThan(0);
  await page.locator('[data-action="play"]').click();
  await page.waitForFunction(
    () => (window as any).lab.editor.simulation.renderVehicles().length > 0,
  );
  await page.evaluate(() => {
    const e = (window as any).lab.editor,
      sim = e.simulation,
      engine = sim.sourceEngine;
    e.setLaneLookahead(650);
    e.setPortRate(0, 20);
    e.trafficDemandTool.choose(0);
    e.trafficDemandTool.setShare(1, 70);
    sim.update(0);
    const state = {
      project: e.project,
      engine,
      graph: engine.network,
      controller: engine.trafficLights,
      update: sim.update.bind(sim),
      calls: 0,
      snapshot: () =>
        JSON.stringify({
          cars: sim.renderVehicles(),
          elapsed: engine.elapsed,
          totalTime: engine.totalTime,
          completed: engine.completed,
          statistics: engine.statistics,
          signals: engine.trafficLights.states,
          demand: e.project.ports,
          multiplier: e.project.trafficMultiplier,
          lookahead: e.project.laneLookahead,
        }),
    };
    sim.update = () => {}; // Hold one exact simulation instant while pointer/RAF rendering continues.
    for (const name of ["configure", "prepareForRun", "prepareForEditing"])
      sim[name] = (
        (original: (...args: any[]) => any) =>
        (...args: any[]) => {
          state.calls++;
          return original(...args);
        }
      )(sim[name].bind(sim));
    (window as any).visualRun = state;
    (window as any).visualBefore = state.snapshot();
  });
  await smoothTool(page);
  await clickWorld(page, 0);
  for (const action of ["undo", "redo"])
    await page.locator(`[data-action="${action}"]`).click();
  await clickWorld(page, 0, 0, true);
  const result = await page.evaluate(() => {
    const e = (window as any).lab.editor,
      state = (window as any).visualRun;
    return {
      sameProject:
        e.project === state.project && e.simulation.project === e.project,
      sameEngine: e.simulation.sourceEngine === state.engine,
      sameGraph: e.simulation.sourceEngine.network === state.graph,
      sameController:
        e.simulation.sourceEngine.trafficLights === state.controller,
      running: e.simulation.running,
      calls: state.calls,
      unchanged: state.snapshot() === (window as any).visualBefore,
    };
  });
  expect(result).toEqual({
    sameProject: true,
    sameEngine: true,
    sameGraph: true,
    sameController: true,
    running: true,
    calls: 0,
    unchanged: true,
  });
  const binding = await page.evaluate(() => {
    const e = (window as any).lab.editor,
      state = (window as any).visualRun;
    e.setLaneLookahead(700);
    e.setPortRate(0, 15);
    state.update(0);
    return {
      projectBound: e.simulation.project === e.project,
      lookahead: state.engine.project.laneLookahead,
      rate: state.engine.project.ports[0].rate,
      calls: state.calls,
    };
  });
  expect(binding).toEqual({
    projectBound: true,
    lookahead: 700,
    rate: 15,
    calls: 0,
  });
  // Global history keeps normal order: rate first, then lookahead, then visual cancel.
  const historyState = () =>
    page.evaluate(() => {
      const e = (window as any).lab.editor,
        state = (window as any).visualRun;
      state.update(0);
      return {
        rate: e.project.ports[0].rate,
        lookahead: e.project.laneLookahead,
        destinations: e.project.ports[0].destinations,
        smooth: e.project.roadVisuals?.nodes.length ?? 0,
        sameProject:
          e.project === state.project && e.simulation.project === e.project,
        sameEngine: e.simulation.sourceEngine === state.engine,
        sameGraph: state.engine.network === state.graph,
        sameController: state.engine.trafficLights === state.controller,
        running: e.simulation.running,
        calls: state.calls,
      };
    });
  const shares = (await historyState()).destinations;
  for (const expected of [
    { rate: 20, lookahead: 700, smooth: 0 },
    { rate: 20, lookahead: 650, smooth: 0 },
    { rate: 20, lookahead: 650, smooth: 1 },
  ]) {
    await page.locator('[data-action="undo"]').click();
    expect(await historyState()).toEqual({
      ...expected,
      destinations: shares,
      sameProject: true,
      sameEngine: true,
      sameGraph: true,
      sameController: true,
      running: true,
      calls: 0,
    });
  }
  for (const expected of [
    { rate: 20, lookahead: 650, smooth: 0 },
    { rate: 20, lookahead: 700, smooth: 0 },
    { rate: 15, lookahead: 700, smooth: 0 },
  ]) {
    await page.locator('[data-action="redo"]').click();
    expect(await historyState()).toEqual({
      ...expected,
      destinations: shares,
      sameProject: true,
      sameEngine: true,
      sameGraph: true,
      sameController: true,
      running: true,
      calls: 0,
    });
  }
});

test("asset replacement previews hide related node decoration and restore it on pointer leave", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.evaluate(async () => {
    const path = "/src/core/model.ts",
      { emptyProject, makeRoad } = await import(path),
      p = emptyProject(),
      at = (x: number) => ({ x, y: 0, z: 0 }),
      e = (window as any).lab.editor;
    p.roads = [
      makeRoad(at(-100), at(0), {
        id: "preview-a",
        lanesStart: 3,
        lanesEnd: 3,
      }),
      makeRoad(at(0), at(100), { id: "preview-b", lanesStart: 5, lanesEnd: 5 }),
    ];
    e.load(p);
    e.scene.fit(p.roads);
    e.scene.top();
  });
  await smoothTool(page);
  await clickWorld(page, 0);
  const before = await page.evaluate(() => {
    const e = (window as any).lab.editor;
    return {
      project: structuredClone(e.project),
      hasDecoration:
        e.scene.visualRenderCache.get("preview-a")?.group.children.length ?? 0,
    };
  });
  expect(before.hasDecoration).toBeGreaterThan(0);
  await page.locator('[data-upgrade-mode="replace"]').click();
  await page.locator('[data-category="oneway"]').click();
  await page.locator('[data-asset="one-1"]').click();
  const p = await world(page, 65);
  await page.mouse.move(p.x, p.y);
  const preview = await page.evaluate(() => {
    const e = (window as any).lab.editor,
      roads = new Set<string>();
    e.scene.preview.traverse((object: any) => {
      if (object.isMesh && object.userData.road)
        roads.add(object.userData.road);
    });
    return {
      project: structuredClone(e.project),
      decorationVisible:
        e.scene.visualRenderCache.get("preview-a").group.visible,
      roads: [...roads],
    };
  });
  expect(preview.project).toEqual(before.project);
  expect(preview.decorationVisible).toBe(false);
  expect(preview.roads).toContain("preview-a");
  expect(preview.roads).toContain("preview-b");
  await page.locator('[data-action="menu"]').hover();
  expect(
    await page.evaluate(
      () =>
        (window as any).lab.editor.scene.visualRenderCache.get("preview-a")
          .group.visible,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.scene.preview.children.length,
    ),
  ).toBe(0);
});
