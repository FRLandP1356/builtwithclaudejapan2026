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

/**
 * Put `extra` (a mark after a heading, say) at the end of the last phrase of `spans`, inside it. A long last phrase wraps
 * inside its own inline-block, which makes the box as wide as the line: a mark placed after it as a sibling would fall to a
 * line of its own, away from the sentence. Returns `spans`; with no phrase there is nothing to attach to and `extra` is
 * returned after it.
 */
export function withTail(spans: HTMLSpanElement[], ...extra: Array<Node | string>): Array<Node | string> {
  const last = spans.at(-1);
  if (!last) return [...spans, ...extra];
  last.append(...extra);
  return spans;
}
