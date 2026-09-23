/**
 * 身體部位口說練習 · 語音辨識相關的純邏輯（可在 Node 測試）
 *
 * 兩件事在這裡被刻意寫死，不用任何推導規則：
 *   1. 族名 → ASR 族級模型 ID 的對照表
 *   2. 送出前的音訊格式（16 kHz／單聲道／16-bit PCM WAV）
 */

/** ASR 逾時較長：實測回應 10.7 秒、最慢曾達 14.8 秒，20 秒裕度不足 */
export const ASR_TIMEOUT_MS = 45_000;
/** 其餘 action（翻譯等）維持 20 秒 */
export const REQUEST_TIMEOUT_MS = 20_000;
/** 等待超過這個時間就說明還在辨識，免得使用者以為當掉 */
export const SLOW_HINT_AFTER_MS = 5_000;

/** ASR 目標格式：16 kHz／單聲道／16-bit PCM */
export const ASR_TARGET_SAMPLE_RATE = 16_000;

/**
 * 族名 → ASR 族級 dialect_id。**16 族一一對應，不多不少。**
 *
 * ⚠️ 絕對不可以用 NLLB 代碼前綴推導：
 *   賽德克三方言的 NLLB 是 trv_Duda／trv_Tegu／trv_Delu → ASR 要送 formosan_sdq
 *   太魯閣語的 NLLB 是 trv_Truk                        → ASR 要送 formosan_trv
 * 四個方言前綴都是 trv，卻分屬兩個不同模型；用前綴推導會把賽德克的錄音送進太魯閣模型。
 */
export const ASR_MODELS = {
  "阿美": "formosan_ami",
  "泰雅": "formosan_tay",
  "排灣": "formosan_pwn",
  "布農": "formosan_bnn",
  "卑南": "formosan_pyu",
  "魯凱": "formosan_dru",
  "鄒": "formosan_tsu",
  "賽夏": "formosan_xsy",
  "雅美": "formosan_tao",
  "邵": "formosan_ssf",
  "噶瑪蘭": "formosan_ckv",
  "太魯閣": "formosan_trv",
  "撒奇萊雅": "formosan_szy",
  "賽德克": "formosan_sdq",
  "拉阿魯哇": "formosan_sxr",
  "卡那卡那富": "formosan_xnb"
};

/** 取得某族的 ASR 模型；查不到就回 null，**不猜**。 */
export function asrModelFor(ethnicity) {
  return Object.prototype.hasOwnProperty.call(ASR_MODELS, ethnicity) ? ASR_MODELS[ethnicity] : null;
}

/**
 * 以即時 asr_dialects 校驗對照表。回傳稽核結果，不改寫對照表本身。
 *
 *   對照表有、即時清單沒有 → unavailable（該族標為暫時不可用）
 *   即時清單有、對照表沒有 → unknownFromApi（要警告，不得靜默）
 *   完全一致 → consistent: true
 *
 * **任何情況都不退回前綴推導或模糊比對。**
 */
export function auditAsrModels(models, liveDialectIds) {
  const live = new Set(Array.isArray(liveDialectIds) ? liveDialectIds : []);
  const entries = Object.entries(models);
  const available = [];
  const unavailable = [];

  for (const [ethnicity, model] of entries) {
    (live.has(model) ? available : unavailable).push({
      ethnicity,
      model,
      reason: live.has(model) ? null : "即時 asr_dialects 未提供這個模型"
    });
  }

  const known = new Set(entries.map(([, model]) => model));
  const unknownFromApi = [...live].filter((id) => !known.has(id)).map((id) => ({ model: id }));

  return {
    tableSize: entries.length,
    liveSize: live.size,
    available,
    unavailable,
    unknownFromApi,
    consistent: unavailable.length === 0 && unknownFromApi.length === 0
  };
}

/**
 * Float32 PCM → 16-bit 單聲道 RIFF/WAVE。無外部相依。
 * 直接送 MediaRecorder 的 WebM/Opus 會讓 ASR 回傳與原句無關的文字（且仍是 HTTP 200），
 * 所以送出前一律轉成這個格式。
 */
export function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);              // PCM
  view.setUint16(22, 1, true);              // 單聲道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);              // block align
  view.setUint16(34, 16, true);             // 位元深度
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return buffer;
}

/**
 * ASR 回應 → 辨識文字。任一種異常都丟出例外，交由呼叫端顯示「無法辨識」，
 * **不得當成使用者念錯**。
 */
export function readAsrText(payload, httpStatus) {
  if (!payload || typeof payload !== "object") throw new Error("辨識服務回傳不是有效 JSON");
  if (httpStatus !== undefined && httpStatus !== 200) throw new Error(`辨識服務 HTTP ${httpStatus}`);
  if (payload.ok !== true) throw new Error(payload.error || "辨識服務拒絕請求");
  const text = payload.data?.text;
  if (typeof text !== "string" || !text.trim()) throw new Error("辨識服務沒有回傳文字");
  return text.trim();
}
