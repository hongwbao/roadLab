import { expect, test, type Page } from "@playwright/test";
async function cloverleaf(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-action="example-elevated"]').click();
  await page.locator("#confirm-yes").click();
}
const pavement = () => {
  const out: Record<string, string> = {};
  (window as any).lab.editor.scene.roads.traverse((o: any) => {
    if (o.isMesh && o.userData.road) out[o.userData.road] = o.geometry.uuid;
  });
  return out;
};
test("switching tools and opening UI reuses all forty road meshes and avoids long synchronous handlers", async ({
  page,
}) => {
  await cloverleaf(page);
  const before = await page.evaluate(pavement);
  await page.evaluate(() => {
    const e = (window as any).lab.editor;
    const mesh = e.scene.roadMesh.bind(e.scene),
      tool = e.setTool.bind(e);
    (window as any).uiTiming = { rebuilt: 0, tools: [] };
    e.scene.roadMesh = (...args: any[]) => {
      if (args[1] !== e.scene.preview) (window as any).uiTiming.rebuilt++;
      return mesh(...args);
    };
    e.setTool = (...args: any[]) => {
      const start = performance.now();
      try {
        return tool(...args);
      } finally {
        (window as any).uiTiming.tools.push(performance.now() - start);
      }
    };
  });
  for (const selector of [
    '[data-action="menu"]',
    '[data-action="menu"]',
    '[data-tool="turn"]',
    '[data-tool="signal"]',
    '[data-tool="select"]',
    '[data-tool="upgrade"]',
    '[data-upgrade-mode="median"]',
    '[data-upgrade-mode="replace"]',
    '[data-tool="select"]',
    '[data-tool="turn"]',
    '[data-tool="select"]',
    '[data-action="grid"]',
    '[data-action="grid"]',
  ])
    await page.locator(selector).click();
  expect(await page.evaluate(pavement)).toEqual(before);
  const timing = await page.evaluate(() => (window as any).uiTiming);
  expect(timing.rebuilt).toBe(0);
  expect(timing.tools.length).toBeGreaterThan(5);
  expect(Math.max(...timing.tools)).toBeLessThan(200);
});
test("selection colour and handles change without replacing pavement, and hidden handles cannot be picked", async ({
  page,
}) => {
  await cloverleaf(page);
  const before = await page.evaluate(pavement);
  await page.evaluate(() => {
    const e = (window as any).lab.editor;
    e.select("cloverleaf-east-collector-0");
  });
  const selected = await page.evaluate(() => {
    const s = (window as any).lab.editor.scene;
    let sphere: any;
    let orange = 0;
    s.handles.traverse((o: any) => {
      if (o.userData.handle && !sphere) sphere = o;
    });
    s.overlays.traverse((o: any) => {
      if (o.material?.color?.getHex() === 0xea7b35) orange++;
    });
    return { sphere: { ...sphere.position }, orange };
  });
  expect(selected.orange).toBeGreaterThan(0);
  expect(await page.evaluate(pavement)).toEqual(before);
  await page.locator('[data-tool="turn"]').click();
  expect(
    await page.evaluate((p) => {
      const s = (window as any).lab.editor.scene,
        q = s.project(p);
      return { visible: s.handles.visible, hit: !!s.hit(q.x, q.y)?.handle };
    }, selected.sphere),
  ).toEqual({ visible: false, hit: false });
  await page.locator('[data-tool="select"]').click();
  expect(
    await page.evaluate(() => (window as any).lab.editor.scene.handles.visible),
  ).toBe(true);
  await page.evaluate(() => {
    const e = (window as any).lab.editor;
    e.selected.clear();
    e.refresh();
  });
  expect(await page.evaluate(pavement)).toEqual(before);
});
test("a real lane edit still invalidates its pavement and fork neighbours after the UI cache optimization", async ({
  page,
}) => {
  await cloverleaf(page);
  const before = await page.evaluate(pavement);
  await page.evaluate(() => {
    const e = (window as any).lab.editor;
    e.edit(() => {
      const r = e.project.roads.find(
        (r: any) => r.id === "cloverleaf-east-collector-0",
      );
      r.lanesStart = r.lanesEnd = 3;
    });
  });
  const after = await page.evaluate(pavement);
  expect(after["cloverleaf-east-collector-0"]).not.toBe(
    before["cloverleaf-east-collector-0"],
  );
  expect(after["cloverleaf-east-right"]).not.toBe(
    before["cloverleaf-east-right"],
  );
  expect(after["cloverleaf-west-main"]).toBe(before["cloverleaf-west-main"]);
});

test("immediate world picking after compact-to-desktop resize uses the current viewport", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-action="new"]').click();
  await page.locator("#confirm-yes").click();
  await page.locator('[data-action="top"]').click();
  await page.locator('[data-asset="city-5-asymmetric"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setViewportSize({ width: 1440, height: 900 });
  const a = await page.evaluate(() => {
    const s = (window as any).lab.editor.scene,
      p = (window as any).lab.worldToScreen({ x: -50, y: 0, z: 0 }),
      r = s.el.getBoundingClientRect();
    return { p, aspect: s.camera.aspect, expected: r.width / r.height };
  });
  expect(a.aspect).toBeCloseTo(a.expected, 6);
  await page.mouse.click(a.p.x, a.p.y);
  const b = await page.evaluate(() =>
    (window as any).lab.worldToScreen({ x: 50, y: 0, z: 0 }),
  );
  await page.mouse.click(b.x, b.y);
  await page.mouse.click(900, 230, { button: "right" });
  expect(
    await page.evaluate(() => (window as any).lab.editor.project.roads.length),
  ).toBe(1);
});
