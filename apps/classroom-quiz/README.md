# 課堂測驗

四張首頁卡共用這一頁，用網址參數區分：

- `?mode=compose` 意思造句
- `?mode=oral` 看圖口說小考
- `?mode=retell` 聽後轉述
- `?mode=reply` 接話小考

每輪 8 題，每題只送一次。意思造句與聽後轉述每次都把句子送去翻譯，並顯示系統懂成。看圖口說先辨識，字面一致時不另外翻譯。接話小考先辨識，再判斷有沒有答到問句，不顯示配分。翻譯或辨識中斷的題目不計分；意思造句若字面已與教材一致，翻譯中斷仍算通過。分數只留在這一輪畫面。

```
node apps/classroom-quiz/tests/run.mjs
node scripts/serve.mjs 4173
```

開啟 `http://127.0.0.1:4173/apps/classroom-quiz/?mode=compose`。

題目來自「族語 E 樂園」句型篇國中版，以 [CC BY-NC-SA 4.0](https://web.klokah.tw/creativeCommons/) 釋出。聽後轉述與接話的音檔由 `klokah.tw` 直接播放。
