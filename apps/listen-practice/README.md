# 聽音練習（MISSION 03）

與看圖練習、口說練習同一批主題：聽族語音檔後，選出對應的圖片或中文意思。

不打字、不錄音、不呼叫 Formosan AI。對錯只存在當次頁面。

## 作答

1. 選語言別、方言別與主題。
2. 選「選圖」或「選意思」。
3. 播放音檔，從三個選項挑一個。同音異義（例如南勢阿美 ayam＝雞／鳥）不會同時出現在同一題。

## 音檔

看圖主題由 `klokah.tw` 播放；職業由 `web.klokah.tw` 播放。都不能 `fetch()`，只能用 `<audio src>`。播放時對方網站會看到使用者的 IP 位址。`prefers-reduced-motion` 時不自動播放。

## 本機預覽與測試

```
node apps/listen-practice/tests/run.mjs
node scripts/serve.mjs 4173
```

開啟 `http://127.0.0.1:4173/apps/listen-practice/`。

## 教材授權

句型篇來源－[原住民族語E樂園](https://web.klokah.tw/extension/sp_junior/practice.php)；職業來源－[教學模組初級](https://web.klokah.tw/mode/elementary/index.php)。皆由財團法人原住民族語言研究發展基金會製作，以 [CC BY-NC-SA 4.0](https://web.klokah.tw/creativeCommons/) 釋出。不得作商業用途；改作及衍生內容須以相同授權散布。
