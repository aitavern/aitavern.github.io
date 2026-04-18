// Format pre-filter and code vetting reports as markdown comments

import { $ } from "bun";
import type {
  PreFilterReport,
  ReconReport,
  SubmissionData,
  CodeVettingReport,
  TentativeVerdict,
  VettingOutcome,
  QualityAssessment,
  QualityDimension,
} from "./types";
import { QUALITY_DIMENSIONS } from "./types";

/** Human-readable labels for the 10 quality dimensions, shown in the public comment. */
const DIMENSION_LABELS: Record<QualityDimension, string> = {
  acutenessOfNeed: "Acuteness of need",
  uniqueness: "Uniqueness",
  switchingCost: "Switching cost",
  durability: "Durability",
  dogfooding: "Dogfooding",
  builderDepth: "Builder depth",
  failureModeAwareness: "Failure-mode awareness",
  coherence: "Coherence",
  scopeDiscipline: "Scope discipline",
  roomImpact: "Room impact",
};

const VERDICT_LABELS: Record<string, string> = {
  "tentative-accept": "TENTATIVE ACCEPT",
  "tentative-reject": "TENTATIVE REJECT",
  "needs-discussion": "NEEDS DISCUSSION",
};

const VERDICT_EMOJI: Record<string, string> = {
  "tentative-accept": "✅",
  "tentative-reject": "❌",
  "needs-discussion": "🟡",
};

const VETTING_LABELS: Record<string, string> = {
  clean: "CLEAN",
  conditions: "CONDITIONS",
  misrepresented: "MISREPRESENTED",
};

const VETTING_EMOJI: Record<string, string> = {
  clean: "✅",
  conditions: "⚠️",
  misrepresented: "🚫",
};

/**
 * Format the pre-filter assessment into a markdown comment.
 */
export function formatPreFilterComment(
  submission: SubmissionData,
  preFilter: PreFilterReport,
  recon: ReconReport | null
): string {
  const emoji = VERDICT_EMOJI[preFilter.tentativeVerdict] ?? "❓";
  const label = VERDICT_LABELS[preFilter.tentativeVerdict] ?? preFilter.tentativeVerdict;

  const topFive = preFilter.topFivePercent ? "✅ top 5%" : "❌ not top 5%";

  const lines: string[] = [
    `## ${emoji} Pre-Filter Assessment`,
    ``,
    `**Verdict: ${label}** | Confidence: ${preFilter.confidence} | Category: \`${preFilter.category}\` | ${topFive}`,
    ``,
    `> ${preFilter.summary}`,
    ``,
    `---`,
    ``,
  ];

  // Quality scoring — the 10-dimension breakdown (the core judgment)
  lines.push(...renderQualitySection(preFilter.qualityAssessment));

  // Steelman-reject — the required counter-argument
  lines.push(
    `<details>`,
    `<summary><strong>Steelman for rejection</strong></summary>`,
    ``,
    `> ${preFilter.steelmanReject}`,
    ``,
    `</details>`,
    ``
  );

  // Claims Assessment
  lines.push(
    `<details>`,
    `<summary><strong>Claims Assessment</strong></summary>`,
    ``
  );

  if (preFilter.claimsAssessment.falsifiableClaims.length > 0) {
    lines.push(`**Falsifiable claims (verifiable in demo):**`);
    for (const claim of preFilter.claimsAssessment.falsifiableClaims) {
      lines.push(`- ✅ ${claim}`);
    }
    lines.push(``);
  }

  if (preFilter.claimsAssessment.unverifiableClaims.length > 0) {
    lines.push(`**Unverifiable claims:**`);
    for (const claim of preFilter.claimsAssessment.unverifiableClaims) {
      lines.push(`- ❓ ${claim}`);
    }
    lines.push(``);
  }

  if (preFilter.claimsAssessment.concerns.length > 0) {
    lines.push(`**Concerns:**`);
    for (const concern of preFilter.claimsAssessment.concerns) {
      lines.push(`- ⚠️ ${concern}`);
    }
    lines.push(``);
  }

  lines.push(`</details>`, ``);

  // Code screening results (if available)
  if (recon && preFilter.codeScreened) {
    lines.push(
      `<details>`,
      `<summary><strong>Code Screening Results</strong></summary>`,
      ``,
      `| Signal | Value |`,
      `|--------|-------|`,
      `| Language | ${recon.language} / ${recon.framework} |`,
      `| Files | ${recon.fileCount} (${recon.testFileCount} test files) |`,
      `| Commits | ${recon.commitCount} over ${recon.developmentSpanDays} days |`,
      `| Authors | ${recon.authorCount} |`,
      `| README | ${recon.readmeQuality} |`,
      `| Originality | ${recon.originalityScore} |`,
      `| Buildability | ${recon.buildabilitySignals} |`,
      ``,
      `</details>`,
      ``
    );
  }

  // Leverage — 10x Test
  lines.push(
    `<details>`,
    `<summary><strong>Leverage — 10x-Everyone Test</strong></summary>`,
    ``
  );

  if (preFilter.leverageAssessment.tenXDetails.length > 0) {
    lines.push(`| Member | Their Contribution | How This Submission 10x's Them | Passes? |`);
    lines.push(`|--------|-------------------|-------------------------------|---------|`);
    for (const detail of preFilter.leverageAssessment.tenXDetails) {
      const contrib = detail.contribution ? detail.contribution : "—";
      lines.push(
        `| @${detail.member} | ${contrib} | ${detail.benefit} | ${detail.passes ? "✅" : "❌"} |`
      );
    }
  } else {
    lines.push(
      `*No existing members yet — evaluated on standalone merit.*`
    );
  }

  lines.push(``, `</details>`, ``);

  // Synergy & Overlap
  if (
    preFilter.leverageAssessment.overlapLevel !== "none" ||
    preFilter.leverageAssessment.combinationOpportunities.length > 0
  ) {
    lines.push(
      `<details>`,
      `<summary><strong>Synergy & Overlap</strong></summary>`,
      ``
    );

    if (preFilter.leverageAssessment.overlapLevel !== "none" && preFilter.leverageAssessment.overlapWith) {
      lines.push(
        `**Overlap:** ${preFilter.leverageAssessment.overlapLevel} with \`${preFilter.leverageAssessment.overlapWith}\``
      );
      lines.push(``);
    }

    if (preFilter.leverageAssessment.combinationOpportunities.length > 0) {
      lines.push(`**Combination opportunities:**`);
      for (const opp of preFilter.leverageAssessment.combinationOpportunities) {
        lines.push(`- ${opp}`);
      }
    }

    lines.push(``, `</details>`, ``);
  }

  // Thoughts
  if (preFilter.thoughts.length > 0) {
    lines.push(`### Thoughts`);
    for (const thought of preFilter.thoughts) {
      lines.push(`- ${thought}`);
    }
    lines.push(``);
  }

  // Demo questions
  if (preFilter.demoQuestions.length > 0) {
    lines.push(`### Recommended Demo Questions`);
    for (let i = 0; i < preFilter.demoQuestions.length; i++) {
      lines.push(`${i + 1}. ${preFilter.demoQuestions[i]}`);
    }
    lines.push(``);
  }

  // Next step — tells humans exactly what to do next.
  lines.push(`---`, ``);
  lines.push(...renderPreFilterNextStep(preFilter.tentativeVerdict, submission.applicantGithub));

  return lines.join("\n");
}

/**
 * Render an actionable "Next Step" block for the pre-filter verdict.
 *
 * Each verdict leaves the issue in a state that needs a human action — this
 * block names the action, the actor, and the label transition that advances
 * the state machine. No ambiguity on "who does what next".
 */
function renderPreFilterNextStep(
  verdict: TentativeVerdict,
  applicant: string
): string[] {
  const lines: string[] = [`### 👉 Next Step`, ``];

  if (verdict === "tentative-accept") {
    lines.push(
      `**Council:** schedule a live demo with @${applicant}.`,
      ``,
      `- After a successful demo, swap \`status:tentative-accept\` to \`status:demo-passed\` — this triggers the champion pipeline automatically.`,
      `- If the demo does not convince the council, remove \`status:tentative-accept\` and add \`status:rejected\` (or \`status:needs-council-decision\` if uncertain).`
    );
  } else if (verdict === "tentative-reject") {
    lines.push(
      `**Council:** review the rejection reasoning above.`,
      ``,
      `- If you agree, leave \`status:rejected\` in place and close the issue when convenient.`,
      `- If you disagree, remove \`status:rejected\` and add \`status:needs-council-decision\` to surface it for discussion.`,
      `- No applicant action is required unless a council member re-opens the decision.`
    );
  } else {
    lines.push(
      `**Council:** a specific factual gap needs human resolution — see the assessment above.`,
      ``,
      `- Resolve the open question, then swap \`status:needs-council-decision\` to either \`status:tentative-accept\` (to schedule demo) or \`status:rejected\`.`,
      `- If the question needs input from @${applicant}, ask on this issue first.`
    );
  }

  return lines;
}

/**
 * Format a code vetting report into a markdown comment.
 */
export function formatCodeVettingComment(
  submission: SubmissionData,
  report: CodeVettingReport
): string {
  const emoji = VETTING_EMOJI[report.outcome] ?? "❓";
  const label = VETTING_LABELS[report.outcome] ?? report.outcome;

  const lines: string[] = [
    `## ${emoji} Code Vetting Report`,
    ``,
    `**Outcome: ${label}**`,
    ``,
    `> ${report.summary}`,
    ``,
    `---`,
    ``,
  ];

  // Recon details
  const recon = report.recon;
  lines.push(
    `<details>`,
    `<summary><strong>Repository Analysis</strong></summary>`,
    ``,
    `| Signal | Value |`,
    `|--------|-------|`,
    `| Language | ${recon.language} / ${recon.framework} |`,
    `| Files | ${recon.fileCount} (${recon.testFileCount} test files) |`,
    `| Commits | ${recon.commitCount} over ${recon.developmentSpanDays} days |`,
    `| Authors | ${recon.authorCount} |`,
    `| Commit Quality | ${recon.commitQuality} |`,
    `| README | ${recon.readmeQuality} |`,
    `| Lockfile | ${recon.hasLockfile ? "Yes" : "No"} |`,
    `| CI Config | ${recon.hasCIConfig ? "Yes" : "No"} |`,
    `| Tests | ${recon.hasTests ? (recon.testsLookReal ? "Yes (real)" : "Yes (shallow)") : "No"} |`,
    `| Originality | ${recon.originalityScore} |`,
    `| Buildability | ${recon.buildabilitySignals} |`,
    ``,
    `**Capabilities found:** ${recon.capabilities.join(", ")}`,
    ``,
    `</details>`,
    ``
  );

  // Conditions
  if (report.outcome === "conditions" && report.conditions.length > 0) {
    lines.push(`### Conditions (address within 30 days)`);
    for (const condition of report.conditions) {
      lines.push(`- [ ] ${condition}`);
    }
    lines.push(``);
  }

  // Misrepresentations
  if (report.outcome === "misrepresented" && report.misrepresentations.length > 0) {
    lines.push(`### Issues Found`);
    for (const issue of report.misrepresentations) {
      lines.push(`- ${issue}`);
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*Code vetting by the AI Tavern Chief of Staff agent.*`);

  return lines.join("\n");
}

/**
 * Post a comment on the submission issue.
 */
export async function postVerdictComment(
  issueNumber: number,
  comment: string
): Promise<void> {
  await $`gh issue comment ${issueNumber} --body ${comment}`.quiet();
  console.log(`Posted comment to issue #${issueNumber}`);
}

/**
 * Add a label based on the pre-filter tentative verdict.
 */
export async function labelPreFilter(
  issueNumber: number,
  verdict: TentativeVerdict
): Promise<void> {
  const label = `verdict:${verdict}`;
  const color = getVerdictColor(verdict);

  try {
    await $`gh label create ${label} --color ${color} --force`.quiet();
  } catch {
    // Label may already exist
  }

  await $`gh issue edit ${issueNumber} --add-label ${label}`.quiet();
  console.log(`Added label '${label}' to issue #${issueNumber}`);
}

/**
 * Add a label based on code vetting outcome.
 */
export async function labelCodeVetting(
  issueNumber: number,
  outcome: VettingOutcome
): Promise<void> {
  const label = `vetting:${outcome}`;
  const color = getVettingColor(outcome);

  try {
    await $`gh label create ${label} --color ${color} --force`.quiet();
  } catch {}

  await $`gh issue edit ${issueNumber} --add-label ${label}`.quiet();
  console.log(`Added label '${label}' to issue #${issueNumber}`);
}

/**
 * Render the 10-dimension quality scoring block as markdown. Shows the total,
 * a per-dimension table with reasoning, and the strongest / weakest dimensions.
 * Code-gated dimensions that couldn't be fully verified are marked.
 */
function renderQualitySection(qa: QualityAssessment): string[] {
  const lines: string[] = [
    `<details open>`,
    `<summary><strong>Quality Assessment — ${qa.totalScore} / ${qa.maxPossible}</strong></summary>`,
    ``,
  ];

  if (!qa.codeScreened) {
    lines.push(
      `*Code was not screened — dimensions marked ⚠️ are capped at 3.*`,
      ``
    );
  }

  lines.push(
    `| Dimension | Score | Reasoning |`,
    `|-----------|:-----:|-----------|`
  );

  for (const dim of QUALITY_DIMENSIONS) {
    const entry = qa.scores[dim];
    const label = DIMENSION_LABELS[dim];
    const codeGatedMark = entry.codeGated && !qa.codeScreened ? " ⚠️" : "";
    const reasoning = entry.reasoning.replace(/\|/g, "\\|");
    lines.push(`| ${label}${codeGatedMark} | **${entry.score}** / 5 | ${reasoning} |`);
  }

  lines.push(``);

  if (qa.strongest.length > 0) {
    const strongestLabels = qa.strongest.map((d) => DIMENSION_LABELS[d]).join(", ");
    lines.push(`**Strongest:** ${strongestLabels}`);
  }
  if (qa.weakest.length > 0) {
    const weakestLabels = qa.weakest.map((d) => DIMENSION_LABELS[d]).join(", ");
    lines.push(`**Weakest:** ${weakestLabels}`);
  }

  lines.push(``, `</details>`, ``);
  return lines;
}

function getVerdictColor(verdict: string): string {
  switch (verdict) {
    case "tentative-accept":
      return "0e8a16";
    case "tentative-reject":
      return "d93f0b";
    case "needs-discussion":
      return "fbca04";
    default:
      return "cccccc";
  }
}

function getVettingColor(outcome: string): string {
  switch (outcome) {
    case "clean":
      return "0e8a16";
    case "conditions":
      return "e36209";
    case "misrepresented":
      return "d93f0b";
    default:
      return "cccccc";
  }
}
