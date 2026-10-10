import { db } from "@/api/db";
import { agreementHash, intakeInputSchema, specFingerprint } from "@/api/services/intake";

/** Exact, account-scoped read-back after an uncertain transport response. No enqueue or AI. */
export async function findOwnIntake(raw: unknown, userId: string) {
  const parsed = intakeInputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const input = parsed.data;
  const resident = await db.resident.findFirst({
    where: {
      surrenderedBy: userId,
      name: input.name, tagline: input.tagline, story: input.story,
      creatorName: input.creatorName, creatorContact: input.creatorContact,
      license: input.license, creatorSharePct: input.creatorSharePct,
      agreementHash: agreementHash(), fingerprint: specFingerprint(input.spec),
      spec: JSON.stringify(input.spec),
      status: { in: ["submitted", "screened", "approved", "probation", "active", "hibernated"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, slug: true, status: true },
  });
  return resident ? { residentId: resident.id, slug: resident.slug, status: resident.status } : null;
}
