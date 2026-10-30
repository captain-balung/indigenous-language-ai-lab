const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const script = fs.readFileSync(path.join(root, "app.js"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(html.includes('lang="zh-Hant"'), "HTML language must be zh-Hant");
assert(html.includes("22 項") && html.includes("二十二項"), "Homepage copy must say 22 applications");
assert(!html.includes("20 項") && !html.includes("二十項"), "Homepage must not still say 20 applications");
assert(html.includes('id="applications"'), "Main application landmark is missing");
assert(css.includes("prefers-reduced-motion"), "Reduced-motion support is missing");
assert(css.includes("@media (max-width: 560px)"), "Mobile breakpoint is missing");
assert(!/(https?:)?\/\//.test(html.replace(/https:\/\/openapi\.vercel\.sh/g, "")), "Runtime HTML must not load remote resources");
assert(!/[\u{1F300}-\u{1FAFF}]/u.test(html + script), "Runtime interface must not use emoji pictograms");

const captured = {};
const documentStub = {
  querySelector(selector) {
    if (!captured[selector]) captured[selector] = { innerHTML: "" };
    return captured[selector];
  },
  querySelectorAll() { return []; }
};

const { categories, applications } = vm.runInNewContext(
  `(() => { ${script.replace(/document\.querySelectorAll[\s\S]*$/, "")} return { categories, applications }; })()`,
  { document: documentStub }
);

assert(categories.length === 5, `Expected 5 categories, received ${categories.length}`);
assert(applications.length === 22, `Expected 22 applications, received ${applications.length}`);
assert(applications[0].title === "十二年國教" && applications[0].status === "available" && applications[0].href === "apps/basic-learning/twelve-listen-retell/", "First basics card must link to twelve-year listen-and-repeat");
assert(applications[1].title === "跟唸" && applications[1].status === "available" && applications[1].href === "apps/classroom-quiz/listen-retell/", "Second basics card must link to listen-and-repeat");
assert(applications[2].title === "看圖口說練習" && applications[2].status === "available" && applications[2].href === "apps/basic-learning/body-parts-speaking/", "Third basics card must link to picture speaking practice");
assert(applications[3].title === "問答練習" && applications[3].status === "available" && applications[3].href === "apps/basic-learning/qa-practice/", "Fourth basics card must link to Q&A practice");
assert(applications[4].title === "看圖描述" && applications[4].status === "available" && applications[4].href === "apps/basic-learning/describe-practice/", "Fifth basics card must link to picture-describe practice");
assert(applications[5].title === "十二年國教" && applications[5].status === "available" && applications[5].href === "apps/classroom-quiz/twelve/", "First classroom card must link to the twelve-year hub");
assert(applications[6].title === "發音練習" && applications[6].href === "apps/classroom-quiz/picture-speaking-quiz/", "Classroom pronunciation card");
assert(applications[7].title === "意思造句" && applications[7].href === "apps/classroom-quiz/meaning-sentence/", "Classroom compose card");
assert(applications[8].title === "問答測驗" && applications[8].href === "apps/classroom-quiz/question-reply/", "Classroom reply card");
assert(applications[9].title === "看圖測驗" && applications[9].href === "apps/classroom-quiz/picture-quiz/", "Classroom picture-set card");
assert(!applications.some((app) => app.title === "聽音練習" || app.href === "apps/basic-learning/listen-practice/"), "Listen practice must stay off the homepage");
assert(!applications.some((app) => app.title === "看圖練習" || app.href === "apps/basic-learning/body-parts-practice/"), "Typing picture practice must stay off the homepage");
assert(applications[10].title === "初級口說模擬站" && applications[10].status === "available" && applications[10].href === "apps/certification-mock/beginner-mock-exam/", "First certification card must link to the beginner mock exam");
assert(applications[11].title === "中級模擬站" && applications[11].status === "available" && applications[11].href === "apps/certification-mock/intermediate-mock-exam/", "Second certification card must link to the intermediate mock exam");
assert(applications[14].title === "部落大小事" && applications[14].status === "available" && applications[14].href === "apps/scenario-practice/village-life/", "First scenario card must link to the village-life role play");
assert(applications[15].title === "市場小幫手" && applications[15].status === "coming-soon" && applications[15].href === "", "Market-helper card stays under wraps on the homepage; the app is reachable by URL only");
assert(applications.slice(16, 18).every((app) => app.status === "coming-soon"), "The other scenario cards stay coming-soon");
assert(applications.filter((app) => app.status === "available").every((app) => {
  const clean = app.href.split("?")[0].replace(/\/$/, "");
  return fs.existsSync(path.join(root, clean, "index.html"));
}), "Every available card must point at a real page");
const categoryCounts = { basics: 5, classroom: 5, certification: 4, scenarios: 4, interaction: 4 };
for (const category of categories) {
  assert(applications.filter((app) => app.categoryId === category.id).length === categoryCounts[category.id], `${category.title} must have ${categoryCounts[category.id]} applications`);
}
const sections = captured["#category-sections"].innerHTML;
assert((sections.match(/data-carousel-prev/g) || []).length === 2, "Only categories with more than four cards should show a carousel");
assert(sections.includes('id="basics"') && sections.includes('id="classroom"'), "Carousel categories must remain in place");
assert(/\.card-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*1fr\)/.test(css), "Desktop card grid must stay four columns");
for (const app of applications) {
  for (const field of ["id", "categoryId", "title", "description", "icon", "status", "href", "openInNewTab", "tags", "order"]) {
    assert(Object.hasOwn(app, field), `${app.id} is missing ${field}`);
  }
  if (app.status !== "available") assert(!app.href, `${app.id} must not have a placeholder link`);
  assert(app.icon.startsWith("assets/icons/") && app.icon.endsWith(".webp"), `${app.id} must use the unified raster icon system`);
}

console.log("PASS: 5 categories, 22 data-driven cards, responsive and accessibility contracts");
