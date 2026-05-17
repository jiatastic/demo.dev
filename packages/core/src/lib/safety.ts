/**
 * Heuristic destructive-action classifier and origin-allow check.
 * Intentionally conservative — agents can override via --allow-destructive
 * or --allow-domain. The hard wall lives at the executor, not here.
 */

const DESTRUCTIVE_KEYWORDS = [
  "delete",
  "remove",
  "destroy",
  "drop",
  "purge",
  "wipe",
  "erase",
  "cancel subscription",
  "cancel plan",
  "close account",
  "deactivate",
  "uninstall",
  "revoke",
  "transfer ownership",
  "leave organization",
  "leave workspace",
  "archive permanently",
  "confirm delete",
  "yes, delete",
  "permanently",
];

const sanitize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export interface DestructiveCheck {
  destructive: boolean;
  matched?: string;
}

/** Inspect a target name, narration line, or freeform string for destructive intent. */
export const classifyDestructive = (...inputs: Array<string | undefined>): DestructiveCheck => {
  const haystack = inputs.filter(Boolean).map((s) => sanitize(s as string)).join(" | ");
  if (!haystack) return { destructive: false };

  for (const keyword of DESTRUCTIVE_KEYWORDS) {
    if (haystack.includes(keyword)) {
      return { destructive: true, matched: keyword };
    }
  }
  return { destructive: false };
};

export interface OriginPolicy {
  baseUrl: string;
  allowedHosts: string[];
}

export const buildOriginPolicy = (baseUrl: string, allowedHosts: string[] = []): OriginPolicy => {
  const host = safeHost(baseUrl);
  return {
    baseUrl,
    allowedHosts: [host, ...allowedHosts.map(normalizeHost)].filter(Boolean) as string[],
  };
};

const safeHost = (url: string) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
};

const normalizeHost = (input: string) => {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.startsWith("http")) return safeHost(trimmed);
  return trimmed;
};

/** Returns true when `target` is allowed under the policy. */
export const isUrlAllowed = (target: string, policy: OriginPolicy) => {
  const host = safeHost(target);
  if (!host) return false;
  return policy.allowedHosts.some((allowed) => {
    if (!allowed) return false;
    if (allowed === host) return true;
    if (allowed.startsWith("*.")) {
      const suffix = allowed.slice(1);
      return host.endsWith(suffix);
    }
    return false;
  });
};
