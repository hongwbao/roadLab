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
async function seed(page: Page, closed = false) {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.evaluate(async (closed) => {
    const modelPath = "/src/core/model.ts",
      rulesPath = "/src/core/junction-lane-connections.ts",
      mathPath = "/src/core/math.ts";
    const { emptyProject, makeRoad } = await import(modelPath),
      { setJunctionLaneRule } = await import(rulesPath),
      { v } = await import(mathPath);
    const e = (window as any).lab.editor,
      p = emptyProject();
    p.ports = [];
    if (closed) {
      p.roads = [
        makeRoad(v(-100, 0), v(), {
          id: "a",
          twoWay: false,
          lanesStart: 1,
          lanesEnd: 1,
        }),
        makeRoad(v(), v(100, 0), {
          id: "b",
          twoWay: false,
          lanesStart: 1,
          lanesEnd: 1,
        }),
      ];
      setJunctionLaneRule(p, { road: "a", lane: 0, end: 1 }, []);
    } else {
      p.roads = [
        makeRoad(v(-100, 0), v(), {
          id: "wide",
          twoWay: true,
          lanesStart: 3,
          lanesEnd: 3,
          backwardLanesStart: 5,
          backwardLanesEnd: 5,
          sectionOffset: 2,
          speed: 60,
        }),
        makeRoad(v(), v(100, 0), {
          id: "six",
          twoWay: true,
          lanesStart: 3,
          lanesEnd: 3,
          median: { kind: "concrete", width: 4 },
          speed: 60,
        }),
      ];
      setJunctionLaneRule(p, { road: "six", lane: 0, end: 0 }, [
        { road: "wide", lane: 1, end: 1 },
        { road: "wide", lane: 0, end: 1 },
      ]);
      setJunctionLaneRule(p, { road: "six", lane: 2, end: 0 }, [
        { road: "wide", lane: 3, end: 1 },
        { road: "wide", lane: 4, end: 1 },
      ]);
    }
    e.edit(() => Object.assign(e.project, p));
    e.scene.fit(e.project.roads);
    e.scene.top();
  }, closed);
  await page.locator('[data-tool="turn"]').click();
  const p = await world(page);
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(
    () => !!(window as any).lab.editor.junctionLaneTool.layout,
  );
}

test("the real lane editor and native network share curves, clipped median and a fully paved vehicle envelope", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await seed(page);
  const evidence = await page.evaluate(async () => {
    const e = (window as any).lab.editor,
      mathPath = "/src/core/math.ts",
      { bezier } = await import(mathPath);
    e.simulation.prepareForRun();
    const layout = e.junctionLaneTool.layout,
      network = e.simulation.sourceEngine.network;
    const comparisons = layout.links.map((link: any) => {
      const lane = [...network.lanes.values()].find(
        (lane: any) => lane.connection === link.id,
      ) as any;
      return {
        id: link.id,
        ui: link.points,
        native: lane?.curve.points,
        uiSamples: link.samples,
        nativeSamples: lane
          ? Array.from({ length: 49 }, (_, i) =>
              bezier(...lane.curve.points, i / 48),
            )
          : [],
      };
    });
    const triangles: any[] = [];
    for (const group of [
      e.scene.roads,
      e.scene.junctionMesh,
      e.scene.seamPavement,
    ])
      group.traverse((mesh: any) => {
        if (
          !mesh.isMesh ||
          !(
            mesh.userData.road ||
            mesh.userData.junction ||
            mesh.userData.visualSeam
          )
        )
          return;
        const v = mesh.geometry.attributes.position,
          indices = mesh.geometry.index;
        for (let i = 0; i < (indices?.count ?? v.count); i += 3)
          triangles.push(
            [0, 1, 2].map((j) => {
              const k = indices ? indices.getX(i + j) : i + j;
              return { x: v.getX(k), z: v.getZ(k) };
            }),
          );
      });
    const contains = (p: any) =>
      triangles.some(([a, b, c]) => {
        const cross = (x: any, y: any) =>
          (y.x - x.x) * (p.z - x.z) - (y.z - x.z) * (p.x - x.x);
        const signs = [cross(a, b), cross(b, c), cross(c, a)];
        return signs.every((s) => s >= -1e-4) || signs.every((s) => s <= 1e-4);
      });
    let outside = 0,
      samples = 0;
    for (const pair of comparisons)
      if (pair.native)
        for (let i = 0; i <= 40; i++) {
          const t = i / 40,
            p = bezier(...pair.native, t),
            a = bezier(...pair.native, Math.max(0, t - 0.001)),
            b = bezier(...pair.native, Math.min(1, t + 0.001)),
            angle = Math.atan2(b.z - a.z, b.x - a.x);
          for (const x of [-1.9, 0, 1.9])
            for (const z of [-0.88, 0, 0.88]) {
              samples++;
              if (
                !contains({
                  x: p.x + x * Math.cos(angle) - z * Math.sin(angle),
                  z: p.z + x * Math.sin(angle) + z * Math.cos(angle),
                })
              )
                outside++;
            }
        }
    let medianStart = Infinity;
    e.scene.roads.traverse((mesh: any) => {
      if (mesh.userData.median === "six") {
        const p = mesh.geometry.attributes.position;
        for (let i = 0; i < p.count; i++)
          medianStart = Math.min(medianStart, p.getX(i));
      }
    });
    return {
      comparisons,
      outside,
      samples,
      medianStart,
      rangeStart: e.scene.ranges.get("six").start,
      ports: layout.ports,
    };
  });
  expect(evidence.comparisons.length).toBeGreaterThan(0);
  for (const pair of evidence.comparisons) {
    expect(pair.native, pair.id).toEqual(pair.ui);
    expect(pair.nativeSamples, pair.id).toEqual(pair.uiSamples);
  }
  expect(evidence.samples).toBeGreaterThan(1000);
  expect(evidence.outside).toBe(0);
  expect(evidence.rangeStart).toBeGreaterThan(0.2);
  expect(evidence.medianStart).toBeGreaterThan(20);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("functional-connection.png"),
  });
  await testInfo.attach("shared-geometry-evidence", {
    body: JSON.stringify(evidence),
    contentType: "application/json",
  });
  // A real pointer drag can still add the chosen lane without changing its identity.
  const from = evidence.ports.find(
      (p: any) => p.road === "six" && p.lane === 1,
    ),
    to = evidence.ports.find((p: any) => p.road === "wide" && p.lane === 4);
  const a = await world(page, from.position.x, from.position.z),
    b = await world(page, to.position.x, to.position.z);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  expect(
    await page.evaluate(() =>
      (window as any).lab.editor.project.junctionLaneConnections.some(
        (r: any) =>
          r.from.road === "six" &&
          r.from.lane === 1 &&
          r.to.some((t: any) => t.road === "wide" && t.lane === 4),
      ),
    ),
  ).toBe(true);
});

test("an all-closed transparent seam can be reopened using coincident real ports", async ({
  page,
}) => {
  await seed(page, true);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.junctionLaneTool.layout.links.length,
    ),
  ).toBe(0);
  const p = await world(page);
  await page.mouse.click(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.project.junctionLaneConnections[0].to,
    ),
  ).toEqual([{ road: "b", lane: 0, end: 0 }]);
});
