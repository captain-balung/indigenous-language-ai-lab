/**
 * 教材同義寫法（egu / lala、他/她、深(/多/大)）只保留斜線前的第一個，
 * 避免口說使用者不知道要念哪一個。
 */
export function preferFirstAlt(text) {
  let value = String(text ?? "");
  // 括號內的斜線備選：深(/多/大)、淺(/小)、(多/大)
  value = value.replace(/\([^)]*[\/／][^)]*\)/g, "");
  let prev;
  do {
    prev = value;
    // 中文單字備選：他/她、是/對
    value = value.replace(/([\u4e00-\u9fff々〆〇])[\/／]([\u4e00-\u9fff々〆〇])/g, "$1");
    // 拉丁／族語詞備選：egu / lala、qoli /qolit
    value = value.replace(/([A-Za-z'’ʻ][\w'’ʻ]*)\s*[\/／]\s*([A-Za-z'’ʻ][\w'’ʻ]*)/g, "$1");
  } while (value !== prev);
  // 整句備選（空白夾斜線）：只留第一句
  const phraseSep = value.search(/\s+[\/／]\s+/);
  if (phraseSep !== -1) value = value.slice(0, phraseSep);
  // 句尾殘留斜線
  value = value.replace(/\s*[\/／]+\s*$/g, "");
  // 其餘殘留斜線：只留左側片段
  value = value.replace(/(\S+)\s*[\/／]\s*\S+/g, "$1");
  return value.replace(/[ \t]{2,}/g, " ").trim();
}
