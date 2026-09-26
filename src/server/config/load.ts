import { readFileSync } from "node:fs";
import { parseAppConfig, type AppConfig } from "./schema.js";

export function loadAppConfig(path?: string): AppConfig {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path ?? process.env.JOB_SEARCH_CONFIG ?? "config/local.json", "utf8"));
  } catch {
    throw new Error("Cannot load configuration: provide a readable JSON configuration via JOB_SEARCH_CONFIG or config/local.json");
  }
  return parseAppConfig(value);
}
