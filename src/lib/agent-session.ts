import type { Candidate } from "./science-data";
import type { HypothesisResult, VerificationResult } from "./hypothesis.functions";
export type AgentSelection = { pair: Candidate; cutoff: number; expanded: boolean };
export type AgentSession = {
  version: 1;
  active: AgentSelection | null;
  results: Record<string, HypothesisResult>;
  checks: Record<string, VerificationResult>;
  translations: Record<string, { result?: HypothesisResult; check?: VerificationResult }>;
};
export const emptySession = (): AgentSession => ({
  version: 1,
  active: null,
  results: {},
  checks: {},
  translations: {},
});
export const selectionKey = (s: AgentSelection) => `${s.cutoff}::${s.pair.a}::${s.pair.c}`;
export function selectSession(state: AgentSession, active: AgentSelection): AgentSession {
  if (state.active && selectionKey(state.active) === selectionKey(active))
    return state.active.expanded === active.expanded ? state : { ...state, active };
  return { ...emptySession(), active };
}
const fields = [
  "title",
  "hypothesis",
  "mechanism",
  "bridge_reasoning",
  "testable_prediction",
  "skeptic_critique",
  "innovation_value",
  "falsification",
  "evidence_limitations",
  "documented_evidence",
  "extrapolations",
  "context_compatibility",
  "contradictions",
];
export function restoreSession(raw: string | null): AgentSession {
  try {
    const d = JSON.parse(raw ?? "null");
    if (
      !d ||
      d.version !== 1 ||
      !d.active ||
      typeof d.active.pair?.a !== "string" ||
      typeof d.active.pair?.c !== "string" ||
      !Array.isArray(d.active.pair?.intermediaries) ||
      !Number.isInteger(d.active.cutoff) ||
      typeof d.active.expanded !== "boolean"
    )
      return emptySession();
    const key = selectionKey(d.active);
    const result = d.results?.[key];
    const check = d.checks?.[key];
    if (
      result &&
      (!fields.every((f) => typeof result[f] === "string") ||
        !Array.isArray(result.evidence_assessment?.arms) ||
        !result.evidence_assessment.arms.every((a: unknown) =>
          Boolean(
            a && typeof a === "object" && Array.isArray((a as { articles?: unknown }).articles),
          ),
        ) ||
        !Array.isArray(result.pair))
    )
      return emptySession();
    if (
      check &&
      (!Array.isArray(check.articles) ||
        !Array.isArray(check.supporting_pmids) ||
        !Array.isArray(check.contradicting_pmids) ||
        typeof check.rationale !== "string")
    )
      return emptySession();
    // Session payload contains selected connection and outputs, never credential state.
    const pair = d.active.pair;
    const active = {
      cutoff: d.active.cutoff,
      expanded: d.active.expanded,
      pair: {
        a: pair.a,
        c: pair.c,
        intermediaries: pair.intermediaries,
        rank: Number(pair.rank) || 0,
        prob: Number(pair.prob) || 0,
        confirmed: Boolean(pair.confirmed),
        first_year: pair.first_year ?? null,
        lead_time_years: pair.lead_time_years ?? null,
        features: pair.features ?? {},
        ...(pair.a_ui ? { a_ui: pair.a_ui } : {}),
        ...(pair.c_ui ? { c_ui: pair.c_ui } : {}),
        ...(typeof pair.priority === "number" ? { priority: pair.priority } : {}),
      },
    };
    const translations: AgentSession["translations"] = {};
    for (const language of ["pt", "en"]) {
      const translated = d.translations?.[`${key}:${language}`];
      if (!translated) continue;
      const restored = restoreSession(
        JSON.stringify({
          version: 1,
          active,
          results: translated.result ? { [key]: translated.result } : {},
          checks: translated.check ? { [key]: translated.check } : {},
        }),
      );
      if (restored.active)
        translations[`${key}:${language}`] = {
          ...(restored.results[key] ? { result: restored.results[key] } : {}),
          ...(restored.checks[key] ? { check: restored.checks[key] } : {}),
        };
    }
    return {
      version: 1,
      active,
      results: result ? { [key]: result } : {},
      checks: check ? { [key]: check } : {},
      translations,
    };
  } catch {
    return emptySession();
  }
}
export function serializeSession(state: AgentSession): string {
  const clean = restoreSession(
    JSON.stringify({
      version: 1,
      active: state.active,
      results: state.results,
      checks: state.checks,
      translations: state.translations,
    }),
  );
  return JSON.stringify(clean);
}
