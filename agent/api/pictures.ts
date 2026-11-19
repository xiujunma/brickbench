/**
 * Pictures in a conversation, in either wire format: both carry them as parts
 * of a message's content, told apart by the part's type.
 */

function partsOf(item: unknown): readonly unknown[] | null {
  if (typeof item !== 'object' || item === null) return null;
  const content = (item as { readonly content?: unknown }).content;
  return Array.isArray(content) ? content : null;
}

const isOfType =
  (type: string) =>
  (part: unknown): boolean =>
    typeof part === 'object' && part !== null && (part as { readonly type?: unknown }).type === type;

/** How many parts of this type the conversation holds. */
export function countParts(conversation: readonly unknown[], type: string): number {
  return conversation.reduce<number>((total, item) => total + (partsOf(item)?.filter(isOfType(type)).length ?? 0), 0);
}

/** The conversation with all but the last `keep` parts of this type swapped for `replacement`; the rest left as they were. */
export function replaceParts(conversation: readonly unknown[], type: string, keep: number, replacement: unknown): unknown[] {
  const matches = isOfType(type);
  let left = Math.max(0, countParts(conversation, type) - keep);
  return conversation.map((item) => {
    const parts = partsOf(item);
    if (left === 0 || !parts?.some(matches)) return item;
    const content = parts.map((part) => {
      if (left === 0 || !matches(part)) return part;
      left -= 1;
      return replacement;
    });
    return { ...(item as object), content };
  });
}
