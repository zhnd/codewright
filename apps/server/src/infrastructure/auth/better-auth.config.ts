import { prisma } from '@codewright/database';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';

// Defense-in-depth: validateEnv() in server.ts is the primary gate for
// production env vars, but auth config gets evaluated by other entry
// points too (schema export script). Re-assert here so missing values
// can never silently fall through to localhost / dev-secret in prod.
const isProduction = process.env.NODE_ENV === 'production';
const DEV_AUTH_SECRET = 'dev-secret-key-change-in-production';

if (isProduction) {
  const missing: string[] = [];
  if (!process.env.BETTER_AUTH_URL) missing.push('BETTER_AUTH_URL');
  if (!process.env.BETTER_AUTH_SECRET) missing.push('BETTER_AUTH_SECRET');
  if (process.env.BETTER_AUTH_SECRET === DEV_AUTH_SECRET) {
    missing.push('BETTER_AUTH_SECRET (must be a unique production value)');
  }
  if (!process.env.WEB_URL) missing.push('WEB_URL');
  if (missing.length > 0) {
    throw new Error(
      `better-auth: required env vars missing in production: ${missing.join(', ')}`
    );
  }
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),

  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:4000',
  secret: process.env.BETTER_AUTH_SECRET || DEV_AUTH_SECRET,

  trustedOrigins: [process.env.WEB_URL || 'http://localhost:3000'],

  appName: '@codewright/server',

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Set to true in production
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirectURI: `${process.env.BETTER_AUTH_URL || 'http://localhost:4000'}/api/auth/callback/google`,
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },

  advanced: {
    cookies: {
      sessionToken: {
        attributes: {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
        },
      },
    },
  },

  plugins: [],
});

export default auth;
