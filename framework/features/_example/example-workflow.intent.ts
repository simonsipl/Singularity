// ============================================================================
// SINGULARITY INTENT CONTRACT — SKELETON
// feature: _example            <- rename the directory, drop the underscore
// workflow: example-workflow   <- rename this file to <workflow>.intent.ts
// target: src/exec/example-workflow.exec.js
//
// DECLARATIVE ONLY. No execution logic, no function bodies, no control flow.
// This file is the single source of truth the compiler reads. If a behaviour is
// not stated here, it is undefined and the compiler must refuse to invent it —
// or, if it must invent it, the invention gets a decision record (see
// docs/DECISIONS.md, and decisions 0003/0008 in the reference project for what
// recorded inventions look like).
// ============================================================================

/** Integer minor units (cents). Never a float. */
export type Cents = number;

/** Dense index into a table the caller owns. Not a customer-facing id. */
export type Slot = number;

export const enum RecordStatus {
  PENDING = 0,
  ACCEPTED = 1,
  INVALID_AMOUNT = 2,
  UNKNOWN_SLOT = 3,
}

// ---------------------------------------------------------------------------
// INPUT — semantics only. The compiler realises this struct-of-arrays over one
// arena; it must never materialise per-record objects.
// ---------------------------------------------------------------------------

export interface ExampleRecord {
  readonly slot: Slot;
  readonly amount: Cents;
}

export interface ExampleBatchInput {
  readonly records: readonly ExampleRecord[];
}

// ---------------------------------------------------------------------------
// OUTPUT
// ---------------------------------------------------------------------------

export interface ExampleBatchOutput {
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly totalAmount: Cents;
  /** Parallel to input, one RecordStatus per record. */
  readonly statuses: readonly RecordStatus[];
}

// ---------------------------------------------------------------------------
// TUNABLE CONSTANTS — normative
// ---------------------------------------------------------------------------

export const enum Limits {
  /** Inclusive upper bound on a single amount. */
  MAX_AMOUNT = 1_000_000,
}

// ---------------------------------------------------------------------------
// BUSINESS RULES — normative, ordered, exhaustive.
//
// Every rule is "key: prose". The KEY is a stable identifier: decision records
// point at it, and `singularity decisions` fails the build if a record points
// at a key that no longer exists. Renaming a key is therefore a tracked event,
// not a cosmetic edit.
// ---------------------------------------------------------------------------

export interface ExampleWorkflowIntent {
  input: ExampleBatchInput;
  output: ExampleBatchOutput;

  rules: [
    "traversal: records are processed in strict ascending index order",
    "validate.order: checks below run in the listed order; the first failure assigns the status and short-circuits",
    "validate.1_amount: amount <= 0 or amount > Limits.MAX_AMOUNT -> INVALID_AMOUNT",
    "validate.2_slot: slot >= table length -> UNKNOWN_SLOT",
    "accept: a record passing every check -> ACCEPTED; totalAmount += amount",
    "aggregate.counters: acceptedCount + rejectedCount === records.length",
    "aggregate.precision: running totals may exceed 2^31 and MUST live in a Float64 slot",
    "exec.soa: records live struct-of-arrays in one arena, allocated once",
    "exec.declared_layout: memory layout is declared via defineArena; byte offsets are never hand-computed",
    "exec.no_throw: the hot procedure never throws; every failure is a status code plus a counter",
    "exec.zero_alloc: no allocation occurs inside the traversal loop",
    "exec.reentrant: reset followed by an identical replay must produce byte-identical output"
  ];

  error_states: "InvalidAmount" | "UnknownSlot";
}
