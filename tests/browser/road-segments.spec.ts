import { expect, test, type Page } from "@playwright/test";
const state = (page: Page) =>
  page.evaluate(() => (window as any).lab.getState());
async function open(page: Page, kind = "new") {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.locator('[data-action="menu"]').click();
  await page.locator(`[data-action="${kind}"]`).click();
  await page.locator("#confirm-yes").click();
  await page.locator('[data-action="top"]').click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function screen(page: Page, x: number, z: number) {
  return page.evaluate((p) => (window as any).lab.worldToScreen(p), {
    x,
    y: 0,
    z,
  });
}
async function click(page: Page, x: number, z: number) {
  const p = await screen(page, x, z);
  await page.mouse.click(p.x, p.y);
}

test("long roads preview nodes, create independent segments, and support local demolition and undo", async ({
  page,
}) => {
  await open(page);
  await page.locator('[data-asset="city-2"]').click();
  await click(page, -150, -20);
  const end = await screen(page, 150, -20);
  await page.mouse.move(end.x, end.y);
  expect(
    await page.evaluate(
      () =>
        (window as any).lab.editor.scene.preview.children.filter(
          (o: any) => o.userData.segmentNode,
        ).length,
    ),
  ).toBe(2);
  await page.screenshot({ path: "artifacts/road-segment-preview.png" });
  await page.mouse.click(end.x, end.y);
  await page.keyboard.press("Escape");
  let s = await state(page);
  expect(s.project.roads).toHaveLength(3);
  expect(s.connections).toHaveLength(4);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.scene.roadNodes.children.length,
    ),
  ).toBe(4);
  await page.keyboard.press("b");
  await click(page, 0, -20);
  s = await state(page);
  expect(s.project.roads).toHaveLength(2);
  expect(
    s.project.roads.some(
      (r: any) => r.knots[0].p.x < 0 && r.knots.at(-1).p.x > 0,
    ),
  ).toBe(false);
  await page.keyboard.press("Control+z");
  expect((await state(page)).project.roads).toHaveLength(3);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "artifacts/road-segments-simple.png" });
});

test("continuous construction resumes at the last automatic node and thumbnails omit direction arrows", async ({
  page,
}) => {
  await open(page);
  await page.locator('[data-category="oneway"]').click();
  await page.locator('[data-asset="one-2"]').click();
  expect(
    await page.evaluate(() => (window as any).lab.editor.settings.arrows),
  ).toBe(false);
  await expect(
    page.locator('.road-asset svg path[stroke="#dce9eb"]'),
  ).toHaveCount(0);
  await click(page, -150, -20);
  await click(page, 60, -20);
  await click(page, 150, -20);
  const s = await state(page);
  expect(s.project.roads).toHaveLength(3);
  expect(s.project.roads[2].knots[0].p.x).toBeCloseTo(60);
  expect(s.project.roads[2].knots.at(-1).p.x).toBeCloseTo(150);
  expect(s.connections).toHaveLength(4);
});
