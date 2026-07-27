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
assert(html.includes('id="applications"'), "Main application landmark is missing");
assert(css.includes("prefers-reduced-motion"), "Reduced-motion support is missing");
assert(css.includes("@media (max-width: 560px)"), "Mobile breakpoint is missing");
assert(!/(https?:)?\/\//.test(html.replace(/https:\/\/openapi\.vercel\.sh/g, "")), "Runtime HTML must not load remote resources");

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
for (const category of categories) {
  assert(applications.filter((app) => app.categoryId === category.id).length === 4, `${category.title} must have 4 applications`);
}
for (const app of applications) {
  for (const field of ["id", "categoryId", "title", "description", "icon", "status", "href", "openInNewTab", "tags", "order"]) {
    assert(Object.hasOwn(app, field), `${app.id} is missing ${field}`);
  }
  if (app.status !== "available") assert(!app.href, `${app.id} must not have a placeholder link`);
}

console.log("PASS: 5 categories, 20 data-driven cards, responsive and accessibility contracts");
