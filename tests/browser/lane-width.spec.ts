import { expect, test } from "@playwright/test";

test("legacy saved roads and templates load as four-metre lanes and remain four metres after save and reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.evaluate(() => {
    const project = structuredClone((window as any).lab.getState().project);
    for (const road of project.roads) road.width = 3.5;
    const road = structuredClone(project.roads[0]);
    road.width = 3.6;
    project.templates = [
      { id: "old-width", name: "旧宽度模板", roads: [road], connections: [] },
    ];
    (window as any).lab.editor.project = project;
    (window as any).lab.editor.save();
  });
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  const state = await page.evaluate(() => ({
    project: (window as any).lab.getState().project,
    drawWidth: (window as any).lab.editor.draw.width,
  }));
  expect(state.project.roads.every((r: any) => r.width === 4)).toBe(true);
  expect(state.project.templates[0].roads[0].width).toBe(4);
  expect(state.drawWidth).toBe(4);
  await page.locator("#viewport").focus();
  await page.keyboard.press("Control+s");
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("interchange-lab:v1")!).roads.every(
        (r: any) => r.width === 4,
      ),
    ),
  ).toBe(true);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  expect(
    await page.evaluate(() =>
      (window as any).lab
        .getState()
        .project.roads.every((r: any) => r.width === 4),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
