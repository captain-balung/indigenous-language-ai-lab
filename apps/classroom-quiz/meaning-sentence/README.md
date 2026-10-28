# 意思造句（MISSION 02）

只看中文意思，自己寫族語。每題都翻譯，並顯示系統懂成。一輪 8 題，每題只送一次。字面已與教材一致時，翻譯中斷仍算通過；否則中斷不計分。分數只留在這一輪畫面。

判定順序：字面完全比對 → 翻譯樣板比對 → 翻譯樣板沒過時送自架 vLLM（經 `/api/llm-complete`，`apps/shared/semantic-meaning.mjs`）判「譯文有沒有表達出目標中文意思」——同一件事就算意思對上。LLM 失敗時維持本來的再試試看，判定不會因此變嚴。只送譯文與目標中文，不送參考族語句；服務狀態列有「語意使用 vLLM AI 判別」。

出題與計分的共用程式在這個資料夾，發音練習、跟唸、問答測驗會引用這裡。

## 本機預覽與測試

```
node apps/classroom-quiz/meaning-sentence/tests/run.mjs
node scripts/serve.mjs 4173
```

開啟 `http://127.0.0.1:4173/apps/classroom-quiz/meaning-sentence/`。

題目來自「族語 E 樂園」句型篇國中版，以 [CC BY-NC-SA 4.0](https://web.klokah.tw/creativeCommons/) 釋出。
