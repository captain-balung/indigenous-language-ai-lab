import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const script = fs.readFileSync(path.join(root, "app.js"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(html.includes('lang="zh-Hant"'), "HTML language must be zh-Hant");
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
assert(applications[0].title === "身體部位練習" && applications[0].status === "available" && applications[0].href === "apps/body-parts-practice/", "First basics card must link to body parts practice");
assert(applications[1].title === "身體部位口說練習" && applications[1].status === "available" && applications[1].href === "apps/body-parts-speaking/", "Second basics card must link to body parts speaking");
assert(applications[8].title === "初級模擬站" && applications[8].status === "available" && applications[8].href === "apps/beginner-mock-exam/", "First certification card must link to the beginner mock exam");
assert(applications.filter((app) => app.status === "available").every((app) => fs.existsSync(path.join(root, app.href, "index.html"))), "Every available card must point at a real page");
for (const category of categories) {
  assert(applications.filter((app) => app.categoryId === category.id).length === 4, `${category.title} must have 4 applications`);
}
for (const app of applications) {
  for (const field of ["id", "categoryId", "title", "description", "icon", "status", "href", "openInNewTab", "tags", "order"]) {
    assert(Object.hasOwn(app, field), `${app.id} is missing ${field}`);
  }
  if (app.status !== "available") assert(!app.href, `${app.id} must not have a placeholder link`);
  assert(app.icon.startsWith("assets/icons/") && app.icon.endsWith(".webp"), `${app.id} must use the unified raster icon system`);
}

console.log("PASS: 5 categories, 20 data-driven cards, responsive and accessibility contracts");
