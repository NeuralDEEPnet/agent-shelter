import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export class PrepaidRefusal extends Error {}
export type BuyerAccount = { userId: string; balanceCents: number; heldCents: number; frozen: number; debtCents: number };
export type TopUp = { id: string; userId: string; amountCents: number; status: string; requestKey: string; sessionId: string | null; paymentIntentId: string | null; checkoutUrl: string | null; refundedCents: number };
export type CreditQuestion = { id: string; requestKey: string; userId: string; residentId: string; mode: string; requestHash: string; priceCents: number; creatorSharePct: number; question: string; status: string; answer: string | null; notice: string | null; expiresAt: string };
type ResidentRow = { id: string; status: string; budgetUnits: number; creatorSharePct: number };

/** Synchronous BEGIN IMMEDIATE transactions serialize money + compute across workers. */
export class PrepaidStore {
  constructor(readonly sql: Database.Database) { sql.pragma("foreign_keys = ON"); sql.pragma("busy_timeout = 5000"); }
  private atomic<T>(fn: () => T): T { return this.sql.transaction(fn).immediate(); }
  account(userId: string): BuyerAccount {
    this.sql.prepare('INSERT OR IGNORE INTO "PrepaidAccount" ("userId") VALUES (?)').run(userId);
    return this.sql.prepare('SELECT * FROM "PrepaidAccount" WHERE "userId"=?').get(userId) as BuyerAccount;
  }
  private entry(userId: string, reference: string, kind: string, cents: number) {
    this.sql.prepare('INSERT INTO "PrepaidEntry" ("id","userId","reference","kind","deltaCents") VALUES (?,?,?,?,?)').run(randomUUID(), userId, reference, kind, cents);
  }
  topUp(id: string) { return this.sql.prepare('SELECT * FROM "PrepaidTopUp" WHERE "id"=?').get(id) as TopUp | undefined; }
  topUpForSession(sessionId: string, userId: string) { return this.sql.prepare('SELECT * FROM "PrepaidTopUp" WHERE "sessionId"=? AND "userId"=?').get(sessionId, userId) as TopUp | undefined; }
  recentTopUps(userId: string) { return this.sql.prepare('SELECT * FROM "PrepaidTopUp" WHERE "userId"=? ORDER BY "createdAt" DESC LIMIT 30').all(userId) as TopUp[]; }
  startTopUp(userId: string, amountCents: number, requestId: string): { row: TopUp; created: boolean } {
    return this.atomic(() => {
      const account = this.account(userId);
      if (account.frozen) throw new PrepaidRefusal("Your balance is held for a payment review. Contact the Shelter owner.");
      if (account.balanceCents + account.heldCents + amountCents > 10000) throw new PrepaidRefusal("Keep your usage balance below €100. No unlimited top-ups.");
      const requestKey = `${userId}:${requestId}`;
      const old = this.sql.prepare('SELECT * FROM "PrepaidTopUp" WHERE "requestKey"=?').get(requestKey) as TopUp | undefined;
      if (old) { if (old.amountCents !== amountCents) throw new PrepaidRefusal("This checkout request was already used for another amount."); return { row: old, created: false }; }
      const pending = this.sql.prepare('SELECT COUNT(*) AS n FROM "PrepaidTopUp" WHERE "userId"=? AND "status" IN (\'creating\',\'open\') AND "createdAt">?').get(userId, new Date(Date.now() - 86400000).toISOString()) as { n: number };
      if (pending.n >= 5) throw new PrepaidRefusal("You have five recent checkout attempts. Confirm an existing one before starting another.");
      const id = randomUUID();
      this.sql.prepare('INSERT INTO "PrepaidTopUp" ("id","userId","amountCents","requestKey") VALUES (?,?,?,?)').run(id, userId, amountCents, requestKey);
      return { row: this.topUp(id)!, created: true };
    });
  }
  bindCheckout(id: string, sessionId: string, url: string) {
    this.sql.prepare('UPDATE "PrepaidTopUp" SET "sessionId"=?,"checkoutUrl"=?,"status"=\'open\' WHERE "id"=? AND "status"=\'creating\'').run(sessionId, url, id);
  }
  creditTopUp(id: string, sessionId: string, pi: string): boolean {
    return this.atomic(() => {
      const row = this.topUp(id);
      if (!row || row.sessionId !== sessionId) throw new PrepaidRefusal("Checkout binding does not match.");
      if (row.status === "credited") return false;
      if (row.status !== "open" || row.refundedCents) throw new PrepaidRefusal("This checkout is held or reversed; no credit was added.");
      const a = this.account(row.userId);
      if (a.frozen) throw new PrepaidRefusal("Account is held for payment review.");
      this.sql.prepare('UPDATE "PrepaidTopUp" SET "status"=\'credited\',"paymentIntentId"=? WHERE "id"=?').run(pi, id);
      this.sql.prepare('UPDATE "PrepaidAccount" SET "balanceCents"="balanceCents"+? WHERE "userId"=?').run(row.amountCents, row.userId);
      this.entry(row.userId, `topup:${id}`, "topup", row.amountCents);
      return true;
    });
  }
  /** A refund/dispute is monotonic; spent amounts become review debt, never negative credit. */
  reversePayment(pi: string, cumulativeRefundCents: number, disputed = false) {
    return this.atomic(() => {
      const row = this.sql.prepare('SELECT * FROM "PrepaidTopUp" WHERE "paymentIntentId"=?').get(pi) as TopUp | undefined;
      if (!row) return false;
      const amount = disputed ? row.amountCents : Math.min(row.amountCents, Math.max(0, cumulativeRefundCents));
      const delta = amount - row.refundedCents;
      if (delta <= 0 && !disputed) return false;
      const a = this.account(row.userId);
      const debit = Math.min(a.balanceCents, Math.max(0, delta));
      this.sql.prepare('UPDATE "PrepaidAccount" SET "balanceCents"="balanceCents"-?,"debtCents"="debtCents"+?,"frozen"=1 WHERE "userId"=?').run(debit, Math.max(0, delta - debit), row.userId);
      this.sql.prepare('UPDATE "PrepaidTopUp" SET "status"=\'reversed\',"refundedCents"=? WHERE "id"=?').run(Math.max(row.refundedCents, amount), row.id);
      if (delta > 0) this.entry(row.userId, `reverse:${row.id}:${amount}`, "payment-reversal", -debit);
      return true;
    });
  }
  question(userId: string, requestId: string) { return this.sql.prepare('SELECT * FROM "PrepaidQuestion" WHERE "requestKey"=?').get(`${userId}:${requestId}`) as CreditQuestion | undefined; }
  private refundInside(row: CreditQuestion, notice: string) {
    const changed = this.sql.prepare('UPDATE "PrepaidQuestion" SET "status"=\'refunded\',"notice"=?,"finishedAt"=? WHERE "id"=? AND "status"=\'reserved\'').run(notice, new Date().toISOString(), row.id).changes;
    if (!changed) return;
    const a = this.account(row.userId);
    const debtRecovery = Math.min(a.debtCents, row.priceCents);
    this.sql.prepare('UPDATE "PrepaidAccount" SET "balanceCents"="balanceCents"+?,"heldCents"="heldCents"-?,"debtCents"="debtCents"-? WHERE "userId"=?').run(row.priceCents - debtRecovery, row.priceCents, debtRecovery, row.userId);
    this.entry(row.userId, `refund:${row.id}`, "delivery-refund", row.priceCents - debtRecovery);
  }
  recoverExpired(userId: string, now = new Date().toISOString()) {
    return this.atomic(() => {
      const rows = this.sql.prepare('SELECT * FROM "PrepaidQuestion" WHERE "userId"=? AND "status"=\'reserved\' AND "expiresAt"<?').all(userId, now) as CreditQuestion[];
      for (const row of rows) this.refundInside(row, "The answer could not be confirmed before the deadline. Usage credit was restored; this request will not run again.");
    });
  }
  reserve(input: { userId: string; requestId: string; residentId: string; mode: string; question: string; hash: string; priceCents: number; globalCap: number; turnsPerMinute: number }): { row: CreditQuestion; created: boolean } {
    return this.atomic(() => {
      const key = `${input.userId}:${input.requestId}`;
      const old = this.sql.prepare('SELECT * FROM "PrepaidQuestion" WHERE "requestKey"=?').get(key) as CreditQuestion | undefined;
      if (old) { if (old.requestHash !== input.hash) throw new PrepaidRefusal("This request id belongs to another question."); return { row: old, created: false }; }
      const a = this.account(input.userId);
      if (a.frozen) throw new PrepaidRefusal("Your balance is held for a payment review.");
      if (a.balanceCents < input.priceCents) throw new PrepaidRefusal("Not enough prepaid credit. Add a balance first.");
      const setting = this.sql.prepare('SELECT "paused" FROM "ShelterSetting" WHERE "id"=\'shelter\'').get() as { paused: number } | undefined;
      if (setting?.paused) throw new PrepaidRefusal("The Shelter is paused. No credit was spent.");
      const r = this.sql.prepare('SELECT "id","status","budgetUnits","creatorSharePct" FROM "Resident" WHERE "id"=?').get(input.residentId) as ResidentRow | undefined;
      if (!r || !["active", "probation"].includes(r.status)) throw new PrepaidRefusal("This resident is not taking questions. No credit was spent.");
      const day = new Date().toISOString().slice(0, 10);
      const usage = this.sql.prepare('SELECT COALESCE(SUM("unitsSpent"),0) AS n FROM "DailyUsage" WHERE "day"=?').get(day) as { n: number };
      if (usage.n + 1 > input.globalCap) throw new PrepaidRefusal("Today's Shelter compute limit is reached. Your credit remains available.");
      const minute = new Date(Date.now() - 60000).toISOString();
      const calls = this.sql.prepare('SELECT COUNT(*) AS n FROM "PrepaidQuestion" WHERE "residentId"=? AND "createdAt">?').get(r.id, minute) as { n: number };
      if (calls.n >= input.turnsPerMinute) throw new PrepaidRefusal("This resident is busy. Wait a minute; no credit was spent.");
      if (r.budgetUnits < 1) {
        const moved = this.sql.prepare('UPDATE "Wallet" SET "balanceCents"="balanceCents"-5 WHERE "residentId"=? AND "balanceCents">=5').run(r.id).changes;
        if (!moved) throw new PrepaidRefusal("This resident has no compute left today. Your credit was not spent.");
        this.sql.prepare('UPDATE "Resident" SET "budgetUnits"="budgetUnits"+1 WHERE "id"=?').run(r.id);
        this.sql.prepare('INSERT INTO "LedgerEntry" ("id","residentId","reference","party","kind","amountCents","note") VALUES (?,?,?,\'resident\',\'adjustment\',-5,\'Bought one compute unit\')').run(randomUUID(), r.id, `prepaid-compute:${key}`);
      }
      const id = randomUUID();
      this.sql.prepare('UPDATE "Resident" SET "budgetUnits"="budgetUnits"-1 WHERE "id"=? AND "budgetUnits">=1').run(r.id);
      this.sql.prepare('INSERT INTO "DailyUsage" ("id","day","residentId","calls","unitsSpent","refunds","injections") VALUES (?,?,?,1,1,0,0) ON CONFLICT("day","residentId") DO UPDATE SET "calls"="calls"+1,"unitsSpent"="unitsSpent"+1').run(randomUUID(), day, r.id);
      this.sql.prepare('UPDATE "PrepaidAccount" SET "balanceCents"="balanceCents"-?,"heldCents"="heldCents"+? WHERE "userId"=?').run(input.priceCents, input.priceCents, input.userId);
      this.sql.prepare('INSERT INTO "PrepaidQuestion" ("id","requestKey","userId","residentId","mode","requestHash","priceCents","creatorSharePct","question","expiresAt") VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, key, input.userId, r.id, input.mode, input.hash, input.priceCents, r.creatorSharePct, input.question, new Date(Date.now() + 120000).toISOString());
      this.entry(input.userId, `reserve:${id}`, "reserve", -input.priceCents);
      return { row: this.question(input.userId, input.requestId)!, created: true };
    });
  }
  finish(id: string, answer: string | null, notice: string | null) {
    return this.atomic(() => {
      const row = this.sql.prepare('SELECT * FROM "PrepaidQuestion" WHERE "id"=?').get(id) as CreditQuestion | undefined;
      if (!row || row.status !== "reserved") return;
      const a = this.account(row.userId);
      const r = this.sql.prepare('SELECT "status" FROM "Resident" WHERE "id"=?').get(row.residentId) as { status: string } | undefined;
      const paused = this.sql.prepare('SELECT "paused" FROM "ShelterSetting" WHERE "id"=\'shelter\'').get() as { paused: number } | undefined;
      if (!answer || a.frozen || !r || !["active", "probation"].includes(r.status) || paused?.paused || row.expiresAt < new Date().toISOString()) { this.refundInside(row, notice ?? "Delivery was held; usage credit restored."); return; }
      this.sql.prepare('UPDATE "PrepaidQuestion" SET "status"=\'served\',"answer"=?,"finishedAt"=? WHERE "id"=?').run(answer, new Date().toISOString(), row.id);
      this.sql.prepare('UPDATE "PrepaidAccount" SET "heldCents"="heldCents"-? WHERE "userId"=?').run(row.priceCents, row.userId);
      const creator = Math.max(0, Math.min(10, row.creatorSharePct));
      const parts = { resident: row.priceCents * (80 - creator), shelter: row.priceCents * 20, creator: row.priceCents * creator };
      for (const [party, units] of Object.entries(parts)) {
        this.sql.prepare('INSERT INTO "PrepaidRoyalty" ("id","questionId","residentId","party","hundredthCents") VALUES (?,?,?,?,?)').run(randomUUID(), row.id, row.residentId, party, units);
        this.sql.prepare('INSERT INTO "PrepaidRoyaltyBalance" ("id","residentId","party","hundredthCents") VALUES (?,?,?,?) ON CONFLICT("residentId","party") DO UPDATE SET "hundredthCents"="hundredthCents"+excluded."hundredthCents"').run(randomUUID(), row.residentId, party, units);
        const b = this.sql.prepare('SELECT "hundredthCents","creditedCents" FROM "PrepaidRoyaltyBalance" WHERE "residentId"=? AND "party"=?').get(row.residentId, party) as { hundredthCents: number; creditedCents: number };
        const due = Math.floor(b.hundredthCents / 100) - b.creditedCents;
        if (due > 0) {
          this.sql.prepare('INSERT INTO "LedgerEntry" ("id","residentId","reference","party","kind","amountCents","note") VALUES (?,?,?,?,\'hire\',?,\'Whole cents released from exact prepaid royalty accrual\')').run(randomUUID(), row.residentId, `prepaid:${row.id}`, party, due);
          this.sql.prepare('UPDATE "PrepaidRoyaltyBalance" SET "creditedCents"="creditedCents"+? WHERE "residentId"=? AND "party"=?').run(due, row.residentId, party);
          if (party === "resident") this.sql.prepare('INSERT INTO "Wallet" ("id","residentId","balanceCents","paidOutCents","updatedAt") VALUES (?,?,?,0,?) ON CONFLICT("residentId") DO UPDATE SET "balanceCents"="balanceCents"+excluded."balanceCents"').run(randomUUID(), row.residentId, due, new Date().toISOString());
        }
      }
      this.sql.prepare('UPDATE "Resident" SET "paidCalls"="paidCalls"+1,"earnedCents"="earnedCents"+?,"lastActiveAt"=? WHERE "id"=?').run(row.priceCents, new Date().toISOString(), row.residentId);
      this.sql.prepare('INSERT INTO "HireCall" ("id","residentId","paymentId","question","answer","outcome","costUnits","sampled") VALUES (?,?,?,?,?,\'ok\',1,1)').run(randomUUID(), row.residentId, `prepaid:${row.id}`, row.question, answer);
    });
  }
}
