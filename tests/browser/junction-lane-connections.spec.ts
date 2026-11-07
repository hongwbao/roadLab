import { expect, test, type Page } from "@playwright/test";

async function junction(page: Page, twoLanes = false) {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-action="example-junction"]').click();
  await page.locator("#confirm-yes").click();
  if (twoLanes)
    await page.evaluate(() => {
      const editor = (window as any).lab.editor;
      // Explicit multi-lane test fixture; subsequent connections use real pointer input.
      editor.edit(() => {
        for (const road of editor.project.roads) {
          road.lanesStart = road.lanesEnd = 2;
          delete road.profile;
          delete road.widthOrigin;
          delete road.autoTaper;
        }
      });
    });
  await page.locator('[data-action="top"]').click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.locator('[data-tool="turn"]').click();
  const p = await page.evaluate(() =>
    (window as any).lab.worldToScreen({ x: 0, y: 0, z: 0 }),
  );
  await page.mouse.click(p.x, p.y);
  await expect(page.locator("#turn-panel h2")).toHaveText("路口车道连线");
}
const project = (page: Page) =>
  page.evaluate(() => (window as any).lab.getState().project);
const point = (page: Page, p: { x: number; y: number; z: number }) =>
  page.evaluate((p) => (window as any).lab.worldToScreen(p), p);

test("junction dots add a previously unavailable destination, remove it, save a closed lane and restore auto", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await junction(page, true);
  const link = await page.evaluate(() => {
    const tool = (window as any).lab.editor.junctionLaneTool,
      existing = new Set(tool.layout.links.map((link: any) => link.id));
    return tool.layout.candidates.find((link: any) => !existing.has(link.id));
  });
  expect(link).toBeTruthy();
  const source = await point(page, link.from.position),
    target = await point(page, link.to.position);
  await page.mouse.click(source.x, source.y);
  await page.mouse.move(target.x, target.y);
  await page.mouse.click(target.x, target.y);
  const rule = () =>
    project(page).then((p) =>
      p.junctionLaneConnections?.find(
        (rule: any) =>
          rule.from.road === link.from.road &&
          rule.from.lane === link.from.lane,
      ),
    );
  expect((await rule()).to).toContainEqual({
    road: link.to.road,
    lane: link.to.lane,
    end: link.to.end,
  });
  expect(
    await page.evaluate(
      (id) =>
        (window as any).lab.editor.simulation.network.connectionLaneIds.has(id),
      link.id,
    ),
  ).toBe(true);
  await page.mouse.click(target.x, target.y);
  expect((await rule()).to).not.toContainEqual({
    road: link.to.road,
    lane: link.to.lane,
    end: link.to.end,
  });
  await page.locator('[data-junction-lane-action="ban-lane"]').click();
  expect((await rule()).to).toEqual([]);
  const prefix = `${link.from.road}:${link.from.lane}>`;
  expect(
    await page.evaluate(
      (prefix) =>
        [
          ...(
            window as any
          ).lab.editor.simulation.network.connectionLaneIds.keys(),
        ].some((id: any) => id.startsWith(prefix)),
      prefix,
    ),
  ).toBe(false);
  await page.locator('[data-action="undo"]').click();
  expect((await rule()).to.length).toBeGreaterThan(0);
  await page.locator('[data-action="redo"]').click();
  expect((await rule()).to).toEqual([]);
  await page.locator("#viewport").focus();
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  expect((await rule()).to).toEqual([]);
  await page.locator('[data-tool="turn"]').click();
  const centre = await point(page, { x: 0, y: 0, z: 0 });
  await page.mouse.click(centre.x, centre.y);
  const sourcePoint = await page.evaluate(
      (key) =>
        (window as any).lab.editor.junctionLaneTool.ports.find(
          (port: any) => port.key === key,
        ).position,
      link.from.key,
    ),
    screen = await point(page, sourcePoint);
  await page.mouse.click(screen.x, screen.y);
  await expect(page.locator(".junction-lane-closed")).toBeVisible();
  await page.locator('[data-junction-lane-action="restore-lane"]').click();
  expect(await rule()).toBeUndefined();
  expect(
    await page.evaluate(
      (prefix) =>
        [
          ...(
            window as any
          ).lab.editor.simulation.network.connectionLaneIds.keys(),
        ].some((id: any) => id.startsWith(prefix)),
      prefix,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("keyboard lane names preserve focus and the open helper across graph edits on a compact viewport", async ({
  page,
}) => {
  await junction(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".junction-lane-keyboard summary").click();
  const source = page
      .locator('[data-junction-lane-action="choose-source"]')
      .first(),
    sourceId = await source.getAttribute("id");
  await source.click();
  await expect(page.locator(`[id="${sourceId}"]`)).toBeFocused();
  await expect(page.locator(".junction-lane-keyboard")).toHaveAttribute(
    "open",
    "",
  );
  const target = page
      .locator('[data-junction-lane-action="toggle-target"]')
      .first(),
    targetId = await target.getAttribute("id"),
    pressed = await target.getAttribute("aria-pressed");
  await target.click();
  await expect(page.locator(`[id="${targetId}"]`)).toBeFocused();
  await expect(page.locator(`[id="${targetId}"]`)).toHaveAttribute(
    "aria-pressed",
    pressed === "true" ? "false" : "true",
  );
  await expect(page.locator(".junction-lane-keyboard")).toHaveAttribute(
    "open",
    "",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator('[data-junction-lane-action="leave"]').click();
  await expect(page.locator("#turn-panel")).toBeHidden();
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.junctionLaneTool.overlay.group.visible,
    ),
  ).toBe(false);
});
