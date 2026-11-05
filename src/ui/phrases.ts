// Kinder line breaks for a sentence: it is laid out as one no-break span per phrase, so a line breaks between phrases
// and never inside a number, a bracket or a date. Shared by the town panel, the year note and the footer.

/**
 * Split a sentence into phrases that should stay on one line: after 。 and 、 and before （. Text that is laid out as
 * one inline-block per phrase wraps between phrases instead of in the middle of a number or a bracket.
 */
export function phrases(text: string): string[] {
  return text.split(/(?<=[。、])|(?=（)/).filter((p) => p.length > 0);
}

/** The phrases of `parts` (or of a sentence) as inline-block spans: same text, kinder line breaks. */
export function phraseNodes(textOrParts: string | readonly string[]): HTMLSpanElement[] {
  const list = typeof textOrParts === 'string' ? phrases(textOrParts) : textOrParts;
  return list.map((part) => {
    const span = document.createElement('span');
    span.className = 'keep';
    span.textContent = part;
    return span;
  });
}
