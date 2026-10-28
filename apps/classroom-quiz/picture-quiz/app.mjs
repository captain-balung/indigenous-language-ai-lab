import { createSingleFlight, exactMatch, semanticMatch } from "../../basic-learning/body-parts-practice/core.mjs";
import { DIALECTS, ETHNICITIES, dialectById } from "../../basic-learning/body-parts-practice/dialects.mjs";
import { ASR_MODELS, asrModelFor, auditAsrModels, SLOW_HINT_AFTER_MS } from "../../basic-learning/body-parts-speaking/asr.mjs";
import { activeSemanticJudge } from "../../certification-mock/beginner-mock-exam/semantic-judge.mjs";
import {
  convertToAsrWav, createRecorder, fetchLiveAsrDialects, supportsRecording, transcribe, translateToZh
} from "../../certification-mock/beginner-mock-exam/recorder.mjs";
import { describeCaption, pictureTalkRecords } from "../../basic-learning/describe-practice/core.mjs";
import { ROUND_SIZE, draw, reportDetail, scoreLabel, tally } from "../meaning-sentence/core.mjs";
import { wireInputMode } from "../../shared/input-mode.mjs";

const $ = (selector) => document.querySelector(selector);
const ui = {
  ethnicity: $("#ethnicity"), dialect: $("#dialect"), start: $("#start"), api: $("#api-status"),
  modelNote: $("#model-note"), quiz: $("#quiz"), label: $("#dialect-label"), progress: $("#progress"),
  title: $("#question-title"), tip: $("#picture-tip"), pictures: $("#picture-grid"),
  answer: $("#answer"), record: $("#record"), recordLabel: $("#record-label"), time: $("#record-time"),
  state: $("#record-state"), stateText: $("#record-state-text"),
  submit: $("#submit"), result: $("#result"), retry: $("#retry"), next: $("#next"),
  report: $("#report"), score: $("#score-line"), list: $("#score-list"), again: $("#again"),
  inputModeToggle: $("#input-mode-toggle"), inputType: $("#input-type"), inputVoice: $("#input-voice")
};

const STATES = {
  idle: ["●", "尚未錄音"],
  recording: ["◉", "錄音中…再按一次停止"],
  recorded: ["■", "錄音完成，正在送出"],
  converting: ["◐", "轉檔中…"],
  transcribing: ["◍", "辨識中，請稍候"],
  slow: ["◍", "辨識中，長句需要較久，請不要重新整理"],
  failed: ["△", "這次沒有送出"]
};

let selectedDialect, pool = [], round = [], index = 0, results = [], question, pending = false;
let translationCodes = new Set(DIALECTS.map((item) => item.code));
let asrAudit = null, recorder = null, lastHeard = null, inputMode = null;

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
        ui.record.disabled = true;
        ui.recordLabel.textContent = "已錄音";
        setState("recorded");
        updateSubmit();
        runFlow();
      }
    },
    onTick(seconds) { ui.time.textContent = clock(seconds); }
  });
  inputMode = wireInputMode({
    root: ui.quiz,
    toggle: ui.inputModeToggle,
    typePanel: ui.inputType,
    voicePanel: ui.inputVoice,
    onModeChange(mode) {
      if (mode === "type") clearRecording();
      else ui.answer.value = "";
      updateSubmit();
    }
  });
  await verifyServices();
  if (!supportsRecording()) {
    ui.record.disabled = true;
    setState("failed", "這個瀏覽器不支援錄音，請切換為打字");
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
  notes.push("語意使用 vLLM AI 判別");
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
  ui.modelNote.textContent = usable
    ? `將使用「${ethnicity}」族級模型 ${model} 進行辨識。打字作答不經過語音辨識。`
    : `${ethnicity}目前無法使用語音辨識：${reason}。仍可打字作答。`;
}

function updateStart() { ui.start.disabled = !selectedDialect || !pool.length; }
function updateSubmit() {
  if (inputMode?.mode() === "voice") {
    ui.submit.hidden = true;
    ui.submit.disabled = true;
    return;
  }
  ui.submit.hidden = false;
  ui.submit.disabled = pending || !ui.answer.value.trim();
}

ui.ethnicity.addEventListener("change", () => {
  selectedDialect = undefined;
  pool = [];
  clearBoard();
  const choices = DIALECTS.filter((item) => item.ethnicity === ui.ethnicity.value);
  ui.dialect.innerHTML = `<option value="">請選擇方言別</option>${choices.map((item) => `<option value="${item.id}">${item.name}</option>`).join("")}`;
  ui.dialect.disabled = !choices.length;
  updateModelNote();
  updateStart();
});

ui.dialect.addEventListener("change", () => {
  clearBoard();
  selectedDialect = dialectById(ui.dialect.value);
  updateModelNote();
  loadPool();
});

async function loadPool() {
  const dialect = selectedDialect;
  pool = [];
  updateStart();
  if (!dialect) return;
  ui.api.textContent = "正在載入看圖說話…";
  try {
    const response = await fetch(`/data/klokah-junior/dialects/${dialect.id}.json`);
    if (!response.ok) throw new Error("初級看圖說話載入失敗");
    const junior = await response.json();
    if (selectedDialect !== dialect) return;
    pool = pictureTalkRecords(junior, {}).beginner.filter((item) => item.imageUrls.length > 1);
    ui.api.textContent = pool.length ? `● 已載入 ${pool.length} 題看圖說話` : "△ 這個方言目前沒有多圖題";
    ui.api.dataset.state = pool.length ? "ok" : "fallback";
  } catch (error) {
    if (selectedDialect !== dialect) return;
    ui.api.textContent = `題目無法載入：${error.message}`;
    ui.api.dataset.state = "error";
  }
  updateStart();
}

ui.start.addEventListener("click", () => {
  // ponytail: 每方言初級看圖說話只有 1 題。上限沿用課堂 8 題，題庫變多才湊滿，不重複同一題。
  round = draw(pool, ROUND_SIZE);
  if (!round.length) return;
  index = 0;
  results = [];
  ui.quiz.hidden = false;
  ui.report.hidden = true;
  showQuestion();
  ui.quiz.scrollIntoView({ behavior: reduced() ? "auto" : "smooth" });
});

function showQuestion() {
  question = round[index];
  pending = false;
  ui.label.textContent = `${selectedDialect.ethnicity} · ${selectedDialect.name} · 看圖說話`;
  ui.progress.textContent = `第 ${index + 1} / ${round.length} 題`;
  ui.title.textContent = "用自己的話描述這些圖";
  ui.tip.textContent = `中文提示：${question.tip}`;
  ui.pictures.dataset.count = String(question.imageUrls.length);
  ui.pictures.innerHTML = question.imageUrls.map((imageUrl, imageIndex) => `
    <figure>
      <img src="${escapeHtml(imageUrl)}" alt="看圖測驗圖片 ${imageIndex + 1}" referrerpolicy="no-referrer">
      <figcaption>圖片 ${imageIndex + 1}</figcaption>
    </figure>`).join("");
  ui.answer.value = "";
  ui.result.hidden = ui.retry.hidden = ui.next.hidden = true;
  clearRecording();
  ui.record.disabled = !(supportsRecording() && asrStateFor(selectedDialect.ethnicity).usable);
  ui.recordLabel.textContent = "開始錄音";
  updateSubmit();
}

function clearRecording() {
  lastHeard = null;
  recorder?.clear();
  ui.time.textContent = "00:00";
  setState("idle");
}

ui.answer.addEventListener("input", updateSubmit);
ui.submit.addEventListener("click", () => { runFlow(); });
ui.retry.addEventListener("click", () => { runFlow(); });

const runFlow = createSingleFlight(async () => {
  const typed = inputMode?.mode() === "type" ? ui.answer.value.trim() : "";
  const useVoice = inputMode?.mode() === "voice" && recorder?.blob;
  if (pending || (!typed && !useVoice)) return;
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
      showUnavailable(`無法把這段錄音轉成辨識需要的格式（${error.message}），因此沒有送出任何資料。`);
      return;
    }
    setState("transcribing");
    const slowHint = setTimeout(() => setState("slow"), SLOW_HINT_AFTER_MS);
    try {
      indigenous = await transcribe(wav, selectedDialect.ethnicity);
      lastHeard = indigenous;
    } catch (error) {
      clearTimeout(slowHint);
      setState("failed", "這次沒有辨識成功");
      showUnavailable(`目前無法辨識（${error.message}），你的答案尚未被判錯。`);
      return;
    }
    clearTimeout(slowHint);
  } else {
    lastHeard = null;
  }

  let translation;
  let matched = false;
  let pictureScore = null;
  let type = "retry";
  if (exactMatch(indigenous, question.indigenousText, selectedDialect.ethnicity)) {
    translation = question.chineseText;
    matched = true;
    type = "exact";
    pictureScore = { points: 10, maxPoints: 10, status: "scored", rationale: "與教材族語字面一致" };
  } else {
    try {
      translation = await translateAnswer(indigenous);
      pictureScore = await activeSemanticJudge.scorePictureTalk({
        tip: question.tip,
        referenceChinese: question.chineseText,
        referenceIndigenous: question.indigenousText,
        transcript: indigenous,
        translation,
        imageUrls: question.imageUrls,
        dialectCode: selectedDialect.code
      });
      matched = pictureScore?.status === "scored"
        ? (pictureScore.points ?? 0) >= 5
        : semanticMatch(translation, question.chineseText);
      type = matched ? "semantic" : "retry";
    } catch (error) {
      showUnavailable(`目前無法完成判定（${error.message}），你的答案尚未被判錯。`);
      return;
    }
  }

  results[index] = {
    type,
    heard: lastHeard || "",
    translation,
    rationale: pictureScore?.rationale,
    fallback: pictureScore?.fallback
  };
  const caption = describeCaption({ translation, matched, pictureScore });
  ui.result.hidden = false;
  ui.result.dataset.state = matched ? "semantic" : "retry";
  ui.result.innerHTML = `<strong>${caption.headline}</strong>
    <p class="heard-text">${escapeHtml(caption.translation)}</p>
    ${caption.aside ? `<p>${escapeHtml(caption.aside)}</p>` : ""}
    <dl><dt>${lastHeard ? "系統聽到的族語" : "你的族語描述"}</dt><dd>${escapeHtml(indigenous)}</dd></dl>`;
  ui.retry.hidden = true;
  ui.next.hidden = false;
  ui.next.textContent = index + 1 >= round.length ? "看本堂分數" : "下一題 →";
  pending = false;
});

function showUnavailable(text) {
  results[index] = undefined;
  ui.result.hidden = false;
  ui.result.dataset.state = "unavailable";
  ui.result.textContent = text;
  ui.retry.hidden = false;
  ui.retry.disabled = false;
  pending = false;
  ui.record.disabled = !(supportsRecording() && asrStateFor(selectedDialect.ethnicity).usable);
  ui.recordLabel.textContent = "開始錄音";
  updateSubmit();
}

async function translateAnswer(text) {
  if (!translationCodes.has(selectedDialect.code)) throw new Error("此方言目前沒有翻譯代碼");
  return translateToZh(text, selectedDialect.code);
}

ui.next.addEventListener("click", () => {
  index += 1;
  if (index >= round.length) showReport();
  else showQuestion();
});

function showReport() {
  ui.quiz.hidden = true;
  ui.report.hidden = false;
  const settled = results.map((item) => item ?? { type: "unavailable" });
  ui.score.textContent = scoreLabel(tally(settled));
  ui.list.innerHTML = settled.map((result, itemIndex) => {
    const label = result.type === "exact" || result.type === "semantic" ? "通過" : result.type === "retry" ? "未過" : "不計分";
    return `<li><strong>第 ${itemIndex + 1} 題 · 看圖測驗 · ${label}</strong><p>${escapeHtml(reportDetail(result))}</p></li>`;
  }).join("");
  ui.report.scrollIntoView({ behavior: reduced() ? "auto" : "smooth" });
}

ui.again.addEventListener("click", () => {
  clearBoard();
  updateStart();
});

function clearBoard() {
  round = [];
  results = [];
  question = undefined;
  ui.quiz.hidden = true;
  ui.report.hidden = true;
  ui.pictures.replaceChildren();
  clearRecording();
  ui.result.hidden = true;
}

function reduced() { return matchMedia("(prefers-reduced-motion: reduce)").matches; }
function escapeHtml(value) { const div = document.createElement("div"); div.textContent = value ?? ""; return div.innerHTML; }

window.addEventListener("pagehide", () => { recorder?.clear(); });
init().catch((error) => {
  ui.api.textContent = `教材無法載入：${error.message}`;
  ui.api.dataset.state = "error";
});
