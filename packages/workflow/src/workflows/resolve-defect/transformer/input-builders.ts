import type {
  AnalysisResult,
  DefectAnalysis,
  ReproductionOracle,
  ResolutionResult,
} from '@codewright/domain';

// Stage input builders — workflow state → activity input shape.

export function buildAnalyzeStageInput(args: {
  defectDescription: string;
  repoNavigation: AnalysisResult | undefined;
  feedback: string | undefined;
}): unknown {
  return {
    defectDescription: args.defectDescription,
    repoNavigation: args.repoNavigation,
    feedback: args.feedback,
  };
}

export function buildReproduceStageInput(args: {
  analysis: DefectAnalysis;
}): unknown {
  return {
    hasTestInfra: args.analysis.hasTestInfra,
    hasWebUI: args.analysis.hasWebUI,
  };
}

export function buildImplementStageInput(args: {
  analysis: DefectAnalysis;
  oracle: ReproductionOracle | null;
  feedback: string | undefined;
  priorAttempts: number;
}): unknown {
  return {
    analysis: args.analysis,
    oracle: args.oracle,
    feedback: args.feedback,
    priorAttempts: args.priorAttempts,
  };
}

export function buildPrStageInput(args: {
  resolution: ResolutionResult;
}): unknown {
  return {
    branch: args.resolution.branch,
    baseBranch: args.resolution.baseBranch,
  };
}
