/**
 * OpenAI Chat Completions proxy（Vercel serverless）。
 * POST JSON { system, user, model? } → { text }
 * 金鑰只從環境變數 OPENAI_API_KEY 讀取，不進前端。
 */

const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_CHARS = 8000;
const OPENAI_TIMEOUT_MS = 30000;

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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    send(res, 503, { error: "未設定 OPENAI_API_KEY" });
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
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
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
      send(res, 502, { error: `OpenAI 請求失敗：${detail}` });
      return;
    }
    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      send(res, 502, { error: "OpenAI 沒有回傳文字" });
      return;
    }
    send(res, 200, { text: text.trim(), model });
  } catch (error) {
    const message = error?.name === "AbortError" ? "OpenAI 逾時" : (error?.message || String(error));
    send(res, 502, { error: message });
  } finally {
    clearTimeout(timer);
  }
}
