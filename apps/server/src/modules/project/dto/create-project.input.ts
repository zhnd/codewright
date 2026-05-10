import { builder } from '../../../infrastructure/graphql/builder.js';
import { AuthProviderEnum } from '../project.enums.js';

export const CreateProjectInput = builder.inputType('CreateProjectInput', {
  fields: (t) => ({
    name: t.string({ required: true }),
    repositoryUrl: t.string({ required: true }),
    authProvider: t.field({
      type: AuthProviderEnum,
      description:
        'Git host the repository lives on. Defaults to GITHUB. Must match the host in repositoryUrl.',
    }),
    credentials: t.string({
      description: 'Personal access token for the selected git host.',
    }),
    npmrc: t.string({
      description:
        'Multi-line .npmrc content for private registries. Supports ${ENV_VAR} interpolation; use ${TORIN_GIT_TOKEN} to reference the project git token without writing it to disk.',
    }),
    previewCommand: t.string({
      description:
        'Command to start the dev server (e.g. "pnpm dev"). When set, defect-resolution fixes boot-verify + expose a preview URL to the reviewer.',
    }),
    previewPort: t.int({
      description: 'Port the dev server listens on (e.g. 3000).',
    }),
    previewReadyPattern: t.string({
      description:
        'Substring that, when seen in dev-server logs, indicates readiness. Optional — defaults are inferred by framework.',
    }),
  }),
});
