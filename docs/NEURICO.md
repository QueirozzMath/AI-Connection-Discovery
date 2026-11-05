# NeuriCo research handoff

This Site uses a generated research plan adapted from NeuriCo's research workflow and exchanges files with external NeuriCo installations. It does not execute Python, agent CLIs, Docker, experiments, scorers or NeuriCo's autonomous runtime inside Cloudflare Workers.

The hypothesis report preserves its five scientific sections and adds a research-planning section. Its generated plan covers sub-hypotheses, available versus missing resources, baselines, metrics, statistical planning, reproducibility and human review. All fields retain the original temporal cutoff and citation allowlist.

Export `neurico-idea.yaml` from the report. The file is JSON (a YAML 1.2 subset) matching `ideas/schema.yaml` v1.2: title/domain/hypothesis, background including the verified dossier, methodology, zero-dollar budget, expected report and evaluation criteria. Default `data_science` is for bibliographic/computational analysis; review the domain and protocol in your external installation before running biomedical research. A zero budget is a requested execution constraint, not a guarantee of provider access or free execution.

With NeuriCo installed separately, submit the exported file using `./neurico submit neurico-idea.yaml --no-github`. Review the submitted idea before starting the external workflow. Import its resulting `REPORT.md` using the report's import control. Imported text is rendered as plain text, limited to 500 KB, saved in the browser session, and never treated as verified literature or executable instructions. Importing does not change the PubMed verdict.

Upstream references reviewed 2026-11-05:
- https://github.com/ChicagoHAI/NeuriCo
- https://github.com/ChicagoHAI/NeuriCo/blob/main/docs/IDEA_GUIDE.md
- https://github.com/ChicagoHAI/NeuriCo/blob/main/ideas/schema.yaml
- https://github.com/ChicagoHAI/NeuriCo/blob/main/templates/base/researcher.txt

Attribution: NeuriCo: Autonomous Research Framework, Haokun Liu and Chenhao Tan (2025), Apache-2.0. This adapter contains original implementation; it does not vendor or run upstream source.

## Native installation (Mac/Linux)

Requires Git, Node.js 20+, and uv. Run from this repository:

```bash
npm run neurico:setup
npm run neurico:doctor
npm run neurico:login
npm run neurico:submit -- /absolute/path/neurico-idea.yaml
npm run neurico:run -- IDEA_ID
```

Setup installs NeuriCo commit `88d98e888138605258265f8b2ef7090e374ec496` (0.4.0), its Python dependencies in an isolated Python 3.12 venv, and Gemini CLI 0.67.0 in the ignored `.neurico/` directory. It requires 22 GB free before installation, reserves no large corpus, does not create API keys, does not log in automatically, and does not launch research. Dependencies are resolved for the host platform; the verified upstream revision is pinned. Upstream's current pyproject references a missing optional uv workspace member; the setup therefore uses `uv pip install .` rather than `uv sync`.

Login is interactive using Gemini CLI's own authentication flow. Provider access and quotas are determined by that account. This is separate from the Site's anonymous OVHcloud access. Declining API keys does not require a paid API account, but provider OAuth access still needs to be available.

The default run uses Gemini, normal permission prompts, local compute, no GitHub publishing, no paper generation, a resource-discovery timeout of 300 seconds, and an experiment-runner timeout of 1800 seconds. It pauses after resource discovery so the plan can be reviewed. These are stage limits, not a hard wall-clock limit for the whole workflow. BLAS/OpenMP threads are limited to two. Native mode does not enforce a 4 GB RAM or two-core CPU cap; use Docker with explicit limits for that. The Docker daemon/Desktop is not installed by this script.

A MacBook Air with 16 GB RAM should use sequential tasks and no local large language model. Actual Apple Silicon compatibility and peak consumption must be checked on that Mac; remote Linux checks do not validate the user's hardware. The managed data budget and remaining space must be checked again before downloading datasets. No baseline PubMed download is part of this installation.

The remote development installation was verified on x86_64 Linux / Python 3.12.14: NeuriCo core and runner help, Gemini version, dependency imports and a real `submit --no-github` of a synthetic test idea passed. Installed runtime plus CLI occupied approximately 592 MiB. No agent authentication or experiment execution was performed. Runtime location in that development session: `/workspace/neurico-runtime`, CLI: `/workspace/neurico-cli`. This environment can be temporary; use the repository setup commands for a durable local installation.

The hosted Site cannot run this Python runtime or automatically access the Mac. File export/import works today. A continuously hosted, authenticated Python service and explicit Site-to-service integration are still required for one-click autonomous execution from the published Site.
