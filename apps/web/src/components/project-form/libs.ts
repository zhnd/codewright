import { z } from 'zod';

export const AUTH_PROVIDERS = ['GITHUB', 'CNB'] as const;
export type AuthProviderValue = (typeof AUTH_PROVIDERS)[number];

export const AUTH_PROVIDER_LABELS: Record<AuthProviderValue, string> = {
  GITHUB: 'GitHub',
  CNB: 'cnb.cool',
};

export const AUTH_PROVIDER_URL_PLACEHOLDERS: Record<AuthProviderValue, string> =
  {
    GITHUB: 'https://github.com/acme/billing-service',
    CNB: 'https://cnb.cool/acme/billing-service',
  };

export const AUTH_PROVIDER_TOKEN_PLACEHOLDERS: Record<
  AuthProviderValue,
  string
> = {
  GITHUB: 'ghp_xxxxxxxxxxxx',
  CNB: 'cnb_xxxxxxxxxxxx',
};

export const projectSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  repositoryUrl: z.string().url('Must be a valid URL'),
  authProvider: z.enum(AUTH_PROVIDERS),
  credentials: z.string().optional(),
  npmrc: z.string().optional(),
  previewCommand: z.string().optional(),
  previewPort: z.string().optional(),
  previewReadyPattern: z.string().optional(),
});

export type ProjectFormValues = z.infer<typeof projectSchema>;
