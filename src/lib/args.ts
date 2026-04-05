export interface CliOptions {
  baseUrl?: string;
  baseRef?: string;
  outputDir?: string;
  manifestPath?: string;
  out?: string;
  prNumber?: string;
  email?: string;
  password?: string;
  storageStatePath?: string;
  configPath?: string;
  field?: string;
  force?: boolean;
}

export const parseCliOptions = (argv: string[]): CliOptions => {
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (!arg) continue;

    if (arg === "--base-url" && next) {
      options.baseUrl = next;
      index += 1;
      continue;
    }

    if (arg === "--base-ref" && next) {
      options.baseRef = next;
      index += 1;
      continue;
    }

    if (arg === "--output-dir" && next) {
      options.outputDir = next;
      index += 1;
      continue;
    }

    if (arg === "--manifest" && next) {
      options.manifestPath = next;
      index += 1;
      continue;
    }

    if (arg === "--out" && next) {
      options.out = next;
      index += 1;
      continue;
    }

    if (arg === "--pr-number" && next) {
      options.prNumber = next;
      index += 1;
      continue;
    }

    if (arg === "--email" && next) {
      options.email = next;
      index += 1;
      continue;
    }

    if (arg === "--password" && next) {
      options.password = next;
      index += 1;
      continue;
    }

    if (arg === "--storage-state" && next) {
      options.storageStatePath = next;
      index += 1;
      continue;
    }

    if (arg === "--config" && next) {
      options.configPath = next;
      index += 1;
      continue;
    }

    if (arg === "--field" && next) {
      options.field = next;
      index += 1;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
    }
  }

  return options;
};
