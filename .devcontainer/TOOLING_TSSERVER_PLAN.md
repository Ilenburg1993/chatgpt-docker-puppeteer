# TypeScript 7 e serviço de linguagem — arquitetura canônica

**Estado:** executado em 19 de agosto de 2026
**Regra central:** TypeScript 7 nativo é o único compilador e serviço de linguagem canônico.

## Fluxo normal

- O DevContainer instala `typescript@7.0.2` globalmente.
- O workspace instala `@typescript/native` e chama sua entrada por
  `scripts/ci/run-typescript-7.mjs`; os gates não dependem do symlink concorrente `.bin/tsc`.
- O VS Code usa `TypeScriptTeam.native-preview` com `js/ts.experimental.useTsgo=true`.
- O servidor de linguagem é o próprio `tsc --lsp --stdio`.
- `typescript-language-server` não é instalado.

## Compatibilidade TS6

O pacote raiz `typescript` permanece em TS6 somente enquanto `typescript-eslint` não suportar TS7.
A API estável também é reutilizada por analisadores AST offline através do único ponto
`scripts/analysis/typescript-compat.mjs`, porque as APIs equivalentes do pacote nativo ainda são
marcadas como `unstable/*`. Essa compatibilidade não seleciona compilador, editor ou servidor.

## Wrapper MCP local preservado

O wrapper histórico não foi removido, mas deixou de participar do fluxo normal:

- implementação: `src/integration/lsp/tsgo-lsp-daemon.mjs`;
- transporte: JSON-RPC para o LSP nativo TS7;
- isolamento: worker descartável e TTL curto;
- aliases `Tsserver*`: compatibilidade temporária de API;
- defaults obrigatórios: `LSP_ENABLED=false` e `LSP_MUTATIONS_ENABLED=false`;
- PM2, DevContainer, health checks e Audit Agent respeitam o estado desligado;
- apenas `LSP_ENABLED=true` explícito no processo isolado permite inicialização.

Quando desligado, `npm run lsp:health -- --json` retorna `disabled-by-policy` com sucesso, sem
acessar HTTP/MCP nem iniciar subprocessos.

## Gates de manutenção

```bash
npm run -s tsc7 -- --version
npm run analyze:tsserver-contract
npm run check:ts7-strict-coverage
npm run typecheck:strict:all
node --test tests/unit/lsp tests/unit/health/test_diagnose_lsp_policy.spec.js
```

O wrapper pode ser removido em uma decisão futura. Até lá, qualquer mudança deve preservar a
política opt-in e não reintroduzir TS6 no runtime semântico.
