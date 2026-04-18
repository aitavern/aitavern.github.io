// Clone a repo to a temp directory for analysis

import { $ } from "bun";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Config files/dirs that agents and AI coding tools read as instructions.
 * An applicant could plant prompt-injection payloads in any of these to
 * steer the reviewing agent. README.md is intentionally NOT stripped — it
 * is legitimate content — instead the prompts treat all repo files as
 * untrusted data (see recon.md and prefilter.md).
 */
const DANGEROUS_PATHS = [
  ".claude",
  "CLAUDE.md",
  ".cursorrules",
  ".cursor",
  ".cursor-rules",
  ".cursorignore",
  "AGENTS.md",
  ".continuerc",
  ".continuerc.json",
  ".mcp.json",
  ".aider.conf.yml",
  ".aider.conf.yaml",
  ".windsurfrules",
  ".windsurf",
  ".zed",
  ".codeiumrc",
  ".github/copilot-instructions.md",
  ".vscode",
  ".idea",
  ".git/hooks",
  ".git/config",
];

export interface CloneResult {
  path: string;
  /** HEAD commit SHA at clone time. Used to SHA-pin the code-screened shortcut. */
  headSha: string;
}

/**
 * Shallow clone a repo to a temp directory.
 * Strips dangerous config files that could inject prompts into the reviewing agent.
 * Returns the clone path and the HEAD SHA captured at clone time.
 */
export async function cloneRepo(
  owner: string,
  repo: string
): Promise<CloneResult> {
  const tempDir = await mkdtemp(join(tmpdir(), `tavern-review-`));
  const clonePath = join(tempDir, repo);
  const repoUrl = `https://github.com/${owner}/${repo}.git`;

  console.log(`Cloning ${owner}/${repo} to ${clonePath}...`);

  await $`git clone --depth=100 ${repoUrl} ${clonePath}`.quiet();

  const shaResult = await $`git -C ${clonePath} rev-parse HEAD`.quiet();
  const headSha = shaResult.text().trim();

  // Strip dangerous config files/dirs that could override agent behavior
  for (const dangerousPath of DANGEROUS_PATHS) {
    const fullPath = join(clonePath, dangerousPath);
    try {
      await rm(fullPath, { recursive: true, force: true });
    } catch {
      // Path doesn't exist — fine
    }
  }

  console.log(`Clone complete (sanitized). HEAD=${headSha.slice(0, 12)}`);
  return { path: clonePath, headSha };
}

/**
 * Fetch the current HEAD SHA of the default branch for a repo, without cloning.
 * Used by code-vetting to verify the code-screened shortcut still matches the
 * code that was originally screened.
 */
export async function fetchDefaultBranchSha(
  owner: string,
  repo: string
): Promise<string> {
  const result = await $`gh api repos/${owner}/${repo}/commits/HEAD -q .sha`.quiet();
  return result.text().trim();
}

/**
 * Clean up a cloned repo directory.
 */
export async function cleanupRepo(clonePath: string): Promise<void> {
  // Remove the parent temp dir (tavern-review-xxx/)
  const parentDir = join(clonePath, "..");
  await rm(parentDir, { recursive: true, force: true });
  console.log(`Cleaned up ${parentDir}`);
}
