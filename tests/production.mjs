import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { browserLaunchOptions } from "./support/browser.ts";

const basePath = process.env.SMOKE_BASE_PATH || "/";
const url = process.env.SMOKE_URL || `http://127.0.0.1:4173${basePath}`;
const server = process.env.SMOKE_URL
  ? undefined
  : spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        "4173",
        "--strictPort",
        "--base",
        basePath,
      ],
      { stdio: "ignore" },
    );
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server && server.exitCode !== null)
      throw new Error(`Production preview exited with code ${server.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for the server to accept connections. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Production server did not become ready: ${url}`);
  browser = await chromium.launch({
    headless: true,
    ...browserLaunchOptions(),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (
      !response.ok() &&
      response.url().startsWith(new URL(url).origin) &&
      !new URL(response.url()).pathname.endsWith("/favicon.ico")
    )
      errors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  await page.goto(url);
  await page.waitForFunction(() => !!window.lab);
  const result = await page.evaluate(() => ({
    roads: window.lab.getState().project.roads.length,
    routes: window.lab.getState().routes,
    canvas: !!document.querySelector("canvas"),
  }));
  if (result.roads !== 5 || result.routes !== 2 || errors.length)
    throw new Error(JSON.stringify({ result, errors }));
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({
    path: "artifacts/production-desktop.png",
    fullPage: true,
  });
  await writeFile(
    "artifacts/production-smoke.json",
    JSON.stringify({ url, ...result, errors, passed: true }, null, 2),
  );
  console.log("Production smoke passed:", { url, ...result });
} finally {
  await browser?.close();
  server?.kill();
}
