import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/../generated/client";
import { env } from "@/lib/env";

const adapter = new PrismaBetterSQLite3({
  url: env.DB_FILE_NAME,
});
export const db = new PrismaClient({ adapter });
