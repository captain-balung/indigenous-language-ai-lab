import { createQuestionDeck, createSingleFlight, exactMatch, semanticMatch } from "../body-parts-practice/core.mjs";
import { DIALECTS, ETHNICITIES, dialectById } from "../body-parts-practice/dialects.mjs";
import { ASR_MODELS, asrModelFor, auditAsrModels, SLOW_HINT_AFTER_MS } from "../body-parts-speaking/asr.mjs";
import {
  convertToAsrWav, createRecorder, fetchLiveAsrDialects, supportsRecording, transcribe, translateToZh
} from "../../certification-mock/beginner-mock-exam/recorder.mjs";
import { LEVELS, describeCaption, pictureTalkRecords } from "./core.mjs";

const $ = (selector) => document.querySelector(selector);
const ui = {
  ethnicity: $("#ethnicity"), dialect: $("#dialect"), start: $("#start"), api: $("#api-status"),
  modelNote: $("#model-note"), themes: $("#themes"), themeGrid: $("#theme-grid"),
  quiz: $("#quiz"), label: $("#dialect-label"), progress: $("#progress"),
  promptKind: $("#prompt-kind"), title: $("#question-title"), tip: $("#picture-tip"), pictures: $("#picture-grid"),
  answer: $("#answer"), record: $("#record"), recordLabel: $("#record-label"), time: $("#record-time"),
  state: $("#record-state"), stateText: $("#record-state-text"), preview: $("#preview"),
  submit: $("#submit"), rerecord: $("#rerecord"), heard: $("#heard"), result: $("#result"),
  retry: $("#retry"), next: $("#next")
};

const STATES = {
  idle: ["●", "尚未錄音，打字也可以送出"],
  recording: ["◉", "錄音中…再按一次停止"],
  recorded: ["■", "錄音完成，可以送出或重錄"],
  converting: ["◐", "轉檔中…"],
  transcribing: ["◍", "辨識中，請稍候"],
  slow: ["◍", "辨識中，長句需要較久，請不要重新整理"],
  failed: ["△", "這次沒有送出"]
};

let selectedDialect, selectedLevel, pools = { beginner: [], intermediate: [] }, records = [], question, deck, roundSize = 0, answeredCount = 0, pending = false;
let translationCodes = new Set(DIALECTS.map((item) => item.code));
let asrAudit = null, recorder = null, lastHeard = null;

function setState(key, override) {
  const [icon, text] = STATES[key] || STATES.idle;
  ui.state.dataset.state = key;
  ui.state.querySelector(".record-state__icon").textContent = icon;
  ui.stateText.textContent = override || text;
}

function clock(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

async function init() {
  ui.ethnicity.insertAdjacentHTML("beforeend", ETHNICITIES.map((name) => `<option value="${name}">${name}</option>`).join(""));
  recorder = createRecorder({
    onState(state) {
      if (state === "recording") {
        ui.record.classList.add("is-recording");
        ui.recordLabel.textContent = "停止錄音";
        setState("recording");
        return;
      }
      if (state === "recorded") {
        ui.record.classList.remove("is-recording");
        ui.recordLabel.textContent = "重新錄音";
        ui.rerecord.hidden = false;
        if (recorder.objectUrl) {
          ui.preview.src = recorder.objectUrl;
          ui.preview.hidden = false;
        }
        setState("recorded");
        updateSubmit();
        return;
      }
      ui.record.classList.remove("is-recording");
      ui.recordLabel.textContent = "開始錄音";
      ui.preview.hidden = true;
      ui.preview.removeAttribute("src");
      ui.rerecord.hidden = true;
      setState("idle");
      updateSubmit();
    },
    onTick(seconds) { ui.time.textContent = clock(seconds); }
  });
  await verifyServices();
  if (!supportsRecording()) {
    ui.record.disabled = true;
    setState("failed", "這個瀏覽器不支援錄音，請改用打字");
  }
}

async function verifyServices() {
  const notes = [];
  try {
    const ids = await fetchLiveAsrDialects();
    if (!ids) throw new Error();
    asrAudit = auditAsrModels(ASR_MODELS, ids);
    notes.push(asrAudit.consistent ? "語音辨識服務已連線" : `語音辨識服務已連線；${asrAudit.unavailable.length} 個族別暫時無法辨識`);
  } catch {
    asrAudit = null;
    notes.push("語音辨識即時清單暫時無法取得，改以內建對照表送出");
  }
  try {
    const response = await fetch("https://ai3.iformosa.com.tw/formosan_ai/api.php?action=translate_languages", { signal: AbortSignal.timeout(12000) });
    const body = await response.json();
    if (!response.ok || body.ok !== true || !Array.isArray(body.data?.language_codes)) throw new Error();
    translationCodes = new Set(body.data.language_codes);
    notes.push(`翻譯服務已驗證 ${translationCodes.size} 個語言代碼`);
  } catch {
    notes.push("翻譯即時清單暫時無法取得，送出時再試");
  }
  ui.api.textContent = `● ${notes.join("；")}`;
  ui.api.dataset.state = asrAudit?.consistent ? "ok" : "fallback";
  updateStart();
}

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
    ? `${dialectName}將使用「${ethnicity}」族級模型 ${model} 進行辨識。打字作答不經過語音辨識。`
    : `${ethnicity}目前無法使用語音辨識：${reason}。仍可打字作答。`;
  ui.modelNote.dataset.blocked = usable ? "false" : "true";
}

function updateStart() { ui.start.disabled = !selectedDialect || !selectedLevel || !records.length; }
function updateSubmit() { ui.submit.disabled = pending || (!ui.answer.value.trim() && !recorder?.blob); }

ui.ethnicity.addEventListener("change", () => {
  resetQuiz();
  const choices = DIALECTS.filter((item) => item.ethnicity === ui.ethnicity.value);
  ui.dialect.innerHTML = `<option value="">請選擇方言別</option>${choices.map((item) => `<option value="${item.id}">${item.name}</option>`).join("")}`;
  ui.dialect.disabled = !choices.length;
  updateModelNote();
  updateStart();
});

ui.dialect.addEventListener("change", () => {
  resetQuiz();
  selectedDialect = dialectById(ui.dialect.value);
  updateModelNote();
  loadLevels();
  updateStart();
});

ui.themeGrid.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-level]");
  if (!button || button.disabled) return;
  selectedLevel = LEVELS.find((level) => level.id === button.dataset.level);
  records = pools[selectedLevel.id] ?? [];
  for (const item of ui.themeGrid.querySelectorAll("button[data-level]")) {
    item.setAttribute("aria-pressed", String(item === button));
  }
  updateStart();
});

async function loadLevels() {
  const dialect = selectedDialect;
  if (!dialect) return;
  ui.themes.hidden = false;
  ui.themeGrid.innerHTML = "<p>載入題型中…</p>";
  try {
    const [junior, senior] = await Promise.all([
      fetch(`/data/klokah-junior/dialects/${dialect.id}.json`).then((response) => {
        if (!response.ok) throw new Error("初級看圖說話載入失敗");
        return response.json();
      }),
      fetch(`/data/klokah-senior/dialects/${dialect.id}.json`).then((response) => {
        if (!response.ok) throw new Error("中級看圖表達載入失敗");
        return response.json();
      })
    ]);
    if (selectedDialect !== dialect) return;
    pools = pictureTalkRecords(junior, senior);
    ui.themeGrid.innerHTML = LEVELS.map((level) => {
      const count = pools[level.id].length;
      return `<button type="button" data-level="${level.id}" ${count ? "" : "disabled"} aria-pressed="false">${escapeHtml(level.name)}<small>${count} 題</small></button>`;
    }).join("");
  } catch (error) {
    if (selectedDialect !== dialect) return;
    pools = { beginner: [], intermediate: [] };
    ui.themeGrid.innerHTML = `<p>題型教材無法載入：${escapeHtml(error.message)}</p>`;
  }
  updateStart();
}

ui.start.addEventListener("click", () => {
  if (!records.length) return showResult("unavailable", "此題型目前沒有可用圖卡，暫停出題。");
  deck = createQuestionDeck(records);
  roundSize = records.length;
  answeredCount = 0;
  ui.quiz.hidden = false;
  nextQuestion();
  ui.quiz.scrollIntoView({ behavior: reduced() ? "auto" : "smooth" });
});

function nextQuestion() {
  question = deck.next();
  answeredCount += 1;
  pending = false;
  ui.label.textContent = `${selectedDialect.ethnicity} · ${selectedDialect.name} · ${selectedLevel.name}`;
  ui.progress.textContent = `本輪 ${answeredCount} / ${roundSize}`;
  ui.promptKind.textContent = question.title;
  ui.title.textContent = "用自己的話描述這些圖";
  ui.tip.textContent = `中文提示：${question.tip}`;
  ui.pictures.dataset.count = String(question.imageUrls.length);
  ui.pictures.innerHTML = question.imageUrls.map((imageUrl, index) => `
    <figure>
      <img src="${escapeHtml(imageUrl)}" alt="看圖描述圖片 ${index + 1}" referrerpolicy="no-referrer">
      <figcaption>圖片 ${index + 1}</figcaption>
    </figure>`).join("");
  ui.answer.value = "";
  ui.heard.hidden = ui.result.hidden = ui.retry.hidden = ui.next.hidden = true;
  clearRecording();
  const canRecord = supportsRecording() && asrStateFor(selectedDialect.ethnicity).usable;
  ui.record.disabled = !canRecord;
  updateSubmit();
  ui.answer.focus();
}

ui.record.addEventListener("click", async () => {
  if (recorder.recording) { recorder.stop(); return; }
  try {
    await recorder.start();
  } catch (error) {
    const denied = error?.name === "NotAllowedError";
    setState("failed", denied ? "沒有麥克風權限" : "找不到可用的麥克風");
    showResult("unavailable", denied
      ? "瀏覽器沒有給這個頁面麥克風權限。可改用打字，或在網址列允許麥克風後再錄。"
      : "找不到可用的麥克風。可改用打字。");
  }
});

ui.rerecord.addEventListener("click", () => { clearRecording(); ui.record.focus(); });
ui.answer.addEventListener("input", updateSubmit);

function clearRecording() {
  lastHeard = null;
  recorder?.clear();
  ui.time.textContent = "00:00";
  updateSubmit();
}

ui.submit.addEventListener("click", () => { runFlow(); });
ui.retry.addEventListener("click", () => { runFlow(); });

const runFlow = createSingleFlight(async () => {
  const typed = ui.answer.value.trim();
  if (pending || (!typed && !recorder?.blob)) return;
  pending = true;
  ui.submit.disabled = true;
  ui.retry.disabled = true;
  ui.record.disabled = true;

  let indigenous = typed;
  if (!indigenous) {
    let wav;
    setState("converting");
    try {
      wav = await convertToAsrWav(recorder.blob);
    } catch (error) {
      setState("failed", "轉檔失敗，沒有送出");
      showResult("unavailable", `無法把這段錄音轉成辨識需要的格式（${error.message}），因此沒有送出任何資料。`);
      finishFlow();
      return;
    }
    setState("transcribing");
    const slowHint = setTimeout(() => setState("slow"), SLOW_HINT_AFTER_MS);
    try {
      indigenous = await transcribe(wav, selectedDialect.ethnicity);
      lastHeard = indigenous;
      renderHeard(indigenous);
    } catch (error) {
      clearTimeout(slowHint);
      setState("failed", "這次沒有辨識成功");
      showResult("unavailable", `目前無法辨識（${error.message}），你的答案尚未被判錯。`);
      ui.retry.hidden = false;
      finishFlow();
      return;
    }
    clearTimeout(slowHint);
  } else {
    lastHeard = null;
    ui.heard.hidden = true;
  }

  let translation;
  let matched = false;
  if (exactMatch(indigenous, question.indigenousText)) {
    translation = question.chineseText;
    matched = true;
  } else {
    try {
      translation = await translateAnswer(indigenous);
      matched = semanticMatch(translation, question.chineseText);
    } catch (error) {
      showResult("unavailable", `目前無法完成判定（${error.message}），你的答案尚未被判錯。`);
      ui.retry.hidden = false;
      finishFlow();
      return;
    }
  }

  renderResult({ indigenous, translation, matched });
  finishFlow();
});

function finishFlow() {
  pending = false;
  ui.retry.disabled = false;
  ui.record.disabled = !(supportsRecording() && selectedDialect && asrStateFor(selectedDialect.ethnicity).usable);
  updateSubmit();
}

async function translateAnswer(text) {
  if (!translationCodes.has(selectedDialect.code)) throw new Error("此方言目前沒有翻譯代碼");
  return translateToZh(text, selectedDialect.code);
}

function renderHeard(text) {
  ui.heard.hidden = false;
  ui.heard.innerHTML = `<strong>系統聽到的是</strong><p class="heard-text">${escapeHtml(text)}</p>
    <small>這是語音辨識的結果。如果和你念的不一樣，可能是族級模型的限制，不代表你念錯。</small>`;
}

function renderResult({ indigenous, translation, matched }) {
  const caption = describeCaption({ translation, matched });
  ui.result.hidden = false;
  ui.result.dataset.state = matched ? "semantic" : "retry";
  ui.result.innerHTML = `<strong>${caption.headline}</strong>
    <p class="heard-text">${escapeHtml(caption.translation)}</p>
    ${caption.aside ? `<p>${escapeHtml(caption.aside)}</p>` : ""}
    <dl><dt>${lastHeard ? "系統聽到的族語" : "你的族語描述"}</dt><dd>${escapeHtml(indigenous)}</dd></dl>`;
  ui.next.hidden = false;
  ui.retry.hidden = true;
}

function showResult(state, text) {
  ui.result.hidden = false;
  ui.result.dataset.state = state;
  ui.result.textContent = text;
}

ui.next.addEventListener("click", () => { if (answeredCount >= roundSize) answeredCount = 0; nextQuestion(); });

function resetQuiz() {
  selectedDialect = undefined;
  selectedLevel = undefined;
  pools = { beginner: [], intermediate: [] };
  records = [];
  deck = undefined;
  question = undefined;
  ui.quiz.hidden = true;
  ui.themes.hidden = true;
  ui.themeGrid.replaceChildren();
  ui.pictures.replaceChildren();
  clearRecording();
  ui.heard.hidden = true;
  ui.result.hidden = true;
}

function reduced() { return matchMedia("(prefers-reduced-motion: reduce)").matches; }
function escapeHtml(value) { const div = document.createElement("div"); div.textContent = value; return div.innerHTML; }

window.addEventListener("pagehide", () => { recorder?.clear(); });

init().catch((error) => {
  ui.api.textContent = `教材無法載入：${error.message}`;
  ui.api.dataset.state = "error";
});
