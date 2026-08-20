# Plano de Migração — `src/copilot/sdk/` → Barris Canônicos

**Status**: Em execução **Branch**: `codex/agent-architecture-21-deep-refactor` **Data**: 2026-05
**Autor**: Copilot Agent (sessão de refactoring arquitetural)

---

## 1. Contexto

A migração da pasta `agent/` para barris canônicos (Ondas 1 e 2) eliminou todos os deep imports
externos para `agent/`. O próximo domínio a ser governado é `src/copilot/sdk/`.

**Objetivo**: toda importação para dentro de `sdk/` deve usar aliases canônicos `#copilot/sdk/*`,
nunca caminhos relativos como `../../sdk/session/events.js`.

---

## 2. Estado Atual

### 2.1 Estrutura de `src/copilot/sdk/`

| Subpasta     | Arquivos | Barrel `index.js` | Status    |
| ------------ | -------- | ----------------- | --------- |
| `session/`   | 26       | ❌ Não existe     | **Criar** |
| `tools/`     | 5        | ❌ Não existe     | **Criar** |
| `rpc/`       | 5        | ❌ Não existe     | **Criar** |
| `telemetry/` | 4        | ❌ Não existe     | **Criar** |
| `models/`    | 9        | ✅ Existe         | OK        |
| `agent/`     | 1        | ❌ Não existe     | **Criar** |
| (raiz)       | 13       | ✅ Existe         | OK        |

### 2.2 Aliases Existentes (antes desta migração)

```
#copilot/sdk                → sdk/index.js                    ← barrel raiz OK
#copilot/sdk/session        → sdk/session/lifecycle.js        ← aponta para arquivo específico (problema!)
#copilot/sdk/telemetry      → sdk/telemetry/tracing.js        ← aponta para arquivo específico (0 usos!)
#copilot/sdk/tools-registry → sdk/tools/registry.js           ← específico, 14 consumidores
#copilot/sdk/quota-monitor  → sdk/telemetry/quota-monitor.js  ← específico, 6 consumidores
#copilot/sdk/events         → sdk/session/events.js           ← específico (consumidores usam relativo!)
#copilot/sdk/client         → sdk/session/client.js           ← específico
#copilot/sdk/client-facade  → sdk/session/client-facade.js    ← específico
... (muitos outros específicos)
#copilot/sdk/*              → sdk/*.js                        ← wildcard raiz
```

### 2.3 Deep Imports Externos para `sdk/` (violações a corrigir)

| Arquivo alvo                         | Consumidores externos                                                                       | Violações |
| ------------------------------------ | ------------------------------------------------------------------------------------------- | --------- |
| `sdk/session/elicitation.js`         | `agent/always-alive.js`, `agent/context-factories.js`                                       | 6         |
| `sdk/session/events.js`              | `observability/collectors/assistant-handlers.js`, `tool-handlers.js`, `session-handlers.js` | 16        |
| `sdk/session/permission-events.js`   | `terminal/events/sdk-session-events.js`                                                     | 1         |
| `sdk/session/session-events.js`      | `observability/collectors/session-handlers.js`                                              | 1         |
| `sdk/session/wrapper.js`             | `server/routes/sdk/session-core-routes.js`, `session-send-helpers.js`                       | 2         |
| `sdk/telemetry/operation-metrics.js` | `observability/bootstrap.js`                                                                | 1         |
| `sdk/tools/custom.js`                | `observability/bootstrap.js`                                                                | 1         |

**Total: 28 violações externas**

### 2.4 Escapes de `sdk/` para Fora (importações relativas saindo de sdk/)

| Destino                      | Arquivos em sdk/                                         | Ação                                                    |
| ---------------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| `core/circuit-breaker.js`    | `session/client.js`                                      | → `#copilot/core`                                       |
| `core/di-tokens.js`          | `di-tokens.js`                                           | → `#copilot/core/di-tokens`                             |
| `core/di.js`                 | `di-tokens.js`                                           | → `#copilot/core/di`                                    |
| `core/elicitation-schema.js` | `session/elicitation.js`                                 | → `#copilot/core` ou `#copilot/core/elicitation-schema` |
| `core/error-handlers.js`     | `tools/state.js`, `tools/custom.js`, `models/helpers.js` | → `#copilot/core`                                       |
| `core/event-bus.js`          | `session/hook-bus.js`                                    | → `#copilot/core`                                       |
| `core/interfaces.js`         | `tools/registry.js`                                      | → `#copilot/core`                                       |
| `core/io-policy.js`          | `session/session-fs.js`                                  | → `#copilot/core`                                       |
| `core/safe-json.js`          | `tools/state.js`, `tools/custom.js`                      | → `#copilot/core`                                       |
| `core/schemas.js`            | `tools/state.js`, `tools/custom.js`                      | → `#copilot/core`                                       |
| `core/tool-contracts.js`     | `tools/registry.js`                                      | → `#copilot/core`                                       |
| `infra/io-engine.js`         | `session/session-fs.js`                                  | → `#copilot/infra/io-engine`                            |
| `infra/io-scanner.js`        | `session/session-fs.js`                                  | → `#copilot/infra/io-scanner`                           |
| `boot/contract.js`           | `session/client-options.js`                              | → `#copilot/boot`                                       |
| `boot/session-fs.js`         | `session/session-fs.js`                                  | → `#copilot/boot`                                       |

---

## 3. Plano de Execução

### Fase 1 — Criar sub-barris `index.js`

**1.1** `sdk/session/index.js` — `export *` de todos os 26 arquivos de `session/` **1.2**
`sdk/tools/index.js` — `export *` de `core.js`, `registry.js`, `custom.js`, `state.js`,
`agent-policy.js` **1.3** `sdk/rpc/index.js` — `export *` de `server.js`, `session.js`, `ops.js`,
`experimental.js`, `guards.js` **1.4** `sdk/telemetry/index.js` — `export *` de `health.js`,
`operation-metrics.js`, `quota-monitor.js`, `tracing.js` **1.5** `sdk/agent/index.js` — `export *`
de `agents.js`

### Fase 2 — Atualizar/Adicionar aliases em `package.json`

| Alias canônico                   | Target                       | Ação                                         |
| -------------------------------- | ---------------------------- | -------------------------------------------- |
| `#copilot/sdk/session`           | `sdk/session/index.js`       | **UPDATE** (era lifecycle.js)                |
| `#copilot/sdk/session-lifecycle` | `sdk/session/lifecycle.js`   | **ADD** (renomear antigo)                    |
| `#copilot/sdk/telemetry`         | `sdk/telemetry/index.js`     | **UPDATE** (era tracing.js, 0 usos)          |
| `#copilot/sdk/tracing`           | `sdk/telemetry/tracing.js`   | **ADD** (renomear antigo)                    |
| `#copilot/sdk/tools`             | `sdk/tools/index.js`         | **ADD** (novo)                               |
| `#copilot/sdk/rpc`               | `sdk/rpc/index.js`           | **ADD** (novo)                               |
| `#copilot/sdk/agents`            | `sdk/agent/index.js`         | **UPDATE** (era agent/agents.js diretamente) |
| `#copilot/infra`                 | `src/copilot/infra/index.js` | **ADD** (faltante)                           |
| `#copilot/infra/*`               | `src/copilot/infra/*.js`     | **ADD** (wildcard)                           |

Aliases a manter sem alteração (14 consumidores ativos):

- `#copilot/sdk/tools-registry` → `tools/registry.js` (**MANTER**)
- `#copilot/sdk/quota-monitor` → `telemetry/quota-monitor.js` (**MANTER**)
- Todos os outros aliases específicos de session/*.js (**MANTER**)

### Fase 3 — Corrigir consumidores externos com deep imports

Substituir paths relativos por aliases canônicos em 7 arquivos externos:

| Arquivo                                          | De                                                                   | Para                     |
| ------------------------------------------------ | -------------------------------------------------------------------- | ------------------------ |
| `agent/always-alive.js`                          | `../sdk/session/elicitation.js`                                      | `#copilot/sdk/session`   |
| `agent/context-factories.js`                     | `../sdk/session/elicitation.js`                                      | `#copilot/sdk/session`   |
| `observability/collectors/assistant-handlers.js` | `../../sdk/session/events.js`                                        | `#copilot/sdk/session`   |
| `observability/collectors/tool-handlers.js`      | `../../sdk/session/events.js`                                        | `#copilot/sdk/session`   |
| `observability/collectors/session-handlers.js`   | `../../sdk/session/events.js`, `../../sdk/session/session-events.js` | `#copilot/sdk/session`   |
| `terminal/events/sdk-session-events.js`          | `../../sdk/session/permission-events.js`                             | `#copilot/sdk/session`   |
| `server/routes/sdk/session-core-routes.js`       | `../../../sdk/session/wrapper.js`                                    | `#copilot/sdk/session`   |
| `server/routes/sdk/session-send-helpers.js`      | `../../../sdk/session/wrapper.js`                                    | `#copilot/sdk/session`   |
| `observability/bootstrap.js`                     | `../sdk/telemetry/operation-metrics.js`                              | `#copilot/sdk/telemetry` |
| `observability/bootstrap.js`                     | `../sdk/tools/custom.js`                                             | `#copilot/sdk/tools`     |

### Fase 4 — Corrigir escapes internos de sdk/ para fora

Substituir paths relativos que saem de `sdk/` por aliases canônicos:

- `core/*` → usar `#copilot/core` (barrel existente) quando exportado, ou `#copilot/core/<file>`
  (wildcard)
- `infra/*` → usar `#copilot/infra/<file>` (novo wildcard a criar)
- `boot/*` → usar `#copilot/boot` (barrel existente)

### Fase 5 — Typecheck + Validação

```bash
npm run typecheck:strict:src.copilot
```

---

## 4. Impacto e Riscos

| Risco                                                                                                | Probabilidade                                | Mitigação                                                                                         |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `#copilot/sdk/session` aponta para barrel completo vs lifecycle.js específico → some consumer quebra | Baixa (1 consumidor: `hooks/elicitation.js`) | Re-exportar tudo de session/index.js, renomear alias antigo para `#copilot/sdk/session-lifecycle` |
| `export *` em session/index.js cria conflicts de nome                                                | Baixa                                        | Verificar exports duplicados antes de criar barrel                                                |
| sdk/ files que escapam para core/ não encontram export no barrel                                     | Média                                        | Usar `#copilot/core/<file>` wildcard como fallback                                                |

---

## 5. Métricas de Sucesso

- [ ] Zero deep imports relativos de fora de `sdk/` para dentro de `sdk/`
- [ ] Sub-barris `index.js` criados para: `session/`, `tools/`, `rpc/`, `telemetry/`, `agent/`
- [ ] Aliases canônicos adicionados: `#copilot/sdk/session`, `#copilot/sdk/tools`,
      `#copilot/sdk/rpc`, `#copilot/sdk/telemetry`, `#copilot/infra`, `#copilot/infra/*`
- [ ] Zero escapes de `sdk/` para `core/`, `infra/`, `boot/` via caminho relativo
- [ ] `typecheck:strict:src.copilot` GREEN após migração

---

## 6. Relacionado

- `agent/` migration: completa — zero deep imports externos (documentado neste mesmo branch)
- Onda 1: 24 barris criados em `agent/` subdirs
- Onda 2: 51 imports internos pendentes (`agent/` → `sdk/`, `core/`) — pode ser cobertos por esta
  migração
