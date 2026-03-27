# Arquitetura 3.0 — Propostas de Evolução do Módulo `src/copilot`

**Versão**: 3.0 (Proposta) | **Data**: 2026-03-15 | **Atualizado**: 2026-03-27 | **Status**: ✅ Fases 1–4 implementadas, Fase 5 planejada

> Este documento avalia a situação arquitetural atual do módulo `src/copilot` e propõe um conjunto de correções, melhorias e reestruturações para evoluir o módulo para a versão 3.0. Baseia-se na documentação oficial em `SRC-COPILOT-MODULO-OFICIAL.md` e na análise exaustiva do código-fonte.

---

## Índice

1. [Diagnóstico da Situação Atual](#1-diagnóstico-da-situação-atual)
2. [Roadmap por Prioridade](#2-roadmap-por-prioridade)
3. [Proposta A — Limpeza de Shims Legados](#3-proposta-a--limpeza-de-shims-legados)
4. [Proposta B — Correções de Bugs Arquiteturais](#4-proposta-b--correções-de-bugs-arquiteturais)
5. [Proposta C — Centralização de Constantes](#5-proposta-c--centralização-de-constantes)
6. [Proposta D — Encapsulamento do AlwaysAliveAgent](#6-proposta-d--encapsulamento-do-alwaysaliveagent)
7. [Proposta E — Consolidação de `api/` e `routes/`](#7-proposta-e--consolidação-de-api-e-routes)
8. [Proposta F — Estado Reativo no Terminal](#8-proposta-f--estado-reativo-no-terminal)
9. [Proposta G — SSE com Controle de Conexões](#9-proposta-g--sse-com-controle-de-conexões)
10. [Proposta H — Migração FTS5 Idempotente](#10-proposta-h--migração-fts5-idempotente)
11. [Proposta I — Expansão do BUILTIN_HANDLER_MAP](#11-proposta-i--expansão-do-builtin_handler_map)
12. [Proposta J — Reorganização Geral (Arquitetura 3.0)](#12-proposta-j--reorganização-geral-arquitetura-30)
13. [Matriz de Decisão e Faseamento](#13-matriz-de-decisão-e-faseamento)
14. [Estrutura de Pasta Alvo (Arquitetura 3.0)](#14-estrutura-de-pasta-alvo-arquitetura-30)
15. [Diagrama Comparativo Antes/Depois](#15-diagrama-comparativo-antesdepois)

---

## 1. Diagnóstico da Situação Atual

### 1.1 Resumo do Débito Técnico

| Categoria                   |  Qtd  | Impacto                              |                             Status                              |
| --------------------------- | :---: | ------------------------------------ | :-------------------------------------------------------------: |
| Shims legados na raiz       |  18   | Alto (DX, confusão de imports)       |                      ✅ Concluído (Fase 3)                       |
| Aliases inúteis em `api/`   |   2   | Baixo (noise estrutural)             |              ✅ Corrigido (A1 — arquivos removidos)              |
| Imports deprecated ativos   |   1   | Médio (orchestrator.js usa shim)     |                        ✅ Corrigido (B1)                         |
| Acesso direto a internals   |   1   | Médio (routes/agent.js)              |               ✅ Corrigido (D1 — casts removidos)                |
| Timeout inconsistente       |   1   | Baixo (120s vs 130s)                 |                        ✅ Corrigido (C1)                         |
| Bloqueio de event loop      |   1   | Médio (execSync em task-tools.js)    |                        ✅ Corrigido (B2)                         |
| Potencial memory leak       |   1   | Médio (SSE ilimitado)                |                        ✅ Corrigido (G1)                         |
| Migração DDL frágil         |   1   | Médio-alto (FTS5 a cada init)        |               ✅ Revisado (H1 — já estava correto)               |
| BUILTIN_HANDLER_MAP mínimo  |   1   | Funcional (extensibilidade)          | ✅ Corrigido (I1 — +3 handlers: process_info, uptime, math_eval) |
| Estado global sem observers |   1   | Baixo-médio (race condition teórica) |          ✅ Corrigido (F1 — stateEmitter EventEmitter)           |

### 1.2 Pontos Fortes (preservar)

- **12 camadas arquiteturais bem separadas** — cada uma com responsabilidade única
- **Sem side-effects no import** em toda a camada `lib/`
- **Segurança embutida** em `shell-tools.js` (blocklist, whitelist, cwd restrito)
- **Auditoria JSONL** com rotação automática de 10 MB
- **Dialog Loop §15.8** — zero custo por turno reutilizando o mesmo PR
- **FTS5 com Porter stemmer** para busca semântica em memórias
- **StructuredMessage tipado** com Zod (parceria LLM-A ↔ LLM-B)
- **Watchdog de inatividade** isolado em `dialog-watchdog.js` (testável)
- **Telemetria OTEL** com `startSpan()` e graceful degradation

---

## 2. Roadmap por Prioridade

### Fase 1 — Correções imediatas (sem reestruturação) ✅ IMPLEMENTADA

> Mudanças pontuais, baixo risco, não exigem migração de imports.

| ID  | Proposta                                         | Risco | Esforço |                              Status                               |
| --- | ------------------------------------------------ | :---: | :-----: | :---------------------------------------------------------------: |
| B1  | Corrigir import deprecated em `orchestrator.js`  | Baixo |   XS    |                                 ✅                                 |
| B2  | Substituir `execSync + curl` em `task-tools.js`  | Baixo |    S    |                                 ✅                                 |
| C1  | Centralizar timeouts em `core/constants.js`      | Baixo |   XS    |                                 ✅                                 |
| G1  | Limite de clientes SSE (`server.js`, `agent.js`) | Baixo |   XS    |                                 ✅                                 |
| H1  | Guard FTS5 migration                             | Médio |    S    | ✅ (já estava correto — `#initialized` guard + função idempotente) |

**Notas pós-implementação (Fase 1)**:

- **B1**: `orchestrator.js` agora importa diretamente de `../channel/client.js` (eliminado nível de indireção via shim raiz)
- **B2**: `task-tools.js` agora usa `node:http` assíncrono — sem bloqueio do event loop, sem dependência de `curl`; helper `httpRequest()` embutido com timeout configurável
- **C1**: `core/constants.js` exporta `LLM_B_TURN_TIMEOUT_MS` (padrão 120 000 ms, sobrescritível via `LLM_B_TURN_TIMEOUT`); `dialog.js` e `inject.js` agora Referem a essa constante — end de divergência 120 s vs 130 s
- **G1**: `core/constants.js` exporta `MAX_SSE_CLIENTS` (padrão 50, sobrescritível via `MAX_SSE_CLIENTS`); ambos os endpoints SSE (`/events` e `/api/sdk/agent/stream`) retornam HTTP 429 ao atingir o limite
- **H1**: Revisão confirmou que `init()` já possui guard `if (this.#initialized) return;` e `migrateFts5Tokenizer()` já é idempotente — nenhuma alteração necessária

### Fase 2 — Encapsulamento e limpeza de API ✅ IMPLEMENTADA

| ID  | Proposta                                                       | Risco | Esforço |                                           Status                                           |
| --- | -------------------------------------------------------------- | :---: | :-----: | :----------------------------------------------------------------------------------------: |
| D1  | Getters públicos `getToolsRegistry()` / `getTelemetry()`       | Baixo |    S    |        ✅ (getters já existiam; casts `@type {any}` removidos de `routes/agent.js`)         |
| F1  | `state.js` reativo com EventEmitter interno                    | Médio |    M    | ✅ (`stateEmitter` exportado; `hubSessionId:changed` e `busy:changed` emitidos nos setters) |
| I1  | Expandir `BUILTIN_HANDLER_MAP` com handlers úteis              | Baixo |    S    |                   ✅ (+3 handlers: `process_info`, `uptime`, `math_eval`)                   |
| A1  | Remover aliases inúteis (`copilot-router.js`, `sdk-router.js`) | Baixo |   XS    |                        ✅ (arquivos removidos — 0 callers externos)                         |

### Fase 3 — Limpeza de shims legados ✅ IMPLEMENTADA (commit ad0aecfe + 9bad4d14)

> Requer mapeamento completo de callers externos ao módulo. Pode impactar `src/server/`, `ecosystem.config.cjs` e scripts de teste.

| ID  | Proposta                                                | Risco | Esforço | Status |
| --- | ------------------------------------------------------- | :---: | :-----: | :----: |
| A2  | Auditoria de callers de cada shim                       | Baixo |    S    |   ✅    |
| A3  | Remover 13 shims `@deprecated` (exceto `sdk-client.js`) | Médio |    M    |   ✅    |
| A4  | Migrar callers de `sdk-client.js`, depois remover       | Médio |    M    |   ✅    |

**Notas pós-implementação (Fase 3)**:
- 12 shims removidos; mantidos apenas `agent.js` e `terminal-server.js` (PM2 entry points)
- 17+ arquivos-fonte + 16 test files migrados para imports canônicos
- `sdk-client.js` → `lib/client.js`; `onPermissionRequest: approveAll` injetado explicitamente em `routes/sessions.js`
- Novo alias `#copilot/session-manager` → `./agent/session-manager.js` adicionado ao `package.json`

### Fase 4 — Reestruturação modular (Arquitetura 3.0) ✅ IMPLEMENTADA (commit 759fb11a)

> Reestruturação de pastas e consolidações. Requer plan de migração com alias temporários.

| ID  | Proposta                                                                                | Risco | Esforço |                        Status                         |
| --- | --------------------------------------------------------------------------------------- | :---: | :-----: | :---------------------------------------------------: |
| E1  | Consolidar `api/bridge-*.js` e `routes/*.js` em `api/v1/`                               | Médio |    L    | ⏭️ De-priorizado: `api/sdk-api.js` já agrega `routes/` |
| J1  | Extrair `tools/shell-tools.js` para `tools/shell/` com policy separada                  | Baixo |    M    |    ✅ (corrigido `WORKSPACE_ROOT` — URL 3→4 níveis)    |
| J2  | Unificar `config/tools-state.js` + `config/custom-tools-registry.js` em `config/tools/` | Baixo |    S    |   ✅ (barrel `index.js` + 2 aliases `package.json`)    |
| J3  | Mover `terminal-server.js` (raiz) e eliminar confusão                                   | Baixo |   XS    | ⏭️ Intencional: entry point PM2 (não pode ser movido)  |
| J4  | Introduzir `core/constants.js` canônico para TIMEOUTS, MAX_*, defaults                  | Baixo |    S    |               ✅ Já existia desde Fase 1               |

**Notas pós-implementação (Fase 4)**:
- `tools/shell/index.js`: WORKSPACE_ROOT usa `'../../../..'` (4 níveis) para resolução correta após movimentação
- `config/tools/` com `state.js`, `registry.js`, `index.js` barrel
- 1466 testes unitários passando após a fase

### Fase 5 — Expansão e Consolidação de Tools

> Adicionar novas custom tools que ampliem as capacidades da LLM-B, consolidar o sistema de tools, e integrar recursos do SDK ainda não utilizados.

| ID  | Proposta                                                                 | Risco | Esforço |
| --- | ------------------------------------------------------------------------ | :---: | :-----: |
| K1  | Novas tools git: `git_push`, `git_create_branch`, `git_log`              | Baixo |    M    |
| K2  | Tool `patch_file` — edição cirúrgica por diff                            | Médio |    M    |
| K3  | Tools de contexto de sessão: `get_workspace_info`, `set_session_context` | Baixo |    S    |
| K4  | Tool `web_search` / `web_fetch` com rate-limit e política de segurança   | Médio |    L    |
| K5  | Migrar todas as tools para usar `tool-factory.js` (`buildTool`)          | Baixo |    M    |
| K6  | Criar `tools/git/index.js` consolidando `git-tools.js`                   | Baixo |    S    |
| K7  | Sub-agente `customAgents` configurável via `config/agents.js`            | Médio |    L    |
| K8  | Integrar `onUserInputRequest` SDK em `request_user_input` tool           | Baixo |    S    |

---

## 3. Proposta A — Limpeza de Shims Legados

### Situação atual

18 arquivos na raiz e em `api/`/`bridges/` são shims ou aliases sem conteúdo próprio:

```
src/copilot/
├── agent.js               → agent/entry.js
├── always-alive.js        → agent/always-alive.js
├── session-manager.js     → agent/session-manager.js
├── nerv-bridge.js         → bridges/nerv-bridge.js
├── gh-bridge.js           → bridges/gh-bridge.js
├── git-bridge.js          → bridges/git-bridge.js
├── http-bridge.js         → api/http-bridge.js
├── inject-llmb.js         → channel/inject.js (2 níveis)
├── llm-bridge-client.js   → channel/client.js (2 níveis)
├── mcp-tool-bridge.js     → bridges/mcp-tool-bridge.js
├── sdk-api.js             → api/sdk-api.js
├── alias-store.js         → bridges/alias-store.js
├── sdk-client.js          → lib/client.js (wrapper c/ remapeamento)
├── terminal-server.js     → terminal/index.js
│
├── api/copilot-router.js  → api/http-bridge.js
├── api/sdk-router.js      → api/sdk-api.js
│
├── bridges/inject-llmb.js → channel/inject.js (nível intermediário)
└── bridges/llm-bridge-client.js → channel/client.js (nível intermediário)
```

### Problema

- Aumentam artificialmente o inventário de arquivos
- Dificultam navegação (ex: pesquisar "http-bridge" retorna 3 arquivos)
- Cadeias de 2 níveis (`inject-llmb.js` → `bridges/inject-llmb.js` → `channel/inject.js`) são especialmente confusas
- O shim `sdk-client.js` oculta remapeamento de nomes, criando API fantasma

### Solução recomendada

**Passo 1**: Auditar todos os `import` no projeto apontando para esses shims:

```bash
grep -r "from.*src/copilot/agent\.js\|from.*copilot/agent'" --include="*.js" -l
grep -r "from.*always-alive\.js'" --include="*.js" -l
# etc.
```

**Passo 2**: Atualizar cada import para o caminho canônico.

**Passo 3**: Remover os shims.

**Exceção**: `sdk-client.js` requer análise prévia porque remapeia nomes:
```js
// sdk-client.js atual
export { createClientSession as createSdkSession } from './lib/client.js';
// ↑ Callers chamando createSdkSession() não compilarão após remoção direta
```
Solução: primeiro migrar callers para `lib/client.createClientSession()`, depois remover.

### Benefícios

- Reduz inventário de 101+ arquivos para ~83
- Elimina confusão de duplos e triplos níveis de indireção
- Grep e navegação de código ficam diretos

---

## 4. Proposta B — Correções de Bugs Arquiteturais

### B1: `conversation-hub/orchestrator.js` usa import deprecated

**Situação atual**:
```js
// orchestrator.js (linha ~10)
import { LlmBridgeClient } from '../llm-bridge-client.js'; // ← shim deprecated
```

**Solução**:
```js
import { LlmBridgeClient } from '../channel/client.js'; // ← canônico
```

**Risco**: Zero. Simples substituição de caminho.

---

### B2: `tools/task-tools.js` usa `execSync + curl` para chamadas internas

**Situação atual**:
```js
// task-tools.js — bloqueia o event loop
const result = execSync('curl -s http://127.0.0.1:3009/sessions', { encoding: 'utf8' });
```

**Problemas**:
1. `execSync` bloqueia o event loop do Node.js
2. Dependência de binário externo `curl`
3. Não tem tratamento de timeout
4. Quebra em ambientes sem `curl`

**Solução**:
```js
import { request } from 'node:http';

async function fetchLocalEndpoint(path) {
    return new Promise((resolve, reject) => {
        const req = request(
            { hostname: '127.0.0.1', port: 3009, path, method: 'GET' },
            (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(JSON.parse(data)));
            }
        );
        req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
        req.on('error', reject);
        req.end();
    });
}
```

**Risco**: Baixo. A lógica de negócio das tools não muda.

---

## 5. Proposta C — Centralização de Constantes

### Situação atual

Constantes de timeout espalhadas por vários arquivos:

| Arquivo                      | Constante            | Valor   |
| ---------------------------- | -------------------- | ------- |
| `terminal/dialog.js`         | `TURN_TIMEOUT_MS`    | 120 000 |
| `channel/inject.js`          | `DEFAULT_TIMEOUT_MS` | 130 000 |
| `agent/task-executor.js`     | timeout padrão       | 60 000  |
| `bridges/mcp-tool-bridge.js` | `MCP_TIMEOUT_MS`     | 8 000   |
| `channel/audit.js`           | rotação              | 10 MB   |
| `agent/always-alive.js`      | `MAX_QUEUE_SIZE`     | 100     |
| `tools/shell-tools.js`       | `MAX_OUTPUT_BYTES`   | 10 000  |
| `tools/shell-tools.js`       | `MAX_TIMEOUT_MS`     | 120 000 |

### Solução: `core/constants.js` canônico

```js
// src/copilot/core/constants.js

/** Timeouts em milissegundos */
export const TIMEOUTS = Object.freeze({
    /** Timeout padrão de um turno de diálogo no terminal */
    DIALOG_TURN_MS: 120_000,
    /** Timeout padrão de inject HTTP (LLM-A → LLM-B) */
    INJECT_HTTP_MS: 120_000,   // ← alinhar com DIALOG_TURN_MS
    /** Timeout de tarefa individual via session.sendAndWait */
    TASK_SEND_WAIT_MS: 60_000,
    /** Timeout de chamada MCP */
    MCP_RPC_MS: 8_000,
});

/** Limites de tamanho e quantidade */
export const LIMITS = Object.freeze({
    /** Tamanho máximo da fila de tarefas do agente */
    MAX_QUEUE_SIZE: 100,
    /** Máximo de bytes na saída de shell-tools */
    MAX_SHELL_OUTPUT_BYTES: 10_000,
    /** Máximo de timeout em shell-tools */
    MAX_SHELL_TIMEOUT_MS: 120_000,
    /** Tamanho de rotação do arquivo de auditoria JSONL */
    AUDIT_LOG_ROTATE_BYTES: 10_000_000,  // 10 MB
    /** Intervalo de heartbeat SSE */
    SSE_HEARTBEAT_MS: 15_000,
    /** Máximo de clientes SSE simultâneos (anti memory-leak) */
    MAX_SSE_CLIENTS: 50,
    /** Máximo de registros no buffer circular de telemetria */
    TELEMETRY_MAX_RECORDS: 500,
});

/** Valores padrão de configuração */
export const DEFAULTS = Object.freeze({
    /** Limiar de compaction background */
    BACKGROUND_COMPACTION_THRESHOLD: 0.75,
    /** Aviso de token budget */
    TOKEN_BUDGET_WARNING_PCT: 0.80,
    /** Aviso de token budget no resume */
    TOKEN_BUDGET_WARNING_RESUME_PCT: 0.70,
    /** Número máximo de tentativas de reconexão do agente */
    MAX_RECONNECT_ATTEMPTS: 5,
});
```

**Benefícios**: consistência, fácil ajuste, visibilidade imediata dos trade-offs.

---

## 6. Proposta D — Encapsulamento do `AlwaysAliveAgent`

### Situação atual

`routes/agent.js` acessa campos privados via cast inseguro:

```js
// routes/agent.js (linhas ~45-50)
const registry = /** @type {any} */ (alwaysAliveAgent).toolsRegistry;
const telemetry = /** @type {any} */ (alwaysAliveAgent).telemetry;
```

Isso contorna a visibilidade `#private` dos campos — qualquer refatoração interna do `AlwaysAliveAgent` pode quebrar silenciosamente essas rotas.

### Solução: getters públicos

```js
// agent/always-alive.js — adicionar ao final da classe

/** @returns {import('../lib/tools-registry.js').ToolRegistry | null} */
getToolsRegistry() {
    return this.#toolsRegistry;
}

/** @returns {import('../lib/telemetry.js').TelemetryStore | null} */
getTelemetry() {
    return this.#telemetry;
}
```

```js
// routes/agent.js — substituir casts
const registry = alwaysAliveAgent.getToolsRegistry();
const telemetry = alwaysAliveAgent.getTelemetry();
```

**Benefícios**: encapsulamento preservado, TypeScript pode verificar o tipo, refatorações internas são seguras.

---

## 7. Proposta E — Consolidação de `api/` e `routes/`

### Situação atual

Dois grupos de Express routers com responsabilidades diferentes mas sem separação clara de qual é para qual consumidor:

```
api/
├── http-bridge.js        # /api/copilot/* — controle do agente (para LLM-A, scripts)
├── bridge-control.js
├── bridge-dialog.js
├── bridge-stream.js
├── bridge-tasks.js
├── sdk-api.js            # /api/sdk/* — introspection, webhooks, sessões SDK
├── copilot-router.js     # ← alias inútil de http-bridge.js
└── sdk-router.js         # ← alias inútil de sdk-api.js

routes/
├── agent.js              # montado sob /api/sdk/agent
├── client.js             # montado sob /api/sdk/client
├── sessions.js           # montado sob /api/sdk/sessions
└── webhooks.js           # montado sob /api/sdk/webhooks
```

A confusão: `api/` contém tanto aggregators (`http-bridge.js`, `sdk-api.js`) quanto sub-routers (`bridge-*.js`). Os sub-routers de `routes/` são montados por `api/sdk-api.js`. Não fica claro onde adicionar um novo endpoint.

### Solução: Reorganização em namespaces explícitos

```
api/
├── index.js              # monta os dois grupos (copilot + sdk) no Express app
│
├── copilot/              # ex /api/copilot/*
│   ├── index.js          # aggregator (ex http-bridge.js)
│   ├── control.js        # GET /status /health /session; POST /start /stop
│   ├── tasks.js          # POST /send /answer
│   ├── stream.js         # GET /stream (SSE)
│   └── dialog.js         # POST /dialog/*
│
└── sdk/                  # ex /api/sdk/*
    ├── index.js          # aggregator (ex sdk-api.js)
    ├── agent.js          # GET /agent/*
    ├── client.js         # GET+POST /client/*
    ├── sessions.js       # CRUD /sessions/*
    └── webhooks.js       # CRUD /webhooks
```

**Migração**:
1. Criar estrutura nova sem remover a antiga
2. Mover conteúdo arquivos por arquivos
3. Adicionar re-exports temporários nos arquivos antigos
4. Atualizar `src/server/` para usar os novos caminhos
5. Remover re-exports e arquivos antigos

**Benefícios**:
- Fica óbvio onde adicionar novos endpoints
- Separação clara entre "API de controle do agente" e "API de introspection SDK"
- Elimina `routes/` como pasta separada (folding)

---

## 8. Proposta F — Estado Reativo no Terminal

### Situação atual

`terminal/state.js` expõe estado global via getters/setters simples:

```js
// state.js
let _busy = false;
export const getBusy = () => _busy;
export const setBusy = (v) => { _busy = v; };
```

Múltiplos módulos fazem polling implícito de `getBusy()`. Não há notificação quando o estado muda — consumidores precisam verificar por polling.

### Problema real

Se `state.js` for compartilhado entre `dialog.js`, `http-handlers.js` e o REPL, mutações concorrentes podem causar inconsistências (ex: dois `handleInject` concorrentes que veem `busy=false` ao mesmo tempo antes que o primeiro defina `busy=true`).

### Solução: Emitter interno + transição atômica

```js
// state.js — refatoração
import { EventEmitter } from 'node:events';

class TerminalState extends EventEmitter {
    #busy = false;
    #hubSessionId = /** @type {string|null} */ (null);
    #attachmentQueue = /** @type {string[]} */ ([]);

    /**
     * Tenta adquirir o lock de "busy".
     * @returns {boolean} true se conseguiu (era false → agora true), false se já estava busy
     */
    tryAcquireBusy() {
        if (this.#busy) return false;
        this.#busy = true;
        this.emit('busy:changed', true);
        return true;
    }

    releaseBusy() {
        this.#busy = false;
        this.emit('busy:changed', false);
    }

    get hubSessionId() { return this.#hubSessionId; }
    set hubSessionId(v) { this.#hubSessionId = v; this.emit('session:changed', v); }

    // ... demais getters/setters
}

export const terminalState = new TerminalState();
```

**Benefícios**:
- Elimina race condition de busy (tryAcquireBusy é atômico dentro do event loop Node.js single-thread)
- Permite listeners reativos em vez de polling
- EventEmitter é nativo, zero dependências extras

---

## 9. Proposta G — SSE com Controle de Conexões

### Situação atual

`api/bridge-stream.js` acumula listeners do `AlwaysAliveAgent` sem limite:

```js
// bridge-stream.js (sketch)
app.get('/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    // Sem limite de clientes
    for (const event of AGENT_EVENTS) {
        const handler = (data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        alwaysAliveAgent.on(event, handler);
        req.on('close', () => alwaysAliveAgent.off(event, handler));
    }
});
```

Conexões zombie (clientes que fecharam sem fechar a conexão HTTP) mantêm listeners ativos indefinidamente.

### Solução: Limite de clientes + cleanup robusto

```js
// bridge-stream.js
import { LIMITS } from '../core/constants.js';

const activeSseClients = new Set();

app.get('/stream', (req, res) => {
    if (activeSseClients.size >= LIMITS.MAX_SSE_CLIENTS) {
        return res.status(503).json({ error: 'Too many SSE clients' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    activeSseClients.add(res);

    const handlers = new Map();
    for (const event of AGENT_EVENTS) {
        const handler = (data) => {
            if (res.writableEnded) return;
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        handlers.set(event, handler);
        alwaysAliveAgent.on(event, handler);
    }

    const cleanup = () => {
        activeSseClients.delete(res);
        for (const [event, handler] of handlers) {
            alwaysAliveAgent.off(event, handler);
        }
    };

    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('close', cleanup);
});
```

**Benefícios**: previne memory leak por acúmulo de listeners; protege o servidor contra abuso.

---

## 10. Proposta H — Migração FTS5 Idempotente

### Situação atual

```js
// conversation-hub/store.js — método init()
async init() {
    // ...
    await this.migrateMemoriesFtsTokenizer(); // ← executa em CADA init()
}
```

O método `migrateMemoriesFtsTokenizer()` provavelmente faz operações DDL destrutivas (drop/recreate da tabela FTS5 virtual). Executar isso em cada inicialização em produção cria risco de:
1. Perda transitória de dados durante a migração
2. Lentidão no boot se há muitas memórias
3. Falha silenciosa se a migração falha na metade

### Solução: Versioning de schema

```js
// store.js — adicionar tabela de versões
async #initSchemaVersion() {
    this.#db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
            name TEXT PRIMARY KEY,
            version INTEGER NOT NULL DEFAULT 0
        )
    `);
}

async #getSchemaVersion(name) {
    return this.#db.prepare(
        'SELECT version FROM schema_version WHERE name = ?'
    ).get(name)?.version ?? 0;
}

async #setSchemaVersion(name, version) {
    this.#db.prepare(
        'INSERT OR REPLACE INTO schema_version (name, version) VALUES (?, ?)'
    ).run(name, version);
}

async init() {
    await this.#initSchemaVersion();

    // Migração FTS5 apenas se necessário (versão < 2)
    const ftsVersion = await this.#getSchemaVersion('memories_fts');
    if (ftsVersion < 2) {
        await this.#migrateMemoriesFtsTokenizer();
        await this.#setSchemaVersion('memories_fts', 2);
    }

    // ... resto do init
}
```

**Benefícios**: migração executada apenas uma vez; boot rápido após a primeira migração; seguro para hot-restart.

---

## 11. Proposta I — Expansão do `BUILTIN_HANDLER_MAP`

### Situação atual

O `config/custom-tools-registry.js` permite registrar custom tools via API sem reinicialização, mas tem apenas 3 handlers:

```js
export const BUILTIN_HANDLER_MAP = {
    echo: async ({ message }) => ({ result: message }),
    timestamp: async () => ({ timestamp: new Date().toISOString() }),
    env_read: async ({ key }) => ({ value: process.env[key] ?? null }),
};
```

Isso limita fortemente a utilidade do recurso — qualquer tool útil exige edição de código.

### Solução: Handlers práticos para operações comuns de agente

```js
export const BUILTIN_HANDLER_MAP = {
    // ── existentes ──
    echo: async ({ message }) => ({ result: message }),
    timestamp: async () => ({ timestamp: new Date().toISOString() }),
    env_read: async ({ key }) => ({ value: process.env[key] ?? null }),

    // ── novos: leitura de estado ──

    /** Retorna o snapshot do AgentStatus */
    agent_status: async () => alwaysAliveAgent.getStatusSnapshot(),

    /** Retorna uso de context window (tokens) */
    context_usage: async () => {
        const snap = alwaysAliveAgent.getStatusSnapshot();
        return { contextState: snap.contextState ?? null };
    },

    // ── novos: memória ──

    /** Busca memórias FTS5 */
    memory_search: async ({ query, limit = 5 }) =>
        conversationStore.searchMemories(query, limit),

    /** Grava memória */
    memory_write: async ({ content, tags }) => {
        const hubId = getHubSessionId();
        if (!hubId) throw new Error('No active hub session');
        return conversationStore.writeMemory(hubId, content, tags);
    },

    // ── novos: git ──

    /** Retorna `git status --short` */
    git_status_short: async () => {
        const { stdout } = await execFilePromise('git', ['status', '--short']);
        return { output: stdout.trim() };
    },

    // ── novos: filesystem ──

    /** Lê arquivo (max 50KB) */
    read_file: async ({ path }) => {
        const MAX = 50_000;
        const buf = await fs.readFile(path, 'utf8');
        return { content: buf.length > MAX ? buf.slice(0, MAX) + '\n[truncado]' : buf };
    },
};
```

**Benefícios**: extensibilidade real das custom tools via API; sem necessidade de editar código para casos de uso comuns.

---

## 12. Proposta J — Reorganização Geral (Arquitetura 3.0)

Esta proposta unifica as mudanças das fases anteriores em uma visão de estrutura de pasta alvo.

### J1: Unificar configurações de tools em `config/tools/`

**Atual**: dois arquivos no mesmo nível:
- `config/tools-state.js` — allowlist/denylist
- `config/custom-tools-registry.js` — registry dinâmico

**Proposta**:
```
config/
├── tools/
│   ├── state.js          ← ex tools-state.js
│   ├── registry.js       ← ex custom-tools-registry.js
│   └── index.js          ← barrel
├── session-config.js
├── system-prompt.js
├── mcp-servers.js
├── custom-agents.js
├── pinned-files-loader.js
└── index.js
```

### J2: Mover `bridges/gh-bridge.js` e `bridges/git-bridge.js` para `integrations/`

As bridges `gh` e `git` são integrações de CLI externas, não são integrations de sistema interno (como NERV). Separá-las melhora o mental model.

**Proposta**:
```
integrations/
├── git.js               ← ex bridges/git-bridge.js
├── gh.js                ← ex bridges/gh-bridge.js
└── mcp.js               ← ex bridges/mcp-tool-bridge.js

bridges/
├── nerv-bridge.js       ← permanece (é ponte interna do sistema)
└── alias-store.js       ← permanece (é estado interno do terminal)
```

### J3: Criar `core/constants.js` robusto

Ver [Proposta C](#5-proposta-c--centralização-de-constantes).

### J4: Extrair `tools/shell-tools.js` para `tools/shell/`

As shell-tools têm lógica de segurança complexa que merece módulo dedicado:

```
tools/
├── shell/
│   ├── index.js         ← entry point
│   ├── executor.js      ← execução assíncrona com limites
│   ├── policy.js        ← blocklist, whitelist, validações
│   └── sanitizer.js     ← filtragem de env vars, path validation
├── task-tools.js
├── code-tools.js
├── ...
```

**Benefícios**: separação da política de segurança da lógica de execução; testabilidade da policy sem executar comandos.

---

## 13. Matriz de Decisão e Faseamento

| ID  | Título                                       | Fase  |  Risco  | Tamanho | Prioridade |          Status           |
| --- | -------------------------------------------- | :---: | :-----: | :-----: | :--------: | :-----------------------: |
| B1  | Fix import deprecated em orchestrator.js     |   1   | 🟢 Baixo |   XS    |   🔴 Alta   |             ✅             |
| B2  | Substituir execSync+curl em task-tools.js    |   1   | 🟢 Baixo |    S    |   🔴 Alta   |             ✅             |
| C1  | Centralizar timeouts em core/constants.js    |   1   | 🟢 Baixo |    S    |  🟡 Média   |             ✅             |
| G1  | Limite MAX_SSE_CLIENTS em bridge-stream.js   |   1   | 🟢 Baixo |   XS    |  🟡 Média   |             ✅             |
| H1  | Migração FTS5 idempotente                    |   1   | 🟡 Médio |    S    |   🔴 Alta   |             ✅             |
| D1  | Getters públicos em AlwaysAliveAgent         |   2   | 🟢 Baixo |    S    |  🟡 Média   |             ✅             |
| F1  | state.js reativo com EventEmitter            |   2   | 🟡 Médio |    M    |  🟡 Média   |             ✅             |
| I1  | Expandir BUILTIN_HANDLER_MAP                 |   2   | 🟢 Baixo |    S    |  🟢 Baixa   |             ✅             |
| A1  | Remover aliases inúteis api/                 |   2   | 🟢 Baixo |   XS    |  🟡 Média   |             ✅             |
| A2  | Auditar callers de shims                     |   3   | 🟢 Baixo |    S    |  🟡 Média   |        ✅ Concluído        |
| A3  | Remover 13 shims @deprecated                 |   3   | 🟡 Médio |    M    |  🟡 Média   |        ✅ Concluído        |
| A4  | Migrar e remover sdk-client.js               |   3   | 🟡 Médio |    M    |  🟢 Baixa   |        ✅ Concluído        |
| E1  | Consolidar api/ e routes/                    |   4   | 🟡 Médio |    L    |  🟢 Baixa   |      ⏭️ De-priorizado      |
| J1  | Extrair tools/shell/index.js                 |   4   | 🟢 Baixo |    M    |  🟡 Média   |        ✅ Concluído        |
| J2  | config/tools/ subpasta unificada             |   4   | 🟢 Baixo |    S    |  🟡 Média   |        ✅ Concluído        |
| J3  | terminal-server.js entry point PM2           |   4   | 🟢 Baixo |   XS    |  🟢 Baixa   | ⏭️ Intencional — não mover |
| J4  | core/constants.js canônico                   |   1   | 🟢 Baixo |    S    |  🟡 Média   |        ✅ Concluído        |
| K1  | git_push, git_create_branch, git_log         |   5   | 🟢 Baixo |    M    |   🔴 Alta   |        ⬜ Pendente         |
| K2  | patch_file — edição cirúrgica                |   5   | 🟡 Médio |    M    |  🟡 Média   |        ⬜ Pendente         |
| K3  | get_workspace_info, set_session_context      |   5   | 🟢 Baixo |    S    |  🟡 Média   |        ⬜ Pendente         |
| K4  | web_fetch com rate-limit e segurança         |   5   | 🟡 Médio |    L    |   🔴 Alta   |        ⬜ Pendente         |
| K5  | Migrar todas as tools para buildTool         |   5   | 🟢 Baixo |    M    |  🟡 Média   |        ⬜ Pendente         |
| K6  | tools/git/index.js consolidado               |   5   | 🟢 Baixo |    S    |  🟢 Baixa   |        ⬜ Pendente         |
| K7  | customAgents config/agents.js                |   5   | 🟡 Médio |    L    |  🟡 Média   |        ⬜ Pendente         |
| K8  | onUserInputRequest SDK em request_user_input |   5   | 🟢 Baixo |    S    |   🔴 Alta   |        ⬜ Pendente         |

---

## 14. Estrutura de Pasta Alvo (Arquitetura 3.0)

Visão da estrutura depois de todas as fases completas:

```
src/copilot/
│
├── core/                       # Nível 0 — Contratos centrais
│   ├── constants.js            ← NOVO: TIMEOUTS, LIMITS, DEFAULTS canônicos
│   ├── errors.js
│   ├── types.js
│   └── index.js
│
├── lib/                        # Nível 1 — Abstrações SDK (sem side-effects)
│   ├── client.js
│   ├── session.js
│   ├── hooks.js
│   ├── permissions.js
│   ├── agents.js
│   ├── models.js
│   ├── tools-registry.js
│   ├── telemetry.js
│   └── index.js
│
├── types/                      # Nível 2 — Tipos de protocolo
│   ├── structured-message.js
│   └── index.js
│
├── agent/                      # Nível 3 — Agente Core
│   ├── always-alive.js         ← + getToolsRegistry() + getTelemetry()
│   ├── session-manager.js
│   ├── tools-bootstrap.js
│   ├── events.js
│   ├── task-executor.js
│   ├── dialog-watchdog.js
│   ├── webhook-manager.js
│   └── entry.js
│
├── tools/                      # Nível 4 — Custom Tools SDK
│   ├── shell/                  ← NOVO: pasta dedicada para shell tools
│   │   ├── index.js
│   │   ├── executor.js
│   │   ├── policy.js           ← blocklist, whitelist separados
│   │   └── sanitizer.js
│   ├── task-tools.js           ← usa http.request em vez de curl
│   ├── code-tools.js
│   ├── file-tools.js
│   ├── git-tools.js
│   ├── hook-tools.js
│   ├── hub-tools.js
│   ├── introspection-tools.js
│   ├── session-tools.js
│   ├── tool-factory.js
│   └── index.js
│
├── channel/                    # Nível 5 — Canal LLM-A ↔ LLM-B
│   ├── client.js
│   ├── inject.js
│   ├── audit.js
│   └── index.js
│
├── config/                     # Nível 6 — Configuração
│   ├── tools/                  ← NOVO: agrupamento das configs de tools
│   │   ├── state.js            ← ex tools-state.js
│   │   ├── registry.js         ← ex custom-tools-registry.js
│   │   └── index.js
│   ├── session-config.js
│   ├── system-prompt.js
│   ├── mcp-servers.js
│   ├── custom-agents.js
│   ├── pinned-files-loader.js
│   └── index.js
│
├── conversation-hub/           # Nível 7 — Hub de Conversa
│   ├── hub.js
│   ├── orchestrator.js         ← import corrigido para channel/client.js
│   ├── store.js                ← migração FTS5 idempotente
│   ├── socket-ns.js
│   └── index.js
│
├── bridges/                    # Nível 8 — Pontes internas do sistema
│   ├── nerv-bridge.js
│   └── alias-store.js
│
├── integrations/               # NOVO: Integrações CLI externas
│   ├── git.js                  ← ex bridges/git-bridge.js
│   ├── gh.js                   ← ex bridges/gh-bridge.js
│   └── mcp.js                  ← ex bridges/mcp-tool-bridge.js
│
├── api/                        # Nível 9 — API REST Express
│   ├── copilot/                ← NOVO: namespace explícito
│   │   ├── index.js            ← ex http-bridge.js
│   │   ├── control.js          ← ex bridge-control.js
│   │   ├── tasks.js            ← ex bridge-tasks.js
│   │   ├── stream.js           ← ex bridge-stream.js + MAX_SSE_CLIENTS
│   │   └── dialog.js           ← ex bridge-dialog.js
│   ├── sdk/                    ← NOVO: namespace explícito
│   │   ├── index.js            ← ex sdk-api.js
│   │   ├── agent.js            ← ex routes/agent.js
│   │   ├── client.js           ← ex routes/client.js
│   │   ├── sessions.js         ← ex routes/sessions.js
│   │   └── webhooks.js         ← ex routes/webhooks.js
│   └── index.js                ← monta copilot/ e sdk/ no app Express
│
├── terminal/                   # Nível 11 — Terminal Interativo
│   ├── index.js
│   ├── server.js
│   ├── repl.js
│   ├── dialog.js
│   ├── http-handlers.js
│   ├── state.js                ← reativo com EventEmitter
│   ├── file-context.js
│   ├── workspace-context.js
│   └── commands/               # 12 handlers de comando REPL
│
└── LLM-A-COMMUNICATION-GUIDE.md
```

**Arquivos removidos** (vs. situação atual):
- 14 shims raiz: `agent.js`, `always-alive.js`, `session-manager.js`, `nerv-bridge.js`, ..., `terminal-server.js`
- 2 aliases `api/`: `copilot-router.js`, `sdk-router.js`
- 2 bridges intermediárias: `bridges/inject-llmb.js`, `bridges/llm-bridge-client.js`
- `routes/` como pasta separada (folded em `api/sdk/`)

**Total de arquivos**: ~101 → ~78 (−23 arquivos)

---

## 15. Diagrama Comparativo Antes/Depois

### Antes (Arquitetura 2.0)

```
src/copilot/
├── [14 shims raiz]              ← confusão DX
├── agent/          [8 arquivos] ← OK
├── api/            [8 arquivos] ← inclui 2 aliases inúteis
├── bridges/        [7 arquivos] ← mistura: nerv + cli + legados
├── channel/        [4 arquivos] ← OK
├── config/         [8 arquivos] ← tools-state e registry no mesmo nível
├── conversation-hub/[5 arquivos] ← 1 import deprecated, FTS5 a cada init
├── core/           [4 arquivos] ← sem constants.js robusto
├── lib/            [9 arquivos] ← OK
├── routes/         [4 arquivos] ← separado de api/ sem motivo claro
├── terminal/       [22 arquivos]← state.js sem observers
├── tools/          [11 arquivos]← shell-tools monolítico
└── types/          [2 arquivos] ← OK

Total: ~101 arquivos com imports quebrados, shims, aliases e acoplamentos
```

### Depois (Arquitetura 3.0)

```
src/copilot/
├── agent/          [8 arquivos] ← + getters públicos
├── api/            [12 arquivos]← copilot/ + sdk/ namespaces, sem aliases
├── bridges/        [2 arquivos] ← apenas nerv + alias (internas)
├── channel/        [4 arquivos]
├── config/         [8 arquivos] ← tools/ subpasta agrupada
├── conversation-hub/[5 arquivos]← import correto, FTS5 idempotente
├── core/           [4 arquivos] ← + constants.js robusto
├── integrations/   [3 arquivos] ← git, gh, mcp (ex bridges/ misc)
├── lib/            [9 arquivos]
├── terminal/       [22 arquivos]← state.js reativo
├── tools/          [11 arquivos]← shell/ subpasta com policy separada
└── types/          [2 arquivos]

Total: ~83 arquivos. Zero shims. Zero aliases mortos. Imports corretos.
```

### Impacto esperado

| Métrica                       |      Antes       |   Depois    | Melhoria             |
| ----------------------------- | :--------------: | :---------: | :------------------- |
| Total de arquivos             |       ~101       |     ~78     | −23 (+23%)           |
| Arquivos deprecated           |        18        |      0      | −100%                |
| Imports deprecated ativos     |        1         |      0      | Corrigido            |
| Race conditions potenciais    |        1         |      0      | Eliminada            |
| Memory leaks potenciais (SSE) |        1         |      0      | Controlado           |
| Execuções DDL por boot        | 1 FTS5 migration |      0      | Idempotência         |
| Timeouts inconsistentes       |    3 valores     | 1 canonical | Centralizado         |
| Pastas top-level              |        12        |     13      | +1 (`integrations/`) |

---

---

## 16. Proposta K — Fase 5: Expansão e Consolidação de Tools

**Contexto**: O sistema conta hoje com 35 custom tools distribuídas em 9 módulos. A LLM-B herda automaticamente _todas_ as built-in tools do Copilot CLI (incluindo `read_file`, `write_file`, `edit_file`, `grep`, `glob`, `bash`, `web_search` e outras via `--allow-all`). As custom tools são **adicionais** — não substituem as built-ins, a menos que `overridesBuiltInTool: true` seja declarado. A Fase 5 preenche lacunas identificadas na comparação entre as capacidades da LLM-A (GitHub Copilot) e da LLM-B (custom agent).

### K1 — Novas tools Git (git_push, git_create_branch, git_log)

**Localização**: `src/copilot/tools/git-tools.js` (adição de tools)

**Motivação**: `git-tools.js` atual tem apenas `git_status`, `git_diff`, `git_changed_files`, `git_commit`. Faltam operações de branch e de push para workflows completos.

```js
// Novas tools propostas
defineTool('git_push', 'Faz push do branch atual para o origin', ...)
defineTool('git_create_branch', 'Cria e faz checkout de um novo branch', ...)
defineTool('git_log', 'Retorna o log de commits recentes', ...)
```

**Risco**: Baixo — operações git com validações de segurança (sem force-push por padrão).
**Esforço**: M

---

### K2 — Tool `patch_file` (edição cirúrgica por search-and-replace)

**Localização**: `src/copilot/tools/file-tools.js` (nova tool)

**Motivação**: O CLI tem `edit_file` built-in, mas a LLM-B necessita de uma custom tool para edições pontuais via `old_string` → `new_string` com contexto obrigatório (mesma semântica do replace_string_in_file do Copilot). Permite auditoria da ferramenta via hooks.

```js
defineTool('patch_file', 'Aplica uma substituição cirúrgica num arquivo', z.object({
    path: z.string(),
    old_string: z.string().describe('Texto exato a substituir (≥3 linhas de contexto)'),
    new_string: z.string().describe('Texto de substituição'),
}))
```

**Risco**: Médio — edição destrutiva; deve validar que `old_string` ocorre exatamente 1 vez.
**Esforço**: M

---

### K3 — Tools de contexto: `get_workspace_info`, `set_session_context`

**Localização**: `src/copilot/tools/session-tools.js` (novas tools)

**Motivação**: `get_session_state` existe mas é orientada ao sistema. Faltam tools para:
- `get_workspace_info`: retorna info do workspace (cwd, git root, branch, Node version, arquivos abertos)
- `set_session_context`: permite à LLM-B armazenar contexto em memória de sessão para resposta subsequente

**Risco**: Baixo — leitura e escrita em memória de sessão controlada.
**Esforço**: S

---

### K4 — Tool `web_fetch` com rate-limit e política de segurança

**Localização**: `src/copilot/tools/web-tools.js` (novo módulo)

**Motivação**: A LLM-A tem `fetch_webpage`. A LLM-B supostamente herda `web_search` / `web_fetch` do CLI, mas sem controle explícito de rate-limit, sem SSRF protection, sem allow-list de domínios. Uma custom tool traz:
- Validation de URL (bloquear `localhost`, IPs privados — anti-SSRF)
- Rate-limiting (máx N requests/min)
- Content-type filtering (apenas `text/*`)
- Timeout configurável

```js
defineTool('web_fetch', 'Busca o conteúdo de uma URL pública', z.object({
    url: z.string().url(),
    maxBytes: z.number().int().max(512_000).optional(),
}))
```

**Regras de segurança (OWASP A10 SSRF)**:
- Bloquear URLs com host `localhost`, `127.*`, `10.*`, `172.16-31.*`, `192.168.*`, `::1`, `fd*`
- Bloquear esquemas `file://`, `ftp://`, `data:`
- Apenas GET; sem redirect para hosts internos

**Risco**: Médio (SSRF se mal implementado — por isso é uma custom tool).
**Esforço**: L

---

### K5 — Migrar todas as tools para usar `buildTool` (tool-factory.js)

**Localização**: todos os `tools/*.js` e `tools/shell/index.js`

**Motivação**: `tool-factory.js` existe desde a Fase AI com `buildTool` que encapsula `defineTool` com logging automático, `skipPermission` por padrão e padrão JSDoc. Nenhuma tool atual usa `buildTool`. Migrar traz:
- Logging uniforme em cada invocação (`#core/logger`)
- Possibilidade de togglear `skipPermission` por grupo (read-only vs. write)
- Ponto central para métricas de uso

**Abordagem**:
1. Auditar `tool-factory.js` e completar sua implementação
2. Migrar `file-tools.js` (leitura) → `skipPermission: true`
3. Migrar `git-tools.js` (`git_status`, `git_diff`, `git_log`) → `skipPermission: true`
4. Restantes: `skipPermission: false` (padrão seguro)

**Risco**: Baixo — funcionalidade preservada, apenas refactor de como defineTool é chamado.
**Esforço**: M

---

### K6 — Reorganizar `git-tools.js` → `tools/git/index.js`

**Localização**: `src/copilot/tools/git-tools.js` → `src/copilot/tools/git/index.js`

**Motivação**: Seguindo o padrão de `tools/shell/index.js` (Fase 4 J1), `git-tools.js` também se beneficia de uma subpasta dedicada com `policy.js` separado (configuração de paths permitidos, branches proibidos para force-push, etc.).

```
tools/
├── git/
│   ├── index.js     ← tools: git_status, git_diff, git_changed_files, git_commit, git_push, git_create_branch, git_log
│   └── policy.js    ← ALLOWED_BRANCHES, MAX_COMMIT_MSG_LENGTH, etc.
```

**Risco**: Baixo — mesma mecânica da J1, ajuste de `import.meta.url` depth.
**Esforço**: S

---

### K7 — Configurar `customAgents` especializados

**Localização**: `src/copilot/lib/agents.js` + `src/copilot/lib/session.js`

**Motivação**: O SDK suporta `customAgents` na `SessionConfig` para criar sub-agentes especializados com tool subsets. Hoje `lib/agents.js` existe mas não é integrado na criação de sessão default. Proposta:

```js
customAgents: [
    {
        name: 'researcher',
        description: 'Agente de pesquisa somente-leitura',
        tools: readOnlyToolNames,   // apenas read_file, search, git_status, web_fetch
    },
    {
        name: 'implementer',
        description: 'Agente de implementação com acesso escrita',
        tools: allToolNames,
    }
]
```

**Risco**: Médio — requer testes de comportamento do SDK com customAgents.
**Esforço**: L

---

### K8 — Integrar `onUserInputRequest` do SDK na tool `request_user_input`

**Localização**: `src/copilot/lib/session.js` + `src/copilot/tools/hook-tools.js`

**Motivação**: `request_user_input` atual usa JSON-RPC próprio (via `task-tools.js`). O SDK tem `onUserInputRequest` que habilita o built-in `ask_user`, criando interface padrão que o CLI já conhece. Integrar:

```js
// sessionConfig
onUserInputRequest: async (prompt, options) => {
    // delegate to the existing dialog bridge (terminal/dialog.js)
    return await terminalDialog.request(prompt, options);
}
```

Após isso, a LLM-B pode usar `ask_user` built-in OU a custom `request_user_input` — redundância controlada.

**Risco**: Baixo — additive change, fallback para comportamento atual.
**Esforço**: S

---

### Resumo Fase 5

| ID  | Proposta                                | Prioridade | Esforço |
| --- | --------------------------------------- | :--------: | ------: |
| K1  | git_push, git_create_branch, git_log    |   🔴 Alta   |       M |
| K2  | patch_file (search-and-replace)         |  🟡 Média   |       M |
| K3  | get_workspace_info, set_session_context |  🟡 Média   |       S |
| K4  | web_fetch (anti-SSRF)                   |   🔴 Alta   |       L |
| K5  | Migrar tools para buildTool             |  🟡 Média   |       M |
| K6  | tools/git/index.js reorganizado         |  🟢 Baixa   |       S |
| K7  | customAgents especializados             |  🟡 Média   |       L |
| K8  | onUserInputRequest SDK integration      |   🔴 Alta   |       S |

**Ordem de execução sugerida**: K8 → K3 → K1 → K4 → K2 → K5 → K6 → K7

**Critério de conclusão da Fase 5**: todos os K1-K8 implementados, `npm run test:unit` 0 falhas, `npm run lint` 0 erros, tools novas com ≥1 teste unitário cada.

---

*Proposta elaborada em: 2026-03-15 · Fase 5 adicionada em: 2026-03-27 · Seções 18-20 adicionadas em: 2026-03-27 · Para aprovação e faseamento*

---

## 18. Análise Profunda: Herança CLI → LLM-B

> **Objetivo**: entender **como** a LLM-B herda capacidades da CLI Copilot, **o que** é herdado,
> e **o que precisa ser integrado melhor**.

### 18.1 Arquitetura da Comunicação

```
┌─────────────────────┐    JSON-RPC/stdio   ┌──────────────────────────────────┐
│  AlwaysAliveAgent   │◄───────────────────►│  @github/copilot CLI (bundled)   │
│  (Node.js process)  │                     │  node_modules/@github/copilot/   │
│                     │   CopilotClient      │  index.js                        │
│  src/copilot/agent/ │   .createSession()  │                                  │
│  always-alive.js    │                     │  ┌─────────────────────────────┐ │
└─────────────────────┘                     │  │  GitHub Copilot LLM Backend │ │
         │                                  │  │  (claude-sonnet-4.5 etc.)   │ │
         │ tools[] (custom)                 │  └─────────────────────────────┘ │
         └──────────────────────────────────►│  Built-in tools injetadas       │
                                            │  automaticamente na sessão       │
                                            └──────────────────────────────────┘
```

**Fluxo de herança**:

1. `CopilotClient` faz `spawn()` do CLI bundled em
   `node_modules/@github/copilot/index.js` via `stdio`
2. Protocolo JSON-RPC com `vscode-jsonrpc` — versão negociada (mínimo 2, máximo atual)
3. `client.createSession()` envia `session.create` com:
   - `tools[]` — nossas custom tools (registradas via `defineTool`)
   - `excludedTools[]` — tools builtin bloqueadas por política
   - `availableTools[]` — allowlist opcional
   - `mcpServers{}` — MCP servers a disponibilizar
   - `skillDirectories[]` — diretórios de skills YAML (atualmente `./.github/skills`)
4. A CLI injeta **automaticamente** suas built-in tools na sessão — a LLM-B as vê junto das custom tools
5. A LLM-B **não tem acesso ao código-fonte** — apenas aos schemas JSON de cada tool

### 18.2 Built-in Tools da CLI (inventário completo)

Listadas via `client.rpc.tools.list({})` no ambiente atual:

| #   | Nome                              | Categoria | Descrição resumida                                                          | Herdada pela LLM-B |
| --- | --------------------------------- | --------- | --------------------------------------------------------------------------- | :----------------: |
| 1   | `bash`                            | Shell     | Shell persistente interativo, sync e async, com suporte a detach/daemon     |         ✅          |
| 2   | `write_bash`                      | Shell     | Envia stdin para sessão bash async                                          |         ✅          |
| 3   | `read_bash`                       | Shell     | Lê stdout/stderr de sessão bash async                                       |         ✅          |
| 4   | `stop_bash`                       | Shell     | Termina sessão bash async                                                   |         ✅          |
| 5   | `list_bash`                       | Shell     | Lista sessões bash ativas                                                   |         ✅          |
| 6   | `str_replace_editor`              | File      | Editor de arquivos (view/create/str_replace/insert/undo_edit)               |         ✅          |
| 7   | `web_fetch`                       | Web       | HTTP GET/POST para URLs externas                                            |    ⚠️ bloqueada*    |
| 8   | `report_intent`                   | Meta      | Reporta intenção do agente ao usuário (feedback para UI CLI)                |         ✅          |
| 9   | `fetch_copilot_cli_documentation` | Meta      | Recupera documentação interna da CLI Copilot                                |         ✅          |
| 10  | `skill`                           | Agent     | Invoca skills YAML de `.github/skills/` como sub-rotinas                    |         ✅          |
| 11  | `ask_user`                        | Dialog    | Solicita input do usuário (habilita quando `onUserInputRequest` registrado) |        ✅**         |
| 12  | `grep`                            | Search    | grep em arquivos do workspace                                               |         ✅          |
| 13  | `glob`                            | Search    | glob pattern search em arquivos                                             |         ✅          |
| 14  | `task`                            | SubAgent  | Invoca sub-agente `task` do definitions/ (execução de comandos)             |         ✅          |

*`web_fetch` — bloqueada no `DEFAULT_EXCLUDED_TOOLS` de `session-config.js` (junto com `powershell`, `web_search`, `memory`). Razão: auditoria de segurança, substituída pela nossa `fetch_url`/`http_request` com anti-SSRF.

**`ask_user` — disponível apenas quando `onUserInputRequest` está registrado na SessionConfig. Já implementado no `always-alive.js` (linha 318).

### 18.3 Agents Built-in (Sub-agentes da CLI)

A CLI tem 5 agents YAML em `node_modules/@github/copilot/definitions/`:

| Agent               | Modelo            | Purpose              | Tools disponíveis                                                 |
| ------------------- | ----------------- | -------------------- | ----------------------------------------------------------------- |
| `task`              | claude-haiku-4.5  | Exec dev commands    | `*` (todas)                                                       |
| `explore`           | claude-haiku-4.5  | Codebase exploration | grep, glob, view, bash, lsp + GitHub MCP + Bluebird               |
| `research`          | claude-sonnet-4.6 | Staff-level research | GitHub MCP, web_fetch, web_search, task, grep, glob, view, create |
| `configure-copilot` | *(padrão)*        | Config wizard        | skills específicas                                                |
| `code-review`       | *(padrão)*        | Code review          | skills específicas                                                |

O agente `task` (invocado via `task` built-in) usa **todas as tools** — ou seja, a LLM-B pode delegar para `task` e esse sub-agente terá acesso a tudo. Isso é o mecanismo de sub-agentes nativo.

### 18.4 Skills YAML (`.github/skills/`)

A CLI carrega `skillDirectories: ['.github/skills']` — este projeto já usa isso na `session-manager.js` (linha 259). Skills YAML são invocadas via a tool `skill`:

```
.github/skills/
├── *.skill.yaml   ← arquivos de skill (se criados aqui)
```

Atualmente este projeto não tem skills customizadas criadas. A tool `skill` herda as skills da CLI mais qualquer YAML em `.github/skills/`.

### 18.5 GitHub MCP Server Nativo da CLI

O agente `explore` usa `github-mcp-server/get_file_contents`, `github-mcp-server/list_issues` etc. Este é o **servidor MCP nativo** embutido na CLI — diferente do `@modelcontextprotocol/server-github` que temos configurado.

**Dois servidores distintos**:
1. **`github-mcp-server` (nativo CLI)**: embutido no CLI bundled, não precisa de `npx`, usa o auth do token do usuário autenticado. Disponível automaticamente nos sub-agentes `explore`/`research` que o referenciam.
2. **`@modelcontextprotocol/server-github` (npm)**: servidor externo que precisamos lançar via `npx`, configurado em `MCP_SERVERS.github` no `mcp-servers.js`.
3. **GitHub API MCP HTTP**: servidor oficial em `https://api.githubcopilot.com/mcp/` — acessível via `MCPRemoteServerConfig` com `type: 'http'`.

### 18.6 O Que a LLM-B Herda Automaticamente

Quando uma sessão é criada **sem** `availableTools` nem `excludedTools`, a LLM-B herda:

- **Todas as 14 built-in tools** da CLI
- **Todas as custom tools** passadas em `tools[]`
- **Tools dos MCP servers** configurados em `mcpServers{}`
- **Sub-agente `task`** via a built-in `task` tool
- **Skills** de `.github/skills/`

Com a configuração atual (`DEFAULT_EXCLUDED_TOOLS`), a LLM-B recebe 14 - 4 = **10 built-in tools** + nossas **43 custom tools** = **~53 tools totais** (excluindo MCP).

### 18.7 Diferença: GitHub Copilot (eu) vs LLM-B

O **GitHub Copilot** (este assistente integrado ao VS Code) tem acesso a ferramentas específicas do ambiente IDE:
- `run_in_terminal`, `create_file`, `replace_string_in_file`, `read_file`, `get_errors` etc.
- Ferramentas de workspace VS Code, notebook, browser automation
- MCP tools de servidores configurados para o workspace VS Code

A **LLM-B** (AlwaysAliveAgent) tem:
- Built-in tools CLI (bash, grep, glob, str_replace_editor etc.)
- Nossas 43 custom tools (git, file, web, session, task, hub etc.)
- Sub-agentes via `task`, `explore`, `research`
- Acesso via MCP servers configurados

**Gaps antes da Fase 6** (tools que eu tenho e a LLM-B não tinha):
- `web_fetch` → substituída por `fetch_url`/`http_request` com anti-SSRF ✅
- `patch_file` / str_replace → coberta por `patch_file` ✅ e `str_replace_editor` (built-in CLI) ✅
- Subagentes especializados → `task` built-in existe, falta `customAgents` configurados (K7)
- `web_search` → bloqueada no DEFAULT_EXCLUDED_TOOLS, ainda sem alternativa interna

---

## 19. Proposta L — Fase 6: Sub-agentes, Skills e Integração Avançada

> **Motivação**: Após inventariar os gaps Fase 5, a Fase 6 foca em capacidades de **orquestração avançada**:
> sub-agentes customizados (`customAgents`), as skills YAML, MCP server GitHub oficial, e polimento geral.

### 19.1 Roadmap Fase 6

| ID  | Proposta                                      | Prioridade | Esforço |
| --- | --------------------------------------------- | :--------: | ------: |
| L1  | K7 carry-over: customAgents especializados    |   🔴 Alta   |       L |
| L2  | GitHub MCP server HTTP oficial                |   🔴 Alta   |       S |
| L3  | Skills YAML nativas (.github/skills/)         |  🟡 Média   |       M |
| L4  | web_search tool (alternativa segura)          |  🟡 Média   |       M |
| L5  | mcp-servers: suporte dinâmico via config.json |  🟡 Média   |       S |
| L6  | Audit: DEFAULT_EXCLUDED_TOOLS revisão         |  🟢 Baixa   |       S |
| L7  | memory MCP tool — gestão de contexto longo    |  🟢 Baixa   |       M |

### 19.2 L1 — customAgents Especializados

O SDK suporta `customAgents` na `SessionConfig`:

```js
customAgents: [
    {
        name: 'architect',
        displayName: 'Architect Agent',
        description: 'Analisa arquitetura, propõe refatorações e documenta decisões.',
        tools: ['grep', 'glob', 'str_replace_editor', 'bash'],
        model: 'claude-sonnet-4.6',
        prompt: fs.readFileSync('.github/agents/architect.md', 'utf8'),
    },
    {
        name: 'tester',
        displayName: 'Tester Agent',
        description: 'Escreve e executa testes unitários e de integração.',
        tools: ['bash', 'str_replace_editor', 'grep'],
        model: 'claude-haiku-4.5',
        prompt: fs.readFileSync('.github/agents/tester.md', 'utf8'),
    }
]
```

Esses agentes ficam disponíveis como sub-agentes que a LLM-B pode invocar via a interface padrão.

**Localização de prompts**: `.github/agents/*.md`

### 19.2 L2 — GitHub MCP Server HTTP Oficial

Adicionar ao `mcp-servers.js` o servidor oficial GitHub via tipo `http`:

```js
'github-official': {
    type: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN ?? ''}`,
    },
},
```

Isso dá à LLM-B acesso à mesma API GitHub que os agentes built-in `explore`/`research` usam, sem precisar de `npx`.

### 19.3 L3 — Skills YAML Nativas

Criar skills YAML em `.github/skills/` para capacidades recorrentes:

```yaml
# .github/skills/diagnose-system.skill.yaml
name: diagnose-system
description: Diagnóstico completo do sistema (PM2, logs, ports, health)
prompt: |
  Execute os seguintes diagnósticos em paralelo:
  1. Status PM2: npm run pm2:status
  2. Health check: npm run health:core
  3. Portas em uso: lsof -i :3009 -i :3001 -i :3000
  Consolide e reporte quaisquer problemas encontrados.
```

Skills são invocadas via `skill` built-in — a LLM-B pode orquestrar diagnósticos complexos em uma chamada.

### 19.4 Resumo Herança CLI→LLM-B (visão condensada)

```
CLI Built-in (14 tools)
  ├── bash/write_bash/read_bash/stop_bash/list_bash  → Shell completo
  ├── str_replace_editor                             → Editor multi-operação
  ├── web_fetch (bloqueada)                          → Substituída por fetch_url
  ├── grep / glob                                    → Search
  ├── task (sub-agente)                              → Delegação de execução
  ├── skill                                          → Skills YAML
  ├── ask_user                                       → Dialog com usuário
  ├── report_intent                                  → Feedback para UI
  └── fetch_copilot_cli_documentation                → Auto-referência

Custom Tools (43 — pós-Fase 5)
  ├── git/           → 8 tools (status, diff, commit, add, push, branch, log, stash)
  ├── file/          → 9 tools (read, write, create, delete, copy, move, find, search, patch)
  ├── shell/         → 3 tools (exec, spawn, env_get)
  ├── session/       → 4 tools (state, workspace_info, context, close)
  ├── hub/           → 5 tools (conversation, history, turn management)
  ├── hook/          → 3 tools (lifecycle hooks)
  ├── introspection/ → 3 tools (registry, capabilities, status)
  ├── task/          → 4 tools (task CRUD)
  ├── code/          → 3 tools (lint, format, types)
  └── web/           → 2 tools (fetch_url, http_request)

MCP Servers (configuráveis)
  ├── github-official (HTTP)  → 36 GitHub API tools via MCP
  ├── filesystem (stdio)      → file system access estruturado
  └── memory (stdio)          → grafos de conhecimento

Sub-agentes
  ├── task (built-in)         → execução de comandos de dev
  ├── explore (built-in)      → exploração de codebase
  ├── research (built-in)     → pesquisa staff-level
  └── customAgents (Fase 6)   → architect, tester, etc.
```

---

## 20. Gap Analysis: LLM-B vs GitHub Copilot IDE

Esta seção compara as capacidades do **GitHub Copilot** (assistente IDE) com a **LLM-B** (AlwaysAliveAgent).

### 20.1 Tabela Comparativa

| Capacidade                   |   GitHub Copilot (IDE)   |               LLM-B pós-Fase 5               | Gap / Observação        |
| ---------------------------- | :----------------------: | :------------------------------------------: | ----------------------- |
| Shell execution              |    ✅ run_in_terminal     |               ✅ bash built-in                | Equivalente             |
| File read                    |       ✅ read_file        |   ✅ str_replace_editor + read_file custom    | Coberto                 |
| File write/edit              | ✅ replace_string_in_file |      ✅ str_replace_editor + patch_file       | Coberto                 |
| File create                  |      ✅ create_file       |             ✅ create_file custom             | Coberto                 |
| Codebase search (regex)      |      ✅ grep_search       |               ✅ grep built-in                | Equivalente             |
| Codebase search (glob)       |      ✅ file_search       |               ✅ glob built-in                | Equivalente             |
| Semantic code search         |    ✅ semantic_search     |     ✅ bluebird tools (via explore agent)     | Via sub-agente          |
| Web fetch                    |     ✅ fetch_webpage      |          ✅ fetch_url + http_request          | Coberto (com anti-SSRF) |
| Web search                   |      ✅ Bing/Google       |            ❌ web_search bloqueada            | **Gap** — L4            |
| GitHub issues/PRs            |       ✅ MCP tools        |   ⚠️ via github-official MCP (L2 pendente)    | L2                      |
| Sub-agentes                  |      ✅ runSubagent       | ⚠️ task/explore built-ins + customAgents (L1) | L1                      |
| Memory persistente           |      ✅ memory tool       |  ❌ memory bloqueada (MCP memory disponível)  | L7                      |
| VS Code API                  |   ✅ run_vscode_command   |          ❌ N/A (processo separado)           | N/A                     |
| Error analysis (get_errors)  |       ✅ get_errors       |             ⚠️ via bash + eslint              | Workaround              |
| Code execution (notebooks)   |   ✅ run_notebook_cell    |                    ❌ N/A                     | N/A                     |
| Dialog com usuário           |        ✅ implicit        |       ✅ ask_user + request_user_input        | Coberto                 |
| Git operations               |    ✅ git via terminal    |         ✅ 8 custom git tools + bash          | Coberto                 |
| Skills/Agents especializados |      ✅ runSubagent       |   ⚠️ 5 built-in agents + customAgents (L1)    | L1                      |

### 20.2 Prioridades de Fechamento de Gap para Fase 6

1. **L2** (GitHub MCP HTTP): 1 linha de config — impacto alto
2. **L1** (customAgents): varias linhas de YAML + config — impacto alto
3. **L4** (web_search): nova tool segura — impacto médio
4. **L3** (skills YAML): 2-3 arquivos YAML — impacto médio
5. **L7** (memory MCP): configurar server + remover do excluded — impacto baixo
