# 聽後轉述（MISSION 03）

只聽短句，用族語再講一次。結果裡顯示辨識文字與懂成的中文。一輪 8 題，每題只錄一次。辨識或翻譯中斷不計分。分數只留在這一輪畫面。

判定與「意思造句」同一套（共用 `meaning-sentence` engine）：字面完全比對 → 翻譯樣板比對 → 樣板沒過時送自架 vLLM 做 AI 意思判別（`apps/shared/semantic-meaning.mjs`），判「譯文有沒有轉述到原句意思」，失敗維持本來的再試試看。只送譯文與教材中文，不送參考族語句。

## 本機預覽與測試

```
node apps/classroom-quiz/meaning-sentence/tests/run.mjs
node scripts/serve.mjs 4173
```

開啟 `http://127.0.0.1:4173/apps/classroom-quiz/listen-retell/`。

題目來自「族語 E 樂園」句型篇國中版，以 [CC BY-NC-SA 4.0](https://web.klokah.tw/creativeCommons/) 釋出。音檔由 `klokah.tw` 直接播放。
