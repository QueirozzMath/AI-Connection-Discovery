import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statfsSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const project = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runtime = resolve(process.env.NEURICO_RUNTIME_ROOT || join(project, ".neurico/runtime"));
const cli = resolve(process.env.NEURICO_CLI_ROOT || join(project, ".neurico/cli"));
const commit = "88d98e888138605258265f8b2ef7090e374ec496";
const geminiVersion = "0.67.0";
const python = join(runtime, ".venv/bin/python");
const gemini = join(cli, "node_modules/.bin/gemini");
const environment = {
  ...process.env,
  OMP_NUM_THREADS: "2",
  OPENBLAS_NUM_THREADS: "2",
  MKL_NUM_THREADS: "2",
  NUMEXPR_NUM_THREADS: "2",
  VECLIB_MAXIMUM_THREADS: "2",
  PATH: join(cli, "node_modules/.bin") + ":" + process.env.PATH,
};
function run(program, args, cwd = runtime) {
  const r = spawnSync(program, args, { cwd, env: environment, stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${program} failed (exit ${r.status})`);
}
function available(program) {
  return spawnSync(program, ["--version"], { stdio: "ignore", env: environment }).status === 0;
}
function installed() {
  if (!existsSync(python) || !existsSync(gemini))
    throw new Error("Execute npm run neurico:setup primeiro.");
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: runtime, encoding: "utf8" });
  if (r.stdout?.trim() !== commit)
    throw new Error(
      "NeuriCo checkout differs from the verified version; do not run this wrapper against another checkout.",
    );
}
try {
  const [action, ...args] = process.argv.slice(2);
  if (action === "setup") {
    if (Number(process.versions.node.split(".")[0]) < 20)
      throw new Error("Node.js 20+ is required.");
    for (const program of ["git", "uv", "npm"])
      if (!available(program))
        throw new Error(
          `Missing ${program}. On macOS install Git/Node and uv (brew install uv), then retry.`,
        );
    mkdirSync(dirname(runtime), { recursive: true });
    const disk = statfsSync(dirname(runtime));
    if (Number(disk.bavail) * Number(disk.bsize) < 22 * 1024 ** 3)
      throw new Error("Keep 20 GB free plus 2 GB installation headroom. Installation paused.");
    let fresh = false;
    if (!existsSync(runtime)) {
      run(
        "git",
        ["clone", "--no-checkout", "https://github.com/ChicagoHAI/NeuriCo.git", runtime],
        project,
      );
      fresh = true;
    }
    const head = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: runtime,
      encoding: "utf8",
    }).stdout?.trim();
    if (head !== commit || fresh) {
      const dirty = spawnSync("git", ["status", "--porcelain"], {
        cwd: runtime,
        encoding: "utf8",
      }).stdout;
      if (!fresh && dirty?.trim())
        throw new Error("Runtime has local changes; preserve them before setup.");
      run("git", ["checkout", "--detach", commit]);
    }
    if (!existsSync(python)) run("uv", ["venv", "--python", "3.12", ".venv"]);
    // pip installation avoids upstream's missing optional uv workspace member.
    run("uv", ["pip", "install", "--python", python, "."]);
    mkdirSync(cli, { recursive: true });
    run(
      "npm",
      [
        "install",
        "--prefix",
        cli,
        `@google/gemini-cli@${geminiVersion}`,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      project,
    );
    const config = join(runtime, "config/workspace.yaml");
    if (!existsSync(config))
      writeFileSync(
        config,
        "workspace:\n  parent_dir: workspaces\n  auto_create: true\n  permissions: 0o700\n",
      );
    console.log("Installed. Authenticate with npm run neurico:login. No experiments started.");
  } else if (action === "doctor") {
    installed();
    run(python, [
      "-c",
      'import yaml,jinja2,github,git,dotenv,requests,bs4,nbformat,fastmcp,httpx,sklearn,numpy,pandas,matplotlib; print("NeuriCo Python dependencies: OK")',
    ]);
    run(gemini, ["--version"]);
    console.log(
      JSON.stringify(
        {
          runtime,
          commit,
          geminiVersion,
          provider: "gemini",
          authentication: "Not inspected; login required before agent execution",
          docker: available("docker"),
          nativeLimits: "BLAS threads=2; runner timeout=1800s. No hard RAM/CPU cap in native mode.",
        },
        null,
        2,
      ),
    );
  } else if (action === "login") {
    installed();
    run(gemini, []);
  } else if (action === "submit") {
    installed();
    if (args.length !== 1)
      throw new Error("Usage: npm run neurico:submit -- path/to/neurico-idea.yaml");
    run(python, ["src/cli/submit.py", resolve(args[0]), "--no-github"]);
  } else if (action === "run") {
    installed();
    if (args.length !== 1 || !/^[a-zA-Z0-9_-]+$/.test(args[0]))
      throw new Error("Provide the submitted idea ID.");
    run(python, [
      "src/core/runner.py",
      args[0],
      "--provider",
      "gemini",
      "--no-github",
      "--no-full-permissions",
      "--pause-after-resources",
      "--no-write-paper",
      "--compute-backend",
      "local",
      "--timeout",
      "1800",
      "--resource-finder-timeout",
      "300",
    ]);
  } else throw new Error("Actions: setup, doctor, login, submit, run");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
