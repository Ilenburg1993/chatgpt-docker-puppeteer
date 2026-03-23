# Planejamento de Próximas Fases — src/copilot

**Documento**: planejamento detalhado das Fases 17–24 do sistema `src/copilot`. **Status**: Ativo —
revisado após auditoria SDK v0.2.0 (npm), auditorias de código e Sprints 15-16c concluídos.
**Data**: 2026-03-23 **Versão anterior**: phases 15–19 (arquivo mantido abaixo como histórico)
**Referência canônica**: `DOCUMENTAÇÃO/ARQUITETURA/SDK-COPILOT-API-COMPLETA.md`

---

## PARTE NOVA — Estado pós-Sprints 15–16c e roadmap 17–24

### Estado atual da base de código (pós-Sprint 16c — commit 7ebb2843)

| Módulo                         | Status                   | Sprint  |
| ------------------------------ | ------------------------ | ------- |
| `lib/client.js`                | ✅ Implementado           | 10      |
| `lib/session.js`               | ✅ Implementado           | 10      |
| `lib/permissions.js`           | ✅ Implementado           | 10      |
| `lib/hooks.js`                 | ✅ Implementado           | 11      |
| `lib/providers.js`             | ✅ Implementado           | 12      |
| `lib/mcp.js`                   | ✅ Implementado           | 12      |
| `lib/agents.js`                | ✅ Implementado           | 13      |
| `lib/models.js`                | ✅ Implementado           | 13      |
| `lib/telemetry.js`             | ✅ Implementado           | 14      |
| `lib/tools-registry.js`        | ✅ Implementado           | 14      |
| `config/index.js`              | ✅ Implementado           | 15      |
| `config/mcp-servers.js`        | ✅ Implementado           | 15      |
| `config/session-config.js`     | ✅ Implementado           | 15      |
| `tools/introspection-tools.js` | ✅ Implementado           | 15      |
| `always-alive.js`              | ✅ Funcional + streaming  | 15-16   |
| `mcp-tool-bridge.js`           | ✅ Async fetch            | 16b     |
| `sdk-api.js`                   | ✅ 24 endpoints           | 16a/16c |
| `tools/task-tools.js`          | ✅ Implementado           | 10      |
| `tools/code-tools.js`          | ✅ Implementado (3 tools) | 11      |
| `tools/git-tools.js`           | ✅ Implementado (4 tools) | 11      |
| `tools/hook-tools.js`          | ✅ Implementado (5 tools) | 12      |
| `tools/session-tools.js`       | ✅ Implementado (4 tools) | 12      |

**Total de testes**: 1278/1278 ✅ **SDK instalado**: `@github/copilot-sdk v0.1.32` → upgrade para
`v0.2.0` disponível (sem breaking changes)

---

### Tools que LLM-B possui hoje (21 tools)

| Tool                     | Arquivo             | Categoria      |
| ------------------------ | ------------------- | -------------- |
| `list_tools`             | introspection-tools | self-knowledge |
| `get_agent_info`         | introspection-tools | self-knowledge |
| `get_telemetry`          | introspection-tools | self-knowledge |
| `lint_check`             | code-tools          | quality        |
| `run_tests`              | code-tools          | quality        |
| `typecheck`              | code-tools          | quality        |
| `git_status`             | git-tools           | vcs            |
| `git_diff`               | git-tools           | vcs            |
| `git_commit`             | git-tools           | vcs            |
| `git_changed_files`      | git-tools           | vcs            |
| `read_briefing`          | hook-tools          | session        |
| `write_pending_task`     | hook-tools          | session        |
| `hook_get_audit_tail`    | hook-tools          | audit          |
| `request_user_input`     | hook-tools          | interaction    |
| `hook_get_pending_tasks` | hook-tools          | session        |
| `get_tasks`              | task-tools          | workflow       |
| `add_task`               | task-tools          | workflow       |
| `get_session_state`      | session-tools       | state          |
| `get_system_health`      | session-tools       | health         |
| `mcp_*`                  | bridge dinâmico     | mcp            |

**Gap crítico**: LLM-B **não tem acesso ao filesystem**. Não pode ler nem escrever arquivos.

---

### Endpoints da API HTTP (sdk-api.js) — 24 ativos

| Method | Path                     | Descrição                         |
| ------ | ------------------------ | --------------------------------- |
| GET    | /ping                    | Health check                      |
| GET    | /status                  | Estado do cliente + versão        |
| GET    | /auth                    | Status de autenticação            |
| GET    | /models                  | Modelos disponíveis               |
| GET    | /sessions                | Listar sessões                    |
| POST   | /sessions                | Criar sessão                      |
| GET    | /sessions/active         | Sessões ativas no registry        |
| GET    | /sessions/:id            | Detalhes de sessão                |
| DELETE | /sessions/:id            | Deletar sessão                    |
| POST   | /sessions/:id/resume     | Retomar sessão                    |
| POST   | /sessions/:id/disconnect | Desconectar sessão ativa          |
| POST   | /sessions/:id/send       | Enviar mensagem (sync/async)      |
| GET    | /sessions/:id/stream     | SSE de eventos da sessão          |
| POST   | /client/start            | Iniciar cliente SDK               |
| POST   | /client/stop             | Parar cliente SDK                 |
| GET    | /tools                   | Tools com metadados ricos         |
| GET    | /webhooks                | Listar webhooks                   |
| POST   | /webhooks                | Registrar webhook                 |
| DELETE | /webhooks/:id            | Remover webhook                   |
| GET    | /agent/info              | Status do agente                  |
| GET    | /agent/tools             | Metadados do ToolsRegistry        |
| GET    | /agent/telemetry         | Resumo de telemetria              |
| POST   | /agent/telemetry/clear   | Resetar telemetria                |
| POST   | /agent/compaction        | Acionamento manual de compactação |

**Endpoints faltando** (SDK v0.2.0 suporta):

- `POST /sessions/:id/abort` — `session.abort()`
- `GET /sessions/:id/messages` — `session.getMessages()`
- `GET /sessions/foreground` — `client.getForegroundSessionId()`
- `PUT /sessions/foreground/:id` — `client.setForegroundSessionId()`
- `GET /agent/stream` — SSE para eventos de lifecycle do cliente
- `GET /agent/state` — `client.getState()` (ConnectionState)
- `POST /client/force-stop` — `client.forceStop()`

---

## Roadmap — Sprints 17–24

> Cada sprint tem um objetivo claro, escopo delimitado e critério de aceite. Prioridade:
> **CRÍTICO** > **ALTO** > **MÉDIO** > **BAIXO**.

---

### Sprint 17 — File Tools ★ CRÍTICO ✅ CONCLUÍDO

**Status**: ✅ Concluído em 2026-03-24 | Commit: `f6ec3970`

**Implementado**:

- `src/copilot/tools/file-tools.js` com 8 ferramentas de filesystem
- `fileReadTools` (skipPermission: true): `read_file_content`, `list_directory`, `search_in_files`
- `fileWriteTools` (skipPermission: false): `write_file_content`, `create_file`, `delete_file`, `copy_file`, `move_file`
- `validatePath()`: previne traversal e bloqueia `.env`, `.git/`, `node_modules/`
- `sdkParam` helper: resolve `ToolHandler<unknown>` type conflict
- `tools/index.js`: fileTools incluídos em allTools; exports granulares por categoria
- `always-alive.js`: registro por categoria (file-read/file-write) em vez de `{ category: 'all' }`
- 41 testes unitários: 41/41 passando (`tests/unit/copilot/test_file_tools.spec.js`)

**Baseline de testes pós-Sprint 17**: 1319/1319 passando

---

### Sprint 18 — SDK v0.2.0 Upgrade ★ ALTO ⚠️ BLOQUEADO

**⚠️ BLOQUEADO**: `@github/copilot-sdk@0.2.0` tem peer dep em `@github/copilot@^1.0.10`, mas a
versão máxima publicada no npm é `1.0.9`. Aguardar publicação de `@github/copilot@1.0.10`.

**Status verificado em**: 2026-03-23 **Erro npm**:
`notarget No matching version found for @github/copilot@^1.0.10`

**Quando desbloqueado, executar**:

1. `"@github/copilot-sdk": "^0.1.32"` → `"^0.2.0"` em `package.json`
2. **`config/session-config.js`**: restaurar `mode: "customize"` (válido em v0.2.0, revertido para
   `"append"` no v0.1.32)
3. **`config/session-config.js`**: adicionar opção `streaming: true` em todos os builders
4. **`lib/client.js`**: expor `client.forceStop()`, `client.getState()`, lifecycle events
   (`client.on()`)
5. **`always-alive.js`**: expor message ID retornado por `session.send()` (`Promise<string>`)
6. **`always-alive.js`**: expor timeout para `sendAndWait(msg, { timeout })` via API
7. **`config/session-config.js`**: usar `SYSTEM_PROMPT_SECTIONS` constant do SDK em vez de strings
   literais

#### Novos exports do SDK v0.2.0 a usar

```js
import { SYSTEM_PROMPT_SECTIONS, CopilotClient } from '@github/copilot-sdk';
// SYSTEM_PROMPT_SECTIONS.identity, .tone, .guidelines, .safety, etc.
```

**Breaking changes para nosso código**: NENHUM (todos os novos recursos são additive/opt-in)

**Critério de aceite**:

- `npm install` sem erros
- Todos os 1278 testes continuam passando
- `mode: "customize"` funciona com seções identity, tone, guidelines

---

### Sprint 19 — Session API Extensions ★ ALTO ✅ CONCLUÍDO

**Status**: ✅ Concluído em 2026-03-24 | Commit: `f6ec3970`

**Implementado** (todos disponíveis em SDK v0.1.32):

| Endpoint                       | Método SDK                          | Notas                      |
| ------------------------------ | ----------------------------------- | -------------------------- |
| `POST /sessions/:id/abort`     | `session.abort()`                   | Aborta turn ativo          |
| `GET /sessions/:id/messages`   | `session.getMessages()`             | Histórico completo         |
| `GET /sessions/foreground`     | `client.getForegroundSessionId()`   | Antes de `/:id` no router  |
| `PUT /sessions/foreground/:id` | `client.setForegroundSessionId(id)` | —                          |
| `GET /agent/state`             | `client.getState()`                 | Retorna `ConnectionState`  |
| `GET /agent/stream`            | `client.on()`                       | SSE de lifecycle do client |

- 13 novos testes em `tests/unit/copilot/test_sdk_api.spec.js` (suite Sprint 19)
- Rotas `foreground` posicionadas antes de `/:id` para evitar captura incorreta pelo Express

**Baseline de testes pós-Sprint 19**: 1332/1332 passando

---

### Sprint 20 — Agent Lifecycle Stream ★ MÉDIO ✅ CONCLUÍDO (incluído na Sprint 19)

**Status**: ✅ Concluído em 2026-03-24 como parte da Sprint 19 | Commit: `f6ec3970`

**Implementado**: `GET /agent/stream` — SSE de eventos de lifecycle do `CopilotClient`. Ver Sprint 19 acima.

---

### Sprint 21 — Shell Tools ★ MÉDIO ✅ CONCLUÍDO

**Status**: ✅ Concluído em 2026-03-24 | Baseline: 1371/1371 testes passando

**Implementado** em `src/copilot/tools/shell-tools.js`:

| Tool             | Operação                   | skipPermission | Segurança                                       |
| ---------------- | -------------------------- | -------------- | ----------------------------------------------- |
| `exec_command`   | Executa comando arbitrário | ❌ não          | Blocklist 15+ padrões, cwd restrito             |
| `run_npm_script` | Executa `npm run <script>` | ❌ não          | Whitelist explícita de 20 scripts               |
| `run_node_file`  | Executa `node <file>`      | ❌ não          | Ext. permitidas (.js/.mjs/.cjs), workspace only |

**Restrições de segurança embutidas**:

- Blocklist de comandos perigosos: `rm -rf`, `dd`, `mkfs`, `sudo`, `curl|bash`, etc.
- Cwd restrito ao workspace (`/workspaces/chatgpt-docker-puppeteer/`)
- Timeout máximo: 120s; default 30s (exec/node) / 60s (npm)
- Output truncado a 10.000 bytes com aviso
- Variáveis de ambiente sensíveis removidas do sub-processo (GITHUB_TOKEN, NPM_TOKEN, etc.)
- `execFile` (não `exec`) para evitar injeção via shell interpolation

**Artefatos**:

- `src/copilot/tools/shell-tools.js` — 3 tools
- `tests/unit/copilot/test_shell_tools.spec.js` — 39 testes (39/39 passando)
- `src/copilot/tools/index.js` — `shellTools` adicionado ao `allTools`
- `src/copilot/always-alive.js` — registrado com `{category: 'shell', tags: ['exec', 'system', 'npm', 'node']}`

---

### Sprint 22 — System Message Upgrade ★ MÉDIO ✅ CONCLUÍDO (parcial — SDK v0.1.32)

> **Commit**: `PENDING_SPRINT22` | **Implementação parcial**: usa `mode: "append"` e `mode: "replace"` do SDK v0.1.32.
> **Aguardando SDK v0.2.0** para `mode: "customize"` com seções nomeadas (bloqueado como Sprint 18).

**Objetivo**: usar `mode: "customize"` com todas as 10 seções do SDK v0.2.0. **ROI**: médio —
permite fine-grained control do system prompt. **Duração**: 0.5 sprint.

#### O que foi implementado (v0.1.32 parcial)

**Novo arquivo `src/copilot/config/system-prompt.js`**:

- Constante `SYSTEM_PROMPT_SECTIONS` — 10 chaves nomeadas, pronta para migração a `@github/copilot-sdk v0.2.0`
- Constantes de texto: `AGENT_IDENTITY`, `AGENT_TONE`, `TOOL_EFFICIENCY`, `ENVIRONMENT_CONTEXT`, `CODE_CHANGE_RULES`, `AGENT_GUIDELINES`, `LAST_INSTRUCTIONS`
- `buildAppendSystemMessage(content)` — `mode: "append"` tipado
- `buildReplaceSystemMessage(content)` — `mode: "replace"` tipado
- `buildAlwaysAliveSystemMessage(opts)` — system prompt completo com 7 seções em `mode: "replace"`
- `buildHookContextAppendMessage(hookContext)` — injeção do briefing operacional em `mode: "append"`

**Correções de API**:

- `session-manager.js`: substituiu `mode: "customize"` (não existe no v0.1.32, era cast `any`) por `buildHookContextAppendMessage` tipada
- `session-config.js`: substituiu campo `guidelines` (inválido) por `content` via `buildHookContextAppendMessage`

**Testes**: 24 novos testes em `tests/unit/copilot/test_system_prompt.spec.js` | Baseline: 1395 pass

#### Migração para v0.2.0 (quando disponível)

Substituir `buildHookContextAppendMessage` por `mode: "customize"` com `SYSTEM_PROMPT_SECTIONS`:

```js
import { SYSTEM_PROMPT_SECTIONS } from '@github/copilot-sdk';

// Usar constantes do SDK em vez de strings literais
const SECTIONS = SYSTEM_PROMPT_SECTIONS;
// SECTIONS.identity, .tone, .tool_efficiency, .environment_context,
// .code_change_rules, .guidelines, .safety, .tool_instructions,
// .custom_instructions, .last_instructions

// Exemplo de builder atualizado:
export function buildAlwaysAliveConfig(opts = {}) {
  return {
    ...BASE_CONFIG,
    systemMessage: {
      mode: 'customize',
      sections: {
        [SECTIONS.identity]: {
          action: 'replace',
          content: AGENT_IDENTITY,
        },
        [SECTIONS.guidelines]: {
          action: 'append',
          content: AGENT_GUIDELINES,
        },
        [SECTIONS.code_change_rules]: {
          action: 'append',
          content: CODE_CHANGE_RULES,
        },
        [SECTIONS.last_instructions]: {
          action: 'replace',
          content: LAST_INSTRUCTIONS,
        },
      },
    },
    streaming: true,
    reasoningEffort: opts.reasoningEffort ?? 'high',
  };
}
```

**10 seções disponíveis** (confirmado no SDK v0.2.0):

1. `identity` — quem o modelo é
2. `tone` — estilo de comunicação
3. `tool_efficiency` — diretrizes de uso de tools
4. `environment_context` — contexto do ambiente de desenvolvimento
5. `code_change_rules` — regras para mudanças de código
6. `guidelines` — diretrizes gerais
7. `safety` — restrições de segurança (⚠️ usar `remove` com cautela)
8. `tool_instructions` — instruções de tools built-in
9. `custom_instructions` — personalização livre
10. `last_instructions` — instruções de final de turno (alta precedência)

---

### Sprint 23 — OpenTelemetry Nativo ★ BAIXO

**Objetivo**: integrar TelemetryConfig nativo do SDK com o sistema de observabilidade. **ROI**:
baixo a médio — melhora rastreamento; não é essencial para funcionalidade. **Duração**: 0.5 sprint.

#### Mudanças em `lib/client.js`

```js
export function buildClientOptions(overrides = {}) {
  return {
    cliUrl: overrides.cliUrl,
    telemetry: {
      exporterType: 'file',
      filePath: '.github/hooks/state/sdk-traces.jsonl',
      sourceName: 'chatgpt-docker-puppeteer',
      captureContent: false, // nunca capturar conteúdo de mensagens
    },
    onGetTraceContext: () => ({
      traceparent: process.env.TRACEPARENT,
      tracestate: process.env.TRACESTATE,
    }),
    ...overrides,
  };
}
```

**Integração com `lib/telemetry.js`**:

- SDK traces → `sdk-traces.jsonl`
- Nossa telemetria customizada → `lib/telemetry.js` (mantida)
- Bridge opcional via NERV para correlação

---

### Sprint 24 — Testes de Integração ★ ALTO (qualidade)

**Objetivo**: cobertura de testes para os módulos sem testes de `src/copilot`. **ROI**: alto para
manutenção — sem testes, refactors são perigosos. **Duração**: 1-2 sprints.

#### Novos arquivos de teste

| Arquivo de teste                            | Cobertura                             |
| ------------------------------------------- | ------------------------------------- |
| `tests/copilot/tools/file-tools.test.js`    | read, write, list, search             |
| `tests/copilot/tools/shell-tools.test.js`   | exec, blocklist, timeout              |
| `tests/copilot/tools/code-tools.test.js`    | lint, test, typecheck                 |
| `tests/copilot/tools/git-tools.test.js`     | status, diff, commit                  |
| `tests/copilot/tools/hook-tools.test.js`    | read_briefing, audit, pending         |
| `tests/copilot/tools/session-tools.test.js` | state, health                         |
| `tests/copilot/tools/introspection.test.js` | list_tools, get_agent_info, telemetry |
| `tests/copilot/sdk-api.test.js`             | todos os 24+ endpoints                |
| `tests/copilot/config-builders.test.js`     | buildAlwaysAliveConfig, buildReadOnly |
| `tests/copilot/always-alive.test.js`        | sendMessage, dialogLoop, reconnect    |

**Meta de cobertura**: 80% em `src/copilot/tools/`, 70% em `src/copilot/sdk-api.js`

---

## Tabela de Prioridades e Dependências

| Sprint | Título                 | Status           | Prioridade | Depende de | Commit     |
| ------ | ---------------------- | ---------------- | ---------- | ---------- | ---------- |
| 17     | File Tools             | ✅ CONCLUÍDO      | CRÍTICO    | —          | `f6ec3970` |
| 18     | SDK v0.2.0 Upgrade     | ⚠️ BLOQUEADO      | ALTO       | —          | —          |
| 19     | Session API Extensions | ✅ CONCLUÍDO      | ALTO       | 18*        | `f6ec3970` |
| 20     | Agent Lifecycle Stream | ✅ CONCLUÍDO      | MÉDIO      | 18*/19     | `f6ec3970` |
| 21     | Shell Tools            | ✅ CONCLUÍDO      | MÉDIO      | 17         | `dbb778bf` |
| 22     | System Message Upgrade | ✅ CONCLUÍDO (p.) | MÉDIO      | 18*        | próximo    |
| 23     | OpenTelemetry Nativo   | ⏳ PENDENTE       | BAIXO      | 18         | —          |
| 24     | Testes de Integração   | ⏳ PENDENTE       | ALTO (QA)  | 17-22      | —          |

> \* Sprint 22 implementado parcialmente com SDK v0.1.32 (`mode: "append"/"replace"`); migração para `mode: "customize"` aguarda SDK v0.2.0.

**Ordem de execução recomendada (restante)**:

1. ~~Sprint 17 (File Tools)~~ — ✅ done
2. ~~Sprint 18 (SDK Upgrade)~~ — ⚠️ BLOQUEADO, monitorar npm
3. ~~Sprint 19 (Session API)~~ — ✅ done
4. ~~Sprint 20 (Agent Stream)~~ — ✅ done (via Sprint 19)
5. ~~Sprint 21 (Shell Tools)~~ — ✅ done
6. ~~Sprint 22 (System Message)~~ — ✅ done (parcial v0.1.32; migração futura → v0.2.0)
7. **Sprint 24 (Testes)** — paralelizável com qualquer sprint
8. Sprint 23 (OpenTelemetry) — baixa prioridade

---

## Diagrama de Estado — src/copilot após Sprint 22

```
src/copilot/
├── agent.js                    → entry point legacy
├── always-alive.js             → AlwaysAliveAgent (core, 800 linhas)
├── cli-terminal.js             → CLI terminal bridge
├── http-bridge.js              → HTTP bridge :9988
├── nerv-bridge.js              → NERV bridge
├── mcp-tool-bridge.js          → MCP async bridge
├── session-manager.js          → initOrResumeSession
├── llm-bridge-client.js        → LLM bridge client
├── sdk-client.js               → SDK client wrapper
├── sdk-api.js                  → API HTTP completa (30+ endpoints após Sprint 19)
│
├── config/
│   ├── index.js                → exports consolidados
│   ├── mcp-servers.js          → buildMcpConfig, MCP_SERVERS
│   └── session-config.js       → builders (usa SYSTEM_PROMPT_SECTIONS após Sprint 22)
│
├── lib/
│   ├── index.js                → barrel
│   ├── agents.js               → createAgent, presets (ReadOnly, FullAccess, Analyst)
│   ├── client.js               → buildClientOptions, getClientState, registry
│   ├── hooks.js                → createHooks, presets (Minimal, Audit, Safe)
│   ├── models.js               → filterModels, supportsReasoning, buildReasoningConfig
│   ├── permissions.js          → createPermissionHandler, presets
│   ├── session.js              → createClientFromCliUrl
│   ├── telemetry.js            → createTelemetry, recordToolCall, getSummary
│   └── tools-registry.js       → createRegistry, registerTools, getByCategory
│
└── tools/
    ├── index.js                → barrel de todas as tools
    ├── introspection-tools.js  → list_tools, get_agent_info, get_telemetry
    ├── task-tools.js           → get_tasks, add_task, get_session_state, health
    ├── code-tools.js           → lint_check, run_tests, typecheck
    ├── git-tools.js            → git_status, git_diff, git_commit, git_changed_files
    ├── hook-tools.js           → read_briefing, write_pending_task, audit, request_user_input
    ├── session-tools.js        → get_session_state, get_system_health
    ├── file-tools.js           ← NOVO (Sprint 17): read/write/list/search arquivos
    └── shell-tools.js          ← NOVO (Sprint 21): exec_command, run_npm_script
```

---

## Notas de Segurança (atualizado para Sprints 17 e 21)

### File Tools (Sprint 17)

```js
// Exemplo de hook onPreToolUse para file tools
const fileRestrictionsHook = async (input) => {
  const { toolName, args } = input;
  const FILE_TOOLS = [
    'read_file_content',
    'write_file_content',
    'create_file',
    'delete_file',
    'list_directory',
    'search_in_file',
  ];

  if (!FILE_TOOLS.includes(toolName)) return { permissionDecision: 'allow' };

  const targetPath = args?.path ?? args?.filePath ?? '';
  const BLOCKED_PATTERNS = ['.env', '.pem', '.key', 'secret', '.ssh'];
  const isBlocked = BLOCKED_PATTERNS.some((p) => targetPath.includes(p));
  if (isBlocked) return { permissionDecision: 'deny', reason: 'Restricted file type' };

  const isWriteOp = ['write_file_content', 'create_file', 'delete_file'].includes(toolName);
  if (isWriteOp) return { permissionDecision: 'ask' }; // solicitar aprovação

  return { permissionDecision: 'allow' };
};
```

### Shell Tools (Sprint 21)

```js
const BLOCKED_COMMANDS = [
  'rm -rf',
  'dd if=',
  'mkfs',
  'fdisk',
  'shutdown',
  'reboot',
  'chmod 777',
  'chown root',
  'su ',
  'sudo su',
];

const shellRestrictionsHook = async (input) => {
  if (input.toolName !== 'exec_command') return { permissionDecision: 'allow' };
  const cmd = input.args?.command ?? '';
  const isBlocked = BLOCKED_COMMANDS.some((b) => cmd.includes(b));
  if (isBlocked) return { permissionDecision: 'deny', reason: 'Dangerous command blocked' };
  return { permissionDecision: 'ask' }; // sempre pedir aprovação para shell
};
```

---

## Referência Cruzada

| Objetivo              | Documento                                 | Seção              |
| --------------------- | ----------------------------------------- | ------------------ |
| API completa do SDK   | SDK-COPILOT-API-COMPLETA.md               | Partes I-IV        |
| Arquitetura profunda  | SDK-COPILOT-ARQUITETURA-PROFUNDA.md       | Capítulos 15-16    |
| Integrações propostas | SDK-COPILOT-INTEGRACOES-PROPOSTAS.md      | Seção MCP e Skills |
| Estado de sessão      | `.github/hooks/state/session-briefing.md` | —                  |
| Tarefas pendentes     | `.github/hooks/state/pending-tasks.md`    | —                  |

---

---

## PARTE HISTÓRICA — Fases 15–16 (referência; já implementadas)

> Conteúdo original do arquivo mantido abaixo para referência histórica. Sprint 15: implementado em
> commit `9d73fe44` Sprint 16a: implementado em commit `28a6152a` Sprint 16b: implementado em commit
> `0ff1ad8c` Sprint 16c: implementado em commit `7ebb2843`

---

## Contexto: onde estamos (pós-Sprint 14)

### Estado atual da base de código

| Módulo                   | Status             | Testes     |
| ------------------------ | ------------------ | ---------- |
| `lib/client.js`          | ✅ Implementado     | Sprint 10  |
| `lib/session.js`         | ✅ Implementado     | Sprint 10  |
| `lib/permissions.js`     | ✅ Implementado     | Sprint 10  |
| `lib/hooks.js`           | ✅ Implementado     | Sprint 11  |
| `lib/providers.js`       | ✅ Implementado     | Sprint 12  |
| `lib/mcp.js`             | ✅ Implementado     | Sprint 12  |
| `lib/agents.js`          | ✅ Implementado     | Sprint 13  |
| `lib/models.js`          | ✅ Implementado     | Sprint 13  |
| `lib/telemetry.js`       | ✅ Implementado     | Sprint 14  |
| `lib/tools-registry.js`  | ✅ Implementado     | Sprint 14  |
| `always-alive.js`        | ✅ Funcional        | Sem testes |
| `llm-bridge-client.js`   | ✅ Funcional        | Sem testes |
| `mcp-tool-bridge.js`     | ✅ Funcional (sync) | Sem testes |
| `http-bridge.js`         | ✅ Funcional        | Sem testes |
| `sdk-api.js`             | ✅ Funcional        | Sem testes |
| `tools/task-tools.js`    | ✅ Implementado     | Sem testes |
| `tools/code-tools.js`    | ✅ Implementado     | Sem testes |
| `tools/git-tools.js`     | ✅ Implementado     | Sem testes |
| `tools/hook-tools.js`    | ✅ Implementado     | Sem testes |
| `tools/session-tools.js` | ✅ Implementado     | Sem testes |

**Total de testes**: 1278/1278 ✅ (todos os testes da lib/) **SDK instalado**:
`@github/copilot-sdk v0.1.32` **SDK mais recente**: `v0.2.0` (lançado 2026-03-20)

### Tools que LLM-B possui hoje

| Tool                  | Capacidade                           |
| --------------------- | ------------------------------------ |
| `get_tasks`           | Lista tasks da fila (REST)           |
| `add_task`            | Cria task na fila                    |
| `get_session_state`   | Lê arquivos de estado do hook system |
| `lint_check`          | ESLint com fix e path                |
| `run_tests`           | Executa suite de testes              |
| `git_status`          | Status + log git                     |
| `git_diff`            | Diff staged/não staged               |
| `git_commit`          | Commit com mensagem                  |
| `read_briefing`       | Lê session-briefing.md               |
| `write_pending_task`  | Adiciona em pending-tasks.md         |
| `hook_get_audit_tail` | Últimas N entradas de audit.jsonl    |
| `request_user_input`  | Pergunta ao LLM-A (wrapper ask_user) |
| `mcp_*`               | Tools dinâmicas do MCP Tool Registry |

---

## Análise de Gaps — Comunicação LLM-A ↔ LLM-B

### Capacidades críticas faltantes

#### 1. Acesso ao filesystem (ALTA PRIORIDADE)

LLM-B não pode **ler nem escrever** arquivos. Isso significa:

- Não consegue inspecionar código-fonte para responder perguntas técnicas
- Não consegue criar/editar arquivos diretamente (precisa dictar texto para LLM-A copiar)
- Não consegue ler documentação, skills, ou architecture docs

#### 2. Auto-introspecção (ALTA PRIORIDADE)

LLM-B não sabe:

- Quais tools tem disponíveis (sem `list_tools`)
- Suas próprias métricas de desempenho (`telemetry.js` foi criado mas não conectado)
- Estado detalhado da sessão (modelo ativo, uptime, contagem de turnos)

#### 3. Protocolo de mensagem estruturado (MÉDIA PRIORIDADE)

Comunicação LLM-A ↔ LLM-B é plain text:

- Não há envelope JSON para tipar o conteúdo das respostas
- LLM-A precisa fazer parse manual de respostas
- Não há como LLM-B sinalizar tipo de resposta (código, pergunta, resultado)

#### 4. MCP bridge síncrono (MÉDIA PRIORIDADE)

`mcp-tool-bridge.js` usa `execSync(curl)`:

- Bloqueia o event loop do Node.js durante cada chamada MCP
- Sem retry automático em falhas transitórias
- Pode causar degradação de performance sob carga

#### 5. Atualização do SDK (BAIXA-MÉDIA PRIORIDADE)

SDK v0.2.0 traz features relevantes:

- `skipPermission: true` em `defineTool` — bypass confirmação para tools read-only
- Fine-grained system prompt customization (10 seções configuráveis)
- OpenTelemetry nativo (substitui `lib/telemetry.js` customizado)
- `session.rpc.shell.exec(command)` — execução de shell via RPC
- `session.rpc.skills/mcp/extensions` — controle programático de skills e MCP
- Blob attachments (imagens inline sem escrever em disco)
- `SessionConfig.onEvent` catch-all para eventos early

---

## Novidades do SDK v0.2.0 relevantes para este projeto

### `skipPermission: true` em `defineTool`

```javascript
const myTool = defineTool('read_file', {
  description: '...',
  parameters: schema,
  handler: async (params) => {
    /* ... */
  },
  skipPermission: true, // ← NOVO em v0.2.0 — tools read-only não pedem confirmação
});
```

Impacto: `read_file`, `list_files`, `get_agent_context` podem usar `skipPermission: true`.

### Fine-grained system prompt customization

```javascript
const session = await client.createSession({
  systemMessage: {
    mode: 'customize',
    sections: {
      identity: { action: (current) => current.replace('GitHub Copilot', 'Assistente SDK') },
      tone: { action: 'replace', content: 'Seja direto e técnico.' },
      custom_instructions: { action: 'append', content: '...' },
    },
  },
});
```

Impacto: permite injetar contexto rico da sessão (sprint atual, pending tasks) sem substituir o
system prompt inteiro.

### `session.rpc.skills.list()` / `.enable()` / `.reload()`

APIs experimentais para controlar skills programaticamente. LLM-B poderá usar uma tool para listar e
recarregar skills.

### `session.rpc.mcp.list()` / `.enable()` / `.disable()`

LLM-B pode controlar quais MCP servers estão ativos — sem reiniciar o agente.

### `session.rpc.shell.exec(command)`

Execução de shell via RPC, sem precisar de `execSync` no processo principal.

### OpenTelemetry nativo

```javascript
const client = new CopilotClient({
  telemetry: {
    otlpEndpoint: 'http://localhost:4318',
    sourceName: 'copilot-sdk-agent',
  },
});
```

Pode ser integrado com ou como complemento ao `lib/telemetry.js` customizado.

---

## Pesquisa sobre MCP

### O que é MCP (Model Context Protocol)

O MCP (criado pela Anthropic, agora community-driven) especifica um protocolo JSON-RPC para que LLMs
se conectem a "servidores de contexto" que fornecem **tools**, **resources** e **prompts**.

**Versão mais recente (estável)**: `2025-11-25` **Schema**: TypeScript first, JSON Schema disponível
**GitHub**: https://github.com/modelcontextprotocol/modelcontextprotocol

### Capacidades do protocolo MCP que ainda não usamos

| Capacidade MCP           | Status neste projeto      | Oportunidade                                   |
| ------------------------ | ------------------------- | ---------------------------------------------- |
| `tools/list`             | ✅ Usado (mcp-tool-bridge) | —                                              |
| `tools/call`             | ✅ Usado (mcp-tool-bridge) | —                                              |
| `resources/list`         | ❌ Não implementado        | LLM-B acessa arquivos via MCP resource!        |
| `resources/read`         | ❌ Não implementado        | Alternativa ao file-tools custom               |
| `resources/subscribe`    | ❌ Não implementado        | Watch em arquivos (atualizações em tempo real) |
| `prompts/list`           | ❌ Não implementado        | Catálogo de prompts reutilizáveis              |
| `prompts/get`            | ❌ Não implementado        | Injetar prompts dinâmicos                      |
| `completion/complete`    | ❌ Não implementado        | Autocomplete de argumentos                     |
| `logging/setLevel`       | ❌ Não implementado        | Diagnóstico remoto                             |
| Sampling (server→client) | ❌ Não implementado        | MCP server chama o LLM diretamente             |

**Insight crítico**: em vez de criar `tools/file-tools.js` com tools customizadas, pode-se expor os
arquivos do workspace como **MCP resources**. Isso é mais idiomático ao protocolo MCP e permite que
qualquer cliente MCP (não só LLM-B) acesse os arquivos.

### MCP Resources vs. Custom File Tools

| Abordagem                   | Prós                                                   | Contras                           |
| --------------------------- | ------------------------------------------------------ | --------------------------------- |
| **Custom tool** `read_file` | Simples, já no padrão SDK                              | Fora do padrão MCP, duplica infra |
| **MCP resource**            | Padrão oficial, reutilizável                           | Requer MCP server local           |
| **Filesystem MCP Server**   | Já existe! (`@modelcontextprotocol/server-filesystem`) | Dependência externa               |

**Recomendação**: implementar custom file tools AGORA (Sprint 15) e avaliar migração para MCP
resources depois (Sprint 17+), pois a infra MCP já existe neste projeto.

---

## Planejamento Detalhado das Próximas Fases

### Sprint 15 — File Tools ★ ALTA PRIORIDADE

**Objetivo**: LLM-B passa a ler e escrever arquivos dentro do workspace.

**Justificativa**: Este é o gap de maior impacto. Sem acesso a arquivos, LLM-B não consegue
inspecionar o código que vai modificar, ler documentação, ou criar novos arquivos. É o pré-requisito
para qualquer trabalho de código autônomo significativo.

**Arquivos a criar**:

| Arquivo                                  | Conteúdo                                         |
| ---------------------------------------- | ------------------------------------------------ |
| `src/copilot/tools/file-tools.js`        | 3 tools: `read_file`, `write_file`, `list_files` |
| `tests/copilot/tools/file-tools.test.js` | ~30 testes unitários                             |

**Especificação das tools**:

#### `read_file`

```javascript
defineTool('read_file', {
  description: 'Lê o conteúdo de um arquivo dentro do workspace.',
  parameters: z.object({
    path: z.string().describe('Caminho relativo ao root do workspace'),
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
  }),
  skipPermission: true, // read-only
  handler: async ({ path, startLine, endLine }) => {
    /* ... */
  },
});
```

- Output truncado a 8000 chars
- Segurança: normalização de path, rejeita `../` que escape do workspace
- Com startLine/endLine: retorna apenas o intervalo de linhas

#### `write_file`

```javascript
defineTool('write_file', {
  description:
    'Cria ou sobrescreve um arquivo no workspace. Faz backup automático antes de sobrescrever.',
  parameters: z.object({
    path: z.string(),
    content: z.string(),
    createDirs: z.boolean().optional().default(true),
  }),
  handler: async ({ path, content, createDirs }) => {
    /* ... */
  },
});
```

- Backup automático em `.copilot-backups/<timestamp>/<path>` antes de sobrescrever
- Sandboxing: apenas dentro do workspace root
- `createDirs: true` cria diretórios intermediários

#### `list_files`

```javascript
defineTool('list_files', {
  description: 'Lista arquivos em um diretório do workspace.',
  parameters: z.object({
    dir: z.string().optional().default('.'),
    pattern: z.string().optional().describe('Glob pattern (ex: *.js)'),
    maxResults: z.number().int().min(1).max(500).optional().default(100),
  }),
  skipPermission: true,
  handler: async ({ dir, pattern, maxResults }) => {
    /* ... */
  },
});
```

- Usa `fd` quando disponível, fallback para `readdir` recursivo
- Respeita `.gitignore` por padrão
- Limite de 500 resultados

**Segurança** (crítica):

- Resolver path real com `path.resolve()` e `path.normalize()`
- Verificar que resultado começa com `WORKSPACE_ROOT`
- Rejeitar com erro explícito se path escapar do sandbox

**Estimativa de testes**: ~25-30 testes (sandbox, truncação, linhas, erros)

---

### Sprint 16 — Introspection Tools ★ ALTA PRIORIDADE

**Objetivo**: LLM-B conhece seu próprio estado, ferramentas disponíveis e métricas.

**Justificativa**: `telemetry.js` e `tools-registry.js` foram criados no Sprint 14 mas ainda não
estão integrados à camada de runtime. Este sprint os conecta e expõe tudo como tools.

**Arquivos a criar/modificar**:

| Arquivo                                           | Conteúdo                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/copilot/tools/introspection-tools.js`        | 3 tools: `list_available_tools`, `get_telemetry_summary`, `get_agent_context` |
| `src/copilot/always-alive.js`                     | Integrar telemetry.js — instrumentar tool calls                               |
| `tests/copilot/tools/introspection-tools.test.js` | ~25 testes                                                                    |

**Especificação das tools**:

#### `list_available_tools`

```javascript
defineTool('list_available_tools', {
  description: 'Lista todas as tools disponíveis para este agente.',
  parameters: z.object({
    category: z.string().optional(),
  }),
  skipPermission: true,
  handler: async ({ category }) => {
    /* usa tools-registry */
  },
});
```

- Retorna nome, descrição, categoria de cada tool registrada
- Filtro opcional por categoria

#### `get_telemetry_summary`

```javascript
defineTool('get_telemetry_summary', {
  description: 'Retorna sumário de telemetria: total de calls, taxa de sucesso, duração média.',
  parameters: z.object({}),
  skipPermission: true,
  handler: async () => {
    /* usa telemetry.js */
  },
});
```

- Retorna: total calls, success rate, avg duration, top 5 tools por uso

#### `get_agent_context`

```javascript
defineTool('get_agent_context', {
  description: 'Retorna contexto completo do agente: status, modelo, sessão, uptime.',
  parameters: z.object({}),
  skipPermission: true,
  handler: async () => {
    /* alwaysAliveAgent.getStatusSnapshot() + extras */
  },
});
```

- Status, modelo ativo, sessionId, turnCount, queueSize, uptime, horaAtual

**Integração com `always-alive.js`**:

```javascript
// Em processTask(), após cada tool call:
recordToolCall(telemetry, toolName, durationMs, success, sessionId);
```

---

### Sprint 17 — MCP Bridge Async + skipPermission ★ MÉDIA PRIORIDADE

**Objetivo**: Eliminar `execSync` do mcp-tool-bridge.js e usar `skipPermission` nas tools read-only.

**Justificativa**: `execSync(curl)` bloqueia o event loop de Node.js durante cada chamada MCP — em
ambiente de alta frequência, isso é um gargalo severo. O v0.2.0 do SDK também introduz
`skipPermission` que simplifica o fluxo para tools somente-leitura.

**Arquivos a modificar**:

| Arquivo                                    | O que muda                                                        |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `src/copilot/mcp-tool-bridge.js`           | Substituir `execSync(curl)` por `fetch()` assíncrono com retry    |
| `src/copilot/tools/file-tools.js`          | Adicionar `skipPermission: true` (requer upgrade SDK para v0.2.0) |
| `src/copilot/tools/introspection-tools.js` | Adicionar `skipPermission: true`                                  |
| `package.json`                             | Upgrade `@github/copilot-sdk` de `0.1.32` → `0.2.0`               |

**Refatoração de `rpcCall`**:

```javascript
// ANTES (v atual):
function rpcCall(method, params) {
  const result = execSync(`curl ... -d '...'`, { timeout: 8000 });
  return JSON.parse(result);
}

// DEPOIS (Sprint 17):
async function rpcCall(method, params, { retries = 2, timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    return await res.json();
  } catch (e) {
    if (retries > 0) return rpcCall(method, params, { retries: retries - 1, timeoutMs });
    throw e;
  } finally {
    clearTimeout(tid);
  }
}
```

**Consideração de upgrade do SDK**:

- v0.2.0 tem breaking change apenas para Python (API TypedDict → dataclass)
- Para Node.js: mudanças menores, sem breaking para o código atual
- `autoRestart` deprecated mas não removido (ainda funciona)
- Testar em branch separada antes de merge

---

### Sprint 18 — MCP Resources (acesso a arquivos via protocolo nativo) ★ OPCIONAL

**Objetivo**: Expor arquivos do workspace como MCP Resources em vez de (ou além de) custom file
tools.

**Justificativa**: O protocolo MCP define `resources` como o mecanismo idiomático para expor
arquivos a LLMs. Em vez de criar tools customizadas, podemos configurar o filesystem MCP server
oficial (`@modelcontextprotocol/server-filesystem`) ou criar um MCP server local que expõe o
workspace.

**Vantagens sobre custom file tools**:

- Padrão oficial — qualquer cliente MCP pode usar
- `resources/subscribe` — notificação de mudanças em tempo real
- Separação de concerns: tools = ações, resources = dados

**Arquivos a criar** (se aprovado):

| Arquivo                            | Conteúdo                                             |
| ---------------------------------- | ---------------------------------------------------- |
| `src/copilot/lib/mcp-resources.js` | Wrapper para registrar resources no MCP server local |
| `config/mcp-filesystem.json`       | Configuração do MCP filesystem server                |

**Decisão pendente**: avaliar se o MCP server local já suporta filesystem resources ou se é
necessário adicionar. Ver configuração atual em `.github/hooks/state/` ou `config/`.

---

### Sprint 19 — Testes de Integração ★ QUALIDADE

**Objetivo**: Cobrir as camadas não testadas do `src/copilot` com testes de integração.

**Estado atual**: `tests/copilot/` tem apenas testes de `lib/*`. Os arquivos centrais não têm
testes.

**Arquivos a criar**:

| Arquivo                                           | O que testa                                                      | # testes est. |
| ------------------------------------------------- | ---------------------------------------------------------------- | ------------- |
| `tests/copilot/always-alive.test.js`              | `AlwaysAliveAgent`: start/stop/sendMessage/answer, events, queue | ~35           |
| `tests/copilot/llm-bridge-client.test.js`         | `LlmBridgeClient`: chat, history, dialog mode, timeout           | ~25           |
| `tests/copilot/http-bridge.test.js`               | Rotas Express: status, health, send, answer, dialog/\*           | ~20           |
| `tests/copilot/tools/file-tools.test.js`          | Sandbox, read, write, list (Sprint 15)                           | ~30           |
| `tests/copilot/tools/introspection-tools.test.js` | list_tools, telemetry, context (Sprint 16)                       | ~20           |

**Total estimado**: ~130 novos testes → **1278 + 130 ≈ 1408 testes**

**Estratégia de mock**:

- `CopilotClient` e `CopilotSession`: mocks completos (sem SDK real)
- Express rotas: `supertest` para HTTP tests
- `AlwaysAliveAgent`: mock do SDK, testa apenas lógica de orquestração

---

## Tabela de Prioridades e Dependências

```
Sprint 15 (File Tools)
    ↓
Sprint 16 (Introspection)  ←─── depende Sprint 14 (telemetry + tools-registry)
    ↓
Sprint 17 (MCP Async + skipPermission)  ←─── upgrade SDK v0.2.0
    ↓
Sprint 18 (MCP Resources)  ←─── opcional, após validação 17
    │
Sprint 19 (Testes)  ←─── pode rodar paralelo a partir de Sprint 15
```

| Sprint | Meta                   | Impacto   | Esforço                | Prioridade |
| ------ | ---------------------- | --------- | ---------------------- | ---------- |
| **15** | File Tools             | CRÍTICO   | Médio (~1 dia)         | ★★★★★      |
| **16** | Introspection Tools    | ALTO      | Médio (~1 dia)         | ★★★★☆      |
| **17** | MCP Async + SDK v0.2.0 | MÉDIO     | Médio-Alto (~1,5 dias) | ★★★☆☆      |
| **18** | MCP Resources          | BAIXO     | Alto (~2 dias)         | ★★☆☆☆      |
| **19** | Testes de Integração   | QUALIDADE | Alto (~2 dias)         | ★★★☆☆      |

---

## Atualização do SDK: v0.1.32 → v0.2.0

### O que muda para este projeto (Node.js)

| Feature                               | Impacto                                      | Sprint |
| ------------------------------------- | -------------------------------------------- | ------ |
| `skipPermission` em `defineTool`      | Simplifica tools read-only (sem confirmação) | 17     |
| Fine-grained system prompt            | Injetar contexto sprint/session no prompt    | 16     |
| `session.rpc.shell.exec`              | LLM-B pode executar comandos sem `execSync`  | 17+    |
| `session.rpc.skills.list/reload`      | LLM-B controla skills do agente              | 18     |
| `session.rpc.mcp.list/enable/disable` | LLM-B controla MCP servers ativos            | 18     |
| OpenTelemetry nativo                  | Complementa `lib/telemetry.js` customizado   | 17     |
| Blob attachments                      | Screenshots → LLM-B                          | 18+    |
| `onEvent` catch-all                   | Nunca perder eventos early de sessão         | 16     |
| CJS compatibility                     | Não impacta (já ESM)                         | —      |

### Breaking changes para Node.js (NENHUM)

- `autoRestart` deprecated mas ainda funciona (não usamos)
- Apenas Python teve breaking changes significativas nesta versão

### Procedimento de upgrade recomendado (Sprint 17)

```bash
# 1. Criar branch de upgrade
git checkout -b feat/sdk-upgrade-v0.2.0

# 2. Upgrade
npm install @github/copilot-sdk@0.2.0

# 3. Rodar testes
npm run test:unit && npm run typecheck:node

# 4. Validar funcionalidades específicas
# - skipPermission nas tools novas
# - session.rpc.shell.exec como alternativa ao execSync
```

---

## Diagrama de Comunicação LLM-A ↔ LLM-B (estado alvo após Sprints 15-16)

```
LLM-A (GitHub Copilot — VS Code)
    │
    ├── llm-bridge-client.chat("tarefa...")
    │       ↓
    │   AlwaysAliveAgent.sendMessage()
    │       ↓ task queued
    │   CopilotSession (SDK v0.2.0)
    │       ↓ LLM-B processa
    │   LLM-B usa tools:
    │   ├── read_file("src/copilot/...") ← NOVO Sprint 15
    │   ├── write_file("src/...") ← NOVO Sprint 15
    │   ├── list_files("src/") ← NOVO Sprint 15
    │   ├── list_available_tools() ← NOVO Sprint 16
    │   ├── get_telemetry_summary() ← NOVO Sprint 16
    │   ├── get_agent_context() ← NOVO Sprint 16
    │   ├── run_tests({ suite: 'fast' })
    │   ├── git_diff()
    │   ├── git_commit({ message: '...' })
    │   ├── request_user_input({ question: '...' })
    │   │       ↓ ask_user event
    │   │   LLM-A responde via answer()
    │   └── ...
    │       ↓ task.completed
    └── response: string ← resultado plain text (Sprint 17 = envelope JSON)
```

---

## Notas de Segurança

### File Tools (Sprint 15) — Restrições obrigatórias

1. **Path traversal prevention**: `path.resolve(WORKSPACE_ROOT, userPath)` deve começar com
   `WORKSPACE_ROOT`
2. **Write size limit**: rejeitar `write_file` com content > 500KB
3. **Backup antes de sobrescrever**: `.copilot-backups/` com timestamp
4. **No execute bit**: `write_file` apenas cria/modifica conteúdo, nunca executa
5. **Extensões permitidas**: opcionalmente, whitelist de extensões para `write_file` (`.js`, `.ts`,
   `.md`, `.json`, `.yaml`)
6. **Proteção de arquivos críticos**: rejeitar escrita em `.env`, arquivos com credenciais

### MCP Bridge Async (Sprint 17) — Restrições

1. **URL validation**: validar `MCP_BASE_URL` no startup, rejeitar se não for localhost/conhecido
2. **Timeout máximo**: 10s por chamada, não parametrizável pelo LLM-B
3. **Retry máximo**: 3 tentativas, não parametrizável

---

## Referência Cruzada

| Documento                                                                  | Conteúdo                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [SDK-COPILOT-ARQUITETURA-PROFUNDA.md](SDK-COPILOT-ARQUITETURA-PROFUNDA.md) | Fundamentos, billing, sprints 1-14, lib/\* completa           |
| Este arquivo                                                               | Sprints 15-19, gaps de comunicação, SDK v0.2.0, MCP resources |
| [ARCHITECTURE.md](../../DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md)          | Visão geral do sistema completo                               |

---

_Documento criado em 2026-07-27 após auditoria completa de `src/copilot` + pesquisa SDK v0.2.0 + MCP
specification v2025-11-25._

---

## Sprints Pós-22 — Planejamento LLM-A ↔ LLM-B (2026-03-23)

> **Sessão colaborativa**: LLM-A (GitHub Copilot) conversou com LLM-B (gpt-4.1 via AlwaysAliveAgent)
> em 5 turnos para planejar os próximos sprints. Resultados abaixo.

### Status pós-Sprint 22

- ✅ AlwaysAliveAgent inicializa standalone (sem servidor Express)
- ✅ LLM-B responde: model=gpt-4.1, 30 tools registradas
- ✅ LLM-B executou `npm run test:unit`: 0 falhas confirmadas
- ✅ Protocolo de comunicação estruturada definido colaborativamente

### Ordem de prioridade técnica (definida por LLM-B)

| #   | Sprint                             | Escopo                | Justificativa LLM-B                                                   |
| --- | ---------------------------------- | --------------------- | --------------------------------------------------------------------- |
| 1   | **A — Structured Dialog Protocol** | LlmBridgeClient       | Base para comunicação robusta, padroniza fluxo, facilita extensões    |
| 2   | **C — Tool Call Auditing**         | tools/ + hooks        | Com protocolo estruturado, auditoria fica mais simples e confiável    |
| 3   | **24 — Integration Tests**         | tests/copilot/        | Alta prioridade, base de confiança para todos os módulos copilot      |
| 4   | **D — Parallel Task Queue**        | always-alive + bridge | Depende de protocolo estruturado e auditoria para consolidação segura |
| 5   | **B — Session Persistence v2**     | session-manager       | Útil mas menos crítico; incrementar após protocolo estáveis           |

---

### Sprint A — Structured Dialog Protocol

**Objetivo**: Protocolo JSON estruturado para comunicação LLM-A ↔ LLM-B com parsing robusto.

**Schema definido por LLM-B:**

```javascript
/**
 * @typedef {Object} StructuredMessage
 * @property {string} context     - Resumo do estado atual ou briefing relevante
 * @property {string} intent      - Objetivo principal da mensagem
 * @property {'low'|'medium'|'high'} priority  - Prioridade da ação
 * @property {'diagnostic'|'plan'|'code'|'question'} responseType - Tipo de resposta
 * @property {string} output      - Conteúdo principal (diagnóstico, plano, código, etc)
 */
```

**Serialização**: JSON puro, sem envelope textual. LLM-B deve sempre responder com JSON puro
`StructuredMessage`.

**Campo `responseType`**:
- `'diagnostic'` — diagnósticos de sistema/testes
- `'plan'` — planejamento de sprints/tarefas
- `'code'` — código a implementar
- `'question'` — pergunta para LLM-A

**Arquivos a criar/modificar**:
- `src/copilot/types/structured-message.js` — definição do tipo + validador Zod
- `src/copilot/llm-bridge-client.js` — `chatStructured(msg: StructuredMessage)` method
- `tests/unit/copilot/test_structured_message.spec.js` — testes de schema + serialização

---

### Sprint C — Tool Call Auditing

**Objetivo**: Registrar cada chamada de ferramenta com contexto completo para auditoria e debugging.

**Formato do log** (`.github/hooks/state/tool-audit.jsonl`):

```jsonl
{"ts":1774304482417,"tool":"exec_command","args":{"command":"npm run test:unit"},"result":{"exitCode":0},"durationMs":53750,"sessionId":"d9c7e155-..."}
```

**Arquivos a criar/modificar**:
- `src/copilot/lib/tool-auditor.js` — serviço de auditoria com append a JSONL
- Patch em cada tool existente (`shell-tools.js`, `file-tools.js`, `hook-tools.js`) para chamar auditor
- `tests/unit/copilot/test_tool_auditor.spec.js`

---

### Sprint 24 — Integration Tests (já planejado)

**Objetivo**: Testes de integração cobrindo fluxo completo do módulo copilot.

**Arquivos a criar**:
- `tests/integration/copilot/test_sdk_api.spec.js`
- `tests/integration/copilot/test_tools_file.spec.js`
- `tests/integration/copilot/test_tools_shell.spec.js`
- `tests/integration/copilot/test_config_builders.spec.js`

---

### Sprint D — Parallel Task Queue

**Pré-requisito**: Sprint A (Structured Dialog Protocol) concluído.

**Objetivo**: LLM-A enfileira múltiplas tasks simultaneamente; LLM-B responde em paralelo com
consolidação de resultados.

**Arquivos a criar/modificar**:
- `src/copilot/parallel-task-queue.js` — fila de tasks com `Promise.allSettled`
- `src/copilot/llm-bridge-client.js` — `chatBatch(messages: StructuredMessage[])` method

---

### Sprint B — Session Persistence v2

**Pré-requisito**: Sprint A concluído.

**Objetivo**: LLM-B recebe os últimos N turnos como contexto ao retomar uma sessão.

**Arquivos a modificar**:
- `src/copilot/session-manager.js` — persistir turnos em SQLite (já disponível)
- `src/copilot/always-alive.js` — injetar histórico ao `initOrResumeSession`

---

### Script de conversa (artefato criado)

`src/copilot/llm-a-conversation.mjs` — script de 5 turnos para conversas programáticas LLM-A ↔ LLM-B.
Execução: `node --strip-types src/copilot/llm-a-conversation.mjs`
