import { createQuestionDeck, createSingleFlight, judgeAnswer } from "../body-parts-practice/core.mjs";
import { DIALECTS, ETHNICITIES, dialectById } from "../body-parts-practice/dialects.mjs";
import {
  ASR_MODELS, asrModelFor, auditAsrModels, encodeWav, readAsrText,
  ASR_TARGET_SAMPLE_RATE, ASR_TIMEOUT_MS, REQUEST_TIMEOUT_MS, SLOW_HINT_AFTER_MS
} from "./asr.mjs";

const API = "https://ai3.iformosa.com.tw/formosan_ai/api.php";
const $ = (selector) => document.querySelector(selector);
const ui = {
  ethnicity: $("#ethnicity"), dialect: $("#dialect"), start: $("#start"), api: $("#api-status"),
  modelNote: $("#model-note"), quiz: $("#quiz"), label: $("#dialect-label"), progress: $("#progress"),
  image: $("#question-image"), record: $("#record"), recordLabel: $("#record-label"), time: $("#record-time"),
  state: $("#record-state"), stateText: $("#record-state-text"), preview: $("#preview"),
  submit: $("#submit"), rerecord: $("#rerecord"), heard: $("#heard"), result: $("#result"),
  retry: $("#retry"), reveal: $("#reveal"), next: $("#next"), model: $("#model-answer")
};

let dataset, selectedDialect, question, deck, answeredCount = 0, pending = false;
let translationCodes = new Set(DIALECTS.map((d) => d.code));
let asrAudit = null;
let recorder = null, mediaStream = null, chunks = [], startedAt = 0, timer = null;
let recordedBlob = null, previewUrl = null, lastHeard = null;

/* ---------- 狀態列：文字＋圖示，不只靠顏色 ---------- */

const STATES = {
  idle: ["●", "尚未錄音"],
  recording: ["◉", "錄音中…再按一次停止"],
  recorded: ["■", "錄音完成，可以送出或重錄"],
  converting: ["◐", "轉檔中…"],
  transcribing: ["◍", "辨識中，請稍候"],
  slow: ["◍", "辨識中，長句需要較久，請不要重新整理"],
  failed: ["△", "這次沒有送出"]
};

function setState(key, override) {
  const [icon, text] = STATES[key] || STATES.idle;
  ui.state.dataset.state = key;
  ui.state.querySelector(".record-state__icon").textContent = icon;
  ui.stateText.textContent = override || text;
}

/* ---------- 初始化 ---------- */

async function init() {
  const response = await fetch("/data/body-parts/dataset.json");
  if (!response.ok) throw new Error("教材載入失敗");
  dataset = await response.json();
  if (dataset.recordCount !== 420 || dataset.dialectCount !== 42) throw new Error("教材完整性檢查失敗");
  ui.ethnicity.insertAdjacentHTML("beforeend", ETHNICITIES.map((name) => `<option value="${name}">${name}</option>`).join(""));

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    ui.api.textContent = "△ 這個瀏覽器不支援錄音。請改用打字版（MISSION 01），或換用支援錄音的瀏覽器。";
    ui.api.dataset.state = "error";
    ui.start.disabled = true;
    return;
  }
  await verifyServices();
}

async function verifyServices() {
  const notes = [];
  try {
    const response = await fetch(`${API}?action=asr_dialects`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const body = await response.json();
    if (!response.ok || body.ok !== true || !Array.isArray(body.data?.dialect_ids)) throw new Error();
    asrAudit = auditAsrModels(ASR_MODELS, body.data.dialect_ids);
    // 靜默吞掉漂移，等於讓對照表悄悄過期
    asrAudit.unavailable.forEach((item) =>
      console.warn(`[語音辨識] 對照表有、即時清單沒有：${item.ethnicity}（${item.model}）——該族暫時無法辨識。`));
    asrAudit.unknownFromApi.forEach((item) =>
      console.warn(`[語音辨識] 即時清單有、對照表沒有：${item.model}——請更新 ASR_MODELS 對照表。`));
    notes.push(asrAudit.consistent
      ? `語音辨識服務已連線；16 個族級模型對照一致`
      : `語音辨識服務已連線；${asrAudit.unavailable.length} 個族別暫時無法辨識`);
  } catch {
    asrAudit = null;
    notes.push("語音辨識即時清單暫時無法取得，改以內建對照表送出");
  }

  try {
    const response = await fetch(`${API}?action=translate_languages`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const body = await response.json();
    if (!response.ok || body.ok !== true || !Array.isArray(body.data?.language_codes)) throw new Error();
    translationCodes = new Set(body.data.language_codes);
    notes.push(`翻譯服務已驗證 ${translationCodes.size} 個語言代碼`);
  } catch {
    notes.push("翻譯即時清單暫時無法取得；教材完全比對仍可離線運作");
  }

  ui.api.textContent = `● ${notes.join("；")}`;
  ui.api.dataset.state = asrAudit?.consistent ? "ok" : "fallback";
  updateStart();
}

/* ---------- 選擇語別 ---------- */

ui.ethnicity.addEventListener("change", () => {
  resetQuiz();
  const choices = DIALECTS.filter((d) => d.ethnicity === ui.ethnicity.value);
  ui.dialect.innerHTML = `<option value="">請選擇方言別</option>${choices.map((d) => `<option value="${d.id}">${d.name}</option>`).join("")}`;
  ui.dialect.disabled = !choices.length;
  updateModelNote();
  updateStart();
});

ui.dialect.addEventListener("change", () => {
  resetQuiz();
  selectedDialect = dialectById(ui.dialect.value);
  updateModelNote();
  updateStart();
});

function asrStateFor(ethnicity) {
  const model = asrModelFor(ethnicity);
  if (!model) return { model: null, usable: false, reason: "這個語言別沒有對應的語音辨識模型" };
  const blocked = asrAudit?.unavailable.some((item) => item.model === model);
  return { model, usable: !blocked, reason: blocked ? "服務目前沒有提供這個族別的模型" : null };
}

function updateModelNote() {
  const ethnicity = ui.ethnicity.value;
  if (!ethnicity) { ui.modelNote.textContent = ""; return; }
  const { model, usable, reason } = asrStateFor(ethnicity);
  const dialectName = selectedDialect?.name || "所選方言";
  ui.modelNote.textContent = usable
    ? `${dialectName}將使用「${ethnicity}」族級模型 ${model} 進行辨識。`
    : `${ethnicity}目前無法使用語音辨識：${reason}。可改用打字版練習。`;
  ui.modelNote.dataset.blocked = usable ? "false" : "true";
}

function updateStart() {
  const usable = ui.ethnicity.value ? asrStateFor(ui.ethnicity.value).usable : false;
  ui.start.disabled = !selectedDialect || !dataset || !usable;
}

/* ---------- 出題 ---------- */

ui.start.addEventListener("click", () => {
  const records = dataset.records.filter((item) => item.dialectId === selectedDialect.id);
  if (records.length !== 10) { showResult("unavailable", "此方言教材不完整，暫停出題。"); return; }
  deck = createQuestionDeck(records);
  answeredCount = 0;
  ui.quiz.hidden = false;
  nextQuestion();
  ui.quiz.scrollIntoView({ behavior: reduced() ? "auto" : "smooth" });
});

function nextQuestion() {
  question = deck.next();
  answeredCount += 1;
  pending = false;
  ui.label.textContent = `${selectedDialect.ethnicity} · ${selectedDialect.name}`;
  ui.progress.textContent = `本輪 ${answeredCount} / 10`;
  ui.image.src = `/data/body-parts/${question.imagePath}`;
  ui.image.alt = `請辨認圖片中的身體部位（${selectedDialect.name}題目）`;
  clearRecording();
  ui.heard.hidden = true;
  ui.result.hidden = ui.retry.hidden = ui.reveal.hidden = ui.next.hidden = ui.model.hidden = true;
  ui.record.disabled = false;
  ui.record.focus();
}

/* ---------- 錄音 ---------- */

async function requestMicrophone() {
  // 這三項語音前處理是為視訊通話調校的，對 ASR 有害；不支援時優雅退回
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
    });
  } catch (error) {
    if (error?.name === "NotAllowedError" || error?.name === "NotFoundError") throw error;
    console.warn(`[錄音] 瀏覽器不接受語音前處理約束，退回預設設定：${error?.message}`);
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

ui.record.addEventListener("click", async () => {
  if (recorder?.state === "recording") { recorder.stop(); return; }
  try {
    mediaStream = await requestMicrophone();
  } catch (error) {
    const denied = error?.name === "NotAllowedError";
    setState("failed", denied ? "沒有麥克風權限" : "找不到可用的麥克風");
    showResult("unavailable", denied
      ? "瀏覽器沒有給這個頁面麥克風權限，所以無法錄音。你可以在網址列的權限設定允許麥克風後重試，或改用打字版練習。"
      : "找不到可用的麥克風。請確認裝置後重試，或改用打字版練習。");
    return;
  }
  chunks = [];
  const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
    .find((type) => MediaRecorder.isTypeSupported(type));
  recorder = preferred ? new MediaRecorder(mediaStream, { mimeType: preferred }) : new MediaRecorder(mediaStream);
  recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
  recorder.addEventListener("stop", finishRecording);
  recorder.start();
  startedAt = Date.now();
  timer = setInterval(tick, 250);
  ui.record.classList.add("is-recording");
  ui.recordLabel.textContent = "停止錄音";
  setState("recording");
});

function tick() {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  ui.time.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function finishRecording() {
  clearInterval(timer);
  mediaStream?.getTracks().forEach((track) => track.stop());
  recordedBlob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(recordedBlob);
  ui.preview.src = previewUrl;
  ui.preview.hidden = false;
  ui.record.classList.remove("is-recording");
  ui.recordLabel.textContent = "重新錄音";
  ui.submit.disabled = false;
  ui.rerecord.hidden = false;
  setState("recorded");
}

ui.rerecord.addEventListener("click", () => { clearRecording(); ui.record.focus(); });

function clearRecording() {
  recordedBlob = null;
  lastHeard = null;
  chunks = [];
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  ui.preview.hidden = true;
  ui.preview.removeAttribute("src");
  ui.record.classList.remove("is-recording");
  ui.recordLabel.textContent = "開始錄音";
  ui.time.textContent = "00:00";
  ui.submit.disabled = true;
  ui.rerecord.hidden = true;
  setState("idle");
}

/* ---------- 轉檔：送出前一律轉成 16 kHz 單聲道 PCM WAV ---------- */

async function convertToAsrWav(blob) {
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

/* ---------- 送出與判定 ---------- */

ui.submit.addEventListener("click", () => { runFlow(); });
ui.retry.addEventListener("click", () => { runFlow(); });

const runFlow = createSingleFlight(async () => {
  if (!recordedBlob || pending) return;
  pending = true;
  ui.submit.disabled = true;
  ui.retry.disabled = true;
  ui.record.disabled = true;

  let wav;
  setState("converting");
  try {
    wav = await convertToAsrWav(recordedBlob);
  } catch (error) {
    // 轉檔失敗絕不靜默送出原始錄音——那正是辨識不準的來源
    setState("failed", "轉檔失敗，沒有送出");
    showResult("unavailable",
      `無法把這段錄音轉成辨識需要的格式（${error.message}），因此沒有送出任何資料。請重新錄音，或改用打字版練習。`);
    finishFlow();
    return;
  }

  setState("transcribing");
  const slowHint = setTimeout(() => setState("slow"), SLOW_HINT_AFTER_MS);
  let heard;
  try {
    heard = await transcribe(wav, selectedDialect.ethnicity);
    lastHeard = heard;
    renderHeard(heard);
  } catch (error) {
    clearTimeout(slowHint);
    setState("failed", "這次沒有辨識成功");
    showResult("unavailable", `目前無法辨識（${error.message}），你的答案尚未被判錯。錄音仍保留，可以直接重試判定，或重新錄音。`);
    ui.retry.hidden = false;
    finishFlow();
    return;
  }
  clearTimeout(slowHint);

  const result = await judgeAnswer({
    answer: heard,
    question,
    translate: (text) => translateToZh(text, selectedDialect.code)
  });
  renderResult(result, heard);
  finishFlow();
});

function finishFlow() {
  pending = false;
  ui.retry.disabled = false;
  ui.record.disabled = false;
  ui.submit.disabled = !recordedBlob;
}

async function transcribe(wav, ethnicity) {
  const { model, usable } = asrStateFor(ethnicity);
  if (!model || !usable) throw new Error("這個語言別目前沒有可用的辨識模型");
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

async function translateToZh(text, srcLang) {
  if (!translationCodes.has(srcLang)) throw new Error("此方言目前沒有翻譯代碼");
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(API, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "translate_to_zh", text, src_lang: srcLang }), signal: controller.signal
    });
    let body;
    try { body = await response.json(); } catch { throw new Error("服務回傳不是有效 JSON"); }
    if (!response.ok) throw new Error(`翻譯服務 HTTP ${response.status}`);
    if (body.ok !== true) throw new Error(body.error || "翻譯服務拒絕請求");
    if (typeof body.data?.translation !== "string" || !body.data.translation.trim()) throw new Error("翻譯服務缺少譯文");
    return body.data.translation.trim();
  } catch (error) {
    if (error.name === "AbortError") throw new Error("翻譯服務逾時");
    throw error;
  } finally {
    clearTimeout(abortTimer);
  }
}

/* ---------- 呈現 ---------- */

function renderHeard(text) {
  ui.heard.hidden = false;
  ui.heard.innerHTML = `<strong>系統聽到的是</strong><p class="heard-text">${escapeHtml(text)}</p>
    <small>這是語音辨識的結果。如果和你念的不一樣，可能是族級模型的限制，不代表你念錯——可以重新錄音再試一次。</small>`;
}

function renderResult(result, heard) {
  ui.result.hidden = false;
  ui.result.dataset.state = result.type;
  const messages = {
    exact: ["完全正確！", "與教材答案完全相符，不需要再呼叫翻譯服務。"],
    semantic: ["意思正確，通過！", "系統聽到的內容意思接近；可以參考教材的標準句型。"],
    // 不斷言使用者念錯：只陳述系統聽到什麼、與教材不同
    retry: ["再試一次", "系統聽到的內容與本題的身體部位不相符。可能是念法不同，也可能是辨識偏差；重新錄音再試一次即可。"],
    unavailable: ["目前無法完成判定", "你的答案尚未被判錯，錄音仍保留。"]
  };
  const [title, detail] = messages[result.type];
  ui.result.innerHTML = `<strong>${title}</strong><p>${detail}</p>` + (result.translation
    ? `<dl><dt>系統聽到的族語</dt><dd>${escapeHtml(heard)}</dd><dt>翻譯服務的中文</dt><dd>${escapeHtml(result.translation)}</dd>` +
      (result.type === "semantic"
        ? `<dt>教材族語</dt><dd>${escapeHtml(question.indigenousText)}</dd><dt>教材中文</dt><dd>${escapeHtml(question.chineseText)}</dd>`
        : "") + `</dl>`
    : "");
  const passed = result.type === "exact" || result.type === "semantic";
  ui.next.hidden = !passed;
  ui.reveal.hidden = passed;
  ui.retry.hidden = result.type !== "unavailable";
  setState(passed ? "recorded" : "recorded", passed ? "判定完成" : "可以重新錄音再試一次");
}

ui.reveal.addEventListener("click", () => {
  ui.model.hidden = false;
  ui.model.innerHTML = `<strong>教材答案</strong><p>${escapeHtml(question.indigenousText)}</p><small>${escapeHtml(question.chineseText)}</small>`;
});

ui.next.addEventListener("click", () => { if (answeredCount >= 10) answeredCount = 0; nextQuestion(); });

function resetQuiz() {
  selectedDialect = undefined; deck = undefined; question = undefined;
  ui.quiz.hidden = true;
  clearRecording();
  ui.heard.hidden = true;
  ui.result.hidden = true;
  ui.model.hidden = true;
}

function showResult(state, text) {
  ui.result.hidden = false;
  ui.result.dataset.state = state;
  ui.result.textContent = text;
}

function reduced() { return matchMedia("(prefers-reduced-motion: reduce)").matches; }
function escapeHtml(value) { const div = document.createElement("div"); div.textContent = value; return div.innerHTML; }

window.addEventListener("pagehide", () => { if (previewUrl) URL.revokeObjectURL(previewUrl); });

init().catch((error) => {
  ui.api.textContent = `教材無法載入：${error.message}`;
  ui.api.dataset.state = "error";
});
