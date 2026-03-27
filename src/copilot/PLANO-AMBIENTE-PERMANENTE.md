# Plano de Upgrade Massivo — Ambiente Permanente LLM-A ↔ LLM-B ↔ Usuário

**Versão**: 1.0 **Data**: 2026-03-23 **Autor**: LLM-A (GitHub Copilot Claude Sonnet 4.6) — líder
técnico **Consultado**: LLM-B (gpt-4.1 via AlwaysAliveAgent SDK) — perspectiva secundária **Decisão
final**: LLM-A

---

## 1. Visão e Objetivo

### O que existe hoje

| Componente         | Estado atual                               | Limitação                                     |
| ------------------ | ------------------------------------------ | --------------------------------------------- |
| `AlwaysAliveAgent` | Processo PM2 isolado (`copilot-sdk-agent`) | Sem IPC com main server                       |
| `LlmBridgeClient`  | Histórico em `{ history: [] }` na memória  | Perde-se com restart PM2                      |
| `http-bridge.js`   | 10 endpoints REST `/api/copilot/*`         | Sem stream persistente ao usuário             |
| `nerv-bridge.js`   | Emite eventos para NERV bus                | Mas usuário não tem UI conectada a este canal |
| `cli-terminal.js`  | REPL no terminal da sessão LLM-A           | Não acessível via browser/dashboard           |

### O que queremos

Um **ambiente permanente e tri-party** onde:

- **LLM-A** (GitHub Copilot, o orquestrador) pode invocar e receber respostas de LLM-B a qualquer
  momento, mesmo entre sessões
- **LLM-B** (gpt-4.1 via SDK) está sempre disponível como agente subordinado
- **Usuário** pode:
  - Observar todas as trocas LLM-A ↔ LLM-B em tempo real no dashboard
  - Injetar mensagens no diálogo ativo
  - Consultar o histórico completo de todas as conversas

---

## 2. Decisões Arquiteturais (LLM-A)

### 2.1. Integração AlwaysAliveAgent no main-server (não como processo separado)

**Decisão**: `AlwaysAliveAgent` passa a inicializar dentro do **main-server** (processo
`dashboard-web`), não mais como processo PM2 separado.

**Justificativa LLM-A**:

- Elimina IPC entre processos (socket Unix seria complexidade desnecessária)
- `AlwaysAliveAgent` já tem reconnect automático e não bloqueia se o token estiver inválido
- A integração ao NERV (que já existe via `nerv-bridge.js`) fica trivial — mesmo processo
- O dashboard pode escutar eventos do `AlwaysAliveAgent` diretamente sem overhead de serialização
  entre processos
- Já existe precedente: `copilotNervBridge.mount(nerv)` é chamado no `src/server/main.js:733-740`

**Ressalva crítica (LLM-A — não mencionada por LLM-B)**: O boot sequence do main-server **não pode
depender** do AlwaysAliveAgent estar disponível. Portanto o start do agente deve ser:

- **Asíncrono e não-bloqueante** no boot
- Protegido por **circuit breaker** (max 5 tentativas, exponential backoff)
- **Degradação elegante**: servidor funciona normalmente mesmo se `COPILOT_SDK_ENABLED=false` ou
  token inválido

**Novo PM2 process `copilot-sdk-agent`**: manter no `ecosystem.config.cjs` APENAS como **fallback de
recuperação** — pode ser iniciado manualmente se o main-server não tiver SDK habilitado.

### 2.2. Histórico persistente via SQLite

**Decisão**: Nova tabela `conversation_turns` no SQLite existente (caminho: `data/copilot.db`).

**Schema da tabela**:

```sql
CREATE TABLE IF NOT EXISTS conversation_turns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL,            -- Session SDK do AlwaysAliveAgent
  hub_session  TEXT NOT NULL,            -- ID lógico da "conversa LLM-A/LLM-B"
  role         TEXT NOT NULL,            -- 'llm_a' | 'llm_b' | 'user'
  content      TEXT NOT NULL,            -- Mensagem raw ou serializada
  structured   TEXT,                     -- JSON do StructuredMessage (nullable)
  tools_used   TEXT,                     -- JSON array de ferramentas invocadas
  turn_number  INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,         -- Unix timestamp ms
  duration_ms  INTEGER,                  -- Duração do turno (para LLM-B)
  model        TEXT,                     -- 'gpt-4.1' | 'copilot-claude-sonnet-4.6'
  metadata     TEXT                      -- JSON livre para extensão
);

CREATE INDEX IF NOT EXISTS idx_conv_turns_hub ON conversation_turns(hub_session, turn_number);
CREATE INDEX IF NOT EXISTS idx_conv_turns_time ON conversation_turns(created_at);
```

**Justificativa LLM-A**: JSONL seria simples mas torna queries (listar por sessão, paginar, filtrar
por role) ineficientes. SQLite garante atomicidade mesmo com múltiplos writers (WAL mode).

### 2.3. Canal de tempo real via Socket.io namespace `/copilot`

**Decisão**: Criar namespace dedicado `/copilot` no Socket.io existente (instância `socket.js`).

**Justificativa LLM-A**:

- O Socket.io existente já tem autenticação JWT, CORS, e integração com NERV
- Um namespace separado evita poluição de eventos — o dashboard pode escutar `/copilot` sem receber
  eventos de task-queue, kernel, etc.
- Permite broadcast seletivo e controle de salas por `hub_session_id`
- Bidirecional: usuário pode emitir `copilot:user:inject` para injetar mensagens no diálogo ativo

**Nota LLM-A**: LLM-B sugeriu namespace separado por razões corretas, mas não considerou que o
namespace precisa ser registrado na mesma instância de `socket.io` — não é um novo servidor
Socket.io. Isso é importante: usar `io.of('/copilot')` sobre a instância existente de `Server`.

---

## 3. Arquitetura do Upgrade ("Sprint Hub")

### 3.1. Mapa de componentes novos

```
═══════════════════════════════════════════════════════════════════
  PROCESSO: dashboard-web (main-server, porta 3008)
═══════════════════════════════════════════════════════════════════

  [src/copilot/conversation-hub/]          (NOVO)
    ├── store.js           — ConversationStore (SQLite WAL)
    ├── orchestrator.js    — HubOrchestrator (loop LLM-A → LLM-B)
    ├── user-channel.js    — UserChannel (inject/observer via Socket.io)
    ├── socket-ns.js       — Namespace /copilot (Socket.io)
    └── hub.js             — ConversationHub (ponto de entrada, singleton)

  [src/server/api/copilot-hub-router.js]   (NOVO)
    — REST endpoints para hub: GET /api/hub/turns, POST /api/hub/inject, etc.

  [src/server/main.js]                     (MODIFICADO)
    — mount do hub como fase opcional no boot sequence

═══════════════════════════════════════════════════════════════════
  COMPONENTES EXISTENTES (modificados levemente)
═══════════════════════════════════════════════════════════════════

  src/copilot/always-alive.js             — sem mudanças
  src/copilot/llm-bridge-client.js        — adiciona persistência via store
  src/copilot/nerv-bridge.js              — adiciona forwarding para namespace /copilot
  src/server/engine/socket.js             — adiciona criação do namespace /copilot
  ecosystem.config.cjs                    — copilot-sdk-agent marcado como opcional/fallback
```

### 3.2. Fluxo de uma conversa LLM-A → LLM-B com usuário observando

```
LLM-A (GitHub Copilot)
  │
  │ 1. createHubSession(opts) → hub_session_id
  │
  │ 2. hub.sendToLlmB(hub_session_id, message)
  │      └── HubOrchestrator.execute()
  │              ├── ConversationStore.write({ role: 'llm_a', content, ... })
  │              ├── socket.io namespace /copilot: emit('turn:sent', { role:'llm_a', ... })
  │              └── LlmBridgeClient.chatStructured(message)
  │                      └── AlwaysAliveAgent.enqueue(task)
  │                              └── [resposta de LLM-B via streaming]
  │                                      ├── socket.io: emit('turn:delta', { chunk })
  │                                      └── ConversationStore.write({ role: 'llm_b', ... })
  │
  │ 3. hub.getUserMessages(hub_session_id) → mensagens injetadas pelo usuário
  │
  ▼
USUÁRIO (Dashboard browser)
  │
  │ Escuta: socket.io /copilot eventos em tempo real
  │   - 'session:created'    — nova conversa hub iniciada
  │   - 'turn:sent'          — LLM-A enviou mensagem para LLM-B
  │   - 'turn:delta'         — streaming de resposta de LLM-B (chunks)
  │   - 'turn:complete'      — LLM-B terminou resposta
  │   - 'user:injected'      — usuário injetou mensagem no diálogo
  │
  │ Emite:
  │   - 'user:inject'        → UserChannel recebe → fila de injeção para LLM-A ver
```

---

## 4. Especificação dos Módulos Novos

### 4.1. `src/copilot/conversation-hub/store.js` — ConversationStore

```javascript
// Interface pública:
export class ConversationStore {
  constructor(dbPath = 'data/copilot.db')
  async init()                                          // CREATE TABLE IF NOT EXISTS
  async createHubSession(opts)                          // → hub_session_id (UUID)
  async writeTurn(hubSession, { role, content, structured, toolsUsed, durationMs, model })
  async readTurns(hubSession, { limit, offset, after })  // → Turn[]
  async listHubSessions({ limit, offset })              // → HubSession[]
  async injectUserMessage(hubSession, content)          // → turn_id
  async getPendingUserMessages(hubSession)              // → mensagens não lidas por LLM-A
  async markUserMessageRead(turnId)
}
```

**Detalhes de implementação**:

- Usa `node:sqlite` (nativo Node.js 22+) ou `better-sqlite3` (já no projeto?)
- WAL mode (`PRAGMA journal_mode=WAL`) para leituras sem bloqueio durante writes
- Singleton exportado como `conversationStore`

### 4.2. `src/copilot/conversation-hub/orchestrator.js` — HubOrchestrator

```javascript
// Interface pública:
export class HubOrchestrator extends EventEmitter {
  constructor({ store, bridge, socketNs })

  // Iniciar uma sessão de conversa gerenciada
  async createSession(opts = {})                        // → hub_session_id

  // LLM-A envia mensagem para LLM-B via orchestrador
  async sendToLlmB(hubSession, message, structuredOpts) // → StructuredChatResult

  // LLM-A lê mensagens do usuário pendentes
  async pollUserMessages(hubSession)                    // → UserMessage[]

  // Encerrar sessão
  async closeSession(hubSession)

  // Eventos emitidos:
  // 'turn:sent'    — LLM-A enviou mensagem
  // 'turn:delta'   — chunk de resposta de LLM-B
  // 'turn:complete'— LLM-B terminou
  // 'user:injected'— usuário injetou mensagem
}
```

### 4.3. `src/copilot/conversation-hub/socket-ns.js` — Namespace Socket.io

```javascript
// Interface pública:
export function mountCopilotNamespace(io) {
  const ns = io.of('/copilot');
  // Autenticação JWT igual ao namespace principal (reusa lógica de socket.js)
  ns.use(jwtAuthMiddleware);

  ns.on('connection', (socket) => {
    // join room por hub_session para broadcasts seletivos
    socket.on('join:session', ({ hubSession }) => socket.join(hubSession));
    socket.on('user:inject', ({ hubSession, content }) =>
      userChannel.inject(hubSession, content, socket.userId),
    );
  });

  return ns;
}

// Broadcaster — usado pelo Orchestrator
export function broadcastTurn(ns, hubSession, event, payload) {
  ns.to(hubSession).emit(event, payload);
}
```

### 4.4. `src/copilot/conversation-hub/hub.js` — ConversationHub (singleton)

```javascript
// Ponto de entrada central — compõe store + orchestrator + namespace
export class ConversationHub {
  static getInstance()          // singleton
  async init({ io, nerv })      // chama store.init(), mountCopilotNamespace(io), etc.
  get orchestrator()
  get store()
  async stop()
}

export const conversationHub = new ConversationHub();
```

### 4.5. `src/server/api/copilot-hub-router.js` — REST API do hub

```
GET  /api/hub/sessions                  — lista hub_sessions (paginado)
GET  /api/hub/sessions/:id/turns        — conversas de uma sessão (paginado)
POST /api/hub/sessions/:id/inject       — injetar mensagem como usuário
GET  /api/hub/sessions/:id/stream       — SSE stream de uma sessão específica (alternativa ao Socket.io)
POST /api/hub/sessions                  — criar nova sessão (para LLM-A usar via ferramenta)
```

---

## 5. Integração no main-server Boot Sequence

No `src/server/main.js`, após a FASE 9 (Adapter NERV ↔ Socket), adicionar **FASE 10 — Conversation
Hub**:

```javascript
// FASE 10 — Conversation Hub (opcional, não bloqueia boot)
if (process.env.COPILOT_SDK_ENABLED !== 'false') {
  try {
    const { conversationHub } = await import('#copilot/conversation-hub/hub');
    await conversationHub.init({ io: socketHub.getIo(), nerv });
    log('INFO', '[HUB] ConversationHub iniciado — ambiente permanente LLM-A↔LLM-B↔Usuário ativo');
  } catch (_e) {
    log('WARN', `[HUB] Falha ao iniciar ConversationHub: ${_e.message} (degradação elegante)`);
  }
}
```

---

## 6. Ferramentas para LLM-A

Para que LLM-A possa usar o hub nativamente via ferramentas do AlwaysAliveAgent, criar novos tools
em `src/copilot/tools/hub-tools.js`:

```
hub_create_session       — cria nova sessão de conversa gerenciada
hub_send_message         — envia mensagem para LLM-B (StructuredMessage)
hub_poll_user_messages   — verifica mensagens injetadas pelo usuário
hub_read_history         — lê histórico de turns de uma sessão
hub_list_sessions        — lista sessões ativas/recentes
```

Esses tools ficam registrados nos 30 tools do AlwaysAliveAgent, tornando o hub acessível nativamente
durante execuções de LLM-A.

---

## 7. Cronograma de Sprints

### Sprint Hub-1 — ConversationStore (SQLite)

**Escopo**: `store.js` com schema, CRUD, WAL mode, testes unitários **Estimativa de código**: ~200
linhas + ~20 testes **Dependência**: verificar se `better-sqlite3` já está no projeto ou usar
`node:sqlite`

### Sprint Hub-2 — HubOrchestrator + namespace Socket.io

**Escopo**: `orchestrator.js`, `socket-ns.js`, `user-channel.js`, integração no `socket.js`
**Estimativa de código**: ~400 linhas + ~30 testes **Dependência**: Sprint Hub-1 (store)

### Sprint Hub-3 — ConversationHub singleton + boot integration

**Escopo**: `hub.js`, modificação em `src/server/main.js`, REST router **Estimativa de código**:
~250 linhas + ~15 testes **Dependência**: Sprint Hub-2 (orchestrator + namespace)

### Sprint Hub-4 — Hub Tools para LLM-A

**Escopo**: `tools/hub-tools.js`, registro no AlwaysAliveAgent, testes de integração **Estimativa de
código**: ~150 linhas + ~20 testes **Dependência**: Sprint Hub-3 (hub singleton funcionando)

### Sprint Hub-5 — Dashboard UI (se houver frontend)

**Escopo**: componente React/Vue no dashboard para visualização de conversas **Dependência**: Sprint
Hub-2 (namespace Socket.io) **Nota**: Verificar stack do dashboard antes de iniciar

---

## 8. Decisões Técnicas Adicionais (LLM-A)

### 8.1. SQLite: `node:sqlite` nativo vs `better-sqlite3`

- Verificar com `node --version` (24.x): `node:sqlite` está disponível como módulo experimental
  desde Node 22.5.0 e estável em 22+
- Se `better-sqlite3` já estiver no `package.json`, usá-lo (já testado no projeto)
- Se não, usar `node:sqlite` (sem dependência externa)
- **Preferência LLM-A**: `node:sqlite` nativo para manter zero-dependency philosophy

### 8.2. Autenticação no namespace `/copilot`

- Reusar o middleware JWT de `src/server/engine/socket.js`
- Flag `COPILOT_HUB_AUTH_REQUIRED` (default: same as `DASHBOARD_SOCKET_AUTH_REQUIRED`)
- Em ambiente de desenvolvimento local, auth pode ser relaxada

### 8.3. Circuit Breaker para AlwaysAliveAgent no main-server

- Se o token `COPILOT_GITHUB_TOKEN` não estiver definido, o hub simplesmente não inicia
- Máximo 3 tentativas de start na fase de boot, depois marca como "degraded" e continua
- O `GET /api/copilot/health` reflete o estado real (ready/degraded/offline)

### 8.4. Persistência entre sessões PM2

- `hub_session` tem UUID próprio (diferente de `session_id` do SDK)
- Ao reiniciar o main-server, as sessões SQLite persistem
- `AlwaysAliveAgent` cria nova sessão SDK, mas o `hub_session` mantém histórico anterior
- O `hub_session` é o "identificador de contexto" que LLM-A usa para retomar conversas

---

## 9. O que LLM-B Respondeu (registro crítico)

LLM-B foi consultado com 3 perguntas específicas e respondeu em JSON estruturado (protocolo Sprint A
funcionando):

| Pergunta                                   | Resposta LLM-B                  | Avaliação LLM-A                                                                                                       |
| ------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| AlwaysAlive no main-server (a) vs IPC (b)? | Opção (a), elimina complexidade | ✅ **Concordo** — mas LLM-B não mencionou circuit breaker para degradação elegante                                    |
| SQLite vs JSONL para histórico?            | SQLite, queries eficientes      | ✅ **Concordo** — mas LLM-B não pensou em node:sqlite nativo vs better-sqlite3                                        |
| Socket.io namespace dedicado vs SSE?       | Namespace `/copilot` dedicado   | ✅ **Concordo** — mas LLM-B não mencionou que deve ser `io.of('/copilot')` na instância existente, não um novo Server |

**Conclusão**: LLM-B forneceu direções corretas mas superficiais. As decisões de implementação
detalhadas foram todas de LLM-A. Consulta foi útil como soundcheck, não como fonte de arquitetura.

---

## 10. Checklist de Qualidade

- [ ] `npm run test:unit` — mínimo 1442 tests passando (baseline atual)
- [ ] `npm run lint` — 0 erros
- [ ] `npm run typecheck:node` — 0 novos erros críticos
- [ ] Boot sequence do main-server não regride (hub falha graciosamente)
- [ ] `GET /api/copilot/health` retorna status correto do hub
- [ ] Socket.io namespace `/copilot` funciona com autenticação
- [ ] SQLite persiste através de restart PM2
- [ ] Nenhum `puppeteer.launch()` introduzido
- [ ] Todos os módulos novos exportam JSDoc completo (`@param`, `@returns`)

---

## 11. Próximo Passo Imediato

Iniciar **Sprint Hub-1**: criar `src/copilot/conversation-hub/store.js`.

Antes de iniciar:

1. Verificar `package.json` para decidir `node:sqlite` vs `better-sqlite3`
2. Verificar se existe `data/` directory ou similar para o DB path
3. Verificar se há outros módulos SQLite no projeto para seguir o padrão existente

---

_Documento criado por LLM-A. Consulta LLM-B registrada na seção 9. Todas as decisões finais são de
LLM-A._
