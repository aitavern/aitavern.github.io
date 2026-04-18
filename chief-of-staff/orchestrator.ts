#!/usr/bin/env bun
// Chief of Staff — Orchestrator
// Polls for work across all pipelines and dispatches accordingly.
//
// Usage:
//   bun chief-of-staff/orchestrator.ts                     # poll all pipelines
//   bun chief-of-staff/orchestrator.ts --issue <url|number> # run pre-filter on a specific issue
//
// State machine (label-driven):
//   application → assessing → tentative-accept → demo-passed → champion-needed → champion-secured → code-vetting → code-vetted → accepted → transfer-pending → onboarded
//                           → rejected
//                           → needs-council-decision
//                           → awaiting-access (private repo, waiting for invite)
//                           → transfer-pending → needs-council-decision (if transfer stalls past 14d)

import { parseArgs } from "util";
import {
  listIssuesByLabel,
  listStaleIssuesByLabel,
  fetchIssue,
  commentOnIssue,
  transitionStatus,
} from "./github";
import { runNewApplicationPipeline } from "./new-application/pipeline";
import { runChampionPipeline } from "./champion/pipeline";
import { runCodeVettingPipeline } from "./code-vetting/pipeline";
import { runAcceptMemberPipeline } from "./accept-member/pipeline";
import { runTransferPendingPipeline } from "./transfer-pending/pipeline";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    issue: { type: "string" },
    help: { type: "boolean", default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`
Chief of Staff — AI Tavern Orchestrator

Usage:
  bun chief-of-staff/orchestrator.ts                        Poll for new work across all pipelines
  bun chief-of-staff/orchestrator.ts --issue <url|number>   Run pre-filter pipeline on a specific issue

Pipelines:
  new-application    Pre-filter assessment (text + optional code screening)
  code-vetting       Post-demo deep code review
  accept-member      Process accepted applications — invite to org, ask for repo transfer
  transfer-pending   Verify repo transfer landed; nudge or escalate if not

State machine:
  application → assessing → tentative-accept → demo-passed → champion-needed → champion-secured → code-vetting → code-vetted → accepted → transfer-pending → onboarded
`);
  process.exit(0);
}

async function main() {
  console.log("═══ Chief of Staff — AI Tavern ═══\n");

  // Mode 1: Direct issue — run pre-filter pipeline on a specific issue
  if (values.issue) {
    console.log(`Direct mode: processing issue ${values.issue}\n`);
    const issue = await fetchIssue(values.issue);
    await runNewApplicationPipeline(issue);
    return;
  }

  // Mode 2: Poll — check all pipelines for work
  console.log("Poll mode: checking for work...\n");

  await pollNewApplications();
  await pollAwaitingAccess();
  await pollDemoPassed();
  await pollCodeVetting();
  await pollAcceptedMembers();
  await pollTransferPending();
  await pollStuckStates();

  console.log("\nPoll complete.");
}

/** Poll for new application issues that need pre-filtering */
async function pollNewApplications() {
  console.log("── New Applications ──");

  const submitted = await listIssuesByLabel("application");
  // Filter out issues that already have a status label (already processed)
  const unprocessed = submitted.filter(
    (issue) => !issue.labels.some((l) => l.startsWith("status:"))
  );

  console.log(`  Found ${unprocessed.length} new application(s)`);

  for (const issue of unprocessed) {
    console.log(`  Processing #${issue.number}: ${issue.title}`);
    await runNewApplicationPipeline(issue);
  }
}

/** Poll for private repo applications awaiting collaborator invite */
async function pollAwaitingAccess() {
  console.log("\n── Awaiting Access ──");

  const awaiting = await listIssuesByLabel("status:awaiting-access");
  console.log(`  Found ${awaiting.length} awaiting-access application(s)`);

  for (const issue of awaiting) {
    console.log(`  Re-checking #${issue.number}: ${issue.title}`);
    await runNewApplicationPipeline(issue);
  }
}

/** Poll for issues that passed demo and need a champion assigned */
async function pollDemoPassed() {
  console.log("\n── Demo Passed (awaiting champion) ──");

  const demoPassed = await listIssuesByLabel("status:demo-passed");
  console.log(`  Found ${demoPassed.length} demo-passed application(s) needing a champion`);

  for (const issue of demoPassed) {
    console.log(`  Processing #${issue.number}: ${issue.title}`);
    await runChampionPipeline(issue);
  }
}

/** Poll for issues that have a champion secured and need code vetting */
async function pollCodeVetting() {
  console.log("\n── Code Vetting ──");

  const championSecured = await listIssuesByLabel("status:champion-secured");
  console.log(`  Found ${championSecured.length} champion-secured application(s) needing code vetting`);

  for (const issue of championSecured) {
    console.log(`  Processing #${issue.number}: ${issue.title}`);
    await runCodeVettingPipeline(issue);
  }
}

/** Poll for fully accepted members ready for onboarding */
async function pollAcceptedMembers() {
  console.log("\n── Accepted Members ──");

  const accepted = await listIssuesByLabel("status:accepted");
  console.log(`  Found ${accepted.length} accepted application(s) to process`);

  for (const issue of accepted) {
    console.log(`  Processing #${issue.number}: ${issue.title}`);
    await runAcceptMemberPipeline(issue);
  }
}

/**
 * Poll for issues waiting on the applicant to transfer their repo ownership
 * to the org. The transfer-pending pipeline decides per-issue whether to
 * finalize (repo now under org), nudge (3d/7d reminders), or escalate to
 * needs-council-decision (14d stalled).
 */
async function pollTransferPending() {
  console.log("\n── Transfer Pending ──");

  const pending = await listIssuesByLabel("status:transfer-pending");
  console.log(`  Found ${pending.length} application(s) awaiting repo transfer`);

  for (const issue of pending) {
    console.log(`  Checking #${issue.number}: ${issue.title}`);
    await runTransferPendingPipeline(issue);
  }
}

/**
 * Staleness sweep — catches issues stuck in transient states after an
 * orchestrator crash. Label transitions are not atomic, so a pipeline that
 * dies between `transitionStatus(to: assessing)` and posting its report
 * leaves the issue in a black hole (every other poll filters out status:*).
 *
 * Per-label thresholds are tuned to real pipeline runtimes:
 *   - assessing: 30 min (text/recon pipelines run ~5 min worst case)
 *   - code-vetting: 2 h (deep code review can be slow)
 *
 * Any stale issue is dead-lettered to needs-council-decision with a
 * diagnostic comment. Retries belong inside pipelines; the sweeper does
 * not loop on deterministic failures.
 */
async function pollStuckStates() {
  console.log("\n── Stuck State Sweep ──");

  const sweeps: Array<{ label: string; maxAgeMinutes: number }> = [
    { label: "status:assessing", maxAgeMinutes: 30 },
    { label: "status:code-vetting", maxAgeMinutes: 120 },
  ];

  for (const { label, maxAgeMinutes } of sweeps) {
    const stale = await listStaleIssuesByLabel(label, maxAgeMinutes);
    console.log(
      `  Found ${stale.length} stale issue(s) in ${label} (>${maxAgeMinutes}m)`
    );

    for (const issue of stale) {
      const from = label.replace("status:", "");
      console.log(
        `  Dead-lettering #${issue.number} (last updated ${issue.updatedAt})`
      );
      try {
        await commentOnIssue(
          issue.number,
          [
            `### Stuck in \`${label}\` — routed to manual review`,
            ``,
            `This issue has been in \`${label}\` since ${issue.updatedAt} with no progress (threshold: ${maxAgeMinutes} minutes). The orchestrator likely crashed mid-run.`,
            ``,
            `Transitioning to \`status:needs-council-decision\` for human investigation. A council member should review the issue state and re-run the pipeline manually if appropriate.`,
          ].join("\n")
        );
        await transitionStatus(issue.number, from, "needs-council-decision");
      } catch (err: any) {
        console.error(
          `  Could not dead-letter #${issue.number}: ${err.message}`
        );
      }
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
