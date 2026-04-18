// Accept Member Pipeline — processes applications that have been fully accepted
//
// Triggered when an issue has the "status:accepted" label.
// This means the applicant has passed: pre-filter → demo → code vetting → council approval.
//
// Steps: parse issue → invite to GitHub org → post transfer-request comment → hand off to transfer-pending.
//
// The leverage map and site member entries are NOT written here — they are
// written by the transfer-pending pipeline once the applicant has actually
// transferred their repo to the org. Writing them earlier would leave phantom
// entries pointing at the applicant's personal repo if the transfer never
// happens.

import type { GitHubIssue } from "../github";
import {
  commentOnIssue,
  transitionStatus,
  inviteToOrg,
} from "../github";
import { parseIssueBody } from "../new-application/parseIssue";
import { GITHUB_ORG } from "../../src/config/github";

export async function runAcceptMemberPipeline(
  issue: GitHubIssue
): Promise<void> {
  try {
    console.log(`\n[Accept] Processing accepted application #${issue.number}...`);

    // --- Parse the submission to get applicant info ---
    const submission = parseIssueBody(issue.number, issue.url, issue.body, issue.author);
    if (!submission) {
      await commentOnIssue(
        issue.number,
        "### Could not process acceptance\n\nCould not parse the original submission from this issue. Please process manually."
      );
      return;
    }

    const { applicantGithub, displayName, repoOwner, repoName } = submission;
    console.log(`  Applicant: ${displayName} (@${applicantGithub})`);

    // --- Invite to GitHub org ---
    console.log(`\n[Accept] Inviting @${applicantGithub} to ${GITHUB_ORG}...`);

    const invite = await inviteToOrg(GITHUB_ORG, applicantGithub);
    console.log(`  ${invite.message}`);

    if (!invite.success) {
      console.error(`Invite failed: ${invite.message}`);
      await commentOnIssue(
        issue.number,
        [
          `### Org invitation failed`,
          ``,
          `Could not invite @${applicantGithub} to the \`${GITHUB_ORG}\` organization.`,
          ``,
          `Please invite manually and close this issue.`,
        ].join("\n")
      );
      return;
    }

    // --- Post welcome comment ---
    // The transfer-pending pipeline reads TRANSFER_PENDING_SINCE to decide when
    // to post nudges and when to escalate. Drop it in the welcome comment so
    // the baseline is unambiguous (issue.updatedAt changes every time we post).
    console.log(`\n[Accept] Posting welcome + transfer request...`);

    const pendingSince = new Date().toISOString().split("T")[0];

    await commentOnIssue(
      issue.number,
      [
        `## Welcome to AI Tavern, @${applicantGithub}!`,
        ``,
        `You've cleared every gate — application, demo, champion, and code review. You earned this.`,
        ``,
        `**Next steps (required):**`,
        `1. ${invite.message}`,
        `2. Accept the org invitation at https://github.com/orgs/${GITHUB_ORG}/invitation`,
        `3. **Transfer your repository to \`${GITHUB_ORG}\`.** This is mandatory — ownership moves, forks and mirrors don't count. Go to https://github.com/${repoOwner}/${repoName}/settings → "Transfer ownership" → target \`${GITHUB_ORG}\`. Once transferred, every member can run, fork, and improve it — that is what makes your system shared leverage.`,
        ``,
        `I'll automatically detect the transfer within 24 hours of it landing and finalize your onboarding — you'll be added to the leverage map and listed on the site. If you need more time or hit a snag, just comment on this issue.`,
        ``,
        `---`,
        `*Processed by the AI Tavern Chief of Staff.*`,
        `<!-- TRANSFER_PENDING_SINCE:${pendingSince} -->`,
      ].join("\n")
    );

    await transitionStatus(issue.number, "accepted", "transfer-pending");

    console.log(
      `\nAcceptance complete for #${issue.number}: @${applicantGithub} invited, awaiting repo transfer.`
    );
  } catch (err: any) {
    console.error(`Accept pipeline error for #${issue.number}:`, err.message);
    try {
      await commentOnIssue(
        issue.number,
        `### Acceptance processing failed\n\nAn error occurred while processing the acceptance. Please handle manually.\n\nError: \`${err.message}\``
      );
    } catch {
      console.error("Could not post error comment");
    }
  }
}
