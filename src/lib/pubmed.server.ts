let lastRequest = 0;
let requestQueue = Promise.resolve();
async function ncbiFetch(url: string) {
  let release!: () => void;
  const previous = requestQueue;
  requestQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const delay = Math.max(0, 350 - (Date.now() - lastRequest));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    lastRequest = Date.now();
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 1100));
      lastRequest = Date.now();
      return fetch(url, { signal: AbortSignal.timeout(8000) });
    }
    return response;
  } finally {
    release();
  }
}
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export interface PubmedArticle {
  pmid: string;
  year: number | null;
  title: string;
  abstract: string;
  mesh?: { id: string; label: string }[];
}

function withKey(params: Record<string, string>) {
  const key = process.env["NCBI_API_KEY"];
  const p = new URLSearchParams({ ...params, tool: "ai_connection_discovery" });
  if (process.env["NCBI_EMAIL"]) p.set("email", process.env["NCBI_EMAIL"]!);
  if (key) p.set("api_key", key);
  return p.toString();
}

export async function esearch(term: string, retmax = 20): Promise<string[]> {
  const url = `${EUTILS}/esearch.fcgi?${withKey({
    db: "pubmed",
    term,
    retmax: String(retmax),
    retmode: "json",
    sort: "relevance",
  })}`;
  const res = await ncbiFetch(url);
  if (!res.ok) throw new Error(`PubMed esearch falhou (${res.status})`);
  const json = (await res.json()) as { esearchresult?: { idlist?: string[] } };
  if (!json.esearchresult?.idlist) throw new Error("Resposta inválida do PubMed.");
  return json.esearchresult.idlist;
}

function tagText(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!m) return "";
  return m[1]!
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function efetch(pmids: string[]): Promise<PubmedArticle[]> {
  if (!pmids.length) return [];
  const url = `${EUTILS}/efetch.fcgi?${withKey({
    db: "pubmed",
    id: pmids.join(","),
    retmode: "xml",
  })}`;
  const res = await ncbiFetch(url);
  if (!res.ok) throw new Error(`PubMed efetch falhou (${res.status})`);
  const xml = await res.text();
  const chunks = xml.split("<PubmedArticle>").slice(1);
  return chunks.map((c) => {
    const pubDate = c.match(/<PubDate>([\s\S]*?)<\/PubDate>/)?.[1] ?? "";
    const yearRaw =
      tagText(pubDate, "Year") ||
      tagText(pubDate, "MedlineDate").match(/\b(?:18|19|20)\d{2}\b/)?.[0];
    return {
      pmid: tagText(c, "PMID"),
      year: yearRaw ? Number(yearRaw) : null,
      title: tagText(c, "ArticleTitle"),
      abstract: tagText(c, "Abstract").slice(0, 8000),
      mesh: [
        ...c.matchAll(/<DescriptorName\b[^>]*UI="([^"]+)"[^>]*>([\s\S]*?)<\/DescriptorName>/g),
      ].map((m) => ({ id: m[1]!, label: m[2]!.replace(/<[^>]+>/g, "") })),
    };
  });
}

/** Artigos de um conceito publicados ate o ano de corte (visao do agente). */
export async function conceptArticles(term: string, cutoffYear: number, n = 8) {
  const q = `"${term}"[MeSH Terms] AND ("1800"[dp] : "${cutoffYear}"[dp])`;
  const ids = await esearch(q, n);
  return efetch(ids);
}

/** Evidence for one arm of Swanson's chain, restricted to the cutoff. */
export async function bridgeArticles(a: string, b: string, cutoffYear: number, n = 4) {
  const quote = (term: string) => term.replace(/["\\]/g, " ");
  const query = `"${quote(a)}"[MeSH Terms] AND "${quote(b)}"[MeSH Terms] AND ("1800"[dp] : "${cutoffYear}"[dp])`;
  return efetch(await esearch(query, n));
}

/** Artigos que citam A e C juntos apos o corte (evidencia de confirmacao). */
export async function coOccurrenceArticles(
  a: string,
  c: string,
  cutoffYear: number,
  n = 12,
): Promise<PubmedArticle[]> {
  const q = `"${a}"[MeSH Terms] AND "${c}"[MeSH Terms] AND ("${cutoffYear + 1}"[dp] : "3000"[dp])`;
  const ids = await esearch(q, n);
  return efetch(ids);
}
