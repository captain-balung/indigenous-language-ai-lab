// 十二年國教兩個練習的共用流程：跟唸、翻譯。
//
// 資料只在 data/twelve/；語音辨識、翻譯與 AI 判別沿用既有模組。
// 兩個 app 的 index.html 共用同一組元素 ID，由 boot(activity) 決定顯示哪一種作答方式。

import { exactMatch, judgeAnswer } from "../basic-learning/body-parts-practice/core.mjs";
import { DIALECTS, ETHNICITIES, dialectById } from "../basic-learning/body-parts-practice/dialects.mjs";
import { ASR_MODELS, SLOW_HINT_AFTER_MS, asrModelFor, auditAsrModels } from "../basic-learning/body-parts-speaking/asr.mjs";
import { judgeAiMeaning } from "./semantic-meaning.mjs";
import {
  convertToAsrWav, createRecorder, fetchLiveAsrDialects,
  supportsRecording, transcribe, translateToZh
} from "../certification-mock/beginner-mock-exam/recorder.mjs";
import {
  reportDetail, scoreLabel, tally, verdictFromTranslation
} from "../classroom-quiz/meaning-sentence/core.mjs";
import { wireInputMode } from "./input-mode.mjs";
import {
  ACTIVITIES, ROUND_SIZE, buildRound, levelOptions, loadShard
} from "./twelve-data.mjs";

const $ = (selector) => document.querySelector(selector);

let activity;
let info;
let selectedDialect;
let selectedLevel = 0;
let answerMode = "speech";
let shard;
let round = [];
let index = 0;
let results = [];
let pending = false;
let graded = false;
let attempt = 0;
let acceptRecording = false;
let blocked = new Set();
let statusNote = "正在確認語音辨識服務…";
let recorder = null;
let pendingAudioUrl = null;
let loadToken = 0;
let inputModeControl = null;

const ui = {
  mission: $("#mission"), title: $("#page-title"), lead: $("#page-lead"),
  ethnicity: $("#ethnicity"), dialect: $("#dialect"), level: $("#level"),
  start: $("#start"), api: $("#api-status"),
  quiz: $("#quiz"), label: $("#dialect-label"), progress: $("#progress"),
  prompt: $("#prompt"), questionTitle: $("#question-title"),
  questionText: $("#question-text"), questionSubtext: $("#question-subtext"),
  audioPanel: $("#panel-audio"), replay: $("#replay"), audioState: $("#audio-state"), player: $("#player"),
  hintToggle: $("#hint-toggle"), hintPanel: $("#hint-panel"), hintLesson: $("#hint-lesson"),
  hintChinese: $("#hint-chinese"), hintIndigenous: $("#hint-indigenous"),
  inputModeToggle: $("#input-mode-toggle"),
  speech: $("#panel-speech"), record: $("#record"), recordLabel: $("#record-label"),
  recordState: $("#record-state"), recordTime: $("#record-time"), recordStateText: $("#record-state-text"),
  compose: $("#panel-compose"), answer: $("#answer"), submit: $("#submit"), submitRow: $("#submit-row"),
  skipAudio: $("#skip-audio"),
  result: $("#result"), next: $("#next"),
  report: $("#report"), score: $("#score-line"), list: $("#score-list"), again: $("#again")
};

const STATES = {
  idle: ["●", "尚未錄音"],
  recording: ["◉", "錄音中…再按一次停止"],
  recorded: ["■", "錄音完成"],
  converting: ["◐", "轉檔中…"],
  transcribing: ["◍", "辨識中，請稍候"],
  slow: ["◍", "辨識中，長句需要較久，請不要重新整理"],
  failed: ["△", "這次沒有完成判定"]
};

const TITLES = {
  retell: ["跟唸", "聽完後用族語再講一次"],
  translateTyping: ["翻譯・打字", "看中文，用族語寫出來"],
  translateSpeech: ["翻譯・錄音", "看中文，用族語說出來"]
};

function setState(key, override) {
  const [icon, text] = STATES[key] || STATES.idle;
  ui.recordState.dataset.state = key;
  ui.recordState.querySelector(".record-state__icon").textContent = icon;
  ui.recordStateText.textContent = override || text;
}

function clock(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function reduced() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setHidden(element, hidden) {
  if (element) element.hidden = hidden;
}

function setHintOpen(open) {
  if (!ui.hintToggle || !ui.hintPanel) return;
  ui.hintPanel.hidden = !open;
  ui.hintToggle.setAttribute("aria-expanded", String(open));
  ui.hintToggle.textContent = open ? "收起提示" : "看提示";
}

function renderHint(question) {
  if (!ui.hintPanel || !question) return;
  const lesson = `第 ${question.level} 階第 ${question.lesson} 課`;
  ui.hintLesson.textContent = question.lessonTitleCh
    ? `${lesson}・${question.lessonTitleCh}`
    : lesson;
  ui.hintChinese.textContent = question.chineseText;
  ui.hintIndigenous.textContent = question.indigenousText;
  setHintOpen(false);
}

function needsSpeech() {
  return activity !== "translate";
}

function asrUsable(ethnicity) {
  return Boolean(asrModelFor(ethnicity)) && !blocked.has(ethnicity);
}

function showStatus() {
  const ethnicity = ui.ethnicity.value;
  if (activity === "translate") {
    if (ethnicity && !supportsRecording()) {
      ui.api.textContent = "這個瀏覽器不支援錄音；翻譯請改用打字。";
      ui.api.dataset.state = "fallback";
      return;
    }
    if (ethnicity && !asrUsable(ethnicity)) {
      ui.api.textContent = `${ethnicity}目前沒有語音辨識模型；翻譯請改用打字。`;
      ui.api.dataset.state = "fallback";
      return;
    }
    ui.api.textContent = statusNote;
    ui.api.dataset.state = "ok";
    return;
  }
  if (!supportsRecording()) {
    ui.api.textContent = "這個瀏覽器不支援錄音，這個練習需要麥克風。";
    ui.api.dataset.state = "error";
    return;
  }
  if (ethnicity && !asrUsable(ethnicity)) {
    ui.api.textContent = `${ethnicity}目前無法使用語音辨識。`;
    ui.api.dataset.state = "fallback";
    return;
  }
  ui.api.textContent = statusNote;
  ui.api.dataset.state = "ok";
}

function updateStart() {
  const asrOk = !needsSpeech()
    || (supportsRecording() && Boolean(ui.ethnicity.value) && asrUsable(ui.ethnicity.value));
  ui.start.disabled = !selectedDialect || !selectedLevel || !asrOk;
}

function updateQuestionCopy(speech) {
  const key = activity === "translate" ? (speech ? "translateSpeech" : "translateTyping") : activity;
  const [prompt, title] = TITLES[key];
  ui.prompt.textContent = prompt;
  ui.questionTitle.textContent = title;
}

function applyTranslationMode({ focus = false } = {}) {
  if (activity !== "translate") return;
  const speech = answerMode === "speech";
  setHidden(ui.compose, speech);
  setHidden(ui.speech, !speech);
  setHidden(ui.submitRow, speech);
  if (ui.submit) ui.submit.disabled = speech || graded || !ui.answer.value.trim();
  if (speech) {
    if (!graded) ui.record.disabled = !supportsRecording();
    if (focus) ui.record?.focus();
  } else if (focus) {
    ui.answer?.focus();
  }
  updateQuestionCopy(speech);
}

async function init() {
  info = ACTIVITIES[activity];
  document.title = "十二年國教｜族語e樂園 AI 實驗室";
  ui.mission.textContent = `${info.track} · MISSION ${info.mission}`;
  ui.title.textContent = "十二年國教";
  ui.lead.textContent = info.lead;

  ui.ethnicity.insertAdjacentHTML("beforeend", ETHNICITIES.map((name) => `<option value="${name}">${name}</option>`).join(""));
  ui.level.insertAdjacentHTML("beforeend", levelOptions().map((item) => `<option value="${item.level}">${item.text}</option>`).join(""));

  if (supportsRecording()) {
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
          if (acceptRecording) {
            acceptRecording = false;
            gradeSpeech();
          }
        }
      },
      onTick(seconds) { ui.recordTime.textContent = clock(seconds); }
    });
  }

  if (activity === "translate" && ui.inputModeToggle) {
    inputModeControl = wireInputMode({
      root: ui.quiz,
      toggle: ui.inputModeToggle,
      typePanel: ui.compose,
      voicePanel: ui.speech,
      initial: "voice",
      onModeChange(mode) {
        if (graded || pending) return;
        answerMode = mode === "type" ? "typing" : "speech";
        acceptRecording = mode === "voice";
        if (mode === "type") {
          recorder?.clear();
          ui.recordLabel.textContent = "開始錄音";
          ui.recordTime.textContent = "00:00";
          setState("idle");
          ui.record.disabled = true;
        } else {
          ui.answer.value = "";
          ui.record.disabled = !supportsRecording();
          setState("idle");
        }
        applyTranslationMode({ focus: true });
      }
    });
  }

  await verifyServices();
}

async function verifyServices() {
  const notes = [];
  const live = await fetchLiveAsrDialects();
  if (live) {
    const audit = auditAsrModels(ASR_MODELS, live);
    blocked = new Set(audit.unavailable.map((item) => item.ethnicity));
    notes.push(audit.consistent ? "語音辨識服務已連線" : "語音辨識服務已連線，部分族別暫時無法辨識");
  } else {
    notes.push("語音辨識即時清單暫時無法取得，改以內建對照表送出");
  }
  if (activity === "retell") notes.push("先辨識，再把聽到的句子翻成中文");
  if (activity === "translate") notes.push("打字會把句子送去翻譯；錄音先辨識再翻譯");
  notes.push("語意使用 vLLM AI 判別");
  if (!supportsRecording()) notes.push("這個瀏覽器不支援錄音，錄音模式無法使用");
  statusNote = notes.join("；");
  showStatus();
  updateStart();
}

ui.ethnicity.addEventListener("change", () => {
  resetQuiz();
  const choices = DIALECTS.filter((item) => item.ethnicity === ui.ethnicity.value);
  ui.dialect.innerHTML = `<option value="">請選擇方言別</option>${choices.map((item) => `<option value="${item.id}">${item.name}</option>`).join("")}`;
  ui.dialect.disabled = !choices.length;
  selectedDialect = undefined;
  showStatus();
  updateStart();
});

ui.dialect.addEventListener("change", () => {
  resetQuiz();
  selectedDialect = dialectById(ui.dialect.value);
  showStatus();
  updateStart();
});

ui.level.addEventListener("change", () => {
  resetQuiz();
  selectedLevel = Number(ui.level.value) || 0;
  showStatus();
  updateStart();
});

ui.start.addEventListener("click", async () => {
  const token = ++loadToken;
  ui.start.disabled = true;
  ui.api.textContent = "教材載入中…";
  ui.api.dataset.state = "ok";
  try {
    const loaded = await loadShard(selectedDialect.id);
    if (token !== loadToken) return;
    shard = loaded;
    ui.api.textContent = statusNote;
    ui.api.dataset.state = "ok";
    beginRound();
  } catch (error) {
    if (token !== loadToken) return;
    ui.api.textContent = `教材無法載入：${error.message}`;
    ui.api.dataset.state = "error";
    updateStart();
  }
});

ui.again.addEventListener("click", () => beginRound());

function beginRound() {
  round = buildRound({
    shard,
    level: selectedLevel,
    activity,
    size: ROUND_SIZE
  });
  index = 0;
  results = [];
  if (!round.length) {
    ui.api.textContent = "這個階級目前沒有可出的題。";
    ui.api.dataset.state = "fallback";
    updateStart();
    return;
  }
  ui.quiz.hidden = false;
  ui.report.hidden = true;
  showQuestion();
  ui.quiz.scrollIntoView({ behavior: reduced() ? "auto" : "smooth" });
}

function showQuestion() {
  const question = round[index];
  attempt += 1;
  pending = false;
  graded = false;
  acceptRecording = false;

  ui.label.textContent = `${selectedDialect.ethnicity} · ${selectedDialect.name} · ${info.label} · 第 ${question.level} 階第 ${question.lesson} 課`;
  ui.progress.textContent = `第 ${index + 1} / ${round.length} 題`;

  let speech = activity !== "translate";
  if (activity === "translate") {
    const speechAvailable = supportsRecording() && asrUsable(selectedDialect.ethnicity);
    const desired = speechAvailable && answerMode === "speech" ? "voice" : "type";
    answerMode = desired === "voice" ? "speech" : "typing";
    inputModeControl?.setMode(desired);
    if (ui.inputModeToggle) {
      ui.inputModeToggle.disabled = !speechAvailable;
      ui.inputModeToggle.setAttribute(
        "aria-label",
        speechAvailable
          ? answerMode === "speech" ? "目前錄音，按一下改為打字" : "目前打字，按一下改為錄音"
          : "此方言沒有語音辨識，使用打字"
      );
    }
    speech = answerMode === "speech";
  }
  updateQuestionCopy(speech);
  renderHint(question);

  ui.questionText.hidden = activity === "retell";
  ui.questionSubtext.hidden = activity === "retell";
  if (activity === "translate") {
    ui.questionText.textContent = question.chineseText;
    ui.questionSubtext.textContent = `第 ${question.level} 階第 ${question.lesson} 課・${question.lessonTitleCh}`;
  }

  setHidden(ui.compose, activity !== "translate" || speech);
  setHidden(ui.submitRow, activity !== "translate" || speech);
  setHidden(ui.speech, !speech);
  setHidden(ui.audioPanel, activity === "translate");
  ui.audioPanel.classList.remove("is-after-answer");
  setHidden(ui.skipAudio, true);
  ui.result.hidden = true;
  ui.next.hidden = true;
  ui.result.innerHTML = "";
  if (ui.answer) ui.answer.value = "";
  if (ui.submit) {
    ui.submit.disabled = true;
    ui.submit.textContent = "送出答案";
  }
  if (activity === "translate") applyTranslationMode();

  recorder?.clear();
  acceptRecording = speech;
  if (ui.record) {
    ui.record.disabled = speech && activity === "retell";
    ui.recordLabel.textContent = "開始錄音";
    ui.recordTime.textContent = "00:00";
    setState("idle");
  }

  prepareAudio(question.audioUrl);

  if (activity === "translate") {
    if (speech) ui.record?.focus();
    else ui.answer?.focus();
  } else {
    ui.replay?.focus();
  }
}

function prepareAudio(url) {
  ui.player.pause();
  pendingAudioUrl = activity === "translate" ? (url || null) : null;
  if (activity === "translate") {
    // 翻譯在作答前不載入答案音檔，避免從網路預先取得教材句子。
    ui.player.removeAttribute("src");
    ui.player.load?.();
    ui.replay.disabled = true;
  } else {
    if (url) ui.player.src = url;
    else ui.player.removeAttribute("src");
    ui.player.load?.();
    ui.replay.disabled = !url;
  }
  ui.replay.textContent = activity === "retell" ? "播放短句" : "播放教材音檔";
  const messages = {
    retell: "按播放聽短句",
    translate: "作答後可聽教材音檔"
  };
  ui.audioState.textContent = url ? messages[activity] : "本題沒有教材音檔";
  ui.audioState.dataset.state = "idle";
}

ui.replay.addEventListener("click", async () => {
  if (!ui.player.src) return;
  try {
    await ui.player.play();
  } catch {
    markAudioFailed();
  }
});

ui.hintToggle?.addEventListener("click", () => {
  if (!ui.hintPanel) return;
  setHintOpen(ui.hintPanel.hidden);
});

ui.player.addEventListener("playing", () => {
  ui.audioState.textContent = "播放中…";
  ui.audioState.dataset.state = "playing";
});

ui.player.addEventListener("ended", () => {
  ui.audioState.textContent = graded ? "播放完畢" : "播放完畢，可以錄音";
  ui.audioState.dataset.state = "ended";
  if (!graded && activity === "retell") {
    ui.record.disabled = false;
  }
});

ui.player.addEventListener("error", () => {
  if (!ui.player.src) return;
  markAudioFailed();
});

function markAudioFailed() {
  ui.audioState.textContent = "音檔無法播放";
  ui.audioState.dataset.state = "failed";
  if (graded) return;
  if (activity === "retell") {
    ui.skipAudio.hidden = false;
  }
}

ui.skipAudio.addEventListener("click", () => {
  if (graded || pending) return;
  finish({ type: "unavailable", mode: activity }, false, attempt);
});

ui.answer.addEventListener("input", () => {
  if (ui.submit) ui.submit.disabled = graded || !ui.answer.value.trim();
});

ui.answer.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    if (ui.submit && !ui.submit.disabled) ui.submit.click();
  }
});

ui.submit.addEventListener("click", () => {
  const question = round[index];
  if (!question || graded || pending) return;
  if (activity === "translate" && answerMode === "typing") gradeTyping(ui.answer.value);
});

ui.record.addEventListener("click", async () => {
  if (!recorder || graded || pending || ui.record.disabled) return;
  if (recorder.recording) {
    recorder.stop();
    return;
  }
  try {
    await recorder.start();
  } catch (error) {
    const denied = error?.name === "NotAllowedError";
    setState("failed", denied ? "沒有麥克風權限" : "找不到可用的麥克風");
  }
});

async function gradeSpeech() {
  const question = round[index];
  const current = attempt;
  if (!question || graded || pending) return;
  pending = true;
  if (ui.inputModeToggle) ui.inputModeToggle.disabled = true;
  setState("converting");
  let heard = "";
  try {
    const wav = await convertToAsrWav(recorder.blob);
    if (current !== attempt) return;
    setState("transcribing");
    const slowHint = setTimeout(() => setState("slow"), SLOW_HINT_AFTER_MS);
    try {
      heard = await transcribe(wav, selectedDialect.ethnicity, { unavailable: blocked });
    } finally {
      clearTimeout(slowHint);
    }
  } catch {
    finish({ type: "unavailable", heard, mode: activity, inputMode: answerMode }, false, current);
    return;
  }
  if (current !== attempt) return;

  if (activity === "retell") {
    const exact = exactMatch(heard, question.indigenousText, selectedDialect.ethnicity);
    try {
      const translation = await translateToZh(heard, selectedDialect.code);
      const ruleVerdict = verdictFromTranslation({ exact, translation, chineseText: question.chineseText });
      let verdict = ruleVerdict;
      let verdictBy = null;
      let rationale = null;
      if (ruleVerdict === "retry") {
        setState("transcribing", "AI 判別中，請稍候");
        const ai = await judgeAiMeaning({ translation, targetChinese: question.chineseText });
        if (current !== attempt) return;
        if (ai.pass) {
          verdict = "semantic";
          verdictBy = "ai";
          rationale = ai.rationale ?? null;
        }
      }
      finish({
        type: verdict, heard, translation, verdictBy, rationale,
        mode: activity, inputMode: answerMode
      }, true, current);
    } catch {
      finish({ type: exact ? "exact" : "unavailable", heard, mode: activity, inputMode: answerMode }, exact, current);
    }
    return;
  }

  try {
    const result = await judgeAnswer({
      answer: heard,
      question,
      translate: (text) => translateToZh(text, selectedDialect.code),
      ethnicity: selectedDialect.ethnicity,
      aiJudge: judgeAiMeaning
    });
    finish({ ...result, heard, mode: activity, inputMode: answerMode }, true, current);
  } catch {
    finish({ type: "unavailable", heard, mode: activity, inputMode: answerMode }, false, current);
  }
}

async function gradeTyping(answer) {
  const question = round[index];
  const current = attempt;
  if (!question || graded || pending) return;
  const exact = exactMatch(answer, question.indigenousText, selectedDialect.ethnicity);
  pending = true;
  if (ui.inputModeToggle) ui.inputModeToggle.disabled = true;
  if (ui.submit) {
    ui.submit.disabled = true;
    ui.submit.textContent = "判定中…";
  }
  try {
    const translation = await translateToZh(answer, selectedDialect.code);
    const ruleVerdict = verdictFromTranslation({ exact, translation, chineseText: question.chineseText });
    let verdict = ruleVerdict;
    let verdictBy = null;
    let rationale = null;
    if (ruleVerdict === "retry") {
      setState("transcribing", "AI 判別中，請稍候");
      const ai = await judgeAiMeaning({ translation, targetChinese: question.chineseText });
      if (current !== attempt) return;
      if (ai.pass) {
        verdict = "semantic";
        verdictBy = "ai";
        rationale = ai.rationale ?? null;
      }
    }
    finish({
      type: verdict, translation, verdictBy, rationale,
      mode: activity, inputMode: answerMode
    }, true, current);
  } catch {
    finish({ type: exact ? "exact" : "unavailable", mode: activity, inputMode: answerMode }, exact, current);
  }
}

function finish(result, reveal, current) {
  if (current !== attempt || graded) return;
  pending = false;
  graded = true;
  if (ui.submit) {
    ui.submit.disabled = true;
    ui.submit.textContent = "送出答案";
  }
  if (ui.record) ui.record.disabled = true;
  if (ui.inputModeToggle) ui.inputModeToggle.disabled = true;
  setHidden(ui.skipAudio, true);
  results.push(result);

  setHintOpen(false);
  ui.result.hidden = false;
  ui.result.dataset.state = result.type;
  const headlines = {
    exact: ["通過", "與教材字面一致。"],
    semantic: ["通過", "意思與教材相近。"],
    retry: ["未過", "這次和教材不相同。"],
    unavailable: ["不計分", "這題沒有完成判定，不算答錯。"]
  };
  const [headline, detail] = headlines[result.type] || headlines.unavailable;
  const question = round[index];
  const textbook = reveal && result.type !== "unavailable"
    ? `<dt>教材族語</dt><dd>${escapeHtml(question.indigenousText)}</dd>` +
      `<dt>教材中文</dt><dd>${escapeHtml(question.chineseText)}</dd>` +
      `<dt>課別</dt><dd>第 ${question.level} 階第 ${question.lesson} 課・${escapeHtml(question.lessonTitleCh)}</dd>`
    : "";
  const heard = result.heard ? `<dt>辨識</dt><dd>${escapeHtml(result.heard)}</dd>` : "";
  const translation = result.translation ? `<dt>系統懂成</dt><dd>${escapeHtml(result.translation)}</dd>` : "";
  const rationale = result.rationale ? `<p class="judge-rationale">${escapeHtml(result.rationale)}</p>` : "";
  ui.result.innerHTML = `<strong>${headline}</strong><p>${detail}</p>${rationale}${heard || translation || textbook ? `<dl>${heard}${translation}${textbook}</dl>` : ""}`;

  if (activity === "translate") {
    ui.audioPanel.hidden = false;
    ui.audioPanel.classList.add("is-after-answer");
    if (pendingAudioUrl) {
      ui.player.src = pendingAudioUrl;
      ui.player.load?.();
    }
    ui.replay.disabled = !pendingAudioUrl;
    ui.audioState.textContent = pendingAudioUrl ? "可播放教材音檔" : "本題沒有教材音檔";
    ui.audioState.dataset.state = "idle";
  } else if (ui.audioState.dataset.state === "ended") {
    ui.audioState.textContent = "播放完畢";
  }

  ui.next.hidden = false;
  ui.next.textContent = index + 1 >= round.length ? "看本堂結果" : "下一題 →";
  ui.next.focus();
}

ui.next.addEventListener("click", () => {
  index += 1;
  if (index >= round.length) showReport();
  else showQuestion();
});

function showReport() {
  ui.player.pause();
  ui.quiz.hidden = true;
  ui.report.hidden = false;
  const summary = tally(results);
  ui.score.textContent = scoreLabel(summary);
  ui.list.innerHTML = results.map((result, itemIndex) => {
    const label = result.type === "exact" || result.type === "semantic"
      ? "通過"
      : result.type === "retry"
        ? "未過"
        : "不計分";
    return `<li><strong>第 ${itemIndex + 1} 題 · ${label}</strong><p>${escapeHtml(reportDetail(result))}</p></li>`;
  }).join("");
  ui.report.scrollIntoView({ behavior: reduced() ? "auto" : "smooth" });
  updateStart();
}

function resetQuiz() {
  attempt += 1;
  loadToken += 1;
  acceptRecording = false;
  pending = false;
  graded = false;
  ui.player.pause();
  ui.player.removeAttribute("src");
  pendingAudioUrl = null;
  ui.quiz.hidden = true;
  ui.report.hidden = true;
  ui.result.hidden = true;
  setHintOpen(false);
  ui.next.hidden = true;
  ui.result.innerHTML = "";
  round = [];
  results = [];
  index = 0;
  shard = undefined;
  recorder?.clear();
}

window.addEventListener("pagehide", () => {
  ui.player.pause();
  recorder?.clear();
});

export function boot(nextActivity) {
  activity = Object.hasOwn(ACTIVITIES, nextActivity) ? nextActivity : "retell";
  answerMode = "speech";
  init().catch((error) => {
    ui.api.textContent = `初始化失敗：${error.message}`;
    ui.api.dataset.state = "error";
  });
}
