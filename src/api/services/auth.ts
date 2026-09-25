import { getAuth, mcp } from "@adaptive-ai/sdk/server";
import { db } from "@/api/db";
import { env } from "@/lib/env";

/**
 * `getAuth()` returns a union and needs narrowing before `userId` is usable.
 * Callers get a userId or `null` — never a throw — so an anonymous session
 * degrades into a rendered "sign in" notice.
 */
export async function currentUserId(): Promise<string | null> {
  const auth = await getAuth();
  if (auth.status !== "authenticated" || !auth.userId) return null;
  return auth.userId as string;
}

export async function ensureUserRow(userId: string) {
  return db.user.upsert({ where: { id: userId }, create: { id: userId }, update: {} });
}

const ownerCache = new Map<string, { isOwner: boolean; at: number }>();
const OWNER_CACHE_MS = 10 * 60 * 1000;

function list(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Owner = the platform handle in SHELTER_OWNER_HANDLES (or an id in
 * SHELTER_OWNER_USER_IDS). The handle is read from the platform
 * (`mcp.getCurrentUser`) first — the app-side User row is synced on the
 * platform's own schedule and may still be empty on first sign-in — and the
 * User row is the fallback when the platform call is unavailable.
 */
export async function isOwner(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  if (list(env.SHELTER_OWNER_USER_IDS).includes(userId.toLowerCase())) return true;
  const cached = ownerCache.get(userId);
  if (cached && Date.now() - cached.at < OWNER_CACHE_MS) return cached.isOwner;

  const owners = list(env.SHELTER_OWNER_HANDLES);
  let handle: string | null = null;
  try {
    const me = (await mcp.getCurrentUser({})) as { handle?: string | null } | null;
    handle = me?.handle ?? null;
  } catch {
    handle = null;
  }
  if (!handle) {
    const row = await db.user.findUnique({ where: { id: userId }, select: { handle: true } });
    handle = row?.handle ?? null;
  } else {
    // Keep the app-side row in step so the fallback works offline next time.
    await db.user
      .upsert({ where: { id: userId }, create: { id: userId, handle }, update: { handle } })
      .catch(() => undefined);
  }
  const isOwnerNow = Boolean(handle && owners.includes(handle.toLowerCase()));
  ownerCache.set(userId, { isOwner: isOwnerNow, at: Date.now() });
  return isOwnerNow;
}

/** Resolve caller → { userId, owner } in one call. */
export async function caller(): Promise<{ userId: string | null; owner: boolean }> {
  const userId = await currentUserId();
  return { userId, owner: await isOwner(userId) };
}
