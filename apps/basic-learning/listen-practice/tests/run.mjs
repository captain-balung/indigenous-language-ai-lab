import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordsForTheme, themeById } from "../../body-parts-practice/themes.mjs";
import { indigenousKey, listenRecords, pickChoices } from "../core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const page = read("apps/basic-learning/listen-practice/index.html");
const appSource = read("apps/basic-learning/listen-practice/app.mjs");
const appCode = stripComments(appSource);

assert.ok(page.includes('lang="zh-Hant"'));
assert.ok(page.includes("聽音練習"));
assert.ok(page.includes('href="/apps/basic-learning/body-parts-practice/styles.css"'));
assert.ok(page.includes('href="/apps/basic-learning/listen-practice/styles.css"'));
assert.ok(page.includes('src="/apps/basic-learning/listen-practice/app.mjs"'));
assert.ok(!page.includes('href="styles.css"'));
assert.ok(!page.includes("對方會看到你的 IP"));
assert.ok(!page.includes("音檔來自族語 E 樂園"));
assert.ok(page.includes("選圖") && page.includes("選意思"));
assert.ok(page.includes("/apps/basic-learning/body-parts-practice/") && page.includes("/apps/basic-learning/body-parts-speaking/"));
assert.ok(page.includes("CC BY-NC-SA 4.0"));
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(appCode), "不得寫入瀏覽器儲存");
assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(page + appSource), "介面不得使用 emoji");
assert.ok(appCode.includes("prefers-reduced-motion"));
assert.ok(!/crossorigin/.test(appCode), "音檔不得加 crossorigin");

const junior1 = JSON.parse(read("data/klokah-junior/dialects/1.json"));
const jobs1 = JSON.parse(read("data/elementary-jobs/dialects/1.json"));
const animals = listenRecords(recordsForTheme(themeById("animals"), junior1, jobs1));
assert.equal(animals.length, 10);
assert.ok(animals.every((item) => item.audioUrl.startsWith("https://klokah.tw/")));
const jobs = listenRecords(recordsForTheme(themeById("jobs"), junior1, jobs1));
assert.equal(jobs.length, 6);
assert.ok(jobs.every((item) => item.audioUrl.startsWith("https://web.klokah.tw/")));

const chicken = animals.find((item) => item.chineseText.includes("雞"));
const bird = animals.find((item) => item.chineseText.includes("鳥"));
assert.ok(chicken && bird);
assert.equal(indigenousKey(chicken.indigenousText), indigenousKey(bird.indigenousText));
for (let i = 0; i < 40; i += 1) {
  const choices = pickChoices(chicken, animals);
  assert.equal(choices.length, 3);
  assert.ok(choices.some((item) => item.id === chicken.id));
  assert.ok(!choices.some((item) => item.id === bird.id), "同音項不得並列");
}

const people = listenRecords(recordsForTheme(themeById("people"), junior1, jobs1));
const teacher = people.find((item) => item.chineseText.includes("老師"));
const teacherChoices = pickChoices(teacher, people, () => 0);
assert.equal(teacherChoices.length, 3);
assert.ok(teacherChoices.some((item) => item.id === teacher.id));

console.log("PASS: listen practice themes, homophones, audio hotlinks, no storage");
