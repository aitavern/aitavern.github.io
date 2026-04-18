// Shared GitHub API helpers for the Chief of Staff orchestrator

import { $ } from "bun";

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  state: string;
  author: string;
}

/**
 * Fetch a single issue by URL or number.
 */
export async function fetchIssue(
  issueRef: string
): Promise<GitHubIssue> {
  const result =
    await $`gh issue view ${issueRef} --json number,title,body,url,labels,state,author`.quiet();
  const data = JSON.parse(result.text());
  return {
    number: data.number,
    title: data.title,
    body: data.body,
    url: data.url,
    labels: data.labels.map((l: { name: string }) => l.name),
    state: data.state,
    author: data.author?.login ?? "",
  };
}

/**
 * List issues from the repo filtered by label.
 */
export async function listIssuesByLabel(
  label: string
): Promise<GitHubIssue[]> {
  const result =
    await $`gh issue list --label ${label} --state open --json number,title,body,url,labels,state,author`.quiet();
  const data = JSON.parse(result.text());
  return data.map((d: any) => ({
    number: d.number,
    title: d.title,
    body: d.body,
    url: d.url,
    labels: d.labels.map((l: { name: string }) => l.name),
    state: d.state,
    author: d.author?.login ?? "",
  }));
}

/**
 * List issues with the given label whose updatedAt is older than `maxAgeMinutes`.
 *
 * Used by the staleness sweep to detect issues stuck in transient states after
 * an orchestrator crash. The label transition itself (addLabel/removeLabel) is
 * not atomic — if the orchestrator dies between setting the label and starting
 * the work, the issue sits in a transient state forever because the "new work"
 * poll filters out anything with a status label. This helper is load-bearing:
 * without it, crashed pipelines leave applications in a black hole.
 */
export async function listStaleIssuesByLabel(
  label: string,
  maxAgeMinutes: number
): Promise<Array<GitHubIssue & { updatedAt: string }>> {
  const result =
    await $`gh issue list --label ${label} --state open --json number,title,body,url,labels,state,author,updatedAt`.quiet();
  const data = JSON.parse(result.text());
  const threshold = Date.now() - maxAgeMinutes * 60 * 1000;
  return data
    .map((d: any) => ({
      number: d.number,
      title: d.title,
      body: d.body,
      url: d.url,
      labels: d.labels.map((l: { name: string }) => l.name),
      state: d.state,
      author: d.author?.login ?? "",
      updatedAt: d.updatedAt,
    }))
    .filter((issue: any) => new Date(issue.updatedAt).getTime() < threshold);
}

/**
 * Post a comment on an issue.
 */
export async function commentOnIssue(
  issueNumber: number,
  body: string
): Promise<void> {
  await $`gh issue comment ${issueNumber} --body ${body}`.quiet();
}

/**
 * List all comment bodies on an issue, in chronological order.
 */
export async function listIssueComments(
  issueNumber: number
): Promise<string[]> {
  const result = await $`gh issue view ${issueNumber} --json comments`.quiet();
  const data = JSON.parse(result.text());
  return (data.comments ?? []).map((c: any) => c.body ?? "");
}

/**
 * Add a label to an issue, creating the label if it doesn't exist.
 */
export async function addLabel(
  issueNumber: number,
  label: string,
  color: string = "cccccc"
): Promise<void> {
  try {
    await $`gh label create ${label} --color ${color} --force`.quiet();
  } catch {
    // Label may already exist
  }
  await $`gh issue edit ${issueNumber} --add-label ${label}`.quiet();
}

/**
 * Remove a label from an issue.
 */
export async function removeLabel(
  issueNumber: number,
  label: string
): Promise<void> {
  try {
    await $`gh issue edit ${issueNumber} --remove-label ${label}`.quiet();
  } catch {
    // Label may not exist on issue
  }
}

/**
 * Transition an issue's status by swapping labels.
 * Removes the old status label and adds the new one.
 */
export async function transitionStatus(
  issueNumber: number,
  from: string | null,
  to: string
): Promise<void> {
  if (from) {
    await removeLabel(issueNumber, `status:${from}`);
  }
  await addLabel(issueNumber, `status:${to}`, getStatusColor(to));
  console.log(`Issue #${issueNumber}: status → ${to}`);
}

/**
 * Invite a GitHub user to the organization.
 */
export async function inviteToOrg(
  org: string,
  username: string
): Promise<{ success: boolean; message: string }> {
  try {
    const result =
      await $`gh api orgs/${org}/invitations -f invitee_id=$(gh api users/${username} -q .id) --silent`.quiet();
    return { success: true, message: `Invitation sent to @${username}` };
  } catch (err: any) {
    // Check if already a member
    try {
      const membership =
        await $`gh api orgs/${org}/members/${username} --silent`.quiet();
      return { success: true, message: `@${username} is already a member` };
    } catch {
      // Check if invitation already pending
      try {
        const invitations =
          await $`gh api orgs/${org}/invitations --jq ${`[.[] | select(.login == "${username}")] | length`}`.quiet();
        if (invitations.text().trim() !== "0") {
          return { success: true, message: `Invitation already pending for @${username}` };
        }
      } catch {}
    }
    return { success: false, message: `Failed to invite @${username}: ${err.message}` };
  }
}

/**
 * Check whether a repository exists and is visible to us via the GitHub API.
 * Used by the transfer-pending pipeline to confirm the applicant has moved
 * ownership of their repo to the org. Has no side effects — unlike
 * checkRepoAccess, it does not auto-accept pending invitations.
 *
 * Returns true on HTTP 200 from /repos/{owner}/{repo}, false on any error
 * (most commonly 404 — the transfer hasn't happened yet).
 */
export async function repoExists(
  owner: string,
  repo: string
): Promise<boolean> {
  try {
    await $`gh api /repos/${owner}/${repo} --silent`.quiet();
    return true;
  } catch {
    return false;
  }
}

/**
 * Close an issue.
 */
export async function closeIssue(
  issueNumber: number,
  reason: "completed" | "not_planned" = "completed"
): Promise<void> {
  await $`gh issue close ${issueNumber} --reason ${reason}`.quiet();
  console.log(`Closed issue #${issueNumber} (${reason})`);
}

function getStatusColor(status: string): string {
  switch (status) {
    case "awaiting-access":
      return "fbca04";
    case "assessing":
      return "5319e7";
    case "tentative-accept":
      return "0e8a16";
    case "tentative-reject":
      return "d93f0b";
    case "needs-council-decision":
      return "e36209";
    case "demo-passed":
      return "0e8a16";
    case "champion-needed":
      return "fbca04";
    case "champion-secured":
      return "0e8a16";
    case "code-vetting":
      return "5319e7";
    case "code-vetted":
      return "0e8a16";
    case "conditions-pending":
      return "e36209";
    case "rejected":
      return "d93f0b";
    case "accepted":
      return "0e8a16";
    case "transfer-pending":
      return "fbca04";
    case "onboarded":
      return "0e8a16";
    default:
      return "cccccc";
  }
}
