# 發音練習（MISSION 01）

看到圖片就念出對應的族語，不播放教材音。每題只錄一次，先做語音辨識；字面與教材一致時不另外翻譯。一輪 8 題。辨識中斷不計分。分數只留在這一輪畫面。

判定與「意思造句」同一套（共用 `meaning-sentence` engine）：字面完全比對 → 翻譯樣板比對 → 樣板沒過時送自架 vLLM 做 AI 意思判別（`apps/shared/semantic-meaning.mjs`），失敗維持本來的再試試看。只送譯文與教材中文，不送參考族語句。

## 本機預覽與測試

```
node apps/classroom-quiz/meaning-sentence/tests/run.mjs
node scripts/serve.mjs 4173
```

開啟 `http://127.0.0.1:4173/apps/classroom-quiz/picture-speaking-quiz/`。

題目來自「族語 E 樂園」句型篇國中版，以 [CC BY-NC-SA 4.0](https://web.klokah.tw/creativeCommons/) 釋出。
