/**
 * Shortcut name rules.
 *
 * A shortcut name is a canonical slug: the file name in the store is `<name>.json`,
 * so the name may never carry path syntax. Normalization is deterministic
 * (NFKC, trimmed, lowercased, whitespace and underscores collapsed to `-`),
 * which means `Foo Bar` and `foo_bar` both address the same stored shortcut.
 */

export const MAX_SHORTCUT_NAME_LENGTH = 64;

export type ShortcutNameErrorCode =
  | "empty"
  | "path-separator"
  | "traversal"
  | "dotfile"
  | "too-long"
  | "leading-or-trailing-hyphen"
  | "invalid-characters";

export interface ShortcutNameFailure {
  ok: false;
  code: ShortcutNameErrorCode;
  message: string;
}

export type ShortcutNameResult = { ok: true; name: string } | ShortcutNameFailure;

const RULE_HINT =
  "Use letters, digits, and single hyphens, for example \"review-diff\".";

const SEPARATOR_RUN = /[\s_]+/gu;
const HYPHEN_RUN = /-{2,}/gu;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function fail(code: ShortcutNameErrorCode, message: string): ShortcutNameFailure {
  return { ok: false, code, message };
}

export function normalizeShortcutName(raw: unknown): ShortcutNameResult {
  if (typeof raw !== "string") {
    return fail("empty", "Shortcut name must be a string.");
  }

  const trimmed = raw.normalize("NFKC").trim();
  if (trimmed.length === 0) {
    return fail("empty", "Shortcut name must not be empty.");
  }

  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return fail("path-separator", `Shortcut name must not contain path separators. ${RULE_HINT}`);
  }

  if (trimmed.includes("..")) {
    return fail("traversal", `Shortcut name must not contain "..". ${RULE_HINT}`);
  }

  if (trimmed.startsWith(".")) {
    return fail("dotfile", `Shortcut name must not start with a dot. ${RULE_HINT}`);
  }

  const name = trimmed
    .toLowerCase()
    .replace(SEPARATOR_RUN, "-")
    .replace(HYPHEN_RUN, "-");

  if (name.length > MAX_SHORTCUT_NAME_LENGTH) {
    return fail(
      "too-long",
      `Shortcut name must be at most ${MAX_SHORTCUT_NAME_LENGTH} characters after normalization.`,
    );
  }

  if (name.startsWith("-") || name.endsWith("-")) {
    return fail("leading-or-trailing-hyphen", `Shortcut name must not start or end with a hyphen. ${RULE_HINT}`);
  }

  if (!SLUG.test(name)) {
    return fail("invalid-characters", `Shortcut name may only use lowercase letters, digits, and single hyphens. ${RULE_HINT}`);
  }

  return { ok: true, name };
}
