# Auditoria — `repl.js`

**Módulo**: `src/copilot/terminal/repl.js` **LOC**: 340 **Data**: 2026-06-10 **Auditor**: Copilot
Full-Audit MF-II

---

## 1. Propósito

Interface REPL readline do Terminal Permanente LLM-B. Processa input do usuário, faz dispatch de
comandos `/xxx` via `CMD_ROUTES`, lida com referências `@caminho` inline, e registra listeners de
eventos do AlwaysAliveAgent para display no terminal.

---

## 2. Arquitetura

```
startRepl(injectServer)
 ├── readline.createInterface(stdin)
 ├── setupAgentListeners(rl)           ← once('stopped') + on('question.pending')
 ├── ensureDialogLoop()
 └── rl.on('line', handler)
      ├── /cmd → dispatchCmd(cmd, arg, ...) → CMD_ROUTES Map
      ├── extractAtReferences(line) → addAttachment()
      └── sendTurn(finalMessage, 'user')
```

`CMD_ROUTES` → `_cmdRouteMap: Map<string, fn>` para dispatch O(1) por nome.

---

## 3. Achados

### FINDING-P4-1 — `_cmdRestart`: race condition com `dialog.ready` após `stopDialogMode()`

**Severidade**: P4 — Médio **Localização**: `_cmdRestart()` linhas ~215-240

```js
async function _cmdRestart() {
    await llmBridgeClient.stopDialogMode();
    if (!alwaysAliveAgent.dialogLoopActive) {
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(...), 30_000);
            alwaysAliveAgent.once('dialog.ready', () => {   // ← registrado APÓS stop
                clearTimeout(timeout); resolve(undefined);
            });
        });
    }
}
```

O fluxo é:

1. `stopDialogMode()` é chamado
2. Internamente, dispara `dialog.stopped` event
3. Handler em `index.js` chama `ensureDialogLoop()` → que pode emitir `dialog.ready` rapidamente
4. `_cmdRestart` só então registra `once('dialog.ready')` — **o evento pode já ter passado**

Se a resposta de restart for rápida (< 100ms), o `once` nunca dispara e após 30s o timeout rejeita
com falso erro de "Timeout aguardando restart".

**Proposta**: registrar o listener ANTES de chamar `stopDialogMode()`:

```js
async function _cmdRestart() {
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout...')), 30_000);
    alwaysAliveAgent.once('dialog.ready', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  await llmBridgeClient.stopDialogMode();
  if (!alwaysAliveAgent.dialogLoopActive) {
    await ready;
  }
}
```

---

### FINDING-P5-2 — `Ctrl+C` não cancela turno em andamento — `sendTurn` bloqueará **[NOTED]**

**Severidade**: P5 — Baixo **→ DOCUMENTADO como upgrade futuro (T-27)**

**Status**: Infraestrutura AbortSignal já existe em `message-queue.js` e `always-alive.js`. A
integração completa (REPL Ctrl+C → AbortController → sendTurn → sendMessage) é candidata a upgrade
P4 futuro. Comentário adicionado no código (repl.js L354) documentando a possibilidade.
**Localização**: `rl.on('SIGINT')` linhas ~330-335

```js
rl.on('SIGINT', () => {
  println('\n[terminal] Ctrl+C... Use /quit para encerrar.');
  rl.prompt();
});
```

Se `sendTurn()` estiver em execução (aguardando `llmBridgeClient.dialogTurn()`), o Ctrl+C não
cancela — apenas exibe a mensagem. O usuário está preso aguardando o timeout (`TURN_TIMEOUT_MS`).
Nenhuma ação de abort é tomada.

---

### FINDING-P5-3 — `CMD_ROUTES` como array antes de `flatMap` para Map — ordem importa

**Severidade**: P5 — Cosmético **Localização**: `_cmdRouteMap` inicialização linhas ~120-140

Se dois comandos na `CMD_ROUTES` tiverem o mesmo nome (colisão acidental), o segundo sobrescreve o
primeiro no `Map`. Não há verificação de duplicatas. Dado que `CMD_ROUTES` é estático, isso é um
risco de manutenção não um bug ativo.

---

## 4. Pontos positivos

- **CMD_ROUTES** com `Map` para dispatch O(1) — escalável.
- **extractAtReferences** inline no `rl.on('line')` — `@path` auto-attach sem comando.
- **Modo headless**: `!process.stdin.isTTY` → `ensureDialogLoop()` sem REPL; design correto.
- **SIGINT graceful**: não derruba dialog loop — apenas impede encerramento acidental.
- **setupAgentListeners** retorna cleanup function — registra e remove listeners corretamente.
- **Filtro de protocolo interno**: `READY:`, `REPLY:`, `STOPPED` filtrados em `onQuestion` — o
  usuário não vê spam do protocolo interno.

---

## 5. Score

| Dimensão                     | Nota       |
| ---------------------------- | ---------- |
| Correção lógica              | 7.5/10     |
| UX e interatividade          | 8.5/10     |
| Estrutura e manutenibilidade | 8/10       |
| **Global**                   | **8.0/10** |

---

## 6. Status de Correção

### [FIXED] FINDING-P4-1 (T-05) — Race condition em `_cmdRestart` com `dialog.ready`

Listener `once('dialog.ready')` agora é registrado **antes** de `stopDialogMode()`. Timeout e
listener são limpos corretamente no branch `dialogLoopActive=true`. O branch `catch` mantém o
fallback `ensureDialogLoop()` para casos de falha.

**Pontuação atualizada: 8.5/10**

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
