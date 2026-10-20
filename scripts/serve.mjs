// 本機預覽用的極簡靜態伺服器（零依賴）。
//   node scripts/serve.mjs [port]
// 正式部署由 Vercel 處理；本機另支援 POST /api/llm-complete（需 LLM_BASE_URL）。
// 會自動讀取專案根目錄 `.env`（不覆蓋已存在的 process.env）。
import { createReadStream, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] ?? 4173);

/** 簡易載入 .env：KEY=VALUE，忽略註解與空行；已有環境變數不覆蓋。 */
function loadDotEnv(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return false;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}

const envLoaded = loadDotEnv(path.join(root, ".env"));

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

function isLlmCompletePath(urlPath) {
  const pathOnly = decodeURIComponent(urlPath.split("?")[0]).replace(/\/$/, "");
  return pathOnly === "/api/llm-complete" || pathOnly === "/api/llm-complete.mjs" || pathOnly === "/api/llm-complete.js";
}

async function handleLlmComplete(request, response) {
  const mod = await import(pathToFileURL(path.join(root, "api/llm-complete.mjs")).href);
  const handler = mod.default;
  await handler(request, response);
}

createServer((request, response) => {
  if (isLlmCompletePath(request.url ?? "")) {
    handleLlmComplete(request, response).catch((error) => {
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: error?.message || String(error) }));
    });
    return;
  }

  const file = resolve(request.url);
  if (!file) { response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); response.end("404"); return; }
  response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(response);
}).listen(port, () => {
  const hasBackend = Boolean(process.env.LLM_BASE_URL?.trim());
  const hasKey = Boolean(process.env.LLM_API_KEY?.trim());
  console.log(`http://127.0.0.1:${port}/`);
  if (envLoaded) console.log(`.env 已載入${hasBackend ? `（LLM_BASE_URL=${process.env.LLM_BASE_URL}${hasKey ? "，LLM_API_KEY 已設定" : "，未設 LLM_API_KEY"}）` : "（尚未設定 LLM_BASE_URL）"}`);
  else console.log("未找到 .env；可從 .env.example 複製後填入 LLM_BASE_URL");
  if (!hasBackend) console.log("語意評分將退回規則粗判，直到設定 LLM_BASE_URL");
});
