# LLM-A Communication Guide

> **Para**: LLM-A (GitHub Copilot — orquestrador deste repositório)
> **Sobre**: Como me comunicar com LLM-B (Copilot SDK / gpt-4.1) de forma robusta
> **Criado**: 2026-03-23 (revisado após conversa colaborativa de 5 turnos)

---

## 1. O que é LLM-B e como ela funciona

**LLM-B** é o modelo `gpt-4.1` rodando dentro do `@github/copilot-sdk` via `AlwaysAliveAgent`. Ela:
- Mantém uma sessão viva indefinidamente (sempre-alive)
- Tem acesso a 30 ferramentas: bash, arquivo, git, npm, SQL, agentes especializados, skills, hooks
- Processa mensagens em fila, com streaming de tokens por `task.delta`
- Pode fazer perguntas de volta via `ask_user` (que LLM-A responde via `.answer()`)

**LLM-B NÃO é um HTTP server separado** — ela é uma camada de SDK sobre a API GitHub Copilot.
**O servidor Express principal (porta 3008) NÃO é necessário** para conversar com LLM-B.

---

## 2. Como LLM-A conversa com LLM-B (fluxo técnico)

### Camadas de comunicação

```
LLM-A (GitHub Copilot — VS Code Agent)
    │
    ├── [node --strip-types script.mjs]    ← executa script standalone
    │       ↓
    │   AlwaysAliveAgent.start()           ← inicializa sessão SDK (1-2s)
    │       ↓
    │   LlmBridgeClient.chat(message)      ← envia mensagem, aguarda resposta
    │       ↓ streaming via task.delta
    │   response: string                   ← resposta completa
    │       ↓
    │   AlwaysAliveAgent.stop()            ← encerra sessão
    │
    └── [resultado disponível no terminal]
```

### Script mínimo de conversa

```javascript
// src/copilot/meus-scripts/minha-tarefa.mjs
import { alwaysAliveAgent } from '../always-alive.js';
import { LlmBridgeClient } from '../llm-bridge-client.js';

await alwaysAliveAgent.start();
const bridge = new LlmBridgeClient();

const result = await bridge.chat('Olá LLM-B! Execute npm run test:unit e diga o resultado.', {
    onDelta: (chunk) => process.stdout.write(chunk),  // streaming em tempo real
    timeoutMs: 120_000,  // 2 minutos para tarefas longas
});

console.log('\n[', result.durationMs, 'ms,', result.responseLen, 'chars]');
await alwaysAliveAgent.stop();
```

**Execução**: `node --strip-types src/copilot/meus-scripts/minha-tarefa.mjs`

### Script avançado com `chatStructured` (Sprint A — implementado)

```javascript
import { alwaysAliveAgent } from '../always-alive.js';
import { LlmBridgeClient } from '../llm-bridge-client.js';

await alwaysAliveAgent.start();
const bridge = new LlmBridgeClient();

const result = await bridge.chatStructured({
    context: 'Sprint A acabou de ser implementado. 1395 testes passando.',
    intent: 'Verificar se os novos testes do Sprint A estão passando',
    priority: 'high',
    responseType: 'diagnostic',
}, {
    onDelta: (chunk) => process.stdout.write(chunk),
});

// result.structured: StructuredMessage parseado da resposta
// result.raw: string bruta de LLM-B
console.log('\n[Tipo:', result.structured?.responseType, ']');
await alwaysAliveAgent.stop();
```

---

## 3. O protocolo StructuredMessage (Sprint A)

**Por que usar**: mensagens estruturadas permitem que LLM-A e LLM-B se entendam sem ambiguidade,
com campos explícitos que podem ser inspecionados, logados e auditados.

### Schema

```javascript
/**
 * @typedef {Object} StructuredMessage
 * @property {string} context
 *   Resumo do estado atual do sistema ou briefing relevante.
 *   Exemplo: "Sprint 22 concluído. 1395 testes. Próximo: Sprint A."
 * @property {string} intent
 *   Objetivo principal desta mensagem. O que LLM-B deve fazer.
 *   Exemplo: "Verificar se todos os testes passam após mudança em config/index.js"
 * @property {'low'|'medium'|'high'} priority
 *   Urgência da tarefa. 'high' = precisa resposta imediata e correta.
 * @property {'diagnostic'|'plan'|'code'|'question'} responseType
 *   Tipo de resposta esperado:
 *   - 'diagnostic': relatório de estado/saúde do sistema
 *   - 'plan': plano de ação / lista de sprints
 *   - 'code': código a implementar (retorna blocos ```js)
 *   - 'question': LLM-B precisa de mais informação
 * @property {string} [output]
 *   Conteúdo principal da resposta (preenchido por LLM-B).
 *   Omitido quando LLM-A envia a mensagem.
 */
```

### Serialização

**LLM-A → LLM-B**: JSON puro, sem texto extra antes ou depois.
```json
{
  "context": "Estou implementando Sprint A. Arquivo: src/copilot/types/structured-message.js",
  "intent": "Revisar o schema e sugerir campos adicionais se necessário",
  "priority": "medium",
  "responseType": "plan"
}
```

**LLM-B → LLM-A**: Também JSON puro, campo `output` preenchido.
```json
{
  "context": "Schema recebido e analisado",
  "intent": "Sugestão de campos adicionais",
  "priority": "medium",
  "responseType": "plan",
  "output": "Sugiro adicionar: sessionId, turnNumber, toolsUsed[]"
}
```

### Regra de fallback

Se LLM-B responder com texto puro (não JSON), `chatStructured()` ainda funciona:
- `result.structured = null`
- `result.raw = resposta_inteira`
- Não lançar erro — LLM-B pode não ter entendido que deve responder em JSON

---

## 4. Modos de conversa disponíveis

### Modo 1: `chat()` — string simples (para tarefas de propósito geral)
```javascript
const result = await bridge.chat('Execute npm run lint e diga o número de erros.');
```
- **Quando usar**: diagnósticos rápidos, tarefas ad-hoc, pilotos
- **Retorna**: `ChatResult { response: string, durationMs, responseLen, chunks }`

### Modo 2: `chatStructured()` — protocolo JSON (para integração LLM-A ↔ LLM-B)
```javascript
const result = await bridge.chatStructured({ context, intent, priority, responseType });
```
- **Quando usar**: comunicação programática formal, auditável, persistível
- **Retorna**: `StructuredChatResult { structured: StructuredMessage|null, raw: string, ...ChatResult }`

### Modo 3: `startDialogMode()` / `dialogTurn()` — Dialog Loop (para iteração multi-passo)
```javascript
await bridge.startDialogMode('Realize N tarefas usando ask_user entre cada uma');
const reply1 = await bridge.dialogTurn('Tarefa 1: verifique os testes');
const reply2 = await bridge.dialogTurn('Tarefa 2: aplique lint fix');
await bridge.stopDialogMode();
```
- **Quando usar**: workflows multi-passo onde LLM-B coordena com LLM-A
- **Baseado em**: padrão §15.8 (Dialog Loop)

### Modo 4: `chatBatch()` — múltiplas tasks em paralelo (Sprint D — futuro)
```javascript
const results = await bridge.chatBatch([msg1, msg2, msg3]);
```
- **Quando usar**: análises independentes que podem ser paralelizadas
- **Status**: planejado para Sprint D

---

## 5. Ferramentas disponíveis para LLM-B (30 tools)

LLM-B pode usar estas ferramentas durante a conversa — basta mencionar na mensagem:

### Shell & Terminal
| Tool             | O que faz                             |
| ---------------- | ------------------------------------- |
| `exec_command`   | Executa comando shell (com allowlist) |
| `run_npm_script` | Executa scripts npm do projeto        |
| `run_node_file`  | Executa arquivo .js/.mjs com node     |

### Arquivo & Filesystem
| Tool              | O que faz                          |
| ----------------- | ---------------------------------- |
| `read_file`       | Lê arquivo (com limite de tamanho) |
| `write_file`      | Cria ou sobrescreve arquivo        |
| `append_file`     | Adiciona conteúdo ao final         |
| `delete_file`     | Remove arquivo                     |
| `list_files`      | Lista diretório                    |
| `file_exists`     | Verifica existência                |
| `get_file_info`   | Metadados (size, mtime)            |
| `find_files`      | Busca por pattern glob             |
| `read_json_file`  | Lê + parse JSON                    |
| `write_json_file` | Serializa + escreve JSON           |

### Git
| Tool         | O que faz          |
| ------------ | ------------------ |
| `git_status` | `git status` atual |
| `git_diff`   | Diff de arquivos   |
| `git_log`    | Últimos N commits  |
| `git_commit` | Cria commit        |
| `git_push`   | Push para origin   |

### Hooks & Estado da Sessão
| Tool                    | O que faz                                    |
| ----------------------- | -------------------------------------------- |
| `read_session_briefing` | Lê `.github/hooks/state/session-briefing.md` |
| `read_session_state`    | Lê `session.json` e `pending-tasks.md`       |
| `get_close_key`         | Obtém a chave de encerramento da sessão      |

### Agentes Especializados
| Tool                | O que faz                      |
| ------------------- | ------------------------------ |
| `explore_agent`     | Agente de exploração de código |
| `task_agent`        | Agente executor de tarefas     |
| `code_review_agent` | Agente de revisão de código    |

### Skills Customizadas
| Tool              | O que faz                        |
| ----------------- | -------------------------------- |
| `code_audit`      | Auditoria de qualidade de código |
| `jsdoc_authoring` | Geração de JSDoc robusto         |
| `typing_node24`   | Tipagem TypeScript/JSDoc         |

---

## 6. Ciclo de vida de uma conversa

```
1. alwaysAliveAgent.start()
   ├── Tenta retomar sessão existente (session-manager.js)
   ├── Se não encontrar → cria nova sessão
   └── Registra 30 tools + contexto de hooks no systemMessage

2. bridge.chat() ou bridge.chatStructured()
   ├── Adiciona mensagem à fila do agent
   ├── LLM-B processa com suas ferramentas
   ├── Streaming de tokens chega via task.delta
   └── Resposta completa retorna ao await

3. Se LLM-B precisar de input:
   ├── Emite evento question.pending
   ├── LLM-A recebe via onQuestion callback
   └── LLM-A chama bridge.answer('resposta')

4. alwaysAliveAgent.stop()
   ├── Persiste estado da sessão (ID salvo para retomada)
   └── Encerra listeners e limpeza
```

---

## 7. Sprints planejados para melhorar a comunicação

### Sprint A — Structured Dialog Protocol ✅ (este sprint)
**Status**: implementando agora
**Objetivo**: Schema `StructuredMessage` + `bridge.chatStructured()` + validação Zod
**Por que**: base para toda comunicação robusta e auditável entre LLM-A e LLM-B

### Sprint C — Tool Call Auditing
**Status**: pendente (após Sprint A)
**Objetivo**: Log JSONL de todo tool call: `{ts, tool, args, result, durationMs, sessionId}`
**Por que**: debugging, auditoria, análise de performance das ferramentas

### Sprint 24 — Integration Tests do módulo copilot
**Status**: pendente (alta prioridade)
**Objetivo**: Testes de integração para sdk-api, tools, config-builders
**Por que**: garantia de que o módulo copilot funciona end-to-end

### Sprint D — Parallel Task Queue
**Status**: futuro (depende de Sprint A)
**Objetivo**: `bridge.chatBatch()` para múltiplas tasks em paralelo
**Por que**: eficiência quando LLM-A precisa fazer múltiplas verificações independentes

### Sprint B — Session Persistence v2
**Status**: futuro (depende de Sprint A)
**Objetivo**: LLM-B recebe histórico dos últimos N turnos ao retomar sessão
**Por que**: melhora continuidade e reduz repetição de contexto

### Sprint E — LLM-A Self-Description Tool
**Status**: ideia (sprint futuro)
**Objetivo**: LLM-B pode chamar `get_llm_a_context()` para saber o que LLM-A sabe
**Por que**: elimina necessidade de LLM-A incluir contexto manualmente em cada mensagem

---

## 8. Boas práticas para LLM-A

### Sempre incluir contexto relevante
```javascript
// ❌ Pouco contexto
await bridge.chat('Execute os testes');

// ✅ Contexto adequado
await bridge.chatStructured({
    context: 'Sprint A acabou de ser implementado. Arquivos novos: types/structured-message.js, atualizado: llm-bridge-client.js',
    intent: 'Execute npm run test:unit -- --test-filter=structured e confirme 0 falhas',
    priority: 'high',
    responseType: 'diagnostic',
});
```

### Timeouts adequados por tipo de tarefa
```javascript
// Diagnósticos rápidos: 30s
await bridge.chat(msg, { timeoutMs: 30_000 });

// Testes unitários: 2min
await bridge.chat(msg, { timeoutMs: 120_000 });

// Testes de integração / auditorias: 5min
await bridge.chat(msg, { timeoutMs: 300_000 });
```

### Streaming para feedback imediato
```javascript
// Sempre usar onDelta para ver progresso em tempo real
await bridge.chat(msg, {
    onDelta: (chunk) => process.stdout.write(chunk),
});
```

### Verificar status antes de enviar
```javascript
const status = bridge.getAgentStatus();
if (status.status !== 'idle') {
    console.warn('Agente ocupado:', status.status);
}
```

---

## 9. Arquivos do módulo copilot (mapa)

> **GAP-04 (atualizado Fase AD)** — estrutura canônica refletindo migração para sub-diretórios por domínio.

```
src/copilot/
├── agent/
│   ├── always-alive.js          ← ⭐ AlwaysAliveAgent (core do agente)
│   ├── dialog-watchdog.js       ← watchdog de inatividade do dialog loop
│   ├── entry.js                 ← entry point PM2 sem servidor
│   ├── events.js                ← constantes AGENT_EVENTS
│   ├── session-manager.js       ← gerenciamento de sessão persistente
│   ├── task-executor.js         ← executor de tarefas SDK
│   ├── tools-bootstrap.js       ← bootstrap de ferramentas por sessão
│   └── webhook-manager.js       ← gerenciamento de webhooks
├── api/
│   ├── bridge-control.js        ← rotas REST /start /stop /status /health
│   ├── bridge-dialog.js         ← rotas REST /dialog
│   ├── bridge-stream.js         ← rotas SSE /stream /stream/critical
│   ├── bridge-tasks.js          ← rotas REST /send /cancel
│   ├── copilot-router.js        ← barrel das rotas copilot
│   ├── http-bridge.js           ← ponto de montagem do router Express
│   ├── sdk-api.js               ← 28 endpoints REST (wrapper legado)
│   └── sdk-router.js            ← router SDK legado
├── bridges/
│   ├── alias-store.js           ← armazenamento de aliases
│   ├── gh-bridge.js             ← bridge GitHub CLI
│   ├── git-bridge.js            ← bridge Git
│   ├── inject-llmb.js           ← script CLI de injeção
│   ├── llm-bridge-client.js     ← ⭐ RE-EXPORT de compatibilidade → channel/client.js
│   ├── mcp-tool-bridge.js       ← bridge para MCP servers
│   └── nerv-bridge.js           ← ⭐ bridge para event bus NERV (22 eventos)
├── channel/
│   ├── audit.js                 ← auditoria da conversa (context window)
│   ├── client.js                ← ⭐ LlmBridgeClient (INTERFACE PARA LLM-A)
│   ├── index.js                 ← barrel + CHANNEL_VERSION
│   └── inject.js                ← helper de injeção de contexto
├── config/
│   ├── index.js                 ← barrel
│   ├── mcp-servers.js           ← configuração MCP servers
│   ├── session-config.js        ← builders de configuração de sessão
│   └── system-prompt.js         ← ⭐ builders do system message
├── conversation-hub/
│   ├── hub.js                   ← ConversationHub (gerenciamento de sessões)
│   ├── index.js                 ← barrel
│   ├── orchestrator.js          ← orquestrador LLM-A (dialog mode coordinator)
│   ├── socket-ns.js             ← namespace Socket.IO para o hub
│   └── store.js                 ← ConversationStore (SQLite persistence)
├── core/
│   ├── constants.js             ← constantes globais do módulo
│   ├── errors.js                ← SessionError e tipos de erro
│   ├── index.js                 ← barrel
│   └── types.js                 ← tipos JSDoc do módulo
├── terminal/
│   ├── commands/                ← comandos do REPL (/alias, /attach, /context, etc.)
│   ├── dialog.js                ← sendTurn, ensureDialogLoop
│   ├── file-context.js          ← readFileContext, embedMultiple
│   ├── http-handlers.js         ← handlers HTTP (handleInject, handleStatus, etc.)
│   ├── index.js                 ← barrel
│   ├── repl.js                  ← REPL interativo
│   ├── server.js                ← servidor HTTP LLM-B (:3009)
│   └── state.js                 ← estado compartilhado do terminal
├── tools/
│   ├── code-tools.js            ← ferramentas de análise de código
│   ├── file-tools.js            ← 11 ferramentas de arquivo + SEC-03/04
│   ├── git-tools.js             ← ferramentas git
│   ├── hook-tools.js            ← ferramentas de hooks
│   ├── hub-tools.js             ← ferramentas do conversation hub
│   ├── index.js                 ← barrel de tools
│   ├── introspection-tools.js   ← introspecção de tools registradas
│   ├── session-tools.js         ← ferramentas de sessão
│   ├── shell-tools.js           ← 3 ferramentas shell com SEC-01 (tokenizer)
│   └── task-tools.js            ← ferramentas de tarefas/fila
└── types/
    ├── index.js                 ← barrel de tipos
    └── structured-message.js   ← ⭐ StructuredMessage schema + builders
```

---

## 10. Troubleshooting

### "Agente não está ativo"
```javascript
// Causa: chat() chamado antes de start()
// Solução:
await alwaysAliveAgent.start();  // sempre aguardar
```

### Sessão expirada / "Session not found"
```javascript
// Causa: sessão antiga não existe mais no SDK
// Comportamento: AlwaysAlive cria nova sessão automaticamente
// Ação: nenhuma — é comportamento normal
```

### Timeout em tarefas longas
```javascript
// Causa: default de 60s insuficiente para auditorias/testes complexos
// Solução:
await bridge.chat(msg, { timeoutMs: 300_000 });  // 5 minutos
```

### LLM-B não responde em JSON (chatStructured)
```javascript
// Causa: LLM-B ignorou instrução de responder em JSON
// `chatStructured` retorna result.structured = null neste caso
// Solução: verificar result.structured !== null antes de usar
if (result.structured) {
    console.log('Tipo:', result.structured.responseType);
} else {
    console.log('Resposta em texto:', result.raw);
}
```

---

_Documento criado por LLM-A (GitHub Copilot) em 2026-03-23 após conversa colaborativa com LLM-B._
