import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const root = resolve(
  process.env.ROADLAB_DIST_DIR || resolve(import.meta.dirname, "../dist"),
);
const port = Number(process.env.ROADLAB_PORT || 8080);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
};

createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
  } catch {
    response.writeHead(400).end();
    return;
  }

  if (pathname === "/healthz") {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(request.method === "HEAD" ? undefined : "ok\n");
    return;
  }

  let file = resolve(root, `.${pathname}`);
  if (file !== root && !file.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }

  try {
    const info = await stat(file);
    if (info.isDirectory()) file = resolve(file, "index.html");
    else if (!info.isFile()) throw new Error("Not a file");
    await stat(file);
  } catch {
    if (pathname.startsWith("/assets/")) {
      response.writeHead(404).end();
      return;
    }
    file = resolve(root, "index.html");
  }

  response.writeHead(200, {
    "Content-Type": contentTypes[extname(file)] || "application/octet-stream",
    "Cache-Control": pathname.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") response.end();
  else createReadStream(file).pipe(response);
}).listen(port, "0.0.0.0", () => {
  console.log(`RoadLab listening on 0.0.0.0:${port}`);
});
