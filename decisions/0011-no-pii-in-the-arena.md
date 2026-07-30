---
id: 0011
title: The arena holds no personal data, only shapes and opaque hashes
status: accepted
date: 2026-07-30
module: client-profiler
rules:
  - exec.no_pii
verified_by:
  - "exec.no_pii: the arena declares no string or free-text field"
---

## Context

The profiler works on client cards. The obvious modelling puts the name and phone
number in the record, because that is what a client card *is*. But this arena is a
`SharedArrayBuffer`: it is designed to be handed to worker threads, it is long
lived, it is reused across batches, and it would appear in full in any heap dump
or core dump taken from the process.

Nothing in the profiler's actual job needs either field. It needs to know whether
a name is present, whether a phone number is plausible, and whether two clients
have the *same* number.

## Decision

The arena stores no names, phone numbers, email addresses or free text. It stores:

- `cliNameLength` — a character count, enough to answer "is the name empty"
- `cliPhoneDigits` — a digit count, enough to answer "is this plausible"
- `cliPhoneHash` — an opaque hash, enough to answer "are these the same"

Hashing and normalisation happen at the caller's boundary, outside the compiled
unit. The framework never sees the underlying values.

This is a privacy property first. It is also incidentally a performance property —
fixed-width integer fields are what make the SoA layout and the zero-allocation
traversal possible at all — but the ordering matters: it was chosen for the former
and the latter came free.

## Consequences

- A heap dump, core dump, or leaked arena exposes visit counts and opaque hashes,
  not a customer list. That materially changes the blast radius of a memory
  disclosure.
- The profiler cannot produce human-readable output. Joining a slot back to a
  person is the caller's job, using the slot index. Any report the salon actually
  reads is assembled outside the arena.
- The framework cannot validate hash quality or normalisation. If the caller
  hashes unnormalised input, `+44 7700 900123` and `07700900123` are different
  clients and de-duplication silently fails. This is a real weakness of the split
  and belongs in the caller's own test suite.
- Adding a name field later would be a one-line schema change with no test failure
  to stop it. The `exec.no_pii` check exists precisely to make that change fail
  loudly, by asserting on the declared field names.

## Alternatives rejected

- **Store names and phones as fixed-width byte ranges in the arena.** Keeps
  everything in one buffer and makes the arena a customer database with all the
  handling obligations that implies.
- **Store an encrypted phone number.** Key management inside a hot loop, and it
  still does not permit equality comparison without a deterministic scheme, which
  is a hash with extra steps.

## Notes

The test asserts on declared field names rather than on values, so it catches the
mistake at the point it is introduced — when someone adds `cliName` to the schema —
rather than when personal data eventually turns up in a dump.
