import { getQueue, type Job, type QueueHandlers } from "@adaptive-ai/sdk/server";
import { processTicket } from "@/api/services/overflow";
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
  /** Work one Overflow Desk ticket (claim → one bounded model call → review by a different resident).
   *  Idempotent (the claim is a conditional update) and never rethrows: the ticket row is the truth. */
  overflowRun: async (payload: { ticketId: string }, job: Job) => {
    try {
      const out = await processTicket(payload.ticketId);
      console.log(`[overflow] job ${job.id} ${payload.ticketId}: ${out.ok ? out.status : out.reason}`);
    } catch (error) {
      console.error(`[overflow] job ${job.id} failed for ${payload.ticketId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
} satisfies QueueHandlers;

export const queue = getQueue<typeof jobs>();
