# Error Triage Playbook

Order of attack for phase 2 typing failures:

1. `TS2307`, `TS7016`: missing declarations / import resolution
2. `TS7006`, `TS7031`: implicit `any`
3. `TS2339`, `TS2322`: shape mismatch / narrowing gap
4. `TS18046`: `unknown` catch variable not narrowed
5. declaration emit errors
6. schema drift between code, docs, and tooling

Do not patch around failures with `@ts-ignore`.

Prefer:

- stronger JSDoc
- local type guards
- shared `.d.ts` when the contract is reused
- schema updates for artifact envelopes
