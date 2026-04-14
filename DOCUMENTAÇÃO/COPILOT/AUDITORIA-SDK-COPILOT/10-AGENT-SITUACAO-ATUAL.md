# 10 — Agent Module: Análise da Situação Atual

**Data**: 2026-03-21
**Escopo**: `src/copilot/agent/` — análise crítica pós-leitura de 50+ arquivos
**Referência**: [09-AGENT-LOGICA-FLUXO.md](./09-AGENT-LOGICA-FLUXO.md)

---

## 1. Resumo Executivo

O módulo `agent/` passou por uma refatoração significativa (Faixas F35-F69, G1-G2, O3) que extraiu
~32 campos privados para `AgentContext` e decompôs o monolito `always-alive.js` de ~1500L para
~759L por meio de facades, módulos de lifecycle, dialog, messaging, state e infra.

**Nota positiva**: a decomposição funcional já foi feita. Os ~55 arquivos têm responsabilidades
relativamente claras.

**Problemas residuais**: concentração de estado em god object (`AgentContext`), ausência de
interfaces formais, acoplamento via passagem de callbacks ad hoc, e inconsistência em padrões de
error handling entre módulos.

---

## 2. Problemas Arquiteturais

### 2.1 🔴 God Object: AgentContext (254L)

`AgentContext` concentra **todo** o estado do agente — 30+ campos — e é passado por referência a
todos os módulos. Qualquer módulo pode mutar qualquer campo sem restrição.

**Impacto**:
- Impossibilita reasoning sobre invariantes de estado
- Dificulta testes: mocks precisam replicar todo o objeto
- Módulos como `queue-processor.js` acessam `ctx.isReconnecting`, `ctx.status`, `ctx.session`,
  `ctx.messageQueue`, `ctx.sendCount`, `ctx.keepalive` — 6 dependências implícitas

**Evidência**: `AgentContext` tem 0 métodos de leitura encapsulados (exceto `setStatus`) — todo o
resto é acesso direto a campos públicos mutáveis.

### 2.2 🟠 Passagem Ad Hoc de Callbacks

Cada módulo extraído define seu próprio "host interface" como typedef JSDoc em `types.js`:
- `LifecycleHost` — 12 propriedades
- `DialogHost` — 6 propriedades
- `MessagingHost` — 1 propriedade
- `StateHost` — 2 propriedades

Esses contratos **não são enforçados** em runtime — são puro JSDoc. Os módulos fazem cast
`/** @type {unknown} */` quando precisam de propriedades não listadas no typedef, criando
bypasses silenciosos.

**Exemplo** em `loop-manager.js:resume()`:
```js
const hostEmitter = /** @type {import('events').EventEmitter} */ (/** @type {unknown} */ (this.#host));
```

### 2.3 🟠 performBootWiring: God Function (331L)

`performBootWiring()` realiza **12 etapas heterogêneas** em uma função de 331 linhas:
- Wiring de eventos SDK
- Setup de observabilidade
- Setup de lifecycle handlers
- Cleanup de sessões
- Dialog loop recovery
- Timers periódicos
- MCP auto-reconnect
- Keepalive
- Quota monitoring
- Handoff
- Hook-tools relay

**Impacto**: difícil testar individualmente cada etapa; falha em uma etapa não impede as demais
(fire-and-forget), mas debugging é difícil.

### 2.4 🟡 always-alive.js: Fachada + Bridge Monolítico

`always-alive.js` (759L) é 40% fachada de delegação e 60% bridge de eventos (~80 eventos). O
bridge está no top-level do módulo (fora da classe), executado via `try/catch` em tempo de
import. Falha no bridge não impede o agente, mas:

- O bridge usa `await import()` (top-level await) para importar `core/di-container.js` e
  `events/index.js` — duplicando importações que a classe já faz via barrel
- A lista de 80+ eventos hardcoded é frágil: adicionar um novo evento requer mudar 2 lugares
  (events/index.js E always-alive.js)

### 2.5 🟡 Duplicação de Event Constants

Eventos são definidos em `events/index.js` como `AGENT_*` constants E re-referenciados no bridge
de `always-alive.js` como string literals (`'dialog.loop.changed'`, etc.). A correspondência é
manual e propensa a erros.

---

## 3. Problemas de Qualidade de Código

### 3.1 🔴 Type Safety Inconsistente

- **JSDoc casts perigosos**: múltiplos `/** @type {unknown} */` seguidos de cast para tipo
  específico sem validação runtime
- **Interfaces loosely-typed**: vários `Record<string, unknown>` em callbacks de boot-wiring
- **Host interface bypass**: módulos fazem cast duplo (`unknown` → tipo) quando precisam de
  métodos não declarados no host interface

### 3.2 🟠 Error Handling Inconsistente

| Módulo | Padrão de Error Handling |
|--------|--------------------------|
| `lifecycle/agent-lifecycle.js` | `try/catch` com `toError()`, re-throw |
| `session/boot-wiring.js` | `void .catch()` (fire-and-forget) em 4 operações |
| `dialog/loop-manager.js` | `.catch()` com log + deactivate |
| `infra/task-executor.js` | `try/catch/finally` completo com retry |
| `session/initializer.js` | `await` com throw direto |
| `queue-processor.js` | `void executeTask()` — erros resolvidos internamente |

Não há padrão centralizado para erro recuperável vs. fatal.

### 3.3 🟠 Async Fire-and-Forget sem Rastreamento

Múltiplas operações usam `void` prefix para descartar promises:
- `void writeStateAsync(...)` — 15+ ocorrências
- `void cleanupStaleSessions(...)` — boot-wiring
- `void syncSdkHistory(...)` — lifecycle
- `void readStateAsync().then(...)` — boot-wiring dialog recovery

Erros nessas operações são silenciosamente engolidos (apenas log). Não há tracking centralizado
de tasks em background.

### 3.4 🟡 Complexidade do Dialog Loop Resume

O fluxo de resume do dialog loop (`DialogLoopManager.resume()`) tem 3 caminhos:
1. **Estratégia A (sync)**: ask_user já disponível → 0 PR
2. **Estratégia A (async)**: wait for ask_user → 0 PR
3. **Estratégia B**: reboot com novo prompt → 1 PR

Mais o **boot recovery** em `boot-wiring.js` que:
1. `setTimeout(5s)`
2. `writeState({ dialogPaused: true })`
3. `resumeDialogLoop()`
4. Fallback para `startDialogLoop()` se resume falhar

Essa complexidade é justificada pela economia de PR (premium requests), mas a testabilidade é
baixa e o flow é difícil de seguir.

---

## 4. Problemas de Design

### 4.1 🟠 Singleton no Top-Level com Side Effects

```js
export const alwaysAliveAgent = new AlwaysAliveAgent();
```

O singleton é instanciado no momento do import, junto com:
- `new AgentContext()` → instancia `DialogLoopManager`, `MessageQueue`, `WebhookManager`,
  `PermissionController`, `ToolRegistry`, `SessionKeepalive`, `HandoffManager`,
  `SessionMessagesCache`
- `readState()` síncrono dentro do `DialogLoopManager` constructor
- Top-level await bridge com 80+ eventos

**Impacto**: dificulta testes de integração — importar o módulo já cria toda a infraestrutura.

### 4.2 🟡 Falta de Composability

Módulos como `boot-wiring.js` recebem callbacks via um objeto `BootWiringContext` de 18
propriedades. Adicionar uma nova etapa de boot requer modificar esse typedef e todos os call
sites.

### 4.3 🟡 Acoplamento Temporal

O fluxo de boot tem dependências temporais implícitas:
- `performBootWiring()` assume que `initSession()` já concluiu
- `wireSessionEvents()` assume que `session` é válido e won't null durante wiring
- `scheduleDialogBootRecovery()` assume que `getStatus()` retornará não-stopped após 5s

Nenhuma dessas dependências é enforçada programaticamente.

---

## 5. Gaps Funcionais

### 5.1 🟠 Sem Multi-Session

O agente suporta apenas 1 sessão ativa por vez. A rotação de sessão (`rotation.js`) destrói a
anterior antes de criar a nova. Não há pipeline para migrar estado entre sessões.

### 5.2 🟡 Sem Health Check Formal

O estado de saúde é inferido via `getStatusSnapshot()` + heurísticas (starvation alert). Não
existe um endpoint `/health` estruturado com checks formais (SDK connected? session alive?
dialog loop responsive?).

### 5.3 🟡 Sem Backoff Adaptativo no Dialog Watchdog

O watchdog usa thresholds estáticos (default: 15min, analysis: 45min). Não há learning baseado
em histórico de duração de tarefas — o threshold deve ser configurado manualmente.

### 5.4 ⚪ Handoff Incompleto

`HandoffManager` existe mas está atrás de feature flag `fleet` (experimental). Sem
documentação de protocolo nem testes.

---

## 6. Cobertura de Testes

### 6.1 Testes Existentes (via Faixas anteriores)

- **Faixa A**: 11 testes lifecycle fixes
- **Faixa C**: 42 testes SessionConfigBuilder + ClientOptionsBuilder
- **Faixa E**: 52 testes hooks optimization
- **Faixa I**: 35 testes system prompt modular
- **Faixa B**: 24 testes event handlers

### 6.2 Gaps de Testes

| Módulo | Cobertura Estimada | Gap |
|--------|--------------------|-----|
| `always-alive.js` | Parcial | Bridge de eventos sem testes |
| `agent-context.js` | Nenhuma | FSM de status, setStatus |
| `dialog/loop-manager.js` | Parcial | pause/resume/boot recovery |
| `dialog/turn-executor.js` | Parcial | Protocolo READY/REPLY parsing |
| `session/boot-wiring.js` | Nenhuma | 12 etapas sem testes unitários |
| `lifecycle/agent-lifecycle.js` | Parcial | agentStop, agentTryReconnect |
| `lifecycle/entry.js` | Nenhuma | startAgentLoop, IPC |
| `session/initializer.js` | Parcial | Rotação, validação de sessionId |
| `infra/task-executor.js` | Parcial | Retry após reconexão |
| `infra/message-queue.js` | Nenhuma | FIFO, abort, drain |
| `infra/webhook-manager.js` | Nenhuma | Retry, dispatch |
| `infra/permission-controller.js` | Nenhuma | Mode switching |

---

## 7. Pontos Positivos

1. **Decomposição funcional já feita**: os 55 arquivos têm responsabilidades claras
2. **JSDoc robusto**: quase todas as funções públicas documentadas com `@param`, `@returns`,
   `@throws`
3. **FSM validado**: `AgentContext.STATUS_TRANSITIONS` enforce transições (warn only, não blocking)
4. **OTEL integrado**: spans por task, por tool execution, por dialog loop lifecycle
5. **Persistência de estado**: state-io.js com cache sync + write async debounced
6. **Event handlers modulares**: 12 handlers em arquivos separados vs. 1 monolito
7. **Resource Management**: suporte a `Symbol.asyncDispose` / `Symbol.dispose` (TC39 Stage 4)
8. **Backpressure**: TurnQueue com limite de profundidade evita overflow do dialog loop

---

## 8. Dívida Técnica Priorizada

| # | Severidade | Item | Impacto | Estimativa |
|---|------------|------|---------|------------|
| D1 | 🔴 | AgentContext god object | Testabilidade, invariantes | 8h |
| D2 | 🔴 | Ausência de testes: boot-wiring, agent-context, message-queue | Confiabilidade | 12h |
| D3 | 🟠 | Error handling inconsistente | Debugging, reliability | 4h |
| D4 | 🟠 | Async fire-and-forget sem tracking | Erros silenciosos | 3h |
| D5 | 🟠 | Host interface bypasses (JSDoc cast) | Type safety | 4h |
| D6 | 🟠 | performBootWiring god function | Testabilidade | 6h |
| D7 | 🟡 | Bridge de eventos hardcoded em always-alive.js | Manutenibilidade | 4h |
| D8 | 🟡 | Singleton com side effects no import | Testabilidade | 3h |
| D9 | 🟡 | Falta de health check formal | Operabilidade | 3h |
| **Total** | | | | **~47h** |
