/**
 * 中級模擬站 · 頁面控制（練習導向）
 *
 * 兩條規則貫穿整個檔案：
 *   1. 作答過程不顯示對錯／分數；評分寫入 responses，整卷結束（或按結束練習）才進結果頁。
 *      聽力題作答前不渲染族語文字（選擇題(三)除外：選項本身就是拼寫）。
 *   2. 任何服務失敗都不會判使用者答錯：音檔失敗 → notScored，辨識失敗 → undetermined。
 */

import { DIALECTS, ETHNICITIES, dialectById } from "../../basic-learning/body-parts-practice/dialects.mjs";
import { createSingleFlight } from "../../basic-learning/body-parts-practice/core.mjs";
import { ASR_MODELS, asrModelFor, auditAsrModels, SLOW_HINT_AFTER_MS } from "../../basic-learning/body-parts-speaking/asr.mjs";
import { createPaper, flattenPaper, randomSeed, paperIdToSeed } from "./paper.mjs";
import { gradePaper, PICTURE_TALK_MAX_POINTS } from "./scoring.mjs";
import { activeSemanticJudge } from "./semantic-judge.mjs";
import { supportsRecording, createRecorder, convertToAsrWav, transcribe, translateToZh, fetchLiveAsrDialects } from "./recorder.mjs";

const $ = (selector) => document.querySelector(selector);
const ui = {
  ethnicity: $("#ethnicity"), dialect: $("#dialect"), start: $("#start"),
  apiStatus: $("#api-status"), modelNote: $("#model-note"),
  setup: $(".setup"), quiz: $("#quiz"), report: $("#report"),
  paperLabel: $("#paper-label"), progress: $("#progress"),
  sectionTitle: $("#section-title"), instruction: $("#instruction"), adaptation: $("#adaptation"),
  questionTitle: $("#question-title"),
  play: $("#play"), replay: $("#replay"), audioState: $("#audio-state"), player: $("#player"),
  promptChinese: $("#prompt-chinese"), promptFallback: $("#prompt-fallback"),
  promptFigure: $("#prompt-figure"), promptImage: $("#prompt-image"),
  options: $("#options"), optionsLegend: $("#options-legend"),
  speakPanel: $("#speak-panel"), speakWord: $("#speak-word"), speakGloss: $("#speak-gloss"), speakHint: $("#speak-hint"),
  pictureTip: $("#picture-tip"), pictureGrid: $("#picture-grid"),
  record: $("#record"), recordLabel: $("#record-label"), recordTime: $("#record-time"),
  recordState: $("#record-state"), recordStateText: $("#record-state-text"),
  heard: $("#heard"),
  feedback: $("#feedback"),
  prev: $("#prev"), next: $("#next"), confirm: $("#confirm"), endPractice: $("#end-practice"),
  answeredCount: $("#answered-count"),
  scoreSummary: $("#score-summary"), reviewList: $("#review-list"), reportTitle: $("#report-title"),
  restart: $("#restart"),
};

const DATA_ROOT = "/data/klokah-senior";
const REPLAY_GAP_MS = 800;
const AUDIO_STALL_MS = 15_000;
/** 聽力點選後先讓選中樣式可見，再進下一題。 */
const SELECT_ADVANCE_MS = 480;

const LISTENING_LEGENDS = {
  trueFalse: "聽到的句子與圖片相符嗎？",
  choiceOne: "選出與聽到的內容相符的圖片",
  choiceTwo: "哪一句族語與上面的中文語意最接近？",
  choiceThree: "哪一個拼寫是你聽到的句子？",
};

const escapeHtml = (value) => {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
};
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let unavailableEthnicities = new Set();
let selectedDialect = null;
let paper = null;
let flat = [];
let index = 0;
let responses = {};
let recorder = null;
let recordedBlob = null;
let pendingSelectAdvance = null;

/* ══════════ STEP 1：語別與服務狀態 ══════════ */

ui.ethnicity.innerHTML = '<option value="">請選擇語言別</option>' +
  ETHNICITIES.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");

ui.ethnicity.addEventListener("change", () => {
  const list = DIALECTS.filter((dialect) => dialect.ethnicity === ui.ethnicity.value);
  ui.dialect.disabled = list.length === 0;
  ui.dialect.innerHTML = list.length
    ? '<option value="">請選擇方言別</option>' + list.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join("")
    : '<option value="">請先選擇語言別</option>';
  ui.start.disabled = true;
  renderModelNote();
});

ui.dialect.addEventListener("change", () => {
  selectedDialect = dialectById(ui.dialect.value) ?? null;
  ui.start.disabled = !selectedDialect;
  renderModelNote();
});

function renderModelNote() {
  const ethnicity = ui.ethnicity.value;
  if (!ethnicity) { ui.modelNote.textContent = ""; ui.modelNote.removeAttribute("data-blocked"); return; }
  const model = asrModelFor(ethnicity);
  if (!model) {
    ui.modelNote.textContent = `${ethnicity}：教材有，但沒有對應的辨識模型；口說三部分這次會顯示為「無法判定」，聽力不受影響。`;
    ui.modelNote.dataset.blocked = "true";
    return;
  }
  if (unavailableEthnicities.has(ethnicity)) {
    ui.modelNote.textContent = `${ethnicity}：辨識服務目前沒有提供 ${model}；口說仍可錄音與回放，但結果會是「無法判定」，聽力不受影響。`;
    ui.modelNote.dataset.blocked = "true";
    return;
  }
  ui.modelNote.textContent = `${ethnicity}：辨識時送出族級模型 ${model}。`;
  ui.modelNote.removeAttribute("data-blocked");
}

// 聽力半場完全不依賴 ASR，所以無論服務狀態如何都不停用「開始」。
(async function bootstrap() {
  if (!supportsRecording()) {
    ui.apiStatus.textContent = "這個瀏覽器不支援錄音，口說三部分會顯示為未作答；聽力四部分仍可正常作答。";
    ui.apiStatus.dataset.state = "fallback";
    return;
  }
  const live = await fetchLiveAsrDialects();
  if (!live) {
    ui.apiStatus.textContent = "目前無法確認語音辨識服務，先以內建的 16 族模型對照表進行；聽力四部分不受影響。";
    ui.apiStatus.dataset.state = "fallback";
    return;
  }
  const audit = auditAsrModels(ASR_MODELS, live);
  unavailableEthnicities = new Set(audit.unavailable.map((entry) => entry.ethnicity));
  if (audit.unknownFromApi.length) {
    console.warn("[ASR] 服務提供了對照表沒有的模型：", audit.unknownFromApi.map((entry) => entry.model).join("、"));
  }
  if (audit.consistent) {
    ui.apiStatus.textContent = `語音辨識服務正常，16 個族級模型都可用。`;
    ui.apiStatus.dataset.state = "ok";
  } else {
    ui.apiStatus.textContent = `語音辨識服務目前有 ${audit.unavailable.length} 個族級模型不可用；受影響的語言別在口說會顯示「無法判定」，聽力不受影響。`;
    ui.apiStatus.dataset.state = "fallback";
  }
  renderModelNote();
})();

/* ══════════ 開卷 ══════════ */

ui.start.addEventListener("click", () => { startExam(); });

const startExam = createSingleFlight(async () => {
  if (!selectedDialect) return;
  ui.start.disabled = true;
  ui.start.textContent = "正在準備題目…";
  try {
    const response = await fetch(`${DATA_ROOT}/dialects/${selectedDialect.id}.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const shard = await response.json();

    const requested = new URLSearchParams(location.search).get("paper");
    const seed = paperIdToSeed(requested) ?? randomSeed();

    paper = createPaper({ shard, dialect: selectedDialect, seed });
    flat = flattenPaper(paper);
    index = 0;
    responses = {};

    ui.setup.hidden = true;
    ui.report.hidden = true;
    ui.quiz.hidden = false;
    ui.paperLabel.textContent = `${selectedDialect.name}　練習編號 ${paper.paperId}`;
    renderQuestion();
  } catch (error) {
    ui.apiStatus.textContent = `無法載入這個方言別的教材（${error.message}）。請稍後再試，或換一個方言別。`;
    ui.apiStatus.dataset.state = "fallback";
  } finally {
    ui.start.textContent = "產生題目並開始練習";
    ui.start.disabled = !selectedDialect;
  }
});

/* ══════════ 音檔播放 ══════════ */

let stallTimer = null;
let pendingReplay = null;
/** 目前這次 playTwice 的完成回呼；換題或重播清掉音檔時也要觸發，避免按鈕卡死。 */
let pendingPlayComplete = null;

function setAudioState(state, text) {
  ui.audioState.dataset.state = state;
  ui.audioState.textContent = text;
}

function clearAudio() {
  if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
  if (pendingReplay) { clearTimeout(pendingReplay); pendingReplay = null; }
  ui.player.pause();
  ui.player.removeAttribute("src");
  ui.player.load();
  const complete = pendingPlayComplete;
  pendingPlayComplete = null;
  complete?.();
}

/**
 * 播兩遍，比照官方「每題播出兩遍」。
 * klokah 不送 CORS 標頭，所以讀不到 HTTP 狀態，只能靠 error 事件與 stall 看門狗；
 * 也因此絕對不能用 fetch() 去取這些音檔。
 * @param {string} url
 * @param {{ onComplete?: () => void }} [options] 兩遍播完、失敗、或被中斷時呼叫一次
 */
function playTwice(url, options = {}) {
  clearAudio();
  pendingPlayComplete = typeof options.onComplete === "function" ? options.onComplete : null;
  setAudioState("loading", "載入音檔中…");
  ui.player.src = url;

  let played = 0;
  const settle = () => {
    const complete = pendingPlayComplete;
    pendingPlayComplete = null;
    complete?.();
  };
  const fail = () => {
    cleanup();
    handleAudioFailure();
    settle();
  };
  const onEnded = () => {
    played += 1;
    if (played === 1) {
      setAudioState("playing", "第二遍…");
      pendingReplay = setTimeout(() => {
        pendingReplay = null;
        ui.player.currentTime = 0;
        ui.player.play().catch(fail);
      }, reduced() ? 0 : REPLAY_GAP_MS);
      return;
    }
    if (pendingReplay) { clearTimeout(pendingReplay); pendingReplay = null; }
    cleanup();
    setAudioState("idle", "播放完畢（已播兩遍）");
    settle();
  };
  const onPlaying = () => {
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    setAudioState("playing", played === 0 ? "第一遍…" : "第二遍…");
  };
  const cleanup = () => {
    ui.player.removeEventListener("ended", onEnded);
    ui.player.removeEventListener("playing", onPlaying);
    ui.player.removeEventListener("error", fail);
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
  };

  ui.player.addEventListener("ended", onEnded);
  ui.player.addEventListener("playing", onPlaying);
  ui.player.addEventListener("error", fail);
  // 請求卡住時不會有任何事件，所以額外設一個看門狗。
  stallTimer = setTimeout(() => { fail(); }, AUDIO_STALL_MS);

  ui.player.play().catch(fail);
}

function handleAudioFailure() {
  if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
  if (pendingReplay) { clearTimeout(pendingReplay); pendingReplay = null; }
  ui.player.pause();
  ui.player.removeAttribute("src");
  ui.player.load();
  setAudioState("failed", "音檔載入失敗");
  const { question } = flat[index] ?? {};
  if (!question) return;
  const response = (responses[question.id] ??= {});
  response.audioFailed = true;
  revealFallbackText(question);
  updateConfirmButton();
  // 無法改以文字作答的聽力題：沒有可點選項，直接標記不計分並前進。
  if (question.revealOnAudioFailure === false) confirmCurrent();
}

// 音檔載不出來時揭露族語文字，讓題目還是答得下去；這一題同時被標成不計分。
// 選擇題(三) 與選擇題(二) 例外：那兩節的族語文字（或就是選項本身、或本來就只能用聽的）
// 一揭露就等於給答案，所以只說明本題不計分，不揭露任何文字。
function revealFallbackText(question) {
  const text = question.prompt.indigenousText;
  if (question.revealOnAudioFailure === false || !text) {
    ui.promptFallback.innerHTML =
      "這題的音檔載入失敗。這一節必須用聽的才能作答，所以不改以文字呈現，<b>本題不計分</b>。";
    ui.promptFallback.hidden = false;
    return;
  }
  ui.promptFallback.innerHTML =
    `這題的音檔載入失敗，改以文字呈現，<b>本題不計分</b>。<span class="revealed">${escapeHtml(text)}</span>`;
  ui.promptFallback.hidden = false;
}

function markPromptPlayDone(question) {
  if (flat[index]?.question.id !== question.id) return;
  syncPromptPlayButtons(question);
  setAudioState("idle", "播放完畢（已播兩遍）");
}

ui.play.addEventListener("click", () => {
  const { question } = flat[index];
  const url = question.prompt.audioUrl;
  if (!url || responses[question.id]?.playedInitial) return;
  const response = (responses[question.id] ??= {});
  response.playedInitial = true;
  ui.play.disabled = true;
  ui.replay.hidden = true;
  // 正式測驗每題只播兩遍：一次「播放兩遍」後不可再聽。
  playTwice(url, { onComplete: () => markPromptPlayDone(question) });
});

/* ══════════ 渲染題目 ══════════ */

function isConfirmed(questionId) {
  return responses[questionId]?.confirmed === true;
}

function syncPromptPlayButtons(question) {
  const hasAudio = Boolean(question.prompt.audioUrl);
  ui.play.hidden = !hasAudio;
  ui.audioState.hidden = !hasAudio;
  // 作答中不提供「再聽一次」：每題題幹音檔只播兩遍。
  ui.replay.hidden = true;
  ui.replay.disabled = true;
  if (!hasAudio) return;
  const started = responses[question.id]?.playedInitial === true;
  ui.play.disabled = started;
}

function clearPendingSelectAdvance() {
  if (pendingSelectAdvance) {
    clearTimeout(pendingSelectAdvance);
    pendingSelectAdvance = null;
  }
}

function renderQuestion() {
  clearPendingSelectAdvance();
  clearAudio();
  clearRecording({ keepHeard: false });

  const { section, question } = flat[index];
  const isSpeaking = section.part === "speaking";
  const partLabel = isSpeaking ? "口說" : "聽力";
  const confirmed = isConfirmed(question.id);

  ui.sectionTitle.textContent = section.title;
  ui.instruction.textContent = section.instruction;
  ui.adaptation.textContent = section.adaptationNote;
  ui.adaptation.hidden = !section.adaptationNote?.trim();

  ui.progress.textContent = `${partLabel} ${section.title.replace(/^.*：/, "")} ${question.no} / ${section.questions.length}　·　全卷 ${index + 1} / ${paper.totalQuestions}`;
  ui.questionTitle.textContent = `第 ${index + 1} 題`;

  ui.promptFallback.hidden = true;
  ui.promptChinese.hidden = true;
  ui.promptFigure.hidden = true;
  ui.heard.hidden = true;
  ui.feedback.hidden = true;
  ui.feedback.removeAttribute("data-status");
  ui.feedback.innerHTML = "";

  syncPromptPlayButtons(question);
  if (question.prompt.audioUrl) {
    const response = responses[question.id] ?? {};
    setAudioState("idle", response.playedInitial ? "播放完畢（已播兩遍）" : "尚未播放");
  }

  // 之前就已經確定音檔壞掉的題目，回頭時要保留那個狀態。
  if (responses[question.id]?.audioFailed) revealFallbackText(question);

  if (isSpeaking) renderSpeaking(section, question);
  else renderListening(section, question);

  if (confirmed) {
    ui.heard.hidden = false;
    ui.heard.innerHTML = "<strong>已記錄作答</strong><small>整卷結束後才會顯示評分與說明。</small>";
  }

  ui.prev.disabled = index === 0;
  ui.next.disabled = index === flat.length - 1;
  updateConfirmButton();
  updateAnsweredCount();
  ui.questionTitle.focus();
}

function renderListening(section, question) {
  ui.speakPanel.hidden = true;
  ui.options.hidden = false;

  if (question.prompt.chineseText && section.id === "choiceTwo") {
    ui.promptChinese.textContent = question.prompt.chineseText;
    ui.promptChinese.hidden = false;
  }
  if (question.prompt.imagePath) {
    ui.promptImage.src = `${DATA_ROOT}/${question.prompt.imagePath}`;
    // 刻意留空：寫出圖片內容等於直接洩漏答案。頁面已在 STEP 1 揭露這個限制。
    ui.promptImage.alt = "";
    ui.promptFigure.hidden = false;
  }

  const layout = section.id === "trueFalse"
    ? "binary"
    : section.id === "choiceTwo"
      ? "audio"
      : section.id === "choiceThree"
        ? "text"
        : "images";
  ui.optionsLegend.textContent = LISTENING_LEGENDS[section.id];

  const chosen = responses[question.id]?.choice ?? responses[question.id]?.draftChoice ?? null;
  // 聽力可回頭改選；已確認的題仍顯示先前選項，但不鎖死。
  const cards = question.options.map((option) => {
    const id = `opt-${question.id}-${option.key}`;
    const checked = chosen === option.key ? " checked" : "";
    if (layout === "binary") {
      return `<div class="option option--binary">
        <input type="radio" id="${id}" name="answer" value="${option.key}"${checked}>
        <label for="${id}">${escapeHtml(option.label)}</label>
      </div>`;
    }
    if (layout === "text") {
      // 這一節的族語拼寫必須在作答前顯示——選項就是題目。
      return `<div class="option option--text">
        <input type="radio" id="${id}" name="answer" value="${option.key}"${checked}>
        <label for="${id}">
          <span class="option-key">選項 ${escapeHtml(option.key)}</span>
          <span class="option-ab">${escapeHtml(option.indigenousText)}</span>
        </label>
      </div>`;
    }
    if (layout === "audio") {
      const optionPlayed = responses[question.id]?.optionPlayed?.[option.key] === true;
      const playDisabled = optionPlayed ? " disabled" : "";
      return `<div class="option option--audio">
        <input type="radio" id="${id}" name="answer" value="${option.key}"${checked}>
        <label for="${id}">選項 ${escapeHtml(option.key)}</label>
        <button type="button" class="option-play" data-option-key="${escapeHtml(option.key)}" data-audio="${escapeHtml(option.audioUrl)}"${playDisabled}>▶ 播放選項 ${escapeHtml(option.key)}（兩遍）</button>
      </div>`;
    }
    return `<div class="option option--image">
      <label for="${id}">
        <img src="${DATA_ROOT}/${escapeHtml(option.imagePath)}" alt="">
        <span class="option-key">圖片 ${escapeHtml(option.key)}</span>
      </label>
      <input type="radio" id="${id}" name="answer" value="${option.key}"${checked}>
    </div>`;
  }).join("");

  ui.options.innerHTML = `<legend id="options-legend">${escapeHtml(ui.optionsLegend.textContent)}</legend>
    <div class="options-grid" data-layout="${layout}">${cards}</div>`;

  ui.options.querySelectorAll('input[name="answer"]').forEach((input) => {
    input.addEventListener("change", () => {
      const response = (responses[question.id] ??= {});
      response.draftChoice = input.value;
      if (isConfirmed(question.id)) {
        // 上一題回頭改選：只更新紀錄，不自動跳下一題。
        response.choice = input.value;
        updateAnsweredCount();
        return;
      }
      // 先鎖住選項，讓 :checked 樣式明顯可見，再送出並進下一題。
      ui.options.querySelectorAll('input[name="answer"]').forEach((el) => { el.disabled = true; });
      clearPendingSelectAdvance();
      const questionId = question.id;
      const delay = reduced() ? 0 : SELECT_ADVANCE_MS;
      pendingSelectAdvance = setTimeout(() => {
        pendingSelectAdvance = null;
        if (flat[index]?.question.id !== questionId) return;
        confirmCurrent();
      }, delay);
    });
  });
  // 播放鈕在 label 外面，點它不會選中該選項；每個選項音檔也只播兩遍一次。
  ui.options.querySelectorAll(".option-play").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.optionKey;
      const response = (responses[question.id] ??= {});
      response.optionPlayed ??= {};
      if (response.optionPlayed[key]) return;
      response.optionPlayed[key] = true;
      button.disabled = true;
      playTwice(button.dataset.audio);
    });
  });
}

function renderSpeaking(section, question) {
  ui.options.hidden = true;
  ui.options.innerHTML = "";
  ui.speakPanel.hidden = false;
  ui.pictureTip.hidden = true;
  ui.pictureGrid.hidden = true;
  ui.pictureGrid.innerHTML = "";

  if (section.id === "sentenceReading") {
    ui.speakWord.textContent = question.prompt.indigenousText;
    ui.speakWord.hidden = false;
    ui.speakGloss.textContent = `（${question.prompt.chineseText}）`;
    ui.speakGloss.hidden = false;
    ui.speakHint.textContent = "請按下錄音，照著上面的族語句子念出來。停止錄音後會自動辨識並記錄；整卷結束才顯示評分。教材錄音在結果頁提供。";
  } else if (section.id === "pictureTalk") {
    ui.speakWord.hidden = true;
    ui.speakGloss.hidden = true;
    ui.pictureTip.hidden = false;
    ui.pictureTip.textContent = `中文提示：${question.prompt.tip}`;
    ui.pictureGrid.hidden = false;
    // 高中版每題只有一張圖，多張時仍然逐張編號。
    const pictures = question.prompt.imageUrls;
    ui.pictureGrid.innerHTML = pictures.map((imageUrl, index) => `
      <figure>
        <img src="${escapeHtml(imageUrl)}" alt="" referrerpolicy="no-referrer">
        <figcaption>${pictures.length > 1 ? `圖片 ${index + 1}` : "本題圖片"}</figcaption>
      </figure>`).join("");
    ui.speakHint.textContent = "看著圖與中文提示，用族語簡短說說你的想法。停止錄音後會自動辨識並記錄；整卷結束才顯示評分（滿分 10 分）。";
  } else {
    ui.speakWord.hidden = true;
    ui.speakGloss.hidden = true;
    ui.speakHint.textContent = "請先播放族語問句，再按下錄音，用族語回答。停止錄音後會自動辨識並記錄；整卷結束才顯示評分。";
  }

  const canRecord = supportsRecording() && !isConfirmed(question.id);
  ui.record.disabled = !canRecord;
  if (!supportsRecording()) setRecordState("failed", "這個瀏覽器不支援錄音");
}

function advanceAfterConfirm() {
  if (index < flat.length - 1) {
    index += 1;
    renderQuestion();
    return;
  }
  showReport();
}

function updateConfirmButton() {
  if (!flat[index]) { ui.confirm.disabled = true; ui.confirm.hidden = true; return; }
  // 聽力點選即送、口說停錄即送，確定鈕一律隱藏。
  ui.confirm.hidden = true;
  ui.confirm.disabled = true;
}
function updateAnsweredCount() {
  const listeningIds = paper.listening.flatMap((section) => section.questions.map((q) => q.id));
  const speakingTotal = paper.speaking.reduce((sum, section) => sum + section.questions.length, 0);
  const answered = listeningIds.filter((id) => responses[id]?.confirmed).length;
  const attempted = paper.speaking.flatMap((s) => s.questions).filter((q) => responses[q.id]?.confirmed).length;
  ui.answeredCount.textContent = `口說已確定 ${attempted} / ${speakingTotal}　·　聽力已確定 ${answered} / 20`;
}

/* ══════════ 導覽與確定 ══════════ */

ui.prev.addEventListener("click", () => { if (index > 0) { index -= 1; renderQuestion(); } });
ui.next.addEventListener("click", () => { if (index < flat.length - 1) { index += 1; renderQuestion(); } });

ui.confirm.addEventListener("click", () => { confirmCurrent(); });

const confirmCurrent = createSingleFlight(async () => {
  const { section, question } = flat[index];
  if (isConfirmed(question.id)) return;

  if (section.part === "listening") {
    confirmListening(section, question);
    return;
  }
  await confirmSpeaking(section, question);
});

function confirmListening(section, question) {
  const response = (responses[question.id] ??= {});
  if (response.draftChoice == null && response.choice == null && !response.audioFailed) return;
  if (response.choice == null && response.draftChoice != null) response.choice = response.draftChoice;
  response.confirmed = true;
  updateConfirmButton();
  updateAnsweredCount();
  advanceAfterConfirm();
}

async function confirmSpeaking(section, question) {
  if (!recordedBlob) return;
  const response = (responses[question.id] ??= {});
  response.attempted = true;
  ui.confirm.disabled = true;
  ui.record.disabled = true;

  let wav;
  setRecordState("converting");
  try {
    wav = await convertToAsrWav(recordedBlob);
  } catch (error) {
    // 轉成 WAV 失敗絕不靜默送出原始錄音——那正是辨識不準的來源。
    setRecordState("failed", "轉檔失敗，沒有送出");
    response.transcript = null;
    response.asrError = error.message;
    if (section.id === "pictureTalk") {
      response.translation = null;
      response.pictureScore = { points: null, maxPoints: PICTURE_TALK_MAX_POINTS, ratio: null, status: "undetermined" };
    }
    if (section.id === "shortAnswer") {
      response.translation = null;
      response.shortVerdict = "undetermined";
      response.shortPoints = null;
    }
    response.confirmed = true;
    updateConfirmButton();
    updateAnsweredCount();
    advanceAfterConfirm();
    return;
  }

  setRecordState("transcribing");
  const slowHint = setTimeout(() => setRecordState("slow"), SLOW_HINT_AFTER_MS);
  try {
    const heard = await transcribe(wav, selectedDialect.ethnicity, { unavailable: unavailableEthnicities });
    response.transcript = heard;
    response.asrError = null;

    if (section.id === "pictureTalk" || section.id === "shortAnswer") {
      setRecordState("transcribing", "翻譯與評分中");
      try {
        const translation = await translateToZh(heard, selectedDialect.code);
        response.translation = translation;
        response.translateError = null;
        if (section.id === "pictureTalk") {
          response.pictureScore = await activeSemanticJudge.scorePictureTalk({
            tip: question.prompt.tip,
            referenceChinese: question.reference.chineseText,
            referenceIndigenous: question.reference.indigenousText,
            transcript: heard,
            translation,
            imageUrls: question.prompt.imageUrls,
            dialectCode: selectedDialect.code,
          });
        } else {
          const judged = await activeSemanticJudge.judgeShortAnswer({
            questionChinese: question.prompt.chineseText,
            questionIndigenous: question.prompt.indigenousText,
            transcript: heard,
            translation,
            dialectCode: selectedDialect.code,
          });
          response.shortVerdict = judged.verdict;
          response.shortPoints = judged.points ?? null;
          response.shortRationale = judged.rationale ?? null;
        }
      } catch (error) {
        response.translation = null;
        response.translateError = error.message;
        if (section.id === "pictureTalk") {
          response.pictureScore = { points: null, maxPoints: PICTURE_TALK_MAX_POINTS, ratio: null, status: "undetermined" };
        } else {
          response.shortVerdict = "undetermined";
          response.shortPoints = null;
        }
      }
    }
    setRecordState("recorded", "辨識完成");
  } catch (error) {
    response.transcript = null;
    response.asrError = error.message;
    if (section.id === "pictureTalk") {
      response.translation = null;
      response.pictureScore = { points: null, maxPoints: PICTURE_TALK_MAX_POINTS, ratio: null, status: "undetermined" };
    }
    if (section.id === "shortAnswer") {
      response.translation = null;
      response.shortVerdict = "undetermined";
      response.shortPoints = null;
    }
    setRecordState("failed", "這次沒有辨識成功");
  } finally {
    clearTimeout(slowHint);
    response.confirmed = true;
    updateConfirmButton();
    updateAnsweredCount();
    advanceAfterConfirm();
  }
}

ui.endPractice.addEventListener("click", () => { showReport(); });

ui.restart.addEventListener("click", () => {
  clearAudio();
  clearRecording();
  paper = null;
  flat = [];
  responses = {};
  ui.report.hidden = true;
  ui.quiz.hidden = true;
  ui.setup.hidden = false;
  ui.start.focus();
});

/* ══════════ 錄音與辨識 ══════════ */

const RECORD_STATES = {
  idle: ["●", "尚未錄音"],
  recording: ["■", "錄音中，再按一次停止"],
  recorded: ["✓", "已錄音，正在送出"],
  converting: ["⋯", "轉檔中"],
  transcribing: ["⋯", "辨識中"],
  slow: ["⋯", "還在辨識，請再等一下"],
  failed: ["!", "這次沒有成功"],
};

function setRecordState(state, text) {
  const [icon, fallback] = RECORD_STATES[state] ?? RECORD_STATES.idle;
  ui.recordState.dataset.state = state;
  ui.recordState.querySelector(".record-state__icon").textContent = icon;
  ui.recordStateText.textContent = text ?? fallback;
}

function clearRecording({ keepHeard = false } = {}) {
  recorder?.clear();
  recorder = null;
  recordedBlob = null;
  ui.record.classList.remove("is-recording");
  ui.recordLabel.textContent = "開始錄音";
  ui.recordTime.textContent = "00:00";
  if (!keepHeard) ui.heard.hidden = true;
  setRecordState("idle");
}

ui.record.addEventListener("click", async () => {
  const { question } = flat[index] ?? {};
  if (question && isConfirmed(question.id)) return;
  if (recorder?.recording) { recorder.stop(); return; }
  if (recordedBlob) return;
  recorder = createRecorder({
    onState: (state, blob) => {
      if (state === "recording") {
        ui.record.classList.add("is-recording");
        ui.recordLabel.textContent = "停止錄音";
        setRecordState("recording");
      } else if (state === "recorded") {
        recordedBlob = blob;
        ui.record.classList.remove("is-recording");
        ui.record.disabled = true;
        ui.recordLabel.textContent = "已錄音";
        setRecordState("recorded");
        updateConfirmButton();
        confirmCurrent();
      }
    },
    onTick: (seconds) => {
      ui.recordTime.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    },
  });
  try {
    await recorder.start();
  } catch (error) {
    const denied = error?.name === "NotAllowedError";
    setRecordState("failed", denied ? "沒有麥克風權限" : "找不到可用的麥克風");
    ui.heard.hidden = false;
    ui.heard.innerHTML = denied
      ? "<strong>無法錄音</strong><small>瀏覽器沒有給這個頁面麥克風權限。你可以在網址列的權限設定允許麥克風後重試；聽力四部分不需要麥克風，仍可正常作答。</small>"
      : "<strong>無法錄音</strong><small>找不到可用的麥克風。聽力四部分不需要麥克風，仍可正常作答。</small>";
  }
});

/* ══════════ 成績單 ══════════ */

/** 聽力答題紀錄：列出全部選項，在選項上標正解／你的作答。 */
function renderListeningReviewOptions(entry) {
  const options = entry.options ?? [];
  if (!options.length) return "";
  const rows = options.map((option) => {
    const isAnswer = option.key === entry.answerKey;
    const isYours = entry.yourKey != null && option.key === entry.yourKey;
    let mark = "";
    let state = "neutral";
    if (isAnswer && isYours) {
      mark = "正解 · 你的作答";
      state = "correct";
    } else if (isAnswer) {
      mark = "正解";
      state = "correct";
    } else if (isYours) {
      mark = "你的作答";
      state = "wrong";
    }
    let body = "";
    if (option.label) body = escapeHtml(option.label);
    else if (option.imagePath) {
      body = `<img src="${DATA_ROOT}/${escapeHtml(option.imagePath)}" alt=""><span class="review-option-key">圖片 ${escapeHtml(option.key)}</span>`;
    } else if (option.indigenousText) {
      body = `<span class="review-option-key">選項 ${escapeHtml(option.key)}</span><span class="ab">${escapeHtml(option.indigenousText)}</span>`;
    } else if (option.audioUrl) {
      body = `<span class="review-option-key">選項 ${escapeHtml(option.key)}</span>`;
    } else {
      body = escapeHtml(option.key);
    }
    return `<li class="review-option" data-state="${state}">
      <div class="review-option-body">${body}</div>
      ${mark ? `<span class="review-option-mark">${mark}</span>` : ""}
      ${option.audioUrl ? `<button type="button" class="replay" data-audio="${escapeHtml(option.audioUrl)}">▶ 播放</button>` : ""}
    </li>`;
  }).join("");
  return `<ul class="review-options">${rows}</ul>`;
}

function showReport() {
  clearAudio();
  clearRecording();
  const report = gradePaper(paper, responses);

  ui.quiz.hidden = true;
  ui.report.hidden = false;

  const listening = report.listening;
  const accuracy = listening.accuracy === null ? null : Math.round(listening.accuracy * 100);
  const sentence = report.speaking.sentenceReading;
  const short = report.speaking.shortAnswer;
  const picture = report.speaking.pictureTalk;

  const practice = report.practice;
  ui.scoreSummary.innerHTML = `
    <div class="score-total">
      <strong>本次練習得分</strong>
      <p class="score-big">${practice.total} / ${practice.totalMax}</p>
      <p class="score-note">口說 ${practice.speaking} / ${practice.speakingMax}　·　聽力 ${practice.listening} / ${practice.listeningMax}</p>
    </div>
    <ul class="score-breakdown">
      <li><span>口說 · 單句朗讀</span><strong>${sentence.pointsSum} / ${sentence.maxPointsSum}</strong></li>
      <li><span>口說 · 問答題</span><strong>${short.pointsSum} / ${short.maxPointsSum}</strong></li>
      <li><span>口說 · 看圖表達</span><strong>${picture.pointsSum} / ${picture.maxPointsSum}</strong></li>
      <li>
        <span>聽力${accuracy === null ? "" : `（正確率 ${accuracy}%）`}</span>
        <strong>${listening.pointsSum} / ${listening.maxPointsSum}</strong>
      </li>
    </ul>`;

  const statusLabel = {
    correct: "答對", wrong: "答錯", unanswered: "未作答", notScored: "音檔失敗·不計分",
    matched: "與教材拼寫幾乎完全重疊", partial: "與教材拼寫部分重疊", mismatched: "與教材拼寫重疊很少",
    undetermined: "無法判定", skipped: "未作答",
    transcribed: "已錄下", scored: "已評分", reasonable: "合理", unreasonable: "不合理",
  };

  const listeningBlocks = listening.bySection.map((section) => {
    const items = section.review.map((entry) => `
      <div class="review-item" data-status="${entry.status}">
        <h4>第 ${entry.no} 題　${statusLabel[entry.status]}　·　${entry.points} / ${entry.maxPoints} 分</h4>
        ${entry.prompt.audioUrl ? `<button type="button" class="replay" data-audio="${escapeHtml(entry.prompt.audioUrl)}">▶ 播放</button>` : ""}
        ${entry.prompt.indigenousText ? `<p class="ab">${escapeHtml(entry.prompt.indigenousText)}</p>` : ""}
        ${entry.prompt.chineseText ? `<p class="zh">${escapeHtml(entry.prompt.chineseText)}</p>` : ""}
        ${renderListeningReviewOptions(entry)}
      </div>`).join("");
    return `<h3 class="review-section">${escapeHtml(section.title)}（${section.pointsSum} / ${section.maxPointsSum} 分　·　答對 ${section.correct} / ${section.total}）</h3>${items}`;
  }).join("");

  const sentenceBlock = `<h3 class="review-section">口說第一部分：單句朗讀（${sentence.pointsSum} / ${sentence.maxPointsSum} 分）</h3>` + sentence.review.map((entry) => `
    <div class="review-item" data-status="${entry.status}">
      <h4>第 ${entry.no} 題　${statusLabel[entry.status]}${entry.points == null ? "" : `　·　${entry.points} / ${entry.maxPoints} 分`}</h4>
      ${entry.referenceAudioUrl ? `<button type="button" class="replay" data-audio="${escapeHtml(entry.referenceAudioUrl)}">▶ 播放</button>` : ""}
      <p class="ab">教材拼寫：${escapeHtml(entry.expected)}<span class="zh">（${escapeHtml(entry.chineseText)}）</span></p>
      <p>辨識：${escapeHtml(entry.transcript ?? entry.asrError ?? "未作答")}</p>
      ${entry.ratio == null ? "" : `<p>詞語重疊程度：${Math.round(entry.ratio * 100)}%</p>`}
    </div>`).join("");

  const shortBlock = `<h3 class="review-section">口說第二部分：問答題（${short.pointsSum} / ${short.maxPointsSum} 分）</h3>` + short.review.map((entry) => `
    <div class="review-item" data-status="${entry.status === "reasonable" ? "matched" : entry.status === "unreasonable" ? "mismatched" : entry.status}">
      <h4>第 ${entry.no} 題　${statusLabel[entry.status]}${entry.points == null ? "" : `　·　${entry.points} / ${entry.maxPoints} 分`}</h4>
      ${entry.audioUrl ? `<button type="button" class="replay" data-audio="${escapeHtml(entry.audioUrl)}">▶ 播放</button>` : ""}
      <p class="ab">問句：${escapeHtml(entry.question)}<span class="zh">（${escapeHtml(entry.chineseText)}）</span></p>
      <p>辨識：${escapeHtml(entry.transcript ?? entry.asrError ?? "未作答")}</p>
      <p>翻譯成中文：${escapeHtml(entry.translation ?? entry.translateError ?? "—")}</p>
      ${entry.rationale ? `<p>評分說明：${escapeHtml(entry.rationale)}</p>` : ""}
    </div>`).join("");

  const pictureBlock = `<h3 class="review-section">口說第三部分：看圖表達</h3>` + picture.review.map((entry) => `
    <div class="review-item" data-status="${entry.status === "scored" ? "matched" : entry.status}">
      <h4>第 ${entry.no} 題　${entry.status === "scored" ? `分數 ${entry.points} / ${entry.maxPoints}` : statusLabel[entry.status]}</h4>
      ${entry.referenceAudioUrl ? `<button type="button" class="replay" data-audio="${escapeHtml(entry.referenceAudioUrl)}">▶ 播放</button>` : ""}
      <p>中文提示：${escapeHtml(entry.tip)}</p>
      <p>辨識：${escapeHtml(entry.transcript ?? entry.asrError ?? "未作答")}</p>
      <p>翻譯成中文：${escapeHtml(entry.translation ?? entry.translateError ?? "—")}</p>
      <p>教材參考答案：${escapeHtml(entry.referenceChinese)}</p>
      ${entry.rationale ? `<p>評分說明：${escapeHtml(entry.rationale)}</p>` : ""}
    </div>`).join("");

  ui.reviewList.innerHTML = sentenceBlock + shortBlock + pictureBlock + listeningBlocks;
  ui.reviewList.querySelectorAll(".replay").forEach((button) => {
    button.addEventListener("click", () => playTwice(button.dataset.audio));
  });
  ui.reportTitle.focus();
}
