# CHECKLIST 04: Strictness Ramp (De “Passa” para “Profissional”)

Objetivo

- Subir o nivel de rigor aos poucos, evitando um tsunami de erros.

Regra

- Ativar uma flag por vez.
- Corrigir e voltar a verde antes da proxima.

Checklist (ordem recomendada)

1. `strictNullChecks`

- [ ] Ativar `strictNullChecks: true` no `tsconfig.typecheck.json`.
- [ ] Corrigir `null | undefined` em fronteiras:
  - [ ] env vars
  - [ ] JSON parse
  - [ ] requests/responses
  - [ ] eventos Socket.io
- [ ] `npm run typecheck` verde.

2. `noImplicitAny`

- [ ] Ativar `noImplicitAny: true`.
- [ ] Eliminar `any` implicito em:
  - [ ] handlers Express (req/res/next)
  - [ ] callbacks (map/filter/reduce) com dados desconhecidos
  - [ ] eventos (EventEmitter)
- [ ] `npm run typecheck` verde.

3. `strict` (se ainda nao estiver)

- [ ] Ativar `strict: true`.
- [ ] Resolver os erros novos (tipicamente `noImplicitThis`, `useUnknownInCatchVariables`, etc).
- [ ] `npm run typecheck` verde.

4. Flags avancadas (opcionais, mas “pro”)

- [ ] `exactOptionalPropertyTypes: true`
- [ ] `noUncheckedIndexedAccess: true`
- [ ] `useUnknownInCatchVariables: true`

Definição de Pronto (DoD)

- `tsconfig.typecheck.json` esta em `strict` (ou equivalente via flags) e verde.
- Nao existem “buracos” grandes resolvidos com shim global ou `any` estrutural.

Riscos comuns

- Ativar `noUncheckedIndexedAccess` cedo demais pode gerar muito ruido. Use quando o core ja estiver
  bem tipado.

---

Arquivo gerado automaticamente por solicitação. Não farei commit/push sem sua autorização.
