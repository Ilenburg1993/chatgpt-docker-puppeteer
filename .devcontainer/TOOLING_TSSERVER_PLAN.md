# TypeScript 7 e serviço de linguagem — arquitetura canônica

**Estado:** atualizado em 20 de agosto de 2026.  
**Regra central:** TypeScript 7 GA é o único compilador, autoridade semântica e servidor de
linguagem canônico do workspace.

## Fluxo normal

- `typescript@7.0.2` é uma versão GA; não usamos um compilador preview.
- O workspace instala o pacote oficial por meio do alias `@typescript/native -> typescript@7.0.2` e
  todos os gates chamam `scripts/ci/run-typescript-7.mjs`.
- O DevContainer instala TypeScript 7 globalmente para CLI operacional; um `tsserver` global legado
  após rebuild continua sendo resíduo indesejado.
- O servidor de linguagem é o mesmo engine nativo TypeScript 7 executado como `tsc --lsp --stdio`.
- `typescript-language-server` não é instalado e não existe um daemon Node intermediário no fluxo
  normal.

## Por que ainda existe `TypeScriptTeam.native-preview`

O nome é um **ID histórico do cliente de VS Code**, não o status do compilador.

No VS Code 1.134.0 usado atualmente pelo workspace, o builtin `vscode.typescript-language-features`
ainda implementa o protocolo legado `tsserver.js`. Quando `js/ts.experimental.useTsgo=true`, esse
builtin cede as features JS/TS para o cliente LSP externo. A extensão oficial
`TypeScriptTeam.native-preview` instalada no DevContainer:

1. fornece o cliente LSP que o VS Code ainda não incorporou ao builtin;
2. executa `tsc --lsp --stdio`;
3. atualmente carrega TypeScript **7.0.2**, exatamente a versão canônica do workspace.

Portanto, a extensão externa é uma **ponte de integração temporária**. Ela deve ser removida do
perfil `foundation` assim que a versão de VS Code adotada pelo workspace trouxer o mesmo cliente
nativamente. A remoção futura do cliente externo não altera a decisão arquitetural de usar
TypeScript 7.

O auditor `npm run analyze:typescript:lsp:verify` não depende mais do ID histórico: identifica
qualquer `tsc/tsgo --lsp`, compara a versão efetivamente executada com
`node_modules/@typescript/native` e verifica projeto, `GOMEMLIMIT`, watchers e o typecheck CLI
equivalente.

## Compatibilidade TS6

O pacote raiz `typescript` permanece temporariamente como alias para `@typescript/typescript6@6.0.2`
**somente** porque o `typescript-eslint@8.67.0` corrente ainda declara peer
`typescript >=4.8.4 <6.1.0`.

Essa ilha não seleciona compilador, CI, editor ou language server. Ferramentas internas próprias não
importam mais `scripts/analysis/typescript-compat.mjs`; esse adaptador foi retirado. Análise
sintática leve usa Babel 8 e análise semântica/projetual usa as APIs nativas do TypeScript 7.

O gate `npm run check:typescript-baseline` deve continuar detectando quando o peer upstream passar a
aceitar TS7, momento em que o alias TS6 deixa de ter justificativa e deve ser removido.

## Wrapper MCP local preservado

O wrapper histórico não participa do fluxo normal:

- implementação: `src/integration/lsp/tsgo-lsp-daemon.mjs`;
- transporte: JSON-RPC para o LSP nativo TS7;
- isolamento: worker descartável e TTL curto;
- aliases `Tsserver*`: compatibilidade temporária de API;
- defaults obrigatórios: `LSP_ENABLED=false` e `LSP_MUTATIONS_ENABLED=false`;
- PM2, DevContainer, health checks e Audit Agent respeitam o estado desligado;
- apenas `LSP_ENABLED=true` explícito no processo isolado permite inicialização.

Quando desligado, `npm run lsp:health -- --json` retorna `disabled-by-policy` com sucesso, sem
iniciar subprocessos.

## Gates de manutenção

```bash
npm run -s tsc7 -- --version
npm run check:typescript-baseline
npm run analyze:typescript:lsp:verify
npm run analyze:tsserver-contract
npm run check:ts7-strict-coverage
npm run typecheck:strict:all
npm run vscode:sync:check
npm run vscode:check
```

Qualquer mudança futura deve preservar três fatos separadamente: **TS7 GA é o engine**, **TS6 é
apenas compatibilidade upstream**, e **o cliente externo de ID histórico só existe enquanto o VS
Code builtin não falar com o LSP nativo diretamente**.
