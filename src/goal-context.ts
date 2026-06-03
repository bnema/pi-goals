export const GOAL_REFERENCE_DOC_ROLES = ["spec", "plan", "adr", "note", "other"] as const;
export const MAX_GOAL_REFERENCE_DOCS = 50;
export const MAX_GOAL_CONTEXT_LIST_ITEMS = 100;
export const MAX_GOAL_CONTEXT_PATH_CHARS = 1000;
export const MAX_GOAL_CONTEXT_TEXT_CHARS = 2000;

export type GoalReferenceDocRole = (typeof GOAL_REFERENCE_DOC_ROLES)[number];

export interface GoalReferenceDoc {
  path: string;
  role: GoalReferenceDocRole;
  description: string | null;
}

export interface GoalRereadPolicy {
  onResume: boolean;
  onContinuation: boolean;
  beforeCompletion: boolean;
}

export interface GoalContextSnapshot {
  referenceDocs: GoalReferenceDoc[];
  standingInstructions: string[];
  acceptanceCriteria: string[];
  rereadPolicy: GoalRereadPolicy;
}

export interface GoalReferenceDocInput {
  path: string;
  role?: GoalReferenceDocRole | string;
  description?: string | null;
}

export interface GoalContextPatch {
  referenceDocs?: readonly GoalReferenceDocInput[];
  standingInstructions?: readonly string[];
  acceptanceCriteria?: readonly string[];
  rereadPolicy?: Partial<GoalRereadPolicy>;
}

export type GoalContextActionUpdate =
  | { action: "ref.add"; path: string; role?: GoalReferenceDocRole | string; description?: string | null }
  | { action: "instruction.add"; text: string }
  | { action: "criterion.add"; text: string }
  | { action: "reread.set"; policy: Partial<GoalRereadPolicy> }
  | { action: "context.clear" };

export type GoalContextUpdate = GoalContextPatch | GoalContextActionUpdate;

export interface GoalContextNormalizationOptions {
  maxReferenceDocs?: number;
  maxListItems?: number;
  maxPathChars?: number;
  maxTextChars?: number;
}

export interface GoalContextMergeOptions extends GoalContextNormalizationOptions {
  replace?: boolean;
}

interface ResolvedGoalContextNormalizationOptions {
  maxReferenceDocs: number;
  maxListItems: number;
  maxPathChars: number;
  maxTextChars: number;
}

const DEFAULT_REREAD_POLICY: GoalRereadPolicy = {
  onResume: false,
  onContinuation: false,
  beforeCompletion: false,
};

export function emptyGoalContext(): GoalContextSnapshot {
  return {
    referenceDocs: [],
    standingInstructions: [],
    acceptanceCriteria: [],
    rereadPolicy: { ...DEFAULT_REREAD_POLICY },
  };
}

export function sanitizeGoalContextSnapshot(value: unknown, options: GoalContextNormalizationOptions = {}): GoalContextSnapshot {
  if (!isObjectRecord(value)) return emptyGoalContext();
  return {
    referenceDocs: sanitizeGoalReferenceDocs(value.referenceDocs, options),
    standingInstructions: sanitizeGoalContextTextList(value.standingInstructions, options),
    acceptanceCriteria: sanitizeGoalContextTextList(value.acceptanceCriteria, options),
    rereadPolicy: sanitizeGoalRereadPolicy(value.rereadPolicy),
  };
}

export function mergeGoalContextUpdate(
  current: GoalContextSnapshot,
  input: GoalContextUpdate,
  options: GoalContextMergeOptions = {},
): GoalContextSnapshot {
  const base = options.replace ? emptyGoalContext() : sanitizeGoalContextSnapshot(current, options);
  if (isGoalContextActionUpdate(input)) return applyGoalContextActionUpdate(base, input, options);
  const patch = input as Record<string, unknown>;
  return {
    referenceDocs: hasOwn(patch, "referenceDocs") ? sanitizeGoalReferenceDocs(patch.referenceDocs, options) : base.referenceDocs,
    standingInstructions: hasOwn(patch, "standingInstructions")
      ? sanitizeGoalContextTextList(patch.standingInstructions, options)
      : base.standingInstructions,
    acceptanceCriteria: hasOwn(patch, "acceptanceCriteria")
      ? sanitizeGoalContextTextList(patch.acceptanceCriteria, options)
      : base.acceptanceCriteria,
    rereadPolicy: hasOwn(patch, "rereadPolicy") ? sanitizeGoalRereadPolicy(patch.rereadPolicy, base.rereadPolicy) : base.rereadPolicy,
  };
}

function applyGoalContextActionUpdate(
  base: GoalContextSnapshot,
  input: GoalContextActionUpdate,
  options: GoalContextNormalizationOptions,
): GoalContextSnapshot {
  if (input.action === "context.clear") return emptyGoalContext();
  if (input.action === "ref.add") {
    const [doc] = sanitizeGoalReferenceDocs([{ path: input.path, role: input.role, description: input.description }], options);
    if (!doc) return base;
    const withoutExisting = base.referenceDocs.filter((existing) => existing.path !== doc.path);
    return { ...base, referenceDocs: sanitizeGoalReferenceDocs([...withoutExisting, doc], options) };
  }
  if (input.action === "instruction.add") {
    return { ...base, standingInstructions: sanitizeGoalContextTextList([...base.standingInstructions, input.text], options) };
  }
  if (input.action === "reread.set") {
    return { ...base, rereadPolicy: sanitizeGoalRereadPolicy(input.policy, base.rereadPolicy) };
  }
  if (input.action === "criterion.add") {
    return { ...base, acceptanceCriteria: sanitizeGoalContextTextList([...base.acceptanceCriteria, input.text], options) };
  }
  return base;
}

export function sanitizeGoalReferenceDocs(value: unknown, options: GoalContextNormalizationOptions = {}): GoalReferenceDoc[] {
  if (!Array.isArray(value)) return [];
  const limits = resolveOptions(options);
  const docs: GoalReferenceDoc[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isObjectRecord(item)) continue;
    const path = sanitizeString(item.path, limits.maxPathChars);
    if (!path) continue;
    const role = sanitizeGoalReferenceDocRole(item.role);
    if (seen.has(path)) continue;
    seen.add(path);
    docs.push({
      path,
      role,
      description: sanitizeNullableText(item.description, limits.maxTextChars),
    });
    if (docs.length >= limits.maxReferenceDocs) break;
  }
  return docs;
}

export function sanitizeGoalContextTextList(value: unknown, options: GoalContextNormalizationOptions = {}): string[] {
  if (!Array.isArray(value)) return [];
  const limits = resolveOptions(options);
  const items: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = sanitizeString(item, limits.maxTextChars);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    items.push(text);
    if (items.length >= limits.maxListItems) break;
  }
  return items;
}

export function sanitizeGoalRereadPolicy(value: unknown, fallback: GoalRereadPolicy = DEFAULT_REREAD_POLICY): GoalRereadPolicy {
  const policy = isObjectRecord(value) ? value : {};
  return {
    onResume: typeof policy.onResume === "boolean" ? policy.onResume : fallback.onResume,
    onContinuation: typeof policy.onContinuation === "boolean" ? policy.onContinuation : fallback.onContinuation,
    beforeCompletion: typeof policy.beforeCompletion === "boolean" ? policy.beforeCompletion : fallback.beforeCompletion,
  };
}

export function sanitizeGoalReferenceDocRole(value: unknown): GoalReferenceDocRole {
  return typeof value === "string" && (GOAL_REFERENCE_DOC_ROLES as readonly string[]).includes(value) ? (value as GoalReferenceDocRole) : "other";
}

function sanitizeNullableText(value: unknown, maxChars: number): string | null {
  if (value === null || value === undefined) return null;
  return sanitizeString(value, maxChars);
}

function sanitizeString(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const truncated = trimmed.length > maxChars ? trimmed.slice(0, maxChars).trim() : trimmed;
  return truncated || null;
}

function resolveOptions(options: GoalContextNormalizationOptions): ResolvedGoalContextNormalizationOptions {
  return {
    maxReferenceDocs: options.maxReferenceDocs ?? MAX_GOAL_REFERENCE_DOCS,
    maxListItems: options.maxListItems ?? MAX_GOAL_CONTEXT_LIST_ITEMS,
    maxPathChars: options.maxPathChars ?? MAX_GOAL_CONTEXT_PATH_CHARS,
    maxTextChars: options.maxTextChars ?? MAX_GOAL_CONTEXT_TEXT_CHARS,
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isGoalContextActionUpdate(value: GoalContextUpdate): value is GoalContextActionUpdate {
  return (
    isObjectRecord(value) &&
    (value.action === "ref.add" ||
      value.action === "instruction.add" ||
      value.action === "criterion.add" ||
      value.action === "reread.set" ||
      value.action === "context.clear")
  );
}
