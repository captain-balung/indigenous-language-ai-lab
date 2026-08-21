/**
 * 初級模擬站 · 錄音與辨識的瀏覽器膠水層
 *
 * 所有「規則」都從 MISSION 02 的 asr.mjs 匯入，維持單一來源：
 * 族名→模型對照、目標取樣率、逾時、WAV 編碼、回應解讀。
 * 這裡只放 MediaRecorder／AudioContext 這類必須碰瀏覽器 API 的部分。
 *
 * 不可妥協的一條：轉檔失敗就直接放棄，**絕不退回送出原始錄音**。
 * 送 WebM/Opus 給 ASR 會拿回與原句無關的文字，而且仍然是 HTTP 200。
 */

import {
  asrModelFor, encodeWav, readAsrText,
  ASR_TARGET_SAMPLE_RATE, ASR_TIMEOUT_MS,
} from "../body-parts-speaking/asr.mjs";

export const API = "https://ai3.iformosa.com.tw/formosan_ai/api.php";

export function supportsRecording() {
  return Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";
}

/** 這三項語音前處理是為視訊通話調校的，對 ASR 有害；不支援時優雅退回。 */
export async function requestMicrophone() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
  } catch (error) {
    if (error?.name === "NotAllowedError" || error?.name === "NotFoundError") throw error;
    console.warn(`[錄音] 瀏覽器不接受語音前處理約束，退回預設設定：${error?.message}`);
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

/**
 * 建立錄音器。onState 回報狀態，onTick 回報已錄秒數。
 * stop() 之後由 onState("recorded", blob) 交出錄音。
 */
export function createRecorder({ onState = () => {}, onTick = () => {} } = {}) {
  let mediaStream = null;
  let recorder = null;
  let chunks = [];
  let timer = null;
  let startedAt = 0;
  let blob = null;
  let objectUrl = null;

  function releaseStream() {
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    get blob() { return blob; },
    get objectUrl() { return objectUrl; },
    get recording() { return recorder?.state === "recording"; },

    async start() {
      mediaStream = await requestMicrophone();
      chunks = [];
      const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      recorder = preferred ? new MediaRecorder(mediaStream, { mimeType: preferred }) : new MediaRecorder(mediaStream);
      recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
      recorder.addEventListener("stop", () => {
        stopTimer();
        releaseStream();
        blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(blob);
        onState("recorded", blob);
      });
      recorder.start();
      startedAt = Date.now();
      timer = setInterval(() => onTick(Math.floor((Date.now() - startedAt) / 1000)), 250);
      onState("recording");
    },

    stop() {
      if (recorder?.state === "recording") recorder.stop();
    },

    clear() {
      stopTimer();
      releaseStream();
      if (recorder?.state === "recording") recorder.stop();
      recorder = null;
      chunks = [];
      blob = null;
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
      onTick(0);
      onState("idle");
    },
  };
}

/** 送出前一律轉成 16 kHz／單聲道／16-bit PCM WAV。 */
export async function convertToAsrWav(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx || typeof OfflineAudioContext === "undefined") throw new Error("這個瀏覽器不支援音訊轉檔");
  const raw = await blob.arrayBuffer();
  const context = new Ctx();
  let decoded;
  try { decoded = await context.decodeAudioData(raw); } finally { context.close?.(); }
  const frames = Math.max(1, Math.ceil(decoded.duration * ASR_TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, ASR_TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return new Blob([encodeWav(rendered.getChannelData(0), ASR_TARGET_SAMPLE_RATE)], { type: "audio/wav" });
}

/**
 * 送出辨識。第二個參數是**族名**，模型一律由 asrModelFor 查表，
 * 不由 NLLB 代碼前綴推導（賽德克與太魯閣的前綴都是 trv，卻是兩個模型）。
 */
export async function transcribe(wav, ethnicity, { unavailable = new Set() } = {}) {
  const model = asrModelFor(ethnicity);
  if (!model) throw new Error("這個語言別沒有對應的辨識模型");
  if (unavailable.has(ethnicity)) throw new Error("這個語言別的辨識模型目前不可用");

  const form = new FormData();
  form.append("action", "asr_transcribe");
  form.append("dialect_id", model);
  form.append("audio", wav, "answer-16k-mono.wav");

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), ASR_TIMEOUT_MS);
  try {
    const response = await fetch(API, { method: "POST", body: form, signal: controller.signal });
    let body;
    try { body = await response.json(); } catch { throw new Error("辨識服務回傳不是有效 JSON"); }
    return readAsrText(body, response.status);
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`辨識服務在 ${Math.round(ASR_TIMEOUT_MS / 1000)} 秒內沒有回應`);
    throw error;
  } finally {
    clearTimeout(abortTimer);
  }
}

/** 查詢目前可用的 ASR 模型；失敗時回 null，由呼叫端沿用內建對照表。 */
export async function fetchLiveAsrDialects(timeoutMs = 20_000) {
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API}?action=asr_dialects`, { signal: controller.signal });
    const body = await response.json();
    const ids = body?.data?.dialect_ids;
    return Array.isArray(ids) ? ids : null;
  } catch (error) {
    console.warn(`[ASR] 無法取得即時模型清單，沿用內建對照表：${error?.message}`);
    return null;
  } finally {
    clearTimeout(abortTimer);
  }
}

/**
 * 族語→中文翻譯（看圖說話部分給分用）。
 * 失敗時拋錯，由呼叫端標成「無法判定」，不得因此判使用者答錯。
 */
export async function translateToZh(text, srcLang, timeoutMs = ASR_TIMEOUT_MS) {
  if (typeof text !== "string" || !text.trim()) throw new Error("沒有可翻譯的文字");
  if (typeof srcLang !== "string" || !srcLang.trim()) throw new Error("缺少翻譯語言代碼");

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "translate_to_zh", text, src_lang: srcLang }),
      signal: controller.signal,
    });
    let body;
    try { body = await response.json(); } catch { throw new Error("翻譯服務回傳不是有效 JSON"); }
    if (!response.ok || body?.ok === false) throw new Error(body?.message || `翻譯服務 HTTP ${response.status}`);
    if (typeof body.data?.translation !== "string" || !body.data.translation.trim()) {
      throw new Error("翻譯服務缺少譯文");
    }
    return body.data.translation.trim();
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`翻譯服務在 ${Math.round(timeoutMs / 1000)} 秒內沒有回應`);
    throw error;
  } finally {
    clearTimeout(abortTimer);
  }
}
