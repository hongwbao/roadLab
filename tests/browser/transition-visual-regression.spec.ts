import { expect, test } from "@playwright/test";

for (const median of [false, true])
  test(`smooth display restores the actual ${median ? "median-offset" : "2-to-3"} gap and cancel removes it without changing traffic geometry`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.waitForFunction(() => !!(window as any).lab);
    await page.evaluate(async (median) => {
      const modelPath = "/src/core/model.ts",
        mathPath = "/src/core/math.ts",
        { emptyProject, makeRoad } = await import(modelPath),
        { v } = await import(mathPath),
        e = (window as any).lab.editor,
        p = emptyProject();
      p.ports = [];
      p.roads = [
        makeRoad(v(-100, 0), v(), {
          id: "a",
          twoWay: median,
          lanesStart: median ? 3 : 2,
          lanesEnd: median ? 3 : 2,
          speed: 60,
          ...(median ? { median: { kind: "concrete", width: 4 } } : {}),
        }),
        makeRoad(v(), v(100, 0), {
          id: "b",
          twoWay: median,
          lanesStart: 3,
          lanesEnd: 3,
          speed: 60,
          ...(median
            ? { backwardLanesStart: 5, backwardLanesEnd: 5, sectionOffset: 2 }
            : {}),
        }),
      ];
      e.edit(() => Object.assign(e.project, p));
      e.setTool("select");
      e.scene.fit(e.project.roads);
      e.scene.top();
      e.simulation.prepareForRun();
      const engine = e.simulation.sourceEngine;
      (window as any).visualInvariant = {
        engine,
        network: engine.network,
        geometry: JSON.stringify(
          [...engine.network.lanes].map(([id, lane]: any) => [
            id,
            lane.curve.points,
            lane.curve.length,
          ]),
        ),
      };
    }, median);
    await page.waitForTimeout(350);
    const center = await page.evaluate(() =>
      (window as any).lab.worldToScreen({ x: 0, y: 0, z: 0 }),
    );
    const crop = await page.evaluate(() => {
      const s = (window as any).lab.editor.scene,
        a = s.project({ x: -15, y: 0, z: -9 }),
        b = s.project({ x: 15, y: 0, z: 9 });
      return {
        x: Math.floor(Math.min(a.x, b.x)),
        y: Math.floor(Math.min(a.y, b.y)),
        width: Math.ceil(Math.abs(a.x - b.x)),
        height: Math.ceil(Math.abs(a.y - b.y)),
      };
    });
    await page.locator('[data-tool="upgrade"]').click();
    await page.locator('[data-upgrade-mode="smooth"]').click();
    await page.mouse.move(1280, 90);
    const direct = info.outputPath("direct.png");
    await page.screenshot({ path: direct });
    await page.mouse.click(center.x, center.y);
    await page.mouse.move(1280, 90);
    const after = await page.evaluate(() => {
      const e = (window as any).lab.editor,
        lines: any[] = [],
        medians: any[] = [];
      e.scene.connectionDecorations.traverse((o: any) => {
        if (o.isLine)
          lines.push({
            kind: o.userData.connectionMarking,
            count: o.geometry.attributes.position.count,
          });
        if (o.isMesh && o.userData.connectionMedian)
          medians.push(o.geometry.attributes.position.count);
      });
      return {
        lines,
        medians,
        sameEngine:
          e.simulation.sourceEngine === (window as any).visualInvariant.engine,
        sameNetwork:
          e.simulation.sourceEngine.network ===
          (window as any).visualInvariant.network,
        sameGeometry:
          JSON.stringify(
            [...e.simulation.sourceEngine.network.lanes].map(
              ([id, lane]: any) => [id, lane.curve.points, lane.curve.length],
            ),
          ) === (window as any).visualInvariant.geometry,
      };
    });
    expect(after.lines.filter((l) => l.kind === "edge")).toHaveLength(2);
    expect(after.lines.some((l) => l.kind === "lane")).toBe(true);
    expect(after.lines.every((l) => l.count === 65)).toBe(true);
    if (median) {
      expect(after.medians[0]).toBeGreaterThan(384);
      expect(after.lines.filter((l) => l.kind === "median")).toHaveLength(2);
    }
    expect(after.sameEngine && after.sameNetwork && after.sameGeometry).toBe(
      true,
    );
    const smooth = info.outputPath("smooth.png");
    await page.screenshot({ path: smooth });
    await page.mouse.click(center.x, center.y, { button: "right" });
    await page.mouse.move(1280, 90);
    expect(
      await page.evaluate(
        () =>
          (window as any).lab.editor.scene.connectionDecorations.children
            .length,
      ),
    ).toBe(0);
    const cancelled = info.outputPath("cancelled.png");
    await page.screenshot({ path: cancelled });
    expect(errors).toEqual([]);
    await info.attach("visible-transition-evidence", {
      body: JSON.stringify({
        median,
        crop,
        direct,
        smooth,
        cancelled,
        ...after,
      }),
      contentType: "application/json",
    });
  });
