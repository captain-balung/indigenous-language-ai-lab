/**
 * 初級模擬站 · 頁面控制
 *
 * 兩條規則貫穿整個檔案：
 *   1. 作答階段絕不渲染族語文字——除非那一題的音檔載不出來（那時該題也不計分）。
 *   2. 任何服務失敗都不會判使用者答錯：音檔失敗 → notScored，辨識失敗 → undetermined。
 */

import { DIALECTS, ETHNICITIES, dialectById } from "../body-parts-practice/dialects.mjs";
import { createSingleFlight } from "../body-parts-practice/core.mjs";
import { ASR_MODELS, asrModelFor, auditAsrModels, SLOW_HINT_AFTER_MS } from "../body-parts-speaking/asr.mjs";
import { createPaper, flattenPaper, randomSeed, paperIdToSeed } from "./paper.mjs";
import { gradePaper, judgeWordReading } from "./scoring.mjs";
import { supportsRecording, createRecorder, convertToAsrWav, transcribe, fetchLiveAsrDialects } from "./recorder.mjs";

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
  record: $("#record"), recordLabel: $("#record-label"), recordTime: $("#record-time"),
  recordState: $("#record-state"), recordStateText: $("#record-state-text"),
  preview: $("#preview"), submit: $("#submit"), rerecord: $("#rerecord"), heard: $("#heard"),
  prev: $("#prev"), next: $("#next"), finish: $("#finish"), answeredCount: $("#answered-count"),
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
    ui.modelNote.textContent = `${ethnicity}：教材有，但沒有對應的辨識模型；口說兩部分這次會顯示為「無法判定」，聽力不受影響。`;
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
    ui.apiStatus.textContent = "這個瀏覽器不支援錄音，口說兩部分會顯示為未作答；聽力四部分仍可正常作答。";
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
  ui.start.textContent = "正在準備試卷…";
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
    ui.paperLabel.textContent = `${selectedDialect.name}　試卷編號 ${paper.paperId}`;
    renderQuestion();
  } catch (error) {
    ui.apiStatus.textContent = `無法載入這個方言別的教材（${error.message}）。請稍後再試，或換一個方言別。`;
    ui.apiStatus.dataset.state = "fallback";
  } finally {
    ui.start.textContent = "產生試卷並開始";
    ui.start.disabled = !selectedDialect;
  }
});

/* ══════════ 音檔播放 ══════════ */

let stallTimer = null;
let pendingReplay = null;

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
}

/**
 * 播兩遍，比照官方「每題播出兩遍」。
 * klokah 不送 CORS 標頭，所以讀不到 HTTP 狀態，只能靠 error 事件與 stall 看門狗；
 * 也因此絕對不能用 fetch() 去取這些音檔。
 */
function playTwice(url) {
  clearAudio();
  setAudioState("loading", "載入音檔中…");
  ui.player.src = url;

  let played = 0;
  const onEnded = () => {
    played += 1;
    if (played === 1) {
      setAudioState("playing", "第二遍…");
      pendingReplay = setTimeout(() => { ui.player.currentTime = 0; ui.player.play().catch(handleAudioFailure); }, reduced() ? 0 : REPLAY_GAP_MS);
      return;
    }
    cleanup();
    setAudioState("idle", "播放完畢，可以再聽一次");
  };
  const onPlaying = () => {
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    setAudioState("playing", played === 0 ? "第一遍…" : "第二遍…");
  };
  const cleanup = () => {
    ui.player.removeEventListener("ended", onEnded);
    ui.player.removeEventListener("playing", onPlaying);
    ui.player.removeEventListener("error", handleAudioFailure);
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
  };

  ui.player.addEventListener("ended", onEnded);
  ui.player.addEventListener("playing", onPlaying);
  ui.player.addEventListener("error", handleAudioFailure);
  // 請求卡住時不會有任何事件，所以額外設一個看門狗。
  stallTimer = setTimeout(() => { cleanup(); handleAudioFailure(); }, AUDIO_STALL_MS);

  ui.player.play().catch(handleAudioFailure);
}

function handleAudioFailure() {
  clearAudio();
  setAudioState("failed", "音檔載入失敗");
  const { question } = flat[index] ?? {};
  if (!question) return;
  const response = (responses[question.id] ??= {});
  response.audioFailed = true;
  revealFallbackText(question);
}

// 音檔載不出來時揭露族語文字，讓題目還是答得下去；這一題同時被標成不計分。
function revealFallbackText(question) {
  const text = question.prompt.indigenousText;
  if (!text) return;
  ui.promptFallback.innerHTML =
    `這題的音檔載入失敗，改以文字呈現，<b>本題不計分</b>。<span class="revealed">${escapeHtml(text)}</span>`;
  ui.promptFallback.hidden = false;
}

ui.play.addEventListener("click", () => {
  const { question } = flat[index];
  const url = question.prompt.audioUrl;
  if (!url) return;
  playTwice(url);
});
ui.replay.addEventListener("click", () => {
  const { question } = flat[index];
  if (question.prompt.audioUrl) playTwice(question.prompt.audioUrl);
});

/* ══════════ 渲染題目 ══════════ */

function renderQuestion() {
  clearAudio();
  clearRecording();

  const { section, question } = flat[index];
  const isSpeaking = section.part === "speaking";
  const partLabel = isSpeaking ? "口說" : "聽力";

  ui.sectionTitle.textContent = section.title;
  ui.instruction.textContent = section.instruction;
  ui.adaptation.textContent = section.adaptationNote;
  ui.progress.textContent = `${partLabel} ${section.title.replace(/^.*：/, "")} ${question.no} / 5　·　全卷 ${index + 1} / ${paper.totalQuestions}`;
  ui.questionTitle.textContent = `第 ${index + 1} 題`;

  ui.promptFallback.hidden = true;
  ui.promptChinese.hidden = true;
  ui.promptFigure.hidden = true;
  ui.heard.hidden = true;

  const hasAudio = Boolean(question.prompt.audioUrl);
  ui.play.hidden = !hasAudio;
  ui.replay.hidden = !hasAudio;
  ui.audioState.hidden = !hasAudio;
  if (hasAudio) setAudioState("idle", "尚未播放");

  // 之前就已經確定音檔壞掉的題目，回頭時要保留那個狀態。
  if (responses[question.id]?.audioFailed) revealFallbackText(question);

  if (isSpeaking) renderSpeaking(section, question);
  else renderListening(section, question);

  ui.prev.disabled = index === 0;
  ui.next.disabled = index === flat.length - 1;
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

  const chosen = responses[question.id]?.choice ?? null;
  const cards = question.options.map((option) => {
    const id = `opt-${question.id}-${option.key}`;
    const checked = chosen === option.key ? " checked" : "";
    if (layout === "binary") {
      return `<div class="option option--binary">
        <input type="radio" id="${id}" name="answer" value="${option.key}"${checked}>
        <label for="${id}">${escapeHtml(option.label)}</label>
      </div>`;
    }
    if (layout === "audio") {
      return `<div class="option option--audio">
        <input type="radio" id="${id}" name="answer" value="${option.key}"${checked}>
        <label for="${id}">選項 ${escapeHtml(option.key)}</label>
        <button type="button" class="option-play" data-audio="${escapeHtml(option.audioUrl)}">▶ 播放選項 ${escapeHtml(option.key)}</button>
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
      response.choice = input.value;
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

  if (section.id === "wordReading") {
    ui.speakWord.textContent = question.prompt.indigenousText;
    ui.speakWord.hidden = false;
    ui.speakGloss.textContent = `（${question.prompt.chineseText}）`;
    ui.speakGloss.hidden = false;
    ui.speakHint.textContent = "請按下錄音，照著上面的族語拼寫念出來。教材錄音會在送出辨識後才提供，先自己念一次。";
  } else {
    ui.speakWord.hidden = true;
    ui.speakGloss.hidden = true;
    ui.speakHint.textContent = "請先播放族語問句，再按下錄音，用族語回答。本站只顯示系統聽到的內容，不判定對錯。";
  }

  const canRecord = supportsRecording();
  ui.record.disabled = !canRecord;
  if (!canRecord) setRecordState("failed", "這個瀏覽器不支援錄音");
}

function updateAnsweredCount() {
  const listeningIds = paper.listening.flatMap((section) => section.questions.map((q) => q.id));
  const answered = listeningIds.filter((id) => responses[id]?.choice != null).length;
  const attempted = paper.speaking.flatMap((s) => s.questions).filter((q) => responses[q.id]?.attempted).length;
  ui.answeredCount.textContent = `聽力已作答 ${answered} / 20　·　口說已錄 ${attempted} / 10`;
}

/* ══════════ 導覽 ══════════ */

ui.prev.addEventListener("click", () => { if (index > 0) { index -= 1; renderQuestion(); } });
ui.next.addEventListener("click", () => { if (index < flat.length - 1) { index += 1; renderQuestion(); } });

ui.finish.addEventListener("click", () => {
  const unanswered = paper.listening
    .flatMap((section) => section.questions)
    .filter((question) => responses[question.id]?.choice == null && !responses[question.id]?.audioFailed).length;
  if (unanswered > 0 && !window.confirm(`聽力還有 ${unanswered} 題沒有作答，確定要交卷嗎？`)) return;
  showReport();
});

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
  recorded: ["✓", "已錄音，可以送出辨識"],
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

function clearRecording() {
  recorder?.clear();
  recorder = null;
  recordedBlob = null;
  ui.preview.hidden = true;
  ui.preview.removeAttribute("src");
  ui.record.classList.remove("is-recording");
  ui.recordLabel.textContent = "開始錄音";
  ui.recordTime.textContent = "00:00";
  ui.submit.disabled = true;
  ui.rerecord.hidden = true;
  ui.heard.hidden = true;
  setRecordState("idle");
}

ui.record.addEventListener("click", async () => {
  if (recorder?.recording) { recorder.stop(); return; }
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
        ui.submit.disabled = false;
        ui.rerecord.hidden = false;
        setRecordState("recorded");
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

ui.rerecord.addEventListener("click", () => { clearRecording(); ui.record.focus(); });
ui.submit.addEventListener("click", () => { runTranscription(); });

const runTranscription = createSingleFlight(async () => {
  if (!recordedBlob) return;
  const { section, question } = flat[index];
  const response = (responses[question.id] ??= {});
  response.attempted = true;
  ui.submit.disabled = true;
  ui.record.disabled = true;

  let wav;
  setRecordState("converting");
  try {
    wav = await convertToAsrWav(recordedBlob);
  } catch (error) {
    // 轉檔失敗絕不靜默送出原始錄音——那正是辨識不準的來源。
    setRecordState("failed", "轉檔失敗，沒有送出");
    response.transcript = null;
    response.asrError = `轉檔失敗：${error.message}`;
    showHeard(null, response.asrError, section, question);
    ui.submit.disabled = false;
    ui.record.disabled = false;
    updateAnsweredCount();
    return;
  }

  setRecordState("transcribing");
  const slowHint = setTimeout(() => setRecordState("slow"), SLOW_HINT_AFTER_MS);
  try {
    const heard = await transcribe(wav, selectedDialect.ethnicity, { unavailable: unavailableEthnicities });
    response.transcript = heard;
    response.asrError = null;
    setRecordState("recorded", "辨識完成");
    showHeard(heard, null, section, question);
  } catch (error) {
    response.transcript = null;
    response.asrError = error.message;
    setRecordState("failed", "這次沒有辨識成功");
    showHeard(null, error.message, section, question);
  } finally {
    clearTimeout(slowHint);
    ui.submit.disabled = false;
    ui.record.disabled = false;
    updateAnsweredCount();
  }
});

function showHeard(transcript, error, section, question) {
  ui.heard.hidden = false;
  if (!transcript) {
    ui.heard.innerHTML = `<strong>無法判定</strong>
      <p class="heard-text">${escapeHtml(error ?? "辨識服務沒有回傳文字")}</p>
      <small>你的作答尚未被判錯。錄音仍保留，可以直接重試，或重新錄音。</small>`;
    return;
  }
  if (section.id !== "wordReading") {
    ui.heard.innerHTML = `<strong>系統聽到的是</strong>
      <p class="heard-text">${escapeHtml(transcript)}</p>
      <small>簡答題不評分——正式測驗由委員評分，機器沒有辦法判斷你的回答是否合適。這裡只把系統聽到的內容顯示給你，讓你自己檢視。</small>`;
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

  ui.scoreSummary.innerHTML = `
    <div class="score-line">
      <strong>聽力（共 20 題）</strong>
      <p class="score-big">答對 ${listening.correct} / ${listening.total} 題</p>
      <p class="score-note">${accuracy === null
        ? "這次沒有可計分的題目。"
        : `正確率 ${accuracy}%（以已作答且可計分的 ${listening.scoredDenominator} 題為分母）`}</p>
      <p class="score-note">答錯 ${listening.wrong} 題　·　未作答 ${listening.unanswered} 題　·　音檔失敗不計分 ${listening.notScored} 題</p>
    </div>
    <div class="score-line">
      <strong>口說 · 單詞朗讀（共 ${word.total} 題）</strong>
      <p class="score-big">相符 ${word.matched} 題</p>
      <p class="score-note">不相符 ${word.mismatched} 題　·　無法判定 ${word.undetermined} 題　·　未作答 ${word.skipped} 題</p>
      <p class="score-note">「不相符」只表示系統聽到的內容與教材拼寫不同，不代表你念錯。</p>
    </div>
    <div class="score-line">
      <strong>口說 · 簡答題（共 ${short.total} 題）</strong>
      <p class="score-big">已錄下 ${short.transcribed} 題</p>
      <p class="score-note">本站不評分簡答題；正式測驗由委員評分。</p>
      <p class="score-note">${escapeHtml(report.speaking.coverageNote)}</p>
    </div>`;

  const statusLabel = {
    correct: "答對", wrong: "答錯", unanswered: "未作答", notScored: "音檔失敗·不計分",
    matched: "與教材拼寫相符", mismatched: "與教材拼寫不相符", undetermined: "無法判定", skipped: "未作答",
  };

  const listeningBlocks = listening.bySection.map((section) => {
    const items = section.review.map((entry) => {
      const yours = entry.yourKey ?? "—";
      return `<div class="review-item" data-status="${entry.status}">
        <h4>第 ${entry.no} 題　${statusLabel[entry.status]}</h4>
        <p>你的作答：${escapeHtml(yours)}　·　正解：${escapeHtml(entry.answerKey)}</p>
        ${entry.prompt.indigenousText ? `<p class="ab">${escapeHtml(entry.prompt.indigenousText)}</p>` : ""}
        ${entry.prompt.chineseText ? `<p class="zh">${escapeHtml(entry.prompt.chineseText)}</p>` : ""}
        ${entry.prompt.audioUrl ? `<button type="button" class="replay" data-audio="${escapeHtml(entry.prompt.audioUrl)}">▶ 再聽一次</button>` : ""}
      </div>`;
    }).join("");
    return `<h3 class="review-section">${escapeHtml(section.title)}（答對 ${section.correct} / ${section.total}）</h3>${items}`;
  }).join("");

  const wordBlock = `<h3 class="review-section">口說第一部分：單詞朗讀</h3>` + word.review.map((entry) => `
    <div class="review-item" data-status="${entry.status}">
      <h4>第 ${entry.no} 題　${statusLabel[entry.status]}</h4>
      <p class="ab">教材拼寫：${escapeHtml(entry.expected)}<span class="zh">（${escapeHtml(entry.chineseText)}）</span></p>
      <p>系統聽到：${escapeHtml(entry.transcript ?? entry.asrError ?? "未作答")}</p>
      <button type="button" class="replay" data-audio="${escapeHtml(entry.referenceAudioUrl)}">▶ 聽教材錄音</button>
    </div>`).join("");

  const shortBlock = `<h3 class="review-section">口說第二部分：簡答題（不計分）</h3>` + short.review.map((entry) => `
    <div class="review-item" data-status="${entry.status}">
      <h4>第 ${entry.no} 題</h4>
      <p class="ab">問句：${escapeHtml(entry.question)}<span class="zh">（${escapeHtml(entry.chineseText)}）</span></p>
      <p>系統聽到：${escapeHtml(entry.transcript ?? entry.asrError ?? "未作答")}</p>
      <button type="button" class="replay" data-audio="${escapeHtml(entry.audioUrl)}">▶ 再聽問句</button>
    </div>`).join("");

  ui.reviewList.innerHTML = listeningBlocks + wordBlock + shortBlock;
  ui.reviewList.querySelectorAll(".replay").forEach((button) => {
    button.addEventListener("click", () => playTwice(button.dataset.audio));
  });
  ui.reportTitle.focus();
}
