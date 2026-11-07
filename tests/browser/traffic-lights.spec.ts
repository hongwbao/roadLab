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
  await page.locator('[data-signal-mode="protected"]').click();
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
  await page.locator('[data-signal-mode="protected"]').click();
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
  await page.locator('[data-signal-mode="protected"]').click();
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

test("new cross-junction signals use the requested editable four-phase default", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await junction(page);
  const signal = (await state(page)).project.signals[0];
  expect(signal.mode).toBe("custom");
  expect(signal.program.phases.map((phase: any) => phase.duration)).toEqual([
    20, 8, 20, 8,
  ]);
  await expect(page.locator('[data-signal-mode="custom"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".signal-phase-tab")).toHaveCount(4);
  await expect(
    page.locator('[data-signal-movement][data-turn="right"]:checked'),
  ).toHaveCount(4);
  await expect(
    page.getByRole("checkbox", { name: "北侧左转", exact: true }),
  ).not.toBeChecked();
  await page.locator('.signal-phase-tab[data-phase-id="phase-2"]').click();
  await expect(
    page.getByRole("checkbox", { name: "北侧左转", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "东侧左转", exact: true }),
  ).toBeChecked();
  await expect(
    page.locator('[data-signal-movement][data-turn="right"]:checked'),
  ).toHaveCount(4);
  await page.evaluate(() => {
    (window as any).lab.editor.simulation.trafficLights.update(25);
  });
  await expect(page.locator("[data-signal-live]")).toContainText("东西左转");
  const heads = await page.evaluate(() => {
    const editor = (window as any).lab.editor,
      j = editor.signalTool.junction;
    const north = j.arms.find((arm: any) => arm.direction.z < -0.9);
    return editor.scene.trafficLights.heads
      .filter((head: any) => head.arm === `${north.road}:${north.end}`)
      .map((head: any) => ({ turn: head.turn, color: head.color }));
  });
  expect(heads).toHaveLength(3);
  expect(heads).toContainEqual({ turn: "left", color: "red" });
  expect(heads).toContainEqual({ turn: "right", color: "green" });
  await page.locator("#viewport").focus();
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  expect((await state(page)).project.signals[0].mode).toBe("custom");
  expect((await state(page)).project.signals[0].program.phases).toHaveLength(4);
  expect(errors).toEqual([]);
});

test("custom phase editing supports timing, movement, insertion, ordering, deletion and undo", async ({
  page,
}) => {
  await junction(page);
  const name = page.locator("[data-signal-phase-name]"),
    duration = page.locator("[data-signal-phase-duration]");
  await name.fill("试验通行");
  await name.dispatchEvent("change");
  await duration.fill("14");
  await duration.dispatchEvent("change");
  await page.getByRole("checkbox", { name: "北侧左转", exact: true }).check();
  let config = (await state(page)).project.signals[0];
  expect(config.program.phases[0]).toMatchObject({
    name: "试验通行",
    duration: 14,
  });
  expect(config.program.phases[0].movements).toContainEqual({
    approach: "north",
    turn: "left",
  });
  await page.locator('[data-signal-action="add-phase"]').click();
  await expect(page.locator(".signal-phase-tab")).toHaveCount(5);
  await expect(page.locator(".signal-empty-phase")).toBeVisible();
  const created = (await state(page)).project.signals[0].program.phases[4].id;
  await page.locator("[data-signal-phase-name]").fill("追加相位");
  await page.locator("[data-signal-phase-name]").dispatchEvent("change");
  await page.locator('[data-signal-action="phase-up"]').click();
  config = (await state(page)).project.signals[0];
  expect(config.program.phases[3].id).toBe(created);
  await page.locator('[data-signal-action="remove-phase"]').click();
  await expect(page.locator(".signal-phase-tab")).toHaveCount(4);
  await page.locator('[data-action="undo"]').click();
  expect((await state(page)).project.signals[0].program.phases[3].id).toBe(
    created,
  );
  await page.locator('[data-signal-action="reset-default"]').click();
  expect(
    (await state(page)).project.signals[0].program.phases.map(
      (phase: any) => phase.duration,
    ),
  ).toEqual([20, 8, 20, 8]);
});

test("saved programs import onto another junction and JSON files round-trip with invalid-input recovery", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await junction(page);
  await page.locator("[data-signal-phase-name]").fill("可移植试验");
  await page.locator("[data-signal-phase-name]").dispatchEvent("change");
  await page.locator("[data-signal-phase-duration]").fill("17");
  await page.locator("[data-signal-phase-duration]").dispatchEvent("change");
  await page.getByRole("checkbox", { name: "北侧左转", exact: true }).check();
  const source = (await state(page)).project.signals[0];
  await page.locator('[data-signal-detail="presets"] summary').click();
  await page.locator("[data-signal-preset-name]").fill("四相位复用");
  await page.locator('[data-signal-action="save-preset"]').click();
  await expect(page.locator("[data-signal-preset-select] option")).toHaveCount(
    1,
  );
  const pendingDownload = page.waitForEvent("download");
  await page.locator('[data-signal-action="export-preset"]').click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe("四相位复用.signal.json");
  const library = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("roadlab.signal-presets.v1")!),
  );
  expect(library).toHaveLength(1);
  expect(library[0].program).toEqual(source.program);
  for (const arm of source.arms)
    expect(JSON.stringify(library[0])).not.toContain(arm.road);
  await page.evaluate(() => {
    const editor = (window as any).lab.editor,
      copy = structuredClone(editor.project.roads);
    copy.forEach((road: any, index: number) => {
      road.id = `signal-copy-${index}`;
      for (const knot of road.knots)
        for (const key of ["p", "incoming", "outgoing"]) knot[key].x += 500;
    });
    editor.edit(() => editor.project.roads.push(...copy));
    editor.signalTool.selected = editor.simulation.junctions.find(
      (j: any) => j.position.x > 400,
    ).id;
    editor.signalTool.enable();
    editor.onChange();
  });
  await page.locator('[data-signal-action="apply-preset"]').click();
  const signals = (await state(page)).project.signals,
    target = signals.find((signal: any) => signal.id !== source.id);
  expect(target.program).toEqual(source.program);
  expect(
    target.arms.every((arm: any) => arm.road.startsWith("signal-copy-")),
  ).toBe(true);
  const before = JSON.stringify((await state(page)).project.signals);
  await page.locator("[data-signal-preset-file]").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{not-json"),
  });
  await expect(page.locator("[data-signal-error]")).toContainText("JSON");
  expect(JSON.stringify((await state(page)).project.signals)).toBe(before);
  const imported = structuredClone(library[0]);
  imported.name = "文件方案";
  imported.program.phases[0].duration = 23;
  await page.locator("[data-signal-preset-file]").setInputFiles({
    name: "good.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  expect(
    (await state(page)).project.signals.find(
      (signal: any) => signal.id === target.id,
    ).program.phases[0].duration,
  ).toBe(23);
  await expect(page.locator("[data-signal-error]")).toBeHidden();
  await page.locator("#viewport").focus();
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  expect(
    (await state(page)).project.signals.find(
      (signal: any) => signal.id === target.id,
    ).program.phases[0].duration,
  ).toBe(23);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("roadlab.signal-presets.v1")!).length,
    ),
  ).toBe(1);
  expect(errors).toEqual([]);
});
