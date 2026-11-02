# 字母篇（課堂測驗）

看字母篇的圖片和族語文字，直接錄音念出來。一輪 8 題，例詞從選定方言隨機抽出；每題只錄一次。字母標在單詞上面。教材範例在作答後才播放。沒有看提示，也不能改打字。

判定順序與「十二年國教」發音練習相同：字面完全比對 → 翻譯樣板比對 → 樣板沒過時送自架 vLLM 做 AI 意思判別。

## 本機預覽與測試

```
node apps/classroom-quiz/alphabet-pronunciation/tests/run.mjs
node scripts/serve.mjs 4173
```

開啟 `http://127.0.0.1:4173/apps/classroom-quiz/alphabet-pronunciation/`。

## 教材與音檔

題目來自「族語 E 樂園」補充教材字母篇的例詞。音檔不入庫，作答完成後才由 klokah.tw 直接播放；播放時該站會看到使用者 IP。

## 授權

依 [CC BY-NC-SA 4.0](https://web.klokah.tw/creativeCommons/) 使用。本頁僅供族語練習，不作商業用途。詳見 `data/alphabet/LICENSE.md`。
