# TypeScript 7 e serviço de linguagem — arquitetura canônica

**Estado:** atualizado em 28 de agosto de 2026.
**Regra central:** TypeScript 7 GA é o único compilador, autoridade semântica e servidor de linguagem canônico do workspace. Não existe compatibility island TS6.

## Fluxo normal

- `typescript@7.0.2` é instalado diretamente na raiz e é a **única identidade TypeScript local**.
- Todos os gates de compilação chamam `scripts/ci/run-typescript-7.mjs`, que resolve explicitamente `typescript/package.json`; PATH/global installs não selecionam o compiler.
- O DevContainer instala TypeScript 7 globalmente apenas para CLI operacional; um `tsserver` global de geração anterior após rebuild é resíduo e deve ser tratado como falha de baseline.
- APIs first-party que necessitam da API nativa usam `typescript/unstable/sync` ou outro export `typescript/unstable/*` da mesma instalação TS7.
- O servidor de linguagem suportado continua sendo o engine TypeScript 7 executado como `tsc --lsp --stdio`.
- `typescript-language-server` não é instalado e não existe daemon Node intermediário no fluxo normal.

## Lint: separação explícita de responsabilidades

O workspace não instala mais `typescript-eslint` nem mantém um compiler TS6 para satisfazer peer ranges antigos.

A governança atual é:

1. **ESLint 10** — parsing JavaScript/ESM, estilo e regras arquiteturais/restricted-imports; não constrói Project Service TypeScript;
2. **Oxlint + oxlint-tsgolint 7** — lane type-aware TS7, executando somente os checks semânticos selecionados em `.oxlintrc.json`;
3. **TypeScript 7** — typecheck/compilação e autoridade semântica do projeto.

O lane type-aware preserva a policy histórica de promise safety:

- `typescript/no-floating-promises`;
- `typescript/await-thenable`;
- `typescript/no-misused-promises` com `checksVoidReturn: false`.

`lint:copilot:changed` também executa esse lane sobre arquivos alterados de `src/copilot`, enquanto testes continuam no perfil ESLint relaxado.

## Dependency graph e rebuild

- `.npmrc` mantém `legacy-peer-deps=false`; conflitos de peer devem aparecer no install/CI em vez de serem mascarados.
- `npm ci --dry-run --ignore-scripts` deve fechar sem incompatibilidades.
- `scripts/ci/check-typescript-baseline.mjs` falha se qualquer compiler TypeScript abaixo de major 7, alias `@typescript/native`, alias `@typescript/typescript6`, `typescript-eslint`, `tsc6` ou `legacy-peer-deps=true` reaparecer.
- Madge permanece aposentado; o grafo canônico first-party continua Babel/Node + Tarjan.

## Por que ainda existe `TypeScriptTeam.native-preview`

O nome é um **ID histórico do cliente de VS Code**, não o status do compilador.

No VS Code adotado pelo workspace, o builtin pode continuar oferecendo o protocolo legado `tsserver.js`. Quando `js/ts.experimental.useTsgo=true`, as features JS/TS são entregues ao cliente LSP que executa `tsc --lsp --stdio` sobre o TypeScript 7 do ambiente.

Essa extensão externa é uma ponte de integração e deve sair do baseline quando o VS Code incorporá-la de forma equivalente. Isso não altera a decisão arquitetural TS7-only.

## Wrapper local preservado, mas adiado

O wrapper histórico permanece desligado e **não foi reaberto por esta migração**:

- implementação: `src/integration/lsp/tsgo-lsp-daemon.mjs`;
- transporte: JSON-RPC para o LSP TS7;
- isolamento: worker descartável e TTL curto;
- defaults obrigatórios: `LSP_ENABLED=false` e `LSP_MUTATIONS_ENABLED=false`;
- somente ativação explícita em processo isolado permite inicialização.

A mudança de `@typescript/native` para `typescript` nesse código apenas consolida a identidade do package; não transforma LSP em dependência da campanha MCP corrente.

## Gates de manutenção

```bash
npm run -s tsc7 -- --version
npm run check:typescript-baseline
npm run lint:type-aware
npm run lint:copilot:changed
npm ci --dry-run --ignore-scripts
npm run analyze:typescript:lsp:verify
npm run analyze:tsserver-contract
npm run check:ts7-strict-coverage
npm run typecheck:strict:all
npm run vscode:sync:check
npm run vscode:check
```

Qualquer mudança futura deve preservar simultaneamente: **TS7 como única autoridade**, **zero compiler TS<7**, **zero peer masking**, e **separação entre lint estrutural ESLint e análise type-aware Oxlint/tsgolint**.
