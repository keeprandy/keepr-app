import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve("dist");
const port = Number(new URL(process.env.PLAYWRIGHT_BASE_URL || "http://localhost:8081").port || 8081);
const host = "127.0.0.1";

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function safePath(url) {
  const pathname = decodeURIComponent(new URL(url, `http://localhost:${port}`).pathname);
  const clean = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  const candidate = join(root, clean);
  return candidate.startsWith(`${root}${sep}`) || candidate === root ? candidate : join(root, "index.html");
}

async function resolveFile(url) {
  const candidate = safePath(url);
  try {
    const info = await stat(candidate);
    if (info.isFile()) return candidate;
  } catch {}
  return join(root, "index.html");
}

if (!existsSync(join(root, "index.html"))) {
  console.error("Missing dist/index.html. Run npm run build:web before Playwright.");
  process.exit(1);
}

createServer(async (req, res) => {
  const file = await resolveFile(req.url || "/");
  res.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
  createReadStream(file)
    .on("error", () => {
      res.statusCode = 500;
      res.end("Unable to read file.");
    })
    .pipe(res);
}).listen(port, host, () => {
  console.log(`Serving ${root} at http://${host}:${port}`);
});
