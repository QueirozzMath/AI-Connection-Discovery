import { test } from "node:test";
import assert from "node:assert/strict";
import { periodFromSearch } from "../src/lib/period-url.ts";
test("shared temporal URL: single year, range, legacy and invalid values", () => {
  assert.equal(periodFromSearch(""), undefined);
  assert.deepEqual(periodFromSearch("?from=2014"), { startYear: 2014, endYear: 2014 });
  assert.deepEqual(periodFromSearch("?from=2010&to=2014"), { startYear: 2010, endYear: 2014 });
  assert.deepEqual(periodFromSearch("?cutoff=2014"), { startYear: 2014, endYear: 2014 });
  for (const query of ["?from=", "?from=no", "?from=2026&to=2014", "?to=0"])
    assert.equal(periodFromSearch(query), null);
});
