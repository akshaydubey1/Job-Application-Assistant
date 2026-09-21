import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const forbidden = [
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  /(?:ghp|github_pat|glpat|xox[baprs])_[A-Za-z0-9_-]{12,}/,
  /AKIA[0-9A-Z]{16}/,
  /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{12,}["']/i,
  /@gmail\.com|@yahoo\.com|@outlook\.com/i,
  /\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/
];

const ignoredDirectories = new Set([".git", "node_modules", "__pycache__", ".venv", "venv"]);
const ignoredFiles = new Set(["package-lock.json"]);
const findings = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (!ignoredFiles.has(entry.name) && !entry.name.endsWith(".zip")) await inspect(path);
  }
}

async function inspect(path) {
  const content = await readFile(path, "utf8");
  content.split(/\r?\n/).forEach((line, index) => {
    const sanitizedFixtureLine = line.replace(/\b\d{3}[-. ]555[-. ]\d{4}\b/g, "synthetic-phone");
    if (forbidden.some((pattern) => pattern.test(sanitizedFixtureLine))) findings.push(`${relative(root, path)}:${index + 1}`);
  });
}

await walk(root);
if (findings.length) {
  console.error(`Potential public-release secret or personal data found at: ${findings.join(", ")}`);
  process.exit(1);
}
console.log("Public-release scan passed: no configured secret or personal-data patterns found.");
