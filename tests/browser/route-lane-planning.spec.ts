import { expect, test, type Page } from "@playwright/test";
async function openSettings(page: Page) {
  await page.locator('[data-action="menu"]').click();
  await page.locator(".traffic-ai-settings summary").click();
}
test("lane horizon defaults to 500m, rejects invalid values, and persists with the map", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await openSettings(page);
  const input = page.locator("#lane-lookahead");
  await expect(input).toHaveValue("500");
  for (const value of ["99", "2001", ""]) {
    await input.fill(value);
    await input.dispatchEvent("change");
    await expect(input).toHaveValue("500");
    await expect(page.locator("#toast")).toContainText("100–2000");
  }
  await input.fill("750");
  await input.dispatchEvent("change");
  expect(
    await page.evaluate(() => (window as any).lab.editor.project.laneLookahead),
  ).toBe(750);
  await page.locator("#viewport").focus();
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  await openSettings(page);
  await expect(input).toHaveValue("750");
  expect(errors).toEqual([]);
});
test("changing the lane horizon during a running test retains its runtime and cars without rebuilding roads", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-action="example-junction"]').click();
  await page.locator("#confirm-yes").click();
  await page.locator('[data-action="play"]').click();
  await page.waitForFunction(
    () => (window as any).lab.editor.simulation.vehicles.length > 0,
  );
  await page.evaluate(() => {
    const s = (window as any).lab.editor.simulation;
    (window as any).laneHorizonBefore = {
      source: s.sourceEngine,
      ids: s.vehicles.map((c: any) => c.id),
      elapsed: s.elapsed,
    };
    const scene = (window as any).lab.editor.scene;
    const rebuild = scene.roadMesh.bind(scene);
    (window as any).laneHorizonMeshes = 0;
    scene.roadMesh = (...args: any[]) => {
      (window as any).laneHorizonMeshes++;
      return rebuild(...args);
    };
  });
  await openSettings(page);
  await page.locator("#lane-lookahead").fill("900");
  await page.locator("#lane-lookahead").dispatchEvent("change");
  await page.waitForFunction(
    () =>
      (window as any).lab.editor.simulation.sourceEngine.laneLookahead === 900,
  );
  const result = await page.evaluate(() => {
    const s = (window as any).lab.editor.simulation,
      before = (window as any).laneHorizonBefore;
    return {
      same: s.sourceEngine === before.source,
      running: s.running,
      elapsed: s.elapsed - before.elapsed,
      retained: before.ids.every((id: number) =>
        s.vehicles.some((c: any) => c.id === id),
      ),
      meshes: (window as any).laneHorizonMeshes,
    };
  });
  expect(result.same).toBe(true);
  expect(result.running).toBe(true);
  expect(result.elapsed).toBeGreaterThanOrEqual(0);
  expect(result.retained).toBe(true);
  expect(result.meshes).toBe(0);
});
test("compact settings keep the distance control visible and keyboard accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await openSettings(page);
  const input = page.locator("#lane-lookahead");
  await input.focus();
  await expect(input).toBeFocused();
  const box = await input.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(() => {
      const label = document.querySelector(".traffic-ai-settings label")!;
      const r = label.getBoundingClientRect();
      return (
        document
          .elementFromPoint(r.x + 5, r.y + r.height / 2)
          ?.closest("label") === label
      );
    }),
  ).toBe(true);
  await input.fill("1000");
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => (window as any).lab.editor.project.laneLookahead),
  ).toBe(1000);
});
