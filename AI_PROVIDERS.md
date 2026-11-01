# AI providers

The Agents page supports three modes across generation, later-literature verification and output translation. API keys and connection settings stay in React memory; only selected connections and validated outputs are persisted in sessionStorage. Provider changes remove the active credential.

## Free default

Without secrets, the server calls OVHcloud's anonymous OpenAI-compatible endpoint with `Meta-Llama-3_3-70B-Instruct`. Anonymous access is subject to the provider's shared per-IP, per-model quota (currently two requests/minute); this is not unlimited production capacity.

An optional server-side `OPENROUTER_API_KEY` enables `openrouter/free`, constrained to zero prompt/completion price, followed by OVHcloud on failure. The user's key is never used in this pool. There is no paid fallback. Actual response model and attempt metadata accompany successful scientific outputs. The policy prioritizes JSON-capable text generation and verified availability; it is not a claim of benchmarked biomedical superiority.

Provider availability and a small anonymous JSON generation were verified on 2026-11-01. Live scientific generation remains subject to quotas and output/evidence validation. Free services' terms and privacy policies apply.

## Personal APIs

Select Gemini, OpenAI, Anthropic/Claude or OpenRouter, enter the exact model ID and an API key. The key goes only to that provider. Personal requests never fall back to another service. HTTP status errors distinguish quota, credentials, model access, credits and transient service failures. Personal calls have a 120-second response deadline; a quick transient network/5xx failure may be retried once, with the same context. Quota, invalid credentials and timeout do not trigger repeated paid requests.

## Custom API / LiteLLM

Provide a public HTTPS OpenAI-compatible API base, exact model ID and optional key. An administrator must authorize the exact base URL in the comma-separated runtime variable `AI_CUSTOM_ENDPOINTS`, for example `https://inference.example.org/v1`. The app appends `/chat/completions`. Private addresses, URL credentials, query strings, nonstandard ports and redirects are rejected; arbitrary visitor-supplied destinations are not trusted. Only register gateways under your control with public network destinations.

This connects to an existing LiteLLM/vLLM/Ollama gateway; it does not deploy LiteLLM. A server only reachable inside the visitor's network needs a reachable gateway. `localhost` refers to the hosted server, not the visitor's machine.

Custom and personal models must support text Chat Completions with JSON output; Anthropic and Gemini use their native message formats. Model-specific parameters may require adapter extensions for models outside these contracts.

## Evidence and validation

All providers share the existing bibliographic gate, temporal cutoff, citation whitelist, per-arm citations, output schema, and translation checks. Duplicate presentations of the same first/last-arm abstracts were removed from prompts; the full assessed dossier is retained. Truncated, malformed and ungrounded outputs are rejected. Safe error codes and elapsed times are logged without prompts, keys, provider error bodies or custom endpoint URLs.

## Sources

- https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-endpoints-getting-started
- https://openrouter.ai/docs/guides/routing/routers/free-router
- https://platform.claude.com/docs/en/api/overview
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- https://docs.litellm.ai/docs/proxy/client_setup/overview
- https://github.com/mnfst/awesome-free-llm-apis (discovery only; not a runtime dependency)
