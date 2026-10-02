import { execSync } from "node:child_process";
import type { GitCache } from "./types.ts";

let gitCache: GitCache | null = null;

export function parseGitStatus(output: string): GitCache {
  let branch: string | null = null;
  let detached = false;
  let oid: string | null = null;
  let dirty = false;
  let ahead = 0;
  let behind = 0;

  for (const line of output.split("\n")) {
    if (!line) continue;

    if (line.startsWith("# branch.oid ")) {
      const value = line.slice("# branch.oid ".length).trim();
      oid = /^[0-9a-f]+$/i.test(value) ? value : null;
      continue;
    }

    if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length).trim();
      detached = head === "(detached)";
      branch = head && !detached ? head : null;
      continue;
    }

    if (line.startsWith("# branch.ab ")) {
      const match = line.match(/^# branch\.ab \+(\d+) -(\d+)$/);
      if (match) {
        ahead = parseInt(match[1]!, 10) || 0;
        behind = parseInt(match[2]!, 10) || 0;
      }
      continue;
    }

    if (!line.startsWith("# ")) dirty = true;
  }

  // A detached HEAD is shown as its short commit id, like `git rev-parse --short HEAD`.
  if (detached && oid) branch = oid.slice(0, 7);

  return { branch, dirty, ahead, behind };
}

export function sameGitCache(a: GitCache | null, b: GitCache | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.branch === b.branch && a.dirty === b.dirty && a.ahead === b.ahead && a.behind === b.behind;
}

export function getGitCache(): GitCache | null {
  return gitCache;
}

export function refreshGitCache(): boolean {
  let next: GitCache | null = null;

  try {
    const status = execSync("git status --porcelain=v2 --branch 2>/dev/null", {
      encoding: "utf8",
      timeout: 1000,
    });
    next = parseGitStatus(status.trimEnd());
  } catch {
    next = null;
  }

  const changed = !sameGitCache(gitCache, next);
  gitCache = next;
  return changed;
}
