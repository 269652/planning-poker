// Serves the static export in ./out like GitHub Pages would (incl. NEXT_PUBLIC_BASE_PATH). No dependencies.
//   npm run build && npm run preview      → http://localhost:4173/
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("out");
const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
const port = Number(process.env.PORT ?? 4173);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain",
  ".woff2": "font/woff2",
};

createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  if (base && !p.startsWith(base)) { res.writeHead(302, { location: base + "/" }).end(); return; }
  p = p.slice(base.length) || "/";
  let file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { "content-type": "text/html" });
    res.end(await readFile(path.join(root, "404.html")).catch(() => "Not found"));
  }
}).listen(port, () => console.log(`Static preview of ./out on http://localhost:${port}${base}/`));
