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
