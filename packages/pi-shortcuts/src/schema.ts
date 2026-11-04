/**
 * Shortcut record schema, version 1.
 *
 * Parsing is strict: unknown top-level fields are dropped, a record must already
 * carry a canonical name, and every required field is type-checked. The parsed
 * result is a fresh object with a fixed key order so serialized output is stable.
 */

import { normalizeShortcutName } from "./name.ts";

export const SHORTCUT_SCHEMA_VERSION = 1;

export interface ShortcutSourceRange {
  fromEntryId: string;
  toEntryId: string;
}

export interface ShortcutSource {
  sessionId: string;
  range: ShortcutSourceRange;
  cwd: string;
  model: string;
}

export interface Shortcut {
  schemaVersion: typeof SHORTCUT_SCHEMA_VERSION;
  name: string;
  description: string;
  procedure: string;
  /**
   * Minimal parameter form: placeholder names only.
   * Object definitions (for example `{ name, description }`) are rejected so the
   * format can grow without guessing at a half-implemented schema.
   */
  params: string[];
  createdAt: string;
  updatedAt: string;
  source: ShortcutSource;
}

export type ShortcutParseErrorCode =
  | "not-an-object"
  | "unknown-schema-version"
  | "invalid-name"
  | "invalid-field"
  | "corrupt-json";

export interface ShortcutParseFailure {
  ok: false;
  code: ShortcutParseErrorCode;
  message: string;
}

export type ShortcutParseResult = { ok: true; shortcut: Shortcut } | ShortcutParseFailure;

const PARAM_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

class ShortcutValidationError extends Error {
  readonly code: ShortcutParseErrorCode;

  constructor(code: ShortcutParseErrorCode, message: string) {
    super(message);
    this.name = "ShortcutValidationError";
    this.code = code;
  }
}

function invalid(code: ShortcutParseErrorCode, message: string): ShortcutValidationError {
  return new ShortcutValidationError(code, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  return typeof value;
}

function readObject(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw invalid("invalid-field", `${field} must be an object.`);
  }
  return value;
}

function readString(value: unknown, field: string, { allowEmpty = false } = {}): string {
  if (typeof value !== "string") {
    throw invalid("invalid-field", `${field} must be a string.`);
  }
  if (!allowEmpty && value.length === 0) {
    throw invalid("invalid-field", `${field} must not be empty.`);
  }
  return value;
}

function readTimestamp(value: unknown, field: string): string {
  const text = readString(value, field);
  if (!ISO_TIMESTAMP.test(text) || Number.isNaN(Date.parse(text))) {
    throw invalid("invalid-field", `${field} must be an ISO 8601 UTC timestamp, for example "2026-01-02T03:04:05.000Z".`);
  }
  return text;
}

function readName(value: unknown): string {
  const result = normalizeShortcutName(value);
  if (!result.ok) {
    throw invalid("invalid-name", result.message);
  }
  if (result.name !== value) {
    throw invalid("invalid-name", `name must already be normalized to "${result.name}".`);
  }
  return result.name;
}

function readParams(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw invalid("invalid-field", "params must be an array of parameter names.");
  }

  const params: string[] = [];
  const seen = new Set<string>();

  for (const [index, entry] of value.entries()) {
    const field = `params[${index}]`;
    if (typeof entry !== "string") {
      throw invalid("invalid-field", `${field} must be a string; object parameter definitions are not supported by schemaVersion 1.`);
    }
    if (!PARAM_NAME.test(entry)) {
      throw invalid("invalid-field", `${field} must be 1-32 characters of letters, digits, "_" or "-", starting with a letter or digit.`);
    }
    const key = entry.toLowerCase();
    if (seen.has(key)) {
      throw invalid("invalid-field", `${field} duplicates parameter "${entry}".`);
    }
    seen.add(key);
    params.push(entry);
  }

  return params;
}

function readSource(value: unknown): ShortcutSource {
  const source = readObject(value, "source");
  const range = readObject(source.range, "source.range");

  return {
    sessionId: readString(source.sessionId, "source.sessionId"),
    range: {
      fromEntryId: readString(range.fromEntryId, "source.range.fromEntryId"),
      toEntryId: readString(range.toEntryId, "source.range.toEntryId"),
    },
    cwd: readString(source.cwd, "source.cwd"),
    model: readString(source.model, "source.model"),
  };
}

function readShortcut(value: unknown): Shortcut {
  if (!isPlainObject(value)) {
    throw invalid("not-an-object", "A shortcut record must be a JSON object.");
  }

  if (value.schemaVersion !== SHORTCUT_SCHEMA_VERSION) {
    throw invalid(
      "unknown-schema-version",
      `Unsupported shortcut schemaVersion ${describe(value.schemaVersion)}; this build supports ${SHORTCUT_SCHEMA_VERSION}.`,
    );
  }

  return {
    schemaVersion: SHORTCUT_SCHEMA_VERSION,
    name: readName(value.name),
    description: readString(value.description, "description", { allowEmpty: true }),
    procedure: readString(value.procedure, "procedure"),
    params: readParams(value.params),
    createdAt: readTimestamp(value.createdAt, "createdAt"),
    updatedAt: readTimestamp(value.updatedAt, "updatedAt"),
    source: readSource(value.source),
  };
}

export function parseShortcut(value: unknown): ShortcutParseResult {
  try {
    return { ok: true, shortcut: readShortcut(value) };
  } catch (error) {
    if (error instanceof ShortcutValidationError) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
}

export function parseShortcutJson(text: string): ShortcutParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, code: "corrupt-json", message: "Shortcut file is not valid JSON." };
  }
  return parseShortcut(value);
}

/**
 * Serializes a record that has already been validated (see `parseShortcut`).
 * Unknown fields are dropped and a trailing newline is added.
 */
export function serializeShortcut(shortcut: Shortcut): string {
  return `${JSON.stringify(toJson(shortcut))}\n`;
}

function toJson(shortcut: Shortcut): Shortcut {
  return {
    schemaVersion: SHORTCUT_SCHEMA_VERSION,
    name: shortcut.name,
    description: shortcut.description,
    procedure: shortcut.procedure,
    params: [...shortcut.params],
    createdAt: shortcut.createdAt,
    updatedAt: shortcut.updatedAt,
    source: {
      sessionId: shortcut.source.sessionId,
      range: {
        fromEntryId: shortcut.source.range.fromEntryId,
        toEntryId: shortcut.source.range.toEntryId,
      },
      cwd: shortcut.source.cwd,
      model: shortcut.source.model,
    },
  };
}
