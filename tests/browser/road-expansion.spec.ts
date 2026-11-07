import { test, expect, type Page } from "@playwright/test";
async function point(page: Page, x: number, z = 0) {
  return page.evaluate((p) => (window as any).lab.worldToScreen(p), {
    x,
    y: 0,
    z,
  });
}
async function click(page: Page, x: number, z = 0) {
  const p = await point(page, x, z);
  await page.mouse.click(p.x, p.y);
}
async function cancel(page: Page) {
  await page.mouse.click(950, 220, { button: "right" });
}
const state = (page: Page) =>
  page.evaluate(() => (window as any).lab.getState());
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
test("one-lane asset grows an existing one-way road on the hovered side with a real preview", async ({
  page,
}) => {
  await page.locator('[data-category="oneway"]').click();
  await page.locator('[data-asset="one-2"]').click();
  await click(page, -50);
  await click(page, 50);
  await cancel(page);
  await page.locator('[data-asset="one-1"]').click();
  await page.locator('[data-tool="upgrade"]').click();
  await page.locator('[data-upgrade-mode="widen"]').click();
  const q = await point(page, 0, 4);
  await page.mouse.move(q.x, q.y);
  await expect(page.locator("#tool-hint")).toContainText("右侧增加 1");
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.scene.preview.children.length,
    ),
  ).toBeGreaterThan(0);
  await page.mouse.click(q.x, q.y);
  let s = await state(page);
  expect(s.project.roads).toHaveLength(1);
  expect(s.project.roads[0].lanesStart).toBe(3);
  expect(s.project.roads[0].sectionOffset).toBeCloseTo(1.75);
  expect(s.project.roads[0].autoTaper).toBeUndefined();
  await click(page, 0, -4);
  s = await state(page);
  expect(s.project.roads[0].lanesStart).toBe(4);
  expect(s.project.roads[0].sectionOffset).toBeCloseTo(0);
});
test("two-way 2+2 becomes 2+3 and 3+3 with save and undo keeping direction counts", async ({
  page,
}) => {
  await page.locator('[data-asset="city-4"]').click();
  await click(page, -50);
  await click(page, 50);
  await cancel(page);
  await page.locator('[data-tool="upgrade"]').click();
  await page.locator('[data-upgrade-mode="widen"]').click();
  await click(page, 0, 8);
  let r = (await state(page)).project.roads[0];
  expect(r.twoWay).toBe(true);
  expect(r.lanesStart).toBe(3);
  expect(r.backwardLanesStart).toBe(2);
  await click(page, 0, -8);
  r = (await state(page)).project.roads[0];
  expect(r.lanesStart).toBe(3);
  expect(r.backwardLanesStart).toBe(3);
  await page.locator('[data-action="undo"]').click();
  r = (await state(page)).project.roads[0];
  expect(r.backwardLanesStart).toBe(2);
  await page.locator("#viewport").focus();
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  r = (await state(page)).project.roads[0];
  expect(r.lanesStart).toBe(3);
  expect(r.backwardLanesStart).toBe(2);
  expect(r.autoTaper).toBeUndefined();
});
test("an independent one-lane branch fills the spare lane of a direct two-to-three join", async ({
  page,
}) => {
  await page.locator('[data-category="oneway"]').click();
  await page.locator('[data-asset="one-3"]').click();
  await click(page, 0);
  await click(page, 80);
  await cancel(page);
  await page.locator('[data-asset="one-2"]').click();
  await click(page, -80, -1.75);
  await click(page, 0, -1.75);
  await cancel(page);
  await page.locator('[data-asset="one-1"]').click();
  await click(page, -60, 25);
  const q = await point(page, 0, 3.5);
  await page.mouse.move(q.x, q.y);
  await expect(page.locator("#snap-feedback")).toContainText("车道");
  await page.mouse.click(q.x, q.y);
  await cancel(page);
  const s = await state(page),
    wide = s.project.roads.find((r: any) => r.lanesStart === 3),
    links = s.connections.filter((c: any) => c.to.road === wide.id);
  expect(s.project.roads).toHaveLength(3);
  expect(s.project.roads.every((r: any) => !r.autoTaper)).toBe(true);
  expect(links.map((c: any) => c.to.lane).sort()).toEqual([0, 1, 2]);
  await page.evaluate(() =>
    (window as any).lab.editor.simulation.prepareForRun(),
  );
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.simulation.needsPreparation,
    ),
  ).toBe(false);
});
test("lane edits reuse road meshes and defer vehicle compilation until testing", async ({
  page,
}) => {
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-action="example-junction"]').click();
  await page.locator("#confirm-yes").click();
  await page.locator('[data-tool="turn"]').click();
  await click(page, 0);
  const before = await page.evaluate(() =>
    (window as any).lab.editor.scene.roads.children.map((o: any) => o.uuid),
  );
  await page.locator(".junction-lane-keyboard summary").click();
  await page
    .locator('[data-junction-lane-action="choose-source"]')
    .first()
    .click();
  await page
    .locator('[data-junction-lane-action="toggle-target"]')
    .first()
    .click();
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.simulation.needsPreparation,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      (window as any).lab.editor.scene.roads.children.map((o: any) => o.uuid),
    ),
  ).toEqual(before);
  await page.locator('[data-action="play"]').click();
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.simulation.needsPreparation,
    ),
  ).toBe(false);
});
