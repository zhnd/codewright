import { builder } from '../../infrastructure/graphql/builder.js';
import { AuthProviderEnum } from './project.enums.js';

builder.prismaObject('Project', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    repositoryUrl: t.exposeString('repositoryUrl'),
    authMethod: t.exposeString('authMethod'),
    authProvider: t.field({
      type: AuthProviderEnum,
      resolve: (project) => project.authProvider,
    }),
    hasCredentials: t.boolean({
      resolve: (project) => !!project.encryptedCredentials,
    }),
    hasNpmrc: t.boolean({
      resolve: (project) => {
        const cfg = project.workflowConfig as {
          secrets?: { npmrc?: string };
        } | null;
        return !!cfg?.secrets?.npmrc;
      },
    }),
    previewCommand: t.exposeString('previewCommand', { nullable: true }),
    previewPort: t.exposeInt('previewPort', { nullable: true }),
    previewReadyPattern: t.exposeString('previewReadyPattern', {
      nullable: true,
    }),
    tasks: t.relation('tasks'),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
  }),
});
