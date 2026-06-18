import type { AnalyzeRepositoryInput } from '@codewright/domain';

// Data-shape transformers for the analyze-repository workflow. Pure
// functions, no Temporal SDK imports.

export function buildAnalyzeStageInput(args: {
  input: AnalyzeRepositoryInput;
}): unknown {
  return {
    repositoryUrl: args.input.repositoryUrl,
  };
}
