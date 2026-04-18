// Evaluation rubric — version-controlled schema for pre-filter and code vetting assessment
//
// This is the source of truth for what the AI agents evaluate against.
// Changes here should be deliberate and reviewed.

import type { TentativeVerdict, VettingOutcome, QualityDimension } from "./types";
import {
  MAX_CATEGORY_LENGTH,
  QUALITY_DIMENSIONS,
  CODE_GATED_DIMENSIONS,
} from "./types";

/**
 * A calibration anchor for one quality dimension.
 *
 * The agent reads the anchors to avoid the LLM default of clustering every
 * score around "3 = adequate". Each dimension names what a weak (1), solid
 * (3), and exceptional (5) signal looks like, in concrete operator language.
 */
export interface QualityAnchor {
  dimension: QualityDimension;
  /** One-line description of what the dimension measures. */
  summary: string;
  /** 0–1: missing or opposite signal. */
  weakSignal: string;
  /** 3: solid, specific evidence. */
  solidSignal: string;
  /** 5: top-decile exemplar, reputation-staking level. */
  exceptionalSignal: string;
}

/** Pre-filter rubric: what the quality-scoring agent evaluates */
export interface PreFilterRubric {
  /** The ten scored quality dimensions with calibration anchors. */
  anchors: Record<QualityDimension, QualityAnchor>;
  /** Dimensions capped at 3 when code was not screened. */
  codeGatedDimensions: readonly QualityDimension[];
}

/** Code vetting rubric: what the post-demo agent evaluates */
export interface CodeVettingRubric {
  /** Minimum signals for "clean" outcome */
  cleanThresholds: {
    minCommits: number;
    minDevelopmentSpanDays: number;
    minOriginalityScore: string;
    requiresTests: boolean;
    requiresLockfile: boolean;
  };
  /** What constitutes "conditions" */
  conditionTriggers: string[];
  /** What constitutes "misrepresented" */
  misrepresentationTriggers: string[];
}

/**
 * The active pre-filter rubric — ten quality dimensions with calibration
 * anchors. The prompt template renders these into the agent's instructions so
 * scoring stays calibrated against concrete operator-level examples rather
 * than vague adjectives.
 */
export const PRE_FILTER_RUBRIC: PreFilterRubric = {
  codeGatedDimensions: CODE_GATED_DIMENSIONS,
  anchors: {
    acutenessOfNeed: {
      dimension: "acutenessOfNeed",
      summary:
        "Is there acute pain this removes, or is it nice-to-have? What specifically breaks without it?",
      weakSignal:
        "Nice-to-have language, no specific pain moment, no counterfactual.",
      solidSignal:
        "Names a recurring friction but no specific instance; implied counterfactual.",
      exceptionalSignal:
        "Names a specific moment of pain (e.g. 'last Tuesday I spent 4h on X') plus a concrete thing that breaks without this.",
    },
    uniqueness: {
      dimension: "uniqueness",
      summary:
        "Could an existing member rebuild this in a weekend? Is there something better already available?",
      weakSignal:
        "Weekend's work for any competent member; many comparable tools already exist.",
      solidSignal:
        "Would take a month to rebuild; comparable alternatives exist but this has a clear edge.",
      exceptionalSignal:
        "Requires deep domain expertise or 100+ hours of accumulated work. No comparable alternative can be pointed to.",
    },
    switchingCost: {
      dimension: "switchingCost",
      summary:
        "How much friction to adopt vs. how much payoff? Would a plausible builder actually change workflow to use this?",
      weakSignal:
        "High friction, thin payoff; unclear why anyone would switch from what they already use.",
      solidSignal:
        "Reasonable setup, clear payoff; a competent user could be productive within a day or two once the workflow clicks.",
      exceptionalSignal:
        "Frictionless onboarding with payoff visible in the first session; the kind of thing a user won't go back from.",
    },
    durability: {
      dimension: "durability",
      summary:
        "Does this compound over time, or does the next foundation model flatten it?",
      weakSignal:
        "'AI-powered X' where the moat is just a prompt; trivially flattened by the next model.",
      solidSignal:
        "Thin but real moat — workflow lock-in, some proprietary logic, model-adjacent but not trivial.",
      exceptionalSignal:
        "Compounds — proprietary data, domain expertise encoded, hard integrations, or network effects.",
    },
    dogfooding: {
      dimension: "dogfooding",
      summary:
        "Does the author use this for real high-stakes work, not just demos?",
      weakSignal:
        "No evidence the author uses this; it reads demo-only.",
      solidSignal:
        "Some usage signals but low-stakes or intermittent.",
      exceptionalSignal:
        "Commit history and writing show the author shipping their own business on this — if it breaks they are screwed.",
    },
    builderDepth: {
      dimension: "builderDepth",
      summary:
        "Does the applicant show scar tissue — non-obvious decisions and strong narrow views that only come from doing the work?",
      weakSignal:
        "All best practices, obvious path, opinions are recycled from popular blogs.",
      solidSignal:
        "Some earned insight; one or two non-obvious choices.",
      exceptionalSignal:
        "Multiple disagreements with mainstream positions, each with specific reasoning. Clear scar tissue visible.",
    },
    failureModeAwareness: {
      dimension: "failureModeAwareness",
      summary:
        "Does the applicant know what their tool can't do and what trade-offs they chose?",
      weakSignal:
        "Everything is described as working perfectly; no limits acknowledged.",
      solidSignal:
        "Names a general trade-off but can't name specific failure cases.",
      exceptionalSignal:
        "'This doesn't work for X because Y, chose Z trade-off' — multiple failure modes explicitly mapped.",
    },
    coherence: {
      dimension: "coherence",
      summary:
        "Do the description, the repo, and the 10x justification tell the same story?",
      weakSignal:
        "Description and repo tell different stories; claims capabilities the code doesn't have.",
      solidSignal:
        "Mostly aligned with some drift or embellishment.",
      exceptionalSignal:
        "Description, repo, and justification all tell the same story. Nothing is inflated.",
    },
    scopeDiscipline: {
      dimension: "scopeDiscipline",
      summary:
        "Did the applicant deliberately choose NOT to build things, and can they defend those choices?",
      weakSignal:
        "Kitchen sink; no articulable out-of-scope list.",
      solidSignal:
        "Some focus, but feature creep is visible.",
      exceptionalSignal:
        "Explicit non-goals; defends what was cut with specific trade-off reasoning.",
    },
    roomImpact: {
      dimension: "roomImpact",
      summary:
        "Is this catalytic — does it amplify what other builders do — or does it sit standalone adding to the pile?",
      weakSignal:
        "Standalone utility that doesn't touch other work. A nice tool, but nobody else's output depends on it.",
      solidSignal:
        "Amplifies one or two specific activities builders regularly do; other work becomes cheaper or faster because this exists.",
      exceptionalSignal:
        "Catalyzes chains — once this exists, multiple builders' work becomes materially different. Cross-domain leverage, not just vertical depth.",
    },
  },
};

/**
 * Code-vetting thresholds — raised to operator-grade levels.
 *
 * These are used after the council has accepted the applicant and we do a
 * final static review of the repo at the demoed SHA. A "clean" outcome
 * requires operator-grade signals, not weekend-project signals.
 */
export const CODE_VETTING_RUBRIC: CodeVettingRubric = {
  cleanThresholds: {
    minCommits: 80,
    minDevelopmentSpanDays: 60,
    minOriginalityScore: "high",
    requiresTests: true,
    requiresLockfile: true,
  },
  conditionTriggers: [
    "No README or README is auto-generated",
    "Hardcoded secrets or credentials detected",
    "No lockfile present",
    "Tests absent or shallow (happy-path only)",
    "Code quality significantly below what was described or demoed",
    "Missing key features that were claimed in the application or demo",
    "Architecture is accumulated features rather than coherent design",
  ],
  misrepresentationTriggers: [
    "Repo is a fork/clone of a tutorial or template with minimal changes",
    "Commit history shows single bulk import, not iterative development",
    "Claimed capabilities don't exist in the codebase",
    "Code appears to be entirely AI-generated boilerplate with no customization",
    "No evidence the author uses this themselves — all commits are demo-polish",
    "Scope described ≠ scope built (e.g. claimed agent system is actually a CRUD wrapper)",
  ],
};

/**
 * Build prompt-template variables from the pre-filter rubric. The rendered
 * template shows each of the 10 dimensions with its calibration anchors so
 * the agent scores against concrete signals rather than vague adjectives.
 */
export function preFilterRubricVars(
  rubric: PreFilterRubric = PRE_FILTER_RUBRIC
): Record<string, string> {
  return {
    QUALITY_DIMENSIONS: renderAnchorsBlock(rubric),
    CODE_GATED_DIMENSIONS: rubric.codeGatedDimensions.join(", "),
  };
}

function renderAnchorsBlock(rubric: PreFilterRubric): string {
  const gated = new Set(rubric.codeGatedDimensions);
  const lines: string[] = [];
  for (const dim of QUALITY_DIMENSIONS) {
    const a = rubric.anchors[dim];
    const gatedNote = gated.has(dim) ? " **[code-gated — cap at 3 if no code screened]**" : "";
    lines.push(`### ${dim}${gatedNote}`);
    lines.push("");
    lines.push(a.summary);
    lines.push("");
    lines.push(`- **0–1 (weak):** ${a.weakSignal}`);
    lines.push(`- **3 (solid):** ${a.solidSignal}`);
    lines.push(`- **5 (exceptional):** ${a.exceptionalSignal}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function codeVettingRubricVars(
  rubric: CodeVettingRubric = CODE_VETTING_RUBRIC
): Record<string, string> {
  const bulletList = (items: string[]) =>
    items.map((i) => `- ${i}`).join("\n");
  return {
    MIN_COMMITS: String(rubric.cleanThresholds.minCommits),
    MIN_DEV_SPAN_DAYS: String(rubric.cleanThresholds.minDevelopmentSpanDays),
    MIN_ORIGINALITY_SCORE: rubric.cleanThresholds.minOriginalityScore,
    LOCKFILE_REQUIRED: rubric.cleanThresholds.requiresLockfile ? "yes" : "no",
    TESTS_REQUIRED: rubric.cleanThresholds.requiresTests ? "yes" : "no",
    CONDITION_TRIGGERS: bulletList(rubric.conditionTriggers),
    MISREPRESENTATION_TRIGGERS: bulletList(rubric.misrepresentationTriggers),
  };
}

/** Schema validation for pre-filter agent output */
export function validatePreFilterOutput(output: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!output || typeof output !== "object") {
    return { valid: false, errors: ["Output is not an object"] };
  }

  const o = output as Record<string, unknown>;

  const validVerdicts: TentativeVerdict[] = ["tentative-accept", "tentative-reject", "needs-discussion"];
  if (!validVerdicts.includes(o.tentativeVerdict as TentativeVerdict)) {
    errors.push(`Invalid tentativeVerdict: ${o.tentativeVerdict}. Must be one of: ${validVerdicts.join(", ")}`);
  }

  const validConfidences = ["high", "medium", "low"];
  if (!validConfidences.includes(o.confidence as string)) {
    errors.push(`Invalid confidence: ${o.confidence}. Must be one of: ${validConfidences.join(", ")}`);
  }

  if (typeof o.category !== "string" || o.category.trim().length === 0) {
    errors.push("category must be a non-empty string");
  } else if (o.category.length > MAX_CATEGORY_LENGTH) {
    errors.push(`category exceeds maximum length (${MAX_CATEGORY_LENGTH} chars)`);
  } else if (!/^[a-z0-9][a-z0-9-]*$/.test(o.category)) {
    errors.push("category must be lowercase kebab-case (a–z, 0–9, hyphens)");
  }

  // --- qualityAssessment: the core scored judgment ---
  validateQualityAssessment(o, errors);

  if (typeof o.steelmanReject !== "string" || o.steelmanReject.trim().length === 0) {
    errors.push("steelmanReject must be a non-empty string");
  } else if (o.steelmanReject.length > 1000) {
    errors.push("steelmanReject exceeds maximum length (1000 chars)");
  }

  if (typeof o.topFivePercent !== "boolean") {
    errors.push("topFivePercent must be a boolean");
  }

  // --- Existing descriptive/claims fields ---
  if (!o.claimsAssessment || typeof o.claimsAssessment !== "object") {
    errors.push("Missing claimsAssessment object");
  }

  if (!o.leverageAssessment || typeof o.leverageAssessment !== "object") {
    errors.push("Missing leverageAssessment object");
  }

  if (!Array.isArray(o.thoughts)) {
    errors.push("thoughts must be an array");
  }

  if (!Array.isArray(o.demoQuestions)) {
    errors.push("demoQuestions must be an array");
  }

  if (typeof o.summary !== "string" || o.summary.length === 0) {
    errors.push("summary must be a non-empty string");
  }

  // Length bounds — prevent data exfiltration via oversized string fields
  if (typeof o.summary === "string" && o.summary.length > 1000) {
    errors.push("summary exceeds maximum length (1000 chars)");
  }

  if (Array.isArray(o.thoughts)) {
    for (const t of o.thoughts) {
      if (typeof t !== "string" || t.length > 500) {
        errors.push("thoughts entries must be strings under 500 chars each");
        break;
      }
    }
  }

  if (Array.isArray(o.demoQuestions)) {
    for (const q of o.demoQuestions) {
      if (typeof q !== "string" || q.length > 500) {
        errors.push("demoQuestions entries must be strings under 500 chars each");
        break;
      }
    }
  }

  // Bound all claimsAssessment and leverageAssessment string arrays (posted publicly)
  const claims = o.claimsAssessment as Record<string, unknown> | undefined;
  if (claims && typeof claims === "object") {
    for (const field of ["falsifiableClaims", "unverifiableClaims", "concerns"] as const) {
      if (Array.isArray(claims[field])) {
        for (const item of claims[field] as unknown[]) {
          if (typeof item !== "string" || item.length > 500) {
            errors.push(`claimsAssessment.${field} entries must be strings under 500 chars`);
            break;
          }
        }
      }
    }
  }

  const leverage = o.leverageAssessment as Record<string, unknown> | undefined;
  if (leverage && typeof leverage === "object") {
    if (Array.isArray(leverage.combinationOpportunities)) {
      for (const item of leverage.combinationOpportunities as unknown[]) {
        if (typeof item !== "string" || item.length > 500) {
          errors.push("combinationOpportunities entries must be strings under 500 chars");
          break;
        }
      }
    }
    if (Array.isArray(leverage.tenXDetails)) {
      for (const detail of leverage.tenXDetails as Record<string, unknown>[]) {
        if (detail && typeof detail.benefit === "string" && detail.benefit.length > 500) {
          errors.push("tenXDetails benefit must be under 500 chars");
          break;
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate the 10-dimension quality assessment block.
 *
 * Enforces structural correctness (all dimensions present, each scored 0-5
 * with a reasoning string) and the code-gating rule (code-gated dimensions
 * are capped at 3 when codeScreened is false). Appends errors into the
 * caller's list rather than returning — keeps the top-level validator flat.
 */
function validateQualityAssessment(
  o: Record<string, unknown>,
  errors: string[]
): void {
  const qa = o.qualityAssessment as Record<string, unknown> | undefined;
  if (!qa || typeof qa !== "object") {
    errors.push("Missing qualityAssessment object");
    return;
  }

  if (typeof qa.codeScreened !== "boolean") {
    errors.push("qualityAssessment.codeScreened must be a boolean");
  }

  const scores = qa.scores as Record<string, unknown> | undefined;
  if (!scores || typeof scores !== "object") {
    errors.push("qualityAssessment.scores must be an object");
    return;
  }

  const gated = new Set<string>(CODE_GATED_DIMENSIONS);
  let total = 0;
  let anyScoreInvalid = false;

  for (const dim of QUALITY_DIMENSIONS) {
    const entry = scores[dim] as Record<string, unknown> | undefined;
    if (!entry || typeof entry !== "object") {
      errors.push(`qualityAssessment.scores.${dim} is missing or not an object`);
      anyScoreInvalid = true;
      continue;
    }

    const score = entry.score;
    if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 5) {
      errors.push(`qualityAssessment.scores.${dim}.score must be an integer 0–5`);
      anyScoreInvalid = true;
      continue;
    }

    // Enforce code-gated cap when no code was screened.
    if (gated.has(dim) && qa.codeScreened === false && score > 3) {
      errors.push(
        `qualityAssessment.scores.${dim}.score is ${score} but dimension is code-gated and no code was screened (cap is 3)`
      );
    }

    if (typeof entry.reasoning !== "string" || entry.reasoning.trim().length === 0) {
      errors.push(`qualityAssessment.scores.${dim}.reasoning must be a non-empty string`);
    } else if (entry.reasoning.length > 500) {
      errors.push(`qualityAssessment.scores.${dim}.reasoning must be under 500 chars`);
    }

    total += score;
  }

  // Only check totalScore if every per-dim score was valid; otherwise the sum
  // is meaningless and the per-dim errors already explain the problem.
  if (!anyScoreInvalid) {
    if (typeof qa.totalScore !== "number" || qa.totalScore !== total) {
      errors.push(
        `qualityAssessment.totalScore must equal the sum of dimension scores (expected ${total}, got ${qa.totalScore})`
      );
    }
    if (qa.maxPossible !== 50) {
      errors.push("qualityAssessment.maxPossible must be 50");
    }
  }

  for (const field of ["strongest", "weakest"] as const) {
    const arr = qa[field];
    if (!Array.isArray(arr)) {
      errors.push(`qualityAssessment.${field} must be an array`);
      continue;
    }
    for (const dim of arr) {
      if (typeof dim !== "string" || !QUALITY_DIMENSIONS.includes(dim as QualityDimension)) {
        errors.push(
          `qualityAssessment.${field} entries must be valid dimension names (got "${dim}")`
        );
        break;
      }
    }
  }
}

/**
 * Sanitize a recon report before embedding into another agent's prompt.
 *
 * Recon output is agent-generated from untrusted code, so its string fields
 * must not be allowed to grow unbounded (context bloat / prompt-injection
 * vehicle). Truncates long strings and caps array lengths in place.
 */
export function sanitizeReconReport(recon: unknown): unknown {
  if (!recon || typeof recon !== "object") return recon;
  const r = recon as Record<string, unknown>;

  const truncateString = (v: unknown, max: number): unknown =>
    typeof v === "string" && v.length > max ? v.slice(0, max) + "…[truncated]" : v;

  const truncateStringArray = (
    v: unknown,
    maxItems: number,
    maxLen: number
  ): unknown =>
    Array.isArray(v)
      ? v.slice(0, maxItems).map((item) => truncateString(item, maxLen))
      : v;

  r.description = truncateString(r.description, 1000);
  r.summary = truncateString(r.summary, 1000);
  r.language = truncateString(r.language, 50);
  r.framework = truncateString(r.framework, 50);
  r.repo = truncateString(r.repo, 200);
  r.capabilities = truncateStringArray(r.capabilities, 20, 200);
  r.concerns = truncateStringArray(r.concerns, 20, 500);

  return r;
}

/** Schema validation for code vetting agent output */
export function validateCodeVettingOutput(output: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!output || typeof output !== "object") {
    return { valid: false, errors: ["Output is not an object"] };
  }

  const o = output as Record<string, unknown>;

  const validOutcomes: VettingOutcome[] = ["clean", "conditions", "misrepresented"];
  if (!validOutcomes.includes(o.outcome as VettingOutcome)) {
    errors.push(`Invalid outcome: ${o.outcome}. Must be one of: ${validOutcomes.join(", ")}`);
  }

  if (!o.recon || typeof o.recon !== "object") {
    errors.push("Missing recon object");
  }

  if (!Array.isArray(o.conditions)) {
    errors.push("conditions must be an array");
  }

  if (!Array.isArray(o.misrepresentations)) {
    errors.push("misrepresentations must be an array");
  }

  if (typeof o.summary !== "string" || o.summary.length === 0) {
    errors.push("summary must be a non-empty string");
  }

  // Length bounds for code vetting output (posted publicly)
  if (typeof o.summary === "string" && o.summary.length > 1000) {
    errors.push("summary exceeds maximum length (1000 chars)");
  }

  if (Array.isArray(o.conditions)) {
    for (const c of o.conditions as unknown[]) {
      if (typeof c !== "string" || c.length > 500) {
        errors.push("conditions entries must be strings under 500 chars");
        break;
      }
    }
  }

  if (Array.isArray(o.misrepresentations)) {
    for (const m of o.misrepresentations as unknown[]) {
      if (typeof m !== "string" || m.length > 500) {
        errors.push("misrepresentations entries must be strings under 500 chars");
        break;
      }
    }
  }

  const recon = o.recon as Record<string, unknown> | undefined;
  if (recon && typeof recon === "object") {
    if (typeof recon.summary === "string" && recon.summary.length > 1000) {
      errors.push("recon.summary exceeds maximum length (1000 chars)");
    }
    if (typeof recon.description === "string" && recon.description.length > 1000) {
      errors.push("recon.description exceeds maximum length (1000 chars)");
    }
    if (Array.isArray(recon.capabilities)) {
      for (const cap of recon.capabilities as unknown[]) {
        if (typeof cap !== "string" || cap.length > 200) {
          errors.push("recon.capabilities entries must be strings under 200 chars");
          break;
        }
      }
    }
    if (Array.isArray(recon.concerns)) {
      for (const c of recon.concerns as unknown[]) {
        if (typeof c !== "string" || c.length > 500) {
          errors.push("recon.concerns entries must be strings under 500 chars");
          break;
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
