// ============================================================================
// SINGULARITY INTENT CONTRACT
// module: payment-processor
// target: src/exec/payment-processor.exec.js
//
// DECLARATIVE ONLY. No execution logic, no function bodies, no control flow.
// This file is the single source of truth the compiler reads. If a behaviour
// is not stated here, it is undefined and the compiler must refuse to invent it.
// ============================================================================

/** Integer minor units (cents). Never a float. */
export type Cents = number;

/** Hundredths of a percent. 250 bps === 2.50%. */
export type BasisPoints = number;

/** Dense index into the account balance table. Not an account *number*. */
export type AccountSlot = number;

export const enum Currency {
  USD = 0,
  EUR = 1,
  GBP = 2,
}

export const enum PaymentFlag {
  /** Bit 0. Priority settlement — carries a fee surcharge. */
  PRIORITY = 1,
}

export const enum PaymentStatus {
  PENDING = 0,
  SETTLED = 1,
  INVALID_AMOUNT = 2,
  AMOUNT_EXCEEDS_LIMIT = 3,
  UNSUPPORTED_CURRENCY = 4,
  UNKNOWN_ACCOUNT = 5,
  INSUFFICIENT_FUNDS = 6,
}

// ---------------------------------------------------------------------------
// INPUT
// ---------------------------------------------------------------------------

/**
 * The logical shape of one payment instruction.
 *
 * COMPILER NOTE: this interface describes semantics, NOT memory layout. The
 * generated exec MUST NOT materialise this as an object. It is realised as a
 * struct-of-arrays over a single SharedArrayBuffer arena.
 */
export interface PaymentRecord {
  /** Opaque correlation id. Carried through, never interpreted. */
  readonly id: number;
  readonly accountSlot: AccountSlot;
  readonly amount: Cents;
  readonly currency: Currency;
  /** Bitfield of PaymentFlag. */
  readonly flags: number;
}

export interface PaymentBatchInput {
  readonly records: readonly PaymentRecord[];
  /**
   * Available balance per account slot, indexed densely from 0.
   * MUTATED IN PLACE as payments settle. The caller owns this memory and is
   * responsible for snapshotting it if a rollback is required.
   */
  readonly balances: readonly Cents[];
}

// ---------------------------------------------------------------------------
// OUTPUT
// ---------------------------------------------------------------------------

export interface PaymentBatchOutput {
  readonly settledCount: number;
  readonly rejectedCount: number;
  /** Sum of `amount` over settled records only. Excludes fees. */
  readonly totalSettledAmount: Cents;
  /** Sum of `fee` over settled records only. */
  readonly totalFees: Cents;

  /** Rejection tally, one counter per non-SETTLED status. */
  readonly rejectedInvalidAmount: number;
  readonly rejectedAmountExceedsLimit: number;
  readonly rejectedUnsupportedCurrency: number;
  readonly rejectedUnknownAccount: number;
  readonly rejectedInsufficientFunds: number;

  /** Parallel to input, one PaymentStatus per record. */
  readonly statuses: readonly PaymentStatus[];
  /**
   * Parallel to input. The fee that WAS charged (SETTLED) or WOULD HAVE BEEN
   * charged (INSUFFICIENT_FUNDS). Exactly 0 for every status rejected before
   * the fee stage.
   */
  readonly fees: readonly Cents[];
}

// ---------------------------------------------------------------------------
// TUNABLE CONSTANTS — normative
// ---------------------------------------------------------------------------

export const enum Limits {
  /** Inclusive upper bound on a single payment. 500_000.00 */
  MAX_PAYMENT_AMOUNT = 50_000_000,
  /** Inclusive upper bound on the fee for any single payment. 50.00 */
  MAX_FEE = 5_000,
  /** Inclusive lower bound on the fee for any payment that reaches the fee stage. */
  MIN_FEE = 30,
  /** Highest valid Currency member. */
  MAX_CURRENCY_CODE = 2,
}

/**
 * Fee tier table. Selected by the FIRST row whose `amountBelow` strictly
 * exceeds the payment amount. The final row is the catch-all.
 */
export const enum FeeTier {
  T0_AMOUNT_BELOW = 10_000,
  T0_BPS = 290,
  T0_FLAT = 30,

  T1_AMOUNT_BELOW = 100_000,
  T1_BPS = 250,
  T1_FLAT = 25,

  T2_AMOUNT_BELOW = 1_000_000,
  T2_BPS = 190,
  T2_FLAT = 20,

  T3_BPS = 120,
  T3_FLAT = 0,
}

export const enum Surcharge {
  /** Applied to `amount` when currency !== USD. */
  FX_BPS = 15,
  /**
   * Applied to the fee accumulated so far when PRIORITY is set.
   * 5000 bps === +50%, truncating.
   */
  PRIORITY_BPS = 5_000,
}

// ---------------------------------------------------------------------------
// BUSINESS RULES — normative, ordered, exhaustive
// ---------------------------------------------------------------------------

export interface PaymentProcessorIntent {
  input: PaymentBatchInput;
  output: PaymentBatchOutput;

  rules: [
    // -- R1. Batch traversal ------------------------------------------------
    "traversal: records are processed in strict ascending index order; balance mutations from record i are visible to record i+1",

    // -- R2. Validation gate. FIRST failing check wins and short-circuits. ---
    "validate.order: the checks below are evaluated in the listed order; the first failure assigns the status and terminates processing for that record",
    "validate.1_amount_positive: amount <= 0 -> INVALID_AMOUNT, fee = 0",
    "validate.2_amount_ceiling: amount > Limits.MAX_PAYMENT_AMOUNT -> AMOUNT_EXCEEDS_LIMIT, fee = 0 (amount == MAX is valid)",
    "validate.3_currency_known: currency > Limits.MAX_CURRENCY_CODE -> UNSUPPORTED_CURRENCY, fee = 0",
    "validate.4_account_known: accountSlot >= balances.length -> UNKNOWN_ACCOUNT, fee = 0",

    // -- R3. Fee computation. Integer-only, truncating, strictly ordered. ---
    "fee.order: stages are applied in the listed sequence; each stage consumes the truncated integer output of the previous",
    "fee.1_tier: fee = trunc(amount * tierBps / 10000) + tierFlat, tier selected per FeeTier table",
    "fee.2_fx: if currency !== Currency.USD then fee += trunc(amount * Surcharge.FX_BPS / 10000)",
    "fee.3_priority: if (flags & PaymentFlag.PRIORITY) then fee += trunc(fee * Surcharge.PRIORITY_BPS / 10000)",
    "fee.4_ceiling: if fee > Limits.MAX_FEE then fee = Limits.MAX_FEE",
    "fee.5_floor: else if fee < Limits.MIN_FEE then fee = Limits.MIN_FEE",
    "fee.rounding: every division truncates toward zero; all operands are non-negative so this is equivalent to floor",

    // -- R4. Balance check --------------------------------------------------
    "balance.debit_total: the amount debited is (amount + fee); the fee is never debited separately",
    "balance.check: if balances[accountSlot] < (amount + fee) -> INSUFFICIENT_FUNDS",
    "balance.check_boundary: balances[accountSlot] == (amount + fee) settles successfully and leaves a zero balance",
    "balance.reject_records_fee: an INSUFFICIENT_FUNDS record reports its computed fee in output.fees but debits nothing",
    "balance.settle: on success balances[accountSlot] -= (amount + fee) and status = SETTLED",
    "balance.no_overdraft: a balance is never permitted to go negative under any rule",

    // -- R5. Aggregation ----------------------------------------------------
    "aggregate.totals_settled_only: totalSettledAmount and totalFees accumulate over SETTLED records only",
    "aggregate.counters: exactly one counter is incremented per record; settledCount + rejectedCount === records.length",
    "aggregate.precision: running totals may exceed 2^31 and MUST be carried in a Float64 slot, exact to 2^53",

    // -- R6. Execution constraints (compiler-directed) ---------------------
    "exec.soa: records are stored struct-of-arrays inside one SharedArrayBuffer arena, allocated once",
    "exec.no_throw: the hot procedure never throws; every failure is a status code plus a counter",
    "exec.reentrant: reset() followed by an identical replay must produce byte-identical output",
    "exec.zero_alloc: no allocation occurs inside the traversal loop"
  ];

  error_states:
    | "InvalidAmount"
    | "AmountExceedsLimit"
    | "UnsupportedCurrency"
    | "UnknownAccount"
    | "InsufficientFunds";
}
