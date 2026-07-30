---
id: 0004
title: Validation short-circuits in a fixed declared order
status: accepted
date: 2026-07-30
module: payment-processor
rules:
  - validate.order
  - validate.1_amount_positive
  - validate.2_amount_ceiling
  - validate.3_currency_known
  - validate.4_account_known
verified_by:
  - "validate.order: precedence is amount > ceiling > currency > account"
---

## Context

A single record can violate several rules at once — a negative amount, in an
unknown currency, for a nonexistent account. Something has to decide which
complaint the caller receives. Left unspecified, the answer is an accident of
statement order in the implementation, which means it can change under refactor
and cannot be tested.

## Decision

Checks run in a declared order and the first failure wins:

1. amount is positive
2. amount is within the ceiling
3. currency is known
4. account exists

Then the fee is computed, then the balance is checked. `UNKNOWN_ACCOUNT` therefore
outranks `INSUFFICIENT_FUNDS`, and a nonexistent account never reports a funds
problem.

Two independent reasons for this order. First, the cheapest and most selective
checks run first, which keeps the branch predictor on the happy path
(.cursorrules §1.3). Second, it reports the most fundamental defect: a negative
amount is a malformed request, while an unknown currency is a routing problem, and
telling the caller about the latter when the former is also true would be
misleading.

## Consequences

- Error responses are deterministic and testable for multi-violation records.
- Reordering the guard clauses in the exec unit is a behaviour change, not a
  refactor, even though it looks like one.
- A caller fixing one field at a time may see a sequence of different errors from
  the same record. That is intended, and worth documenting in any public API built
  on this module.

## Alternatives rejected

- **Return all violations.** More useful to an API client, but requires allocating
  a per-record collection, which violates the zero-allocation rule at the core of
  this framework. Reconsider only for a non-batch endpoint.
- **Cheapest-first purely on measured cost.** Nearly the same order in practice,
  but it makes the precedence an optimisation artefact rather than a contract.
