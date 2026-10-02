export interface FooterVisibility {
  showCwd: boolean;
  showBranch: boolean;
  showProvider: boolean;
}

export function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;

  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function readFooterVisibility(): FooterVisibility {
  return {
    showCwd: parseBooleanEnv(process.env.PI_MINIMAL_FOOTER_SHOW_CWD, true),
    showBranch: parseBooleanEnv(process.env.PI_MINIMAL_FOOTER_SHOW_BRANCH, true),
    showProvider: parseBooleanEnv(process.env.PI_MINIMAL_FOOTER_SHOW_PROVIDER, false),
  };
}
