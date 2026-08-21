// 本機預覽用的極簡靜態伺服器（零依賴）。
//   node scripts/serve.mjs [port]
// 正式部署由 Vercel 處理，這支只是為了本機開發與測試。
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".xml": "application/xml; charset=utf-8",
};

function resolve(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const target = path.join(root, path.normalize(decoded).replace(/^(\.\.[/\\])+/, ""));
  if (!target.startsWith(root)) return null;
  for (const candidate of [target, `${target}.html`, path.join(target, "index.html")]) {
    try { if (statSync(candidate).isFile()) return candidate; } catch { /* 換下一個候選 */ }
  }
  return null;
}

createServer((request, response) => {
  const file = resolve(request.url);
  if (!file) { response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); response.end("404"); return; }
  response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(response);
}).listen(port, () => console.log(`http://127.0.0.1:${port}/`));
