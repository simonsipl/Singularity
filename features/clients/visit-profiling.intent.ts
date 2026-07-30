// ============================================================================
// SINGULARITY INTENT CONTRACT
// feature: clients
// workflow: visit-profiling
// target: src/exec/visit-profiling.exec.js
//
// DECLARATIVE ONLY. No execution logic, no function bodies, no control flow.
//
// SCENARIO
// A salon-booking platform holds client cards and a history of appointments.
// Every night it needs to answer, for its whole client base at once: who is a
// regular, who is drifting away, who has lapsed, and who books and then does not
// turn up. This is a batch analytics pass over dense integer data — the shape
// Singularity is actually for. The platform's CRUD endpoints stay exactly as they
// are; only this nightly pass is compiled.
// ============================================================================

/** Integer minor units (cents). Never a float. See decisions/0001. */
export type Cents = number;

/** Whole days since an arbitrary fixed epoch. Never a timestamp, never a Date. */
export type DayNumber = number;

/** Dense index into the client table. Not a customer-facing id. */
export type ClientSlot = number;

/** Hundredths of a percent. 3000 bps === 30%. */
export type BasisPoints = number;

export const enum ClientStatus {
  PENDING = 0,
  ACTIVE = 1,
  INVALID_NAME = 2,
  INVALID_PHONE = 3,
  DUPLICATE_PHONE = 4,
  FUTURE_DATED = 5,
}

export const enum VisitStatus {
  PENDING = 0,
  /** Attended. Counts toward frequency and spend. */
  COUNTED = 1,
  UNKNOWN_CLIENT = 2,
  INACTIVE_CLIENT = 3,
  FUTURE_DATED = 4,
  NEGATIVE_SPEND = 5,
  /** Booked but not attended. Counts toward no-shows only. */
  NO_SHOW_RECORDED = 6,
  /** Spend above MAX_VISIT_SPEND. Distinct from NEGATIVE_SPEND so callers can
   *  tell a malformed amount from an implausibly large one. */
  SPEND_EXCEEDS_MAX = 7,
}

export const enum Segment {
  UNSEGMENTED = 0,
  NEVER_VISITED = 1,
  NEW = 2,
  REGULAR = 3,
  VIP = 4,
  AT_RISK = 5,
  LAPSED = 6,
}

export const enum ConsentFlag {
  /** Bit 0. Client agreed to marketing contact. */
  MARKETING = 1,
}

export const enum VisitFlag {
  /** Bit 0. Appointment was booked but the client did not attend. */
  NO_SHOW = 1,
}

export const enum RiskFlag {
  /** Bit 0. No-show rate above the configured threshold. */
  UNRELIABLE = 1,
}

// ---------------------------------------------------------------------------
// INPUT
// ---------------------------------------------------------------------------

/**
 * One client card, as submitted at creation time.
 *
 * COMPILER NOTE: describes semantics, NOT memory layout. Never materialise this
 * as an object. Realise it as struct-of-arrays over one arena.
 *
 * Names and phone numbers are deliberately absent. The profiler needs only their
 * *shape* (is the name non-empty, is the phone plausible) and an opaque hash for
 * de-duplication. Keeping PII out of the arena is a privacy property, not an
 * optimisation. See decisions/0011.
 */
export interface ClientCard {
  /** Opaque hash of the normalised phone number. Used only for equality. */
  readonly phoneHash: number;
  /** Character count of the trimmed display name. Zero means empty. */
  readonly nameLength: number;
  /** Digit count of the normalised phone number. */
  readonly phoneDigits: number;
  readonly createdDay: DayNumber;
  /** Bitfield of ConsentFlag. */
  readonly consentFlags: number;
}

/** One appointment in the client's history. */
export interface VisitRecord {
  readonly clientSlot: ClientSlot;
  readonly day: DayNumber;
  /** Amount actually spent. Zero is legal; negative is rejected. */
  readonly spend: Cents;
  /** Bitfield of VisitFlag. */
  readonly flags: number;
}

export interface ProfileBatchInput {
  readonly clients: readonly ClientCard[];
  readonly visits: readonly VisitRecord[];
  /** "Today" for the run. All recency arithmetic is relative to this. */
  readonly asOfDay: DayNumber;
}

// ---------------------------------------------------------------------------
// OUTPUT
// ---------------------------------------------------------------------------

/** Derived profile, one per client slot, parallel to the input. */
export interface ClientProfile {
  readonly status: ClientStatus;
  /** Attended visits only. Excludes no-shows. */
  readonly visitCount: number;
  readonly noShowCount: number;
  readonly totalSpend: Cents;
  readonly firstVisitDay: DayNumber;
  readonly lastVisitDay: DayNumber;
  /** Mean whole days between consecutive attended visits. 0 if fewer than 2. */
  readonly cadenceDays: number;
  readonly segment: Segment;
  /** Bitfield of RiskFlag. */
  readonly riskFlags: number;
}

export interface ProfileBatchOutput {
  readonly activeClients: number;
  readonly rejectedClients: number;
  readonly countedVisits: number;
  readonly noShowVisits: number;
  readonly rejectedVisits: number;
  readonly totalSpend: Cents;

  /** Population count per Segment member. */
  readonly segmentCounts: readonly number[];

  readonly profiles: readonly ClientProfile[];
  readonly visitStatuses: readonly VisitStatus[];
}

// ---------------------------------------------------------------------------
// TUNABLE CONSTANTS — normative
// ---------------------------------------------------------------------------

export const enum Limits {
  MIN_PHONE_DIGITS = 9,
  MAX_PHONE_DIGITS = 15,
  /** Inclusive ceiling on a single appointment. 10,000.00 */
  MAX_VISIT_SPEND = 1_000_000,
}

export const enum SegmentRule {
  /** Recency beyond this and the client is LAPSED regardless of history. */
  LAPSED_AFTER_DAYS = 365,
  /** VIP requires at least this many attended visits. */
  VIP_MIN_VISITS = 12,
  /** VIP also requires a visit within this many days. */
  VIP_MAX_RECENCY_DAYS = 60,
  /** REGULAR requires at least this many attended visits. */
  REGULAR_MIN_VISITS = 4,
  /** REGULAR also requires a visit within this many days. */
  REGULAR_MAX_RECENCY_DAYS = 120,
  /** Beyond this, a client who is neither VIP nor REGULAR is AT_RISK. */
  AT_RISK_AFTER_DAYS = 120,
}

export const enum RiskRule {
  /** No-show rate at or above this marks the client UNRELIABLE. 30% */
  UNRELIABLE_NO_SHOW_BPS = 3_000,
  /** Below this many booked appointments the rate is not meaningful. */
  MIN_BOOKINGS_FOR_RATE = 4,
}

// ---------------------------------------------------------------------------
// BUSINESS RULES — normative, ordered, exhaustive
// ---------------------------------------------------------------------------

export interface ClientProfilerIntent {
  input: ProfileBatchInput;
  output: ProfileBatchOutput;

  rules: [
    // -- P1. Pipeline shape -------------------------------------------------
    "pipeline.stages: three passes run in order — register clients, fold visits, then segment; each pass reads only what earlier passes wrote",
    "pipeline.replayable: reset followed by an identical replay must produce byte-identical output",

    // -- P2. Client card creation. FIRST failing check wins. ---------------
    "client.validate_order: checks are evaluated in the listed order; the first failure assigns the status and the card is not registered",
    "client.1_name_present: nameLength <= 0 -> INVALID_NAME",
    "client.2_phone_plausible: phoneDigits outside [MIN_PHONE_DIGITS, MAX_PHONE_DIGITS] -> INVALID_PHONE",
    "client.3_not_future: createdDay > asOfDay -> FUTURE_DATED",
    "client.4_phone_unique: a phoneHash already registered by an earlier slot -> DUPLICATE_PHONE; the earlier slot keeps the number",
    "client.accept: a card passing every check is ACTIVE and claims its phoneHash",
    "client.dedupe_first_wins: de-duplication is order-dependent by construction; the lowest slot index with a given phoneHash wins",

    // -- P3. Visit folding. FIRST failing check wins. ----------------------
    "visit.validate_order: checks are evaluated in the listed order; the first failure assigns the status and the visit contributes nothing",
    "visit.1_client_known: clientSlot >= clients.length -> UNKNOWN_CLIENT",
    "visit.2_client_active: the referenced client is not ACTIVE -> INACTIVE_CLIENT",
    "visit.3_not_future: day > asOfDay -> FUTURE_DATED",
    "visit.4_spend_negative: spend < 0 -> NEGATIVE_SPEND",
    "visit.4b_spend_over_max: spend > MAX_VISIT_SPEND -> SPEND_EXCEEDS_MAX; a separate status so callers can distinguish a malformed amount from an implausible one",
    "visit.5_no_show: VisitFlag.NO_SHOW set -> NO_SHOW_RECORDED; increments noShowCount only, contributes no spend and does not count as an attended visit",
    "visit.count: an otherwise valid attended visit -> COUNTED; increments visitCount and adds spend",
    "visit.recency_window: firstVisitDay is the minimum and lastVisitDay the maximum day over COUNTED visits only; both are 0 when visitCount is 0",
    "visit.order_independent: aggregates are commutative, so visits may arrive in any order within a batch",

    // -- P4. Derived cadence ----------------------------------------------
    "cadence.definition: cadenceDays = trunc((lastVisitDay - firstVisitDay) / (visitCount - 1)) when visitCount >= 2, else 0",
    "cadence.same_day: several attended visits on one day yield cadenceDays 0, which is legal and not an error",

    // -- P5. Segmentation. FIRST matching branch wins. ---------------------
    "segment.order: branches are evaluated in the listed order and the first match assigns the segment",
    "segment.1_never: visitCount == 0 -> NEVER_VISITED, regardless of no-shows",
    "segment.2_lapsed: recency > LAPSED_AFTER_DAYS -> LAPSED, regardless of visitCount",
    "segment.3_vip: visitCount >= VIP_MIN_VISITS and recency <= VIP_MAX_RECENCY_DAYS -> VIP",
    "segment.4_regular: visitCount >= REGULAR_MIN_VISITS and recency <= REGULAR_MAX_RECENCY_DAYS -> REGULAR",
    "segment.5_at_risk: recency > AT_RISK_AFTER_DAYS -> AT_RISK",
    "segment.6_new: anything remaining -> NEW",
    "segment.recency_definition: recency = asOfDay - lastVisitDay, and is never negative because future-dated visits are rejected",
    "segment.inactive_unsegmented: a client that is not ACTIVE keeps segment UNSEGMENTED and is excluded from every segment count",

    // -- P6. Reliability ---------------------------------------------------
    "risk.no_show_rate: rate = trunc(noShowCount * 10000 / (visitCount + noShowCount)) in basis points over BOOKED appointments",
    "risk.min_sample: the rate is only evaluated when (visitCount + noShowCount) >= MIN_BOOKINGS_FOR_RATE; below that riskFlags is 0",
    "risk.unreliable: rate >= UNRELIABLE_NO_SHOW_BPS -> RiskFlag.UNRELIABLE",
    "risk.orthogonal: riskFlags is independent of segment; a VIP may be flagged UNRELIABLE",

    // -- P7. Aggregation ---------------------------------------------------
    "aggregate.client_counts: activeClients + rejectedClients === clients.length",
    "aggregate.visit_counts: countedVisits + noShowVisits + rejectedVisits === visits.length",
    "aggregate.spend: totalSpend accumulates over COUNTED visits only and MUST be carried in a Float64 slot",
    "aggregate.segment_counts: the segment histogram sums to activeClients",

    // -- P8. Execution constraints (compiler-directed) --------------------
    "exec.soa: clients, visits and the de-duplication index live struct-of-arrays in one arena, allocated once",
    "exec.declared_layout: memory layout is declared via defineArena; byte offsets are never hand-computed",
    "exec.dedupe_open_addressing: phone de-duplication uses an open-addressed table with power-of-two capacity and bitwise masking, never a Map or object",
    "exec.no_throw: the hot procedures never throw; every failure is a status code plus a counter",
    "exec.zero_alloc: no allocation occurs inside any traversal loop",
    "exec.no_pii: the arena stores no names, phone numbers or free text — only lengths, counts and opaque hashes"
  ];

  error_states:
    | "InvalidName"
    | "InvalidPhone"
    | "DuplicatePhone"
    | "FutureDated"
    | "UnknownClient"
    | "InactiveClient"
    | "NegativeSpend"
    | "SpendExceedsMax";
}
