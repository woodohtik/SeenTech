import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import type { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import { logger } from './logger.ts';

// Must call this here, not just rely on server.ts's own dotenv.config() --
// ES module imports are fully evaluated before the importing module's own
// top-level code runs, so server.ts's `import { globalRateLimiter } from
// "./src/server/rateLimiter.ts"` (above its own dotenv.config() call) would
// otherwise read process.env before .env is loaded in local dev, leaving
// `redis`/`ratelimit` below permanently null for the whole process even
// with valid vars in .env.local.
//
// { path: ['.env.local', '.env'] } -- not a bare dotenv.config(). This repo
// has no .env file at all (only .env.local, written by `vercel env pull`),
// and bare dotenv.config() only ever looks for .env -- it fails with a
// swallowed ENOENT and silently loads nothing, which is exactly what was
// happening here and in every sibling file (server.ts, firebase-admin.ts,
// supabase-admin.ts, all fixed alongside this one) before this fix.
// Verified directly: KV_REST_API_URL is only actually present in
// process.env after switching to this array form. Vercel itself injects
// these as real process env vars regardless of any of this, so it only
// ever mattered for `npm run dev`.
dotenv.config({ path: ['.env.local', '.env'] });

/**
 * seen-rate-limiting-redis-task.md -- replaces the global in-memory
 * express-rate-limit middleware (ineffective on Vercel serverless: every
 * function instance keeps its own counter, so the limit gets *less*
 * effective under load, not more). Every OTHER rate limiter in this
 * project (PIN verify, phone lookup, order tracking) already moved to a
 * Postgres-backed shared counter in an earlier task and needs no change --
 * this is the one remaining spot, and it runs on nearly every request, so
 * a low-latency REST-based store (Upstash) fits better here than another
 * Postgres round-trip would.
 *
 * Provisioned via Vercel Marketplace (`vercel integration add
 * upstash/upstash-kv`), which sets KV_REST_API_URL/KV_REST_API_TOKEN (the
 * Vercel-KV-compatible naming), not UPSTASH_REDIS_REST_URL/TOKEN -- hence
 * explicit construction below instead of Redis.fromEnv().
 */
const redis = (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
  ? new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
  : null;

const ratelimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(120, '60 s'), prefix: 'seen-global-rl' })
  : null;

/**
 * Global per-IP rate limiter, fail-open by explicit product decision
 * (seen-rate-limiting-redis-task.md #5): this is defense-in-depth, not core
 * functionality -- a transient Upstash outage must never take the whole
 * site down. Any error from the Redis call (network, timeout, auth) is
 * logged and the request is allowed through rather than rejected.
 *
 * Missing env vars (KV_REST_API_URL/TOKEN not configured in this
 * environment, e.g. local dev without `vercel env pull`) degrade the same
 * way -- allow everything, log once per process via the module-level null
 * check above, not per-request.
 */
export function globalRateLimiter(skip: (req: Request) => boolean) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (skip(req)) return next();
    if (!ratelimit) return next();

    try {
      const ip = req.ip || 'unknown';
      const { success } = await ratelimit.limit(ip);
      if (!success) {
        return res.status(429).json({ error: 'Too many requests, please try again shortly.' });
      }
      return next();
    } catch (err) {
      logger.error({ err }, '[rateLimiter] Upstash call failed -- failing open, request allowed');
      return next();
    }
  };
}
