# Auditoria — `index.js`

**Módulo**: `src/copilot/terminal/index.js` **LOC**: 245 **Data**: 2026-06-10 **Auditor**: Copilot
Full-Audit MF-II

---

## 1. Propósito

Orquestrador principal do Terminal Permanente LLM-B. Responsável por:

- Inicializar todas as dependências (hub, permissão, fallback, bridge agents)
- Registrar listeners de eventos do AlwaysAliveAgent
- Iniciar o reflection loop opcional
- Chamar `startRepl` após todos os componentes estarem prontos

---

## 2. Arquitetura de inicialização

```
startTerminalServer()
 ├── loadAliases()
 ├── setHub, configureHookTools, setPermissionAgent, setFallbackAgent, setBridgeAgent
 ├── PinnedFilesLoader (skills + instructions)
 ├── createInjectServer()
 ├── conversationHub.store.init()
 ├── conversationHub.createHubSession() → setHubSessionId
 ├── registerAgentEventListeners()
 ├── startReflectionLoop()
 └── startRepl(injectServer)
```

---

## 3. Achados

### FINDING-P4-1 — `registerAgentEventListeners()` acumula listeners se chamada N vezes **[FIXED]**

**Severidade**: P4 — Médio **→ CORRIGIDO** (2026-06-XX) **Localização**:
`registerAgentEventListeners()` linhas ~38-50

**Fix aplicado**: flag `_agentListenersRegistered` adicionado como variável de módulo. A função
retorna imediatamente se já foi chamada anteriormente (`if (_agentListenersRegistered) return;`).

```js
alwaysAliveAgent.on('dialog.stalled', async () => { ... });
alwaysAliveAgent.on('dialog.reply', (data) => { broadcastSse('reply', data); });
// ...etc
```

Todos os listeners são registrados com `.on()` (não `.once()`). Se `startTerminalServer()` for
chamada múltiplas vezes (erro de programação, hot-reload, teste), os listeners se acumulam — cada
`dialog.reply` seria emitido N vezes para SSE. No EventEmitter do Node.js, isso também triggeraria o
aviso `MaxListenersExceededWarning` após 10 listeners.

**Proposta**: extrair cleanup function ou usar flag `_listenersRegistered`:

```js
let _listenersRegistered = false;
function registerAgentEventListeners() {
    if (_listenersRegistered) return;
    _listenersRegistered = true;
    alwaysAliveAgent.on('dialog.stalled', ...);
    // ...
}
```

---

### FINDING-P4-2 — `dialog.stopped` watchdog ignora `dialogPaused` state **[FIXED]**

**Severidade**: P4 — Médio **→ CORRIGIDO** **Localização**: `registerAgentEventListeners()` handler
de `dialog.stopped`

**Fix aplicado**: verificação de `alwaysAliveAgent.dialogPaused` adicionada antes do restart
automático. Se o loop foi pausado intencionalmente pelo usuário (`/pause` ou `POST /dialog/pause`),
o handler emite `broadcastSse('stopped', { reason, paused: true })` e NÃO reinicia o loop.

```js
// T-15: respeitar pausa intencional do usuário — não reiniciar se dialogPaused
if (alwaysAliveAgent.dialogPaused) {
  println(`\n[dialog] Loop encerrado enquanto pausado pelo usuário — não reiniciando.`);
  broadcastSse('stopped', { reason, paused: true });
  return;
}
```

    setTimeout(() => ensureDialogLoop(), 2_000);

}

```

---

### FINDING-P5-3 — `startReflectionLoop` não armazena referência ao `setInterval` **[FIXED]**

**Severidade**: P5 — Baixo **→ CORRIGIDO**
**Localização**: `startReflectionLoop()`

**Fix aplicado**: `_reflectionTimer` armazenado em variável de módulo (`let _reflectionTimer = null`).
Cancelado no shutdown via `clearInterval(_reflectionTimer)` no handler `_onShutdown`.

---

### FINDING-P5-4 — Sem handler `SIGTERM`/`SIGINT` para shutdown gracioso **[FIXED]**

**Severidade**: P5 — Baixo **→ CORRIGIDO**
**Localização**: `startTerminalServer()` — final da função

**Fix aplicado**: `process.once('SIGTERM', _onShutdown)` e `process.once('SIGINT', _onShutdown)` handlers
registrados. O `_onShutdown` faz cleanup do `_reflectionTimer`.

---

## 4. Pontos positivos

- Dependency injection explícita (setHub, setPermissionAgent, etc.) — testável.
- `PinnedFilesLoader` para skills e instructions — carrega contexto rico no boot.
- `startReflectionLoop` respeita `LLM_B_REFLECTION_INTERVAL_MIN = 0` para bypass.
- Verificação de `queueSize > 0` antes de refletir — não polui a fila se ocupado.
- `session.fatal` → `writeTurn` — persistência de eventos críticos no hub.
- Hub session criada no boot — todos os turns subsequentes têm `hubSessionId` válido.
- Fallback silencioso se `store.init()` falha — o terminal continua sem persistência (graceful).

---

## 5. Score

| Dimensão                     | Nota       |
| ---------------------------- | ---------- |
| Arquitetura de inicialização | 9.0/10     |
| Robustez de events           | 9.0/10     |
| Shutdown gracioso            | 8.0/10     |
| **Global**                   | **8.7/10** |

---

*Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II.*
```
