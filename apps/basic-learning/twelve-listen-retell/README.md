# 十二年國教（基礎學習 MISSION 05）

聽十二年國教課程原住民族語文教材第 1–9 階的族語短句，再用族語跟唸一次。一輪 8 題，句子從選定階級隨機抽出；每題只錄一次。結果顯示系統聽到的族語、系統懂成的中文，以及教材族語與中文。

題目頁可按「看提示」展開課名、中文與教材族語；提示預設收合，換題與評分後會自動收合，不影響判定與計分。提示內容直接使用官方教材的 `chineseText`、`indigenousText` 與課名欄位。

判定順序與現有「跟唸」相同：字面完全比對 → 翻譯樣板比對 → 樣板沒過時送自架 vLLM 做 AI 意思判別（`apps/shared/semantic-meaning.mjs`），失敗維持本來的再試試看。只送譯文與教材中文，不送參考族語句。

## 本機預覽與測試

```
node apps/basic-learning/twelve-listen-retell/tests/run.mjs
node scripts/serve.mjs 4173
```

開啟 `http://127.0.0.1:4173/apps/basic-learning/twelve-listen-retell/`。

## 教材與音檔

題目來自「族語 E 樂園」十二年國教課程原住民族語文教材，只收第 1–9 階。音檔不入庫，執行時由官方 CloudFront 直接播放；播放時該站會看到使用者 IP。

## ⚠️ 授權

依族語 E 樂園〈創用CC授權說明〉第 9 條第 3 款，十二年國教課程原住民族語文教材**不適用** CC BY-NC-SA 4.0，利用前應取得教育部同意。本頁僅供族語練習，不作商業用途。詳見 `data/twelve/LICENSE.md`。
