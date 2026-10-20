/**
 * LLM Chat Completions proxy（Vercel serverless，OpenAI 相容端點）。
 * POST JSON { system, user, model? } → { text }
 * 後端為自架 vLLM（經 Flask 閘道等 OpenAI 相容服務），以環境變數設定：
 *   LLM_BASE_URL（必填，例：http://114.34.77.157:9002/llm/gemma4）
 *   LLM_API_KEY（選填；未設定時不打 Authorization header）
 * 直接 POST 到 LLM_BASE_URL 本身，body 用 OpenAI 風格 {model, messages}；
 * 回應相容 OpenAI（choices[0].message.content）與 Ollama 風格（message.content）。
 * 模型名由前端統一提供（見 apps/shared/llm-complete.mjs 的 DEFAULT_LLM_MODEL）。
 */

const DEFAULT_MODEL = "google/gemma-4-26B-A4B-it";
const MAX_CHARS = 8000;
const LLM_TIMEOUT_MS = 30000;

// ── 後端設定（OpenAI 相容端點）──────────────────────────────────
// LLM_BASE_URL：閘道端點，POST 直接打到該網址本身（含 /chat/completions 結尾會被去掉）。
// LLM_API_KEY：後端金鑰；閘道未啟用驗證時可不設（不打 Authorization）。
const baseUrl = (process.env.LLM_BASE_URL?.trim() || "")
  .replace(/\/+$/, "")
  .replace(/\/chat\/completions$/, "");

// ── 防護一：來源檢查（Origin allowlist）────────────────────────────
// 瀏覽器對 POST 一律帶 Origin，站外腳本／curl 不帶或帶假來源都會被擋。
// 可用環境變數 LLM_ALLOWED_ORIGINS 覆寫：逗號分隔，或 "*" 表示全部放行。
const PROD_ORIGIN = "https://indigenous-language-ai-lab.vercel.app";

function getDefaultAllowedOrigins() {
  return [
    (origin) => origin === PROD_ORIGIN,
    (origin) => /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin), // 預覽部署
    (origin) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin), // 本機開發
  ];
}

function isOriginAllowed(origin) {
  if (typeof origin !== "string" || !origin) return false;
  const config = process.env.LLM_ALLOWED_ORIGINS?.trim();
  if (config === "*") return true;
  if (config) {
    return config.split(",").map((s) => s.trim()).includes(origin);
  }
  return getDefaultAllowedOrigins().some((match) => match(origin));
}

// ── 防護二：IP 限流（每 IP 每分鐘上限，記憶體內近似值）────────────
// serverless 可能有多個實例，此限流為每實例各自計數，足以擋掉隨手盜刷。
// 可用環境變數 LLM_RATE_LIMIT 覆寫（設 0 可關閉）。
const RATE_WINDOW_MS = 60000;
const RATE_LIMIT_DEFAULT = 30;
const rateHits = new Map(); // ip → 最近請求時間戳陣列

function getClientIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function isRateLimited(ip) {
  const limit = Number.parseInt(process.env.LLM_RATE_LIMIT ?? "", 10);
  const max = Number.isFinite(limit) ? limit : RATE_LIMIT_DEFAULT;
  if (max <= 0) return false;
  const now = Date.now();
  const hits = (rateHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= max) {
    rateHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  rateHits.set(ip, hits);
  if (rateHits.size > 5000) {
    // 避免記憶體無限成長：清掉過期紀錄
    for (const [key, times] of rateHits) {
      if (times.every((t) => now - t >= RATE_WINDOW_MS)) rateHits.delete(key);
    }
  }
  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  if (req.method !== "POST") {
    send(res, 405, { error: "只接受 POST" });
    return;
  }

  if (!isOriginAllowed(req.headers?.origin)) {
    send(res, 403, { error: "來源不允許" });
    return;
  }

  const clientIp = getClientIp(req);
  if (isRateLimited(clientIp)) {
    res.setHeader("Retry-After", "60");
    send(res, 429, { error: "請求太頻繁，請稍後再試" });
    return;
  }

  const apiKey = process.env.LLM_API_KEY?.trim() || "";
  if (!baseUrl) {
    send(res, 503, { error: "未設定 LLM_BASE_URL" });
    return;
  }

  let body;
  try {
    body = typeof req.body === "object" && req.body != null
      ? req.body
      : await readBody(req);
  } catch {
    send(res, 400, { error: "請求必須是 JSON" });
    return;
  }

  const system = typeof body.system === "string" ? body.system.trim() : "";
  const user = typeof body.user === "string" ? body.user.trim() : "";
  const model = typeof body.model === "string" && body.model.trim()
    ? body.model.trim()
    : DEFAULT_MODEL;

  if (!system || !user) {
    send(res, 400, { error: "需要 system 與 user 字串" });
    return;
  }
  if (system.length > MAX_CHARS || user.length > MAX_CHARS) {
    send(res, 400, { error: "system／user 過長" });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const upstreamHeaders = { "Content-Type": "application/json" };
    if (apiKey) upstreamHeaders.Authorization = `Bearer ${apiKey}`;
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload?.error?.message || `HTTP ${response.status}`;
      send(res, 502, { error: `LLM 請求失敗：${detail}` });
      return;
    }
    // 回應相容 OpenAI（choices[0].message.content）與 Ollama 風格（message.content）
    const text = payload?.choices?.[0]?.message?.content ?? payload?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      send(res, 502, { error: "LLM 沒有回傳文字" });
      return;
    }
    send(res, 200, { text: text.trim(), model });
  } catch (error) {
    const message = error?.name === "AbortError" ? "LLM 逾時" : (error?.message || String(error));
    send(res, 502, { error: message });
  } finally {
    clearTimeout(timer);
  }
}
