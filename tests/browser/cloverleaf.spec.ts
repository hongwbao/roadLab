import { expect, test } from "@playwright/test";

test("the elevated example loads a four-direction cloverleaf with isolated through lanes and working collector ramps", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.locator('[data-action="menu"]').click();
  await expect(page.locator('[data-action="example-elevated"]')).toContainText(
    "苜蓿叶",
  );
  await page.locator('[data-action="example-elevated"]').click();
  await page.locator("#confirm-yes").click();
  await page.locator('[data-action="top"]').click();
  const project = await page.evaluate(
    () => (window as any).lab.getState().project,
  );
  expect(project.name).toContain("苜蓿叶");
  expect(project.roads).toHaveLength(40);
  expect(project.roads.filter((r: any) => r.id.endsWith("-main"))).toHaveLength(
    4,
  );
  expect(project.roads.filter((r: any) => r.kind === "ramp")).toHaveLength(8);
  expect(project.roads.every((r: any) => r.width === 4)).toBe(true);
  await page.locator("#traffic-level").fill("25");
  await page.locator('[data-action="play"]').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).lab.getState().routes))
    .toBeGreaterThanOrEqual(12);
  const traffic = await page.evaluate(() => {
    const sim = (window as any).lab.editor.simulation;
    for (let i = 0; i < 1800; i++) sim.update(0.05);
    return {
      generated: sim.generated,
      completed: sim.completed,
      vehicles: sim.vehicles.length,
    };
  });
  expect(traffic.generated).toBeGreaterThan(20);
  expect(traffic.completed).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  await page.locator('[data-action="play"]').click();
  await page.locator("#viewport").focus();
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  expect(
    await page.evaluate(
      () => (window as any).lab.getState().project.roads.length,
    ),
  ).toBe(40);
});
