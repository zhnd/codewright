import { builder } from '../../../infrastructure/graphql/builder.js';
import { AuthProviderEnum } from '../project.enums.js';

export const UpdateProjectInput = builder.inputType('UpdateProjectInput', {
  fields: (t) => ({
    id: t.string({ required: true }),
    name: t.string(),
    repositoryUrl: t.string(),
    authProvider: t.field({ type: AuthProviderEnum }),
    credentials: t.string({
      description: 'Personal access token for the selected git host.',
    }),
    npmrc: t.string({
      description:
        'Multi-line .npmrc content for private registries. Pass an empty string to clear. Supports ${ENV_VAR} interpolation.',
    }),
    previewCommand: t.string(),
    previewPort: t.int(),
    previewReadyPattern: t.string(),
  }),
});
