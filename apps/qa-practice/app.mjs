import { createQuestionDeck, createSingleFlight } from "../body-parts-practice/core.mjs";
import { DIALECTS, ETHNICITIES, dialectById } from "../body-parts-practice/dialects.mjs";
import { ASR_MODELS, asrModelFor, auditAsrModels, SLOW_HINT_AFTER_MS } from "../body-parts-speaking/asr.mjs";
import { judgeShortAnswerTranslation } from "../beginner-mock-exam/scoring.mjs";
import {
  convertToAsrWav, createRecorder, fetchLiveAsrDialects, supportsRecording, transcribe, translateToZh
} from "../beginner-mock-exam/recorder.mjs";
import { dialogueQuestions, qaVerdictLabel } from "./core.mjs";

const $ = (selector) => document.querySelector(selector);
const ui = {
  ethnicity: $("#ethnicity"), dialect: $("#dialect"), start: $("#start"), api: $("#api-status"),
  modelNote: $("#model-note"), quiz: $("#quiz"), label: $("#dialect-label"), progress: $("#progress"),
  replay: $("#replay"), audioState: $("#audio-state"), player: $("#player"), showZh: $("#show-zh"),
  zhHint: $("#zh-hint"), answer: $("#answer"), record: $("#record"), recordLabel: $("#record-label"),
  time: $("#record-time"), state: $("#record-state"), stateText: $("#record-state-text"),
  preview: $("#preview"), submit: $("#submit"), rerecord: $("#rerecord"), heard: $("#heard"),
  result: $("#result"), retry: $("#retry"), next: $("#next")
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

let selectedDialect, questions = [], question, deck, roundSize = 0, answeredCount = 0, pending = false;
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
    onState(state, blob) {
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
      if (blob) return;
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

function updateStart() { ui.start.disabled = !selectedDialect || !questions.length; }
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
  loadQuestions();
});

async function loadQuestions() {
  const dialect = selectedDialect;
  if (!dialect) return;
  ui.start.disabled = true;
  ui.api.textContent = "正在載入問句…";
  try {
    const response = await fetch(`/data/klokah-junior/dialects/${dialect.id}.json`);
    if (!response.ok) throw new Error("問句教材載入失敗");
    questions = dialogueQuestions(await response.json());
    if (selectedDialect !== dialect) return;
    ui.api.textContent = questions.length ? `● 已載入 ${questions.length} 句問句` : "△ 這個方言目前沒有可播放的問句";
    ui.api.dataset.state = questions.length ? "ok" : "fallback";
  } catch (error) {
    if (selectedDialect !== dialect) return;
    questions = [];
    ui.api.textContent = `問句教材無法載入：${error.message}`;
    ui.api.dataset.state = "error";
  }
  updateStart();
}

ui.start.addEventListener("click", () => {
  if (!questions.length) return;
  deck = createQuestionDeck(questions);
  roundSize = questions.length;
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
  ui.progress.textContent = `本輪 ${answeredCount} / ${roundSize}`;
  ui.zhHint.textContent = question.chineseText;
  ui.zhHint.hidden = !ui.showZh.checked;
  ui.answer.value = "";
  ui.heard.hidden = ui.result.hidden = ui.retry.hidden = ui.next.hidden = true;
  clearRecording();
  resetPromptAudio();
  const canRecord = supportsRecording() && asrStateFor(selectedDialect.ethnicity).usable;
  ui.record.disabled = !canRecord;
  updateSubmit();
  ui.answer.focus();
}

ui.showZh.addEventListener("change", () => { ui.zhHint.hidden = !ui.showZh.checked; });

function resetPromptAudio() {
  stopAudio();
  ui.replay.disabled = !question?.audioUrl;
  setAudioState(question?.audioUrl ? "idle" : "failed", question?.audioUrl ? "想聽再按播放" : "本題沒有音檔");
}

ui.replay.addEventListener("click", () => {
  if (!question?.audioUrl) return;
  ui.player.src = question.audioUrl;
  setAudioState("playing", "播放中…");
  const play = ui.player.play();
  if (play && typeof play.catch === "function") play.catch(() => setAudioState("failed", "無法播放，請再試一次"));
});

function stopAudio() {
  ui.player.pause();
  ui.player.removeAttribute("src");
  ui.player.load();
}

function setAudioState(state, text) {
  ui.audioState.dataset.state = state;
  ui.audioState.textContent = text;
}

ui.player.addEventListener("ended", () => setAudioState("ended", "播放結束"));
ui.player.addEventListener("error", () => setAudioState("failed", "音檔載入失敗"));

ui.record.addEventListener("click", async () => {
  if (recorder.recording) { recorder.stop(); return; }
  ui.player.pause();
  if (ui.audioState.dataset.state === "playing") setAudioState("ended", "已停止播放");
  try {
    await recorder.start();
  } catch (error) {
    const denied = error?.name === "NotAllowedError";
    setState("failed", denied ? "沒有麥克風權限" : "找不到可用的麥克風");
    showResult("undetermined", denied
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
      showResult("undetermined", `無法把這段錄音轉成辨識需要的格式（${error.message}），因此沒有送出任何資料。`);
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
      showResult("undetermined", `目前無法辨識（${error.message}），你的答案尚未被判錯。`);
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
  try {
    translation = await translateAnswer(indigenous);
  } catch (error) {
    showResult("undetermined", `目前無法完成判定（${error.message}），你的答案尚未被判錯。`);
    ui.retry.hidden = false;
    finishFlow();
    return;
  }

  const judged = judgeShortAnswerTranslation(question.chineseText, translation);
  renderResult(judged.verdict, { indigenous, translation });
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

function renderResult(verdict, { indigenous, translation }) {
  const title = qaVerdictLabel(verdict);
  const details = {
    reasonable: "系統認為這段回答有對到問句。",
    unreasonable: "系統還沒聽出和問句相關的意思。可以換個說法再試。",
    undetermined: "目前無法判定。你的答案尚未被判錯。"
  };
  ui.result.hidden = false;
  ui.result.dataset.state = verdict === "reasonable" ? "semantic" : verdict === "unreasonable" ? "retry" : "unavailable";
  ui.result.innerHTML = `<strong>${title}</strong><p>${details[verdict] || details.undetermined}</p>
    <dl><dt>${lastHeard ? "系統聽到的族語" : "你的族語回答"}</dt><dd>${escapeHtml(indigenous)}</dd>
    <dt>系統懂成</dt><dd>${escapeHtml(translation)}</dd></dl>`;
  ui.next.hidden = false;
  ui.retry.hidden = verdict === "undetermined";
}

function showResult(state, text) {
  ui.result.hidden = false;
  ui.result.dataset.state = state === "undetermined" ? "unavailable" : state;
  ui.result.textContent = text;
}

ui.next.addEventListener("click", () => { if (answeredCount >= roundSize) answeredCount = 0; nextQuestion(); });

function resetQuiz() {
  stopAudio();
  selectedDialect = undefined;
  questions = [];
  deck = undefined;
  question = undefined;
  ui.quiz.hidden = true;
  clearRecording();
  ui.heard.hidden = true;
  ui.result.hidden = true;
}

function reduced() { return matchMedia("(prefers-reduced-motion: reduce)").matches; }
function escapeHtml(value) { const div = document.createElement("div"); div.textContent = value; return div.innerHTML; }

window.addEventListener("pagehide", () => {
  stopAudio();
  recorder?.clear();
});

init().catch((error) => {
  ui.api.textContent = `教材無法載入：${error.message}`;
  ui.api.dataset.state = "error";
});
