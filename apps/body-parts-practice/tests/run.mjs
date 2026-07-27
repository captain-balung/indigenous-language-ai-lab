import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeAnswer, exactMatch, semanticMatch, createQuestionDeck, createSingleFlight, judgeAnswer } from "../core.mjs";
import { DIALECTS, ETHNICITIES } from "../dialects.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const page = fs.readFileSync(path.join(root,"apps/body-parts-practice/index.html"),"utf8");
assert.ok(page.includes('href="/apps/body-parts-practice/styles.css"')); assert.ok(page.includes('src="/apps/body-parts-practice/app.mjs"')); assert.ok(!page.includes('href="styles.css"'));
const dataset = JSON.parse(fs.readFileSync(path.join(root,"data/body-parts/dataset.json"),"utf8"));
assert.equal(dataset.dialectCount,42); assert.equal(dataset.recordCount,420); assert.equal(DIALECTS.length,42); assert.equal(ETHNICITIES.length,16);
for(const dialect of DIALECTS){const records=dataset.records.filter(r=>r.dialectId===dialect.id);assert.equal(records.length,10);assert.ok(dialect.code);for(const r of records){assert.ok(r.indigenousText&&r.chineseText&&r.imagePath);assert.ok(fs.existsSync(path.join(root,"data/body-parts",r.imagePath)));}}
assert.equal(normalizeAnswer("  O  ngoso’  kinian . "),"O ngoso' kinian.");
assert.ok(exactMatch("U mata kiniyan.","U mata kiniyan.")); assert.ok(!exactMatch("mata","U mata kiniyan."));
assert.ok(semanticMatch("這是耳朵。","這是耳朵。")); assert.ok(semanticMatch("耳朵","這是耳朵。")); assert.ok(!semanticMatch("這是鼻子。","這是耳朵。"));
assert.ok(semanticMatch("這是頭髮。","這是頭髮。")); assert.ok(!semanticMatch("這是頭髮。","這是頭。")); assert.ok(!semanticMatch("這是頭。","這是頭髮。"));
const q={indigenousText:"U tangila kiniyan.",chineseText:"這是耳朵。"}; let calls=0;
assert.equal((await judgeAnswer({answer:q.indigenousText,question:q,translate:async()=>{calls++;return"耳朵";}})).type,"exact"); assert.equal(calls,0);
assert.equal((await judgeAnswer({answer:"tangila",question:q,translate:async()=>{calls++;return"耳朵";}})).type,"semantic");
assert.equal((await judgeAnswer({answer:"ngangus",question:q,translate:async()=>"鼻子"})).type,"retry");
assert.equal((await judgeAnswer({answer:"x",question:q,translate:async()=>{throw new Error("502");}})).type,"unavailable");
const deck=createQuestionDeck(dataset.records.filter(r=>r.dialectId===1),()=>.5);assert.equal(new Set(Array.from({length:10},()=>deck.next().id)).size,10);
let flights=0;let release;const gate=new Promise(resolve=>{release=resolve;});const single=createSingleFlight(async()=>{flights++;await gate;return"done";});const first=single();const second=single();assert.equal(first,second);release();await Promise.all([first,second]);assert.equal(flights,1);
console.log("PASS: 42 dialects, 420 records, 10 concepts, exact/semantic/error/deck contracts");
