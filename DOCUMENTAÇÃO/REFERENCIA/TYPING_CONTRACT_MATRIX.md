# Typing Contract Matrix

This matrix maps each canonical typing/JSDoc surface to its contract, validator, CI gate, and owner
role.

| Surface                         | Consumer                             | Canonical Contract                                    | Source File                                                                                       | Validator                                                 | CI Gate                                                       | Owner                       |
| ------------------------------- | ------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- | --------------------------- |
| Public JSDoc in JS modules      | Developers, `tsc`, IDE tooling       | TypeScript-supported JSDoc plus `// @ts-check`        | Owning `.js/.mjs/.cjs` file                                                                       | `jsdoc_coverage_cli.mjs`, `tsc`                           | `jsdoc:coverage:json`, `jsdoc:coverage:public`, `typecheck:*` | Static contract maintainers |
| Shared type declarations        | Multiple modules, declaration emit   | `.d.ts` in `src/types/**`                             | `src/types/**/*.d.ts`                                                                             | `tsc -p tsconfig.declarations.json`                       | `typecheck:declarations`                                      | Shared contract maintainers |
| JSDoc coverage report           | CI, audits, maintainers              | JSON Schema Draft 2020-12                             | `schemas/typing/jsdoc-coverage-report.schema.json`                                                | `jsdoc_coverage_cli.mjs --validate-schema`                | `jsdoc:coverage:json`, `check:schemas:typing`                 | Report producer maintainers |
| Aggregate typing audit          | CI, maintainers                      | Structured audit JSON plus console contract           | `scripts/analysis/typing/typing_hardening_audit.mjs`                                              | Script self-validation plus strict thresholds             | `analyze:typing`, `analyze:typing:public`                     | Typing audit maintainers    |
| Local tsserver wrapper envelope | LSP tooling, MCP-facing adapter code | Wrapper JSON Schema plus `ts.server.protocol` mapping | `schemas/typing/tsserver-tool-contract.schema.json` and `src/integration/lsp/tsserver-daemon.mjs` | `scripts/analysis/typing/tsserver_contract_audit.mjs`     | `analyze:tsserver-contract`, `check:schemas:typing`           | LSP wrapper maintainers     |
| Declaration emit public surface | Public JS-first APIs                 | Inferred `.d.ts` output contract                      | `tsconfig.declarations.json`                                                                      | `tsc` declaration emit                                    | `typecheck:declarations`                                      | Public API maintainers      |
| Strict public lane              | Public contract anchors              | Strict `tsc` lane                                     | `config/typing/strict/tsconfig.strict.public.json`                                                | `tsc -p config/typing/strict/tsconfig.strict.public.json` | `typecheck:strict:public`, `typecheck:strict:all`             | Strict lane maintainers     |
| Strict workspace lanes          | Maintainers, CI                      | Strict solution refs                                  | `tsconfig.strict.json` and `config/typing/strict/tsconfig.strict.*.json`                          | `tsc` per lane                                            | `typecheck:strict:all`                                        | Strict lane maintainers     |
| Skill governance                | Human and agent execution            | Canonical skill docs in `.github/skills/**`           | `.github/skills/**`                                                                               | `verify-skills-governance.mjs`                            | `check:skills:strict`                                         | Skill maintainers           |
| Typing workflow gate            | CI                                   | Ordered workflow contract                             | `.github/workflows/jsdoc-typing.yml`                                                              | `verify-github-workflows.mjs` plus workflow execution     | Blocking GitHub workflow                                      | CI maintainers              |

## Reading Rules

- If the surface is code and local, start with JSDoc.
- If the contract is reused, promote to `.d.ts`.
- If the artifact is JSON, read the schema first.
- If the surface is the LSP wrapper, read both the local schema and the `ts.server.protocol`
  mapping.
- If the question is "who enforces this", use the validator and CI columns before reading legacy
  plans.

## Related Documents

- [`TYPING_JSDOC_CANON.md`](./TYPING_JSDOC_CANON.md)
- [`TYPING_AUTOMATION_INDEX.md`](./TYPING_AUTOMATION_INDEX.md)
