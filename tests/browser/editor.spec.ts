import { expect, test, type Page } from "@playwright/test";
const state = (page: Page) =>
  page.evaluate(() => (window as any).lab.getState());
async function open(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.waitForTimeout(100);
}
async function load(page: Page, kind = "new") {
  await page.locator('[data-action="menu"]').click();
  await page.locator(`[data-action="${kind}"]`).click();
  await page.locator("#confirm-yes").click();
  await page.locator('[data-action="top"]').click();
  await page.waitForTimeout(120);
}
async function screen(page: Page, x: number, z: number, y = 0) {
  return page.evaluate((p) => (window as any).lab.worldToScreen(p), {
    x,
    y,
    z,
  });
}
async function clickWorld(
  page: Page,
  x: number,
  z: number,
  y = 0,
  button: "left" | "right" = "left",
) {
  const p = await screen(page, x, z, y);
  await page.mouse.click(p.x, p.y, { button });
}
async function endStroke(page: Page) {
  await page.mouse.click(900, 230, { button: "right" });
}
async function road(page: Page, a = [-60, -15], b = [60, -15]) {
  await page.locator('[data-asset="city-2"]').click();
  await clickWorld(page, ...(a as [number, number]));
  await clickWorld(page, ...(b as [number, number]));
  await endStroke(page);
}

test("game HUD shows road asset thumbnails at bottom center and no retired tools", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  expect((await state(page)).routes).toBe(2);
  await expect(page.locator("#road-dock")).toBeVisible();
  expect(await page.locator(".road-asset svg").count()).toBe(3);
  expect(
    await page
      .locator(
        'select,[data-tool="split"],[data-tool="connect"],[data-connection]',
      )
      .count(),
  ).toBe(0);
  const box = await page.locator("#road-dock").boundingBox();
  expect(Math.abs(box!.x + box!.width / 2 - 720)).toBeLessThan(5);
  expect(box!.y).toBeGreaterThan(500);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "artifacts/game-editor-desktop.png" });
});
test("selecting an asset immediately shows a ghost road before the first click", async ({
  page,
}) => {
  await open(page);
  await load(page);
  await page.locator('[data-asset="city-4"]').click();
  expect((await state(page)).tool).toBe("line");
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.scene.preview.children.length,
    ),
  ).toBeGreaterThan(0);
  await page.mouse.move(700, 350);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.scene.buildMarker.children.length,
    ),
  ).toBe(1);
  await expect(page.locator('[data-asset="city-4"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.screenshot({ path: "artifacts/game-building-preview.png" });
});
test("draws preset straight and curved roads, cancels strokes, undoes and redoes", async ({
  page,
}) => {
  await open(page);
  await load(page);
  await road(page);
  expect((await state(page)).project.roads).toHaveLength(1);
  await page.locator('[data-tool="curve"]').click();
  for (const [x, z] of [
    [-50, 15],
    [0, -2],
    [50, 25],
  ])
    await clickWorld(page, x, z);
  expect((await state(page)).project.roads).toHaveLength(2);
  await page.locator('[data-action="undo"]').click();
  expect((await state(page)).project.roads).toHaveLength(1);
  await page.locator('[data-action="redo"]').click();
  expect((await state(page)).project.roads).toHaveLength(2);
  await page.keyboard.press("Escape");
  expect((await state(page)).tool).toBe("select");
});
test("snaps from a visible pixel radius and constructs an exact shared endpoint", async ({
  page,
}) => {
  await open(page);
  await load(page);
  await road(page, [-65, -15], [0, -15]);
  await page.locator('[data-asset="city-2"]').click();
  const p = await screen(page, 0, -15);
  await page.mouse.move(p.x + 16, p.y + 7);
  expect((await state(page)).snap.kind).toBe("endpoint");
  await expect(page.locator("#snap-feedback")).toContainText("端点");
  await page.mouse.click(p.x + 16, p.y + 7);
  await clickWorld(page, 60, -15);
  const s = await state(page);
  expect(s.project.roads).toHaveLength(2);
  expect(s.project.roads[1].knots[0].p).toEqual(
    s.project.roads[0].knots.at(-1).p,
  );
  await page.screenshot({ path: "artifacts/game-snapping.png" });
});
test("snaps a side road into a road midpoint and automatically makes a T junction", async ({
  page,
}) => {
  await open(page);
  await load(page);
  await road(page);
  await page.locator('[data-asset="city-2"]').click();
  await clickWorld(page, 0, -60);
  const p = await screen(page, 0, -15);
  await page.mouse.move(p.x + 3, p.y + 7);
  expect((await state(page)).snap.kind).toBe("road");
  await page.mouse.click(p.x + 3, p.y + 7);
  const s = await state(page);
  expect(s.project.roads).toHaveLength(3);
  expect(s.junctions).toHaveLength(1);
  expect(s.junctions[0].arms).toHaveLength(3);
});
test("crossing roads automatically form an unmarked intersection and four zebra crossings", async ({
  page,
}) => {
  await open(page);
  await load(page);
  await road(page);
  await page.locator('[data-asset="city-2"]').click();
  await clickWorld(page, 0, -60);
  await clickWorld(page, 0, 10);
  await page.keyboard.press("Escape");
  const s = await state(page);
  expect(s.project.roads).toHaveLength(4);
  expect(s.junctions[0].arms).toHaveLength(4);
  expect(s.junctions[0].crosswalks).toBe(true);
  expect(s.connections).toHaveLength(12);
  await page.keyboard.press("i");
  await page.locator('[data-action="auto-ports"]').click();
  expect((await state(page)).routes).toBe(12);
  await page.locator('[data-action="fit"]').click();
  await page.screenshot({ path: "artifacts/game-automatic-junction.png" });
});
test("B toggles demolition, highlights hovered road and deletes it on click", async ({
  page,
}) => {
  await open(page);
  await load(page);
  await road(page);
  await page.keyboard.press("b");
  expect((await state(page)).tool).toBe("delete");
  const p = await screen(page, 0, -15);
  await page.mouse.move(p.x, p.y);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.scene.hover.children.length,
    ),
  ).toBeGreaterThan(0);
  expect(
    await page.evaluate(() =>
      (
        window as any
      ).lab.editor.scene.hover.children[0].material.color.getHexString(),
    ),
  ).toBe("f15b48");
  await page.screenshot({ path: "artifacts/game-demolition.png" });
  await page.mouse.click(p.x, p.y);
  expect((await state(page)).project.roads).toHaveLength(0);
  await page.keyboard.press("b");
  expect((await state(page)).tool).toBe("select");
  await page.locator('[data-action="undo"]').click();
  expect((await state(page)).project.roads).toHaveLength(1);
});
test("two-way endpoint portals serve both roles and right click removes the whole portal", async ({
  page,
}) => {
  await open(page);
  await load(page);
  await road(page);
  await page.keyboard.press("i");
  await clickWorld(page, -60, -15);
  await clickWorld(page, 60, -15);
  let s = await state(page);
  expect(s.project.ports.map((p: any) => p.type)).toEqual(["both", "both"]);
  expect(s.routes).toBe(2);
  await clickWorld(page, -60, -15, 0, "right");
  s = await state(page);
  expect(s.project.ports).toHaveLength(1);
  expect(s.routes).toBe(0);
  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  expect((await state(page)).project.ports).toHaveLength(1);
});
test("road upgrade uses the selected asset and undo restores the original", async ({
  page,
}) => {
  await open(page);
  await load(page);
  await road(page);
  await page.locator('[data-asset="city-6"]').click();
  await page.keyboard.press("u");
  await clickWorld(page, 0, -15);
  expect((await state(page)).project.roads[0].lanesStart).toBe(3);
  await page.locator('[data-action="undo"]').click();
  expect((await state(page)).project.roads[0].lanesStart).toBe(1);
});
test("procedural transition asset keeps smooth widening and 2+1 exit available", async ({
  page,
}) => {
  await open(page);
  await load(page);
  await page.locator('[data-category="transition"]').click();
  await page.locator('[data-asset="exit-21"]').click();
  await clickWorld(page, -60, -30);
  await clickWorld(page, 0, -30);
  const s = await state(page);
  expect(s.project.roads).toHaveLength(3);
  expect(s.project.roads.filter((r: any) => r.kind === "ramp")).toHaveLength(1);
  expect(s.connections).toHaveLength(3);
  expect(s.project.roads[0].lanesStart).toBe(3);
});
test("height keys build an elevated road without connecting its crossing", async ({
  page,
}) => {
  await open(page);
  await load(page);
  await road(page);
  await page.locator('[data-asset="city-2"]').click();
  await page.keyboard.press("PageUp");
  await clickWorld(page, 0, -60, 8);
  await clickWorld(page, 0, 10, 8);
  const s = await state(page);
  expect(s.project.roads).toHaveLength(2);
  expect(s.junctions).toHaveLength(0);
  expect(s.project.roads[1].knots[0].p.y).toBe(8);
});
test("traffic controls change demand live while preserving cars, time and statistics", async ({
  page,
}) => {
  await open(page);
  await page.locator("#traffic-level").fill("400");
  await page.locator("#traffic-level").press("Tab");
  expect((await state(page)).project.trafficMultiplier).toBe(4);
  await page.locator('[data-action="play"]').click();
  await page.locator('[data-speed="4"]').click();
  await page.waitForFunction(
    () => (window as any).lab.editor.simulation.vehicles.length >= 2,
  );
  const before = await page.evaluate(() => {
    const s = (window as any).lab.editor.simulation;
    return {
      elapsed: s.elapsed,
      ids: s.vehicles.map((c: any) => c.id),
      generated: s.generated,
    };
  });
  await page.locator("#traffic-level").fill("0");
  await page.locator("#traffic-level").press("Tab");
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const s = (window as any).lab.editor.simulation;
    return {
      elapsed: s.elapsed,
      ids: s.vehicles.map((c: any) => c.id),
      generated: s.generated,
      running: s.running,
      instanceCounts:
        s === null
          ? []
          : (window as any).lab.editor.scene.cars.children.map(
              (o: any) => o.count,
            ),
    };
  });
  expect(after.running).toBe(true);
  expect(after.elapsed).toBeGreaterThan(before.elapsed);
  expect(after.ids.some((id: number) => before.ids.includes(id))).toBe(true);
  expect(after.instanceCounts[0]).toBe(after.ids.length);
  expect(after.instanceCounts[2]).toBe(after.ids.length * 4);
  await page.locator('[data-action="play"]').click();
  const g = after.generated;
  await page.waitForTimeout(200);
  expect(
    await page.evaluate(() => (window as any).lab.editor.simulation.generated),
  ).toBe(g);
});
test("selected-road portal flow can be adjusted without resetting simulation", async ({
  page,
}) => {
  await open(page);
  await clickWorld(page, -120, 0);
  await expect(page.locator("#selection-panel")).toBeVisible();
  await page.locator('[data-action="play"]').click();
  await page.waitForTimeout(200);
  const t = await page.evaluate(
    () => (window as any).lab.editor.simulation.elapsed,
  );
  await page.locator("[data-port]").fill("120");
  await page.locator("[data-port]").press("Tab");
  expect((await state(page)).project.ports[0].rate).toBe(120);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).lab.editor.simulation.elapsed),
    )
    .toBeGreaterThan(t);
  expect(
    await page.evaluate(() => (window as any).lab.editor.simulation.running),
  ).toBe(true);
});
test("exports and imports road maps, rejects corrupt files and restores local save", async ({
  page,
}) => {
  await open(page);
  await page.locator('[data-action="menu"]').click();
  const d = page.waitForEvent("download");
  await page.locator('[data-action="export"]').click();
  await (await d).saveAs("artifacts/game-export.json");
  const before = (await state(page)).project;
  await page.locator("#import-file").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":999}'),
  });
  await expect(page.locator("#toast")).toBeVisible();
  expect((await state(page)).project).toEqual(before);
  before.name = "新版道路实验";
  await page.locator("#import-file").setInputFiles({
    name: "map.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(before)),
  });
  await page.locator("#confirm-yes").click();
  expect((await state(page)).project.name).toBe("新版道路实验");
  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  expect((await state(page)).project.name).toBe("新版道路实验");
});
test("junction example supports real turning traffic without browser errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await load(page, "example-junction");
  expect((await state(page)).routes).toBe(12);
  await page.locator('[data-action="play"]').click();
  await page.locator('[data-speed="4"]').click();
  await page.waitForFunction(
    () => (window as any).lab.editor.simulation.completed > 0,
    {},
    { timeout: 15000 },
  );
  expect(errors).toEqual([]);
  await page.screenshot({ path: "artifacts/game-junction-traffic.png" });
});
test("compact screen keeps asset selection and flow controls accessible without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.locator('[data-category="highway"]').click();
  await page.locator('[data-asset="highway-2"]').click();
  expect((await state(page)).asset).toBe("highway-2");
  await expect(page.locator("#traffic-level")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({ path: "artifacts/game-editor-mobile.png" });
});

test("boundary tools return to assets in one click and footer opens manual setup without changing ports", async ({
  page,
}) => {
  await open(page);
  const ports = (await state(page)).project.ports;
  await page.locator(".footer-ports").click();
  expect((await state(page)).tool).toBe("boundary");
  expect((await state(page)).project.ports).toEqual(ports);
  await expect(page.locator("#boundary-panel")).toBeVisible();
  await page.locator('[data-action="roads"]').click();
  await expect(page.locator("#road-dock")).toBeVisible();
  await expect(page.locator("#boundary-panel")).toBeHidden();
  await page.locator('[data-asset="city-2"]').click();
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.scene.preview.children.length,
    ),
  ).toBeGreaterThan(0);
  await page.keyboard.press("i");
  await page.locator('[data-action="roads"]').click();
  await expect(page.locator("#road-dock")).toBeVisible();
  await expect(page.locator("#boundary-panel")).toBeHidden();
  await page.locator('.tool-rail [data-tool="boundary"]').click();
  await page.locator('[data-action="roads"]').click();
  await expect(page.locator("#road-dock")).toBeVisible();
  await expect(page.locator("#boundary-panel")).toBeHidden();
});

test("one-way section snapping aligns outer edges with exact lane continuity", async ({
  page,
}) => {
  await open(page);
  await load(page);
  await page.locator('[data-category="oneway"]').click();
  await page.locator('[data-asset="one-3"]').click();
  await clickWorld(page, -65, -15);
  await clickWorld(page, 0, -15);
  await endStroke(page);
  await page.locator('[data-asset="one-2"]').click();
  const p = await screen(page, 0, -16.75);
  await page.mouse.move(p.x, p.y);
  let s = await state(page);
  expect(s.snap.kind).toBe("offset");
  expect(s.snap.alignment).toBe("left");
  expect(s.snap.offset).toBeCloseTo(-1.75);
  await expect(page.locator("#snap-feedback")).toContainText("左缘对齐");
  await expect(page.locator("#snap-feedback")).toContainText("1.75 m");
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const guide = await page.evaluate(() => {
    const o = (window as any).lab.editor.scene.buildMarker.children.find(
      (o: any) => o.isLine,
    );
    const a = o.geometry.attributes.position.array,
      m = o.matrixWorld.elements;
    return [
      a[2] * m[10] + a[0] * m[2] + m[14],
      a[5] * m[10] + a[3] * m[2] + m[14],
    ];
  });
  expect(guide[0]).toBeCloseTo(-15);
  expect(guide[1]).toBeCloseTo(-16.75);
  await page.screenshot({ path: "artifacts/game-offset-snapping.png" });
  await page.mouse.click(p.x, p.y);
  await clickWorld(page, 60, -16.75);
  s = await state(page);
  expect(s.project.roads).toHaveLength(2);
  expect(s.project.roads[1].knots[0].p.z).toBeCloseTo(-16.75);
  expect(s.connections.map((c: any) => [c.from.lane, c.to.lane])).toEqual([
    [0, 0],
    [1, 1],
  ]);
  await page.keyboard.press("Tab");
  await expect(page.locator("#alignment-mode")).toHaveText("对齐：中线");
});

for (const endZ of [-60, 10])
  test(`offset start becomes a shared node for a perpendicular turn to z=${endZ}`, async ({
    page,
  }) => {
    await open(page);
    await load(page);
    await page.locator('[data-category="oneway"]').click();
    await page.locator('[data-asset="one-3"]').click();
    await clickWorld(page, -65, -15);
    await clickWorld(page, 0, -15);
    await endStroke(page);
    await page.locator('[data-asset="one-2"]').click();
    await page.locator("#alignment-mode").click();
    await page.locator("#alignment-mode").click();
    await clickWorld(page, 0, -16.75);
    const end = await screen(page, 0, endZ);
    await page.mouse.move(end.x, end.y);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const previewStart = await page.evaluate(() => {
      const m = (window as any).lab.editor.scene.preview.children.find(
        (o: any) => o.isMesh,
      );
      const a = m.geometry.attributes.position.array;
      return { x: (a[0] + a[3]) / 2, z: (a[2] + a[5]) / 2 };
    });
    expect(previewStart.x).toBeCloseTo(0, 3);
    expect(previewStart.z).toBeCloseTo(-15, 3);
    await page.mouse.click(end.x, end.y);
    let s = await state(page);
    expect(s.project.roads).toHaveLength(2);
    expect(s.project.roads[1].knots[0].p.z).toBeCloseTo(-15, 3);
    expect(s.project.roads[1].knots[0].p.x).toBeCloseTo(0, 3);
    expect(s.junctions).toHaveLength(1);
    expect(s.issues.filter((i: any) => i.severity === "error")).toHaveLength(0);
    await page.locator(".footer-ports").click();
    await page.locator('[data-action="auto-ports"]').click();
    s = await state(page);
    expect(s.routes).toBe(1);
    expect(s.connections.length).toBeGreaterThan(0);
    await page.screenshot({
      path: `artifacts/game-offset-turn-${endZ < 0 ? "negative" : "positive"}.png`,
    });
  });
