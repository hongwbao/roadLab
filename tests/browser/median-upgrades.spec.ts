import { test, expect, type Page } from "@playwright/test";
const state = (page: Page) =>
  page.evaluate(() => (window as any).lab.getState());
async function at(page: Page, x: number, z = 0) {
  return page.evaluate((p) => (window as any).lab.worldToScreen(p), {
    x,
    y: 0,
    z,
  });
}
async function click(page: Page, x: number, z = 0) {
  const p = await at(page, x, z);
  await page.mouse.click(p.x, p.y);
}
async function upgrade(page: Page, mode: string) {
  await page.locator('[data-tool="upgrade"]').click();
  await page.locator(`[data-upgrade-mode="${mode}"]`).click();
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-action="new"]').click();
  await page.locator("#confirm-yes").click();
  await page.locator('[data-action="top"]').click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
});
async function road(page: Page, asset = "city-4") {
  if (asset.startsWith("one"))
    await page.locator('[data-category="oneway"]').click();
  await page.locator(`[data-asset="${asset}"]`).click();
  await click(page, -50);
  await click(page, 50);
  await page.mouse.click(950, 220, { button: "right" });
}
test("central median upgrades preview,change width,undo,save,reload and remove", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await road(page);
  await expect(page.locator('[data-tool="widen"]')).toHaveCount(0);
  await upgrade(page, "median");
  await expect(page.locator("#asset-list")).toBeHidden();
  const p = await at(page, 0);
  await page.mouse.move(p.x, p.y);
  await expect(page.locator("#tool-hint")).toContainText("隔离带 2");
  expect(
    await page.evaluate(() =>
      (window as any).lab.editor.scene.preview.children.some(
        (m: any) => m.userData.median,
      ),
    ),
  ).toBe(true);
  await page.mouse.click(p.x, p.y);
  expect((await state(page)).project.roads[0].median).toEqual({
    kind: "concrete",
    width: 2,
  });
  await page.locator('[data-median-width="4"]').click();
  await click(page, 0);
  expect((await state(page)).project.roads[0].median.width).toBe(4);
  await page.locator('[data-action="undo"]').click();
  expect((await state(page)).project.roads[0].median.width).toBe(2);
  await page.locator("#viewport").focus();
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  expect((await state(page)).project.roads[0].median.width).toBe(2);
  await upgrade(page, "median");
  await page.locator('[data-median-action="remove"]').click();
  await click(page, 0);
  expect((await state(page)).project.roads[0].median).toBeUndefined();
  await page.locator('[data-action="undo"]').click();
  expect((await state(page)).project.roads[0].median.width).toBe(2);
  expect(errors).toEqual([]);
});
test("one-way roads reject a central median and the unified upgrade menu adds lanes", async ({
  page,
}) => {
  await road(page, "one-2");
  await upgrade(page, "median");
  await click(page, 0);
  await expect(page.locator("#toast")).toContainText("双向");
  expect((await state(page)).project.roads[0].median).toBeUndefined();
  await page.locator('[data-upgrade-mode="widen"]').click();
  await page.locator('[data-asset="one-1"]').click();
  await click(page, 0, 4);
  expect((await state(page)).project.roads[0].lanesStart).toBe(3);
  expect(await page.evaluate(() => (window as any).lab.editor.tool)).toBe(
    "upgrade",
  );
});
test("compact median upgrade choices remain reachable without overflow", async ({
  page,
}) => {
  await road(page);
  await upgrade(page, "median");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const selector of [
    '[data-upgrade-mode="widen"]',
    '[data-upgrade-mode="median"]',
    '[data-median-action="remove"]',
    '[data-median-width="4"]',
  ])
    await expect(page.locator(selector)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator('[data-median-width="4"]').click();
  await expect(page.locator('[data-median-width="4"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator('[data-median-action="remove"]').click();
  await expect(page.locator("#median-widths")).toBeHidden();
});
test("30degree asymmetric junction renders every zebra outside pavement and keeps signal stops aligned", async ({
  page,
}) => {
  await page.evaluate(() => {
    const e = (window as any).lab.editor,
      origin = { x: 0, y: 0, z: 0 };
    const make = (id: string, a: any, b: any) => ({
      id,
      name: id,
      knots: [
        {
          p: a,
          incoming: a,
          outgoing: {
            x: a.x + (b.x - a.x) / 3,
            y: 0,
            z: a.z + (b.z - a.z) / 3,
          },
          at: 0,
        },
        {
          p: b,
          incoming: {
            x: a.x + ((b.x - a.x) * 2) / 3,
            y: 0,
            z: a.z + ((b.z - a.z) * 2) / 3,
          },
          outgoing: b,
          at: 1,
        },
      ],
      twoWay: true,
      lanesStart: 2,
      lanesEnd: 2,
      width: 3.5,
      speed: 50,
      kind: "road",
      align: "center",
      transitionStart: 0,
      transitionEnd: 1,
      transitionMode: "direct",
    });
    e.edit(() => {
      e.project.name = "30°斜交路口回归";
      e.project.roads = [
        make("west", { x: -100, y: 0, z: 0 }, origin),
        make("east", origin, { x: 100, y: 0, z: 0 }),
        make("branch", origin, { x: 100 * Math.cos(Math.PI / 6), y: 0, z: 50 }),
      ];
    });
  });
  await upgrade(page, "widen");
  await click(page, 55, 8);
  let s = await state(page);
  expect(s.project.roads.find((r: any) => r.id === "east").lanesStart).toBe(3);
  await page.locator('[data-upgrade-mode="median"]').click();
  await click(page, 55, 8);
  s = await state(page);
  expect(s.project.roads.find((r: any) => r.id === "east").median.width).toBe(
    2,
  );
  const data = await page.evaluate(() => {
    const e = (window as any).lab.editor,
      j = e.simulation.junctions[0];
    return {
      polygon: j.polygon,
      arms: j.arms,
      stripes: e.scene.junctionMesh.children
        .filter((m: any) => m.userData.crosswalk === j.id)
        .map((m: any) => {
          const p = m.geometry.getAttribute("position");
          return Array.from({ length: p.count }, (_, i) => ({
            x: p.getX(i),
            z: p.getZ(i),
          }));
        }),
    };
  });
  expect(data.stripes.length).toBeGreaterThan(12);
  // Independent polygon clipping validates the actual GPU mesh coordinates.
  for (const quad of data.stripes) {
    let points = quad;
    const cross = (a: any, b: any, c: any) =>
      (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    for (let i = 0; i < data.polygon.length; i++) {
      const a = data.polygon[i],
        b = data.polygon[(i + 1) % data.polygon.length],
        out: any[] = [];
      for (let k = 0; k < points.length; k++) {
        const p = points[k],
          q = points[(k + 1) % points.length],
          cp = cross(a, b, p),
          cq = cross(a, b, q);
        if (cp >= 0) out.push(p);
        if (cp >= 0 !== cq >= 0) {
          const t = cp / (cp - cq);
          out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
        }
      }
      points = out;
    }
    const area =
      Math.abs(
        points.reduce((sum: number, p: any, i: number) => {
          const q = points[(i + 1) % points.length];
          return sum + p.x * q.z - p.z * q.x;
        }, 0),
      ) / 2;
    expect(area).toBeLessThan(1e-7);
  }
  await page.locator('[data-tool="signal"]').click();
  await click(page, 0);
  await page.locator('[data-action="enable-signal"]').click();
  const stop = await page.evaluate(() => {
    const e = (window as any).lab.editor;
    e.simulation.prepareForRun();
    return e.simulation.sourceEngine.trims.get("east").start;
  });
  const arm = data.arms.find((a: any) => a.road === "east");
  expect(stop).toBeCloseTo(
    Math.max(arm.trim + 4.5, arm.crosswalkDistance + 2.5),
    5,
  );
});
