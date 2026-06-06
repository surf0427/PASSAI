// Pure deterministic text rules for AI-input validation.
// Read-only: never mutate, normalize, or overwrite the caller's input.

export function isEmpty(value: string): boolean {
  return value.trim().length === 0;
}

export function tooShort(value: string, min: number): boolean {
  return value.trim().length < min;
}

// max は abuse / cost ガード目的のため raw length で判定する（trim しない）。
// 巨大な空白だけのペイロードも token コストになるため弾く。tutor route の
// MAX_MESSAGE_LENGTH チェックと同じ意味論。
export function tooLong(value: string, max: number): boolean {
  return value.length > max;
}

export function repeatedCharRatio(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  let total = 0;
  let max = 0;
  for (const ch of value) {
    const next = (counts.get(ch) ?? 0) + 1;
    counts.set(ch, next);
    if (next > max) max = next;
    total += 1;
  }
  return total === 0 ? 0 : max / total;
}

export function containsPlaceholder(
  value: string,
  placeholders: readonly string[],
): boolean {
  return placeholders.some((p) => value.includes(p));
}
