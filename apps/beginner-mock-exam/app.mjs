/**
 * 初級模擬站 · 頁面控制（練習導向）
 *
 * 兩條規則貫穿整個檔案：
 *   1. 按「確定」之前絕不渲染聽力題的族語文字——除非那一題的音檔載不出來（那時該題也不計分）。
 *      確定後可以揭露正解與族語文字，方便練習。
 *   2. 任何服務失敗都不會判使用者答錯：音檔失敗 → notScored，辨識失敗 → undetermined。
 */

import { DIALECTS, ETHNICITIES, dialectById } from "../body-parts-practice/dialects.mjs";
import { createSingleFlight } from "../body-parts-practice/core.mjs";
import { ASR_MODELS, asrModelFor, auditAsrModels, SLOW_HINT_AFTER_MS } from "../body-parts-speaking/asr.mjs";
import { createPaper, flattenPaper, randomSeed, paperIdToSeed } from "./paper.mjs";
import { gradePaper, judgeWordReading, PICTURE_TALK_MAX_POINTS, SHORT_ANSWER_MAX_POINTS, WORD_READING_MAX_POINTS, LISTENING_MAX_POINTS } from "./scoring.mjs";
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
  preview: $("#preview"), heard: $("#heard"),
  feedback: $("#feedback"),
  prev: $("#prev"), next: $("#next"), confirm: $("#confirm"), endPractice: $("#end-practice"),
  answeredCount: $("#answered-count"),
  scoreSummary: $("#score-summary"), reviewList: $("#review-list"), reportTitle: $("#report-title"),
  restart: $("#restart"),
};

const DATA_ROOT = "/data/klokah-junior";
const REPLAY_GAP_MS = 800;
const AUDIO_STALL_MS = 15_000;

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
      pendingReplay = setTimeout(() => { ui.player.currentTime = 0; ui.player.play().catch(fail); }, reduced() ? 0 : REPLAY_GAP_MS);
      return;
    }
    cleanup();
    setAudioState("idle", "播放完畢，可以再聽一次");
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
}

// 音檔載不出來時揭露族語文字，讓題目還是答得下去；這一題同時被標成不計分。
function revealFallbackText(question) {
  const text = question.prompt.indigenousText;
  if (!text) return;
  ui.promptFallback.innerHTML =
    `這題的音檔載入失敗，改以文字呈現，<b>本題不計分</b>。<span class="revealed">${escapeHtml(text)}</span>`;
  ui.promptFallback.hidden = false;
}

function markPromptReplayReady(question) {
  const response = (responses[question.id] ??= {});
  response.canReplay = true;
  if (flat[index]?.question.id !== question.id) return;
  syncPromptPlayButtons(question);
}

ui.play.addEventListener("click", () => {
  const { question } = flat[index];
  const url = question.prompt.audioUrl;
  if (!url || responses[question.id]?.playedInitial) return;
  const response = (responses[question.id] ??= {});
  response.playedInitial = true;
  ui.play.disabled = true;
  ui.replay.hidden = true;
  playTwice(url, { onComplete: () => markPromptReplayReady(question) });
});
ui.replay.addEventListener("click", () => {
  const { question } = flat[index];
  if (!responses[question.id]?.canReplay) return;
  if (question.prompt.audioUrl) playTwice(question.prompt.audioUrl);
});

/* ══════════ 渲染題目 ══════════ */

function isConfirmed(questionId) {
  return responses[questionId]?.confirmed === true;
}

function syncPromptPlayButtons(question) {
  const hasAudio = Boolean(question.prompt.audioUrl);
  ui.play.hidden = !hasAudio;
  ui.audioState.hidden = !hasAudio;
  if (!hasAudio) {
    ui.replay.hidden = true;
    return;
  }
  const started = responses[question.id]?.playedInitial === true;
  const canReplay = responses[question.id]?.canReplay === true;
  ui.play.disabled = started;
  ui.replay.hidden = !canReplay;
  ui.replay.disabled = !canReplay;
}

function renderQuestion() {
  clearAudio();
  clearRecording({ keepHeard: false });

  const { section, question } = flat[index];
  const isSpeaking = section.part === "speaking";
  const partLabel = isSpeaking ? "口說" : "聽力";
  const confirmed = isConfirmed(question.id);

  ui.sectionTitle.textContent = section.title;
  ui.instruction.textContent = section.instruction;
  ui.adaptation.textContent = section.adaptationNote;
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
    setAudioState("idle", response.canReplay ? "可以再聽一次" : "尚未播放");
  }

  // 之前就已經確定音檔壞掉的題目，回頭時要保留那個狀態。
  if (responses[question.id]?.audioFailed) revealFallbackText(question);

  if (isSpeaking) renderSpeaking(section, question);
  else renderListening(section, question);

  if (confirmed) restoreConfirmedFeedback(section, question);

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

  const layout = section.id === "trueFalse" ? "binary" : section.id === "choiceTwo" ? "audio" : "images";
  ui.optionsLegend.textContent = section.id === "trueFalse"
    ? "聽到的句子與圖片相符嗎？"
    : section.id === "choiceTwo"
      ? "哪一句族語與上面的中文語意最接近？"
      : "選出與聽到的內容相符的圖片";

  const chosen = responses[question.id]?.choice ?? responses[question.id]?.draftChoice ?? null;
  const locked = isConfirmed(question.id);
  const cards = question.options.map((option) => {
    const id = `opt-${question.id}-${option.key}`;
    const checked = chosen === option.key ? " checked" : "";
    const disabled = locked ? " disabled" : "";
    if (layout === "binary") {
      return `<div class="option option--binary">
        <input type="radio" id="${id}" name="answer" value="${option.key}"${checked}${disabled}>
        <label for="${id}">${escapeHtml(option.label)}</label>
      </div>`;
    }
    if (layout === "audio") {
      return `<div class="option option--audio">
        <input type="radio" id="${id}" name="answer" value="${option.key}"${checked}${disabled}>
        <label for="${id}">選項 ${escapeHtml(option.key)}</label>
        <button type="button" class="option-play" data-audio="${escapeHtml(option.audioUrl)}">▶ 播放選項 ${escapeHtml(option.key)}</button>
      </div>`;
    }
    return `<div class="option option--image">
      <label for="${id}">
        <img src="${DATA_ROOT}/${escapeHtml(option.imagePath)}" alt="">
        <span class="option-key">圖片 ${escapeHtml(option.key)}</span>
      </label>
      <input type="radio" id="${id}" name="answer" value="${option.key}"${checked}${disabled}>
    </div>`;
  }).join("");

  ui.options.innerHTML = `<legend id="options-legend">${escapeHtml(ui.optionsLegend.textContent)}</legend>
    <div class="options-grid" data-layout="${layout}">${cards}</div>`;

  ui.options.querySelectorAll('input[name="answer"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (isConfirmed(question.id)) return;
      const response = (responses[question.id] ??= {});
      response.draftChoice = input.value;
      updateConfirmButton();
      updateAnsweredCount();
    });
  });
  // 播放鈕在 label 外面，點它不會選中該選項。
  ui.options.querySelectorAll(".option-play").forEach((button) => {
    button.addEventListener("click", () => playTwice(button.dataset.audio));
  });
}

function renderSpeaking(section, question) {
  ui.options.hidden = true;
  ui.options.innerHTML = "";
  ui.speakPanel.hidden = false;
  ui.pictureTip.hidden = true;
  ui.pictureGrid.hidden = true;
  ui.pictureGrid.innerHTML = "";

  if (section.id === "wordReading") {
    ui.speakWord.textContent = question.prompt.indigenousText;
    ui.speakWord.hidden = false;
    ui.speakGloss.textContent = `（${question.prompt.chineseText}）`;
    ui.speakGloss.hidden = false;
    ui.speakHint.textContent = "請按下錄音，照著上面的族語拼寫念出來。按「確定」後才會辨識；教材錄音會在確定後提供。";
  } else if (section.id === "pictureTalk") {
    ui.speakWord.hidden = true;
    ui.speakGloss.hidden = true;
    ui.pictureTip.hidden = false;
    ui.pictureTip.textContent = `中文提示：${question.prompt.tip}`;
    ui.pictureGrid.hidden = false;
    ui.pictureGrid.innerHTML = question.prompt.imageUrls.map((imageUrl, index) => `
      <figure>
        <img src="${escapeHtml(imageUrl)}" alt="" referrerpolicy="no-referrer">
        <figcaption>圖片 ${index + 1}</figcaption>
      </figure>`).join("");
    ui.speakHint.textContent = "選一張或多張圖，用族語簡短說說你的想法（約兩分鐘）。按「確定」後會辨識、翻成中文，並對照教材參考答案給分（滿分 10 分）。";
  } else {
    ui.speakWord.hidden = true;
    ui.speakGloss.hidden = true;
    ui.speakHint.textContent = "請先播放族語問句，再按下錄音，用族語回答。按「確定」後會辨識、翻成中文，並粗判回答是否合理。";
  }

  const canRecord = supportsRecording() && !isConfirmed(question.id);
  ui.record.disabled = !canRecord;
  if (!supportsRecording()) setRecordState("failed", "這個瀏覽器不支援錄音");
}

function optionLabel(question, key) {
  const option = question.options?.find((entry) => entry.key === key);
  if (!option) return key ?? "—";
  if (option.label) return option.label;
  return `選項 ${option.key}`;
}

function showListeningFeedback(section, question, response) {
  let status;
  let title;
  let detail;

  if (response.audioFailed === true) {
    status = "notScored";
    title = "本題不計分";
    detail = "音檔載入失敗，不算答錯。";
  } else if (response.choice === question.answerKey) {
    status = "correct";
    title = "答對了";
    detail = `你的作答：${optionLabel(question, response.choice)}`;
  } else {
    status = "wrong";
    title = "答錯了";
    detail = `你的作答：${optionLabel(question, response.choice)}　·　正解：${optionLabel(question, question.answerKey)}`;
  }

  const indigenous = question.prompt.indigenousText
    ? `<p class="revealed">${escapeHtml(question.prompt.indigenousText)}</p>`
    : "";

  ui.feedback.hidden = false;
  ui.feedback.dataset.status = status;
  ui.feedback.innerHTML = `<strong>${title}</strong><p>${escapeHtml(detail)}</p>${indigenous}`;
}

function showSpeakingFeedback(section, question, response) {
  if (section.id === "shortAnswer") {
    const verdict = response.shortVerdict;
    ui.feedback.hidden = false;
    ui.feedback.dataset.status = verdict === "reasonable"
      ? "matched"
      : verdict === "unreasonable"
        ? "mismatched"
        : "undetermined";
    if (verdict === "reasonable" || verdict === "unreasonable") {
      const points = Number.isFinite(response.shortPoints)
        ? response.shortPoints
        : (verdict === "reasonable" ? SHORT_ANSWER_MAX_POINTS : 0);
      ui.feedback.innerHTML = `<strong>分數 ${points} / ${SHORT_ANSWER_MAX_POINTS}　·　${verdict === "reasonable" ? "回答看起來合理" : "回答看起來不太合理"}</strong>
        <p>系統聽到：${escapeHtml(response.transcript ?? "")}</p>
        <p>翻譯成中文：${escapeHtml(response.translation ?? "")}</p>
        <p>問句（中文）：${escapeHtml(question.prompt.chineseText)}</p>
        <p>這是依譯文與問句類型做的機器粗判，僅供練習參考；這不代表正式測驗評分，也不代表你答錯。</p>`;
    } else {
      ui.feedback.innerHTML = `<strong>無法判定</strong>
        <p>${escapeHtml(response.translateError ?? response.asrError ?? "辨識或翻譯沒有完成")}</p>
        <p>你的作答尚未被判錯。</p>`;
    }
    return;
  }

  if (section.id === "pictureTalk") {
    const points = response.pictureScore?.points;
    const status = response.pictureScore?.status === "scored"
      ? (points >= 8 ? "scored-high" : points >= 5 ? "scored-mid" : "scored-low")
      : "undetermined";
    ui.feedback.hidden = false;
    ui.feedback.dataset.status = status;
    if (response.pictureScore?.status === "scored") {
      ui.feedback.innerHTML = `<strong>分數 ${points} / ${PICTURE_TALK_MAX_POINTS}</strong>
        <p>系統聽到：${escapeHtml(response.transcript ?? "")}</p>
        <p>翻譯成中文：${escapeHtml(response.translation ?? "")}</p>
        <p>教材參考答案（中文）：${escapeHtml(question.reference.chineseText)}</p>
        <p>分數來自譯文與參考答案的內容重疊程度，僅供練習參考；這不代表正式測驗評分，也不代表你說錯。</p>
        ${question.reference.audioUrl
          ? `<p><button type="button" class="feedback-replay" data-audio="${escapeHtml(question.reference.audioUrl)}">▶ 聽教材範例</button></p>`
          : ""}`;
    } else {
      ui.feedback.innerHTML = `<strong>無法判定</strong>
        <p>${escapeHtml(response.translateError ?? response.asrError ?? "辨識或翻譯沒有完成")}</p>
        <p>你的作答尚未被判錯。</p>`;
    }
    ui.feedback.querySelector(".feedback-replay")?.addEventListener("click", (event) => {
      playTwice(event.currentTarget.dataset.audio);
    });
    return;
  }

  const verdict = response.asrError || !response.transcript
    ? "undetermined"
    : judgeWordReading(response.transcript, question.expected);
  const titles = {
    matched: "與教材拼寫相符",
    mismatched: "與教材拼寫不相符",
    undetermined: "無法判定",
  };
  ui.feedback.hidden = false;
  ui.feedback.dataset.status = verdict;
  ui.feedback.innerHTML = `<strong>${titles[verdict]}</strong>
    <p>系統聽到：${escapeHtml(response.transcript ?? response.asrError ?? "未作答")}</p>
    <p>${verdict === "matched"
      ? "與本題的教材拼寫相符。"
      : verdict === "mismatched"
        ? "系統聽到的內容與本題的教材拼寫不相符。可能是念法不同，也可能是族級模型的辨識偏差；這不代表你念錯。"
        : "你的作答尚未被判錯。"}</p>
    ${question.prompt.referenceAudioUrl
      ? `<p><button type="button" class="feedback-replay" data-audio="${escapeHtml(question.prompt.referenceAudioUrl)}">▶ 聽教材錄音</button></p>`
      : ""}`;
  ui.feedback.querySelector(".feedback-replay")?.addEventListener("click", (event) => {
    playTwice(event.currentTarget.dataset.audio);
  });
}

function restoreConfirmedFeedback(section, question) {
  const response = responses[question.id];
  if (!response?.confirmed) return;
  if (section.part === "listening") showListeningFeedback(section, question, response);
  else {
    showSpeakingFeedback(section, question, response);
    // 口說確認後也把 heard 區補上，跟第一次確定時一致。
    if (response.transcript || response.asrError) {
      showHeard(response.transcript, response.asrError, section, question);
    }
  }
}

function updateConfirmButton() {
  if (!flat[index]) { ui.confirm.disabled = true; return; }
  const { section, question } = flat[index];
  if (isConfirmed(question.id)) {
    ui.confirm.disabled = true;
    ui.confirm.textContent = "已確定";
    return;
  }
  ui.confirm.textContent = "確定";
  if (section.part === "listening") {
    const response = responses[question.id] ?? {};
    ui.confirm.disabled = response.draftChoice == null && response.choice == null && !response.audioFailed;
    return;
  }
  ui.confirm.disabled = !recordedBlob;
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
  showListeningFeedback(section, question, response);
  ui.options.querySelectorAll('input[name="answer"]').forEach((input) => { input.disabled = true; });
  updateConfirmButton();
  updateAnsweredCount();
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
    showHeard(null, response.asrError, section, question);
    showSpeakingFeedback(section, question, response);
    updateConfirmButton();
    updateAnsweredCount();
    return;
  }

  setRecordState("transcribing");
  const slowHint = setTimeout(() => setRecordState("slow"), SLOW_HINT_AFTER_MS);
  try {
    const heard = await transcribe(wav, selectedDialect.ethnicity, { unavailable: unavailableEthnicities });
    response.transcript = heard;
    response.asrError = null;
    showHeard(heard, null, section, question);

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
    showHeard(null, error.message, section, question);
  } finally {
    clearTimeout(slowHint);
    response.confirmed = true;
    showSpeakingFeedback(section, question, response);
    updateConfirmButton();
    updateAnsweredCount();
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
  recorded: ["✓", "已錄音，可以按確定"],
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
  ui.preview.hidden = true;
  ui.preview.removeAttribute("src");
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
  // 錄完後主鈕就是「重新錄音」：清掉舊檔再錄，不必另開一顆按鈕。
  if (recordedBlob) clearRecording();
  recorder = createRecorder({
    onState: (state, blob) => {
      if (state === "recording") {
        ui.record.classList.add("is-recording");
        ui.recordLabel.textContent = "停止錄音";
        setRecordState("recording");
      } else if (state === "recorded") {
        recordedBlob = blob;
        ui.preview.src = recorder.objectUrl;
        ui.preview.hidden = false;
        ui.record.classList.remove("is-recording");
        ui.recordLabel.textContent = "重新錄音";
        setRecordState("recorded");
        updateConfirmButton();
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

function showHeard(transcript, error, section, question) {
  ui.heard.hidden = false;
  if (!transcript) {
    ui.heard.innerHTML = `<strong>無法判定</strong>
      <p class="heard-text">${escapeHtml(error ?? "辨識服務沒有回傳文字")}</p>
      <small>你的作答尚未被判錯。</small>`;
    return;
  }
  if (section.id === "shortAnswer") {
    ui.heard.innerHTML = `<strong>系統聽到的是</strong>
      <p class="heard-text">${escapeHtml(transcript)}</p>
      <small>接下來會翻成中文，並粗判回答是否合理。</small>`;
    return;
  }
  if (section.id === "pictureTalk") {
    ui.heard.innerHTML = `<strong>系統聽到的是</strong>
      <p class="heard-text">${escapeHtml(transcript)}</p>
      <small>接下來會翻成中文，並與教材參考答案比對後給分。</small>`;
    return;
  }
  const verdict = judgeWordReading(transcript, question.expected);
  ui.heard.innerHTML = `<strong>系統聽到的是</strong>
    <p class="heard-text">${escapeHtml(transcript)}</p>
    <small>${verdict === "matched"
      ? "與本題的教材拼寫相符。"
      : "系統聽到的內容與本題的教材拼寫不相符。可能是念法不同，也可能是族級模型的辨識偏差；這不代表你念錯。"}</small>`;
}

/* ══════════ 成績單 ══════════ */

function showReport() {
  clearAudio();
  clearRecording();
  const report = gradePaper(paper, responses);

  ui.quiz.hidden = true;
  ui.report.hidden = false;

  const listening = report.listening;
  const accuracy = listening.accuracy === null ? null : Math.round(listening.accuracy * 100);
  const word = report.speaking.wordReading;
  const short = report.speaking.shortAnswer;
  const picture = report.speaking.pictureTalk;

  const practice = report.practice;
  ui.scoreSummary.innerHTML = `
    <div class="score-line">
      <strong>本次練習得分</strong>
      <p class="score-big">${practice.total} / ${practice.totalMax}</p>
      <p class="score-note">口說 ${practice.speaking} / ${practice.speakingMax}　·　聽力 ${practice.listening} / ${practice.listeningMax}</p>
      <p class="score-note">${escapeHtml(report.official.disclaimer)}</p>
    </div>
    <div class="score-line">
      <strong>口說 · 單詞朗讀（每題 ${WORD_READING_MAX_POINTS} 分，共 ${word.maxPointsSum} 分）</strong>
      <p class="score-big">分數 ${word.pointsSum} / ${word.maxPointsSum}</p>
      <p class="score-note">相符 ${word.matched} 題　·　不相符 ${word.mismatched} 題　·　無法判定 ${word.undetermined} 題　·　未作答 ${word.skipped} 題</p>
      <p class="score-note">「不相符」只表示系統聽到的內容與教材拼寫不同，不代表你念錯。</p>
    </div>
    <div class="score-line">
      <strong>口說 · 簡答題（每題 ${SHORT_ANSWER_MAX_POINTS} 分，共 ${short.maxPointsSum} 分）</strong>
      <p class="score-big">分數 ${short.pointsSum} / ${short.maxPointsSum}</p>
      <p class="score-note">合理 ${short.reasonable} 題　·　不太合理 ${short.unreasonable} 題　·　無法判定 ${short.undetermined} 題　·　未作答 ${short.skipped} 題</p>
      <p class="score-note">「不太合理」只是機器粗判，不代表正式測驗評分。</p>
    </div>
    <div class="score-line">
      <strong>口說 · 看圖說話（共 ${picture.maxPointsSum} 分）</strong>
      <p class="score-big">分數 ${picture.pointsSum} / ${picture.maxPointsSum}</p>
      <p class="score-note">已評分 ${picture.scoredCount} 題　·　無法判定 ${picture.undetermined} 題　·　未作答 ${picture.skipped} 題</p>
      <p class="score-note">${escapeHtml(report.speaking.coverageNote)}</p>
    </div>
    <div class="score-line">
      <strong>聽力（每題 ${LISTENING_MAX_POINTS} 分，共 ${listening.maxPointsSum} 分）</strong>
      <p class="score-big">分數 ${listening.pointsSum} / ${listening.maxPointsSum}</p>
      <p class="score-note">答對 ${listening.correct} / ${listening.total} 題${accuracy === null
        ? ""
        : `　·　正確率 ${accuracy}%（以已作答且可計分的 ${listening.scoredDenominator} 題為分母）`}</p>
      <p class="score-note">答錯 ${listening.wrong} 題　·　未作答 ${listening.unanswered} 題　·　音檔失敗不計分 ${listening.notScored} 題</p>
    </div>`;

  const statusLabel = {
    correct: "答對", wrong: "答錯", unanswered: "未作答", notScored: "音檔失敗·不計分",
    matched: "與教材拼寫相符", mismatched: "與教材拼寫不相符", undetermined: "無法判定", skipped: "未作答",
    transcribed: "已錄下", scored: "已評分", reasonable: "回答看起來合理", unreasonable: "回答看起來不太合理",
  };

  const listeningBlocks = listening.bySection.map((section) => {
    const items = section.review.map((entry) => {
      const yours = entry.yourKey ?? "—";
      return `<div class="review-item" data-status="${entry.status}">
        <h4>第 ${entry.no} 題　${statusLabel[entry.status]}　·　${entry.points} / ${entry.maxPoints} 分</h4>
        <p>你的作答：${escapeHtml(yours)}　·　正解：${escapeHtml(entry.answerKey)}</p>
        ${entry.prompt.indigenousText ? `<p class="ab">${escapeHtml(entry.prompt.indigenousText)}</p>` : ""}
        ${entry.prompt.chineseText ? `<p class="zh">${escapeHtml(entry.prompt.chineseText)}</p>` : ""}
        ${entry.prompt.audioUrl ? `<button type="button" class="replay" data-audio="${escapeHtml(entry.prompt.audioUrl)}">▶ 再聽一次</button>` : ""}
      </div>`;
    }).join("");
    return `<h3 class="review-section">${escapeHtml(section.title)}（${section.pointsSum} / ${section.maxPointsSum} 分　·　答對 ${section.correct} / ${section.total}）</h3>${items}`;
  }).join("");

  const wordBlock = `<h3 class="review-section">口說第一部分：單詞朗讀（${word.pointsSum} / ${word.maxPointsSum} 分）</h3>` + word.review.map((entry) => `
    <div class="review-item" data-status="${entry.status}">
      <h4>第 ${entry.no} 題　${statusLabel[entry.status]}　·　${entry.points} / ${entry.maxPoints} 分</h4>
      <p class="ab">教材拼寫：${escapeHtml(entry.expected)}<span class="zh">（${escapeHtml(entry.chineseText)}）</span></p>
      <p>系統聽到：${escapeHtml(entry.transcript ?? entry.asrError ?? "未作答")}</p>
      <button type="button" class="replay" data-audio="${escapeHtml(entry.referenceAudioUrl)}">▶ 聽教材錄音</button>
    </div>`).join("");

  const shortBlock = `<h3 class="review-section">口說第二部分：簡答題（${short.pointsSum} / ${short.maxPointsSum} 分）</h3>` + short.review.map((entry) => `
    <div class="review-item" data-status="${entry.status === "reasonable" ? "matched" : entry.status === "unreasonable" ? "mismatched" : entry.status}">
      <h4>第 ${entry.no} 題　${statusLabel[entry.status]}${entry.points == null ? "" : `　·　${entry.points} / ${entry.maxPoints} 分`}</h4>
      <p class="ab">問句：${escapeHtml(entry.question)}<span class="zh">（${escapeHtml(entry.chineseText)}）</span></p>
      <p>系統聽到：${escapeHtml(entry.transcript ?? entry.asrError ?? "未作答")}</p>
      <p>翻譯成中文：${escapeHtml(entry.translation ?? entry.translateError ?? "—")}</p>
      <button type="button" class="replay" data-audio="${escapeHtml(entry.audioUrl)}">▶ 再聽問句</button>
    </div>`).join("");

  const pictureBlock = `<h3 class="review-section">口說第三部分：看圖說話</h3>` + picture.review.map((entry) => `
    <div class="review-item" data-status="${entry.status === "scored" ? "matched" : entry.status}">
      <h4>第 ${entry.no} 題　${entry.status === "scored" ? `分數 ${entry.points} / ${entry.maxPoints}` : statusLabel[entry.status]}</h4>
      <p>中文提示：${escapeHtml(entry.tip)}</p>
      <p>系統聽到：${escapeHtml(entry.transcript ?? entry.asrError ?? "未作答")}</p>
      <p>翻譯成中文：${escapeHtml(entry.translation ?? entry.translateError ?? "—")}</p>
      <p>教材參考答案：${escapeHtml(entry.referenceChinese)}</p>
      ${entry.referenceAudioUrl ? `<button type="button" class="replay" data-audio="${escapeHtml(entry.referenceAudioUrl)}">▶ 聽教材範例</button>` : ""}
    </div>`).join("");

  ui.reviewList.innerHTML = wordBlock + shortBlock + pictureBlock + listeningBlocks;
  ui.reviewList.querySelectorAll(".replay").forEach((button) => {
    button.addEventListener("click", () => playTwice(button.dataset.audio));
  });
  ui.reportTitle.focus();
}
