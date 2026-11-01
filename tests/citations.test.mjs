import test from "node:test";
import assert from "node:assert/strict";
import { citationParts } from "../src/lib/citation-parts.ts";
const allowed = new Set(["16116447", "12345678"]);
test("PMID mentions and multiple identifiers link only to supplied articles", () => {
  const parts = citationParts("Resultados: PMID 16116447, 12345678; PMID 99999999.", allowed);
  assert.deepEqual(
    parts.filter((p) => p.pmid).map((p) => p.pmid),
    ["16116447", "12345678"],
  );
  assert.ok(parts.some((p) => p.text.includes("99999999") && !p.pmid));
});
test("canonical PubMed markdown and URLs resolve to article identifiers", () => {
  assert.deepEqual(citationParts("[Estudo](https://pubmed.ncbi.nlm.nih.gov/16116447/)", allowed), [
    { text: "Estudo", pmid: "16116447" },
  ]);
  assert.equal(
    citationParts("https://pubmed.ncbi.nlm.nih.gov/12345678/", allowed)[0].pmid,
    "12345678",
  );
});
test("untrusted URLs, HTML and numbers not in evidence remain plain text", () => {
  const input =
    "<script>alert(1)</script> [fake](https://evil.example/) PMID 99999999 and 1000000 cells";
  assert.ok(citationParts(input, allowed).every((p) => !p.pmid));
  assert.equal(
    citationParts(input, allowed)
      .map((p) => p.text)
      .join(""),
    input,
  );
  assert.deepEqual(citationParts("", allowed), []);
});
