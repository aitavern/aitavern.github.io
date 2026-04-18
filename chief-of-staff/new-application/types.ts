// Shared types for the AI Tavern vetting pipeline

export type ReviewMode = "text-only" | "screen-public" | "screen-private";

/**
 * Max length for a free-form category label proposed by the prefilter agent.
 * Used for both output validation and label-name sanity.
 */
export const MAX_CATEGORY_LENGTH = 40;

/** Neutral hex color used for all `category:*` labels on GitHub issues. */
export const CATEGORY_LABEL_COLOR = "c5def5";

export interface SubmissionData {
  issueNumber: number;
  issueUrl: string;
  repoUrl: string;
  repoOwner: string;
  repoName: string;
  applicantGithub: string;
  /** Human-readable name from the Display Name form field. Falls back to applicantGithub when missing. */
  displayName: string;
  systemDescription: string;
  justification: string;
  reviewMode: ReviewMode;
  rawBody: string;
  /** ISO date string of when the issue was first parsed — snapshot for idempotency */
  parsedAt: string;
}

export interface ReconReport {
  repo: string;
  language: string;
  framework: string;
  fileCount: number;
  testFileCount: number;
  commitCount: number;
  developmentSpanDays: number;
  authorCount: number;
  commitQuality: "high" | "medium" | "low";
  readmeQuality: "strong" | "adequate" | "weak" | "missing";
  hasLockfile: boolean;
  hasCIConfig: boolean;
  hasDockerfile: boolean;
  hasTests: boolean;
  testsLookReal: boolean;
  originalityScore: "high" | "medium" | "low";
  buildabilitySignals: "strong" | "moderate" | "weak";
  description: string;
  capabilities: string[];
  concerns: string[];
  summary: string;
}

export interface MemberLeverageDetail {
  member: string;
  contribution?: string;
  benefit: string;
  passes: boolean;
}

export interface LeverageMapMember {
  github: string;
  name: string;
  contribution: {
    repo: string;
    /** Free-form category from prefilter; "uncategorized" only as a defensive fallback when the label is missing. */
    category: string;
    description: string;
    capabilities: string[];
    stack: string[];
  };
  joined: string;
}

export interface LeverageMap {
  version: number;
  lastUpdated: string;
  members: LeverageMapMember[];
}

export type Verdict = "accept" | "accept-partial-overlap" | "merge-or-reject" | "reject";
export type TentativeVerdict = "tentative-accept" | "tentative-reject" | "needs-discussion";

export interface VerdictReport {
  verdict: Verdict;
  confidence: "high" | "medium" | "low";
  evidence: {
    quality: {
      score: string;
      signals: string[];
    };
    originality: {
      score: string;
      signals: string[];
    };
    leverage: {
      score: string;
      signals: string[];
    };
  };
  tenXDetails: MemberLeverageDetail[];
  overlapLevel: "none" | "partial" | "full";
  overlapWith: string | null;
  combinationOpportunities: string[];
  recommendedDemoQuestions: string[];
  summary: string;
}

/**
 * The ten quality dimensions the prefilter agent scores.
 *
 * Each is scored 0–5 with a reasoning string. Code-gated dimensions are capped
 * at 3 when no code was screened — the agent can only fully verify them by
 * reading the repo.
 */
export type QualityDimension =
  | "acutenessOfNeed"
  | "uniqueness"
  | "switchingCost"
  | "durability"
  | "dogfooding"
  | "builderDepth"
  | "failureModeAwareness"
  | "coherence"
  | "scopeDiscipline"
  | "roomImpact";

export const QUALITY_DIMENSIONS: readonly QualityDimension[] = [
  "acutenessOfNeed",
  "uniqueness",
  "switchingCost",
  "durability",
  "dogfooding",
  "builderDepth",
  "failureModeAwareness",
  "coherence",
  "scopeDiscipline",
  "roomImpact",
] as const;

/** Dimensions whose score is capped at 3 when no code was screened. */
export const CODE_GATED_DIMENSIONS: readonly QualityDimension[] = [
  "uniqueness",
  "dogfooding",
  "coherence",
  "scopeDiscipline",
] as const;

export interface QualityScore {
  /** 0–5, conservative. Capped at 3 for code-gated dimensions without screening. */
  score: number;
  /** Agent's reasoning for the score — required for auditability. */
  reasoning: string;
  /** True iff this dimension is code-gated. Informational only; the cap is enforced by the validator. */
  codeGated?: boolean;
}

export interface QualityAssessment {
  /** Whether code was screened — determines whether code-gated caps apply. */
  codeScreened: boolean;
  scores: Record<QualityDimension, QualityScore>;
  /** Sum of individual scores, 0–50. Not a threshold — informational. */
  totalScore: number;
  maxPossible: number;
  /** Dimensions scoring 4 or 5, ordered strongest first. */
  strongest: QualityDimension[];
  /** Dimensions scoring 0, 1, or 2, ordered weakest first — surfaces soft-weak signals (score=2) so they don't get lost mid-table. */
  weakest: QualityDimension[];
}

/** Pre-filter output — text-only (or text+code) assessment before demo */
export interface PreFilterReport {
  tentativeVerdict: TentativeVerdict;
  confidence: "high" | "medium" | "low";
  /** Free-form category label the agent proposes — drives leverage-map saturation/overlap detection. */
  category: string;
  /** Whether code was screened (soft advantage signal) */
  codeScreened: boolean;
  /** 10-dimension quality scoring — the agent's structured judgment. */
  qualityAssessment: QualityAssessment;
  /**
   * Strongest 3-sentence case FOR rejection. The agent must write this before
   * committing to a verdict, even when recommending accept. Forces engagement
   * with the weakest parts of the application.
   */
  steelmanReject: string;
  /**
   * Final gut check — would this applicant be in the top 5% of applications
   * the agent has ever evaluated? If false, the verdict should not be accept.
   */
  topFivePercent: boolean;
  /** Raw descriptive claims — informational for the council, not a gate. */
  claimsAssessment: {
    falsifiableClaims: string[];
    unverifiableClaims: string[];
    concerns: string[];
  };
  leverageAssessment: {
    tenXDetails: MemberLeverageDetail[];
    overlapLevel: "none" | "partial" | "full";
    overlapWith: string | null;
    combinationOpportunities: string[];
  };
  thoughts: string[];
  demoQuestions: string[];
  summary: string;
}

/** Code vetting outcome — post-demo deep review */
export type VettingOutcome = "clean" | "conditions" | "misrepresented";

export interface CodeVettingReport {
  outcome: VettingOutcome;
  recon: ReconReport;
  /** If outcome is "conditions", what needs fixing */
  conditions: string[];
  /** If outcome is "misrepresented", what doesn't match */
  misrepresentations: string[];
  summary: string;
}

export interface PipelineResult {
  submission: SubmissionData;
  recon: ReconReport | null;
  verdict: VerdictReport | null;
  preFilter: PreFilterReport | null;
  codeVetting: CodeVettingReport | null;
  error?: string;
}
