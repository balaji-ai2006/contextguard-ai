export type SeverityLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type VerificationStatus = 
  | 'VERIFIED'
  | 'VERIFIED_SECURITY'
  | 'PARTIALLY_VERIFIED'
  | 'UNVERIFIED'
  | 'FAILED';

export interface BugDNA {
  dnaId: string;
  errorType: string;
  errorMessage: string;
  file: string;
  line: number;
  functionName: string;
  occurrences: number;
  similarBugsCount: number;
  similarityScore: number;
  previousFixSummary: string;
  severity: SeverityLevel;
  verificationStatus: VerificationStatus;
}

export interface TimeTravelFrame {
  stage: 'BEFORE_FAILURE' | 'STATE_CHANGE' | 'FAILURE_POINT' | 'AFTER_FAILURE';
  functionName: string;
  state: Record<string, { type: string; value: string; redacted: boolean }>;
  isAnomalousStateChange?: boolean;
  annotation?: string;
}

export interface WhatIfSimulation {
  patchId: string;
  patchTitle: string;
  testPassRatio: string;
  securityStatus: 'PASS' | 'FAIL';
  performanceDeltaPercent: number; // e.g. +2% or -5%
  isRecommended: boolean;
  recommendationReason: string;
}

export interface TestQualityReport {
  mutationScore: number;
  mutationsTested: number;
  mutationsDetected: number;
  blindSpots: string[];
}

export interface BugPreventionRule {
  type: 'REGRESSION_TEST' | 'INPUT_VALIDATION' | 'TYPE_GUARD' | 'LINT_RULE';
  description: string;
  suggestedCode?: string;
}

export interface CodeHealthRadar {
  reliability: number;
  security: number;
  testQuality: number;
  performance: number;
  maintainability: number;
}

export interface DetectedBug {
  id: string;
  file: string;
  line: number;
  column: number;
  errorType: string;
  message: string;
  source: 'diagnostics' | 'terminal' | 'debugger' | 'manual' | 'test_framework' | 'ast_parser';
  severity: SeverityLevel;
  codeSnippet?: string;
  stackTrace?: string;
  category?: string;
  timestamp: string;
  runtimeSnapshot?: RuntimeSnapshot;
  reproductionConfirmed?: boolean;
  bugDna?: BugDNA;
  timeTravelFrames?: TimeTravelFrame[];
}

export interface VariableSnapshotItem {
  name: string;
  type: string;
  preview: string;
  truncated: boolean;
  redacted: boolean;
}

export interface RuntimeSnapshot {
  snapshotId?: string;
  timestamp?: string;
  language?: string;
  errorType?: string;
  errorMessage?: string;
  filePath?: string;
  lineNumber?: number;
  functionName?: string;
  variableSnapshots?: Record<string, VariableSnapshotItem>;
  captureMethod?: string;
  captureStatus?: 'success' | 'partial' | 'unavailable' | 'error';
  failedExpression?: string;
  heuristicExplanation?: string;
  // Backward compatibility fields
  variables?: Record<string, { type: string; value: string; redacted: boolean }>;
  callStack?: Array<{ function: string; file: string; line: number }>;
  environment?: Record<string, string>;
  dependencyVersions?: Record<string, string>;
  capturedAt?: string;
}

export interface RootCauseNode {
  id: string;
  label: string;
  description: string;
  isRootCause?: boolean;
  isFailurePoint?: boolean;
}

export interface RootCauseGraph {
  rootCause: string;
  failurePoint: string;
  propagationPath: string[];
  nodes: RootCauseNode[];
}

export interface VerificationEvidence {
  reproductionTestPassed: boolean;
  existingTestsRatio: string;
  regressionTestsRatio: string;
  staticAnalysisPassed: boolean;
  securityScanPassed: boolean;
  details: string[];
}

export interface FixExplanation {
  whatHappened: string;
  whyItHappened: string;
  whatChanged: string;
  whyItWorks: string;
  whatWeTested: string;
  possibleRisks: string;
}

export interface CandidatePatch {
  id: string;
  title: string;
  description: string;
  diff: string;
  originalSnippet: string;
  fixedSnippet: string;
  confidence: number;
  confidenceBreakdown: Record<string, number>;
  affectedFiles: string[];
  risks: string[];
  verificationStatus: VerificationStatus;
  verificationEvidence: VerificationEvidence;
  explanation: FixExplanation;
  simulation?: WhatIfSimulation;
}

export interface SimilarBugRecord {
  id: string;
  title: string;
  similarityScore: number;
  previousSolutionSnippet: string;
  resolvedAt: string;
}

export interface GitState {
  branch: string;
  isClean: boolean;
  hasConflicts: boolean;
  uncommittedFiles: string[];
  lastCommitHash: string;
}

export interface BackendStatus {
  connected: boolean;
  privacyMode: 'local' | 'hybrid' | 'cloud';
  ollamaAvailable: boolean;
  dockerAvailable: boolean;
  activeModel: string;
  version: string;
}

export interface DiagnosisConfirmedFacts {
  observedError: { type: string; message: string; severity?: string };
  failureLocation: { file: string; line: number; function?: string };
  observedVariables: Record<string, { type: string; value: string; redacted?: boolean; truncated?: boolean; isConfirmedRuntimeValue?: boolean }>;
  variableCaptureStatus?: string;
  failedExpression?: string;
  gitState?: { branch: string; isClean: boolean; uncommittedFilesCount: number };
  evidenceSources: string[];
  isFactuallyConfirmed: boolean;
}

export interface DiagnosisHypotheses {
  rootCause: string;
  failureMechanism: string;
  propagationPath: string[];
  hypothesisSummary: string;
  confidenceScore: number;
  isVerifiedFact: boolean;
  inferenceEngine: string;
}

export interface DiagnosisResult {
  rootCause: string;
  failurePoint: string;
  propagationPath: string[];
  hypothesis: string;
  confirmedFacts: DiagnosisConfirmedFacts;
  hypotheses: DiagnosisHypotheses;
  evidenceSources: string[];
  privacyStatus: {
    privacyMode: string;
    secretsRedactedCount: number;
    externalTransmissionAuthorized: boolean;
    zeroLeakageVerified: boolean;
  };
  engine: string;
  llmAvailable: boolean;
}

