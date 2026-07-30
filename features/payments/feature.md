# Payments

Money movement. Taking what a client owes, calculating the platform's cut, and
keeping account balances correct.

## Workflows

| Workflow | What it does | Status |
|---|---|---|
| [`bulk-settlement`](bulk-settlement.intent.ts) | Settle a batch of payments: validate, price, check funds, debit | shipped |

## bulk-settlement

Processes a batch of payment instructions in one pass. For each: validate the
amount and currency, compute the platform fee from a tiered table, check the
account has enough, then debit `amount + fee` or reject with a reason.

Balances mutate in order, so a payment sees the effect of every payment before it
in the same batch. That is deliberate and load-bearing.

- Contract: [`bulk-settlement.intent.ts`](bulk-settlement.intent.ts) — 26 rules
- Verification: [`bulk-settlement.assert.js`](bulk-settlement.assert.js) — 33 checks
- Compiled to: `src/exec/bulk-settlement.exec.js` *(generated — do not read or edit)*

## Read before changing anything here

Three decisions are easy to break by accident because the code that implements
them looks like ordinary independent statements:

- **[0002](decisions/0002-fee-stage-ordering.md) — FX applies before priority.**
  Four conditionals that look independent and are not. Worth 38 cents on a
  50,000-cent EUR priority payment. Reordering them is a billing change.
- **[0004](decisions/0004-validation-precedence.md) — validation order is a
  contract.** A record can break several rules at once; which error it reports is
  declared, not incidental.
- **[0007](decisions/0007-fee-clamp-order.md) — ceiling before floor.** The
  `else` is what keeps the fee inside its envelope.

## All decisions

| id | title |
|---|---|
| [0001](decisions/0001-money-as-integer-minor-units.md) | Money is integer minor units, never a float |
| [0002](decisions/0002-fee-stage-ordering.md) | FX surcharge applies before the priority surcharge |
| [0003](decisions/0003-insufficient-funds-reports-fee.md) | A rejected-for-funds payment reports its fee but is not charged |
| [0004](decisions/0004-validation-precedence.md) | Validation short-circuits in a fixed declared order |
| [0005](decisions/0005-status-codes-not-exceptions.md) | The hot procedure never throws; failures are status codes |
| [0007](decisions/0007-fee-clamp-order.md) | The fee ceiling is applied before the floor |
| [0014](decisions/0014-shard-by-account.md) | Parallel execution shards by account, not by index range |

## Parallel execution

`processBatchShard` + `bulk-settlement.worker.js` run the batch across
`worker_threads` over one zero-copy arena, sharding by account so no two workers
touch the same balance. Output is byte-identical to sequential for any shard
count, asserted through real threads.

Measured on 24 logical cores: **1.04x at 2 workers, 1.50x at 4, 2.06x at 8** —
sublinear by construction, because every shard scans the whole batch to find its
records. Spawn costs 24–37 ms against a 15 ms batch, so this is only ever worth
it for a long-lived pool. Read [0014](decisions/0014-shard-by-account.md) before
adopting it; the ceiling and the skew risk are documented there.

```bash
node tests/benchmark-parallel.js
```

## Known gaps

- `resetLedger` cost is O(arena capacity), not O(batch): at 10,000 records in a
  1,000,000-slot arena the exec loses to a plain loop (0.67x, see
  `tests/benchmark-matrix.js`). Size the arena to the workload.
- Fee bounds are compile-time constants, and the module now refuses to load if
  `MIN_FEE > MAX_FEE` ([0007](decisions/0007-fee-clamp-order.md)). When fee tables
  become per-tenant configuration, that guard must move to the loader.
- Declined payments report a fee they were not charged. Intentional, and a real
  footgun for anyone summing the fees array
  ([0003](decisions/0003-insufficient-funds-reports-fee.md)).
