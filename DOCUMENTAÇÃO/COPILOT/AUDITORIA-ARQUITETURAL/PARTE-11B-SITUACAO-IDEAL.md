# PARTE 11B — Situação Ideal: Arquitetura-Alvo para `src/copilot`

**Data**: 2026-07-21
**Pré-requisito**: [PARTE-11A](PARTE-11A-ANALISE-ARQUITETURAL-COMPLETA.md) — análise do estado atual.
**Objetivo**: descrever a arquitetura ideal, com princípios, proposta de fusões/separações/centralizações.

---

## 1. Princípios da Arquitetura-Alvo

1. **Single Responsibility**: cada módulo tem exatamente uma razão para mudar
2. **Fronteiras claras**: cada diretório tem contrato público (barrel) e interface estável
3. **Sem redundância**: funcionalidades não duplicadas entre módulos
4. **Config centralizada**: um único ponto de leitura de `process.env` por subsistema
5. **Sem deprecated pendente**: código morto eliminado
6. **God Modules decompostos**: nenhum arquivo >500 lines sem razão arquitetural
7. **Naming unívoco**: nomes de módulos/diretórios refletem responsabilidade sem ambiguidade
8. **Extensibilidade planejada**: estrutura preparada para novos agentes, novos modelos, novos
   canais de comunicação

---

## 2. Estrutura de Diretórios Proposta

```
src/copilot/
├── core/                     ← Contratos, constantes, erros, tipos (MERGE types/ aqui)
│   ├── constants.js          ← Limpa (sem @deprecated)
│   ├── errors.js
│   ├── events.js             ← Renomear de agent-events.js (são eventos do SISTEMA, não só agent)
│   ├── sdk-types.js          ← Movido de types/sdk.js
│   ├── structured-message.js ← Movido de types/structured-message.js
│   └── index.js
│
├── config/                   ← Configuração pura (sem runtime state)
│   ├── env.js                ← NOVA: centralização de TODAS as leituras de process.env
│   ├── session-config.js
│   ├── system-prompt.js
│   ├── custom-agents.js
│   ├── pinned-files.js       ← Renomear pinned-files-loader.js
│   ├── mcp-servers.js
│   └── index.js
│
├── db/                       ← Sem mudanças
│   ├── sqlite.js
│   └── migrations.js
│
├── sdk/                      ← NOVO: MERGE lib/ + config/tools/ (SDK abstractions)
│   ├── client.js             ← Movido de lib/sdk-client.js
│   ├── session.js            ← Movido de lib/session.js
│   ├── models.js             ← MERGE lib/models.js + lib/model-registry.js
│   ├── agents.js             ← Movido de lib/agents.js
│   ├── tools-registry.js     ← Movido de lib/tools-registry.js
│   ├── custom-tools.js       ← Movido de config/tools/registry.js (renomear)
│   ├── tools-state.js        ← Movido de config/tools/state.js
│   ├── event-helpers.js      ← Movido de lib/event-helpers.js
│   ├── http-request.js       ← Movido de lib/http-request.js
│   ├── url-validator.js      ← Movido de lib/url-validator.js
│   ├── utils.js              ← Movido de lib/utils.js
│   └── index.js
│
├── hooks/                    ← Sem mudanças estruturais, remover overlap de auditoria
│   ├── permission-handler.js
│   ├── factory.js
│   ├── composer.js
│   ├── bus.js
│   ├── registry.js
│   ├── tool-interceptor.js
│   ├── session-lifecycle.js
│   ├── error-handler.js
│   ├── prompt-transformer.js
│   ├── user-input.js
│   ├── types.js
│   ├── index.js
│   └── presets/              ← Sem mudanças
│
├── audit/                    ← NOVO: MERGE hooks/audit + observability/audit-log + agent/infra/tool-audit-logger
│   ├── pipeline.js           ← Pipeline unificado de auditoria de tools
│   ├── ring-buffer.js        ← Ring buffer em memória
│   ├── jsonl-writer.js       ← I/O JSONL com rotação
│   └── index.js
│
├── observability/            ← Mantido, mas decompostos os god modules
│   ├── logger.js
│   ├── otel.js
│   ├── error-tracker.js
│   ├── error-alerting.js
│   ├── tool-stats.js
│   ├── metrics/              ← NOVO subdir: decompor metrics.js
│   │   ├── aggregator.js
│   │   ├── token-tracker.js
│   │   └── index.js
│   ├── events/               ← NOVO subdir: decompor event-collector + agent-event-observer
│   │   ├── collector.js      ← event-collector.js decomposto
│   │   ├── agent-observer.js ← agent-event-observer.js decomposto
│   │   └── index.js
│   └── index.js
│
├── agent/                    ← Mantido (pós-R1-R18), com ajustes pontuais
│   ├── always-alive.js       ← Decompor em métodos delegados (mas classe mantida)
│   ├── config.js             ← Reftatorar para usar config/env.js como base
│   ├── types.js
│   ├── index.js
│   ├── dialog/               ← Sem mudanças
│   ├── session/              ← Sem mudanças
│   ├── lifecycle/            ← Sem mudanças
│   └── infra/                ← Remover tool-audit-logger.js (→ audit/)
│
├── api/                      ← MERGE routes/ + api/ em estrutura unificada
│   ├── express/              ← Rotas Express (/api/sdk/*)
│   │   ├── agent.js
│   │   ├── client.js
│   │   ├── sessions.js
│   │   ├── hooks.js
│   │   ├── webhooks.js
│   │   ├── observability.js
│   │   ├── middleware.js
│   │   └── index.js          ← ex-sdk-api.js
│   ├── bridge/               ← HTTP Bridge raw (/api/copilot/*)
│   │   ├── control.js
│   │   ├── dialog.js
│   │   ├── stream.js
│   │   ├── tasks.js
│   │   └── index.js          ← ex-http-bridge.js
│   ├── sse/                  ← Utilitários SSE compartilhados
│   │   ├── utils.js
│   │   ├── replay-buffer.js
│   │   └── fanout.js
│   └── index.js
│
├── bridges/                  ← Mover alias-store para terminal/, eliminar gh-bridge.js
│   ├── nerv-bridge.js
│   ├── mcp-tool-bridge.js
│   ├── git-bridge.js
│   └── gh/                   ← Sem mudanças internas
│
├── channel/                  ← Sem mudanças
│   ├── client.js
│   ├── inject.js
│   └── index.js
│
├── conversation-hub/         ← Sem mudanças estruturais (decompor store se >800)
│   ├── hub.js
│   ├── orchestrator.js
│   ├── socket-ns.js
│   ├── store.js
│   ├── store-helpers.js
│   └── index.js
│
├── terminal/                 ← Decompor god modules, mover alias-store aqui
│   ├── dialog/               ← NOVO subdir: decompor dialog.js (944 lines)
│   │   ├── engine.js         ← Lógica core de sendTurn
│   │   ├── loop.js           ← ensureDialogLoop
│   │   └── index.js
│   ├── handlers/             ← NOVO subdir: agrupar handlers
│   │   ├── agent.js
│   │   ├── dialog.js
│   │   ├── system.js         ← Decompor handlers-system.js (722 lines)
│   │   ├── shared.js
│   │   └── index.js
│   ├── alias-store.js        ← Movido de bridges/alias-store.js
│   ├── file-context.js
│   ├── repl.js
│   ├── server.js
│   ├── route-table.js
│   ├── state.js
│   ├── workspace-context.js
│   ├── rate-limiter-state.js
│   ├── index.js
│   └── commands/             ← Sem mudanças
│
├── tools/                    ← Sem mudanças estruturais
│   └── (tudo como está)
│
└── (sem logs/ vazio, sem types/ separado)
```

---

## 3. Fusões, Separações e Eliminações

### 3.1 Fusões

| Origem | Destino | Razão |
| --- | --- | --- |
| `types/sdk.js` + `types/structured-message.js` | `core/` | Tipos são contratos — pertencem a core |
| `lib/` inteiro | `sdk/` | Renomear para nome mais descritivo; eliminar deprecated |
| `config/tools/` | `sdk/` | São abstrações SDK, não config pura |
| `api/` + `routes/` | `api/express/` + `api/bridge/` | Unificar sob um diretório |
| `hooks/audit.js` + `observability/audit-log.js` + `agent/infra/tool-audit-logger.js` | `audit/` | Eliminar auditoria tripla |
| `lib/models.js` + `lib/model-registry.js` | `sdk/models.js` | Overlap parcial, mesma responsabilidade |

### 3.2 Separações (Decomposição)

| Arquivo atual | Proposta | Razão |
| --- | --- | --- |
| `observability/event-collector.js` (1.411 lines) | `observability/events/collector.js` + decomposição interna | God Module |
| `observability/agent-event-observer.js` (945 lines) | `observability/events/agent-observer.js` + decomposição | God Module |
| `terminal/dialog.js` (944 lines) | `terminal/dialog/engine.js` + `terminal/dialog/loop.js` | God Module |
| `terminal/handlers-system.js` (722 lines) | Decomposição por domínio dentro de `terminal/handlers/` | God Module |
| `observability/metrics.js` (551 lines) | `observability/metrics/aggregator.js` + `metrics/token-tracker.js` | God Module |

### 3.3 Eliminações

| Arquivo | Razão |
| --- | --- |
| `lib/permissions.js` | @deprecated re-export |
| `lib/hooks.js` | @deprecated re-export |
| `bridges/gh-bridge.js` | @deprecated barrel |
| `terminal/bootstrap.js` | @deprecated wrapper |
| `terminal/http-handlers.js` | @deprecated barrel |
| `agent/events.js` | Re-export de compatibilidade (R9) |
| `logs/` (diretório vazio) | Sem conteúdo |
| `types/` (inteiro, após merge em core/) | Conteúdo movido |
| `lib/` (inteiro, após merge em sdk/) | Conteúdo movido |

### 3.4 Movimentações

| Arquivo | De | Para | Razão |
| --- | --- | --- | --- |
| `alias-store.js` | `bridges/` | `terminal/` | Exclusivo do REPL |
| `constants.js` | `core/` | `core/` (limpar @deprecated) | Higiene |
| `pinned-files-loader.js` | `config/` | `config/pinned-files.js` | Naming |

---

## 4. Centralização de `process.env`

### Estado Atual

41 arquivos leem `process.env` diretamente. Apenas `agent/config.js` centraliza para o subsistema
agent/.

### Proposta

Criar `config/env.js` como single source of truth:

```js
// config/env.js
export const ENV = {
    // Runtime
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    COPILOT_SDK_ENABLED: process.env.COPILOT_SDK_ENABLED === 'true',

    // Network
    COPILOT_CLI_URL: process.env.COPILOT_CLI_URL,
    LLM_B_TERMINAL_PORT: Number(process.env.LLM_B_TERMINAL_PORT) || 3009,
    COPILOT_BRIDGE_PORT: Number(process.env.COPILOT_BRIDGE_PORT) || 3008,

    // Models
    COPILOT_MODEL: process.env.COPILOT_MODEL ?? 'claude-sonnet-4',
    COPILOT_REASONING_EFFORT: process.env.COPILOT_REASONING_EFFORT ?? 'medium',

    // Security
    COPILOT_HIGH_RISK_TOOLS: process.env.COPILOT_HIGH_RISK_TOOLS,
    AGENT_DENY_SHELL_TOOLS: process.env.AGENT_DENY_SHELL_TOOLS,
    WEBHOOK_ALLOW_PRIVATE_HOSTS: process.env.WEBHOOK_ALLOW_PRIVATE_HOSTS === 'true',

    // ... todas as demais
};
```

`agent/config.js` passa a importar de `config/env.js` e adicionar constantes derivadas.

---

## 5. Unificação de Auditoria

### Estado Atual (3 sistemas paralelos)

```
hooks/audit.js
  → AuditRingBuffer (memória)
  → globalAuditBuffer singleton
  → getAuditTail()

observability/audit-log.js
  → AuditLog ring buffer (memória)
  → JSONL I/O (logs/tool-execution-audit.jsonl)
  → rotação automática 10 MB
  → getAuditSummary()

agent/infra/tool-audit-logger.js
  → logToolAudit (JSONL em logs/tool-permissions-audit.jsonl)
  → isHighRiskTool()
  → buildAuditPermissionHandler()
```

### Proposta: Pipeline Unificado em `audit/`

```
audit/
├── pipeline.js   ← onPostToolUse handler que:
│                    1. registra no ring buffer
│                    2. escreve JSONL
│                    3. emite evento no HookBus
├── ring-buffer.js ← Ring buffer genérico (substitui hooks/audit + observability/audit-log buffer)
├── jsonl-writer.js ← Escritor JSONL com rotação (substitui observability/audit-log I/O)
└── index.js       ← Barrel + isHighRiskTool export
```

---

## 6. Unificação de Rotas HTTP

### Estado Atual (3 servidores HTTP)

1. **Express `/api/sdk/*`** (port 3008 via dashboard) — `routes/*.js`
2. **HTTP Bridge `/api/copilot/*`** (port 3008 via dashboard) — `api/bridge-*.js`
3. **Terminal Server** (port 3009) — `terminal/server.js`

### Proposta

```
api/
├── express/     ← rotas Express (SDK API)
├── bridge/      ← HTTP bridge raw (copilot API)
├── sse/         ← utilitários SSE compartilhados
└── index.js     ← barrel
```

O Terminal Server (porta 3009) permanece separado — é um processo diferente. Mas `api/` unifica os
dois conjuntos de rotas do processo principal.

---

## 7. Diagrama da Arquitetura-Alvo

```
                     ┌────────────────────────────────────┐
                     │           config/env.js            │  ← SSOT process.env
                     └────────────────┬───────────────────┘
                                      │
         ┌─────────┬─────────┬────────┼────────┬──────────┬─────────┐
         │         │         │        │        │          │         │
    ┌────▼───┐ ┌───▼────┐ ┌──▼───┐ ┌──▼───┐ ┌──▼──┐ ┌────▼───┐ ┌──▼───┐
    │ core/  │ │config/ │ │ sdk/ │ │hooks/│ │audit│ │observe.│ │  db/ │
    │contratos│ │config  │ │ SDK  │ │hook  │ │audit│ │ logger │ │sqlite│
    │tipos   │ │session │ │abstraç│ │system│ │unif.│ │metrics │ │migr. │
    └────┬───┘ └───┬────┘ └──┬───┘ └──┬───┘ └──┬──┘ └────┬───┘ └──┬───┘
         │         │         │        │        │          │         │
         └─────────┴─────────┴────────┼────────┴──────────┴─────────┘
                                      │
                                 ┌────▼────┐
                                 │ agent/  │
                                 │AlwaysAl.│
                                 └────┬────┘
                        ┌─────────────┼──────────────┐
                        │             │              │
                   ┌────▼────┐  ┌─────▼─────┐  ┌────▼────┐
                   │  api/   │  │ channel/  │  │bridges/ │
                   │express/ │  │ LLM-A↔B   │  │nerv,mcp │
                   │bridge/  │  └─────┬─────┘  │git,gh   │
                   └─────────┘        │        └─────────┘
                                ┌─────▼─────┐
                                │conv-hub/  │
                                │store,orch │
                                └─────┬─────┘
                                ┌─────▼─────┐
                                │ terminal/ │
                                │REPL,server│
                                │commands/  │
                                └───────────┘
```

---

## 8. Métricas-Alvo

| Métrica | Atual | Alvo |
| --- | --- | --- |
| Arquivos deprecated | 6 | 0 |
| God Modules (>600 lines) | 11 | ≤4 (always-alive.js permitido como orchestrator) |
| Overlaps identificados | 7 | 0 |
| process.env fora de config | 41 | 0 |
| Diretórios HTTP | 3 separados | 2 (api/ unificado + terminal server) |
| Diretórios vazios | 1 | 0 |
| Sistemas de auditoria | 3 | 1 |
| Tool registries | 3 | 2 (tools-registry in-memory + custom-tools persistido) |
