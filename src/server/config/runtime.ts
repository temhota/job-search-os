import { resolve } from "node:path";
import type { AppConfig } from "./schema.js";
import type { MailPolicy, RepositoryOptions } from "../../shared/types.js";

export interface RuntimeDependencies {
  config: AppConfig;
  dataDir: string;
  outputDir: string;
  mailPolicy: MailPolicy;
  repositoryOptions: RepositoryOptions;
}

export function toRuntimeDependencies(
  config: AppConfig,
  root = process.cwd()
): RuntimeDependencies {
  const mailPolicy: MailPolicy = {
    accounts: new Set(config.mail.accounts),
    senderAddresses: new Set(config.mail.senderAddresses.map((address) => address.toLowerCase()))
  };
  return {
    config,
    dataDir: resolve(root, config.storage.dataDir),
    outputDir: resolve(root, config.storage.outputDir),
    mailPolicy,
    repositoryOptions: {
      mail: mailPolicy,
      search: config.search,
      followUpSignature: config.candidate.signature
    }
  };
}
