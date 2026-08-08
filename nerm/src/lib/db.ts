import { PrismaClient } from '@prisma/client';

/**
 * Application code in `src/app/**` must not import this directly — an ESLint
 * rule enforces that. Go through `@/lib/authz/scope` or a domain service so
 * authorization scoping is always applied.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
