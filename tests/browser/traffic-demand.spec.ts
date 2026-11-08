import { expect, test, type Page } from "@playwright/test";
import type { Port, Road } from "../../src/core/types";
async function setup(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).lab);
  await page.evaluate(() => {
    const e = (window as any).lab.editor,
      base = structuredClone(e.project.roads[0]);
    const road = (
      id: string,
      a: { x: number; y: number; z: number },
      b: { x: number; y: number; z: number },
    ) => {
      const mix = (t: number) => ({
        x: a.x + (b.x - a.x) * t,
        y: 0,
        z: a.z + (b.z - a.z) * t,
      });
      return {
        ...structuredClone(base),
        id,
        name: id.startsWith("in")
          ? `入口道路${Number(id.at(-1)) + 1}`
          : `出口道路${Number(id.at(-1)) + 1}`,
        twoWay: false,
        lanesStart: 2,
        lanesEnd: 2,
        width: 4,
        speed: 60,
        sectionOffset: 0,
        median: undefined,
        profile: undefined,
        autoTaper: undefined,
        attachments: undefined,
        knots: [
          { p: a, incoming: a, outgoing: mix(1 / 3), at: 0 },
          { p: b, incoming: mix(2 / 3), outgoing: b, at: 1 },
        ],
      };
    };
    const center = { x: 0, y: 0, z: 0 },
      roads: Road[] = [],
      ports: Port[] = [];
    for (let i = 0; i < 4; i++) {
      const t = (i * Math.PI) / 2,
        p = { x: Math.cos(t) * 400, y: 0, z: Math.sin(t) * 400 };
      roads.push(road(`in${i}`, p, center));
      ports.push({ road: `in${i}`, end: "start", type: "source", rate: 50 });
    }
    for (let i = 0; i < 4; i++) {
      const t = ((i + 0.5) * Math.PI) / 2,
        p = { x: Math.cos(t) * 400, y: 0, z: Math.sin(t) * 400 };
      roads.push(road(`out${i}`, center, p));
      ports.push({ road: `out${i}`, end: "end", type: "sink", rate: 1 });
    }
    e.edit(() => {
      e.project = {
        version: 1,
        name: "四进四出车流测试",
        roads,
        ports,
        connections: [],
        templates: [],
        trafficMultiplier: 1,
        trafficBaseRate: 50,
      };
      e.selected.clear();
    });
    e.scene.fit(e.project.roads);
  });
  await page.locator('[data-tool="boundary"]').first().click();
}
test("four100% entries total200/min, destination percentages rebalance, and pointer/focus show the matching dashed OD", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await setup(page);
  await expect(page.locator("#traffic-total")).toContainText("200");
  await expect(page.locator("#demand-entry-percent")).toHaveValue("100");
  await expect(page.locator("#demand-flow-total")).toContainText("50 辆/分");
  expect(await page.locator("[data-demand-share]").first().inputValue()).toBe(
    "25",
  );
  const first = page.locator('[data-demand-share="4"]');
  const guideGeometry = await page.evaluate(
    () =>
      (window as any).lab.editor.trafficDemandTool.overlay.group.children.find(
        (o: any) => o.userData.trafficOD,
      ).geometry.uuid,
  );
  await first.fill("70");
  await first.dispatchEvent("change");
  await expect(first).toHaveValue("70");
  await expect(page.locator('[data-demand-share="5"]')).toHaveValue("10");
  expect(
    await page.evaluate(
      () =>
        (
          window as any
        ).lab.editor.trafficDemandTool.overlay.group.children.find(
          (o: any) => o.userData.trafficOD,
        ).geometry.uuid,
    ),
  ).toBe(guideGeometry);
  const before = await page.evaluate(() =>
    JSON.stringify((window as any).lab.editor.project),
  );
  await page.locator('[data-demand-target="6"]').hover();
  await expect(page.locator(".demand-target-hint")).toContainText(
    "入口1 → 出口3",
  );
  expect(
    await page.evaluate(() => {
      const t = (window as any).lab.editor.trafficDemandTool;
      const line = t.overlay.group.children.find(
        (o: any) => o.userData.trafficOD,
      );
      return {
        road: t.target.road,
        visible: t.overlay.group.visible,
        dashed: line.material.dashed,
      };
    }),
  ).toEqual({ road: "out2", visible: true, dashed: true });
  await page.locator('[data-demand-share="7"]').focus();
  await expect(page.locator(".demand-target-hint")).toContainText("出口4");
  expect(
    await page.evaluate(() =>
      JSON.stringify((window as any).lab.editor.project),
    ),
  ).toBe(before);
  await page.locator('[data-tool="select"]').click();
  expect(
    await page.evaluate(
      () => (window as any).lab.editor.trafficDemandTool.overlay.group.visible,
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});
test("entry and base ratios update live while retaining cars, runtime and fixed routes", async ({
  page,
}) => {
  await setup(page);
  await page.locator('[data-action="play"]').click();
  await page.waitForFunction(
    () => (window as any).lab.editor.simulation.vehicles.length > 0,
  );
  await page.evaluate(() => {
    const s = (window as any).lab.editor.simulation;
    (window as any).demandBefore = {
      runtime: s.sourceEngine,
      elapsed: s.elapsed,
      ids: s.vehicles.map((c: any) => c.id),
      roads: JSON.stringify((window as any).lab.editor.project.roads),
    };
  });
  await page.locator("#demand-entry-percent").fill("50");
  await page.locator("#demand-entry-percent").dispatchEvent("change");
  await expect(page.locator("#demand-flow-total")).toContainText("25 辆/分");
  await page.locator('[data-demand-share="4"]').fill("100");
  await page.locator('[data-demand-share="4"]').dispatchEvent("change");
  await page.locator(".demand-base summary").click();
  await page.locator("#demand-base-rate").fill("80");
  await page.locator("#demand-base-rate").dispatchEvent("change");
  await expect(page.locator("#demand-entry-percent")).toHaveValue("50");
  await expect(page.locator("#traffic-total")).toContainText("280");
  const result = await page.evaluate(() => {
    const e = (window as any).lab.editor,
      s = e.simulation,
      b = (window as any).demandBefore;
    return {
      same: s.sourceEngine === b.runtime,
      running: s.running,
      elapsed: s.elapsed >= b.elapsed,
      retained: b.ids.every((id: number) =>
        s.vehicles.some((c: any) => c.id === id),
      ),
      roads: JSON.stringify(e.project.roads) === b.roads,
    };
  });
  expect(result).toEqual({
    same: true,
    running: true,
    elapsed: true,
    retained: true,
    roads: true,
  });
});
test("OD profiles save and restore, reject invalid values, and support equal shares plus undo", async ({
  page,
}) => {
  await setup(page);
  const input = page.locator('[data-demand-share="4"]');
  await input.fill("-1");
  await input.dispatchEvent("change");
  await expect(input).toHaveValue("25");
  await expect(page.locator("#toast")).toContainText("0–100");
  await input.fill("60");
  await input.dispatchEvent("change");
  await page.locator("#demand-entry-percent").fill("80");
  await page.locator("#demand-entry-percent").dispatchEvent("change");
  await page.locator("#viewport").focus();
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).lab);
  await page.locator('[data-tool="boundary"]').first().click();
  await expect(input).toHaveValue("60");
  await expect(page.locator("#demand-entry-percent")).toHaveValue("80");
  await page.locator('[data-demand-action="equal"]').click();
  await expect(input).toHaveValue("25");
  await page.locator('[data-action="undo"]').click();
  await expect(input).toHaveValue("60");
});
test("compact demand settings scroll internally and retain keyboard focus and map indication", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const input = page.locator('[data-demand-share="7"]');
  await input.scrollIntoViewIfNeeded();
  await input.focus();
  await expect(input).toBeFocused();
  await expect(page.locator(".demand-target-hint")).toContainText("出口4");
  const box = await input.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await input.fill("40");
  await page.keyboard.press("Tab");
  await expect(input).toHaveValue("40");
});

test("reversing a two-way road retains OD shares on its original physical outlet", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const e = (window as any).lab.editor;
    e.edit(() => {
      e.project.roads.find((r: any) => r.id === "out0").twoWay = true;
    });
  });
  const first = page.locator('[data-demand-share="4"]');
  await first.fill("70");
  await first.dispatchEvent("change");
  const before = await page.evaluate(() => {
    const e = (window as any).lab.editor,
      r = e.project.roads.find((r: any) => r.id === "out0");
    return structuredClone(r.knots.at(-1).p);
  });
  await page.evaluate(() => {
    const e = (window as any).lab.editor;
    e.select("out0");
    e.action("reverse");
  });
  const after = await page.evaluate(() => {
    const e = (window as any).lab.editor,
      p = e.project.ports.find((p: any) => p.road === "out0"),
      d = e.project.ports[0].destinations.find((d: any) => d.road === "out0"),
      r = e.project.roads.find((r: any) => r.id === "out0");
    return {
      end: p.end,
      targetEnd: d.end,
      weight: d.weight,
      position: r.knots[0].p,
    };
  });
  expect(after).toEqual({
    end: "start",
    targetEnd: "start",
    weight: 70,
    position: before,
  });
  await expect(first).toHaveValue("70");
});
