# Arquitetura 3.0 — Propostas de Evolução do Módulo `src/copilot`

**Versão**: 3.0 (Proposta) | **Data**: 2026-03-15 | **Status**: 📋 Proposta para revisão e aprovação

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

| Categoria               | Qtd | Impacto                                      |
| ----------------------- | :-: | -------------------------------------------- |
| Shims legados na raiz   | 18  | Alto (DX, confusão de imports)               |
| Aliases inúteis em `api/`| 2  | Baixo (noise estrutural)                     |
| Imports deprecated ativos| 1  | Médio (orchestrator.js usa shim)             |
| Acesso direto a internals | 1  | Médio (routes/agent.js)                      |
| Timeout inconsistente   | 1   | Baixo (120s vs 130s)                         |
| Bloqueio de event loop  | 1   | Médio (execSync em task-tools.js)            |
| Potencial memory leak   | 1   | Médio (SSE ilimitado)                        |
| Migração DDL frágil     | 1   | Médio-alto (FTS5 a cada init)                |
| BUILTIN_HANDLER_MAP mínimo | 1 | Funcional (extensibilidade)                 |
| Estado global sem observers | 1 | Baixo-médio (race condition teórica)       |

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

### Fase 1 — Correções imediatas (sem reestruturação)

> Mudanças pontuais, baixo risco, não exigem migração de imports.

| ID | Proposta | Risco | Esforço |
| -- | -------- | :---: | :-----: |
| B1 | Corrigir import deprecated em `orchestrator.js` | Baixo | XS |
| B2 | Substituir `execSync + curl` em `task-tools.js` | Baixo | S |
| C1 | Centralizar timeouts em `core/constants.js` | Baixo | XS |
| G1 | Limite de clientes SSE em `bridge-stream.js` | Baixo | XS |
| H1 | Migração FTS5 idempotente (verificar versão antes) | Médio | S |

### Fase 2 — Encapsulamento e limpeza de API

| ID | Proposta | Risco | Esforço |
| -- | -------- | :---: | :-----: |
| D1 | Getters públicos `getToolsRegistry()` / `getTelemetry()` | Baixo | S |
| F1 | `state.js` reativo com EventEmitter interno | Médio | M |
| I1 | Expandir `BUILTIN_HANDLER_MAP` com handlers úteis | Baixo | S |
| A1 | Remover aliases inúteis (`copilot-router.js`, `sdk-router.js`) | Baixo | XS |

### Fase 3 — Limpeza de shims legados

> Requer mapeamento completo de callers externos ao módulo. Pode impactar `src/server/`, `ecosystem.config.cjs` e scripts de teste.

| ID | Proposta | Risco | Esforço |
| -- | -------- | :---: | :-----: |
| A2 | Auditoria de callers de cada shim | Baixo | S |
| A3 | Remover 13 shims `@deprecated` (exceto `sdk-client.js`) | Médio | M |
| A4 | Migrar callers de `sdk-client.js`, depois remover | Médio | M |

### Fase 4 — Reestruturação modular (Arquitetura 3.0)

> Reestruturação de pastas e consolidações. Requer plan de migração com alias temporários.

| ID | Proposta | Risco | Esforço |
| -- | -------- | :---: | :-----: |
| E1 | Consolidar `api/bridge-*.js` e `routes/*.js` em `api/v1/` | Médio | L |
| J1 | Extrair `tools/shell-tools.js` para `tools/shell/` com policy separada | Baixo | M |
| J2 | Unificar `config/tools-state.js` + `config/custom-tools-registry.js` em `config/tools/` | Baixo | S |
| J3 | Mover `terminal-server.js` (raiz) e eliminar confusão | Baixo | XS |
| J4 | Introduzir `core/constants.js` canônico para TIMEOUTS, MAX_*, defaults | Baixo | S |

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

| Arquivo                     | Constante             | Valor    |
| --------------------------- | --------------------- | -------- |
| `terminal/dialog.js`        | `TURN_TIMEOUT_MS`     | 120 000  |
| `channel/inject.js`         | `DEFAULT_TIMEOUT_MS`  | 130 000  |
| `agent/task-executor.js`    | timeout padrão        | 60 000   |
| `bridges/mcp-tool-bridge.js`| `MCP_TIMEOUT_MS`      | 8 000    |
| `channel/audit.js`          | rotação               | 10 MB    |
| `agent/always-alive.js`     | `MAX_QUEUE_SIZE`      | 100      |
| `tools/shell-tools.js`      | `MAX_OUTPUT_BYTES`    | 10 000   |
| `tools/shell-tools.js`      | `MAX_TIMEOUT_MS`      | 120 000  |

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

| ID  | Título                                      | Fase | Risco | Tamanho | Prioridade |
| --- | ------------------------------------------- | :--: | :---: | :-----: | :--------: |
| B1  | Fix import deprecated em orchestrator.js    | 1    | 🟢 Baixo | XS | 🔴 Alta |
| B2  | Substituir execSync+curl em task-tools.js   | 1    | 🟢 Baixo | S  | 🔴 Alta |
| C1  | Centralizar timeouts em core/constants.js   | 1    | 🟢 Baixo | S  | 🟡 Média |
| G1  | Limite MAX_SSE_CLIENTS em bridge-stream.js  | 1    | 🟢 Baixo | XS | 🟡 Média |
| H1  | Migração FTS5 idempotente                   | 1    | 🟡 Médio | S  | 🔴 Alta |
| D1  | Getters públicos em AlwaysAliveAgent        | 2    | 🟢 Baixo | S  | 🟡 Média |
| F1  | state.js reativo com EventEmitter           | 2    | 🟡 Médio | M  | 🟡 Média |
| I1  | Expandir BUILTIN_HANDLER_MAP               | 2    | 🟢 Baixo | S  | 🟢 Baixa  |
| A1  | Remover aliases inúteis api/               | 2    | 🟢 Baixo | XS | 🟡 Média |
| A2  | Auditar callers de shims                   | 3    | 🟢 Baixo | S  | 🟡 Média |
| A3  | Remover 13 shims @deprecated               | 3    | 🟡 Médio | M  | 🟡 Média |
| A4  | Migrar e remover sdk-client.js             | 3    | 🟡 Médio | M  | 🟢 Baixa  |
| E1  | Consolidar api/ e routes/                  | 4    | 🟡 Médio | L  | 🟢 Baixa  |
| J1  | Agrupar config/tools/*                     | 4    | 🟢 Baixo | S  | 🟢 Baixa  |
| J2  | Separar integrations/ de bridges/          | 4    | 🟡 Médio | M  | 🟢 Baixa  |
| J3  | core/constants.js robusto                  | 1    | 🟢 Baixo | S  | 🟡 Média |
| J4  | Extrair tools/shell/*                      | 4    | 🟢 Baixo | M  | 🟢 Baixa  |

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

| Métrica                      | Antes | Depois | Melhoria         |
| ---------------------------- | :---: | :----: | :--------------- |
| Total de arquivos            | ~101  | ~78    | −23 (+23%)       |
| Arquivos deprecated          | 18    | 0      | −100%            |
| Imports deprecated ativos    | 1     | 0      | Corrigido        |
| Race conditions potenciais   | 1     | 0      | Eliminada        |
| Memory leaks potenciais (SSE) | 1    | 0      | Controlado       |
| Execuções DDL por boot       | 1 FTS5 migration | 0 | Idempotência |
| Timeouts inconsistentes       | 3 valores | 1 canonical | Centralizado |
| Pastas top-level             | 12    | 13     | +1 (`integrations/`) |

---

*Proposta elaborada em: 2026-03-15 · Para aprovação e faseamento*
