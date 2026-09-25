import { type AppConfig, appConfigSchema } from "@adaptive-ai/sdk/server";
import appConfigJson from "./app.config.json";

export const appConfig: AppConfig = appConfigSchema.parse(appConfigJson);
