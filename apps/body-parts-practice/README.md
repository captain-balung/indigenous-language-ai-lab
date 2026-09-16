# 看圖練習

選語言別、方言別與主題後，看圖以族語完整句子作答。主題來自句型篇國中版看圖識字（身體部位、動物、植物／水果、物品、地點／景觀、人物）與教學模組初級職業。動作、天氣等沒有對應圖卡的主題暫不收入。

## 判定流程

1. `core.mjs` 先以 NFC、空白、撇號及句末空白的最低限度正規化做教材整句完全比對；完全符合不呼叫 API。
2. 未完全符合時，`POST https://ai3.iformosa.com.tw/formosan_ai/api.php`，JSON body 使用 `action: translate_to_zh`、使用者 `text` 與該方言 NLLB `src_lang`。
3. 讀取 `data.translation`：身體部位用十類受控中文同義詞（避免「頭／頭髮」互相放行）；其他主題比對去掉「這是／那是／他是／她是」後的中文詞。
4. `GET ?action=translate_languages` 用於啟動時校驗 `data.languages`／`data.language_codes`；無法取得時降級使用 2026-07-27 官方清單。

12 秒逾時、HTTP 400／413／502、其他非成功、無效 JSON、`ok:false`、缺少 `data.translation` 與網路錯誤均顯示「無法判定」，不把答案判錯並保留輸入。ASR `dialect_id` 未用於本功能。

## 本機預覽與測試

從 repository 根目錄執行：

```powershell
node scripts/serve.mjs 4173
node apps/body-parts-practice/tests/run.mjs
```

開啟 `http://127.0.0.1:4173/apps/body-parts-practice/`。

## 教材授權

看圖主題來自[原住民族語E樂園句型篇國中版](https://web.klokah.tw/extension/sp_junior/practice.php)；職業來自[教學模組初級](https://web.klokah.tw/mode/elementary/index.php)。由財團法人原住民族語言研究發展基金會製作，以 [CC BY-NC-SA 4.0](https://web.klokah.tw/creativeCommons/) 釋出。不得作商業用途；改作及衍生內容須以相同授權散布。
