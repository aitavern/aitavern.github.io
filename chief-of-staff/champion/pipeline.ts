// Champion Pipeline — transitions demo-passed issues into champion-needed state
// and posts a single council-facing comment asking for a champion.
//
// The Champion gate is the human commitment check between the demo and code
// review: at least one existing member must see the potential and commit to
// installing the applicant's system on their own machine.
//
// Flow:
//   1. Council manually adds status:demo-passed after a successful demo.
//   2. Orchestrator polls demo-passed issues and calls this pipeline.
//   3. Pipeline transitions status:demo-passed → status:champion-needed AND
//      posts the champion-request comment in the same step. State-entry trigger
//      means the comment is posted exactly once per issue.
//   4. When a council member champions, they swap the label manually to
//      status:champion-secured. Code-vetting picks up from there.

import type { GitHubIssue } from "../github";
import { commentOnIssue, transitionStatus } from "../github";
import { parseIssueBody } from "../new-application/parseIssue";

export async function runChampionPipeline(
  issue: GitHubIssue
): Promise<void> {
  try {
    console.log(`\n[Champion] Processing demo-passed issue #${issue.number}...`);

    const submission = parseIssueBody(issue.number, issue.url, issue.body, issue.author);
    const applicantMention = submission ? `@${submission.applicantGithub}` : `the applicant`;

    // Transition first so this pipeline is idempotent: once the label moves to
    // champion-needed, the demo-passed poll skips this issue on future runs,
    // guaranteeing the comment below is posted at most once per issue.
    await transitionStatus(issue.number, "demo-passed", "champion-needed");

    await commentOnIssue(
      issue.number,
      [
        `### Demo passed — champion needed`,
        ``,
        `${applicantMention} has cleared the live demo. Before code review, at least one existing member must step up as **Champion**.`,
        ``,
        `**What a Champion commits to:**`,
        `- You see real potential in this system for your own work.`,
        `- You will install it on your own machine (with the applicant's help if needed).`,
        ``,
        `**If you're willing to champion:** comment on this issue with your commitment, then swap the status label on this issue from \`status:champion-needed\` to \`status:champion-secured\`. Code review will pick up from there.`,
        ``,
        `**If no member champions within the council's review window:** this application does not proceed. No champion, no membership.`,
      ].join("\n")
    );

    console.log(`  Issue #${issue.number} transitioned to champion-needed.`);
  } catch (err: any) {
    console.error(`Champion pipeline error for #${issue.number}:`, err.message);
    try {
      await commentOnIssue(
        issue.number,
        `### Champion step failed\n\nCould not post the champion-request comment. Please handle manually.`
      );
    } catch {
      console.error("Could not post error comment");
    }
  }
}
