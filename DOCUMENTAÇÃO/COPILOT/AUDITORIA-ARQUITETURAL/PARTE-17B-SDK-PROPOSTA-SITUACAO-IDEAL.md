# PARTE-17B — Proposta: Situação Ideal do SDK Wrapper

**Data**: 2026-03-21 (rev.5 — pós conclusão Fase 1 + proposta Fase 2) **Escopo**: `src/copilot/sdk/`
como fachada única para `@github/copilot-sdk@0.2.0` **SDK oficial**: `@github/copilot-sdk@0.2.0`
(instalado) **Status Fase 1**: ✅ 22 faixas concluídas, 618/618 testes **Status Fase 2**: 🔜 12
faixas planejadas (F23–F34), ~200 testes estimados **Autor**: Auditoria automatizada PARTE-17, rev.5

> Revisões anteriores preservadas em `.rev2.md`, `.rev3.md`, `.rev4.md`

---

## Sumário Executivo (rev.5)

A rev.4 propunha uma arquitetura ideal de SDK wrapper com 18+ módulos em `sdk/`, zero-bypass,
cobertura 100% da API Surface e arquitetura de evento tipado.

A rev.5 registra o **estado de implementação** de cada proposta e define a **Fase 2** para completar
os itens parcialmente implementados ou não integrados.

### Estado das Propostas (Fase 1 — Faixas 1-22)

| Proposta                          |   Status   | Notas                                              |
| --------------------------------- | :--------: | -------------------------------------------------- |
| Zero-bypass architecture          |  ✅ DONE   | 0 imports diretos fora de sdk/                     |
| sdk/types.js — 90+ tipos          |  ✅ DONE   | 545 linhas, todos tipados                          |
| sdk/constants.js                  |  ✅ DONE   | 233 linhas, SESSION_MODES, REASONING_EFFORTS       |
| sdk/tools.js + sdk/permissions.js |  ✅ DONE   | defineTool, approveAll wrappers                    |
| sdk/system-message.js             |  ✅ DONE   | 3 modos, sectionOverride                           |
| sdk/config.js                     |  ✅ DONE   | buildSessionConfig() unificado                     |
| sdk/client.js expanded            |  ✅ DONE   | 15+ métodos + sdk/client-facade.js                 |
| sdk/session.js expanded           |  ✅ DONE   | 12+ métodos + abort + sdk/session-lifecycle.js     |
| sdk/rpc.js — 17 subsistemas       |  ✅ DONE   | createSessionRpc() + createServerRpc()             |
| sdk/events.js — 70+ event types   |  ✅ DONE   | SESSION_EVENTS, onSessionEvent, event-helpers.js   |
| sdk/health.js                     |  ✅ DONE   | ping, auth, quota, fullHealthCheck                 |
| sdk/provider.js — BYOK            |  ✅ DONE   | openai / azure / anthropic builders                |
| sdk/telemetry.js                  |  ✅ DONE   | getTraceContext, W3C traceparent                   |
| sdk/models/ directory             |  ✅ DONE   | helpers.js + registry.js + selector.js             |
| sdk/agents.js                     |  ✅ DONE   | listAgents, selectAgent, deselectAgent, etc.       |
| sdk/feature-flags.js              |  ✅ DONE   | isExperimentalEnabled, gated features              |
| sdk/experimental-rpc.js           |  ✅ DONE   | 6 subsistemas experimentais gated                  |
| sdk/quota-monitor.js              | ⚠️ PARCIAL | Criado mas não integrado ao observability (N3)     |
| Boot auth validation              | ⚠️ PARCIAL | getAuthStatus() existe; boot não chama (N4, N5)    |
| Session registry SSOT             | ⚠️ PARCIAL | Map + stateless coexistem (P2 residual)            |
| Config path único                 | ⚠️ PARCIAL | api/routes/sessions.js parcialmente inline (P1)    |
| RPC subsistemas integrados        | ⚠️ PARCIAL | Facade pronta; agent não usa mode/plan/shell ainda |
| CI regression gates               | 🔜 PLANNED | Faixa 33                                           |

---

## §1. Arquitetura Ideal — Estado Atual vs. Alvo

### 1.1 Diagrama da Arquitetura Alvo (Fase 2)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     BOUNDARY: sdk/ como única entrada                    │
│                                                                          │
│  @github/copilot-sdk@0.2.0                                               │
│       │     SOMENTE ESTES arquivos importam diretamente:                 │
│       ├── sdk/client.js        └── sdk/session.js                        │
│       ├── sdk/types.js         └── sdk/constants.js                     │
│       ├── sdk/rpc.js           └── sdk/events.js                         │
│       ├── sdk/health.js        └── sdk/provider.js                       │
│       └── ... (outros 24 módulos sdk/)                                   │
│                                                                          │
│  sdk/ === FACHADA ÚNICA — 32 módulos, ~7.744 linhas                      │
│                                                                          │
│  Consumers (via #copilot/sdk alias APENAS):                              │
│  agent/ | tools/ | bridges/ | observability/ | hooks/ | api/ | audit/   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Estado Atual vs. Alvo por Categoria

| Categoria                 | Alvo (rev.4) | Atual (rev.5)  | Gap                        |
| ------------------------- | ------------ | -------------- | -------------------------- |
| Imports diretos ao SDK    | 0            | **0** ✅       | Nenhum                     |
| Módulos em sdk/           | 18+          | **32** ✅      | Excedeu (bom)              |
| Linhas em sdk/            | ~5.500-6.000 | **~7.744** ✅  | +29% (mais features)       |
| Boot auth check           | Sim          | **Não** ⚠️     | N4, N5 — Faixa 24          |
| Quota monitor em produção | Sim          | **Não** ⚠️     | N3 — Faixa 25              |
| Session registry único    | Sim          | **Parcial** ⚠️ | P2 — Faixa 26              |
| Config path único         | Sim          | **Parcial** ⚠️ | P1 — Faixa 27              |
| RPC integrado no agent    | Sim          | **Parcial** ⚠️ | P11 integr. — Faixas 29-31 |
| CI regression gates       | Sim          | **Não** 🔜     | N7 — Faixa 33              |

---

## §2. Módulos Implementados — Detalhamento (Fase 1)

### 2.1 Camada de Tipos e Contratos

#### `sdk/types.js` ✅ IMPLEMENTADO

```javascript
// Situação ideal — ALCANÇADA
// @file src/copilot/sdk/types.js

/**
 * Re-exporta os 90+ tipos do @github/copilot-sdk com JSDoc robusto. Serve como a referência central de tipos para todo
 * o codebase.
 */
export {
  CopilotClient,
  CopilotSession,
  SessionConfig,
  ChatMessage,
  ModelInfo,
  AgentInfo,
  ToolDefinition,
  ContentBlock,
  TextBlock,
  TokenCountResult,
  TurnRequest,
  ConversationEntry,
  // ... 70+ tipos adicionais
} from '@github/copilot-sdk';
```

#### `sdk/constants.js` ✅ IMPLEMENTADO

```javascript
// Situação ideal — ALCANÇADA
export const SESSION_MODES = Object.freeze({
  NORMAL: 'normal',
  EDIT: 'edit',
  AGENT: 'agent',
  AUTO: 'auto',
});
export const REASONING_EFFORTS = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
});
// ... CONNECTION_STATES, ERROR_CODES, FEATURE_FLAGS, etc.
```

### 2.2 Camada de Tools e Permissões

#### `sdk/tools.js` + `sdk/permissions.js` ✅ IMPLEMENTADO

```javascript
// Situação ideal — ALCANÇADA
// sdk/tools.js
export { defineTool, ToolResult } from '@github/copilot-sdk';
export function createTool(name, description, handler) {
  /* wrapper */
}

// sdk/permissions.js
export { approveAll } from '@github/copilot-sdk';
export function createPermissionHandler(policy) {
  /* factory */
}
```

### 2.3 Camada RPC — `sdk/rpc.js` ✅ IMPLEMENTADO

```javascript
// Situação ideal — ALCANÇADA (17 subsistemas)
export function createSessionRpc(session) {
  return {
    model: {
      /* getModel, setModel */
    },
    mode: {
      /* getMode, setMode */
    },
    plan: {
      /* readPlan, updatePlan, delete */
    },
    workspace: {
      /* listFiles, readFile, etc. */
    },
    shell: {
      /* exec, kill, listRunning */
    },
    compaction: {
      /* compact, getHistory */
    },
    tools: {
      /* register, list, execute */
    },
    commands: {
      /* execute, list */
    },
    ui: {
      /* elicitation(), progress() */
    },
    permissions: {
      /* request, check */
    },
    log: {
      /* write, read */
    },
    // ... 17 subsistemas totais
  };
}
```

### 2.4 Event System Tipado — `sdk/events.js` ✅ IMPLEMENTADO

```javascript
// Situação ideal — ALCANÇADA
export const SESSION_EVENTS = Object.freeze({
  // Lifecycle
  INITIALIZED: 'initialized',
  DESTROYED: 'destroyed',
  RESUMED: 'resumed',
  SUSPENDED: 'suspended',
  // Conversation
  TURN_STARTED: 'turn:started',
  TURN_COMPLETED: 'turn:completed',
  TURN_ABORTED: 'turn:aborted',
  // Messages
  MESSAGE_ADDED: 'message:added',
  MESSAGE_CLEARED: 'message:cleared',
  // Models
  MODEL_CHANGED: 'model:changed',
  // ... 70+ event types
});

export function onSessionEvent(session, eventType, handler) {
  /* typed handler */
}
```

### 2.5 Health & Auth — `sdk/health.js` ✅ IMPLEMENTADO (⚠️ não integrado no boot)

```javascript
// Criado — MAS não chamado no boot (N4, N5)
export async function getAuthStatus(client) {
  /* wrapper */
}
export async function ping(client) {
  /* wrapper */
}
export async function fullHealthCheck(client) {
  /* composite */
}

// ❌ AINDA NÃO INTEGRADO em:
// agent/lifecycle/initializer.js (N4, N5) — Faixa 24
```

### 2.6 Quota Monitoring — `sdk/quota-monitor.js` ✅ CRIADO (⚠️ não integrado)

```javascript
// Criado em F21 — MAS não iniciado no observability (N3)
export function createQuotaMonitor({ client, intervalMs, warningThreshold, onUpdate, onWarning }) {
  // polling a cada intervalMs
  // chama onWarning quando uso > warningThreshold
}

// ❌ AINDA NÃO INTEGRADO em:
// observability/ — Faixa 25
// api/dashboard — Faixa 25
```

---

## §3. Fase 2 — Proposta de Integração Profunda (F23–F34)

### 3.1 Objetivos da Fase 2

A Fase 1 entregou a **fachada completa** — todos os wrappers existem. A Fase 2 entrega a
**integração profunda** — todos os wrappers são usados.

| Objetivo Fase 2                                | Prioridade | Faixa |
| ---------------------------------------------- | :--------: | :---: |
| Barrel index.js consistente                    |   MÉDIO    |  F23  |
| Boot valida autenticação antes de criar sessão |    ALTA    |  F24  |
| Quota monitor ativo em produção                |    ALTA    |  F25  |
| Session registry unificado (SSOT)              |  CRÍTICO   |  F26  |
| Config path único (P1 final)                   |  CRÍTICO   |  F27  |
| Hook types alinhados (P4 final)                |   MÉDIO    |  F28  |
| Mode + Plan via RPC no agent                   |   MÉDIO    |  F29  |
| UI Elicitation + Shell via RPC                 |   MÉDIO    |  F30  |
| Compaction + Workspace via RPC                 |   BAIXO    |  F31  |
| tools-registry deprecated e limpo              |   BAIXO    |  F32  |
| CI regression gates (zero-bypass)              |   MÉDIO    |  F33  |
| Documentação + release                         |   BAIXO    |  F34  |

### 3.2 Arquitetura Alvo da Fase 2

#### Boot Sequence (F24) — Situação Ideal

```javascript
// agent/lifecycle/initializer.js — ALVO (F24)
import { getClient, getAuthStatus, ping } from '#copilot/sdk';

export async function initialize(config) {
  const client = getClient(config); // ✅ usa wrapper, não new CopilotClient

  // [F24] Auth check antes de criar sessão
  const authStatus = await getAuthStatus(client);
  if (!authStatus.isAuthenticated) {
    throw new Error(`Auth falhou: ${authStatus.errorMessage}`);
  }

  // [F24] Health check
  const alive = await ping(client);
  if (!alive) throw new Error('Copilot server não responde');

  // [F25] Iniciar quota monitor
  const monitor = createQuotaMonitor({
    client,
    intervalMs: 60_000,
    warningThreshold: 80,
    onWarning: (usage) => logger.warn('Quota alta:', usage),
  });

  return { client, monitor };
}
```

#### Session Registry SSOT (F26) — Situação Ideal

```javascript
// PROBLEMA ATUAL: Map em client.js + acesso stateless em session.js divergem
// SOLUÇÃO ALVO (F26):
// sdk/client.js mantém o Map como SSOT
// sdk/session.js sempre registra/desregistra no Map do client
// Qualquer acesso fora de sdk/ usa getSession(id) via wrapper
```

#### Config Path Único (F27) — Situação Ideal

```javascript
// ANTES (atual): 3 caminhos de criação de SessionConfig
// DEPOIS (F27): 1 caminho
import { buildSessionConfig } from '#copilot/sdk';

const config = buildSessionConfig({
    workspacePath: '/path/to/workspace',
    modelId: 'gpt-4o',
    tools: [...],
    permissions: approveAll,
    // ... todos os 23+ campos em um lugar
});
```

#### RPC no Agent (F29-F31) — Situação Ideal

```javascript
// agent/ com RPC integrado
const rpc = createSessionRpc(session);

// Mode switching (F29)
await rpc.mode.set('agent');

// UI Elicitation (F30)
const form = await rpc.ui.elicitation({
  type: 'form',
  title: 'Confirme a ação',
  fields: [{ name: 'confirm', type: 'boolean', label: 'Continuar?' }],
});

// Compaction (F31)
await rpc.compaction.compact({ strategy: 'summary', targetTokens: 8000 });
```

---

## §4. Estrutura Final Proposta do sdk/ (Fase 2)

```
src/copilot/sdk/                         LINHAS | STATUS
├── index.js                               ~380 | ⚠️ rewrite consolidado (F23)
├── types.js                                545 | ✅ estável
├── constants.js                            233 | ✅ estável
├── client.js                               ~450 | ⚠️ Map como SSOT (F26)
├── session.js                              ~320 | ⚠️ register/deregister no Map (F26)
├── config.js                               ~100 | ✅ estável
├── rpc.js                                  484 | ✅ estável
├── server-rpc.js                           181 | ✅ estável
├── events.js                               260 | ✅ estável
├── event-helpers.js                         ~80 | ✅ estável
├── system-message.js                       192 | ✅ estável
├── tools.js                                 ~80 | ✅ estável
├── tools-registry.js                        ~30 | ⚠️ degradar a re-export (F32)
├── tools-state.js                           ~80 | ✅ estável
├── custom-tools.js                         327 | ✅ estável
├── permissions.js                           ~60 | ✅ estável
├── agents.js                               267 | ✅ estável
├── agent-contract.js                        ~50 | ✅ estável
├── bridge-contract.js                       ~50 | ✅ estável
├── channel-contract.js                      ~50 | ✅ estável
├── health.js                               208 | ✅ estável
├── quota-monitor.js                        ~100 | ⚠️ integrar observability (F25)
├── provider.js                             176 | ✅ estável
├── telemetry.js                             ~80 | ✅ estável
├── session-lifecycle.js                     ~80 | ✅ estável
├── client-events.js                        248 | ✅ estável
├── client-facade.js                         ~80 | ✅ estável
├── feature-flags.js                        ~120 | ✅ estável
├── experimental-rpc.js                     ~300 | ⚠️ dedup agent subsystem (F23)
├── http-request.js                          ~70 | ✅ estável
├── url-validator.js                         ~60 | ✅ estável
└── models/
    ├── helpers.js                           354 | ✅ estável
    ├── registry.js                          215 | ✅ estável
    └── selector.js                          216 | ✅ estável

Estimativa final Fase 2: ~8.200 linhas, 32 módulos
```

---

## §5. Métricas Alvo (Fase 2 Completa)

| Métrica                   | Fase 1 (atual) |  Fase 2 (alvo)  |
| ------------------------- | :------------: | :-------------: |
| Testes                    |      618       |    **818+**     |
| Specs                     |       25       |     **35+**     |
| Zero-bypass               |      ✅ 0      | ✅ 0 (CI gated) |
| Boot auth validation      |     ❌ Não     |     ✅ Sim      |
| Quota monitor em produção |     ❌ Não     |     ✅ Sim      |
| Session registry SSOT     |   ⚠️ Parcial   |     ✅ Sim      |
| Config path único         |   ⚠️ Parcial   |     ✅ Sim      |
| RPC integrado no agent    | ⚠️ Facade only |  ✅ Integrado   |
| CI regression gates       |     ❌ Não     |     ✅ Sim      |
| Cobertura fachada         |     ~100%      |      ~100%      |
| Cobertura integração      |      ~70%      |      ~100%      |

---

## §6. Princípios de Design Preservados

### 6.1 Boundary Single Entry Point

> **REGRA**: `src/copilot/sdk/` é a ÚNICA fonte de verdade para o SDK. Nenhum módulo fora de `sdk/`
> importa diretamente de `@github/copilot-sdk`.

Estado atual: ✅ **ALCANÇADO** (F18-F20) Manutenção: 🔜 CI gate permanente (F33)

### 6.2 Ergonomia Acima de Tudo

> **REGRA**: A API pública de `sdk/index.js` deve ser simples de usar. O developer não deve precisar
> conhecer a estrutura interna do SDK.

Estado atual: ✅ **ALCANÇADO** (`#copilot/sdk` = acesso a tudo)

### 6.3 Testabilidade por Módulo

> **REGRA**: Cada módulo sdk/ deve poder ser testado isoladamente com mocks.

Estado atual: ✅ **ALCANÇADO** (618 testes isolados, 25 specs)

### 6.4 Tipos sem Runtime Overhead

> **REGRA**: Tipagem via JSDoc — zero custo em runtime, total benefit no DX.

Estado atual: ✅ **ALCANÇADO** (sdk/types.js — 545 linhas de JSDoc)

---

## §7. Contraindicações e O Que NÃO Fazer

### ❌ Não Criar Abstração Para Cima do SDK

```javascript
// ❌ ERRADO — abstrair além do necessário:
class CopilotSDKWrapper {
  constructor() {
    this._internal = new CopilotClient();
  }
  doSomethingFancy() {
    /* complex logic */
  }
}

// ✅ CORRETO — expor o SDK com ergonomia, não esconder:
export function getClient(config) {
  return new CopilotClient(config); // simples, no overhead
}
```

### ❌ Não Duplicar Lógica de Negócio no SDK Wrapper

```javascript
// ❌ ERRADO — regra de negócio no sdk/:
export function createSession(client, config) {
  if (config.modelId.includes('gpt-4')) {
    config.maxTokens = 128000; // regra de negócio!
  }
  return client.createSession(config);
}

// ✅ CORRETO — a regra de negócio fica no consumer:
// sdk/session.js apenas wraps o createSession da API
```

### ❌ Não Expor Internals do SDK

```javascript
// ❌ ERRADO:
export { _InternalSessionManager } from '@github/copilot-sdk';

// ✅ CORRETO — somente API pública:
export { CopilotSession, SessionConfig } from '@github/copilot-sdk';
```

---

## §8. Cronograma de Entrega (Fase 2)

```
Semana 1: F23 (barrel) + F24 (boot auth)
Semana 2: F25 (quota) + F26 (session registry)
Semana 3: F27 (config) + F28 (hooks types)
Semana 4: F29 (mode/plan) + F30 (elicitation/shell)
Semana 5: F31 (compaction) + F32 (registry cleanup)
Semana 6: F33 (CI gates) + F34 (docs + release)
```

---

\*Documento atualizado em 2026-03-21, rev.5. Base: conclusão das 22 faixas (618 testes, 25 specs)

- proposta Fase 2 (Faixas 23–34, ~200 testes estimados, ~8.200 linhas sdk/ alvo). Revisões
  anteriores: `.rev2.md`, `.rev3.md`, `.rev4.md`\*
