import { AuthProvider } from '@codewright/database';
import { builder } from '../../infrastructure/graphql/builder.js';

export const AuthProviderEnum = builder.enumType(AuthProvider, {
  name: 'AuthProvider',
  description: 'Git host the project is connected to.',
});
