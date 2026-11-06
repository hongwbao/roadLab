import { expect, test, type Page } from "@playwright/test";
const state = (page: Page) =>
  page.evaluate(() => (window as any).lab.getState());

test("shared traffic map loads in the deployed UI with reachable routes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-action="example-shared"]').click();
  await page.locator("#confirm-yes").click();
  expect((await state(page)).project.roads).toHaveLength(18);
  expect((await state(page)).project.trafficMultiplier).toBe(4);
  expect((await state(page)).routes).toBe(12);
  await page.evaluate(() => {
    const sim = (window as any).lab.editor.simulation;
    sim.running = true;
    for (let i = 0; i < 200; i++) sim.update(0.05);
  });
  await expect(page.locator("#stat-active")).not.toHaveText("0");
  await expect(page.locator("#traffic-total")).toContainText("1,320");
  expect(errors).toEqual([]);
  await page.screenshot({ path: "artifacts/shared-map-traffic.png" });
});

test("named map saves can be restored from the UI after resetting and reloading", async ({
  page,
}) => {
  await open(page);
  await page.locator('[data-action="menu"]').click();
  await page.locator("#save-name").fill("我的路网存档");
  await page.locator("#save-submit").click();
  await expect(page.locator(".save-row")).toHaveCount(1);
  await expect(page.locator("#save-submit")).toContainText("覆盖存档");
  await page.locator("#save-submit").click();
  await expect(page.locator("#confirm-title")).toContainText("覆盖");
  await page.locator("#confirm-yes").click();
  await expect(page.locator(".save-row")).toHaveCount(1);
  await page.screenshot({ path: "artifacts/map-saves-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/map-saves-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-action="new"]').click();
  await page.locator("#confirm-yes").click();
  expect((await state(page)).project.roads).toHaveLength(0);

  await page.waitForTimeout(750);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  expect((await state(page)).project.roads).toHaveLength(0);
  await page.locator('[data-action="menu"]').click();
  await expect(page.locator(".save-row")).toHaveCount(1);
  await page.locator("[data-save-load]").click();
  await page.locator("#confirm-yes").click();
  expect((await state(page)).project.roads).toHaveLength(5);

  await page.locator('[data-action="menu"]').click();
  await page.locator("[data-save-delete]").click();
  await page.locator("#confirm-yes").click();
  await expect(page.locator(".save-row")).toHaveCount(0);
  expect((await state(page)).project.roads).toHaveLength(5);
});
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
test("camera supports keyboard and requested mouse gestures", async ({
  page,
}) => {
  await open(page);
  const pose = () =>
    page.evaluate(() => {
      const scene = (window as any).lab.editor.scene;
      return {
        target: scene.controls.target.toArray() as number[],
        offset: scene.camera.position
          .clone()
          .sub(scene.controls.target)
          .toArray() as number[],
      };
    });
  const distance = (a: number[], b: number[]) =>
    Math.hypot(...a.map((value, index) => value - b[index]));

  const start = await pose();
  await page.keyboard.down("w");
  await page.waitForTimeout(250);
  await page.keyboard.up("w");
  const moved = await pose();
  expect(distance(start.target, moved.target)).toBeGreaterThan(3);

  await page.keyboard.down("q");
  await page.waitForTimeout(250);
  await page.keyboard.up("q");
  const turned = await pose();
  expect(distance(moved.offset, turned.offset)).toBeGreaterThan(3);

  await page.mouse.move(700, 300);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(820, 340, { steps: 4 });
  await page.mouse.up({ button: "right" });
  const panned = await pose();
  expect(distance(turned.target, panned.target)).toBeGreaterThan(3);

  await page.mouse.down({ button: "left" });
  await page.mouse.move(900, 380, { steps: 4 });
  await page.mouse.up({ button: "left" });
  const rotated = await pose();
  expect(distance(panned.offset, rotated.offset)).toBeGreaterThan(3);

  await page.keyboard.down("t");
  await page.waitForTimeout(180);
  await page.keyboard.up("t");
  const tilted = await pose();
  expect(distance(rotated.offset, tilted.offset)).toBeGreaterThan(2);

  await page.keyboard.down("r");
  await page.waitForTimeout(180);
  await page.keyboard.up("r");
  const zoomed = await pose();
  expect(distance(tilted.offset, zoomed.offset)).toBeGreaterThan(2);

  await page.mouse.move(700, 300);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(700, 400, { steps: 4 });
  await page.mouse.up({ button: "middle" });
  const middleDragged = await pose();
  expect(distance(zoomed.offset, middleDragged.offset)).toBeGreaterThan(2);

  await page.mouse.click(700, 300, { button: "middle" });
  const middleClicked = await pose();
  expect(distance(middleDragged.offset, middleClicked.offset)).toBeGreaterThan(
    2,
  );

  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(100);
  const wheeled = await pose();
  expect(distance(middleClicked.offset, wheeled.offset)).toBeGreaterThan(2);

  await page.mouse.move(2, 400);
  await page.waitForTimeout(180);
  const edged = await pose();
  expect(distance(wheeled.target, edged.target)).toBeGreaterThan(2);
  await page.mouse.move(700, 300);
});
test("mouse drags navigate while clicks build and right click steps back", async ({
  page,
}) => {
  await open(page);
  await load(page);
  await page.locator('[data-asset="city-2"]').click();
  const before = await page.evaluate(() => {
    const scene = (window as any).lab.editor.scene;
    return scene.camera.position.clone().sub(scene.controls.target).toArray();
  });
  await page.mouse.move(600, 280);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(710, 140, { steps: 4 });
  await page.mouse.up({ button: "left" });
  await page.waitForTimeout(120);
  const after = await page.evaluate(() => ({
    offset: (window as any).lab.editor.scene.camera.position
      .clone()
      .sub((window as any).lab.editor.scene.controls.target)
      .toArray(),
    points: (window as any).lab.editor.drawPoints.length,
  }));
  expect(
    Math.hypot(...after.offset.map((x: number, i: number) => x - before[i])),
  ).toBeGreaterThan(2);
  expect(after.points).toBe(0);

  await clickWorld(page, -50, -10);
  expect(
    await page.evaluate(() => (window as any).lab.editor.drawPoints.length),
  ).toBe(1);
  await page.mouse.move(600, 280);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(710, 300, { steps: 4 });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(120);
  expect(
    await page.evaluate(() => (window as any).lab.editor.drawPoints.length),
  ).toBe(1);
  await page.mouse.click(700, 300, { button: "right" });
  expect(
    await page.evaluate(() => (window as any).lab.editor.drawPoints.length),
  ).toBe(0);

  await page.locator('[data-tool="curve"]').click();
  await clickWorld(page, -50, -10);
  await clickWorld(page, 0, -10);
  expect(
    await page.evaluate(() => (window as any).lab.editor.drawPoints.length),
  ).toBe(2);
  await page.mouse.click(700, 300, { button: "right" });
  expect(
    await page.evaluate(() => (window as any).lab.editor.drawPoints.length),
  ).toBe(1);
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
test("two-way roads have yellow centerlines and elevated supports clear lower roads", async ({
  page,
}) => {
  await open(page);
  await load(page, "example-elevated");
  const geometry = await page.evaluate(() => {
    const { scene, project } = (window as any).lab.editor;
    const upper = project.roads.find((road: any) => road.name === "第二层高架");
    const group = scene.roads.children.find((candidate: any) =>
      candidate.children.some((child: any) => child.userData.road === upper.id),
    );
    return {
      yellow: scene.details.children.filter(
        (child: any) => child.material?.color?.getHex() === 0xf3c454,
      ).length,
      pillars: group.children
        .filter((child: any) => child.geometry?.type === "CylinderGeometry")
        .map((child: any) => ({ x: child.position.x, z: child.position.z })),
    };
  });
  expect(geometry.yellow).toBeGreaterThan(0);
  expect(geometry.pillars.length).toBeGreaterThan(0);
  expect(
    geometry.pillars.some(
      (pillar: { x: number; z: number }) =>
        Math.abs(pillar.x - 102) < 4 && Math.abs(pillar.z + 60) < 4,
    ),
  ).toBe(false);
  await page.screenshot({ path: "artifacts/game-elevated-fixed.png" });
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
  expect(s.project.roads[0].lanesStart).toBe(2);
  expect(s.project.roads[0].lanesEnd).toBe(3);
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
  await page.locator(".map-files summary").click();
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
  await page.locator("#lane-snap-toggle").click();
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

test("one-way section snapping also aligns the road end", async ({ page }) => {
  await open(page);
  await load(page);
  await page.locator('[data-category="oneway"]').click();
  await page.locator('[data-asset="one-3"]').click();
  await clickWorld(page, 0, -15);
  await clickWorld(page, 65, -15);
  await endStroke(page);
  await page.locator('[data-asset="one-2"]').click();
  await page.locator("#lane-snap-toggle").click();
  await clickWorld(page, -65, -16.75);
  const endpoint = await screen(page, 0, -16.75);
  await page.mouse.move(endpoint.x, endpoint.y);
  const s = await state(page);
  expect(s.snap.kind).toBe("offset");
  expect(Math.abs(s.snap.offset)).toBeCloseTo(1.75);
  await page.mouse.click(endpoint.x, endpoint.y);
  expect((await state(page)).project.roads[1].knots.at(-1).p.z).toBeCloseTo(
    -16.75,
  );
});
test("angled road ends snap to a lane edge and blend into the target tangent", async ({
  page,
}) => {
  await open(page);
  await load(page);
  await page.locator('[data-category="oneway"]').click();
  await page.locator('[data-asset="one-3"]').click();
  await clickWorld(page, 0, -15);
  await clickWorld(page, 65, -15);
  await endStroke(page);
  await page.locator('[data-asset="one-2"]').click();
  await page.locator("#lane-snap-toggle").click();
  await clickWorld(page, -65, -45);
  const endpoint = await screen(page, 0, -16.75);
  await page.mouse.move(endpoint.x, endpoint.y);
  expect((await state(page)).snap.kind).toBe("offset");
  await page.mouse.click(endpoint.x, endpoint.y);
  const road = (await state(page)).project.roads[1];
  expect(road.knots.at(-1).p.z).toBeCloseTo(-16.75);
  expect(road.knots.at(-1).incoming.z).toBeCloseTo(-16.75);
  await page.screenshot({ path: "artifacts/game-angled-lane-join.png" });
});
test("continuous road building preserves the previous road tangent", async ({
  page,
}) => {
  await open(page);
  await load(page);
  await page.locator('[data-category="oneway"]').click();
  await page.locator('[data-asset="one-2"]').click();
  await clickWorld(page, -60, -20);
  await clickWorld(page, 0, -20);
  await clickWorld(page, 60, -10);
  const roads = (await state(page)).project.roads;
  expect(roads).toHaveLength(2);
  expect(roads[1].knots[0].p).toEqual(roads[0].knots.at(-1).p);
  expect(roads[1].knots[0].outgoing.z).toBeCloseTo(-20);
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

test("lane snapping selects an inner lane of a four-lane road and persists the connection", async ({
  page,
}) => {
  await open(page);
  await load(page);
  await page.locator('[data-category="oneway"]').click();
  await page.locator('[data-asset="one-4"]').click();
  await clickWorld(page, 0, -15);
  await clickWorld(page, 80, -15);
  await endStroke(page);
  await page.locator('[data-asset="one-1"]').click();
  await clickWorld(page, -70, -16.75);
  const target = await screen(page, 0, -16.75);
  await page.mouse.move(target.x, target.y);
  await expect(page.locator("#snap-feedback")).toContainText("第 2 车道");
  let s = await state(page);
  expect(s.snap.kind).toBe("lane");
  expect(s.snap.lanes).toEqual([1]);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.scene.laneTarget.children.length,
    ),
  ).toBeGreaterThan(0);
  await page.screenshot({ path: "artifacts/lane-attachment-preview.png" });
  await page.mouse.click(target.x, target.y);
  s = await state(page);
  const original = s.project.roads[0].id,
    added = s.project.roads[1].id;
  expect(
    s.connections
      .filter((c: any) => c.from.road === added && c.to.road === original)
      .map((c: any) => c.to.lane),
  ).toEqual([1]);
  await endStroke(page);
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  s = await state(page);
  expect(s.project.roads[1].attachments.end.lanes).toEqual([1]);
  expect(
    s.connections
      .filter((c: any) => c.from.road === added && c.to.road === original)
      .map((c: any) => c.to.lane),
  ).toEqual([1]);
});

test("two-lane groups can snap to the middle of four lanes and cycle candidates with Tab", async ({
  page,
}) => {
  await open(page);
  await load(page);
  await page.locator('[data-category="oneway"]').click();
  await page.locator('[data-asset="one-4"]').click();
  await clickWorld(page, -80, -15);
  await clickWorld(page, 0, -15);
  await endStroke(page);
  await page.locator('[data-asset="one-2"]').click();
  const target = await screen(page, 0, -15);
  await page.mouse.move(target.x, target.y);
  expect((await state(page)).snap.lanes).toEqual([1, 2]);
  await page.screenshot({ path: "artifacts/lane-group-preview.png" });
  await page.locator("#viewport").focus();
  await page.keyboard.press("Tab");
  expect((await state(page)).snap.lanes).not.toEqual([1, 2]);
  await page.mouse.move(target.x + 30, target.y + 50);
  await page.mouse.move(target.x, target.y);
  expect((await state(page)).snap.lanes).toEqual([1, 2]);
  await page.mouse.click(target.x, target.y);
  await clickWorld(page, 65, -15);
  expect(
    (await state(page)).connections.map((c: any) => [c.from.lane, c.to.lane]),
  ).toEqual([
    [1, 0],
    [2, 1],
  ]);
  await page.keyboard.press("Control+z");
  expect((await state(page)).project.roads).toHaveLength(1);
  await page.keyboard.press("Control+Shift+z");
  expect((await state(page)).project.roads).toHaveLength(2);
});

test("generic split controls build a left 4-to-2+2 exit with smooth lane mapping", async ({
  page,
}) => {
  await open(page);
  await load(page);
  await page.locator('[data-category="transition"]').click();
  await page.locator('[data-asset="exit-21"]').click();
  await page.getByRole("button", { name: "增加起点车道", exact: true }).click();
  await page.getByRole("button", { name: "增加起点车道", exact: true }).click();
  await page.getByRole("button", { name: "增加终点车道", exact: true }).click();
  await page.getByRole("button", { name: "增加匝道车道", exact: true }).click();
  await page.locator('[data-build-side="left"]').click();
  await page.locator("#branch-length").fill("100");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("#branch-length")).toBeVisible();
  await page.screenshot({ path: "artifacts/lane-builder-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await clickWorld(page, -80, 0);
  await clickWorld(page, 0, 0);
  await endStroke(page);
  const s = await state(page);
  expect(s.project.roads).toHaveLength(3);
  const ramp = s.project.roads.find((r: any) => r.kind === "ramp");
  expect(ramp.lanesStart).toBe(2);
  expect(
    s.connections
      .filter((c: any) => c.to.road === ramp.id)
      .map((c: any) => c.from.lane),
  ).toEqual([0, 1]);
  expect(s.issues.filter((i: any) => i.severity === "error")).toHaveLength(0);
  await page.locator('[data-action="fit"]').click();
  await page.screenshot({ path: "artifacts/lane-generic-split.png" });
});

test("lane turn rules use on-map selection, change routes, and can be restored", async ({
  page,
}) => {
  await open(page);
  await load(page, "example-junction");
  const before = await state(page);
  const road = before.project.roads.find((r: any) => r.knots[0].p.x < -50);
  await page.locator('[data-tool="turn"]').click();
  await clickWorld(page, -45, 1.75);
  await expect(page.locator("#turn-panel")).toContainText("第 1 车道");
  await page.locator('[data-turn="left"]').click();
  await page.locator('[data-turn="right"]').click();
  let s = await state(page);
  const changed = s.project.roads.find((r: any) => r.id === road.id);
  expect(changed.turns["1"]).toEqual(["straight"]);
  expect(
    s.connections.filter((c: any) => c.from.road === road.id),
  ).toHaveLength(1);
  await page.screenshot({ path: "artifacts/lane-turn-rules.png" });
  await page.locator('[data-action="reset-turns"]').click();
  s = await state(page);
  expect(
    s.connections.filter((c: any) => c.from.road === road.id),
  ).toHaveLength(3);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/lane-turn-rules-mobile.png" });
});

test("a ramp can start at a mainline midpoint using an outer lane without crossing inner lanes", async ({
  page,
}) => {
  await open(page);
  await load(page);
  await page.locator('[data-category="oneway"]').click();
  await page.locator('[data-asset="one-4"]').click();
  await clickWorld(page, -55, -15);
  await clickWorld(page, 55, -15);
  await endStroke(page);
  await page.locator('[data-category="highway"]').click();
  await page.locator('[data-asset="ramp-1"]').click();
  const start = await screen(page, 0, -9.75);
  await page.mouse.move(start.x, start.y);
  let s = await state(page);
  expect(s.snap.kind).toBe("lane");
  expect(s.snap.lanes).toEqual([3]);
  expect(s.snap.interior).toBe(true);
  await page.mouse.click(start.x, start.y);
  await clickWorld(page, 75, 30);
  await endStroke(page);
  s = await state(page);
  expect(s.project.roads).toHaveLength(3);
  const ramp = s.project.roads.find((r: any) => r.kind === "ramp");
  expect(ramp.attachments.start.lanes).toEqual([3]);
  expect(
    s.connections.some((c: any) => c.to.road === ramp.id && c.from.lane === 3),
  ).toBe(true);
  expect(s.junctions).toHaveLength(0);
});

test("reselecting a split asset keeps the displayed side, preview and generated ramp consistent", async ({
  page,
}) => {
  await open(page);
  await load(page);
  await page.locator('[data-category="transition"]').click();
  await page.locator('[data-asset="exit-21"]').click();
  await page.locator('[data-build-side="left"]').click();
  await page.locator('[data-asset="merge-32"]').click();
  await page.locator('[data-asset="exit-21"]').click();
  await expect(page.locator('[data-build-side="right"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    await page.evaluate(() => (window as any).lab.editor.branch.side),
  ).toBe("right");
  await clickWorld(page, -60, 0);
  const end = await screen(page, 0, 0);
  await page.mouse.move(end.x, end.y);
  const z = await page.evaluate(() => {
    const vertices: number[] = [];
    for (const mesh of (window as any).lab.editor.scene.preview.children.filter(
      (o: any) => o.isMesh,
    )) {
      const p = mesh.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) vertices.push(p.getZ(i));
    }
    return { min: Math.min(...vertices), max: Math.max(...vertices) };
  });
  expect(z.max).toBeGreaterThan(20);
  expect(z.min).toBeGreaterThan(-10);
  await page.mouse.click(end.x, end.y);
  const s = await state(page),
    ramp = s.project.roads.find((r: any) => r.kind === "ramp");
  expect(ramp.knots.at(-1).p.z).toBeGreaterThan(20);
  expect(
    s.connections
      .filter((c: any) => c.to.road === ramp.id)
      .map((c: any) => c.from.lane),
  ).toEqual([2]);
});
