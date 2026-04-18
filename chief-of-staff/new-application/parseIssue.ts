// Parse a GitHub issue body into structured submission data
// Supports GitHub issue template format (### heading style)

import type { SubmissionData, ReviewMode } from "./types";

/**
 * Extract a field value from the issue body.
 * Supports two formats:
 *   - **Field Name:** value        (bold-field style)
 *   - ### Field Name\n\nvalue      (heading style, used by GitHub issue templates)
 */
function extractField(body: string, ...fieldNames: string[]): string {
  for (const fieldName of fieldNames) {
    // Try bold-field style: "**FieldName:** value"
    const boldPattern = new RegExp(
      `\\*\\*${fieldName}:\\*\\*\\s*(.+?)(?:\\n|$)`,
      "i"
    );
    const boldMatch = body.match(boldPattern);
    if (boldMatch) return boldMatch[1].trim();

    // Try heading style: "### Field Name\n\nvalue"
    const headingPattern = new RegExp(
      `###\\s+${fieldName}\\s*\\n+([\\s\\S]*?)(?=\\n###\\s|\\n##\\s|$)`,
      "i"
    );
    const headingMatch = body.match(headingPattern);
    if (headingMatch) return headingMatch[1].trim();
  }
  return "";
}

/**
 * Find the first GitHub repo URL anywhere in the body.
 */
function findRepoUrl(body: string): string | null {
  const match = body.match(
    /https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/
  );
  return match ? match[0] : null;
}

/**
 * Parse a repo URL into owner and name.
 */
function parseRepoUrl(url: string): { owner: string; name: string } | null {
  const match = url.match(
    /github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?(?:\/|$)/
  );
  if (!match) return null;
  return { owner: match[1], name: match[2] };
}

/**
 * Parse the review mode dropdown value into our enum.
 */
function parseReviewMode(raw: string): ReviewMode {
  const lower = raw.toLowerCase();
  if (lower.includes("public")) return "screen-public";
  if (lower.includes("private") || lower.includes("invite")) return "screen-private";
  return "text-only";
}

export function parseIssueBody(
  issueNumber: number,
  issueUrl: string,
  body: string,
  issueAuthor?: string
): SubmissionData | null {
  const repoUrl =
    extractField(body, "GitHub Repo URL", "Repo URL", "Repository URL", "Repository") ||
    findRepoUrl(body);
  if (!repoUrl) return null;

  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) return null;

  const systemDescription = extractField(
    body,
    "System Description",
    "Description",
    "Project Description"
  );

  const justification = extractField(
    body,
    "10x-Everyone Justification",
    "10x Justification",
    "Justification"
  );

  const reviewModeRaw = extractField(
    body,
    "Code Review Preference",
    "Review Mode"
  );

  // Use issue author if available, fall back to repo owner
  const applicantGithub = issueAuthor || parsed.owner;

  // Display name is applicant-controlled free text that ends up in a
  // committed JSON file rendered on the public site. Sanitize here so all
  // writers (leverageMap, members.json) consume a clean value.
  const rawDisplayName = extractField(body, "Display Name", "Your Name");
  const displayName = sanitizeDisplayName(rawDisplayName) || applicantGithub;

  return {
    issueNumber,
    issueUrl,
    repoUrl,
    repoOwner: parsed.owner,
    repoName: parsed.name,
    applicantGithub,
    displayName,
    systemDescription,
    justification,
    reviewMode: parseReviewMode(reviewModeRaw),
    rawBody: body,
    parsedAt: new Date().toISOString(),
  };
}

/**
 * Clean display name: strip control chars + newlines, collapse whitespace,
 * trim, cap at 100 chars. Returns "" if input is empty after cleaning so the
 * caller can fall back to the GitHub handle.
 */
function sanitizeDisplayName(raw: string): string {
  if (!raw) return "";
  // Strip Unicode "Other" category (control, format, surrogate, etc.) and
  // collapse whitespace runs into single spaces.
  const cleaned = raw
    .replace(/\p{C}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned.slice(0, 100);
}
