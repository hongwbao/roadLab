import { expect, test, type Page } from "@playwright/test";
const state = (page: Page) =>
  page.evaluate(() => (window as any).lab.getState());
async function junction(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-action="example-junction"]').click();
  await page.locator("#confirm-yes").click();
  await page.locator('[data-action="top"]').click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.locator('[data-tool="signal"]').click();
  const p = await page.evaluate(() =>
    (window as any).lab.worldToScreen({ x: 0, y: 0, z: 0 }),
  );
  await page.mouse.click(p.x, p.y);
  await page.locator('[data-action="enable-signal"]').click();
}

test("traffic lights can be placed, timed, cycled, saved and removed on the map", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await junction(page);
  expect((await state(page)).project.signals).toHaveLength(1);
  await expect(page.locator("[data-signal-live]")).toContainText("直行");
  const visuals = await page.evaluate(
    () => (window as any).lab.editor.scene.trafficLights.group.children.length,
  );
  expect(visuals).toBeGreaterThan(8);
  await page.locator('[data-signal-time="green"]').fill("11");
  await page.locator('[data-signal-time="green"]').dispatchEvent("change");
  expect((await state(page)).project.signals[0].green).toBe(11);
  await page.screenshot({ path: "artifacts/signals-desktop.png" });
  await page.evaluate(() => {
    const s = (window as any).lab.editor.simulation;
    s.trafficLights.update(11);
  });
  await expect(page.locator("[data-signal-live]")).toContainText("黄灯");
  await page.screenshot({ path: "artifacts/signals-yellow.png" });
  await page.evaluate(() => {
    const s = (window as any).lab.editor.simulation;
    s.trafficLights.update(3);
  });
  await expect(page.locator("[data-signal-live]")).toContainText("全红");
  await page.screenshot({ path: "artifacts/signals-all-red.png" });
  await page.evaluate(() => {
    const s = (window as any).lab.editor.simulation;
    s.trafficLights.update(2);
  });
  await expect(page.locator("[data-signal-live]")).toContainText("左转");
  await page.locator('[data-signal-mode="sequential"]').click();
  expect((await state(page)).project.signals[0].mode).toBe("sequential");
  await expect(page.locator('[data-signal-time="leftGreen"]')).toHaveCount(0);
  await page.locator("#viewport").focus();
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  expect((await state(page)).project.signals[0]).toMatchObject({
    green: 11,
    mode: "sequential",
  });
  await page.locator('[data-tool="signal"]').click();
  const p = await page.evaluate(() =>
    (window as any).lab.worldToScreen({ x: 0, y: 0, z: 0 }),
  );
  await page.mouse.click(p.x, p.y);
  await page.locator('[data-action="remove-signal"]').click();
  expect((await state(page)).project.signals).toHaveLength(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).lab.editor.scene.trafficLights.group.children.length,
    ),
  ).toBe(0);
  await page.locator('[data-action="undo"]').click();
  expect((await state(page)).project.signals).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("compact signal tools keep close, mode, timing and removal controls accessible", async ({
  page,
}) => {
  await junction(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#signal-panel")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator(".signal-advanced summary").click();
  const yellow = await page
    .locator('[data-signal-time="yellow"]')
    .boundingBox();
  await page.mouse.move(
    yellow!.x + yellow!.width * 0.3,
    yellow!.y + yellow!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    yellow!.x + yellow!.width * 0.75,
    yellow!.y + yellow!.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();
  expect((await state(page)).project.signals[0].yellow).toBeGreaterThan(3);
  await expect(page.locator(".signal-advanced")).toHaveAttribute("open", "");
  await expect(page.locator('[data-signal-time="yellow"]')).toBeFocused();
  await expect(page.locator("#toast")).toBeVisible();
  const red = await page.locator('[data-signal-time="allRed"]').boundingBox();
  const toast = await page.locator("#toast").boundingBox();
  expect(toast!.y + toast!.height).toBeLessThanOrEqual(red!.y);
  expect(
    await page
      .locator("#toast")
      .evaluate((el) => getComputedStyle(el).pointerEvents),
  ).toBe("none");
  await page.mouse.move(red!.x + red!.width * 0.15, red!.y + red!.height / 2);
  await page.mouse.down();
  await page.mouse.move(red!.x + red!.width * 0.7, red!.y + red!.height / 2, {
    steps: 4,
  });
  await page.mouse.up();
  expect((await state(page)).project.signals[0].allRed).toBeGreaterThan(2);
  await expect(page.locator("#toast")).toBeVisible();
  await page.screenshot({ path: "artifacts/signals-mobile.png" });
  await page.locator('[data-action="remove-signal"]').click();
  await expect(page.locator('[data-action="enable-signal"]')).toBeVisible();
  await page.locator('[data-action="leave-signals"]').click();
  await expect(page.locator("#signal-panel")).toBeHidden();
});

test("signal countdown follows simulation time and pauses with the traffic", async ({
  page,
}) => {
  await junction(page);
  const remaining = await page.evaluate(
    () =>
      (window as any).lab.editor.simulation.trafficLights.states[0].remaining,
  );
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(
      () =>
        (window as any).lab.editor.simulation.trafficLights.states[0].remaining,
    ),
  ).toBe(remaining);
  await page.evaluate(() => {
    const s = (window as any).lab.editor.simulation;
    s.speed = 4;
    s.running = true;
    s.update(0.05);
    s.running = false;
  });
  const after = await page.evaluate(
    () =>
      (window as any).lab.editor.simulation.trafficLights.states[0].remaining,
  );
  expect(remaining - after).toBeCloseTo(0.2, 5);
});
