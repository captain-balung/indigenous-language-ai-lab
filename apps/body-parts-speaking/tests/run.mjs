import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeAnswer, exactMatch, semanticMatch, createQuestionDeck, createSingleFlight, judgeAnswer } from "../../body-parts-practice/core.mjs";
import { DIALECTS, ETHNICITIES } from "../../body-parts-practice/dialects.mjs";
import { ASR_MODELS, asrModelFor, auditAsrModels, encodeWav, readAsrText, ASR_TARGET_SAMPLE_RATE, ASR_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from "../asr.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const app = fs.readFileSync(path.join(root, "apps/body-parts-speaking/app.mjs"), "utf8");
const page = fs.readFileSync(path.join(root, "apps/body-parts-speaking/index.html"), "utf8");

/* ---------- 頁面連結一律絕對路徑（沿用 01 的規則） ---------- */
assert.ok(page.includes('href="/apps/body-parts-speaking/styles.css"'));
assert.ok(page.includes('src="/apps/body-parts-speaking/app.mjs"'));
assert.ok(page.includes('href="/apps/body-parts-practice/styles.css"'), "沿用 01 的視覺系統");
assert.ok(!page.includes('href="styles.css"'));
assert.ok(page.includes('href="/"'), "必須有返回 AI 實驗室的連結");
assert.ok(page.includes("/apps/body-parts-practice/"), "需提供打字版的替代路徑");

/* ---------- §4 族 → ASR 族級模型：16 對 16，寫死不推導 ---------- */
const models = Object.entries(ASR_MODELS);
assert.equal(models.length, 16, "ASR 模型對照必須恰為 16 族");
assert.equal(new Set(models.map(([, id]) => id)).size, 16, "模型 ID 必須唯一");
assert.equal(ETHNICITIES.length, 16);
for (const ethnicity of ETHNICITIES) {
  assert.ok(asrModelFor(ethnicity), `${ethnicity} 必須有對應的 ASR 模型`);
  assert.ok(/^formosan_[a-z]{3}$/.test(asrModelFor(ethnicity)), `${ethnicity} 的模型 ID 格式不符`);
}
// 對照表不得多出 dialects.mjs 沒有的族
for (const [ethnicity] of models) assert.ok(ETHNICITIES.includes(ethnicity), `${ethnicity} 不在教材族別清單中`);

/* ---------- §4 陷阱專項：trv 前綴分屬兩個模型 ---------- */
const sediq = DIALECTS.filter((d) => d.ethnicity === "賽德克");
assert.equal(sediq.length, 3);
for (const dialect of sediq) {
  assert.ok(dialect.code.startsWith("trv_"), `${dialect.name} 的 NLLB 代碼應為 trv_ 前綴`);
  assert.equal(asrModelFor(dialect.ethnicity), "formosan_sdq",
    `${dialect.name}（${dialect.code}）必須送 formosan_sdq，不得因 trv 前綴送進太魯閣模型`);
}
const truku = DIALECTS.filter((d) => d.ethnicity === "太魯閣");
assert.equal(truku.length, 1);
assert.equal(truku[0].code, "trv_Truk");
assert.equal(asrModelFor(truku[0].ethnicity), "formosan_trv");
// 兩者的 NLLB 前綴相同、ASR 模型必須不同
assert.equal(sediq[0].code.slice(0, 3), truku[0].code.slice(0, 3));
assert.notEqual(asrModelFor("賽德克"), asrModelFor("太魯閣"));
// 原始碼不得出現以代碼前綴推導模型的寫法
assert.ok(!/code\.(slice|startsWith|substring)/.test(app), "不得由 NLLB 代碼前綴推導 ASR 模型");
assert.ok(!/replace\(.*formosan/.test(app), "不得由字串拼接推導 ASR 模型");

/* ---------- 42 方言全部對得到模型 ---------- */
for (const dialect of DIALECTS) {
  assert.ok(asrModelFor(dialect.ethnicity), `${dialect.name} 對不到 ASR 模型`);
}

/* ---------- §11.1-2 對照表與即時清單的三條分支 ---------- */
const liveAll = Object.values(ASR_MODELS);
{ // ① 完全一致
  const audit = auditAsrModels(ASR_MODELS, liveAll);
  assert.equal(audit.consistent, true);
  assert.equal(audit.available.length, 16);
  assert.equal(audit.unavailable.length, 0);
  assert.equal(audit.unknownFromApi.length, 0);
}
{ // ② 對照表有、即時清單沒有 → 標為不可用，且不得改配其他模型
  const audit = auditAsrModels(ASR_MODELS, liveAll.filter((id) => id !== "formosan_sdq"));
  assert.equal(audit.consistent, false);
  assert.equal(audit.unavailable.length, 1);
  assert.equal(audit.unavailable[0].ethnicity, "賽德克");
  assert.ok(audit.unavailable[0].reason);
  assert.equal(audit.available.length, 15);
  assert.equal(asrModelFor("賽德克"), "formosan_sdq", "不得因為對不上就改配模型");
}
{ // ③ 即時清單有、對照表沒有 → 記為未知，不得硬塞給任何族
  const audit = auditAsrModels(ASR_MODELS, [...liveAll, "formosan_new"]);
  assert.equal(audit.consistent, false);
  assert.equal(audit.unknownFromApi.length, 1);
  assert.equal(audit.unknownFromApi[0].model, "formosan_new");
  assert.equal(audit.available.length, 16);
  assert.ok(!Object.values(ASR_MODELS).includes("formosan_new"));
}
{ // 空清單不得靜默放行
  const audit = auditAsrModels(ASR_MODELS, []);
  assert.equal(audit.unavailable.length, 16);
  assert.equal(audit.available.length, 0);
}
assert.ok(app.includes("console.warn"), "漂移必須明確警告，不得靜默吞掉");

/* ---------- §11.1-3 轉檔輸出為 16 kHz／單聲道／16-bit RIFF/WAVE ---------- */
assert.equal(ASR_TARGET_SAMPLE_RATE, 16000);
const samples = new Float32Array(ASR_TARGET_SAMPLE_RATE);
for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin((2 * Math.PI * 440 * i) / ASR_TARGET_SAMPLE_RATE) * 0.5;
const wav = Buffer.from(encodeWav(samples, ASR_TARGET_SAMPLE_RATE));
assert.equal(wav.slice(0, 4).toString("ascii"), "RIFF");
assert.equal(wav.slice(8, 12).toString("ascii"), "WAVE");
assert.equal(wav.slice(12, 16).toString("ascii"), "fmt ");
assert.equal(wav.slice(36, 40).toString("ascii"), "data");
assert.equal(wav.readUInt16LE(20), 1, "必須是 PCM");
assert.equal(wav.readUInt16LE(22), 1, "必須是單聲道");
assert.equal(wav.readUInt32LE(24), 16000, "必須是 16 kHz");
assert.equal(wav.readUInt16LE(34), 16, "必須是 16-bit");
assert.equal(wav.readUInt32LE(28), 32000);
assert.equal(wav.readUInt16LE(32), 2);
assert.equal(wav.length, 44 + samples.length * 2);
assert.equal(wav.readUInt32LE(4), wav.length - 8);
assert.equal(wav.readUInt32LE(40), samples.length * 2);
{ // 超出範圍要夾住而非溢位
  const loud = Buffer.from(encodeWav(Float32Array.from([2, -2]), ASR_TARGET_SAMPLE_RATE));
  assert.equal(loud.readInt16LE(44), 32767);
  assert.equal(loud.readInt16LE(46), -32768);
}
assert.ok(app.includes("decodeAudioData") && app.includes("OfflineAudioContext"), "轉檔必須用 Web Audio，不引外部函式庫");
assert.ok(!/import\s+[^"]*from\s+"https?:/.test(app), "不得引入 CDN");

/* ---------- §11.1-4 轉檔失敗不得送出原始錄音 ---------- */
const convertBlock = app.slice(app.indexOf("let wav;"), app.indexOf("setState(\"transcribing\")"));
assert.ok(convertBlock.includes("轉檔失敗，沒有送出"));
assert.ok(convertBlock.includes("return;"), "轉檔失敗必須直接 return");
assert.ok(!convertBlock.includes("transcribe("), "轉檔失敗的分支內不得呼叫辨識");
assert.ok(app.indexOf("convertToAsrWav(recordedBlob)") < app.indexOf("await transcribe("), "必須先轉檔才送出");
assert.ok(app.includes('form.append("audio", wav'), "送出的必須是轉檔後的 WAV");
assert.ok(!/form\.append\("audio", recordedBlob/.test(app), "絕不送出原始錄音");

/* ---------- §5 錄音組態與逾時 ---------- */
assert.equal(ASR_TIMEOUT_MS, 45000);
assert.equal(REQUEST_TIMEOUT_MS, 20000);
assert.ok(/echoCancellation:\s*false/.test(app));
assert.ok(/noiseSuppression:\s*false/.test(app));
assert.ok(/autoGainControl:\s*false/.test(app));
assert.ok(/channelCount:\s*1/.test(app));
assert.ok(/catch[\s\S]{0,400}?getUserMedia\(\{\s*audio:\s*true\s*\}\)/.test(app), "約束不支援時要優雅退回");
assert.ok(/NotAllowedError/.test(app) && /NotFoundError/.test(app), "拒絕權限與無裝置要分別處理");

/* ---------- §6.2 紅線：不得斷言使用者念錯 ---------- */
assert.ok(page.includes("系統聽到的是") || app.includes("系統聽到的是"), "必須顯示系統聽到的內容");
assert.ok(app.includes("不代表你念錯"));
for (const forbidden of ["你念錯", "發音不正確", "發音錯誤", "念錯了"]) {
  assert.ok(!new RegExp(forbidden).test(app.replace(/不代表你念錯/g, "")), `措辭不得出現「${forbidden}」`);
}
assert.ok(app.includes("尚未被判錯"), "辨識失敗不得記為答錯");

/* ---------- §7 隱私：錄音不得落地 ---------- */
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(app), "錄音與答案不得寫入本機儲存");
assert.ok(app.includes("URL.revokeObjectURL"), "錄音物件 URL 必須釋放");
assert.ok(page.includes("ai3.iformosa.com.tw"), "隱私揭露必須寫明送往的服務");
assert.ok(page.includes("請不要錄入個人資料或不希望外流的內容"));
assert.ok(page.indexOf("notice--privacy") < page.indexOf('id="quiz"'), "揭露必須在錄音介面之前就看得到");
const ignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
for (const ext of ["wav", "mp3", "ogg", "flac", "m4a", "webm"]) {
  assert.ok(ignore.includes(`*.${ext}`), `.gitignore 必須擋住 *.${ext}`);
}

/* ---------- §3 族級模型揭露 ---------- */
assert.ok(page.includes("16 個族級模型"));
assert.ok(page.includes("不代表你念錯"));
assert.ok(page.indexOf("族級") < page.indexOf('id="quiz"'), "族級揭露必須在送出前看得到");

/* ---------- §11.1-5 判定 fixture（沿用 01 的判定邏輯） ---------- */
assert.equal(normalizeAnswer("  O  ngoso’  kinian . "), "O ngoso' kinian.");
const q = { indigenousText: "U tangila kiniyan.", chineseText: "這是耳朵。" };
let calls = 0;
assert.equal((await judgeAnswer({ answer: q.indigenousText, question: q, translate: async () => { calls += 1; return "耳朵"; } })).type, "exact");
assert.equal(calls, 0, "完全相符不得呼叫翻譯 API");
assert.equal((await judgeAnswer({ answer: " U  tangila kiniyan . ", question: q, translate: async () => { calls += 1; return "耳朵"; } })).type, "exact");
assert.equal(calls, 0, "只有排版差異仍屬完全相符");
assert.ok(!exactMatch("tangila", q.indigenousText), "少字不得被完全比對放行");
assert.equal((await judgeAnswer({ answer: "tangila", question: q, translate: async () => "這是耳朵。" })).type, "semantic");
assert.equal((await judgeAnswer({ answer: "tangila", question: q, translate: async () => "耳朵" })).type, "semantic");
assert.equal((await judgeAnswer({ answer: "ngangus", question: q, translate: async () => "這是鼻子。" })).type, "retry");
assert.equal((await judgeAnswer({ answer: "x", question: q, translate: async () => { throw new Error("502"); } })).type, "unavailable");
assert.ok(semanticMatch("這是頭髮。", "這是頭髮。") && !semanticMatch("這是頭。", "這是頭髮。"), "較長詞優先");

/* ---------- ASR 回應解讀：任何異常都不得當成念錯 ---------- */
assert.equal(readAsrText({ ok: true, data: { text: " Talacowa kiso. " } }, 200), "Talacowa kiso.");
assert.throws(() => readAsrText({ ok: true, data: { text: "" } }, 200), /沒有回傳文字/);
assert.throws(() => readAsrText({ ok: true, data: {} }, 200), /沒有回傳文字/);
assert.throws(() => readAsrText({ ok: false, error: "boom" }, 200), /boom/);
assert.throws(() => readAsrText({ ok: true, data: { text: "x" } }, 502), /HTTP 502/);
assert.throws(() => readAsrText(null, 200), /有效 JSON/);

/* ---------- §11.1-6 單次送出與切換方言清空 ---------- */
let flights = 0; let release;
const gate = new Promise((resolve) => { release = resolve; });
const single = createSingleFlight(async () => { flights += 1; await gate; return "done"; });
const first = single(); const second = single();
assert.equal(first, second, "重複點擊只能產生一個有效請求");
release(); await Promise.all([first, second]);
assert.equal(flights, 1);
assert.ok(/function resetQuiz\(\)[\s\S]{0,320}clearRecording\(\)/.test(app), "切換語別必須清除舊錄音");
assert.ok(/function resetQuiz\(\)[\s\S]{0,320}ui\.heard\.hidden = true/.test(app), "切換語別必須清除舊辨識結果");
assert.ok(/function nextQuestion\(\)[\s\S]{0,600}clearRecording\(\)/.test(app), "下一題必須清除舊錄音");

/* ---------- 抽題不重複 ---------- */
const dataset = JSON.parse(fs.readFileSync(path.join(root, "data/body-parts/dataset.json"), "utf8"));
assert.equal(dataset.dialectCount, 42);
assert.equal(dataset.recordCount, 420);
const deck = createQuestionDeck(dataset.records.filter((r) => r.dialectId === 1), () => 0.5);
assert.equal(new Set(Array.from({ length: 10 }, () => deck.next().id)).size, 10);

/* ---------- 未動到 01 ---------- */
const practiceApp = fs.readFileSync(path.join(root, "apps/body-parts-practice/app.mjs"), "utf8");
assert.ok(!practiceApp.includes("asr.mjs"), "01 不得被本次改動");
assert.ok(!practiceApp.includes("MediaRecorder"), "01 仍是打字版");

console.log("PASS: 16 ASR models, sediq/truku trap, 3 audit branches, 16k mono WAV, no-silent-fallback, judgement fixtures");
