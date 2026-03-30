# Auditoria: Mecanismo Zero-PR — Dialog Loop, Retry e Pause/Resume

**Data**: 2026-07-10 (criação) / 2026-07-12 (consolidação profunda)
**Status**: CONSOLIDADO — roadmap final pronto para implementação
**Autor**: GitHub Copilot (LLM-A)
**Contexto**: `@github/copilot-sdk v0.2.0`, `Node.js 24 ESM`
**Commit de referência**: `8f85d2ba` (pré-implementação)

---

## Índice

1. [Fenômeno Observado](#1-fenômeno-observado)
2. [Arquitetura de Billing no SDK](#2-arquitetura-de-billing-no-sdk)
3. [Como o Dialog Loop Atinge Zero-PR](#3-como-o-dialog-loop-atinge-zero-pr)
4. [Análise do Retry sem PR (botão "Tentar novamente")](#4-análise-do-retry-sem-pr)
5. [Análise do Estado Atual do Agente](#5-análise-do-estado-atual-do-agente)
6. [Feature: Comando Pause/Resume sem PR](#6-feature-comando-pauseresume-sem-pr)
7. [Roadmap Completo de Implementação](#7-roadmap-completo-de-implementação)
8. [Status de Implementação](#8-status-de-implementação)

---

## 1. Fenômeno Observado

No VS Code Copilot Chat, quando ocorre um erro (network, rate-limit, timeout, etc.):

- Aparece o botão **"Tentar novamente"** (retry)
- Ao pressionar → mesma mensagem reenviada → **nenhum Premium Request (PR) consumido**
- Isso se repete indefinidamente até a requisição ser bem-sucedida
- **Persiste após reinicialização do PC** — histórico preservado, PR pendente não cobrado

Consequência prática: **uma sessão pode durar dias ou semanas sem consumir PRs adicionais**, desde
que o loop de diálogo seja mantido ativo pela mesma sessão e os restarts sejam via `resumeSession`.

---

## 2. Arquitetura de Billing no SDK

### 2.1 Quando um PR é consumido

O billing ocorre **exclusivamente** quando o evento `assistant.usage` é emitido pelo SDK:

```ts
// session-events.d.ts — ephemeral: true
{
  type: "assistant.usage",
  ephemeral: true,          // NÃO é persistido no log de sessão em disco
  data: {
    model: string,
    inputTokens?: number,
    outputTokens?: number,
    cost?: number,          // multiplicador de billing (0 = grátis, 1 = 1 PR)
    quotaSnapshots?: {
      "premium_interactions": {
        entitlementRequests: number,   // total de PRs do plano
        usedRequests: number,          // PRs consumidos
        remainingPercentage: number,   // 0.0 a 1.0
        resetDate?: string,            // data de reset da quota
        overageAllowedWithExhaustedQuota: boolean,
      }
    },
    copilotUsage?: { tokenDetails: [...] },
    initiator?: string,     // "sub-agent" para turnos não-iniciados pelo usuário
  }
}
```

**Regra fundamental**: se `assistant.usage` não foi emitido, **nenhum PR foi cobrado**.

### 2.2 Quando `assistant.usage` NÃO é emitido

| Cenário                                        | PR cobrado? |
| ---------------------------------------------- | :---------: |
| Erro de rede antes da requisição chegar ao LLM | ❌ Não      |
| HTTP 429 rate-limit no gateway                 | ❌ Não      |
| HTTP 503 serviço indisponível                  | ❌ Não      |
| Timeout do cliente SDK                         | ❌ Não      |
| `ask_user` tool call (resposta ao usuário)     | ❌ Não      |
| Reconexão via `resumeSession()`                | ❌ Não      |
| Criação de sessão `createSession()` sem send   | ❌ Não      |
| LLM processar e retornar resposta completa     | ✅ Sim      |
| LLM processar mas ferramenta falhar depois     | ✅ Sim      |

### 2.3 Estrutura de eventos em um turno normal

```
session.send(message)
  └─► assistant.turn_start     { turnId }            ← PR "em processamento"
        ├─► tool.execution_start  (tool calls)
        ├─► tool.execution_complete
        ├─► assistant.message_delta (streaming)
  └─► assistant.turn_end       { turnId }
  └─► assistant.usage          { cost, quotaSnapshots }   ← PR CONTADO AQUI
  └─► session.idle
```

### 2.4 `createSession` vs `resumeSession`

| Operação                           | Cria novo PR? | Novo sessionId? | Histórico?   |
| ---------------------------------- | :-----------: | :-------------: | :----------: |
| `client.createSession(config)`     | ❌ Não        | ✅ Sim          | ❌ Zerado    |
| `client.resumeSession(id, config)` | ❌ Não        | ❌ Mesmo        | ✅ Preservado |
| `session.send(message)` (sucesso)  | ✅ Sim        | Mesmo           | Preservado   |
| `session.send(message)` (falha)    | ❌ Não        | Mesmo           | Preservado   |

**Conclusão crítica**: Reconectar via `resumeSession` com o mesmo `sessionId` **nunca consome PR**.
O PR só é contado quando o LLM efetivamente processa e retorna `assistant.usage`.

---

## 3. Como o Dialog Loop Atinge Zero-PR

### 3.1 O ciclo fundamental

O dialog loop (`startDialogLoop()` em `always-alive.js`, [linha ~940](../../src/copilot/agent/always-alive.js))
usa a seguinte arquitetura:

```
startDialogLoop(bootPrompt)
  │
  ├─ sendMessage(metaPrompt, { timeoutMs: 24h })  ← 1 PR (único do loop inteiro)
  │     └─► LLM: processa boot, emite assistant.usage  ← PR CONTADO
  │
  └─ task loop (executa em background via Promise sem await):
       ├─ LLM: emite ask_user("READY:")          ← onUserInputRequest disparado
       │         → bootPromise resolve           ← startDialogLoop() retorna
       │
       ├─ sendDialogTurn("Olá")
       │     └─► answerPendingQuestion("Olá")    ← alimenta onUserInputRequest (0 PR)
       │              └─► LLM: emite assistant.message_delta (resposta)
       │              └─► LLM: emite ask_user("REPLY: ...resposta...")  ← REPLY via ask_user
       │                         → event 'dialog.reply' emitido        ← 0 PR
       │
       ├─ sendDialogTurn("próxima mensagem")      ← 0 PR (reutiliza ask_user chain)
       │
       ... N turnos, tudo custando 0 PR adicional ...
```

**Chave arquitetural**: `ask_user` é uma **ferramenta local** processada pelo cliente SDK — não é
uma chamada LLM nova. Cada resposta via `answerPendingQuestion()` alimenta o `onUserInputRequest`
callback diretamente, sem novo `session.send()`. Portanto, **todos os turnos do dialog loop após
o boot custam 0 PR**.

### 3.2 Por que um único sendMessage() pode durar dias

`sendMessage(metaPrompt, { timeoutMs: 24 * 60 * 60 * 1000 })` — timeout de 24h intencionalmente.

A sessão SDK mantém o contexto do agentic turn ativo enquanto o modelo está em estado
`ask_user` (aguardando input). A cadeia de tool calls é uma única agentic turn que nunca termina
até o modelo chamar `STOP_DIALOG` ou o agente fechar a sessão.

**Status da sessão durante dialog loop**:
- `session.idle` **nunca dispara** enquanto o modelo está aguardando `ask_user`
- O agente fica em status `waiting_for_input` indefinidamente
- Isso é exatamente o comportamento desejado: 1 PR → conversa infinita

### 3.3 O que acontece quando o agente reinicia

**Cenário atual (com `resumeOrCreate`):**

```
PC reinicia
 └─► entry.js: startWithRetry()
      └─► alwaysAliveAgent.start()
           └─► #initSession(client)
                └─► initOrResumeSession() → session-manager.js
                     └─► resumeOrCreate(client, state?.sessionId)
                          ├─ Se sessionId existe → resumeSession() → 0 PR ✅
                          └─ Se falhar → createSession() → 0 PR (mas perde contexto)
```

Após o `start()`, o `entry.js` **não** chama `startDialogLoop()` automaticamente.
Quem faz isso é `terminal/dialog.js` via `ensureDialogLoop()`.

```
terminal/dialog.js: ensureDialogLoop()
 └─► _tryStartDialogLoop()
      └─► llmBridgeClient.startDialogMode(BOOT_PROMPT)
           └─► alwaysAliveAgent.startDialogLoop(bootPrompt)
                └─► sendMessage(metaPrompt, { timeoutMs: 24h })  ← 1 PR novo aqui!
```

⚠️ **gap identificado**: mesmo com `resumeSession()` bem-sucedido (0 PR), o `startDialogLoop()`
subsequente **sempre envia o boot message** — consumindo 1 PR a cada reinicialização completa.

### 3.4 Solução: modo "resume silencioso" do dialog loop

Para que um reinício após PC restart **não consuma nenhum PR adicional**, precisamos:

1. **Detectar** que a sessão foi retomada (não criada)
2. **Verificar** se o dialog loop estava ativo antes do crash (`dialogLoopActive: true` em disco)
3. **Se ambos**: pular o `sendMessage(bootPrompt)` e apenas aguardar o modelo retornar ao estado
   `ask_user` (o contexto SDK preserva onde o modelo parou)
4. **Caso contrário**: boot normal com 1 PR

Esta é a base da feature **Pause/Resume** descrita na Seção 6.

---

## 4. Análise do Retry sem PR

### 4.1 Como o "Tentar novamente" do VS Code funciona

```
1. Usuário envia mensagem → session.send()          [PR NÃO contado ainda]
2. Erro: ECONNRESET / 429 / timeout                 [assistant.usage NÃO emitido]
3. VS Code exibe "Tentar novamente"
4. Usuário clica → MESMO sessionId → session.send() [contexto preservado]
5. LLM processa com sucesso                         [assistant.usage emitido agora]
                                                    [1 PR contado no total]
```

**Por que funciona**: o `sessionId` é preservado entre o erro e o retry, e `assistant.usage` só
é emitido uma vez (quando o LLM efetivamente processa).

### 4.2 O hook `onErrorOccurred` — retry automático

O SDK expõe esse hook para controlar retry programaticamente:

```ts
// @github/copilot-sdk (tipos inferidos de session-events.d.ts + SDK docs)
interface ErrorOccurredHookInput {
  error: string;                                              // mensagem de erro
  errorContext: "model_call" | "tool_execution" | "system" | "user_input";
  recoverable: boolean;                                       // SDK detectou como recuperável
}

interface ErrorOccurredHookOutput {
  suppressOutput?: boolean;         // esconde msg de erro do usuário
  errorHandling?: "retry" | "skip" | "abort";
  retryCount?: number;              // máx tentativas (default: 1)
  userNotification?: string;        // mensagem de status customizada (opcional)
}
```

Quando `errorHandling: "retry"` é retornado:
- O SDK reenvia internamente **sem nova chamada ao LLM** se o erro foi antes do processamento
- Sem nova chamada `session.send()` visível externamente
- `retryCount` controla máximo de tentativas automáticas

### 4.3 Erros recuperáveis vs não-recuperáveis

| `errorContext`     | `recoverable` | Estratégia ideal            |
| ------------------ | :-----------: | --------------------------- |
| `model_call`       | `true`        | `retry` (até 3x)            |
| `model_call`       | `false`       | `abort` (falha permanente)  |
| `tool_execution`   | `true`        | `skip` (pular tool)         |
| `tool_execution`   | `false`       | `abort`                     |
| `system`           | `true`        | `retry` (1x)                |
| `system`           | `false`       | `abort`                     |
| `user_input`       | qualquer      | `skip` (input inválido)     |

### 4.4 O SDK `disableResume` para reconexão silenciosa

`ResumeSessionConfig` expõe:
```ts
disableResume?: boolean;  // When true, skips emitting the session.resume event
```

Útil para reconexões onde não queremos disparar handlers de `session.resume` (ex: evitar que
o modelo envie mensagem de boas-vindas a cada PM2 restart).

---

## 5. Análise do Estado Atual do Agente

### 5.1 Diagrama de componentes

```
src/copilot/
├── agent/
│   ├── always-alive.js      (1702 linhas) — núcleo do agente
│   ├── session-manager.js   (399 linhas)  — persistência de estado
│   ├── entry.js             (124 linhas)  — entry point PM2
│   ├── dialog-protocol.js   — protocolo READY/REPLY/STOPPED
│   └── dialog-watchdog.js   — watchdog de inatividade
├── lib/
│   └── session.js           (271 linhas) — wrappers SDK createSession/resumeSession
└── terminal/
    ├── dialog.js            (575 linhas) — ensureDialogLoop, sendTurn, SSE
    └── index.js             (236 linhas) — orquestração do terminal LLM-B
```

### 5.2 Estado persistido (`AliveAgentState` em `session-manager.js`)

```ts
// Estado ATUAL (pré-implementação das melhorias)
interface AliveAgentState {
  sessionId: string;              // ID da sessão ativa
  startedAt: number;              // timestamp de criação da sessão
  resumedAt: number;              // timestamp da última retomada
  resumeCount: number;            // total de retomadas
  sendCount: number;              // total de mensagens enviadas
  pendingQuestion: string | null; // pergunta pendente do modelo
  dialogLoopActive?: boolean;     // MR-08: se loop estava ativo
}
```

**Gap**: sem `pendingTurnMessage`, sem `pausedAt`, sem `pendingTurnConsumedPR`.

### 5.3 Fluxo atual de `session.js` (`buildSessionConfig`)

```js
// ATUAL: hooks externos são passados, mas onErrorOccurred não é configurado por padrão
function buildSessionConfig(opts, mode) {
    const cfg = {};
    // ...
    if (opts.hooks !== undefined) cfg.hooks = opts.hooks;  // hooks externos apenas
    // ...
}
```

**Gap**: `onErrorOccurred` nunca é aplicado automaticamente.

### 5.4 Gaps de implementação

| ID         | Descrição                                                              | Impacto PR   |
| ---------- | ---------------------------------------------------------------------- | :----------: |
| GAP-PR-01  | `onErrorOccurred` não configurado → sem retry automático no SDK        | Alto         |
| GAP-PR-02  | `startDialogLoop()` após `resumeSession` envia boot → 1 PR a cada boot | Alto         |
| GAP-PR-03  | Sem feature de pause explícito → restart = novo loop = 1 PR           | Alto         |
| GAP-PR-04  | `assistant.usage` não monitorado → sem visibilidade de billing         | Médio        |
| GAP-PR-05  | Sem `pendingTurnMessage` persistido → turno perdido após crash          | Médio        |
| GAP-PR-06  | `disableResume` não exposto → `session.resume` event desnecessário     | Baixo        |
| GAP-PR-07  | Sem endpoint `/quota` para monitoramento externo de PRs                | Baixo        |
| GAP-PR-08  | Sem fallback de modelo em rate-limit → downtime até modelo disponível  | Baixo        |

---

## 6. Feature: Comando Pause/Resume sem PR

### 6.1 Requisito do usuário

> "Quero que inclua um comando para o usuário (ou LLM) usar pause, de modo que possa dar pause,
> reiniciar o PC, e retomar, sem utilizar nenhum PR."

**Objetivo**: `pause` → desligar PC → ligar PC → `resume` → continuar exatamente de onde parou.
**Custo de PR**: 0 (zero) — mesmo `sessionId`, sem novo `sendMessage(bootPrompt)`.

### 6.2 Princípio de funcionamento

```
FLUXO PAUSE:
  Usuário digita /pause (no terminal LLM-B ou via API)
    └─► alwaysAliveAgent.pauseDialogLoop()
         ├─ writeStateAsync({ pausedAt: Date.now(), pausedSessionId: sessionId, dialogPaused: true })
         ├─ NÃO chama stopDialogLoop() — o modelo fica aguardando em ask_user
         ├─ NÃO desconecta a sessão do CLI — mantém conexão viva
         └─ alwaysAliveAgent emite 'dialog.paused'

FLUXO PC RESTART (após pause):
  PM2 reinicia o processo
    └─► entry.js: startWithRetry()
         └─► alwaysAliveAgent.start()
              └─► initOrResumeSession()
                   └─► resumeOrCreate(client, pausedSessionId)
                        └─► resumeSession() → 0 PR ✅
                   └─► readState() → detecta dialogPaused: true
                   └─► emite 'ready' com { isResumed: true, wasPaused: true }

FLUXO RESUME (no terminal ou automático):
  Usuário digita /resume (ou ensureDialogLoop() detecta dialogPaused:true)
    └─► alwaysAliveAgent.resumeDialogLoop()
         ├─ Verifica: isResumed && dialogPaused
         ├─ NÃO chama sendMessage(bootPrompt)  ← 0 PR
         ├─ Em vez disso: aguarda o modelo retornar a ask_user (o contexto SDK está preservado)
         │    OU envia mensagem de retomada leve: "Retomando sessão pausa. Continue."
         │    (esta mensagem mínima pode custar 1 PR — ver seção 6.3)
         ├─ writeStateAsync({ dialogPaused: false, pausedAt: null })
         └─ emite 'dialog.resumed'
```

### 6.3 Estratégias de zero-cost resume

**Estratégia A — Resume sem envio (ideal, 0 PR):**
- Após resumeSession, o SDK restaura o contexto local
- O modelo estava em estado `ask_user` suspenso — ao reconectar, o SDK pode retomar esse estado
- Precisamos testar se `ask_user` pendente sobrevive à reconexão de sessão
- Se sobreviver: `resumeDialogLoop()` apenas aguarda `question.pending` sem enviar nada → **0 PR**

**Estratégia B — Resume com ping mínimo (possível 1 PR):**
- Envia mensagem de retomada curta ao modelo para re-acionar o loop
- O modelo responde com `ask_user("READY:")` → loop restaurado
- Custo: 1 PR (unavoidável se o estado ask_user não sobreviveu à reconexão)

**Estratégia C — Hybrid:**
- Após reconnect, aguardar N segundos por `question.pending`
- Se chegar → 0 PR (estado preservado)
- Se não chegar → enviar ping mínimo → 1 PR (fallback)

**Recomendação**: Implementar Estratégia C (hybrid) com timeout de 5s.

### 6.4 Novos campos em `AliveAgentState`

```ts
// APÓS implementação
interface AliveAgentState {
  // ...campos existentes...
  dialogPaused?: boolean;     // true se comando pause foi emitido
  pausedAt?: number;          // timestamp do pause
  pausedSessionId?: string;   // sessionId preservado no pause (pode diferir de sessionId)
  pendingTurnMessage?: string;     // última mensagem enviada ao LLM sem resposta
  pendingTurnTs?: number;          // timestamp do envio pendente
  pendingTurnConsumedPR?: boolean; // se assistant.usage já foi emitido para este turno
}
```

### 6.5 Novos métodos em `AlwaysAliveAgent`

```js
/**
 * Pausa o dialog loop sem desconectar a sessão.
 * Serializa o estado para que um restart posterior possa retomar sem novo PR.
 *
 * @returns {Promise<void>}
 */
async pauseDialogLoop() { ... }

/**
 * Retoma o dialog loop após um pause.
 * Se a sessão ainda tem ask_user pendente (0 PR), só espera.
 * Caso contrário, reenvia ping mínimo (1 PR).
 *
 * @returns {Promise<void>}
 */
async resumeDialogLoop() { ... }

/**
 * Retorna true se o dialog loop está em estado pausado.
 *
 * @returns {boolean}
 */
get dialogPaused() { ... }
```

### 6.6 Novos endpoints HTTP

```
POST /terminal/pause
  Body: {}
  Response: { ok: true, pausedAt: <timestamp>, sessionId: <string> }

POST /terminal/resume
  Body: {}
  Response: { ok: true, resumedAt: <timestamp>, prConsumed: boolean }

GET /terminal/pause-status
  Response: { paused: boolean, pausedAt: number|null, sessionId: string|null }
```

### 6.7 Comandos no REPL terminal

```
/pause    → pausa o loop, mantém sessão, persiste estado
/resume   → retoma o loop (sem PR se possible, 1 PR se necessário)
```

### 6.8 Integração com `ensureDialogLoop()`

Em `terminal/dialog.js`, modificar `_tryStartDialogLoop()`:

```js
// Se dialogPaused=true, chamar resumeDialogLoop() em vez de startDialogMode()
const state = alwaysAliveAgent.getStatusSnapshot();
// ou: readState()
if (state.dialogPaused && state.isResumed) {
    await alwaysAliveAgent.resumeDialogLoop();
} else {
    await llmBridgeClient.startDialogMode(BOOT_PROMPT ?? undefined, { onReady: ... });
}
```

---

## 7. Roadmap Completo de Implementação

### 7.1 Tabela de itens

| ID           | Prioridade | Descrição                                          | Arquivos                                     | Esforço   |
| ------------ | ---------- | -------------------------------------------------- | -------------------------------------------- | --------- |
| RF-PR-01     | 🔴 Alta     | `onErrorOccurred` hook com retry automático        | `lib/session.js`                             | Pequeno   |
| RF-PR-06     | 🔴 Alta     | `disableResume: true` em reconexão silenciosa      | `lib/session.js`                             | Trivial   |
| NEW-PAUSE-01 | 🔴 Alta     | Estado `dialogPaused/pausedAt` no `session-manager` | `session-manager.js`                         | Pequeno   |
| NEW-PAUSE-02 | 🔴 Alta     | `pauseDialogLoop()` em `AlwaysAliveAgent`          | `always-alive.js`                            | Médio     |
| NEW-PAUSE-03 | 🔴 Alta     | `resumeDialogLoop()` em `AlwaysAliveAgent`         | `always-alive.js`                            | Médio     |
| NEW-PAUSE-04 | 🔴 Alta     | Detecção de `dialogPaused` no boot em `entry.js`   | `entry.js` + `terminal/dialog.js`            | Pequeno   |
| NEW-PAUSE-05 | 🔴 Alta     | Endpoints HTTP `/terminal/pause` e `/resume`       | `terminal/server.js` ou `routes/`            | Médio     |
| NEW-PAUSE-06 | 🟡 Média    | Comandos `/pause` e `/resume` no REPL              | `terminal/repl.js`                           | Pequeno   |
| RF-PR-03     | 🟡 Média    | Monitorar `assistant.usage` → billing real-time    | `always-alive.js`                            | Pequeno   |
| RF-PR-02     | 🟡 Média    | Persistir `pendingTurnMessage` + `consumedPR`      | `session-manager.js` + `always-alive.js`     | Médio     |
| RF-PR-04     | 🟡 Média    | Endpoint `GET /quota` com dados de PRs restantes   | `routes/` (novo)                             | Pequeno   |
| RF-PR-05     | 🟢 Baixa    | Fallback automático de modelo em rate-limit 429    | `always-alive.js` + `entry.js`               | Médio     |

### 7.2 Ordem de implementação recomendada

**Fase A — Zero-PR hardening (sessão e erros):**
1. `RF-PR-06`: `disableResume: true` em `lib/session.js` — trivial, remove side-effects
2. `RF-PR-01`: `onErrorOccurred` hook em `buildSessionConfig` — retry automático no SDK

**Fase B — Pause/Resume feature:**
3. `NEW-PAUSE-01`: novos campos em `AliveAgentState`
4. `NEW-PAUSE-02` + `NEW-PAUSE-03`: métodos `pauseDialogLoop()` e `resumeDialogLoop()`
5. `NEW-PAUSE-04`: detecção no boot + integração com `ensureDialogLoop()`
6. `NEW-PAUSE-05`: endpoints HTTP
7. `NEW-PAUSE-06`: comandos REPL

**Fase C — Observabilidade e resiliência:**
8. `RF-PR-03`: monitorar `assistant.usage`
9. `RF-PR-02`: persistir `pendingTurnMessage`
10. `RF-PR-04`: endpoint `/quota`
11. `RF-PR-05`: fallback de modelo

### 7.3 Detalhes de implementação por item

#### RF-PR-01 — `onErrorOccurred` hook

**Arquivo**: `src/copilot/lib/session.js`, função `buildSessionConfig()`

```js
// Antes de retornar cfg, adicionar:
const userHooks = opts.hooks ?? {};
cfg.hooks = {
    ...userHooks,
    onErrorOccurred: (/** @type {any} */ input) => {
        const { error, errorContext, recoverable } = input;
        if (recoverable && errorContext === 'model_call') {
            log('WARN', `[lib/session] onErrorOccurred recuperável (${error}) — retry automático`);
            return { errorHandling: 'retry', retryCount: 3 };
        }
        if (errorContext === 'tool_execution' && recoverable) {
            return { errorHandling: 'skip' };
        }
        log('WARN', `[lib/session] onErrorOccurred não-recuperável (${errorContext}): ${error}`);
        return { errorHandling: 'abort' };
    },
    // Preservar onErrorOccurred externo se fornecido
    ...(userHooks.onErrorOccurred ? { onErrorOccurred: userHooks.onErrorOccurred } : {}),
};
```

#### RF-PR-06 — `disableResume` em `resumeSession`

**Arquivo**: `src/copilot/lib/session.js`

Adicionar campo em `SessionResumeOptions`:
```js
/** @property {boolean} [disableResume] - Se true, não emite session.resume (reconexão silenciosa) */
```

Em `buildSessionConfig()` para modo 'resume':
```js
if (mode === 'resume') {
    const ro = /** @type {SessionResumeOptions} */ (opts);
    if (ro.disableResume !== undefined) cfg.disableResume = ro.disableResume;
}
```

Em `resumeOrCreate()` e `#tryReconnect()` em `always-alive.js`, usar `disableResume: true` para
reconexões internas automáticas (watchdog restart, reconexão após erro).

#### NEW-PAUSE-01 — Estado pausado em `session-manager.js`

```js
/**
 * @typedef {Object} AliveAgentState
 * ...campos existentes...
 * @property {boolean} [dialogPaused] - true se pause explícito foi emitido
 * @property {number} [pausedAt] - timestamp do pause
 * @property {string} [pendingTurnMessage] - última mensagem sem resposta confirmada
 * @property {number} [pendingTurnTs] - timestamp do turno pendente
 * @property {boolean} [pendingTurnConsumedPR] - se assistant.usage já foi emitido
 */
```

#### NEW-PAUSE-02 — `pauseDialogLoop()` em `always-alive.js`

```js
/**
 * Pausa o dialog loop: serializa estado para restart sem novo PR.
 * O modelo permanece em estado 'ask_user' enquanto a sessão estiver ativa no servidor CLI.
 *
 * @returns {Promise<void>}
 */
async pauseDialogLoop() {
    if (!this.#dialogLoopActive) return;
    const sid = this.sessionId;
    await writeStateAsync({
        dialogPaused: true,
        pausedAt: Date.now(),
    });
    log('INFO', `[AlwaysAlive] Dialog loop pausado. SessionId: ${sid}`);
    this.emit('dialog.paused', { sessionId: sid, pausedAt: Date.now() });
}
```

#### NEW-PAUSE-03 — `resumeDialogLoop()` em `always-alive.js`

```js
/**
 * Retoma dialog loop após pause.
 * Estratégia híbrida: aguarda ask_user por 5s (0 PR); fallback: ping mínimo (1 PR).
 *
 * @returns {Promise<void>}
 */
async resumeDialogLoop() {
    const state = readState();
    if (!state?.dialogPaused) return;

    await writeStateAsync({ dialogPaused: false, pausedAt: null });

    // Estratégia A: aguardar question.pending (0 PR — modelo ainda está em ask_user)
    const resumed = await Promise.race([
        new Promise((r) => this.once('question.pending', () => r(true))),
        new Promise((r) => setTimeout(() => r(false), 5_000)),
    ]);

    if (resumed) {
        log('INFO', '[AlwaysAlive] Dialog loop retomado sem custo (ask_user preservado).');
        this.emit('dialog.resumed', { prConsumed: false });
        return;
    }

    // Estratégia B: ping para reanimar o loop (1 PR)
    log('INFO', '[AlwaysAlive] ask_user não preservado após reconnect — reenviando ping de retomada (1 PR).');
    this.#dialogLoopActive = true;
    const resumePrompt = DialogProtocol.buildBootPrompt({ resumeMode: true });
    this.sendMessage(resumePrompt, { timeoutMs: 24 * 60 * 60 * 1000 }).catch((/** @type {any} */ e) => {
        log('WARN', `[AlwaysAlive] resumeDialogLoop ping falhou: ${e.message}`);
    });
    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Resume timeout')), 30_000);
        this.once('dialog.ready', () => { clearTimeout(t); resolve(undefined); });
    });
    this.emit('dialog.resumed', { prConsumed: true });
}
```

#### RF-PR-03 — Monitorar `assistant.usage`

Em `always-alive.js`, no bloco de `#sessionEventUnsubscribers.push()`:

```js
// RF-PR-03: billing real-time
this.#sessionEventUnsubscribers.push(
    session.on((/** @type {any} */ evt) => {
        if (evt?.type === 'assistant.usage' || evt?.kind === 'assistant.usage') {
            const data = evt?.data ?? {};
            const { model, cost, quotaSnapshots } = data;
            log('INFO', `[AlwaysAlive] PR consumido: model=${model}, cost=${cost ?? '?'}`);
            this.emit('pr.consumed', { model, cost, quotaSnapshots, ts: Date.now() });
            writeStateAsync({ pendingTurnConsumedPR: true }).catch(() => {});
        }
    }),
);
```

#### RF-PR-04 — Endpoint `GET /quota`

Novo arquivo ou rota em `src/copilot/server/routes/`:

```js
// GET /quota
router.get('/quota', async (req, res) => {
    try {
        const client = alwaysAliveAgent._client; // expor via getter protegido
        const quota = await client.rpc.account.getQuota();
        const state = readState();
        res.json({
            quota: quota?.quotaSnapshots ?? {},
            pendingTurn: {
                active: !!(state?.pendingTurnMessage),
                consumedPR: state?.pendingTurnConsumedPR ?? false,
                message: state?.pendingTurnMessage ?? null,
                ts: state?.pendingTurnTs ?? null,
            },
        });
    } catch (e) {
        res.status(503).json({ error: e.message });
    }
});
```

---

## 8. Status de Implementação

| ID           | Status          | Commit |
| ------------ | --------------- | ------ |
| RF-PR-01     | ⏳ Pendente      | —      |
| RF-PR-02     | ⏳ Pendente      | —      |
| RF-PR-03     | ⏳ Pendente      | —      |
| RF-PR-04     | ⏳ Pendente      | —      |
| RF-PR-05     | ⏳ Pendente      | —      |
| RF-PR-06     | ⏳ Pendente      | —      |
| NEW-PAUSE-01 | ⏳ Pendente      | —      |
| NEW-PAUSE-02 | ⏳ Pendente      | —      |
| NEW-PAUSE-03 | ⏳ Pendente      | —      |
| NEW-PAUSE-04 | ⏳ Pendente      | —      |
| NEW-PAUSE-05 | ⏳ Pendente      | —      |
| NEW-PAUSE-06 | ⏳ Pendente      | —      |

---

*Documento gerado por GitHub Copilot (LLM-A) em 2026-07-12.*
*Contexto: análise profunda de `always-alive.js` (1702l), `session.js` (271l), `session-manager.js` (399l), `entry.js` (124l), `terminal/dialog.js` (575l), `terminal/index.js` (236l), tipos SDK `session-events.d.ts`.*
