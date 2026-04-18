// Check if we can access a repo, handle private repo invitation flow

import { $ } from "bun";
import { GITHUB_BOT_USERNAME } from "../../src/config/github";

export type AccessResult =
  | { status: "accessible"; isPublic: boolean }
  | { status: "awaiting-invitation" }
  | { status: "error"; message: string };

/**
 * Check if the repo is accessible (public or we have access).
 * If private and no invitation exists, return "awaiting-invitation".
 */
export async function checkRepoAccess(
  owner: string,
  repo: string
): Promise<AccessResult> {
  // Try to access the repo metadata
  try {
    const result =
      await $`gh api /repos/${owner}/${repo} --jq '.private'`.quiet();
    const isPrivate = result.text().trim() === "true";
    return { status: "accessible", isPublic: !isPrivate };
  } catch {
    // 404 or 403 — repo is private and we don't have access
  }

  // Check for pending invitations
  try {
    const invResult =
      await $`gh api /user/repository_invitations --jq '.[].repository.full_name'`.quiet();
    const invitations = invResult
      .text()
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);

    const fullName = `${owner}/${repo}`;
    if (invitations.includes(fullName)) {
      // Accept the invitation
      const idResult =
        await $`gh api /user/repository_invitations --jq '.[] | select(.repository.full_name=="${fullName}") | .id'`.quiet();
      const invId = idResult.text().trim();
      if (invId) {
        await $`gh api -X PATCH /user/repository_invitations/${invId}`.quiet();
        console.log(`Accepted invitation for ${fullName}`);
        return { status: "accessible", isPublic: false };
      }
    }
  } catch (e) {
    console.error("Error checking invitations:", e);
  }

  return { status: "awaiting-invitation" };
}

/**
 * Post a comment on the issue asking the applicant to invite our bot.
 */
export async function requestRepoAccess(
  repoFullName: string,
  issueNumber: number,
  botUsername: string = GITHUB_BOT_USERNAME
): Promise<void> {
  const comment = [
    `### Repo Access Required`,
    ``,
    `The submitted repository (\`${repoFullName}\`) appears to be private, and I don't have access to review it.`,
    ``,
    `**Please invite [@${botUsername}](https://github.com/${botUsername}) as a collaborator** on your repository so I can proceed with the assessment.`,
    ``,
    `Once you've sent the invitation, I'll automatically detect it and begin the review on the next check cycle.`,
  ].join("\n");

  await $`gh issue comment ${issueNumber} --body ${comment}`.quiet();
}
