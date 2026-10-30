# 十二年國教（課堂測驗選單）

課堂測驗的一張合併卡：從這裡選擇「發音練習」或「翻譯」。

- [發音練習](../twelve-pronunciation/README.md)：看族語句子，直接錄音念出來；教材範例在作答後才播放。
- [翻譯](../twelve-translation/README.md)：看中文翻成族語；題目頁可切換錄音或打字。

兩種練習都使用十二年國教課程原住民族語文教材第 1–9 階，每種一輪 8 題。第 10–12 階是長段落，不在練習範圍。

## 本機預覽與測試

```
node apps/classroom-quiz/twelve/tests/run.mjs
node scripts/serve.mjs 4173
```

開啟 `http://127.0.0.1:4173/apps/classroom-quiz/twelve/`。

## ⚠️ 授權

依族語 E 樂園〈創用CC授權說明〉第 9 條第 3 款，十二年國教課程原住民族語文教材**不適用** CC BY-NC-SA 4.0，利用前應取得教育部同意。本頁僅供族語練習，不作商業用途。詳見 `data/twelve/LICENSE.md`。
