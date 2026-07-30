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

## Known gaps

- Fee bounds are compile-time constants. Per-tenant fee tables would need startup
  validation that `MIN <= MAX`, which does not exist ([0007](decisions/0007-fee-clamp-order.md)).
- Declined payments report a fee they were not charged. Intentional, and a real
  footgun for anyone summing the fees array
  ([0003](decisions/0003-insufficient-funds-reports-fee.md)).
