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
assert(html.includes("20 項") && html.includes("二十項"), "Homepage copy must say 20 applications");
assert(!html.includes("二十一項"), "Homepage must not still say 21 applications");
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
assert(applications.length === 20, `Expected 20 applications, received ${applications.length}`);
assert(applications[0].title === "看圖練習" && applications[0].status === "available" && applications[0].href === "apps/body-parts-practice/", "First basics card must link to picture practice");
assert(applications[1].title === "口說練習" && applications[1].status === "available" && applications[1].href === "apps/body-parts-speaking/", "Second basics card must link to speaking practice");
assert(applications[2].title === "問答練習" && applications[2].status === "available" && applications[2].href === "apps/qa-practice/", "Third basics card must link to Q&A practice");
assert(applications[3].title === "看圖描述" && applications[3].status === "available" && applications[3].href === "apps/describe-practice/", "Fourth basics card must link to picture-describe practice");
assert(applications[4].title === "意思造句" && applications[4].href === "apps/classroom-quiz/?mode=compose", "Classroom compose card");
assert(applications[5].title === "看圖口說小考" && applications[5].href === "apps/classroom-quiz/?mode=oral", "Classroom oral card");
assert(applications[6].title === "聽後轉述" && applications[6].href === "apps/classroom-quiz/?mode=retell", "Classroom retell card");
assert(applications[7].title === "接話小考" && applications[7].href === "apps/classroom-quiz/?mode=reply", "Classroom reply card");
assert(!applications.some((app) => app.title === "聽音練習" || app.href === "apps/listen-practice/"), "Listen practice must stay off the homepage");
assert(applications[8].title === "初級模擬站" && applications[8].status === "available" && applications[8].href === "apps/beginner-mock-exam/", "First certification card must link to the beginner mock exam");
assert(applications[9].title === "中級模擬站" && applications[9].status === "available" && applications[9].href === "apps/intermediate-mock-exam/", "Second certification card must link to the intermediate mock exam");
assert(applications.filter((app) => app.status === "available").every((app) => {
  const clean = app.href.split("?")[0].replace(/\/$/, "");
  return fs.existsSync(path.join(root, clean, "index.html"));
}), "Every available card must point at a real page");
for (const category of categories) {
  assert(applications.filter((app) => app.categoryId === category.id).length === 4, `${category.title} must have 4 applications`);
}
assert(!captured["#category-sections"].innerHTML.includes("上一張"), "Four-card categories must not show a carousel");
assert(/\.card-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*1fr\)/.test(css), "Desktop card grid must stay four columns");
for (const app of applications) {
  for (const field of ["id", "categoryId", "title", "description", "icon", "status", "href", "openInNewTab", "tags", "order"]) {
    assert(Object.hasOwn(app, field), `${app.id} is missing ${field}`);
  }
  if (app.status !== "available") assert(!app.href, `${app.id} must not have a placeholder link`);
  assert(app.icon.startsWith("assets/icons/") && app.icon.endsWith(".webp"), `${app.id} must use the unified raster icon system`);
}

console.log("PASS: 5 categories, 20 data-driven cards, responsive and accessibility contracts");
