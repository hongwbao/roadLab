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
async function setup(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-action="new"]').click();
  await page.locator("#confirm-yes").click();
  await page.locator('[data-action="top"]').click();
  await page.waitForTimeout(120);
  await page.locator('[data-category="oneway"]').click();
}
async function cancel(page: Page) {
  await page.mouse.click(950, 220, { button: "right" });
}

test("ordinary 2 and 3 lane assets join directly until explicitly upgraded", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await setup(page);
  await page.locator('[data-asset="one-2"]').click();
  await click(page, -85);
  await click(page, 0);
  await cancel(page);
  await page.locator('[data-asset="one-3"]').click();
  await click(page, 0);
  const end = await at(page, 85);
  await page.mouse.move(end.x, end.y);
  await expect(page.locator("#tool-hint")).not.toContainText(
    "自动生成车道过渡",
  );
  await page.screenshot({ path: "artifacts/automatic-widening-preview.png" });
  await page.mouse.click(end.x, end.y);
  await cancel(page);
  let s = await state(page);
  expect(s.project.roads).toHaveLength(2);
  expect(s.project.roads[1].lanesStart).toBe(3);
  expect(s.project.roads[1].lanesEnd).toBe(3);
  expect(s.project.roads[1].autoTaper).toBeUndefined();
  await page.locator('[data-tool="upgrade"]').click();
  await page.locator('[data-upgrade-mode="smooth"]').click();
  await click(page, 45);
  s = await state(page);
  expect(s.project.roads[1].autoTaper.start.lanes).toBe(2);
  expect(s.connections).toHaveLength(2);
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  s = await state(page);
  expect(s.project.roads[1].autoTaper.start.lanes).toBe(2);
  expect(s.project.roads).toHaveLength(2);
  await page.locator('[data-action="fit"]').click();
  await page.screenshot({ path: "artifacts/automatic-widening.png" });
  expect(errors).toEqual([]);
});

test("an explicit narrowing uses the wider approach and disappears after disconnecting", async ({
  page,
}) => {
  await setup(page);
  await page.locator('[data-asset="one-3"]').click();
  await click(page, -85);
  await click(page, 0);
  await cancel(page);
  await page.locator('[data-asset="one-2"]').click();
  await click(page, 0);
  await click(page, 85);
  await cancel(page);
  let s = await state(page);
  expect(s.project.roads[0].autoTaper).toBeUndefined();
  await page.locator('[data-tool="upgrade"]').click();
  await page.locator('[data-upgrade-mode="smooth"]').click();
  await click(page, -45);
  s = await state(page);
  expect(s.project.roads[0].autoTaper.end.lanes).toBe(2);
  expect(s.project.roads[1].autoTaper).toBeUndefined();
  await page.screenshot({ path: "artifacts/automatic-narrowing.png" });
  await page.keyboard.press("b");
  await click(page, 60);
  await page.keyboard.press("Escape");
  s = await state(page);
  expect(s.project.roads).toHaveLength(1);
  expect(s.project.roads[0].autoTaper).toBeUndefined();
  await page.keyboard.press("Control+z");
  s = await state(page);
  expect(s.project.roads).toHaveLength(2);
  expect(s.project.roads[0].autoTaper.end.lanes).toBe(2);
});

test("a two-way direct join can be explicitly smoothed without creating an intersection", async ({
  page,
}) => {
  await setup(page);
  await page.locator('[data-category="city"]').click();
  await page.locator('[data-asset="city-2"]').click();
  await click(page, -85);
  await click(page, 0);
  await cancel(page);
  await page.locator('[data-asset="city-4"]').click();
  await click(page, 0);
  await click(page, 85);
  await cancel(page);
  let s = await state(page);
  expect(s.project.roads).toHaveLength(2);
  expect(s.project.roads[1].autoTaper).toBeUndefined();
  await page.locator('[data-tool="upgrade"]').click();
  await page.locator('[data-upgrade-mode="smooth"]').click();
  await click(page, 45);
  s = await state(page);
  expect(s.project.roads[1].autoTaper.start.lanes).toBe(1);
  expect(s.connections).toHaveLength(2);
  expect(s.junctions).toHaveLength(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/automatic-transition-mobile.png" });
});
