import type { IncomingMessage } from 'node:http';
import { prisma } from '@codewright/database';
import type { User } from 'better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance } from 'fastify';
import { useServer } from 'graphql-ws/use/ws';
import { WebSocketServer } from 'ws';
import { log } from '../../logger.js';
import { auth } from '../auth/better-auth.config.js';
import { schema } from '../graphql/schema.js';

/**
 * Mounts a graphql-ws WebSocket endpoint at the same path as HTTP
 * GraphQL so the web client can open one URL.
 *
 * Auth precedence:
 *   1. `connectionParams.{authorization,cookie}` — explicit client-
 *      supplied tokens (bearer from localStorage, or a cookie string
 *      when the client wants to be explicit).
 *   2. The upgrade HTTP request headers — this is where the browser's
 *      HttpOnly session cookie actually arrives. Without this fallback,
 *      every cookie-authenticated subscription rejects, because
 *      `document.cookie` in the browser never sees HttpOnly cookies.
 *
 * Unauthenticated upgrades are rejected in `onConnect`.
 */
export async function registerGraphQLWebSocket(
  app: FastifyInstance
): Promise<void> {
  const wss = new WebSocketServer({
    server: app.server,
    path: '/graphql',
  });

  useServer(
    {
      schema,
      context: async (ctx) => {
        const user = await authenticateConnection(ctx);
        return {
          prisma,
          user,
          request: ctx.extra,
          reply: undefined,
        };
      },
      onConnect: async (ctx) => {
        const user = await authenticateConnection(ctx);
        if (!user) {
          log.warn('graphql-ws: rejected unauthenticated connect');
          return false;
        }
        return true;
      },
    },
    wss
  );

  app.addHook('onClose', async () => {
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  log.info({ path: '/graphql' }, 'GraphQL WebSocket mounted');
}

interface WsContextLike {
  connectionParams?: Record<string, unknown>;
  extra: { request: IncomingMessage };
}

async function authenticateConnection(
  ctx: WsContextLike
): Promise<User | null> {
  const headers = extractAuthHeaders(ctx);
  if (Object.keys(headers).length === 0) return null;
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(headers),
    });
    return session?.user ?? null;
  } catch {
    return null;
  }
}

/**
 * Collect cookie + authorization from the two places a ws connection
 * can carry them. connectionParams wins when both are present — that
 * lets tests and non-browser clients override what the upgrade request
 * actually sent.
 */
function extractAuthHeaders(ctx: WsContextLike): Record<string, string> {
  const out: Record<string, string> = {};

  // 1. From the upgrade HTTP request (browsers with HttpOnly cookies)
  const reqHeaders = ctx.extra?.request?.headers ?? {};
  if (typeof reqHeaders.cookie === 'string') {
    out.cookie = reqHeaders.cookie;
  }
  if (typeof reqHeaders.authorization === 'string') {
    out.authorization = reqHeaders.authorization;
  }

  // 2. From connectionParams (explicit overrides / non-browser clients)
  const params = ctx.connectionParams ?? {};
  const paramCookie =
    typeof params.cookie === 'string'
      ? params.cookie
      : typeof params.Cookie === 'string'
        ? params.Cookie
        : undefined;
  const paramAuth =
    typeof params.authorization === 'string'
      ? params.authorization
      : typeof params.Authorization === 'string'
        ? params.Authorization
        : undefined;
  if (paramCookie) out.cookie = paramCookie;
  if (paramAuth) out.authorization = paramAuth;

  return out;
}
