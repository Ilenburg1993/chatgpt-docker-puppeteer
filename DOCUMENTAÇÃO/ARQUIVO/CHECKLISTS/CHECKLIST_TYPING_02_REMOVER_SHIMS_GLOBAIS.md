# CHECKLIST 02: Remover Shims Globais (Tipos Oficiais das Libs)

Objetivo

- Parar de “inventar” tipos de bibliotecas que ja tem tipagem real.
- Trocar muletas por contratos oficiais (Zod v4, Puppeteer v24, etc).

Checklist

- [ ] Auditar `src/types/global.d.ts`.
- [ ] Remover `declare module 'zod'` do `src/types/global.d.ts`.
- [ ] Remover `declare module 'puppeteer'` do `src/types/global.d.ts`.
- [ ] Remover `declare module 'puppeteer-extra'` do `src/types/global.d.ts`.
- [ ] Reavaliar `@types/puppeteer` (normalmente remover, pois conflita com puppeteer moderno).
- [ ] Rodar `npm run typecheck` e corrigir os erros reais que aparecerem.

Notas de implementacao

- [ ] Manter apenas extensoes globais legitimas (ex.: `interface Error { code?: ... }`).
- [ ] Onde o codigo usa `unknown` vindo de JSON, tipar via:
  - [ ] schema Zod + inferencia (se em TS)
  - [ ] JSDoc typedef local (se em JS)
  - [ ] casts locais pequenos e justificados (ultimo recurso)

Definição de Pronto (DoD)

- `npm run typecheck` verde usando tipos oficiais.
- Nao existe mais “module declaration fake” para libs que ja exportam tipos.

Riscos comuns

- Esse passo pode revelar bugs e mismatches reais (bom sinal). A meta e corrigir, nao reintroduzir
  shim.

---

Arquivo gerado automaticamente por solicitação. Não farei commit/push sem sua autorização.
