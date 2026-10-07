export interface FooterVisibility {
  showCwd: boolean;
  showBranch: boolean;
  showProvider: boolean;
  showContextMode: boolean;
}

export function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;

  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

/**
 * Read `PI_FOOTER_<name>`, falling back to the legacy `PI_MINIMAL_FOOTER_<name>`
 * and then to the default when a variable is unset, empty, or unrecognized.
 */
export function readFlag(name: string, fallback: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBooleanEnv(env[`PI_FOOTER_${name}`], parseBooleanEnv(env[`PI_MINIMAL_FOOTER_${name}`], fallback));
}

export function readFooterVisibility(env: NodeJS.ProcessEnv = process.env): FooterVisibility {
  return {
    showCwd: readFlag("SHOW_CWD", false, env),
    showBranch: readFlag("SHOW_BRANCH", true, env),
    showProvider: readFlag("SHOW_PROVIDER", false, env),
    showContextMode: readFlag("SHOW_CONTEXT_MODE", true, env),
  };
}
