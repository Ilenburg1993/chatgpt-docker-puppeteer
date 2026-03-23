# SDK Copilot — Investigação Profunda e API Completa

**Status**: Ativo — Sprints 15–16c concluídos; Sprints 17–24 em andamento **Data**: 2026-03-23 |
**Baseado em**: SDK v0.2.0 (lançado 2026-03-20, npm oficial) **SDK instalado**: v0.1.32 → upgrade
para v0.2.0 imminente (Sprint 18, sem breaking changes)

---

## Sumário executivo

Este documento descreve:

1. **Tudo que o SDK `@github/copilot-sdk` permite** — surfaced a partir da documentação oficial
2. **Lacunas** entre o que já está implementado em `src/copilot` e o que é possível
3. **Estrutura de pastas reorganizada** que espelha todas as capacidades do SDK
4. **API completa** a ser construída — um módulo para cada responsabilidade do SDK

---

## Parte I — Mapa completo do SDK v0.2.0

### 1. `CopilotClient` — cliente principal

```js
import { CopilotClient } from '@github/copilot-sdk';

// Opções do construtor
const client = new CopilotClient({
  // Conectar a CLI local (default) or remota
  cliUrl: 'localhost:4321', // se CLI já está rodando em modo server

  // Telemetria OpenTelemetry (v0.2.0)
  telemetry: {
    otlpEndpoint: 'http://localhost:4318',
    sourceName: 'my-app',
    filePath: './traces.jsonl', // alternativa ao OTLP
    exporterType: 'otlp-http' | 'file',
    captureContent: false,
  },

  // Custom model listing para BYOK (v0.2.0)
  onListModels: async () => [
    /* modelos customizados */
  ],
});

await client.start();
```

**Métodos do client:**

| Método                            | Descrição                      |
| --------------------------------- | ------------------------------ |
| `client.createSession(config)`    | Cria nova sessão               |
| `client.resumeSession(id, opts?)` | Retoma sessão persistida       |
| `client.listSessions(filter?)`    | Lista sessões ativas/salvas    |
| `client.deleteSession(sessionId)` | Remove sessão permanentemente  |
| `client.listModels()`             | Lista modelos disponíveis      |
| `client.start()`                  | Inicia cliente (gerencia CLI)  |
| `client.stop()`                   | Para cliente e CLI             |
| `client.getLastSessionId()`       | ID da última sessão (v0.1.31+) |

---

### 2. `SessionConfig` — configuração completa de sessão

```js
const session = await client.createSession({
  // ─── Identidade ────────────────────────────────────────────────────
  sessionId: 'my-task-123',          // session persistente (sem ID = não resumível)
  model: 'gpt-4.1',                  // modelo inicial

  // ─── Tools ─────────────────────────────────────────────────────────
  tools: [myTool1, myTool2],         // tools customizadas (defineTool)
  availableTools: ['read_file'],     // whitelist de built-ins
  excludedTools: ['shell'],          // blacklist de built-ins

  // ─── Permissões ─────────────────────────────────────────────────────
  onPermissionRequest: async (req) => ({ kind: 'approved' }),

  // ─── Hooks ──────────────────────────────────────────────────────────
  hooks: {
    onSessionStart: async (input, inv) => ({ additionalContext: '...' }),
    onUserPromptSubmitted: async (input) => ({ modifiedPrompt: '...' }),
    onPreToolUse: async (input) => ({ permissionDecision: 'allow'|'deny'|'ask' }),
    onPostToolUse: async (input) => ({ modifiedResult: '...' }),
    onSessionEnd: async (input, inv) => null,
    onErrorOccurred: async (input) => ({
      errorHandling: 'retry', retryCount: 3,
      userNotification: '...',
    }),
  },

  // ─── Custom Agents ───────────────────────────────────────────────────
  customAgents: [{
    name: 'researcher',
    displayName: 'Research Agent',
    description: 'Explores codebases',
    tools: ['grep', 'glob', 'view'],   // null = todos
    prompt: 'You are a read-only code analyst...',
    mcpServers: { ... },
    infer: true,                       // auto-select por intent
  }],
  agent: 'researcher',                 // pre-selecionar agente (v0.2.0)

  // ─── MCP Servers ─────────────────────────────────────────────────────
  mcpServers: {
    'my-server': {
      type: 'local',
      command: 'node', args: ['./mcp.js'],
      env: {}, cwd: './',
      tools: ['*'],
      timeout: 30000,
    },
    'remote': {
      type: 'http',
      url: 'https://...', headers: {},
      tools: ['*'],
    },
  },

  // ─── Skills ──────────────────────────────────────────────────────────
  skillDirectories: ['./skills/code-review'],
  disabledSkills: ['experimental'],

  // ─── Sistema Prompt (v0.2.0) ─────────────────────────────────────────
  systemMessage: {
    content: 'Instrução global...',     // modo simples (append)
    mode: 'customize',                  // modo cirúrgico
    sections: {
      identity:       { action: (current) => current.replace('X','Y') },
      tone:           { action: 'replace', content: 'Be concise.' },
      code_change_rules: { action: 'remove' },
      guidelines:     { action: 'append', content: '* Always cite sources' },
      // Seções disponíveis:
      // identity, tone, tool_efficiency, environment_context,
      // code_change_rules, guidelines, safety, tool_instructions,
      // custom_instructions, last_instructions
    },
  },

  // ─── Streaming ────────────────────────────────────────────────────────
  streaming: true,
  onEvent: async (event) => { ... },    // catch-all (v0.2.0)

  // ─── Sessão infinita (compaction) ────────────────────────────────────
  infiniteSessions: {
    enabled: true,
    backgroundCompactionThreshold: 0.80,
    bufferExhaustionThreshold: 0.95,
  },

  // ─── Outros ──────────────────────────────────────────────────────────
  workingDirectory: '/workspaces/...',
  configDir: '~/.copilot',
  reasoningEffort: 'high',
  provider: { type: 'azure', ... },    // BYOK
});
```

---

### 3. `defineTool` — definição de tool customizada

```js
import { defineTool } from '@github/copilot-sdk';

const myTool = defineTool('tool_name', {
  description: 'O que a tool faz',
  parameters: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: '...' },
    },
    required: ['param1'],
  },
  handler: async (args) => {
    // Retornar string ou objeto
    return { result: '...' };
  },

  // ── Capacidades v0.1.30+ ──
  skipPermission: true, // bypass de confirmação para ops seguras (v0.2.0 / #808)
  overridesBuiltInTool: true, // permite sobrescrever read_file, edit_file, grep, etc. (v0.1.30 / #636)
});
```

**`skipPermission`** — aplica-se diferentemente por tipo de permissão:

- Tools de leitura: `lint_check`, `run_tests`, `git_status`, `git_diff`, `get_tasks`,
  `read_briefing`, `hook_get_audit_tail` → usar `skipPermission: true`
- Tools de escrita: `git_commit`, `add_task`, `write_pending_task` → manter com confirmação
- Tools destrutivas: sempre confirmar

---

### 4. `session` — API do objeto de sessão

```js
// ─── Envio de mensagens ──────────────────────────────────────────────
await session.send({ prompt: '...', attachments: [...] });
const res = await session.sendAndWait({ prompt: '...', mode: 'interactive'|'plan'|'autopilot' });

// ─── Attachments (v0.2.0 — blob) ─────────────────────────────────────
await session.send({
  prompt: 'Analise esta imagem',
  attachments: [
    { type: 'file', path: '/path/to/file' },
    { type: 'directory', path: '/path/to/dir' },
    { type: 'blob', data: base64String, mimeType: 'image/png' },  // ← NOVO v0.2.0
    { type: 'github', repository: 'owner/repo', ref: 'main' },
  ],
});

// ─── Subscription a eventos ────────────────────────────────────────────
session.on((event) => { /* todos os eventos */ });
session.on('assistant.message_delta', (event) => { /* delta específico */ });

// ─── Controle de modelo ────────────────────────────────────────────────
await session.setModel('gpt-4.1');            // v0.1.30
await session.setModel('claude-sonnet-4', { reasoningEffort: 'high' });  // v0.2.0

// ─── Resposta a requisições ────────────────────────────────────────────
await session.respondToPermission(requestId, { kind: 'approved' });
await session.respondToUserInput(requestId, { answer: 'yes' });
await session.respondToElicitation(requestId, { data: { field: 'value' } });
await session.respondToExternalTool(requestId, { result: '...' });
await session.respondToExitPlanMode(requestId, { action: 'approve' });
await session.respondToQueuedCommand(requestId, { action: 'execute' });

// ─── Session log (v0.2.0) ─────────────────────────────────────────────
await session.log('Processando tarefa...', 'info', false);   // ephemeral=false → persiste
await session.log('Debug interno', 'debug', true);            // ephemeral=true → não persiste

// ─── Ciclo de vida ────────────────────────────────────────────────────
await session.disconnect();    // libera memória, mantém estado em disco
// await session.destroy();    // @deprecated — use disconnect()
```

---

### 5. `session.rpc` — API de baixo nível (v0.2.0)

```js
// ─── Skills ─────────────────────────────────────────────────────────
const skills = await session.rpc.skills.list();
await session.rpc.skills.enable('code-review');
await session.rpc.skills.disable('deprecated-skill');
await session.rpc.skills.reload();

// ─── MCP ────────────────────────────────────────────────────────────
const mcpServers = await session.rpc.mcp.list();
await session.rpc.mcp.enable('my-server');
await session.rpc.mcp.disable('old-server');
await session.rpc.mcp.reload();

// ─── Extensions ─────────────────────────────────────────────────────
const extensions = await session.rpc.extensions.list();
await session.rpc.extensions.enable('extension-name');
await session.rpc.extensions.disable('extension-name');
await session.rpc.extensions.reload();

// ─── Plugins ────────────────────────────────────────────────────────
const plugins = await session.rpc.plugins.list();

// ─── Shell (v0.2.0) ──────────────────────────────────────────────────
const result = await session.rpc.shell.exec('ls -la src/copilot');
await session.rpc.shell.kill(pid);

// ─── UI (v0.2.0) ─────────────────────────────────────────────────────
// Elicitation: input estruturado do usuário
await session.rpc.ui.elicitation({
  message: 'Preencha os dados para criar a tarefa:',
  requestedSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Título da tarefa' },
      priority: { type: 'number', minimum: 1, maximum: 5 },
    },
    required: ['title'],
  },
});

// ─── Agent ──────────────────────────────────────────────────────────
await session.rpc.agent.select('researcher'); // pré-existente
```

---

### 6. Hooks — referência completa

| Hook                    | Input                                             | Output                                                      | Uso                       |
| ----------------------- | ------------------------------------------------- | ----------------------------------------------------------- | ------------------------- |
| `onSessionStart`        | `{ timestamp, cwd }`                              | `{ additionalContext }` \| `null`                           | Injeta contexto no início |
| `onUserPromptSubmitted` | `{ timestamp, prompt }`                           | `{ modifiedPrompt }` \| `null`                              | Reescreve prompt          |
| `onPreToolUse`          | `{ timestamp, toolName, toolArgs }`               | `{ permissionDecision, permissionDecisionReason }`          | Controle de acesso        |
| `onPostToolUse`         | `{ timestamp, toolName, toolResult }`             | `{ modifiedResult }` \| `null`                              | Filtra/transforma outputs |
| `onSessionEnd`          | `{ timestamp, reason }`                           | `null`                                                      | Cleanup, métricas         |
| `onErrorOccurred`       | `{ timestamp, error, errorContext, recoverable }` | `{ errorHandling, retryCount, userNotification }` \| `null` | Tratamento de erros       |

**`permissionDecision` values:**

- `'allow'` — executa imediatamente
- `'deny'` — bloqueia com razão opcional
- `'ask'` — delega ao usuário
- `'no-result'` (v0.2.0) — passa a decisão para outro cliente conectado

---

### 7. Eventos de streaming — todos os tipos

```
ASSISTANT:
  assistant.turn_start        → turnId, interactionId
  assistant.intent            → intent (ephemeral)
  assistant.reasoning         → reasoningId, content
  assistant.reasoning_delta   → reasoningId, deltaContent (ephemeral)
  assistant.message           → messageId, content, toolRequests[], outputTokens
  assistant.message_delta     → messageId, deltaContent (ephemeral)
  assistant.turn_end          → turnId
  assistant.usage             → model, inputTokens, outputTokens, cost, duration (ephemeral)
  assistant.streaming_delta   → totalResponseSizeBytes (ephemeral)

TOOLS:
  tool.user_requested         → toolCallId, toolName, arguments
  tool.execution_start        → toolCallId, toolName, arguments, mcpServerName?
  tool.execution_partial_result → toolCallId, partialOutput (ephemeral)
  tool.execution_progress     → toolCallId, progressMessage (ephemeral)
  tool.execution_complete     → toolCallId, success, result?, error?

SESSION:
  session.idle                → backgroundTasks? (ephemeral) — TURNO COMPLETO
  session.error               → errorType, message, statusCode
  session.compaction_start    → {}
  session.compaction_complete → success, preCompactionTokens, summaryContent
  session.title_changed       → title (ephemeral)
  session.context_changed     → cwd, gitRoot?, repository?, branch?
  session.usage_info          → tokenLimit, currentTokens, messagesLength (ephemeral)
  session.task_complete       → summary?
  session.shutdown            → shutdownType, codeChanges, modelMetrics

PERMISSION / INPUT:
  permission.requested        → requestId, permissionRequest (ephemeral)
  permission.completed        → requestId, result.kind (ephemeral)
  user_input.requested        → requestId, question, choices?, allowFreeform (ephemeral)
  user_input.completed        → requestId (ephemeral)
  elicitation.requested       → requestId, message, requestedSchema (ephemeral)
  elicitation.completed       → requestId (ephemeral)

SUBAGENTS:
  subagent.started            → toolCallId, agentName, agentDisplayName, agentDescription
  subagent.completed          → toolCallId, agentName, agentDisplayName
  subagent.failed             → toolCallId, agentName, agentDisplayName, error
  subagent.selected           → agentName, agentDisplayName, tools
  subagent.deselected         → {}
  skill.invoked               → name, path, content, allowedTools?

OUTROS:
  abort                       → reason
  user.message                → content, attachments?, agentMode?
  system.message              → content, role
  external_tool.requested     → requestId, sessionId, toolCallId, toolName, arguments (ephemeral)
  external_tool.completed     → requestId (ephemeral)
  exit_plan_mode.requested    → requestId, summary, planContent, actions, recommendedAction (ephemeral)
  exit_plan_mode.completed    → requestId (ephemeral)
  command.queued              → requestId, command (ephemeral)
  command.completed           → requestId (ephemeral)
```

---

## Parte II — Análise de lacunas: atual vs. possível

### Estado atual de `src/copilot` — pós-Sprints 15–16c (atualizado 2026-03-23)

```
src/copilot/
├── agent.js                    → PM2 entry point (startWithRetry)
├── always-alive.js             → AlwaysAliveAgent — streaming, queueing, dialog loop
├── cli-terminal.js             → REPL readline
├── http-bridge.js              → Express REST bridge HTTP ↔ LLM-B
├── mcp-tool-bridge.js          → MCP async bridge via fetch (não mais execSync)  ← Sprint 16b
├── nerv-bridge.js              → NERV event bridge
├── sdk-api.js                  → Router completo (24 endpoints)                  ← Sprints 16a/16c
├── sdk-client.js               → createSdkSession, resumeSdkSession
├── session-manager.js          → initOrResumeSession (com mcpServers)
├── llm-bridge-client.js        → LlmBridgeClient (high-level)
├── config/                                                                         ← Sprint 15
│   ├── index.js                → exports consolidados
│   ├── mcp-servers.js          → buildMcpConfig, MCP_SERVERS, listAvailableMcpServers
│   └── session-config.js       → buildAlwaysAliveConfig, buildReadOnly, buildFullAccess, buildDiagnostic
├── lib/
│   ├── agents.js               → createAgent, presets (ReadOnly, FullAccess, Analyst)
│   ├── client.js               → buildClientOptions, getClientState, registry
│   ├── hooks.js                → createHooks, presets (Minimal, Audit, Safe, DenyAll)
│   ├── models.js               → filterModels, supportsReasoning, buildReasoningConfig
│   ├── permissions.js          → createPermissionHandler, presets
│   ├── session.js              → createClientFromCliUrl
│   ├── telemetry.js            → createTelemetry, recordToolCall, getSummary     ← Sprint 14
│   ├── tools-registry.js       → createRegistry, registerTools, getByCategory    ← Sprint 14
│   └── index.js                → barrel
└── tools/
    ├── index.js                → allTools aggregation (inclui introspection)
    ├── introspection-tools.js  → list_tools, get_agent_info, get_telemetry        ← Sprint 15
    ├── code-tools.js           → lint_check, run_tests, typecheck
    ├── git-tools.js            → git_status, git_diff, git_commit, git_changed_files
    ├── hook-tools.js           → read_briefing, write_pending_task, audit, request_user_input
    ├── session-tools.js        → get_session_state, get_system_health
    └── task-tools.js           → get_tasks, add_task, get_session_state
```

**21 tools ativas. Sem file-tools nem shell-tools (gap crítico — Sprint 17).**

### Lacunas identificadas (atualizado pós-Sprint 16c)

| Capacidade                                | Estado                            | Sprint | Impacto |
| ----------------------------------------- | --------------------------------- | ------ | ------- |
| **File tools** (read/write/list/search)   | ❌ Não implementado               | 17     | CRÍTICO |
| **SDK v0.2.0 upgrade**                    | Instalado v0.1.32                 | 18     | ALTO    |
| `systemMessage.mode: 'customize'`         | Revertido p/ 'append' (v0.1.32)   | 18     | ALTO    |
| `session.abort()` endpoint                | ❌ Não exposto                    | 19     | ALTO    |
| `session.getMessages()` endpoint          | ❌ Não exposto                    | 19     | ALTO    |
| `client.forceStop()` endpoint             | ❌ Não exposto                    | 19     | MÉDIO   |
| `client.getState()` endpoint              | ❌ Não exposto                    | 19     | MÉDIO   |
| `GET /agent/stream` (lifecycle SSE)       | ❌ Não implementado               | 20     | MÉDIO   |
| **Shell tools** (exec_command)            | ❌ Não implementado               | 21     | MÉDIO   |
| `SYSTEM_PROMPT_SECTIONS` constant usage   | Strings literais                  | 22     | MÉDIO   |
| Native TelemetryConfig (SDK OTel)         | ❌ Não implementado               | 23     | BAIXO   |
| Blob attachments                          | ❌ Não implementado               | —      | BAIXO   |
| `session.rpc.*` APIs                      | ⚠️ Não confirmado em npm docs     | —      | BAIXO   |
| Skills, custom agents (elicitation)       | Parcial (`lib/agents.js`)         | —      | BAIXO   |
| `skipPermission: true` nos tools          | ✅ Implementado (Sprint 15)       | —      | —       |
| MCP async bridge                          | ✅ Implementado (Sprint 16b)      | —      | —       |
| Introspection tools                       | ✅ Implementado (Sprint 15)       | —      | —       |
| `streaming` via `assistant.message_delta` | ✅ Funcional (always-alive.js)    | —      | —       |
| compaction events                         | ✅ Parcialmente (always-alive.js) | —      | —       |

---

## Parte III — Nova estrutura de pastas proposta

A estrutura atual é funcional, mas não espelha as responsabilidades do SDK. Proposta de
reorganização:

```
src/copilot/
│
├── index.js                    ← (NOVO) entry pública: re-exporta tudo
│
├── agent.js                    ← PM2 entry (mantém, apenas ajustes)
│
├── core/                       ← (NOVO) coração do sistema
│   ├── always-alive.js         → (movido) singleton principal
│   ├── llm-bridge-client.js    → (movido) high-level client API
│   └── session-pool.js         → (NOVO) pool de sessões SDK para multi-sessão
│
├── config/                     ← (NOVO) toda configuração de sessão
│   ├── agents.js               — (movido de lib/) customAgents builder
│   ├── hooks.js                — (movido de lib/) hooks completos (pre/post/start/end/error)
│   ├── models.js               — (movido de lib/) listModels, setModel
│   ├── permissions.js          — (movido de lib/) permissionHandler granular
│   ├── session.js              — (movido de lib/) createOrResumeSession
│   ├── skills.js               — (NOVO) skill loading + management
│   ├── system-message.js       — (NOVO) systemMessage.mode='customize' + seções
│   └── index.js                — re-exports
│
├── tools/                      ← (EXPANDIDO) todas as tools por domínio
│   ├── code-tools.js           — lint_check, run_tests (+ skipPermission)
│   ├── context-tools.js        — (NOVO) get_token_usage, get_cwd, get_git_branch
│   ├── file-tools.js           — (NOVO) read_file_tool, list_files, search_files
│   ├── git-tools.js            — git_status, git_diff, git_commit (+ skipPermission)
│   ├── hook-tools.js           — hook_get_audit_tail, request_user_input (+ skipPermission)
│   ├── introspection-tools.js  — (NOVO) list_available_tools, get_telemetry_summary, get_agent_context
│   ├── session-tools.js        — read_briefing, write_pending_task (+ skipPermission)
│   ├── shell-tools.js          — (NOVO) exec_command via session.rpc.shell.exec
│   ├── task-tools.js           — get_tasks, add_task, get_session_state (+ skipPermission)
│   └── index.js                — allTools com categorias
│
├── bridge/                     ← (REORGANIZADO)
│   ├── http-bridge.js          → (movido) Express REST API
│   ├── mcp-bridge.js           → (movido/refatorado) MCP async fetch (não mais execSync)
│   ├── nerv-bridge.js          → (movido) NERV event bridge
│   └── elicitation-bridge.js   — (NOVO) session.rpc.ui.elicitation wrapper
│
├── api/                        ← (RENOMEADO de sdk-api.js)
│   ├── sdk-api.js              → (movido) Router /api/sdk/*
│   ├── sdk-client.js           → (movido) createSdkSession, resumeSdkSession
│   ├── session-manager.js      → (movido) SessionManager
│   ├── hooks-api.js            — (NOVO) endpoints /api/sdk/hooks/* (audit, metrics)
│   └── index.js                — (NOVO) router principal
│
├── lib/                        ← (MANTIDO) utilities e managers
│   ├── telemetry.js            — TelemetryManager (Sprint 14)
│   ├── tools-registry.js       — ToolsRegistry (Sprint 14)
│   ├── event-router.js         — (NOVO) roteia session events → NERV, telemetry, logs
│   ├── session-logger.js       — (NOVO) wrapper session.log()
│   └── index.js
│
├── cli/                        ← (RENOMEADO de cli-terminal.js)
│   └── terminal.js             → (movido) REPL readline
│
└── skills/                     ← (NOVO) skills do projeto
    ├── copilot-agent/
    │   └── SKILL.md            — skill para orientar LLM-B sobre este sistema
    └── code-tools/
        └── SKILL.md            — skill para tarefas de código
```

---

## Parte IV — API Completa planejada

### 4.1 `config/system-message.js` — customização do system prompt

```js
/**
 * Constrói a configuração do systemMessage para o SDK.
 *
 * @param {object} overrides — seções a customizar
 * @returns {import('@github/copilot-sdk').SessionConfig['systemMessage']}
 */
export function buildSystemMessage(overrides = {}) {
  return {
    mode: 'customize',
    sections: {
      identity: {
        action: (current) => current + '\n\nVocê é o LLM-B deste sistema.',
      },
      tone: {
        action: 'replace',
        content: 'Seja direto e técnico. Fale português do Brasil.',
      },
      custom_instructions: {
        action: 'append',
        content: `
Você está operando dentro do sistema chatgpt-docker-puppeteer.
Contexto: Node.js 24+ ESM, arquitetura orientada a eventos (NERV).
Regras: não use puppeteer.launch() neste processo.
`,
      },
      ...overrides,
    },
  };
}
```

### 4.2 `config/hooks.js` — hooks completos

```js
export function buildHooks({ audit, metrics, security }) {
  return {
    onSessionStart: async (input, inv) => {
      audit.record('session_start', inv.sessionId, input.cwd);
      return {
        additionalContext: await loadSessionContext(),
      };
    },

    onUserPromptSubmitted: async (input) => {
      // Expande atalhos: /fix, /test, /explain
      const expanded = expandShortcuts(input.prompt);
      return expanded !== input.prompt ? { modifiedPrompt: expanded } : null;
    },

    onPreToolUse: async (input, inv) => {
      audit.record('tool_call', inv.sessionId, input.toolName, input.toolArgs);
      metrics.increment('tool_calls_total', { tool: input.toolName });

      // Segurança: bloqueia writes fora do workspace
      if (['write_file', 'edit_file'].includes(input.toolName)) {
        const path = input.toolArgs?.path ?? '';
        if (!path.startsWith('/workspaces/')) {
          return {
            permissionDecision: 'deny',
            permissionDecisionReason: `Acesso fora do workspace bloqueado: ${path}`,
          };
        }
      }
      return { permissionDecision: 'allow' };
    },

    onPostToolUse: async (input) => {
      metrics.record('tool_duration', input.toolName);
      // Sanitização: remove tokens de API de resultados
      return sanitizeResult(input.toolResult);
    },

    onSessionEnd: async (input, inv) => {
      audit.record('session_end', inv.sessionId, input.reason);
      await metrics.flush();
      return null;
    },

    onErrorOccurred: async (input) => {
      if (input.recoverable && input.errorContext === 'model_call') {
        return { errorHandling: 'retry', retryCount: 2 };
      }
      audit.record('error', null, input.error);
      return { userNotification: 'Erro temporário — tentando novamente...' };
    },
  };
}
```

### 4.3 `tools/introspection-tools.js` — auto-conhecimento do LLM-B

```js
import { defineTool } from '@github/copilot-sdk';

export const listAvailableToolsTool = defineTool('list_available_tools', {
  description: 'Lista todas as tools disponíveis, com descrições e categorias',
  parameters: { type: 'object', properties: {}, required: [] },
  skipPermission: true,
  handler: async () => {
    const registry = getToolsRegistry();
    return registry.listAll();
  },
});

export const getTelemetrySummaryTool = defineTool('get_telemetry_summary', {
  description: 'Retorna métricas de performance das tools: latência, contagem, erros',
  parameters: {
    type: 'object',
    properties: {
      lastN: { type: 'number', description: 'Últimas N entradas' },
    },
    required: [],
  },
  skipPermission: true,
  handler: async ({ lastN = 100 }) => {
    const telemetry = getTelemetryManager();
    return telemetry.getSummary(lastN);
  },
});

export const getAgentContextTool = defineTool('get_agent_context', {
  description: 'Retorna contexto completo da sessão: estado, modelos, skills ativas',
  parameters: { type: 'object', properties: {}, required: [] },
  skipPermission: true,
  handler: async () => {
    const agent = getAlwaysAliveAgent();
    return agent.getStatusSnapshot();
  },
});
```

### 4.4 `tools/context-tools.js` — contexto vivo da sessão

```js
export const getTokenUsageTool = defineTool('get_token_usage', {
  description: 'Retorna uso atual de tokens do context window',
  parameters: { type: 'object', properties: {} },
  skipPermission: true,
  handler: async (_, { session }) => {
    // session injetado via closure no registro
    // evento session.usage_info contém tokenLimit, currentTokens, messagesLength
    return session.getLastUsageInfo();
  },
});

export const getSessionInfoTool = defineTool('get_session_info', {
  description: 'Retorna ID, modelo atual, CWD, branch git e skills ativas',
  parameters: { type: 'object', properties: {} },
  skipPermission: true,
  handler: async (_, { session }) => {
    const skills = await session.rpc.skills.list();
    const mcpServers = await session.rpc.mcp.list();
    return {
      sessionId: session.sessionId,
      model: session.currentModel,
      skills,
      mcpServers,
    };
  },
});
```

### 4.5 `tools/shell-tools.js` — execução de comandos

```js
export const execCommandTool = defineTool('exec_command', {
  description:
    'Executa um comando shell no workspace. Prefira tools específicas (lint, test) quando possível.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Comando a executar' },
    },
    required: ['command'],
  },
  // NÃO usar skipPermission — comandos shell são potencialmente destrutivos
  handler: async ({ command }, { session }) => {
    // Sanitiza: bloqueia comandos perigosos
    if (containsDangerousOps(command)) {
      return { error: 'Comando bloqueado por política de segurança' };
    }
    return await session.rpc.shell.exec(command);
  },
});
```

### 4.6 `bridge/mcp-bridge.js` — MCP async (não-bloqueante)

```js
/**
 * Substitui execSync por fetch nativo. Resolve o bloqueio do event loop presente na versão atual.
 */
export async function rpcCallAsync(method, params) {
  const res = await fetch(`http://localhost:${MCP_PORT}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}
```

### 4.7 `lib/event-router.js` — roteamento de eventos

```js
/**
 * Assina todos os eventos de uma sessão e roteia para:
 *
 * - NERV (event bus)
 * - TelemetryManager
 * - session.log() para eventos importantes
 */
export class EventRouter {
  constructor({ session, nerv, telemetry }) {
    this.#session = session;
    this.#nerv = nerv;
    this.#telemetry = telemetry;

    session.on((event) => this.#route(event));
  }

  #route(event) {
    // Emite para NERV com prefixo 'sdk:'
    this.#nerv.emit(`sdk:${event.type}`, event.data);

    // Métricas para eventos de uso
    if (event.type === 'assistant.usage') {
      this.#telemetry.record('assistant_usage', event.data);
    }

    // Log persistido para eventos de tool
    if (event.type === 'tool.execution_complete') {
      const { toolName, success } = event.data;
      this.#telemetry.record('tool_execution', { toolName, success });
    }
  }
}
```

---

## Parte V — Plano de migração sprint a sprint

### Sprint 15 — Upgrade SDK + skipPermission + introspection ✅ CONCLUÍDO (commit `9d73fe44`)

**Impacto realizado**: elimina todas as confirmações desnecessárias; LLM-B se autoconhece

1. ✅ `skipPermission: true` aplicado em 8 tools existentes
2. ✅ Criado `tools/introspection-tools.js` (3 tools: `list_tools`, `get_agent_info`,
   `get_telemetry`)
3. ✅ Integrado `telemetry.js` e `tools-registry.js` (Sprint 14) no AlwaysAliveAgent
4. ✅ Criado `config/` directory com `index.js`, `mcp-servers.js`, `session-config.js`
5. ✅ `streaming: true` via `assistant.message_delta` funcional no always-alive.js

**Nota**: `npm install @github/copilot-sdk@latest` adiado para Sprint 18 (v0.2.0 publicado após
Sprint 15)

### Sprint 16a — Novos endpoints /agent/\* ✅ CONCLUÍDO (commit `28a6152a`)

1. ✅ `GET /agent/info` — status do agente, model, PID, uptime
2. ✅ `GET /agent/tools` — metadados ricos do ToolsRegistry
3. ✅ `GET /agent/telemetry` — resumo de telemetria
4. ✅ `POST /agent/telemetry/clear` — resetar telemetria

### Sprint 16b — MCP Bridge Async ✅ CONCLUÍDO (commit `0ff1ad8c`)

1. ✅ `mcp-tool-bridge.js` refatorado para `fetch` assíncrono (elimina `execSync`)
2. ✅ `buildMcpConfig()` integrado em `initOrResumeSession`
3. ✅ `listAvailableMcpServers()` exposto via API

### Sprint 16c — GET /tools Enriquecido ✅ CONCLUÍDO (commit `7ebb2843`)

1. ✅ `GET /tools` retorna `category`, `tags`, `readOnly`, `skipPermission`, `source`
2. ✅ Usa `ToolsRegistry` quando agente está rodando (`source='registry'`)
3. ✅ Fallback para `allTools` (`source='static'`) quando sem agente ativo

### Sprint 17 — File Tools ★ PRÓXIMO (ver SDK-COPILOT-PROXIMAS-FASES.md)

**Impacto**: LLM-B pode ler/escrever arquivos — gap mais urgente

1. Criar `tools/file-tools.js` com 8 tools
2. `read_file_content`, `write_file_content`, `create_file`, `delete_file`
3. `list_directory`, `search_in_file`, `copy_file`, `move_file`
4. `onPreToolUse` hook com restrições de path/secret

### Sprint 18 — SDK v0.2.0 Upgrade ★ ALTO

**Impacto**: restaura `mode: "customize"`, habilita novos recursos do SDK

1. `npm install @github/copilot-sdk@^0.2.0`
2. Restaurar `mode: "customize"` em `session-config.js`
3. Usar `SYSTEM_PROMPT_SECTIONS` constant
4. Expor `forceStop()`, `getState()`, client lifecycle events
5. Expor `session.abort()` e `session.getMessages()` via API

### Sprint 19 — Session API Extensions ★ ALTO

**Impacto**: fecha gaps de API documentados acima

1. `POST /sessions/:id/abort`
2. `GET /sessions/:id/messages`
3. `GET /sessions/foreground` + `PUT /sessions/foreground/:id`
4. `GET /agent/state` + `POST /client/force-stop`

### Sprint 20 — Agent Lifecycle Stream ★ MÉDIO

1. `GET /agent/stream` — SSE para eventos `client.on()` do SDK
2. Eventos: `session.created/deleted/updated/foreground/background`
3. Incluir `session.compaction_start/complete`

### Sprint 21 — Shell Tools ★ MÉDIO

1. `tools/shell-tools.js`: `exec_command`, `run_npm_script`, `run_node_file`
2. Blocklist de comandos perigosos; timeout 30s; cwd restrito

### Sprint 22 — System Message Upgrade ★ MÉDIO

1. Usar `mode: "customize"` com todas as 10 seções via `SYSTEM_PROMPT_SECTIONS`
2. Refatorar todos os builders em `config/session-config.js`

### Sprint 23 — OpenTelemetry Nativo ★ BAIXO

1. `CopilotClientOptions.telemetry` com `filePath`/`exporterType`/`sourceName`
2. `onGetTraceContext` para propagação de distributed traces

### Sprint 24 — Testes de Integração ★ ALTO (qualidade)

1. Tests para todas as tools (file, shell, code, git, hook, session, introspection)
2. Tests para sdk-api.js (24+ endpoints)
3. Tests para config builders

---

## Parte VI — Decisões de design

### Por que reorganizar src/copilot/

A estrutura atual mistura responsabilidades:

- `lib/` contém tanto configuração (hooks, agents) quanto utilities (registry, telemetry)
- Bridge HTTP e NERV estão na raiz junto com o agent
- Não há separação entre API pública e detalhes internos

A nova estrutura `core/ | config/ | tools/ | bridge/ | api/ | lib/ | cli/ | skills/` espelha
diretamente o modelo mental do SDK.

### Por que não migrar tudo de uma vez

- Cada sprint é testável e produz valor imediato
- Sprint 15 (skipPermission + SDK upgrade) tem o maior ROI: elimina fricção imediata
- Sprint 19 (reorganização) é separado da funcionalidade para evitar regressões

### Segurança

- Tools de leitura: `skipPermission: true` — seguro pois não modificam estado
- Tools de escrita: manter confirmação (hooks `onPreToolUse`)
- `exec_command`: sanitização obrigatória + lista de comandos perigosos
- Restrição de paths via `onPreToolUse` hook (apenas `/workspaces/`)
- Redação de secrets em `onPostToolUse` (tokens, chaves de API)

---

## Referências

- SDK oficial: https://github.com/github/copilot-sdk
- CHANGELOG v0.2.0: https://github.com/github/copilot-sdk/blob/main/CHANGELOG.md
- Docs getting-started: https://github.com/github/copilot-sdk/blob/main/docs/getting-started.md
- Hooks reference: https://github.com/github/copilot-sdk/blob/main/docs/features/hooks.md
- Custom agents: https://github.com/github/copilot-sdk/blob/main/docs/features/custom-agents.md
- Streaming events:
  https://github.com/github/copilot-sdk/blob/main/docs/features/streaming-events.md
- Session persistence:
  https://github.com/github/copilot-sdk/blob/main/docs/features/session-persistence.md
- MCP: https://github.com/github/copilot-sdk/blob/main/docs/features/mcp.md
- Skills: https://github.com/github/copilot-sdk/blob/main/docs/features/skills.md
- OpenTelemetry: https://github.com/github/copilot-sdk/blob/main/docs/observability/opentelemetry.md
