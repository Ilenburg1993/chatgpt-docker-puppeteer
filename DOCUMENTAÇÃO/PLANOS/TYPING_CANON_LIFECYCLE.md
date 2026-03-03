# Typing Canon Lifecycle

## Purpose

This document defines how typing and JSDoc governance documents are classified, updated, and
archived.

It exists to stop documentation drift and to keep one normative source of truth.

## Document Classes

### Normative reference

- Location: `DOCUMENTAÇÃO/REFERENCIA/**`
- Role: defines active rules and stable contracts
- Requirement: must remain current and internally consistent
- Example: `TYPING_JSDOC_CANON.md`

### Operational reference

- Location: `DOCUMENTAÇÃO/REFERENCIA/**`
- Role: indexes, matrices, or subsystem-specific references that operationalize the canon
- Requirement: may summarize, but must not contradict the canon

### Active plan

- Location: `DOCUMENTAÇÃO/PLANOS/**`
- Role: defines an active execution sequence, transition, or rollout
- Requirement: may guide work, but must defer normative rules to the canon

### Historical

- Location: `DOCUMENTAÇÃO/ARQUIVO_MORTO/**`
- Role: preserves traceability and prior state
- Requirement: must be explicitly non-normative

## Promotion and Demotion Rules

### Promote into `REFERENCIA`

Promote a document into `REFERENCIA` only when:

- it defines stable rules used repeatedly
- it is expected to outlive the current phase or plan
- it is a source of truth rather than a one-time execution note

### Keep in `PLANOS`

Keep a document in `PLANOS` when:

- it describes sequencing, rollout, or migration
- it is expected to change while work is still in flight
- it depends on open execution backlog

### Move to `ARQUIVO_MORTO`

Move a document into `ARQUIVO_MORTO` when:

- its execution window is closed
- a canonical replacement now exists
- it is still useful for traceability but no longer governs work

## Supersession Rules

When a document is superseded:

- the replacement must be linked at the top of the old document or from the local index
- the old document must be labeled as historical or non-normative
- no active rule may remain only in the superseded document

Do not silently leave two documents competing for the same rule.

## Delete vs Archive

Delete a document only when one of the following is true:

- it is an exact duplicate
- it is an empty placeholder
- it is a redirect that no longer serves compatibility

Archive instead of deleting when:

- the document captures prior decisions
- the document explains why a previous phase existed
- the document may still be needed for audits or traceability

## Update Bundle Rule

Any governance change to typing/JSDoc must update, together:

- the canon
- the matrix or automation index if affected
- the relevant skill or validator
- the affected workflow or CI script

If those updates are split, the change is incomplete.

## Ownership Rule

Every document should have one clear owner role:

- canon owner
- automation owner
- schema owner
- workflow owner
- historical archive owner

Role ownership is sufficient; named individuals are optional.

## Related Documents

- [`../REFERENCIA/TYPING_INDEX.md`](../REFERENCIA/TYPING_INDEX.md)
- [`../REFERENCIA/TYPING_JSDOC_CANON.md`](../REFERENCIA/TYPING_JSDOC_CANON.md)
