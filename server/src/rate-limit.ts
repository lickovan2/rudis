import { HttpError } from "./errors.ts";

const buckets = new Map<string, { count: number; until: number }>();

// A small in-memory limiter is sufficient for this single-process service.
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.until <= now) {
    buckets.set(key, { count: 1, until: now + windowMs });
  } else {
    if (current.count >= max) throw new HttpError(429, "Слишком много запросов. Попробуйте позже");
    current.count++;
  }
  if (buckets.size > 10_000) {
    for (const [id, bucket] of buckets) if (bucket.until <= now) buckets.delete(id);
  }
}
