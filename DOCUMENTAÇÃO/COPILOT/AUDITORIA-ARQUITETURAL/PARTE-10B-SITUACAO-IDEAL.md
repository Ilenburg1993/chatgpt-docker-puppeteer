# PARTE-10B — Situação Ideal: Nova Arquitetura para `src/copilot/agent/`

**Data**: 2026-03-15  
**Contexto**: Proposta de reorganização pós-análise PARTE-10A  
**Política**: Zero-PR/Premium Request como princípio norteador  

---

## 1. Princípios da Reorganização

1. **Subdiretórios por domínio** — agrupar arquivos por subsistema, não por tipo
2. **Eliminar God Object** — `always-alive.js` deve orquestrar, não implementar
3. **Barrel exports estruturados** — `index.js` raiz com sub-barrels por domínio
4. **Tipos centralizados** — eliminar importações circulares de tipos
5. **Mínima ruptura** — manter API pública (`alwaysAliveAgent`, `getAgent`) intacta
6. **Testes existentes intactos** — refatoração interna não deve quebrar testes

---

## 2. Nova Estrutura de Diretórios

```
src/copilot/agent/
├── index.js                    # Barrel raiz — re-exporta sub-barrels
├── types.js                    # Typedefs compartilhados (IAlwaysAliveAgent, AgentStatus, etc.)
├── always-alive.js             # Orquestrador SLIM (~400-500 linhas) — delega para subsistemas
├── entry.js                    # PM2 entry point (renomear? manter por compatibilidade)
├── events.js                   # Constantes de eventos (intacto)
│
├── dialog/                     # Subsistema de Dialog Loop
│   ├── index.js                # Sub-barrel: exports de dialog/
│   ├── loop-manager.js         # DialogLoopManager (core com wirer integrado)
│   ├── turn-executor.js        # Funções de execução de turno  
│   ├── protocol.js             # DialogProtocol (classify, extract, build)
│   └── watchdog.js             # DialogWatchdog (timer de inatividade)
│
├── session/                    # Subsistema de Gestão de Sessão
│   ├── index.js                # Sub-barrel: exports de session/
│   ├── initializer.js          # initOrResumeSession
│   ├── event-wirer.js          # wireSessionEvents (SDK → AGENT Events)
│   ├── keepalive.js            # SessionKeepalive
│   ├── cleanup.js              # cleanupStaleSessions
│   ├── rotation.js             # shouldRotateSession
│   └── snapshot.js             # create/save/load/list/prune Snapshots
│
├── queue/                      # Subsistema de Fila e Execução de Tarefas
│   ├── index.js                # Sub-barrel: exports de queue/
│   ├── message-queue.js        # MessageQueue (FIFO com AbortSignal)
│   └── task-executor.js        # executeTask (send/await/retry)
│
├── resilience/                 # Políticas de resiliência e recuperação
│   ├── index.js                # Sub-barrel
│   ├── reconnect-policy.js     # tryReconnect (exponential backoff)
│   └── state-io.js             # Persistência de estado (read/write/cache/mutex)
│
├── security/                   # Segurança, permissões e auditoria
│   ├── index.js                # Sub-barrel
│   ├── permission-controller.js# PermissionController (approve_all/audit/selective)
│   └── tool-audit-logger.js    # logToolAudit, isHighRiskTool, buildAuditingPermissionHandler
│
├── tools/                      # Bootstrap de ferramentas
│   ├── index.js                # Sub-barrel
│   └── bootstrap.js            # bootstrapTools, configureHookTools, setHub, setSessionRpc, setPermissionAgent
│
└── features/                   # Features opcionais/extensões
    ├── index.js                # Sub-barrel
    ├── webhook-manager.js      # WebhookManager (HTTP notifications)
    ├── handoff-manager.js      # HandoffManager (session transfers)
    └── status-snapshot.js      # buildStatusSnapshot (função pura de view)
```

---

## 3. Transformações Detalhadas

### T1. Slim Down `always-alive.js` (1605 → ~450 linhas)

**O que sai:**
- Lógica de processamento de fila → já está em `task-executor.js` mas "orquestração" interna pode ser simplificada
- Wiring de dialog loop → absorvido pelo `loop-manager.js` (integrar `dialog-loop-wirer.js`)
- Construção de status snapshot → já em `status-snapshot.js`, mas chamada inline pode ser delegada
- Lógica de handoff → delegação pura para `HandoffManager`
- Lógica de webhook → delegação pura para `WebhookManager`

**O que fica:**
- Lifecycle: `start()`, `stop()` 
- Orchestration: delega para subsistemas via interfaces limpas
- Campos privados essenciais: `#client`, `#session`, `#status`, `#model`
- Singleton + factory (`alwaysAliveAgent`, `getAgent()`)
- EventEmitter base

**Técnica**: Extrair blocos de 50-200 linhas de `start()` e `stop()` para métodos de subsistemas. Exemplo:
```js
// ANTES (inline em always-alive.js start())
const toolsArray = bootstrapTools(registry, mcpTools);
// ... 40 linhas de config ...

// DEPOIS
this.#session = await this.#sessionSubsystem.initialize(this.#client, toolsArray);
```

### T2. Eliminar `dialog-loop-wirer.js` (64 linhas → merge)

O `dialog-loop-wirer.js` faz apenas forwarding de 13 eventos. Será absorvido como método `wireEvents(emitFn)` dentro de `loop-manager.js`. Economia: 1 arquivo.

### T3. Consolidar `agent-contract.js` → `types.js`

O `agent-contract.js` tem apenas typedefs. Será renomeado para `types.js` e receberá:
- `IAlwaysAliveAgent` (de agent-contract.js)
- `AgentStatusSnapshot` (de always-alive.js)
- `AgentStatus` (de always-alive.js)
- `PendingQuestion` (de always-alive.js)
- `AgentTask` (de always-alive.js → message-queue.js)

Isso **elimina** as importações circulares de tipos `import('./always-alive.js')` em status-snapshot.js, dialog-loop-manager.js, etc.

### T4. Subdiretórios com Sub-barrels

Cada subdiretório terá um `index.js` com exports nomeados. O barrel raiz `agent/index.js` re-exportará os sub-barrels:

```js
// agent/index.js (novo)
export * from './always-alive.js';
export * from './events.js';
export * from './types.js';
export * from './dialog/index.js';
export * from './session/index.js';
export * from './queue/index.js';
export * from './resilience/index.js';
export * from './security/index.js';
export * from './tools/index.js';
export * from './features/index.js';
```

### T5. Renomear com Prefixos Removidos

Dentro de subdiretórios, remover prefixos redundantes:
- `dialog/dialog-loop-manager.js` → `dialog/loop-manager.js`
- `dialog/dialog-turn-executor.js` → `dialog/turn-executor.js`
- `dialog/dialog-protocol.js` → `dialog/protocol.js`
- `dialog/dialog-watchdog.js` → `dialog/watchdog.js`
- `session/session-initializer.js` → `session/initializer.js`
- `session/session-event-wirer.js` → `session/event-wirer.js`
- `session/session-keepalive.js` → `session/keepalive.js`
- `session/session-cleanup.js` → `session/cleanup.js`
- `session/session-rotation.js` → `session/rotation.js`
- `session/session-snapshot.js` → `session/snapshot.js`

---

## 4. Resultado Final — Métricas Esperadas

| Métrica | Antes | Depois |
|---------|-------|--------|
| Arquivos flat | 26 | 8 (raiz) + 18 (subdiretórios) |
| God Object (linhas) | 1605 | ~450 |
| Imports no orquestrador | 35 | ~15 |
| Subdiretórios | 0 | 7 |
| Barrel structure | 1 flat | 1 raiz + 7 sub-barrels |
| Circular type deps | 4-5 | 0 |
| Arquivos eliminados | — | 2 (dialog-loop-wirer.js, agent-contract.js) |
| Arquivos criados | — | 8 (7 sub-barrels + types.js) |

---

## 5. API Pública Preservada

A refatoração é **100% interna**. A API pública permanece idêntica:

```js
// Estes imports continuam funcionando:
import { alwaysAliveAgent, getAgent } from '../agent/index.js';
import { AlwaysAliveAgent } from '../agent/index.js';
import { DialogLoopManager, wireDialogLoopEvents } from '../agent/index.js'; 
// wireDialogLoopEvents será deprecated mas continuará exportado
import { AGENT_EVENTS } from '../agent/index.js';
// ... todos os exports existentes mantidos
```

---

## 6. Relações com Política Zero-PR

As mudanças arquiteturais **não alteram** o comportamento de consumo de PR. O subsistema `dialog/` continua usando o protocolo ask_user (0 PR). As otimizações F52/F53/F55/F56 permanecem intactas.

A reorganização **facilita** futuras otimizações de PR ao tornar visíveis os caminhos de execução:
- `dialog/loop-manager.js` → gerencia todo o ciclo de 0-PR
- `session/initializer.js` → único ponto de consumo de PR no boot
- `resilience/reconnect-policy.js` → consumo de PR na reconexão
- `queue/task-executor.js` → consumo de PR por tarefa

---

## 7. Decisões Arquiteturais Importantes

### D1. NÃO fragmentar `session-event-wirer.js` (587 linhas)
Apesar de ser grande, é logicamente coeso: mapeia todos os eventos SDK → agente. Fragmentá-lo criaria acoplamento horizontal complexo. Mantê-lo como um único arquivo dentro de `session/` é a abordagem mais limpa.

### D2. NÃO separar `tool-audit-logger.js` em 3 arquivos
As 3 responsabilidades (risk classification, JSONL logging, permission wrapper) são intimamente conectadas. Separar criaria 3 arquivos minúsculos com dependências cruzadas. Manter junto mas dentro de `security/`.

### D3. `state-io.js` vai para `resilience/`, não para `session/`
O state-io persiste estado do agente como um todo (dialog + session + billing), não apenas sessão. Colocá-lo em `resilience/` reflete seu papel transversal.

### D4. `status-snapshot.js` vai para `features/`, não para `session/`
É uma função pura de view/consulta, não de gestão de sessão. Pertence ao grupo de features auxiliares.

### D5. `entry.js` permanece na raiz
É o ponto de entrada PM2 — precisa estar visível e acessível. Não pertence a nenhum subsistema.
