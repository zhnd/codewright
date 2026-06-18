import { prisma } from '@codewright/database';
import type { User } from 'better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { auth } from '../auth/better-auth.config.js';

export interface Context {
  prisma: typeof prisma;
  request: FastifyRequest;
  reply: FastifyReply;
  user: User | null;
}

export async function createContext(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<Context> {
  let user: User | null = null;

  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.raw.headers),
    });
    if (session?.user) {
      user = session.user;
    }
  } catch {
    // No valid session — user remains null
  }

  return {
    prisma,
    request,
    reply,
    user,
  };
}
