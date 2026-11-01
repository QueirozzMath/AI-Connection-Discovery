/** Only supplied PubMed references become links. No HTML or arbitrary URLs are interpreted. */
export function citationParts(
  text: string,
  allowed: Set<string>,
): { text: string; pmid?: string }[] {
  const pattern =
    /\[([^\]]+)\]\(https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,10})\/?\)|https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,10})\/?|\bPMID\s*[:#]?\s*(\d{1,10})\b|\b(\d{6,10})\b/gi;
  const parts: { text: string; pmid?: string }[] = [];
  let cursor = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index! > cursor) parts.push({ text: text.slice(cursor, m.index) });
    const id = m[2] ?? m[3] ?? m[4] ?? m[5]!;
    parts.push(allowed.has(id) ? { text: m[1] ?? `PMID ${id}`, pmid: id } : { text: m[0] });
    cursor = m.index! + m[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}
