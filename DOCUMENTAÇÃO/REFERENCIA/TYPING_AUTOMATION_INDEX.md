# Typing Automation Index

This index defines the canonical automation surface for typing, JSDoc, schema, and governance.

## Supported Commands

| Command                     | Class            | Primary Entry Point                                                 | Input                                | Output                                               | Schema                                              | Contract Status |
| --------------------------- | ---------------- | ------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------- | --------------------------------------------------- | --------------- |
| `typecheck:repo`            | gate             | `package.json` -> `tsc` configs                                     | Repository source tree               | Exit code only                                       | n/a                                                 | Canonical       |
| `typecheck:strict:public`   | gate             | `config/typing/strict/tsconfig.strict.public.json`                  | Public-contract lane files           | Exit code only                                       | n/a                                                 | Canonical       |
| `typecheck:strict:all`      | gate             | `package.json` strict chain                                         | Strict lane set                      | Exit code only                                       | n/a                                                 | Canonical       |
| `typecheck:declarations`    | gate             | `tsconfig.declarations.json`                                        | Public JS-first surfaces             | Emitted `.d.ts` in `tmp/types-public` plus exit code | n/a                                                 | Canonical       |
| `jsdoc:coverage:json`       | report           | `scripts/analysis/jsdoc_coverage_cli.mjs`                           | JS source files                      | JSON report                                          | `schemas/typing/jsdoc-coverage-report.schema.json`  | Canonical       |
| `jsdoc:coverage:public`     | report           | `scripts/analysis/jsdoc_coverage_cli.mjs --roots ...`               | Public-scope JS source files         | Console report                                       | Derived from JSDoc report schema                    | Canonical       |
| `analyze:typing`            | audit            | `scripts/analysis/typing/typing_hardening_audit.mjs`                | Source tree plus strict configs      | Console audit                                        | Internal structured JSON in `--format json` mode    | Canonical       |
| `analyze:typing:public`     | audit            | `scripts/analysis/typing/typing_hardening_audit.mjs --scope public` | Public-scope files                   | Console audit                                        | Internal structured JSON in `--format json` mode    | Canonical       |
| `analyze:tsserver-contract` | drift-check      | `scripts/analysis/typing/tsserver_contract_audit.mjs`               | Daemon, schema, skill docs           | Console audit plus exit code                         | `schemas/typing/tsserver-tool-contract.schema.json` | Canonical       |
| `check:schemas:typing`      | governance check | `package.json` schema validation chain                              | Schema files and report outputs      | Exit code plus validation logs                       | `schemas/typing/**`                                 | Canonical       |
| `check:skills:strict`       | governance check | `scripts/ci/verify-skills-governance.mjs --strict`                  | Canonical skills plus `.codex` stubs | Exit code plus validation logs                       | n/a                                                 | Canonical       |

## Classification Rules

- Gate: blocks CI directly.
- Report: produces a user-facing or CI-facing measurement output.
- Audit: aggregates policy and quality signals.
- Drift-check: compares multiple sources of truth to catch divergence.
- Governance check: validates the structure of the canon itself.

## Rules for New Automation

A new typing/JSDoc automation entry becomes canonical only if:

- it does not duplicate an existing command
- it has one clear consumer
- its input and output are documented
- its schema relationship is explicit when JSON is involved
- it is linked from this index

If one of those conditions is missing, the script remains auxiliary and non-canonical.

## Related Documents

- [`TYPING_JSDOC_CANON.md`](./TYPING_JSDOC_CANON.md)
- [`TYPING_CONTRACT_MATRIX.md`](./TYPING_CONTRACT_MATRIX.md)
