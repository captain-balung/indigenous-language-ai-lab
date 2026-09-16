import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFeatureJson, extractJobRecords, sanitizeFeatureJson } from "./elementary-jobs-parse.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const raw20 = read("data/elementary-jobs/raw/20.json");
assert.throws(() => JSON.parse(raw20), "丹群布農語原文必須含無法直接 parse 的 HTML");
const parsed20 = parseFeatureJson(raw20);
assert.equal(parsed20.sanitized, true);
assert.equal(parsed20.json.theme, "職業");
assert.equal(extractJobRecords(parsed20.json, 20).length, 6);

const raw42 = read("data/elementary-jobs/raw/42.json");
const parsed42 = parseFeatureJson(raw42);
assert.equal(parsed42.sanitized, false);
const yami = extractJobRecords(parsed42.json, 42);
assert.equal(yami[2].chineseText, "警察");
assert.ok(yami[2].imagePath.endsWith("feature07.jpg"));
assert.ok(!yami.some((item) => item.chineseText === "護士"));

const shard20 = JSON.parse(read("data/elementary-jobs/dialects/20.json"));
assert.equal(shard20.sanitized, true);
const shard42 = JSON.parse(read("data/elementary-jobs/dialects/42.json"));
assert.equal(shard42.records[2].chineseText, "警察");

assert.equal(sanitizeFeatureJson('<button class="read-play-btn" data-value="784866"></button>'), "784866");
assert.throws(() => sanitizeFeatureJson("<button></button>"));

console.log("PASS: jobs JSON sanitize, Bunun HTML, Yami police");
