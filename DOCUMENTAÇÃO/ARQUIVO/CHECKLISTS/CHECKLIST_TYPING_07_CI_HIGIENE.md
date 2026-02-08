# CHECKLIST 07: CI + Higiene (Nao Regressao)

Objetivo
- Garantir que tipagem nao regrida.
- Transformar typecheck em requisito automatico.

Checklist
- [ ] Adicionar `npm run typecheck` ao script `npm run check`/`validate:all`.
- [ ] Em CI (GitHub Actions / pipeline atual): rodar na ordem:
  - [ ] `npm ci`
  - [ ] `npm run lint:quiet`
  - [ ] `npm run typecheck`
  - [ ] `npm test`
- [ ] (Opcional) pre-commit:
  - [ ] `lint-staged` ou hooks (somente se o time aceitar)

Metricas e observabilidade
- [ ] Criar um “budget” de tipagem:
  - [ ] proibido adicionar novos `@ts-nocheck`
  - [ ] proibido adicionar novos `declare module 'X'` para libs tipadas
  - [ ] reduzir `any` com meta numerica (ex.: -20% por sprint)

Definição de Pronto (DoD)
- PR nao mergeia se `typecheck` falhar.
- Existe politica clara para excecoes (rare + justificadas).

---
Arquivo gerado automaticamente por solicitação. Não farei commit/push sem sua autorização.
