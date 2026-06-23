import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
} from '@apollo/client';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { ErrorLink } from '@apollo/client/link/error';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import { createClient } from 'graphql-ws';
import { toast } from 'sonner';
import { GRAPHQL_ENDPOINT, GRAPHQL_WS_ENDPOINT } from './constants';

/**
 * Suppress the same error toast within this window. Apollo can fire one
 * onError per affected query; without dedup a single network outage
 * paints the screen with duplicates.
 */
const ERROR_TOAST_WINDOW_MS = 60_000;
const recentErrors = new Map<string, number>();

function showErrorToast(message: string): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  const last = recentErrors.get(message);
  if (last !== undefined && now - last < ERROR_TOAST_WINDOW_MS) return;
  recentErrors.set(message, now);
  toast.error(message);
}

export function makeClient() {
  // Apollo v4: ErrorLink callback receives a single `error` (typed as
  // `unknown`) plus `operation`. Use `CombinedGraphQLErrors.is(error)`
  // to discriminate the GraphQL-error case; everything else is treated
  // as a transport / unexpected error.
  const errorLink = new ErrorLink(({ error, operation }) => {
    if (CombinedGraphQLErrors.is(error)) {
      for (const err of error.errors) {
        const code = (err.extensions?.code ?? '') as string;
        // The web layer already redirects to /login on 401 via auth-client;
        // surfacing a toast there would be noisy and redundant.
        if (code === 'UNAUTHORIZED') continue;
        showErrorToast(err.message || 'Request failed');
      }
      return;
    }

    const message =
      error instanceof Error
        ? error.message
        : 'Network error — check your connection';
    showErrorToast(message);
    // Always log network failures with operation context — silent
    // failures are how broken pages become invisible bugs.
    console.warn(`Apollo network error on ${operation.operationName}:`, error);
  });

  const httpLink = new HttpLink({
    uri: GRAPHQL_ENDPOINT,
    credentials: 'include',
  });

  // Browser-only ws link. SSR falls back to http-only — subscriptions
  // aren't meaningful server-side anyway.
  const transport =
    typeof window === 'undefined'
      ? httpLink
      : ApolloLink.split(
          ({ query }) => {
            const def = getMainDefinition(query);
            return (
              def.kind === 'OperationDefinition' &&
              def.operation === 'subscription'
            );
          },
          new GraphQLWsLink(
            createClient({
              url: GRAPHQL_WS_ENDPOINT,
              // No `connectionParams` by design: the browser already
              // sends HttpOnly session cookies with the upgrade HTTP
              // request, and `document.cookie` never contains them.
              // Setting it here would only clobber the real cookie the
              // server reads from the upgrade request headers.
              retryAttempts: 10,
              shouldRetry: () => true,
            })
          ),
          httpLink
        );

  return new ApolloClient({
    cache: new InMemoryCache({
      typePolicies: {
        AgentMessageLog: { keyFields: ['id'] },
        Query: {
          fields: {
            // Append-only agent message log: bucket by taskId, merge incoming
            // pages/stream batches by cursor (dedupe + keep ascending).
            // A flat single-level list with stable ids sidesteps the
            // nested-normalization staleness that forces the task-detail
            // refetch pattern — here we can safely append.
            agentMessages: {
              keyArgs: ['taskId'],
              // biome-ignore lint/suspicious/noExplicitAny: Apollo cache refs are opaque
              merge(existing: any[] = [], incoming: any[] = [], { readField }) {
                // biome-ignore lint/suspicious/noExplicitAny: Apollo cache refs are opaque
                const byCursor = new Map<string, any>();
                for (const m of [...existing, ...incoming]) {
                  byCursor.set(String(readField('cursor', m)), m);
                }
                return [...byCursor.values()].sort((a, b) => {
                  const ca = BigInt(String(readField('cursor', a)));
                  const cb = BigInt(String(readField('cursor', b)));
                  return ca < cb ? -1 : ca > cb ? 1 : 0;
                });
              },
            },
          },
        },
      },
    }),
    link: errorLink.concat(transport),
  });
}
