export function indigenousKey(value) {
  return String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

export function shuffle(list, random = Math.random) {
  const items = [...list];
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function pickChoices(card, records, random = Math.random) {
  const key = indigenousKey(card.indigenousText);
  const pool = records.filter((item) => item.id !== card.id && indigenousKey(item.indigenousText) !== key);
  const distractors = shuffle(pool, random).slice(0, Math.min(2, pool.length));
  return shuffle([card, ...distractors], random);
}

export function listenRecords(records) {
  return (records ?? []).filter((item) => item.audioUrl && item.imageSrc && item.indigenousText && item.chineseText);
}
