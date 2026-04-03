# Auditoria — `nerv-bridge.js`

**Módulo**: `src/copilot/bridges/nerv-bridge.js` **LOC**: 286 **Data**: 2026-06-10 **Auditor**:
Copilot Full-Audit MF-II

---

## 1. Propósito

Bridge de integração entre o `AlwaysAliveAgent` (EventEmitter singleton) e o barramento NERV. Recebe
NERV por injeção (`mount`), registra listeners em todos os eventos do agent e re-emite cada evento
como envelope NERV estruturado. Totalmente opcional: se NERV não for injetado, é no-op.

---

## 2. Arquitetura

```
mount(nerv)
  ├── _detachListeners() se já montado
  ├── _nerv = nerv
  ├── _attachListeners() → percorre EVENT_MAP (50 eventos)
  │     └── for each: alwaysAliveAgent.on(event, safeEmit)
  └── on('before-stop', _onAgentBeforeStop) se não registrado ainda

_onAgentBeforeStop()
  ├── _detachListeners()
  └── once('ready', () => _attachListeners() + on('before-stop', ...))

unmount()
  ├── _detachListeners()
  ├── off('before-stop', _onAgentBeforeStop)
  ├── _beforeStopRegistered = false
  └── _nerv = null
```

---

## 3. Achados

### FINDING-P4-1 — Race entre `unmount/mount` rápido e `once('ready')` pendente

**Severidade**: P4 — Médio **Localização**: `_onAgentBeforeStop()` linhas ~215-230

**Cenário problemático**:

1. `mount()` — bridge ativo, `_beforeStopRegistered = true`
2. Agent emite `before-stop` → `_detachListeners()`, `once('ready')` registrado
3. `unmount()` → `_beforeStopRegistered = false`, `off('before-stop', ...)`, `_nerv = null`
4. `mount()` → novo `on('before-stop', ...)`, `_attachListeners()` — bridge ativo novamente
5. Agent emite `ready` → o `once('ready')` do passo 2 ainda está pendente!
   - Checks `_nerv !== null` → **true** (montado no passo 4) → `_attachListeners()` novamente
   - Chama `alwaysAliveAgent.on('before-stop', _onAgentBeforeStop)` novamente
   - **Resultado**: dois `before-stop` handlers + listeners duplicados

O guardião `_beforeStopRegistered` previne duplos em `mount()`, mas não cancela `once('ready')`
pendentes registrados por `_onAgentBeforeStop` durante ciclos anteriores.

**Proposta**: rastrear se há um `once('ready')` pendente e cancelá-lo no `unmount`:

```js
let _pendingReadyReattach = false;

// em _onAgentBeforeStop:
_pendingReadyReattach = true;
alwaysAliveAgent.once('ready', _onAgentReady);

// _onAgentReady:
function _onAgentReady() {
  _pendingReadyReattach = false;
  if (_nerv === null) return;
  _attachListeners();
  alwaysAliveAgent.on('before-stop', _onAgentBeforeStop);
}

// em unmount():
if (_pendingReadyReattach) {
  alwaysAliveAgent.off('ready', _onAgentReady);
  _pendingReadyReattach = false;
}
```

---

### FINDING-P5-1 — `EVENT_MAP` registra 50 eventos, muitos nunca emitidos

**Severidade**: P5 — Cosmético **Localização**: `EVENT_MAP` linhas ~39-110

O `EVENT_MAP` inclui eventos adicionados nas fases BK, BJ, CD (`pr.consumed`, `agent.background.*`,
`pending_messages.modified`, etc.) cujos emitters podem não existir ainda no `AlwaysAliveAgent`. Os
listeners são registrados sem custo funcional (apenas acumulam na lista interna do EventEmitter),
mas o `setMaxListeners` padrão (10) poderia gerar warnings se o agente acumular muitos outros
`on()`. Confirmar que `alwaysAliveAgent.setMaxListeners(100)` está configurado.

---

## 4. Pontos positivos

- **BUG-MOD-12**: `_beforeStopRegistered` flag previne duplo `on('before-stop')` em remounts.
- **BUG-HIGH-10**: ciclo `before-stop` → `detach` → `ready` → `reattach` é elegante e cobre o caso
  principal de lifecycle do agente.
- `safeEmit()` wraps `emitEvent()` em `Promise.resolve().catch()` — nunca lança para o caller.
- `copilotNervBridge` como objeto de conveniência — import nomeado único.
- `_resetNervBridgeState()` para isolamento de testes.
- Injeção por parâmetro (`mount(nerv)`) em vez de import direto — testável, sem acoplamento.
- **ARCH-02**: todos os 22+ eventos de `AGENT_EVENTS` mapeados post-fix.

---

## 5. Score

| Dimensão                  | Nota       |
| ------------------------- | ---------- |
| Correção do ciclo de vida | 8/10       |
| Segurança (no-throw)      | 10/10      |
| Design (DI, testability)  | 10/10      |
| **Global**                | **9.0/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._

---

## Status de Correção (2026-04-03)

### [FIXED] B10-03 (P3) — Race listener ready em unmount() correto

nerv-bridge.js: \_pendingReadyHandler (variável de estado) armazena o closure once('ready').
unmount() chama alwaysAliveAgent.off('ready', \_pendingReadyHandler) se o handler ainda está
pendente. \_resetNervBridgeState() também limpa \_pendingReadyHandler para isolamento de testes.
Previne re-attachListeners() em bridge já desmontado quando agente emite 'ready' tardiamente.

**Pontuação atualizada: 9.0/10**
