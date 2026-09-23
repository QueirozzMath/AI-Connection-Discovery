export type LbdConcept = {
  id: string;
  label: string;
  category: string | null;
  meshVersion?: string | null;
};
export type EvidenceArticle = {
  pmid: string;
  year: number;
  title: string;
  journal?: string | null;
};
export type LbdEdge = {
  from: string;
  to: string;
  count: number;
  expected: number;
  pmi: number;
  firstYear: number;
  years: { year: number; count: number }[];
  articles: EvidenceArticle[];
};
export type LbdCandidate = {
  A: LbdConcept;
  C: LbdConcept;
  B: LbdConcept[];
  paths: { B: LbdConcept; AB: LbdEdge; BC: LbdEdge }[];
  metrics: Record<string, number | null | { value: number; meshVersion: string }>;
  definitions: Record<string, string>;
  knownBeforeCutoff: boolean;
  directCount: number;
  firstKnownYear: number | null;
  knowledgeCutoff: number;
  eligible: boolean;
  limitations: string[];
  fingerprint: string;
  corpusRevision: string;
  policyVersion: string;
  candidateType: "open" | "closed" | "global";
};
export type LbdSummary = {
  A: LbdConcept;
  C: LbdConcept;
  rank: number;
  generationBridgeStrength: number;
  generationPathCount: number;
  knowledgeCutoff: number;
  candidateType: "open" | "closed" | "global";
};
export type AgentClaim = {
  kind: "inference" | "hypothesis" | "speculation";
  statement: string;
  evidence: { pmid: string; quote: string }[];
};
export type HypothesisRecord = {
  id: string;
  createdAt: string;
  knowledgeCutoff: number;
  candidate: LbdCandidate;
  hypothesisText: string;
  mechanismText: string;
  testablePrediction: string;
  limitations: string[];
  agentModel: string;
  agentVersion: string;
  promptVersion: string;
  agents: {
    synthesis: {
      title: string;
      hypothesis: string;
      mechanism: string;
      mechanismStatus: "undetermined" | "speculative";
      bridge_reasoning: string;
      testable_prediction: string;
      limitations: string[];
      claims: AgentClaim[];
    };
    interpreter: { interpretation: string; claims: AgentClaim[] };
    contradictionAgent: {
      critique: string;
      limitations: string[];
      alternatives: string[];
      claims: AgentClaim[];
    };
    evidenceAgent: { articles: EvidenceArticle[] };
    temporalAgent: { allEvidenceBeforeCutoff: boolean; meshHistoricalAvailable: boolean };
  };
};
export type ValidationRecord = {
  id: string;
  hypothesisId: string;
  createdAt: string;
  validationStartYear: number;
  validationEndYear: number;
  firstFutureEvidenceYear: number | null;
  futureArticleCount: number;
  futureEvidence: EvidenceArticle[];
  validationStatus: string;
  rationale: string;
  review: null | { reviewer: string; rationale: string; pmids: string[]; status: string };
  leadTimeYears: number | null;
  evidenceTruncated: boolean;
};
