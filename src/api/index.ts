import * as procedures from "@/api/procedures";
import { jobs } from "@/api/queue";

export type Procedures = typeof procedures;
export type Jobs = typeof jobs;

export { procedures, jobs };
