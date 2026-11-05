import type { LaunchOptions } from "@playwright/test";
import { existsSync } from "node:fs";

export function browserLaunchOptions(): LaunchOptions {
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    (!process.env.CI && existsSync("/usr/bin/google-chrome")
      ? "/usr/bin/google-chrome"
      : undefined);
  return {
    ...(executablePath ? { executablePath } : {}),
    args: [
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  };
}
