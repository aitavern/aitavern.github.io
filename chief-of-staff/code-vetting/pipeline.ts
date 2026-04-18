// Code Vetting Pipeline — post-champion deep code review
//
// Triggered when an applicant has passed the demo, secured a Champion, and
// invited the bot as a collaborator. This is Stage 5 of the membership pipeline.
//
// If the applicant already opted into code screening during Stage 2 AND recon was successful,
// this stage is skipped — the code was already reviewed.

import type { GitHubIssue } from "../github";
import { commentOnIssue, transitionStatus, listIssueComments } from "../github";
import { GITHUB_BOT_USERNAME } from "../../src/config/github";
import { parseIssueBody } from "../new-application/parseIssue";
import { checkRepoAccess } from "../new-application/accessCheck";
import {
  cloneRepo,
  cleanupRepo,
  fetchDefaultBranchSha,
} from "../new-application/cloneRepo";
import { spawnAgent } from "../new-application/spawnAgent";
import {
  formatCodeVettingComment,
  postVerdictComment,
  labelCodeVetting,
} from "../new-application/report";
import {
  validateCodeVettingOutput,
  codeVettingRubricVars,
} from "../new-application/rubric";
import type { CodeVettingReport } from "../new-application/types";

export async function runCodeVettingPipeline(
  issue: GitHubIssue
): Promise<void> {
  try {
    console.log(`\n[Code Vetting] Processing #${issue.number}...`);

    // --- Parse submission ---
    const submission = parseIssueBody(issue.number, issue.url, issue.body, issue.author);
    if (!submission) {
      await commentOnIssue(
        issue.number,
        "### Could not process code vetting\n\nCould not parse the original submission. Please handle manually."
      );
      return;
    }

    // --- Check if code was already screened ---
    // If the issue has a label indicating code was already screened in Stage 2,
    // verify the HEAD SHA is still the one we screened. If it matches, skip the
    // redundant full vetting. If it has drifted, run full vetting — the applicant
    // could have pushed unreviewed code between screening and demo.
    if (issue.labels.includes("code-screened")) {
      const screenedSha = await findScreenedSha(issue.number);
      let currentSha: string | null = null;
      try {
        currentSha = await fetchDefaultBranchSha(
          submission.repoOwner,
          submission.repoName
        );
      } catch (err: any) {
        console.log(`  Could not fetch current HEAD SHA: ${err.message}`);
      }

      if (screenedSha && currentSha && screenedSha === currentSha) {
        console.log(
          `  Code was already screened at ${screenedSha.slice(0, 12)} and HEAD matches. Skipping full vetting.`
        );
        await commentOnIssue(
          issue.number,
          [
            "### Code Vetting — Already Screened",
            "",
            `This repository was already screened during the initial assessment at commit \`${screenedSha.slice(0, 12)}\`, and the current HEAD still matches. No additional code review needed.`,
            "",
            "---",
            "",
            "### 👉 Next Step",
            "",
            "**Council:** swap `status:code-vetted` to `status:accepted` to trigger the accept-member pipeline.",
            "",
            "- The accept-member pipeline will invite the applicant to the org and ask them to transfer the repo.",
            "- No further code review is needed unless someone objects to the prior pre-filter assessment.",
          ].join("\n")
        );
        await transitionStatus(issue.number, "champion-secured", "code-vetted");
        return;
      }

      console.log(
        `  Code-screened shortcut not valid — screenedSha=${screenedSha?.slice(0, 12) ?? "null"}, currentSha=${currentSha?.slice(0, 12) ?? "null"}. Running full vetting.`
      );
      await commentOnIssue(
        issue.number,
        [
          "### Code Vetting — Re-verifying",
          "",
          screenedSha && currentSha
            ? `The repository HEAD has changed since screening (\`${screenedSha.slice(0, 12)}\` → \`${currentSha.slice(0, 12)}\`). Running a fresh code review to vet the current state.`
            : "Could not confirm the screened commit matches the current HEAD. Running a fresh code review to be safe.",
        ].join("\n")
      );
    }

    // --- Check repo access ---
    console.log(`  Checking access to ${submission.repoOwner}/${submission.repoName}...`);

    const access = await checkRepoAccess(submission.repoOwner, submission.repoName);

    if (access.status === "awaiting-invitation") {
      console.log("  No access yet. Reminding applicant to invite bot.");
      await commentOnIssue(
        issue.number,
        [
          "### Awaiting Repository Access",
          "",
          `I don't have access to \`${submission.repoOwner}/${submission.repoName}\` yet.`,
          "",
          `Please invite **@${GITHUB_BOT_USERNAME}** as a read-only collaborator on your repository so I can proceed with the code review.`,
          "",
          "I'll automatically detect the invitation and begin the review.",
        ].join("\n")
      );
      return;
    }

    if (access.status === "error") {
      await commentOnIssue(
        issue.number,
        `### Access Error\n\nCould not access repository: ${access.message}`
      );
      return;
    }

    // --- Clone and vet ---
    console.log(`  Cloning ${submission.repoOwner}/${submission.repoName}...`);

    let clonePath: string;
    try {
      const clone = await cloneRepo(submission.repoOwner, submission.repoName);
      clonePath = clone.path;
    } catch (err: any) {
      console.error(`Clone failed: ${err.message}`);
      await commentOnIssue(
        issue.number,
        `### Clone Failed\n\nCould not clone the repository. The council has been notified.`
      );
      return; // stays at champion-secured — will retry on next poll
    }

    await transitionStatus(issue.number, "champion-secured", "code-vetting");

    try {
      console.log("  Running code vetting agent...");

      // Structured input — no raw body (prompt injection defense).
      // Threshold values come from the rubric so prompt and validator stay aligned.
      const report = await spawnAgent<CodeVettingReport>("codevetting", {
        SYSTEM_DESCRIPTION: submission.systemDescription,
        JUSTIFICATION: submission.justification,
        ...codeVettingRubricVars(),
      }, { addDir: clonePath });

      // Validate output (prompt injection defense layer 2)
      const validation = validateCodeVettingOutput(report);
      if (!validation.valid) {
        console.error(`  Vetting output validation failed: ${validation.errors.join(", ")}`);
        await commentOnIssue(
          issue.number,
          "### Code vetting requires manual review\n\nThe automated review produced an unexpected result. A council member will review manually."
        );
        await transitionStatus(issue.number, "code-vetting", "needs-council-decision");
        return;
      }

      console.log(`  Outcome: ${report.outcome}`);

      // --- Post report ---
      const comment = formatCodeVettingComment(submission, report);
      await postVerdictComment(issue.number, comment);
      await labelCodeVetting(issue.number, report.outcome);

      // Transition based on outcome
      const newStatus = getStatusForOutcome(report.outcome);
      await transitionStatus(issue.number, "code-vetting", newStatus);

      // Post a clear next-step block — tells humans exactly what to do now.
      if (report.outcome === "clean") {
        await commentOnIssue(
          issue.number,
          [
            "### 👉 Next Step",
            "",
            `**Council:** code review is clean — no further review required.`,
            "",
            "- Swap `status:code-vetted` to `status:accepted` to trigger the accept-member pipeline.",
            "- That pipeline will invite the applicant to the org and ask for the repo transfer.",
          ].join("\n")
        );
      } else if (report.outcome === "conditions") {
        await commentOnIssue(
          issue.number,
          [
            "### 👉 Next Step",
            "",
            `**Applicant (@${submission.applicantGithub}):** address the conditions listed above within 30 days, then comment on this issue.`,
            "",
            "**Council:** once the applicant reports the conditions are met, swap `status:conditions-pending` back to `status:champion-secured` to re-run code vetting. If the 30-day window lapses with no progress, transition to `status:rejected`.",
          ].join("\n")
        );
      } else if (report.outcome === "misrepresented") {
        await commentOnIssue(
          issue.number,
          [
            "### 👉 Next Step",
            "",
            `**Council:** the code does not match what was described or demoed — see misrepresentations above. The issue has been transitioned to \`status:rejected\`.`,
            "",
            "- If you agree with the finding, close the issue.",
            "- If the misrepresentation is a false positive, remove `status:rejected`, document why in a comment, and add `status:champion-secured` to re-run.",
          ].join("\n")
        );
      }

      console.log(`\nCode vetting complete for #${issue.number}: ${report.outcome}`);
    } finally {
      await cleanupRepo(clonePath);
    }
  } catch (err: any) {
    console.error(`Code vetting error for #${issue.number}:`, err.message);
    try {
      await commentOnIssue(
        issue.number,
        `### Code vetting failed\n\nAn error occurred. The council has been notified for manual review.`
      );
      // If we already transitioned to code-vetting, move to needs-council-decision
      // so the issue doesn't get stuck
      if (issue.labels.some((l) => l === "status:code-vetting")) {
        await transitionStatus(issue.number, "code-vetting", "needs-council-decision");
      }
    } catch {
      console.error("Could not post error comment");
    }
  }
}

/**
 * Scan issue comments for the SCREENED_SHA marker written by the new-application
 * pipeline when it originally screened the repo.
 */
async function findScreenedSha(issueNumber: number): Promise<string | null> {
  try {
    const comments = await listIssueComments(issueNumber);
    for (const body of comments) {
      const match = body.match(/<!--\s*SCREENED_SHA:([0-9a-f]{7,40})\s*-->/i);
      if (match) return match[1];
    }
  } catch (err: any) {
    console.log(`  Could not read comments for #${issueNumber}: ${err.message}`);
  }
  return null;
}

function getStatusForOutcome(outcome: string): string {
  switch (outcome) {
    case "clean":
      return "code-vetted";
    case "conditions":
      return "conditions-pending";
    case "misrepresented":
      return "rejected";
    default:
      return "needs-council-decision";
  }
}
