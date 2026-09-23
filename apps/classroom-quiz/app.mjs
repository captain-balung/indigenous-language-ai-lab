import { exactMatch, judgeAnswer } from "../body-parts-practice/core.mjs";
import { DIALECTS, ETHNICITIES, dialectById } from "../body-parts-practice/dialects.mjs";
import { ASR_MODELS, asrModelFor, auditAsrModels, SLOW_HINT_AFTER_MS } from "../body-parts-speaking/asr.mjs";
import { judgeShortAnswerTranslation } from "../beginner-mock-exam/scoring.mjs";
import {
  convertToAsrWav, createRecorder, fetchLiveAsrDialects, supportsRecording, transcribe, translateToZh
} from "../beginner-mock-exam/recorder.mjs";
import {
  MODES, buildRound, modeFromSearch, needsAsr, needsAudio, replyVerdict, reportDetail, scoreLabel, tally, verdictFromTranslation
} from "./core.mjs";

const $ = (selector) => document.querySelector(selector);
const mode = modeFromSearch(location.search);
const modeInfo = MODES[mode];
const ui = {
  mission: $("#mission"), title: $("#page-title"), lead: $("#page-lead"),
  ethnicity: $("#ethnicity"), dialect: $("#dialect"), start: $("#start"), api: $("#api-status"),
  noticeAudio: $("#notice-audio"), noticeMic: $("#notice-mic"),
  quiz: $("#quiz"), label: $("#dialect-label"), progress: $("#progress"), prompt: $("#prompt"), questionTitle: $("#question-title"),
  compose: $("#panel-compose"), meaning: $("#compose-meaning"), oral: $("#panel-oral"),
  audio: $("#panel-audio"), speech: $("#panel-speech"),
  replay: $("#replay"), audioState: $("#audio-state"), player: $("#player"), answer: $("#answer"),
  image: $("#question-image"), record: $("#record"), recordLabel: $("#record-label"), time: $("#record-time"),
  state: $("#record-state"), stateText: $("#record-state-text"),
  submit: $("#submit"), skipAudio: $("#skip-audio"),
  heard: $("#heard"), result: $("#result"), next: $("#next"),
  report: $("#report"), score: $("#score-line"), list: $("#score-list"), again: $("#again")
};

const TITLES = {
  compose: ["造句", "看中文，寫出族語"],
  oral: ["口說", "看圖念出完整句"],
  retell: ["轉述", "聽完後用族語再講一次"],
  reply: ["接話", "聽問句，用族語回答"]
};
const SPEECH = new Set(["oral", "retell", "reply"]);
const STATES = {
  idle: ["●", "尚未錄音"],
  recording: ["◉", "錄音中…再按一次停止"],
  recorded: ["■", "錄音完成"],
  converting: ["◐", "轉檔中…"],
  transcribing: ["◍", "辨識中，請稍候"],
  slow: ["◍", "辨識中，長句需要較久，請不要重新整理"],
  failed: ["△", "這次沒有完成判定"]
};

let selectedDialect, shard, round = [], index = 0, results = [], pending = false, graded = false, attempt = 0, acceptRecording = false;
let blocked = new Set();
let statusNote = "正在確認服務…";
let recorder = null;

function setState(key, override) {
  const [icon, text] = STATES[key] || STATES.idle;
  ui.state.dataset.state = key;
  ui.state.querySelector(".record-state__icon").textContent = icon;
  ui.stateText.textContent = override || text;
}

function clock(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function reduced() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function asrUsable(ethnicity) {
  return Boolean(asrModelFor(ethnicity)) && !blocked.has(ethnicity);
}

async function init() {
  document.title = `${modeInfo.title}｜族語e樂園 AI 實驗室`;
  ui.mission.textContent = `課堂測驗 · MISSION ${modeInfo.mission}`;
  ui.title.textContent = modeInfo.title;
  ui.lead.textContent = modeInfo.lead;
  ui.noticeAudio.hidden = !needsAudio(mode);
  ui.noticeMic.hidden = !needsAsr(mode);
  ui.ethnicity.insertAdjacentHTML("beforeend", ETHNICITIES.map((name) => `<option value="${name}">${name}</option>`).join(""));
  if (needsAsr(mode)) {
    if (!supportsRecording()) {
      ui.api.textContent = "這個瀏覽器不支援錄音。請改用意思考句。";
      ui.api.dataset.state = "error";
      return;
    }
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
      onTick(seconds) { ui.time.textContent = clock(seconds); }
    });
  }
  await verifyServices();
}

async function verifyServices() {
  const notes = [];
  if (needsAsr(mode)) {
    const live = await fetchLiveAsrDialects();
    if (live) {
      const audit = auditAsrModels(ASR_MODELS, live);
      blocked = new Set(audit.unavailable.map((item) => item.ethnicity));
      notes.push(audit.consistent ? "語音辨識服務已連線" : "語音辨識服務已連線，部分族別暫時無法辨識");
    } else {
      notes.push("語音辨識即時清單暫時無法取得，改以內建對照表送出");
    }
  }
  const serviceNote = {
    compose: "每題都會把句子送去翻譯",
    oral: "口說先辨識；與教材字面一致時不另外翻譯",
    retell: "先辨識，再把聽到的句子翻成中文",
    reply: "先辨識，再判斷回答有沒有答到問句"
  };
  notes.push(serviceNote[mode]);
  statusNote = notes.join("；");
  showStatus();
  updateStart();
}

ui.ethnicity.addEventListener("change", () => {
  resetQuiz();
  const choices = DIALECTS.filter((item) => item.ethnicity === ui.ethnicity.value);
  ui.dialect.innerHTML = `<option value="">請選擇方言別</option>${choices.map((item) => `<option value="${item.id}">${item.name}</option>`).join("")}`;
  ui.dialect.disabled = !choices.length;
  showStatus();
  updateStart();
});

ui.dialect.addEventListener("change", () => {
  resetQuiz();
  selectedDialect = dialectById(ui.dialect.value);
  showStatus();
  updateStart();
});

function showStatus() {
  const ethnicity = ui.ethnicity.value;
  if (needsAsr(mode) && ethnicity && !asrUsable(ethnicity)) {
    ui.api.textContent = `${ethnicity}目前無法使用語音辨識。`;
    ui.api.dataset.state = "fallback";
    return;
  }
  ui.api.textContent = statusNote;
  ui.api.dataset.state = "ok";
}

function updateStart() {
  const asrOk = !needsAsr(mode) || (ui.ethnicity.value && asrUsable(ui.ethnicity.value));
  ui.start.disabled = !selectedDialect || !asrOk;
}

ui.start.addEventListener("click", async () => {
  ui.start.disabled = true;
  try {
    const response = await fetch(`/data/klokah-junior/dialects/${selectedDialect.id}.json`);
    if (!response.ok) throw new Error("教材載入失敗");
    shard = await response.json();
    beginRound();
  } catch (error) {
    ui.api.textContent = `教材無法載入：${error.message}`;
    ui.api.dataset.state = "error";
    updateStart();
  }
});

ui.again.addEventListener("click", () => beginRound());

function beginRound() {
  round = buildRound(shard, mode);
  index = 0;
  results = [];
  if (!round.length) {
    ui.api.textContent = "這個方言別目前沒有可出的題。";
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
  ui.label.textContent = `${selectedDialect.ethnicity} · ${selectedDialect.name} · ${MODES[question.mode].title}`;
  ui.progress.textContent = `第 ${index + 1} / ${round.length} 題`;
  const [prompt, title] = TITLES[question.mode];
  ui.prompt.textContent = prompt;
  ui.questionTitle.textContent = title;
  ui.compose.hidden = question.mode !== "compose";
  ui.oral.hidden = question.mode !== "oral";
  ui.audio.hidden = !needsAudio(question.mode);
  ui.speech.hidden = !SPEECH.has(question.mode);
  ui.submit.hidden = question.mode !== "compose";
  ui.submit.disabled = true;
  ui.skipAudio.hidden = true;
  ui.heard.hidden = true;
  ui.result.hidden = true;
  ui.next.hidden = true;
  ui.answer.value = "";
  recorder?.clear();
  acceptRecording = SPEECH.has(question.mode);
  if (ui.record) {
    ui.record.disabled = false;
    ui.recordLabel.textContent = "開始錄音";
    ui.time.textContent = "00:00";
    setState("idle");
  }
  if (question.mode === "compose") {
    ui.meaning.textContent = question.chineseText;
    ui.answer.focus();
  }
  if (needsAudio(question.mode)) {
    ui.replay.textContent = question.mode === "reply" ? "播放問句" : "播放短句";
    prepareAudio(question.audioUrl);
    ui.replay.focus();
  }
  if (question.mode === "oral") {
    ui.image.src = question.imageSrc;
    ui.image.alt = `請用族語說出圖片內容（${selectedDialect.name}）`;
    ui.record.focus();
  }
}

function prepareAudio(url) {
  ui.player.pause();
  ui.player.src = url;
  ui.audioState.textContent = "按播放聽短句";
  ui.audioState.dataset.state = "idle";
  ui.replay.disabled = !url;
}

ui.replay.addEventListener("click", async () => {
  if (!ui.player.src || graded) return;
  ui.audioState.textContent = "播放中";
  ui.audioState.dataset.state = "playing";
  try {
    await ui.player.play();
  } catch {
    markAudioFailed();
  }
});

ui.player.addEventListener("ended", () => {
  ui.audioState.textContent = "播放完畢，可以再聽一次";
  ui.audioState.dataset.state = "ended";
});

ui.player.addEventListener("error", () => {
  if (ui.audio.hidden || !ui.player.src) return;
  markAudioFailed();
});

function markAudioFailed() {
  ui.audioState.textContent = "音檔無法播放";
  ui.audioState.dataset.state = "failed";
  ui.skipAudio.hidden = graded;
}

ui.answer.addEventListener("input", () => {
  ui.submit.disabled = graded || !ui.answer.value.trim();
});

ui.record?.addEventListener("click", async () => {
  if (!recorder || graded || pending || ui.record.disabled) return;
  if (recorder.recording) { recorder.stop(); return; }
  try {
    await recorder.start();
  } catch (error) {
    const denied = error?.name === "NotAllowedError";
    setState("failed", denied ? "沒有麥克風權限" : "找不到可用的麥克風");
  }
});

ui.submit.addEventListener("click", () => {
  const question = round[index];
  if (!question || graded || pending) return;
  if (question.mode === "compose") gradeCompose(ui.answer.value);
});

ui.skipAudio.addEventListener("click", () => {
  if (graded || pending) return;
  finish({ type: "unavailable", mode: round[index].mode }, false, attempt);
});

async function gradeCompose(answer) {
  const question = round[index];
  const current = attempt;
  pending = true;
  ui.submit.disabled = true;
  const exact = exactMatch(answer, question.indigenousText);
  try {
    const translation = await translateToZh(answer, selectedDialect.code);
    finish({
      type: verdictFromTranslation({ exact, translation, chineseText: question.chineseText }),
      translation,
      mode: "compose"
    }, true, current);
  } catch {
    finish({ type: exact ? "exact" : "unavailable", mode: "compose" }, exact, current);
  }
}

async function gradeSpeech() {
  const question = round[index];
  const current = attempt;
  if (!question || graded || pending) return;
  pending = true;
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
    finish({ type: "unavailable", heard, mode: question.mode }, question.mode !== "reply", current);
    return;
  }
  if (current !== attempt) return;
  ui.heard.hidden = false;
  ui.heard.innerHTML = `<strong>系統聽到的是</strong><p class="heard-text">${escapeHtml(heard)}</p>`;
  if (question.mode === "reply") {
    try {
      const translation = await translateToZh(heard, selectedDialect.code);
      finish({
        type: replyVerdict(judgeShortAnswerTranslation(question.chineseText, translation)),
        heard,
        translation,
        mode: "reply"
      }, false, current);
    } catch {
      finish({ type: "unavailable", heard, mode: "reply" }, false, current);
    }
    return;
  }
  if (question.mode === "retell") {
    const exact = exactMatch(heard, question.indigenousText);
    try {
      const translation = await translateToZh(heard, selectedDialect.code);
      finish({
        type: verdictFromTranslation({ exact, translation, chineseText: question.chineseText }),
        heard,
        translation,
        mode: "retell"
      }, true, current);
    } catch {
      finish({ type: exact ? "exact" : "unavailable", heard, mode: "retell" }, exact, current);
    }
    return;
  }
  const result = await judgeAnswer({
    answer: heard,
    question,
    translate: (text) => translateToZh(text, selectedDialect.code)
  });
  finish({ ...result, heard, mode: "oral" }, true, current);
}

function finish(result, reveal, current) {
  if (current !== attempt || graded) return;
  pending = false;
  graded = true;
  ui.submit.disabled = true;
  ui.record.disabled = true;
  ui.skipAudio.hidden = true;
  results.push(result);
  ui.result.hidden = false;
  ui.result.dataset.state = result.type;
  const headlines = {
    exact: ["通過", result.translation ? "字面與教材一致。下方是系統懂成的中文。" : "與教材字面一致，沒有呼叫翻譯。"],
    semantic: ["通過", "意思與教材相近。"],
    retry: ["未過", "這次和教材不相同。"],
    unavailable: ["不計分", "這題沒有完成判定，不算答錯。"]
  };
  let [headline, detail] = headlines[result.type] || headlines.unavailable;
  if (result.mode === "reply" && result.type === "semantic") [headline, detail] = ["通過", "有答到問句。"];
  if (result.mode === "reply" && result.type === "retry") [headline, detail] = ["未過", "這次沒有答到問句。"];
  const question = round[index];
  const textbook = result.mode === "reply"
    ? `<dt>問句</dt><dd>${escapeHtml(question.chineseText)}</dd>`
    : reveal && result.type !== "unavailable"
      ? `<dt>教材族語</dt><dd>${escapeHtml(question.indigenousText)}</dd><dt>教材中文</dt><dd>${escapeHtml(question.chineseText)}</dd>`
      : "";
  const translation = result.translation ? `<dt>系統懂成</dt><dd>${escapeHtml(result.translation)}</dd>` : "";
  ui.result.innerHTML = `<strong>${headline}</strong><p>${detail}</p>${translation || textbook ? `<dl>${translation}${textbook}</dl>` : ""}`;
  ui.next.hidden = false;
  ui.next.textContent = index + 1 >= round.length ? "看本堂分數" : "下一題 →";
  ui.next.focus();
}

ui.next.addEventListener("click", () => {
  index += 1;
  if (index >= round.length) showReport();
  else showQuestion();
});

function showReport() {
  ui.quiz.hidden = true;
  ui.report.hidden = false;
  const summary = tally(results);
  ui.score.textContent = scoreLabel(summary);
  ui.list.innerHTML = results.map((result, itemIndex) => {
    const label = result.type === "exact" || result.type === "semantic" ? "通過" : result.type === "retry" ? "未過" : "不計分";
    return `<li><strong>第 ${itemIndex + 1} 題 · ${escapeHtml(MODES[result.mode].title)} · ${label}</strong><p>${escapeHtml(reportDetail(result))}</p></li>`;
  }).join("");
  ui.report.scrollIntoView({ behavior: reduced() ? "auto" : "smooth" });
  updateStart();
}

function resetQuiz() {
  attempt += 1;
  acceptRecording = false;
  ui.player.pause();
  selectedDialect = undefined;
  shard = undefined;
  round = [];
  results = [];
  ui.quiz.hidden = true;
  ui.report.hidden = true;
  recorder?.clear();
}

window.addEventListener("pagehide", () => {
  ui.player.pause();
  recorder?.clear();
});

init();
