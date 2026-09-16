export function dialogueQuestions(shard) {
  const items = Array.isArray(shard?.dialogue) ? shard.dialogue : [];
  return items.flatMap((item) => {
    const questions = Array.isArray(item?.questions) ? item.questions : [];
    return questions
      .filter((question) => question?.audioUrl && question.indigenousText && question.chineseText)
      .map((question) => ({
        id: `${item.id}-${question.letter}`,
        letter: question.letter,
        indigenousText: question.indigenousText,
        chineseText: question.chineseText,
        audioUrl: question.audioUrl
      }));
  });
}

export function qaVerdictLabel(verdict) {
  if (verdict === "reasonable") return "有答到";
  if (verdict === "unreasonable") return "再想想";
  return "無法判定";
}
