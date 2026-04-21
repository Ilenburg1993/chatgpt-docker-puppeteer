# PARTE-17B — Proposta de Situação Ideal: SDK Facade Centralizado

**Data**: 2026-03-20 (rev.3 — transformação arquitetural completa) **Escopo**: TODO `src/copilot/`
(263 arquivos, ~46.525 linhas) **Pré-requisito**: PARTE-17A rev.3 (análise de situação atual)
**Autor**: Auditoria automatizada PARTE-17

---

## Sumário Executivo

A proposta é transformar o módulo `sdk/` de um wrapper parcial (que cobre ~52% dos acessos ao SDK)
em uma **SDK Facade completa** que seja o **ÚNICO** ponto de interação com `@github/copilot-sdk` em
todo o `src/copilot/`. Isso resolve os 10 problemas identificados na PARTE-17A, elimina os 20 pontos
de bypass, e cria um contrato estável que isola o projeto de mudanças breaking no SDK.

A transformação é feita em **3 camadas** concêntricas:

1. **Core Facade** — re-exportar TODOS os símbolos SDK usados pelo projeto
2. **Config Unification** — unificar os 3 caminhos de configuração em 1
3. **Registry Merge** — unificar os 2 registros de sessão em 1

---

## §1. Arquitetura Alvo — Visão Geral

### 1.1 Diagrama da Arquitetura Proposta

```
┌──────────────────────────────────────────────────────────────────┐
│                       @github/copilot-sdk                         │
│  CopilotClient · CopilotSession · defineTool · approveAll ·       │
│  SYSTEM_PROMPT_SECTIONS · tipos · SessionConfig · ...             │
└────────────────────────────┬─────────────────────────────────────┘
                             │ ÚNICA FRONTEIRA PERMITIDA
                    ┌────────▼────────┐
                    │                 │
                    │   sdk/ FACADE   │◄─── ESLint rule:
                    │                 │     no-restricted-imports
                    │  client.js      │     @github/copilot-sdk
                    │  session.js     │     proibido fora de sdk/
                    │  tools.js (NEW) │
                    │  permissions.js │
                    │  constants.js   │
                    │  types.js (NEW) │
                    │  config.js (NEW)│
                    │  models/        │
                    │  tools-registry │
                    │  ...            │
                    └────────┬────────┘
                             │
          ┌──────────────────┼──────────────────────┐
          │                  │                       │
     ┌────▼────┐        ┌───▼───┐             ┌────▼────┐
     │ config/ │        │hooks/ │             │ agent/  │
     │         │        │       │             │         │
     │ Imports │        │Imports│             │ Imports │
     │ ONLY    │        │ ONLY  │             │  ONLY   │
     │ from    │        │ from  │             │  from   │
     │ #sdk/   │        │ #sdk/ │             │  #sdk/  │
     └─────────┘        └───────┘             └─────────┘
          │                  │                       │
     ┌────▼────┐        ┌───▼───┐             ┌────▼────┐
     │ api/    │        │tools/ │             │channel/ │
     │bridges/ │        │       │             │terminal/│
     │observ/  │        │       │             │hub/     │
     └─────────┘        └───────┘             └─────────┘
```

### 1.2 Princípios da Facade

1. **Single Gateway**: Toda interação com `@github/copilot-sdk` passa por `sdk/`
2. **Re-export First**: Símbolos simples (tipos, constantes, funções puras) são re-exportados sem
   wrapper lógico
3. **Wrap When Needed**: Símbolos que requerem lógica adicional (singleton, telemetria, registry)
   são wrapped
4. **Lint Enforcement**: ESLint rule proíbe `from '@github/copilot-sdk'` fora de `src/copilot/sdk/`
5. **Type Consolidation**: Um único `sdk/types.js` como fonte canônica de tipos SDK

---

## §2. Novos Módulos da Facade

### 2.1 `sdk/tools.js` (NOVO — ~60 linhas)

Wrapper para `defineTool` que garante passagem pelo `tool-factory.js`:

```javascript
// sdk/tools.js — Re-exporta defineTool e o wrapper buildTool
export { defineTool } from '@github/copilot-sdk';
export { buildTool, withSkipPermission } from '#copilot/tools/tool-factory';
```

**Motivação**: Centralizar o acesso a `defineTool` permite:

- Trocar por uma implementação instrumentada no futuro
- Aplicar políticas globais (logging obrigatório, rate limit)
- Manter um único import path para todos os tools files

### 2.2 `sdk/permissions.js` (NOVO — ~40 linhas)

```javascript
// sdk/permissions.js — Re-exporta approveAll e presets de permissão
export { approveAll } from '@github/copilot-sdk';
export {
  createPermissionHandler,
  createApproveAllPermission,
  createAuditOnlyPermission,
  createRestrictedPermission,
  createSafePermission,
} from '#copilot/hooks/permission';
```

**Motivação**: `approveAll` é usado por 5 arquivos — re-exportar do facade unifica.

### 2.3 `sdk/constants.js` (NOVO — ~20 linhas)

```javascript
// sdk/constants.js — Re-exporta constantes do SDK
export { SYSTEM_PROMPT_SECTIONS } from '@github/copilot-sdk';
```

### 2.4 `sdk/types.js` (NOVO — substitui `core/sdk-types.js` + consolida `hooks/types.js`)

Fonte canônica única para TODOS os tipos SDK usados no projeto:

```javascript
// sdk/types.js — Canonical SDK type re-exports (zero runtime)

/** @typedef {import('@github/copilot-sdk').CopilotClient} CopilotClient */
/** @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession */
/** @typedef {import('@github/copilot-sdk').SessionConfig} SessionConfig */
/** @typedef {import('@github/copilot-sdk').SessionEvent} SessionEvent */
/** @typedef {import('@github/copilot-sdk').Tool} Tool */
/** @typedef {import('@github/copilot-sdk').ToolHandler} ToolHandler */
/** @typedef {import('@github/copilot-sdk').PermissionHandler} PermissionHandler */
/** @typedef {import('@github/copilot-sdk').PermissionRequest} PermissionRequest */
/** @typedef {import('@github/copilot-sdk').PermissionRequestResult} PermissionRequestResult */
/** @typedef {import('@github/copilot-sdk').MessageOptions} MessageOptions */
/** @typedef {import('@github/copilot-sdk').CopilotClientOptions} CopilotClientOptions */
/** @typedef {import('@github/copilot-sdk').InfiniteSessionConfig} InfiniteSessionConfig */
/** @typedef {import('@github/copilot-sdk').ResumeSessionConfig} ResumeSessionConfig */
/** @typedef {import('@github/copilot-sdk').SessionListFilter} SessionListFilter */
/** @typedef {import('@github/copilot-sdk').CustomAgentConfig} CustomAgentConfig */
/** @typedef {import('@github/copilot-sdk').ToolInvocation} ToolInvocation */
export {};
```

**Migração**: `core/sdk-types.js` será deprecated (re-exporta de `sdk/types.js`). Tipos que
`hooks/types.js` define em paralelo ao SDK serão gradualmente realinhados.

### 2.5 `sdk/config.js` (NOVO — Unified Session Config Builder, ~200 linhas)

O config builder unificado que substitui os 3 caminhos atuais:

```javascript
/**
 * sdk/config.js — Unified Session Config Builder
 *
 * ÚNICO ponto de construção de SessionConfig para todo o src/copilot/. Substitui:
 *
 * - sdk/session.js::buildSessionConfig() (removido)
 * - config/session-config.js::buildAlwaysAliveConfig() (deprecated)
 * - agent/session/initializer.js config manual (migrado para usar este)
 */

/**
 * @typedef {object} UnifiedSessionConfigOptions
 * @property {string} model
 * @property {string} [sessionId]
 * @property {boolean} [streaming]
 * @property {import('@github/copilot-sdk').InfiniteSessionConfig} [infiniteSessions]
 * @property {string} [workingDirectory]
 * @property {string[]} [skillDirectories]
 * @property {string[]} [excludedTools]
 * @property {string[]} [availableTools]
 * @property {import('@github/copilot-sdk').CustomAgentConfig[]} [customAgents]
 * @property {Record<string, unknown>} [mcpServers]
 * @property {import('@github/copilot-sdk').Tool[]} [tools]
 * @property {object} [hooks]
 * @property {import('@github/copilot-sdk').SystemMessageConfig} [systemMessage]
 * @property {import('@github/copilot-sdk').PermissionHandler} [onPermissionRequest]
 * @property {Function} [onUserInputRequest]
 * @property {'low' | 'medium' | 'high' | 'xhigh'} [reasoningEffort]
 * @property {boolean} [disableResume]
 * @property {Function} [onEvent]
 * @property {Function} [onElicitationRequest]
 * @property {object[]} [commands]
 * @property {string} [clientName]
 * @property {string} [configDir]
 * @property {object} [provider]
 */

/**
 * Presets de configuração reutilizáveis.
 */
export const CONFIG_PRESETS = {
  DEFAULTS: {
    streaming: true,
    infiniteSessions: { enabled: true, backgroundCompactionThreshold: 0.75 },
  },
  EXCLUDED_TOOLS_DEFAULT: ['powershell', 'web_fetch', 'web_search', 'memory'],
  SKILL_DIRECTORIES_DEFAULT: ['.github/skills'],
  WORKING_DIRECTORY_DEFAULT: '/workspaces/chatgpt-docker-puppeteer',
};

/**
 * Constrói SessionConfig completa com defaults canônicos. TODOS os campos suportados pelo SDK são aceitos.
 *
 * @param {UnifiedSessionConfigOptions} opts
 * @param {'create' | 'resume'} [mode='create'] Default is `'create'`
 * @returns {import('@github/copilot-sdk').SessionConfig}
 */
export function buildUnifiedSessionConfig(opts, mode = 'create') {
  // ... merge opts com DEFAULTS, aplicar excludedTools/availableTools,
  // ... adicionar skillDirectories, workingDirectory, etc.
}
```

### 2.6 Expansão de `sdk/client.js` — Features Faltantes

| Feature Faltante                    | Proposta                                              |
| ----------------------------------- | ----------------------------------------------------- |
| `client.getLastSessionId()`         | `getLastSessionId()` wrapper function                 |
| `client.getForegroundSessionId()`   | `getForegroundSessionId()` wrapper function           |
| `client.setForegroundSessionId(id)` | `setForegroundSessionId(id)` wrapper function         |
| `client.on('session.created')`      | `onSessionCreated(cb)` wrapper com unsub              |
| `client.on('session.deleted')`      | `onSessionDeleted(cb)` wrapper com unsub              |
| `client.listSessions(filter)`       | Unificar com `listSessions()` existente de session.js |

---

## §3. Unificação de Session Registry (Resolução P2)

### 3.1 Problema Atual

```
                   ┌─ Agent path: resumeOrCreate() → NÃO registrada ──┐
                   │                                                    │
CopilotClient ─────┤                                                    ├── INCONSISTÊNCIA
                   │                                                    │
                   └─ API path: createClientSession() → REGISTRADA ────┘
```

### 3.2 Solução Proposta: Registry Unificado

```javascript
// sdk/client.js — ATUALIZADO

// Registry global que rastreia TODAS as sessões (agent + API)
const _sessions = new Map(); // já existe

// Nova função: registerExternalSession()
export function registerExternalSession(session, meta = {}) {
  _sessions.set(session.sessionId, {
    session,
    model: meta.model ?? 'unknown',
    createdAt: Date.now(),
    messagesCount: 0,
    source: meta.source ?? 'external', // 'agent' | 'api' | 'external'
  });
}

// Atualizar resumeOrCreate em sdk/session.js para chamar registerExternalSession()
```

O `initializer.js` passará a registrar a sessão do agent no registry:

```javascript
// agent/session/initializer.js — MIGRADO
const result = await resumeOrCreate(client, savedSessionId, opts);
registerExternalSession(result.session, { model, source: 'agent' });
```

### 3.3 Resultado

```
                   ┌─ Agent: resumeOrCreate() + registerExternalSession() ──┐
                   │                                                         │
CopilotClient ─────┤                                             UNIFICADO  ├── _sessions Map
                   │                                                         │
                   └─ API: createClientSession() (já registra) ─────────────┘
```

---

## §4. Unificação de Config Builders (Resolução P1)

### 4.1 Migração dos 3 Caminhos

| Caminho Atual                                      | Ação                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `config/session-config.js::buildAlwaysAliveConfig` | **DEPRECATED** → redirecionar para `sdk/config.js::buildUnifiedSessionConfig` com preset 'always-alive' |
| `sdk/session.js::buildSessionConfig`               | **REMOVIDO** → lógica movida para `sdk/config.js::buildUnifiedSessionConfig`                            |
| `agent/session/initializer.js` config manual       | **MIGRADO** → chamar `buildUnifiedSessionConfig(opts)` em vez de construir objeto manualmente           |

### 4.2 Presets de Config

```javascript
// Presets para diferentes cenários de uso:

// Agent (AlwaysAlive) — config completo com hooks, tools, skills, MCP
const agentConfig = buildUnifiedSessionConfig({
  model: 'gpt-4.1',
  preset: 'always-alive', // aplica defaults: skills, excludedTools, infiniteSessions
  hooks: busHooks,
  tools: bootstrappedTools,
  mcpServers: buildMcpConfig(),
  onPermissionRequest: auditingHandler,
  onUserInputRequest: dialogHandler,
  systemMessage: hookContextMessage,
  customAgents: buildCustomAgentsConfig(),
});

// API (sessão avulsa) — config mínimo com defaults de segurança
const apiConfig = buildUnifiedSessionConfig({
  model: 'claude-sonnet-4-5',
  preset: 'api-default', // aplica: approveAll, streaming, infiniteSessions
  ...userProvidedFields,
});

// Read-Only (diagnóstico) — sem tools de escrita
const readOnlyConfig = buildUnifiedSessionConfig({
  model: 'gpt-4o-mini',
  preset: 'read-only',
});
```

---

## §5. Consolidação de Tipos (Resolução P4 + P10)

### 5.1 Estado Atual (3 fontes de tipos)

| Fonte                          | Linhas | Conteúdo                                      |
| ------------------------------ | -----: | --------------------------------------------- |
| `core/sdk-types.js`            |    112 | 13 typedefs re-exportando do SDK              |
| `hooks/types.js`               |    309 | 30+ typedefs, metade paralelos ao SDK         |
| Inline `@typedef` em ~30 files |      — | Cada arquivo importa tipos diretamente do SDK |

### 5.2 Target: Fontes Consolidadas

| Fonte                         | Conteúdo                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `sdk/types.js` (NOVO)         | TODOS os tipos SDK re-exportados (substitui `core/sdk-types.js`)                                       |
| `hooks/types.js` (ATUALIZADO) | Apenas tipos PRÓPRIOS do projeto (HookBus, HookRegistry, etc.). Tipos SDK importados de `sdk/types.js` |

### 5.3 Migração

```
core/sdk-types.js → DEPRECATED → re-exporta de sdk/types.js (backward compat)
hooks/types.js → Remove typedefs paralelos → importa de sdk/types.js
Inline @typedef em 30+ files → Importa de sdk/types.js via barrel
```

---

## §6. Migração de Imports — Plano Detalhado

### 6.1 `defineTool` (11 arquivos → sdk/tools.js)

```diff
// Em cada arquivo de tools:
- import { defineTool } from '@github/copilot-sdk';
+ import { defineTool } from '#copilot/sdk/tools';
```

**Opção progressiva**: Migrar para `buildTool` em vez de `defineTool` para ganhar logging
automático.

### 6.2 `approveAll` (5 arquivos → sdk/permissions.js)

```diff
- import { approveAll } from '@github/copilot-sdk';
+ import { approveAll } from '#copilot/sdk/permissions';
```

### 6.3 `CopilotClient` (2 arquivos → sdk/client.js)

```diff
// agent-lifecycle.js:
- import { CopilotClient } from '@github/copilot-sdk';
- const client = new CopilotClient(...);
+ import { createClient } from '#copilot/sdk/client';
+ const client = createClient({ telemetry: _otelConfig });
```

Nova função no wrapper:

```javascript
// sdk/client.js — adicionar:
export function createClient(options = {}) {
  return new CopilotClient(options);
}
```

### 6.4 `SYSTEM_PROMPT_SECTIONS` (1 arquivo → sdk/constants.js)

```diff
- import { SYSTEM_PROMPT_SECTIONS as SDK_SECTIONS } from '@github/copilot-sdk';
+ import { SYSTEM_PROMPT_SECTIONS as SDK_SECTIONS } from '#copilot/sdk/constants';
```

### 6.5 Tipos (15+ arquivos → sdk/types.js)

Tipos JSDoc podem continuar referenciando `@github/copilot-sdk` em comentários (já que não geram
runtime import), mas para consistência e facilidade de manutenção, recomendamos migrar para
`sdk/types.js`.

---

## §7. ESLint Rule — Enforcement

### 7.1 Regra de Importação Restrita

```javascript
// eslint.config.mjs — adicionar:
{
    files: ['src/copilot/**/*.js'],
    rules: {
        'no-restricted-imports': ['error', {
            patterns: [{
                group: ['@github/copilot-sdk'],
                message: 'Use #copilot/sdk/* em vez de @github/copilot-sdk diretamente. '
                       + 'A facade SDK centraliza todos os acessos ao SDK.',
                // Exceção: arquivos dentro de sdk/ podem importar diretamente
            }],
        }],
    },
},
{
    files: ['src/copilot/sdk/**/*.js'],
    rules: {
        'no-restricted-imports': 'off', // sdk/ é o único módulo que acessa o SDK
    },
}
```

### 7.2 Verificação

```bash
# Pré-migração: deve listar ~20 violações
npx eslint src/copilot/ --rule 'no-restricted-imports: error' --format compact

# Pós-migração: deve retornar 0 violações
```

---

## §8. Config Barrel Cleanup (Resolução P3)

### 8.1 Estado Atual

```javascript
// config/index.js mistura config com SDK internals:
export { BUILTIN_HANDLER_MAP, ... } from '#copilot/sdk/custom-tools';
export { getToolsConfig, ... } from '#copilot/sdk/tools-state';
```

### 8.2 Proposta

```javascript
// config/index.js — LIMPAR: remover re-exports de sdk/
// Consumidores devem importar diretamente de #copilot/sdk/custom-tools e #copilot/sdk/tools-state

// config/index.js — MANTER apenas:
export { ...sessionConfig } from './session-config.js';
export { ...mcpServers } from './mcp-servers.js';
export { ...systemPrompt } from './system-prompt.js';
export { ...customAgents } from './custom-agents.js';
export { ...pinnedFiles } from './pinned-files.js';
```

### 8.3 Migração de Consumidores

```diff
// Em arquivos que importam de config/:
- import { getToolsConfig } from '#copilot/config';
+ import { getToolsConfig } from '#copilot/sdk/tools-state';

- import { BUILTIN_HANDLER_MAP } from '#copilot/config';
+ import { BUILTIN_HANDLER_MAP } from '#copilot/sdk/custom-tools';
```

---

## §9. Hooks Types Alignment (Resolução P4)

### 9.1 Estratégia

O `hooks/types.js` define ~30 tipos. Destes:

- **12 são re-definições paralelas** de tipos SDK (SessionHooks, PreToolUseHandler, etc.)
- **18 são tipos próprios** do projeto (HookBus, HookBusEvent, HookSchema, AuditEntry, etc.)

### 9.2 Plano de Alinhamento

**Fase 1**: Tipos SDK → importar de `sdk/types.js`

```diff
// hooks/types.js:
- /** @typedef {object} SessionHooks ... */ (definição local)
+ /** @typedef {import('#copilot/sdk/types').SessionHooks} SessionHooks */
```

Nota: Se o SDK NÃO exporta `SessionHooks` como tipo (apenas como interface), mantemos a definição
local mas adicionamos validação:

```javascript
/** @type {SessionHooks extends import('@github/copilot-sdk').SessionConfig['hooks'] ? true : false} */
const _typeCheck = true;
```

**Fase 2**: Tipos próprios → manter em `hooks/types.js` com import dos SDK types

---

## §10. Impacto na Observability (§6.5 da 17A)

A observability layer (`defaultEventCollector.attach()`, `wrapWithStats()`) opera diretamente sobre
objetos `CopilotSession`. Isso NÃO precisa mudar — eles recebem o session object como parâmetro, não
importam do SDK.

A única mudança necessária é:

- `buildTelemetryConfig()` → atualmente importa tipos do SDK inline. Migrar typedefs para
  `sdk/types.js`.

---

## §11. Impacto no Agent Layer

### 11.1 Mudanças Necessárias no Agent

| Arquivo                          | Mudança                                                          |
| -------------------------------- | ---------------------------------------------------------------- |
| `agent-lifecycle.js`             | `new CopilotClient` → `createClient()` de `sdk/client.js`        |
| `agent-lifecycle.js`             | `boot-wiring.js` client.on() → wrappers de `sdk/client.js`       |
| `initializer.js`                 | Config manual → `buildUnifiedSessionConfig()` de `sdk/config.js` |
| `initializer.js`                 | Adicionar `registerExternalSession()` após criar sessão          |
| `infra/permission-controller.js` | `approveAll` → de `sdk/permissions.js`                           |
| `lifecycle/entry.js`             | `CopilotClient` tipo → de `sdk/types.js`                         |

### 11.2 Mudanças NÃO Necessárias

- `always-alive.js` — já delega para módulos que serão atualizados
- `agent-context.js` — usa tipos, não imports runtime
- `dialog/` — não importa do SDK diretamente
- `session/event-wirer.js` — recebe session como parâmetro
- `session/boot-wiring.js` — recebe client/session como parâmetros

---

## §12. Impacto no Channel / Terminal / Hub

Estes módulos **NÃO importam diretamente do SDK** — acessam o sdk via agent ou via API. Não requerem
mudanças na migração de imports.

---

## §13. Resumo de Arquivos a Criar/Modificar

### Novos Arquivos (5)

| Arquivo              | Linhas est. | Função                                |
| -------------------- | ----------: | ------------------------------------- |
| `sdk/tools.js`       |         ~60 | Re-exporta `defineTool` + `buildTool` |
| `sdk/permissions.js` |         ~40 | Re-exporta `approveAll` + presets     |
| `sdk/constants.js`   |         ~20 | Re-exporta `SYSTEM_PROMPT_SECTIONS`   |
| `sdk/types.js`       |        ~120 | Tipos SDK consolidados                |
| `sdk/config.js`      |        ~200 | Unified config builder + presets      |

### Arquivos Modificados (~35)

| Categoria                 | Arquivos | Mudança Principal                                  |
| ------------------------- | -------: | -------------------------------------------------- |
| tools/\*.js               |       11 | `defineTool` → `#copilot/sdk/tools`                |
| 5 arquivos com approveAll |        5 | `approveAll` → `#copilot/sdk/permissions`          |
| agent lifecycle           |        3 | `CopilotClient` → `sdk/client`, config unification |
| config/index.js           |        1 | Remover re-exports de sdk/                         |
| config/session-config.js  |        1 | Deprecated → redirect                              |
| core/sdk-types.js         |        1 | Deprecated → redirect to sdk/types.js              |
| hooks/types.js            |        1 | Alinhar tipos SDK com sdk/types.js                 |
| sdk/index.js              |        1 | Adicionar novos exports                            |
| sdk/client.js             |        1 | Adicionar createClient, register, foreground       |
| sdk/session.js            |        1 | Remover buildSessionConfig duplicado               |
| ESLint config             |        1 | Adicionar no-restricted-imports rule               |
| Demais (tipos inline)     |       ~8 | Migrar @typedef para sdk/types.js                  |

### Arquivos Deprecated (2)

| Arquivo                              | Substituto                |
| ------------------------------------ | ------------------------- |
| `core/sdk-types.js`                  | `sdk/types.js`            |
| `config/session-config.js` (parcial) | `sdk/config.js` (presets) |

---

## §14. Métricas de Sucesso

| Métrica                                                | Antes (rev.3 análise) |  Depois (alvo)   |
| ------------------------------------------------------ | --------------------: | :--------------: |
| Arquivos com `from '@github/copilot-sdk'` fora de sdk/ |                    20 |      **0**       |
| Caminhos de config de sessão                           |                     3 |      **1**       |
| Registros de sessão                                    |                     2 |      **1**       |
| Fontes de tipos SDK                                    |                     3 |      **1**       |
| ESLint violations (no-restricted-imports)              |                   N/A |      **0**       |
| Linhas no módulo sdk/                                  |                ~3.252 | **~3.700-4.000** |

---

## §15. Riscos e Mitigações

| Risco                                               | Probabilidade | Mitigação                                                     |
| --------------------------------------------------- | :-----------: | ------------------------------------------------------------- |
| Breaking changes no import refactor                 |     Alta      | Testes unitários existentes (3.101) validam cada mudança      |
| Regressão na criação de sessão (config unification) |     Média     | Testes de integração + comparação field-by-field antes/depois |
| SDK update quebra facade                            |     Baixa     | Facade isola — apenas sdk/\*.js precisa mudar                 |
| Consumidores external de `core/sdk-types.js`        |     Baixa     | Deprecated com re-export — backward compat total              |
| Performance impact (re-export layers)               |     Nula      | ESM tree-shaking; re-exports são zero-cost em runtime         |

---

_Documento gerado pela auditoria PARTE-17, rev.3. Proposta de situação ideal para SDK Facade
centralizado._
