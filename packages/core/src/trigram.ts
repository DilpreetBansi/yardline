/**
 * Trigram similarity in the style of Postgres pg_trgm: each word is padded with two spaces
 * in front and one behind, and similarity is |A ∩ B| / |A ∪ B| over the trigram sets.
 * The API uses pg_trgm for catalog search; the matcher uses this so it stays a pure function.
 */
export function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!word) continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

export function similarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / (A.size + B.size - shared);
}
