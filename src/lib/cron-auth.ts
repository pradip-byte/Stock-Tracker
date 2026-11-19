import { timingSafeEqual } from "node:crypto";

/** Cron routes accept only requests carrying CRON_SECRET in the x-cron-secret header. */
export function cronAuthorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("x-cron-secret");
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
