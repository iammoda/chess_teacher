import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SECRET_PATTERNS = [
  {
    name: "OpenAI API key",
    pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g,
  },
];

const ignoredPrefixes = [
  "vendor/",
];

const trackedFiles = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((file) => !ignoredPrefixes.some((prefix) => file.startsWith(prefix)));

const findings = [];

for (const file of trackedFiles) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  for (const { name, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) {
      const before = text.slice(0, match.index);
      const line = before.split("\n").length;
      findings.push(`${file}:${line} ${name}`);
    }
  }
}

if (findings.length) {
  console.error("Potential secrets found in tracked files:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(`Secret scan passed for ${trackedFiles.length} tracked files.`);
