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
test("switching tools and opening UI reuses every road mesh and avoids long synchronous handlers", async ({
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
  const unaffected = "cloverleaf-west-in";
  expect(before[unaffected]).toBeTruthy();
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
  expect(after[unaffected]).toBeTruthy();
  expect(after[unaffected]).toBe(before[unaffected]);
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

test("a node visual edit on 120 roads reuses the logical network and all base meshes", async ({
  page,
}, testInfo) => {
  await cloverleaf(page);
  const fixture = await page.evaluate(() => {
    const e = (window as any).lab.editor;
    e.scene.top();
    const byId = new Map(e.project.roads.map((r: any) => [r.id, r]));
    const node = e.junctionLaneTool.nodes.find(
      (n: any) =>
        n.kind === "continuation" &&
        n.arms.length === 2 &&
        n.position.x < -100 &&
        n.arms.every((a: any) => {
          const r = byId.get(a.road) as any;
          return (
            !r.twoWay && !r.profile && r.lanesStart === 2 && r.lanesEnd === 2
          );
        }),
    );
    if (!node)
      throw new Error("No real two-road continuation in the 120-road fixture");
    e.edit(() => {
      const r = byId.get(node.arms[0].road) as any;
      r.lanesStart = r.lanesEnd = 5;
    });
    e.simulation.prepareForRun();
    const state = {
      engine: e.simulation.sourceEngine,
      network: e.simulation.sourceEngine.network,
      rebuilds: 0,
      configures: 0,
      previews: [] as number[],
      edits: [] as number[],
    };
    e.scene.roadMesh = (
      (original: (...args: any[]) => any) =>
      (...args: any[]) => {
        if (args[1] !== e.scene.preview) state.rebuilds++;
        return original(...args);
      }
    )(e.scene.roadMesh.bind(e.scene));
    e.scene.showNodeVisualPreview = (
      (original: (...args: any[]) => any) =>
      (...args: any[]) => {
        const start = performance.now();
        try {
          return original(...args);
        } finally {
          if (args[1]) state.previews.push(performance.now() - start);
        }
      }
    )(e.scene.showNodeVisualPreview.bind(e.scene));
    e.editVisual = (
      (original: (...args: any[]) => any) =>
      (...args: any[]) => {
        const start = performance.now();
        try {
          return original(...args);
        } finally {
          state.edits.push(performance.now() - start);
        }
      }
    )(e.editVisual.bind(e));
    for (const name of ["configure", "prepareForRun", "prepareForEditing"])
      e.simulation[name] = (
        (original: (...args: any[]) => any) =>
        (...args: any[]) => {
          state.configures++;
          return original(...args);
        }
      )(e.simulation[name].bind(e.simulation));
    (window as any).nodeVisualTiming = state;
    return { count: e.project.roads.length, position: node.position };
  });
  expect(fixture.count).toBe(120);
  const before = await page.evaluate(pavement);
  await page.locator('[data-tool="upgrade"]').click();
  await page.locator('[data-upgrade-mode="smooth"]').click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const p = await page.evaluate(
    (point) => (window as any).lab.worldToScreen(point),
    fixture.position,
  );
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.project.roadVisuals?.nodes.length ?? 0,
    ),
  ).toBe(1);
  await page.locator('[data-action="undo"]').click();
  await page.locator('[data-action="redo"]').click();
  await page.mouse.click(p.x, p.y, { button: "right" });
  expect(await page.evaluate(pavement)).toEqual(before);
  const timing = await page.evaluate(() => {
    const e = (window as any).lab.editor,
      t = (window as any).nodeVisualTiming;
    return {
      rebuilds: t.rebuilds,
      configures: t.configures,
      previews: t.previews,
      edits: t.edits,
      sameEngine: t.engine === e.simulation.sourceEngine,
      sameNetwork: t.network === e.simulation.sourceEngine.network,
    };
  });
  await testInfo.attach("node-visual-120-road-timing", {
    body: JSON.stringify(timing),
    contentType: "application/json",
  });
  expect(timing.rebuilds).toBe(0);
  expect(timing.configures).toBe(0);
  expect(timing.sameEngine && timing.sameNetwork).toBe(true);
  expect(timing.previews.length).toBeGreaterThan(0);
  expect(timing.edits).toHaveLength(2);
  expect(Math.max(...timing.previews)).toBeLessThan(200);
  expect(Math.max(...timing.edits)).toBeLessThan(200);
});
