import { getQueue, type Job, type QueueHandlers } from "@adaptive-ai/sdk/server";
import { screenResident } from "@/api/services/shelter";

// Define all job handlers here
export const jobs = {
  /** Behavioural eval + MCP fingerprint after intake. Never rethrows: the review
   *  rows carry the outcome, and a provider failure is not an app crash. */
  screenResident: async (payload: { residentId: string }, job: Job) => {
    try {
      const out = await screenResident(payload.residentId);
      console.log(`[screen] job ${job.id} resident ${payload.residentId}: ${JSON.stringify(out)}`);
    } catch (error) {
      console.error(`[screen] job ${job.id} failed for ${payload.residentId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
} satisfies QueueHandlers;

export const queue = getQueue<typeof jobs>();
