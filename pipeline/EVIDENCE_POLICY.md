# Agent evidence policy

The complete agent instructions are server-only (`discovery-manifesto.server.ts`). The UI presents a short methodology statement, not the prompt.

Candidate ordering combines 60% existing structural priority and 40% local bibliographic support. Local support is a preselection, never a completed evidence check. Only corpus articles at or before the selected cutoff contribute to postings and paths. Each proposed path must have at least two distinct PMIDs per edge and at least edges + 1 unique PMIDs across its edges. Generic bridging concepts are excluded. Path search is bounded: 32 neighbors per expansion, 5,000 visits, up to six local proposals, three live checks per request.

The normal mode uses two edges (A–B–C). Expanded mode explicitly searches three or four edges, discounts support by 2 / edge count and labels the result as exploratory. Every edge is independently retrieved. No transitivity or causal relationship is assumed.

Preflight does not require an LLM key. Corpus PMID hints are independently fetched and their two MeSH endpoints validated. Recovery then tries MeSH queries and title/abstract aliases; all returned publication dates must be known and at or before cutoff. Outages are not converted into an empty-evidence verdict. NCBI traffic is queued per isolate, with timeouts and a single retry on 429/5xx; deployment-wide quotas can still apply.

The generation gate experimentally requires two distinct PMIDs with abstracts >=80 characters per edge and at least edges + 1 unique PMIDs across the path. This is an availability threshold, not a universal scientific criterion. Publication independence, experimental quality, context compatibility and contradictions are evaluated by the agent and require researcher review. Title-only records remain visible but do not satisfy this gate.

Successful retrievals are cached for five minutes in a bounded in-memory cache (80 arm entries). Failures are not cached as absence. Changing the cutoff or the path changes the cache key. The server repeats the evidence gate at generation and validates references against supplied PMIDs. A model may reject a proposal even after the bibliographic gate passes. Claims, extrapolations, context compatibility and contradictions are separate output fields.

Calibration should compare completion, rejection, citation accuracy and hypothesis usefulness across cutoffs and thresholds using held-out literature. The present 2-reference threshold and ranking weights are experimental defaults, not validated optimal settings.
