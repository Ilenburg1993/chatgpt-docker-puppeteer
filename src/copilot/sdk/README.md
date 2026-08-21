# sdk/

## 🎯 Missão da camada

`src/copilot/sdk` é a **fronteira canônica** entre o runtime local e o `@github/copilot-sdk`.

Aqui ficam as capacidades vanilla do SDK (session, rpc, tools, models, telemetry) com semântica
estável, tipagem consistente e aliases explícitos.

Se uma capability já existe no SDK vanilla, ela deve nascer aqui antes de qualquer adaptação em
`agent/`, `terminal/`, `server/` ou `presentation/`.

## Arquitetura 2.0/2.1 — superfícies canônicas

### Root

- `#copilot/sdk` → barrel raiz estável

### Subsurfaces estáveis

- `#copilot/sdk/session`
- `#copilot/sdk/session-runtime`
- `#copilot/sdk/rpc`
- `#copilot/sdk/telemetry`
- `#copilot/sdk/tools`
- `#copilot/sdk/agents`
- `#copilot/sdk/models`
- `#copilot/sdk/constants`
- `#copilot/sdk/di`
- `#copilot/sdk/errors`
- `#copilot/sdk/event-helpers`
- `#copilot/sdk/feature-flags`
- `#copilot/sdk/utils`
- `#copilot/sdk/types` (type-only/JSDoc)

### Subsurface experimental controlada

- `#copilot/sdk/rpc/experimental`
  - escopo: `fleet`, `skills`, `mcp/oauth`, `plugins`, `extensions`, `history`, `usage`
  - **não** inclui `agent.*`

### Aliases removidos

Não há mais aliases folha de compatibilidade para o SDK em `package.json#imports`.

Foram removidos `tools-registry`, `tools-state`, `custom-tools`, `tracing`, `quota-monitor`,
`server-rpc`, `rpc-session`, `rpc-ops`, `rpc-facade`, `health`, `client`, `client-events`,
`provider`, `permissions`, `system-message` e o wildcard `#copilot/sdk/*`.

Regra: consumidores usam somente as surfaces estáveis listadas acima; tipos auxiliares locais ficam
em `#copilot/sdk/types`.

## Mapeamento aprofundado de acesso (entrada)

Baseline observado em `src/copilot/**` (fora de `sdk/`) em 2026-05-14 após remoção dos shims:

- `#copilot/sdk/types` → 420 referências JSDoc/type-only
- `#copilot/sdk/session` → 75 referências
- `#copilot/sdk/rpc` → 20 referências
- `#copilot/sdk/rpc/experimental` → 15 referências, concentradas em tools experimentais e testes
- `#copilot/sdk/tools` → 11 referências
- `#copilot/sdk/telemetry` → 10 referências
- `#copilot/sdk` → 8 referências, majoritariamente validação pública/contratos de barrel
- micro-surfaces (`constants`, `di`, `errors`, `event-helpers`, `feature-flags`, `utils`) → 33
  referências somadas

Leitura arquitetural: o root deixou de carregar contratos internos residuais. Fluxos operacionais e
tipos agora passam por portas semânticas explícitas.

## Política canônica por camada

As políticas executáveis vivem em `module-map.js` (`SDK_LAYER_ACCESS_POLICY`), mas o resumo
operacional é:

- **agent**: usar `session`, `session-runtime`, `rpc`, `tools`, `telemetry`, `models`, `errors`,
  `feature-flags`, `utils` e `event-helpers`; sem root runtime.
- **boot**: `di`, `session` e `telemetry`; root apenas para validação explícita da surface pública.
- **config**: `constants`, `session` e `rpc`; evitar root e RPC operacional fora de introspecção.
- **event-handlers / hooks**: preferir `session`.
- **observability**: `di`, `session` + `telemetry` (+ `tools` quando necessário).
- **server**: preferir subpaths (`session/rpc/tools/telemetry`) em vez de root.
- **terminal**: acessar `session` apenas por `terminal/frontend/gateways/sdk-session.js`; comandos,
  estado, status e adapters devem consumir a semântica terminal-owned via barrels do terminal.
- **tools**: `rpc`/`session`; `rpc/experimental` apenas com gating explícito.

## Mapeamento canônico de saída (SDK → outros domínios)

Importações autorizadas dentro de `sdk/`:

- `#copilot/core` e `#copilot/core/*`
- `#copilot/boot` e `#copilot/boot/*`
- `#copilot/infra/public/*` (membrana externa exclusiva de infra)
- `#copilot/events`
- `#copilot/config`

Importações proibidas por design:

- `terminal/` como dependency direta da camada SDK
- policy operacional de `presentation/` dentro do SDK
- aliases folha ou wildcard físico como API pública

## Subdomínios reais

| Superfície       | Núcleo                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| Root contracts   | `types.js`, `errors.js`, `constants.js`, `utils.js`, `event-helpers.js`, `logger.js`                      |
| Session          | `session/client.js`, `session/lifecycle.js`, `session/runtime.js`, `session/events.js`, `session/ui.js`   |
| RPC              | `rpc/index.js`, `rpc/session.js`, `rpc/ops.js`, `rpc/server.js`, `rpc/session-facade.js`, `rpc/guards.js` |
| RPC experimental | `rpc/experimental.js`                                                                                     |
| Tools            | `tools/index.js`, `tools/core.js`, `tools/registry.js`, `tools/state.js`, `tools/custom.js`               |
| Models           | `models/index.js` e helpers de capabilities/model selection                                               |
| Telemetry        | `telemetry/index.js`, `telemetry/health.js`, `telemetry/preflight.js`, `telemetry/tracing.js`, `quota`    |

## Consolidações aplicadas em 2026-05-14

- `#copilot/sdk/models` e `#copilot/sdk/types` viraram aliases explícitos em `package.json`; antes
  dependiam do wildcard implícito.
- `constants`, `di`, `errors`, `event-helpers`, `feature-flags` e `utils` viraram micro-surfaces
  explícitas.
- O wildcard `#copilot/sdk/*` e todos os aliases folha legados foram removidos de
  `package.json#imports`.
- `package.json#exports` agora publica apenas as surfaces SDK estáveis, sem depender de caminho
  físico interno.
- Imports operacionais de `terminal`, `event-handlers`, `hooks`, `tools`, `agent/facades` e
  `server/routes/sdk/deps` foram migrados do root para `session`, `session-runtime`, `rpc`, `tools`,
  `telemetry`, `agents` e `models`.
- No terminal, comandos, projeções, state e adapters deixaram de importar `#copilot/sdk/session`
  diretamente; o gateway `terminal/frontend/gateways/sdk-session.js` concentra a ponte vanilla da
  sessão SDK.
- O preflight do boot foi movido para `sdk/telemetry/preflight.js`; `agent/lifecycle` deixou de ser
  owner dessa checagem de CLI/auth/modelo.
- Histórico: a surface RPC local foi inicialmente alinhada ao `@github/copilot-sdk@0.3.0` para
  `session.name`, permissões nativas (`setApproveAll`, `resetSessionApprovals`), `mcp.config`,
  `skills.discover/config`, `sessions.fork`, `mcp.oauth.login`, `history.truncate` e
  `usage.getMetrics`.
- Baseline atual do repositório: `@github/copilot-sdk@1.0.11` instalado via lockfile. Novas mudanças
  devem validar o contrato 1.0.x real antes de preservar compatibilidade histórica por inércia.
- Billing/usage corrente: o wrapper trata `assistant.usage`, tokens, `copilotUsage.totalNanoAiu` e
  os eventos `session.usage_checkpoint`/`session_limits_*` como sinais canônicos.
  `sessionLimits.maxAiCredits` é suportado por `SessionConfigBuilder.sessionLimits()` e pode ser
  ativado por `COPILOT_MAX_AI_CREDITS`; ausência mantém a sessão sem cap local. Sessões BYOK não
  recebem esse cap, pois quota/cobrança pertencem ao provider externo.
- Campos/eventos request-based como `totalPremiumRequests`, `premium_interactions` e `pr.consumed`
  são tratados apenas como compatibilidade vendor/persistida **legacy** quando vierem explicitamente
  do SDK/runtime; `assistant.usage` não é mais convertido localmente em Premium Request por
  inferência.
- A política local de permissões tem um único fallback configurável: `AGENT_PERMISSION_MODE`. O
  default intencional do produto continua `approve_all`; `audit_only` e `selective` podem ser
  ativados sem editar call sites. Builders, lifecycle, preset AlwaysAlive e rotas SDK usam
  `createConfiguredPermissionHandler()` quando não recebem override explícito; perfis que querem
  `approveAll` por contrato próprio podem continuar declarando-o diretamente.
- `sdk/session` deixou de abrir `copilot.sqlite` ao ser importado: `hook-bus` e
  `permission-controller` agora usam módulos folha (`#copilot/events/hook-events`,
  `#copilot/config/env`) em vez dos barrels largos.
- `sdk/config.js` foi removido; configuração de sessão é responsabilidade de `#copilot/config`
  (`SessionConfigBuilder`), não do SDK root.
- Os aliases quebrados `#copilot/config/tools-state`, `#copilot/config/custom-tools-registry`,
  `#copilot/config/tools` e `#copilot/config/tools/*`, que apontavam para arquivos inexistentes,
  foram removidos de `package.json`.
- A mesma limpeza removeu aliases históricos sem arquivo correspondente (`#copilot/session-manager`,
  `#copilot/hooks/permission`, `#copilot/hooks/audit`, `#copilot/observability/audit-log`,
  `#copilot/observability/telemetry-store`, `#copilot/observability/error-registry`) e adicionou
  teste de regressão para impedir novos aliases quebrados.
- Foi criado `config/typing/strict/tsconfig.strict.src.copilot.sdk.json`, com TypeScript 6.0,
  NodeNext, `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`, `erasableSyntaxOnly`,
  `isolatedModules` e `noUncheckedSideEffectImports`.

## Typecheck estrito do SDK

O comando canônico é:

```bash
npm run typecheck:strict:src.copilot.sdk
```

Decisão de viabilidade: `skipLibCheck: false` foi avaliado, mas falha antes do código local por
declarações de `vscode-jsonrpc` incompatíveis com iteradores do TS 6. A surface SDK fica com
`skipLibCheck: true` até essa dependência ser atualizada ou isolada; o restante das flags rigorosas
já é aplicado ao código local.

## Anti-patterns que o módulo combate

- usar `#copilot/sdk` raiz quando subpath semântico já existe;
- duplicar contracts do SDK em `agent/` ou `terminal/` sem necessidade;
- misturar `agent.*` na superfície experimental;
- manter wrappers de capacidade vanilla do SDK em `agent/` quando a operação pertence a `sdk/`;
- transformar `sdk/` em camada de payload HTTP ou UX local.

## Governança executável

Consulte `module-map.js` para:

- inventário de módulos (`SDK_MODULE_LAYOUT`);
- inventário de aliases (`SDK_ALIAS_LAYOUT`);
- política por camada consumidora (`SDK_LAYER_ACCESS_POLICY`);
- scorecard da borda (`buildSdkModuleScorecard()`).

O README descreve intenção; o `module-map.js` descreve contrato verificável.

## Próxima onda recomendada

1. Converter gradualmente arquivos do SDK de JS+JSDoc para TS preservando `erasableSyntaxOnly`.
2. Isolar ou atualizar dependências que impedem `skipLibCheck: false` com TS 6.
3. Endurecer o ESLint type-aware do SDK para `no-unsafe-*` por subpasta, começando por `constants`,
   `errors`, `utils`, `models` e `telemetry`.
