# 身體部位練習

使用「原住民族語E樂園」42 方言、每方言 10 題的身體部位教材，讓學習者看圖以族語完整句子作答。

## 判定流程

1. `core.mjs` 先以 NFC、空白、撇號及句末空白的最低限度正規化做教材整句完全比對；完全符合不呼叫 API。
2. 未完全符合時，`POST https://ai3.iformosa.com.tw/formosan_ai/api.php`，JSON body 使用 `action: translate_to_zh`、使用者 `text` 與該方言 NLLB `src_lang`。
3. 讀取 `data.translation`，以 `core.mjs` 的十類受控中文同義詞判定身體部位語意。
4. `GET ?action=translate_languages` 用於啟動時校驗 `data.languages`／`data.language_codes`；無法取得時降級使用 2026-07-27 官方清單。

12 秒逾時、HTTP 400／413／502、其他非成功、無效 JSON、`ok:false`、缺少 `data.translation` 與網路錯誤均顯示「無法判定」，不把答案判錯並保留輸入。ASR `dialect_id` 未用於本功能。

## 本機預覽與測試

從 repository 根目錄執行：

```powershell
python -m http.server 4173
node apps/body-parts-practice/tests/run.mjs
```

開啟 `http://127.0.0.1:4173/apps/body-parts-practice/`。

## 教材授權

資料來源－[原住民族語E樂園](https://web.klokah.tw/extension/sp_junior/practice.php)，由財團法人原住民族語言研究發展基金會製作，以 [CC BY-NC-SA 4.0](https://web.klokah.tw/creativeCommons/) 釋出。不得作商業用途；改作及衍生內容須以相同授權散布。
