# 字母篇（基礎學習）

看圖片，聽字母篇例詞，再用族語跟唸一次。選定方言後點一張字母圖卡，這一輪只出該字母的例詞；不到 8 個就全部出完。每題都有圖片，只錄一次。結果顯示系統聽到的族語、系統懂成的中文，以及教材族語與中文。

題目頁可按「看提示」展開字母、中文與教材族語；提示預設收合。

判定順序與「十二年國教」跟唸相同：字面完全比對 → 翻譯樣板比對 → 樣板沒過時送自架 vLLM 做 AI 意思判別。

## 本機預覽與測試

```
node apps/basic-learning/alphabet-listen-retell/tests/run.mjs
node apps/shared/tests/alphabet-data.test.mjs
node scripts/serve.mjs 4173
```

開啟 `http://127.0.0.1:4173/apps/basic-learning/alphabet-listen-retell/`。

## 教材與音檔

題目來自「族語 E 樂園」補充教材字母篇的例詞。音檔不入庫，執行時由 klokah.tw 直接播放；播放時該站會看到使用者 IP。

## 授權

依 [CC BY-NC-SA 4.0](https://web.klokah.tw/creativeCommons/) 使用。本頁僅供族語練習，不作商業用途。詳見 `data/alphabet/LICENSE.md`。
