/**
 * Goal states published by `@narumitw/pi-goal` through `ctx.ui.setStatus("goal", …)`.
 *
 * pi-goal's `formatStatus` (0.55.x) produces one of:
 *
 *   "waiting"
 *   "complete"
 *   "active <elapsed|budget> · automatic <used>/<limit>"
 *   "active <elapsed|budget> · automatic Unlimited"
 *   "paused · automatic <used>/<limit>"
 *   "paused · automatic limit <used>/<limit>"
 *   "paused · previous automatic limit at <used>"
 *   "paused · automatic Unlimited"
 *   "blocked · automatic <used>/<limit>"
 *   "usage · automatic <used>/<limit>"    (status: usage_limited)
 *   "budget <budget> · automatic <used>/<limit>"  (status: budget_limited)
 *
 * Only the leading state word and the automatic continuation counter are
 * interpreted. Anything that does not start with a known word is returned as
 * `undefined` so the footer omits the segment instead of guessing.
 */
export type GoalState = "active" | "waiting" | "paused" | "blocked" | "usage_limited" | "budget_limited" | "complete";

export interface GoalStatus {
  state: GoalState;
  /** Automatic continuation turns used and allowed, when pi-goal publishes both. */
  turns?: { used: number; limit: number };
}

/** pi-goal abbreviates usage_limited and budget_limited in the status text. */
const STATE_BY_WORD: Readonly<Record<string, GoalState>> = {
  active: "active",
  waiting: "waiting",
  paused: "paused",
  blocked: "blocked",
  usage: "usage_limited",
  budget: "budget_limited",
  complete: "complete",
};

// Matches "automatic 6/10" and "automatic limit 10/10".
const AUTOMATIC_TURNS = /automatic (?:limit )?(\d+)\/(\d+)/;

// pi-goal publishes `waiting` and `complete` verbatim; every other state carries
// an `automatic …` suffix, so requiring it keeps a status another extension
// published under the same "goal" key from being labelled as a pi-goal state.
const AUTOMATIC_COUNTER = / automatic /;

function isGoalShape(text: string): boolean {
  return text === "waiting" || text === "complete" || AUTOMATIC_COUNTER.test(text);
}

function parseTurns(text: string): GoalStatus["turns"] {
  const match = AUTOMATIC_TURNS.exec(text);
  if (!match) return undefined;

  const used = Number(match[1]);
  const limit = Number(match[2]);
  if (!Number.isSafeInteger(used) || !Number.isSafeInteger(limit) || used < 0 || limit <= 0) return undefined;
  return { used, limit };
}

export function parseGoalStatus(status: string | undefined): GoalStatus | undefined {
  const text = status?.trim();
  if (!text) return undefined;

  const word = text.split(" ", 1)[0] ?? "";
  const state = Object.hasOwn(STATE_BY_WORD, word) ? STATE_BY_WORD[word] : undefined;
  if (!state || !isGoalShape(text)) return undefined;

  return { state, turns: parseTurns(text) };
}
