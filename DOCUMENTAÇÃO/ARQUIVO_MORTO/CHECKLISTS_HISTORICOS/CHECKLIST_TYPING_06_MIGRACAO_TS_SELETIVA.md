# CHECKLIST 06: Migracao Seletiva para TypeScript (Sem Big Bang)

Objetivo

- Converter para `.ts` somente onde TS entrega maior retorno (core, driver, contracts).
- Manter runtime estavel e minimizar mudancas de build.

Regra

- Migrar por “ilhas”:
  - criar um modulo TS
  - ajustar imports
  - deixar verde
  - repetir

Checklist (ordem recomendada)

1. Preparacao

- [ ] Confirmar que `npm run typecheck` ja esta verde em `strict`.
- [ ] Definir uma pasta alvo inicial (sugestao: `src/driver/core`).

2. Primeira ilha: Driver Core

- [ ] Migrar `src/driver/core/TargetDriver.js` -> `TargetDriver.ts`.
- [ ] Migrar `src/driver/core/BaseDriver.js` -> `BaseDriver.ts`.
- [ ] Ajustar exports/imports para NodeNext.
- [ ] Garantir que o modulo continua executando via Node (se ainda nao houver build, manter JS
      wrappers ou adiar runtime switch).

3. Segunda ilha: Schemas/Contracts

- [ ] Migrar schemas Zod para TS e exportar tipos inferidos.
- [ ] Remover duplicacao de tipos em `.d.ts` internos quando possivel.

4. Build (opcional)

- [ ] Criar `tsconfig.build.json` (emit para `dist/`).
- [ ] Ajustar `package.json` scripts para rodar `dist/`.
- [ ] Confirmar que o artefato roda no container e no host.

Definição de Pronto (DoD)

- Existem modulos `.ts` em areas criticas com testes passando.
- Tipos passam a ser derivados do codigo (menos `.d.ts` artificiais).

Riscos comuns

- ESM + NodeNext exige disciplina com extensoes e paths. Tratar isso como “contrato de runtime”, nao
  so de tipos.

---

Arquivo gerado automaticamente por solicitação. Não farei commit/push sem sua autorização.
