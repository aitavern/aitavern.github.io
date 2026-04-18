// Transfer Pending Pipeline — verifies the applicant has transferred their
// repo ownership to the org, and nudges / escalates if they haven't.
//
// Triggered when an issue has the "status:transfer-pending" label (set by
// accept-member after the council accepts and the bot invites the applicant
// to the org).
//
// On each poll we do one of four things:
//   1. Repo now lives under GITHUB_ORG → finalize: write leverage map +
//      members.json, post confirmation, transition to onboarded, close issue.
//   2. Repo not under org yet, 0–2 days since welcome → no-op.
//   3. Repo not under org yet, 3+/7+ days since welcome → post a reminder
//      (once per threshold, tracked via TRANSFER_REMINDER:<n> markers).
//   4. Repo not under org yet, 14+ days since welcome → escalate to
//      needs-council-decision. The council can chase manually or drop them.

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import type { GitHubIssue } from "../github";
import {
  commentOnIssue,
  transitionStatus,
  closeIssue,
  listIssueComments,
  repoExists,
} from "../github";
import { parseIssueBody } from "../new-application/parseIssue";
import type {
  LeverageMap,
  LeverageMapMember,
} from "../new-application/types";
import { GITHUB_ORG } from "../../src/config/github";

const PIPELINE_DIR = dirname(import.meta.path);
const LEVERAGE_MAP_PATH = join(PIPELINE_DIR, "../new-application/leverageMap.json");
const MEMBERS_JSON_PATH = join(PIPELINE_DIR, "../../src/config/members.json");

interface SiteMember {
  name: string;
  contribution: string;
  repo: string;
}

/** Nudge cadence (days since TRANSFER_PENDING_SINCE). */
const REMINDER_DAYS = [3, 7] as const;
const ESCALATION_DAYS = 14;

export async function runTransferPendingPipeline(
  issue: GitHubIssue
): Promise<void> {
  try {
    console.log(`\n[Transfer] Checking #${issue.number}...`);

    const submission = parseIssueBody(issue.number, issue.url, issue.body, issue.author);
    if (!submission) {
      await commentOnIssue(
        issue.number,
        "### Could not process transfer check\n\nCould not parse the original submission. Please handle manually."
      );
      return;
    }

    const { applicantGithub, displayName, repoOwner, repoName, systemDescription } = submission;

    // --- 1. Has the repo been transferred? ---
    const transferred = await repoExists(GITHUB_ORG, repoName);
    console.log(
      `  ${GITHUB_ORG}/${repoName} exists: ${transferred} (original: ${repoOwner}/${repoName})`
    );

    if (transferred) {
      await finalizeOnboarding(issue, {
        applicantGithub,
        displayName,
        repoName,
        systemDescription: systemDescription || "",
        originalRepoOwner: repoOwner,
      });
      return;
    }

    // --- 2. Not transferred yet — decide whether to nudge or escalate. ---
    const comments = await listIssueComments(issue.number);
    const pendingSinceDays = daysSincePendingStart(comments);

    if (pendingSinceDays === null) {
      console.log(
        `  No TRANSFER_PENDING_SINCE marker found — skipping. Accept-member may have failed to post the welcome comment.`
      );
      return;
    }

    console.log(`  ${pendingSinceDays} day(s) since transfer-pending began.`);

    if (pendingSinceDays >= ESCALATION_DAYS) {
      await escalateStalled(issue.number, applicantGithub, pendingSinceDays);
      return;
    }

    const sentReminders = sentReminderIndexes(comments);
    for (const threshold of REMINDER_DAYS) {
      if (pendingSinceDays >= threshold && !sentReminders.has(threshold)) {
        await postReminder(issue.number, applicantGithub, repoOwner, repoName, threshold);
        return;
      }
    }

    console.log(`  No nudge threshold crossed since last run.`);
  } catch (err: any) {
    console.error(`Transfer-pending pipeline error for #${issue.number}:`, err.message);
    try {
      await commentOnIssue(
        issue.number,
        `### Transfer check failed\n\nAn error occurred while checking for the repo transfer. Please handle manually.\n\nError: \`${err.message}\``
      );
    } catch {
      console.error("Could not post error comment");
    }
  }
}

/**
 * Transfer confirmed — write the leverage map + site members entries (both now
 * pointing at the org-owned URL), post a confirmation comment, transition to
 * onboarded, and close the issue. This is the step previously done in
 * accept-member before transfer verification existed.
 */
async function finalizeOnboarding(
  issue: GitHubIssue,
  info: {
    applicantGithub: string;
    displayName: string;
    repoName: string;
    systemDescription: string;
    originalRepoOwner: string;
  }
): Promise<void> {
  const { applicantGithub, displayName, repoName, systemDescription, originalRepoOwner } = info;
  const orgRepoUrl = `https://github.com/${GITHUB_ORG}/${repoName}`;
  const orgRepoSlug = `${GITHUB_ORG}/${repoName}`;

  // --- Update leverage map ---
  console.log(`  [Finalize] Updating leverage map...`);
  const leverageMap = loadLeverageMap();
  const alreadyMember = leverageMap.members.some(
    (m) => m.github.toLowerCase() === applicantGithub.toLowerCase()
  );

  if (!alreadyMember) {
    const category = categoryFromLabels(issue.labels);
    if (!category) {
      console.warn(
        `  No category:* label found on #${issue.number}. Falling back to "uncategorized".`
      );
    }
    const newMember: LeverageMapMember = {
      github: applicantGithub,
      name: displayName,
      contribution: {
        repo: orgRepoSlug,
        category: category ?? "uncategorized",
        description: systemDescription,
        capabilities: [],
        stack: [],
      },
      joined: new Date().toISOString().split("T")[0],
    };
    leverageMap.members.push(newMember);
    leverageMap.lastUpdated = new Date().toISOString().split("T")[0];
    saveLeverageMap(leverageMap);
    console.log(`  Added @${applicantGithub} to leverage map.`);
  } else {
    console.log(`  @${applicantGithub} already in leverage map, skipping.`);
  }

  // --- Update site members.json ---
  console.log(`  [Finalize] Updating site members.json...`);
  const siteMembers = loadSiteMembers();
  const alreadyOnSite = siteMembers.some((m) => m.repo === orgRepoUrl);
  if (!alreadyOnSite) {
    siteMembers.push({
      name: displayName,
      contribution: systemDescription || "AI system",
      repo: orgRepoUrl,
    });
    saveSiteMembers(siteMembers);
    console.log(`  Added @${applicantGithub} to site members.`);
  } else {
    console.log(`  @${applicantGithub} already on site, skipping.`);
  }

  // --- Confirmation comment + close ---
  await commentOnIssue(
    issue.number,
    [
      `### Transfer confirmed — welcome aboard, @${applicantGithub}!`,
      ``,
      `I detected the transfer of \`${originalRepoOwner}/${repoName}\` to \`${orgRepoSlug}\`. You've been added to the tavern's leverage map and listed on the site.`,
      ``,
      `Your contribution: ${orgRepoUrl}`,
      ``,
      `Closing this issue.`,
    ].join("\n")
  );

  await transitionStatus(issue.number, "transfer-pending", "onboarded");
  await closeIssue(issue.number, "completed");
  console.log(`  Onboarded @${applicantGithub} — issue #${issue.number} closed.`);
}

async function postReminder(
  issueNumber: number,
  applicantGithub: string,
  repoOwner: string,
  repoName: string,
  dayThreshold: number
): Promise<void> {
  console.log(`  Posting ${dayThreshold}-day reminder for #${issueNumber}.`);
  await commentOnIssue(
    issueNumber,
    [
      `### Reminder: please transfer your repository`,
      ``,
      `Hi @${applicantGithub} — just a nudge that your onboarding is held up waiting on the repo transfer.`,
      ``,
      `Transfer \`${repoOwner}/${repoName}\` to \`${GITHUB_ORG}\` when you get a chance: https://github.com/${repoOwner}/${repoName}/settings → "Transfer ownership" → target \`${GITHUB_ORG}\`.`,
      ``,
      `Once the transfer lands I'll pick it up automatically within a day and finalize your membership.`,
      ``,
      `<!-- TRANSFER_REMINDER:${dayThreshold} -->`,
    ].join("\n")
  );
}

async function escalateStalled(
  issueNumber: number,
  applicantGithub: string,
  pendingSinceDays: number
): Promise<void> {
  console.log(`  Escalating stalled transfer for #${issueNumber} (${pendingSinceDays}d).`);
  await commentOnIssue(
    issueNumber,
    [
      `### Transfer stalled — routed to council`,
      ``,
      `It's been ${pendingSinceDays} days since @${applicantGithub}'s acceptance and the repo hasn't been transferred to \`${GITHUB_ORG}\`. Routing to \`status:needs-council-decision\` so a council member can chase it manually or close it out.`,
    ].join("\n")
  );
  await transitionStatus(issueNumber, "transfer-pending", "needs-council-decision");
}

/**
 * Extract the free-form category the prefilter stamped onto the issue.
 * Returns null if no `category:*` label is present or the value is empty —
 * caller handles the fallback.
 */
function categoryFromLabels(labels: string[]): string | null {
  for (const label of labels) {
    if (!label.startsWith("category:")) continue;
    const value = label.slice("category:".length).trim();
    if (value.length > 0) return value;
  }
  return null;
}

/**
 * Scan comments for `<!-- TRANSFER_PENDING_SINCE:YYYY-MM-DD -->` and return
 * whole days elapsed from that marker until now (UTC day boundary). Returns
 * null if no marker is found.
 */
function daysSincePendingStart(comments: string[]): number | null {
  for (const body of comments) {
    const match = body.match(/<!--\s*TRANSFER_PENDING_SINCE:(\d{4}-\d{2}-\d{2})\s*-->/i);
    if (match) {
      const started = new Date(`${match[1]}T00:00:00Z`).getTime();
      const now = Date.now();
      return Math.floor((now - started) / (1000 * 60 * 60 * 24));
    }
  }
  return null;
}

/** Which reminder thresholds (3, 7, …) have already been sent for this issue. */
function sentReminderIndexes(comments: string[]): Set<number> {
  const sent = new Set<number>();
  for (const body of comments) {
    const match = body.match(/<!--\s*TRANSFER_REMINDER:(\d+)\s*-->/i);
    if (match) sent.add(Number(match[1]));
  }
  return sent;
}

function loadLeverageMap(): LeverageMap {
  return JSON.parse(readFileSync(LEVERAGE_MAP_PATH, "utf-8"));
}

function saveLeverageMap(map: LeverageMap): void {
  writeFileSync(LEVERAGE_MAP_PATH, JSON.stringify(map, null, 2) + "\n");
}

function loadSiteMembers(): SiteMember[] {
  return JSON.parse(readFileSync(MEMBERS_JSON_PATH, "utf-8"));
}

function saveSiteMembers(members: SiteMember[]): void {
  writeFileSync(MEMBERS_JSON_PATH, JSON.stringify(members, null, 2) + "\n");
}
