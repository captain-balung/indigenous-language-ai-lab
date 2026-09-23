# 看圖描述（MISSION 05）

使用認證模擬同一批看圖題：初級「看圖說話」（四張圖）與中級「看圖表達」（一張圖）。用自己的話描述，不要求背標準句。系統會顯示它懂成的中文意思；若意思接近教材參考說明，只當附帶提示。

失敗（辨識或翻譯中斷）不判錯。對錯只存在當次頁面，不寫入瀏覽器儲存。

## 作答

1. 選語言別、方言別。
2. 選「初級・看圖說話」或「中級・看圖表達」。
3. 看圖與中文提示，打字或錄音描述。
4. 送出後看到「系統懂成：⟨譯文⟩」。

## 本機預覽與測試

```
node apps/basic-learning/describe-practice/tests/run.mjs
node scripts/serve.mjs 4173
```

開啟 `http://127.0.0.1:4173/apps/basic-learning/describe-practice/`。

## 教材授權

初級看圖說話來自「族語 E 樂園」[句型篇國中版](https://web.klokah.tw/extension/sp_junior/practice.php)；中級看圖表達來自[句型篇高中版](https://web.klokah.tw/extension/sp_senior/practice.php)。由財團法人原住民族語言研究發展基金會製作，以 [CC BY-NC-SA 4.0](https://web.klokah.tw/creativeCommons/) 釋出。不得作商業用途；改作及衍生內容須以相同授權散布。圖片由 `klokah.tw` 直接顯示。
