import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const region = process.env.AWS_REGION || "sa-east-1";
const days = Number(process.env.DAYS || 1000);
const authorRegex = (process.env.AUTHOR_REGEX || "").trim(); // opcional
const reposFile = ".codecommit-repos.txt";

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    stdio: "pipe",
    encoding: "utf8",
    ...opts,
  }).trim();
}

function isoDateDaysAgo(n) {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readRepos() {
  const raw = fs.readFileSync(reposFile, "utf8");
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
}

function cloneOrFetch(repo, workdir) {
  const url = `https://git-codecommit.${region}.amazonaws.com/v1/repos/${repo}`;
  const repoDir = path.join(workdir, repo);

  if (!fs.existsSync(repoDir)) {
    sh("git", ["clone", "--no-checkout", url, repoDir]);
  } else {
    sh("git", ["-C", repoDir, "remote", "set-url", "origin", url]);
  }

  // traz todas as refs (branches/tags) => "todas as branches"
  const since = isoDateDaysAgo(days + 7);
  try {
    sh("git", [
      "-C",
      repoDir,
      "fetch",
      "--all",
      "--prune",
      `--shallow-since=${since}`,
    ]);
  } catch {
    sh("git", ["-C", repoDir, "fetch", "--all", "--prune"]);
  }

  return repoDir;
}

function countCommits(repoDir) {
  const since = isoDateDaysAgo(days);

  const args = [
    "-C",
    repoDir,
    "log",
    "--all",
    `--since=${since}`,
    "--pretty=%H",
  ];
  if (authorRegex) args.splice(4, 0, `--author=${authorRegex}`);

  const out = sh("git", args);
  if (!out) return 0;
  return out.split("\n").filter(Boolean).length;
}

function updateReadme(block) {
  const start = "<!-- CODECOMMIT:START -->";
  const end = "<!-- CODECOMMIT:END -->";
  const readmePath = "README.md";

  const readme = fs.existsSync(readmePath)
    ? fs.readFileSync(readmePath, "utf8")
    : "";
  const next =
    readme.includes(start) && readme.includes(end)
      ? readme.replace(
          new RegExp(`${start}[\\s\\S]*?${end}`, "m"),
          `${start}\n${block}\n${end}`
        )
      : `${readme}\n\n## CodeCommit Activity\n\n${start}\n${block}\n${end}\n`;

  fs.writeFileSync(readmePath, next, "utf8");
}

function main() {
  const repos = readRepos();
  const workdir = ".tmp-codecommit";
  ensureDir(workdir);

  const rows = [];
  let total = 0;

  for (const repo of repos) {
    const dir = cloneOrFetch(repo, workdir);
    const n = countCommits(dir);
    total += n;
    rows.push({ repo, commits: n });
  }

  rows.sort((a, b) => b.commits - a.commits);

  const updatedAt = new Date().toISOString().slice(0, 10);
  const header =
    `Atualizado em: ${updatedAt} (UTC)\n` +
    `Janela: últimos ${days} dias\n` +
    `Filtro autor: ${authorRegex || "(nenhum — contando todos)"}\n`;

  const table =
    [
      "",
      "| Repositório | Commits |",
      "|---|---:|",
      ...rows.map((r) => `| ${r.repo} | ${r.commits} |`),
      `| **Total** | **${total}** |`,
    ].join("\n") + "\n";

  updateReadme(header + table);
}

main();
