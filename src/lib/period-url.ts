/** Parse a shared period without inventing year zero for absent URL fields. */
export function periodFromSearch(search: string) {
  const params = new URLSearchParams(search);
  const legacy = params.get("year") ?? params.get("cutoff");
  const from = params.get("from") ?? legacy;
  const to = params.get("to") ?? legacy;
  if (from === null && to === null) return undefined;
  const values = [from ?? to, to ?? from];
  if (values.some((v) => !v || !/^\d{4}$/.test(v))) return null;
  const startYear = Number(values[0]),
    endYear = Number(values[1]);
  if (startYear < 1800 || endYear > 3000 || startYear > endYear) return null;
  return { startYear, endYear };
}
