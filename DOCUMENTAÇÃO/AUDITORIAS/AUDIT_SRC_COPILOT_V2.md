# AUDIT_SRC_COPILOT_V2 — Auditoria Profunda de `src/copilot`

**Data**: 2026-03-27 **Commit base**: `bcb76c8c` (HEAD) **Metodologia**: Grep-first varredura +
leitura profunda por arquivo **Scope**: todo o diretório `src/copilot/` (~25 arquivos, >7000 LOC)
**Baseline de qualidade**: 1537/1537 testes passando

---

## Sumário Executivo

| Severidade           | Quantidade |
| -------------------- | ---------- |
| **CRÍTICO**          | 0          |
| **ALTO**             | 1          |
| **MÉDIO**            | 2          |
| **BAIXO**            | 3          |
| **INFO / Melhorias** | 6          |
| **Total**            | 12         |

---

## Bugs Confirmados

### NEW-01 — `sendDialogTurn` outer path: listener orphan (ALTO)

**Arquivo**: `src/copilot/agent/always-alive.js` — linhas ~857–866

**Descrição**: No caminho onde `this.#pendingQuestion === true`, a função `sendDialogTurn` registra
dois listeners independentes:

```js
this.once('dialog.reply', (evt) => {
    clearTimeout(timeoutHandle);
    resolve(evt.reply);          // ← NÃO remove dialog.stopped
});
this.once('dialog.stopped', () => {
    clearTimeout(timeoutHandle);
    reject(...);                  // ← NÃO remove dialog.reply
});
```

Se `dialog.stopped` disparar primeiro, o listener `dialog.reply` fica ativo indefinidamente como
orphan no EventEmitter. Se depois vier um `dialog.reply` de turno posterior, uma Promise já
rejeitada receberá `resolve()` — causando log de UnhandledRejection silencioso ou consumindo o
evento de resposta do próximo turno.

**Contraste**: o caminho `onPending` (inner) JÁ tem cross-cleanup correto: `onReply` faz
`this.off('dialog.stopped', onStop)` e `onStop` faz `this.off('dialog.reply', onReply)`.

**Proposta de correção**:

```js
// Caminho outer — adicionar cross-cleanup:
const onReplyOuter = (/** @type {{ reply: string }} */ evt) => {
  clearTimeout(timeoutHandle);
  this.off('dialog.stopped', onStopOuter); // ← adicionar
  resolve(evt.reply);
};
const onStopOuter = () => {
  clearTimeout(timeoutHandle);
  this.off('dialog.reply', onReplyOuter); // ← adicionar
  reject(new SessionError('[AlwaysAlive] Diálogo encerrado pelo modelo.', 'DIALOG_ENDED'));
};
this.once('dialog.reply', onReplyOuter);
this.once('dialog.stopped', onStopOuter);
```

---

### NEW-02 — `getClient` waiter não propaga falha de inicialização (MÉDIO)

**Arquivo**: `src/copilot/lib/client.js` — linhas ~116–128

**Descrição**: Quando `client.start()` falha com exceção, o `finally` faz `_starting = false`,
`_client` permanece `null`. Chamadores que estavam no poll `if (_starting)` resolvem o `setInterval`
e caem no `if (_client) return _client;` — mas `_client` é `null`. O fluxo cai no próximo
`_starting = true` tentando recriar o cliente, potencialmente em loop silencioso. Não há propagação
do erro original para os waiters.

**Código problemático**:

```js
if (_starting) {
  await new Promise((resolve) => {
    const interval = setInterval(() => {
      if (!_starting) {
        clearInterval(interval);
        resolve(undefined); // ← resolve sem saber se falhou
      }
    }, 100);
  });
  if (_client) return _client;
  // ↑ cai aqui sem erro quando _start falhou; vai tentar criar de novo
}
```

**Proposta de correção**: Adicionar uma variável `_startError` para propagar a falha para os
waiters:

```js
let _startError = null;

// no finally do try:
} catch (e) {
    _startError = e;
    _starting = false;
    throw e;
} finally {
    if (!_client) _starting = false;
}

// no waiter:
if (_startError) {
    const err = _startError;
    _startError = null;
    throw err;
}
if (_client) return _client;
```

---

### NEW-03 — `timeoutMs` sem validação em `POST /sessions/:id/send` (MÉDIO)

**Arquivo**: `src/copilot/routes/sessions.js` — linha ~365

**Descrição**: O campo `timeoutMs` extraído do corpo HTTP não é validado antes de ser passado ao
`setTimeout()` e ao `session.sendAndWait()`. Um cliente malicioso (ou bugado) pode enviar
`timeoutMs: NaN`, `timeoutMs: -1`, ou `timeoutMs: Infinity`, causando:

- `setTimeout(fn, NaN)` → dispara imediatamente (Node.js trata NaN como 0)
- `setTimeout(fn, Infinity)` → nunca dispara (leak do timer no heap)
- `session.sendAndWait(prompt, { timeoutMs: -1 })` → comportamento indefinido no SDK

**Código**:

```js
const { prompt, waitForResponse = true, timeoutMs = 60_000, attachments } = req.body ?? {};
// ← nenhuma verificação em timeoutMs antes de usar
```

**Proposta de correção**:

```js
const rawTimeout = req.body?.timeoutMs;
const timeoutMs =
  rawTimeout === undefined
    ? 60_000
    : typeof rawTimeout === 'number' && isFinite(rawTimeout) && rawTimeout > 0
      ? rawTimeout
      : null;

if (timeoutMs === null) {
  return res.status(400).json({ ok: false, error: 'timeoutMs deve ser um número positivo finito' });
}
```

---

### NEW-04 — `writeTurn` retry sem sleep (BAIXO)

**Arquivo**: `src/copilot/conversation-hub/store.js` — linha ~424

**Descrição**: O retry loop na função `writeTurn` itera 3 vezes consecutivas sem sleep entre
tentativas. Isso não dá ao WAL do SQLite tempo para resolver o conflito de lock. Na prática, todas
as 3 tentativas falham em burst antes que outra thread possa commitar.

**Código atual**:

```js
for (let attempt = 0; attempt < 3; attempt++) {
    try {
        stmt.run(...)
        return;
    } catch (e) {
        if (attempt === 2) throw e;
        // ← sem sleep aqui
    }
}
```

**Proposta de correção** (jitter exponencial simples):

```js
const RETRY_DELAYS = [5, 15, 40]; // ms

for (let attempt = 0; attempt <= 2; attempt++) {
    try {
        stmt.run(...);
        return;
    } catch (e) {
        if (attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
    }
}
```

> **Nota**: `writeTurn` já usa `async/await` - o `await` de um `setTimeout` de 5-40ms é trivial.

---

### NEW-05 — `registerCustomAgent` valida apenas `name` (BAIXO)

**Arquivo**: `src/copilot/config/custom-agents.js` — linha ~114

**Descrição**: A função `registerCustomAgent` (que pode ser chamada via HTTP API) valida apenas
`config.name`. Os campos `description`, `tools` e `prompt` não são validados. Um agente com
`tools: null` ou `prompt: 12345` pode passar para o SDK e causar erros em runtime difíceis de
rastrear.

**Proposta de correção**:

```js
export function registerCustomAgent(config) {
  if (!config?.name || typeof config.name !== 'string') {
    throw new Error('CustomAgentConfig.name deve ser string não-vazia');
  }
  if (typeof config.description !== 'string') {
    throw new Error('CustomAgentConfig.description deve ser string');
  }
  if (!Array.isArray(config.tools)) {
    throw new Error('CustomAgentConfig.tools deve ser string[]');
  }
  if (typeof config.prompt !== 'string') {
    throw new Error('CustomAgentConfig.prompt deve ser string');
  }
  BUILTIN_AGENTS.set(config.name, config);
}
```

---

### NEW-06 — CORS wildcard em rotas internas do `TerminalServer` (BAIXO)

**Arquivo**: `src/copilot/terminal/server.js` — linha ~108

**Descrição**: O servidor faz bind em `127.0.0.1` (loopback — correto), mas qualquer rota com
`cors: true` retorna `Access-Control-Allow-Origin: *`. Isso significa que qualquer página web aberta
localmente no navegador pode fazer requisições para o terminal server sem restrição de origem. Não é
um vetor de ataque remoto (por ser loopback), mas é uma superfície desnecessária.

**Proposta**: restringir CORS ao origin `null` (para requests de página local) ou remover o header
CORS completamente (o server é chamado apenas por código Node.js interno):

```js
// Se o único caller é código Node.js (não browser):
// Remover o header Access-Control-Allow-Origin inteiramente.
// Se há uso legítimo de browser local, restringir:
if (result.cors) headers['Access-Control-Allow-Origin'] = 'null'; // origin de file://
```

---

## Padrões Verificados como Corretos (Positivos)

| Padrão                                            | Status         | Evidência                                                                    |
| ------------------------------------------------- | -------------- | ---------------------------------------------------------------------------- |
| `setInterval` → `clearInterval` em close handlers | ✅ OK          | `routes/agent.js`, `routes/sessions.js`, `bridge-stream.js`, `lib/client.js` |
| `addEventListener` com `{ once: true }`           | ✅ OK          | `always-alive.js:595` (AbortSignal)                                          |
| `parseInt` com radix                              | ✅ OK          | Zero chamadas sem radix                                                      |
| `gh-bridge.js` silent catches                     | ✅ Intencional | 19 catches, todos retornam defaults                                          |
| `channel/client.js` evento cleanup                | ✅ OK          | `.off()` em bloco `finally`                                                  |
| `lib/telemetry.js` span.end()                     | ✅ OK          | `finally` block garantido                                                    |
| `web-tools.js` proteção SSRF                      | ✅ OK          | `isPrivateHost()` em cada redirect + URL inicial                             |
| `terminal/server.js` bind address                 | ✅ OK          | `127.0.0.1` (loopback only)                                                  |
| `tools/session-rpc-tools.js` error returns        | ✅ OK          | Padrão `{ error: e.message }` consistente                                    |
| `hooks.js` tool policy                            | ✅ OK          | `allowTools`/`denyTools`/`denyPatterns` com `additionalContext`              |
| `http-handlers.js` input validation               | ✅ OK          | Validação de tipo explícita em TODO endpoint                                 |

---

## Melhorias Propostas (Upgrades / Aprimoramentos)

### UPG-01 — `sendDialogTurn`: adicionar AbortSignal externo (INFO)

**Arquivo**: `always-alive.js`

Atualmente, o mecanismo de cancelamento do `sendDialogTurn` é apenas o timeout interno. Expor um
`signal?: AbortSignal` opcional permitiria ao chamador cancelar externamente:

```js
sendDialogTurn(message, { timeout = 60_000, signal } = {}) {
    if (signal?.aborted) return Promise.reject(new Error('Aborted'));
    // ...
    signal?.addEventListener('abort', () => {
        clearTimeout(timeoutHandle);
        this.off('dialog.reply', onReplyOuter);
        this.off('dialog.stopped', onStopOuter);
        reject(new Error('sendDialogTurn abortado'));
    }, { once: true });
}
```

---

### UPG-02 — `writeTurn` usar MAX_RETRIES constante (INFO)

**Arquivo**: `store.js`

O número de retries está hardcoded como `3`. Extrair para constante `WRITE_MAX_RETRIES = 3` e usar
em todos os loops de retry para facilitar tuning futuro.

---

### UPG-03 — `session.js`: migrar modo `'off'` para `'customize'` quando SDK v0.2.0 (INFO)

**Arquivo**: `src/copilot/config/session.js:93`

TODO já registrado no código. Quando o SDK v0.2.0 for publicado com suporte a `mode: 'customize'`,
migrar o fallback para evitar o modo `'off'` que desativa ferramentas completamente.

---

### UPG-04 — `hub-tools.js`: validar `timeoutMs` de ferramenta LLM (INFO)

**Arquivo**: `src/copilot/tools/hub-tools.js`

Embora o caller seja o LLM (não um humano direto), validar `timeoutMs` antes de passar para
`hub.sendToLlmB` evita que um modelo alucinado passe valores absurdos:

```js
const resolvedTimeout =
  typeof timeoutMs === 'number' && isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120_000; // fallback
```

---

### UPG-05 — `lib/client.js`: exponential backoff no poll de `_starting` (INFO)

**Arquivo**: `src/copilot/lib/client.js`

O poll usa `setInterval(100ms)` linear. Trocar por backoff exponencial (100 → 200 → 400ms, cap
2000ms) para reduzir pressão quando o cliente demorar a inicializar:

```js
let pollDelay = 100;
const interval = setInterval(() => {
  if (!_starting) {
    clearInterval(interval);
    resolve(undefined);
  }
  pollDelay = Math.min(pollDelay * 2, 2000);
}, pollDelay);
```

> **Nota**: `setInterval` não suporta delay dinâmico — usar `setTimeout` recursivo.

---

### UPG-06 — Adicionar `onPreToolUse` audit ao `createMinimalHooks()` (INFO)

**Arquivo**: `src/copilot/lib/hooks.js`

`createMinimalHooks()` não loga nada. Para auditoria de segurança em produção, mesmo os hooks
"mínimos" deveriam logar tools usadas em nível DEBUG. Proposta: sempre logar tools em
`createMinimalHooks()` com `log('DEBUG', ...)`, sem impacto em performance.

---

## Plano de Execução

### P1 — Fixes de Bugs (ALTO/MÉDIO) — Executar imediatamente

| ID     | Arquivo              | Descrição                                                | Impacto                                                              |
| ------ | -------------------- | -------------------------------------------------------- | -------------------------------------------------------------------- |
| NEW-01 | `always-alive.js`    | Cross-cleanup outer path `dialog.reply`/`dialog.stopped` | ALTO — previne listener leak e consumo incorreto de evento posterior |
| NEW-02 | `lib/client.js`      | Propagar `_startError` para waiters                      | MÉDIO — previne loop silencioso após falha de inicialização          |
| NEW-03 | `routes/sessions.js` | Validar `timeoutMs` antes de usar                        | MÉDIO — previne timer com NaN/Infinity                               |

### P2 — Fixes de Baixa Severidade

| ID     | Arquivo              | Descrição                                   |
| ------ | -------------------- | ------------------------------------------- |
| NEW-04 | `store.js`           | Sleep entre retries de `writeTurn`          |
| NEW-05 | `custom-agents.js`   | Validação completa de `registerCustomAgent` |
| NEW-06 | `terminal/server.js` | Documentar/ajustar CORS wildcard            |

### P3 — Melhorias / Upgrades (quando houver capacidade)

- UPG-01 a UPG-06 listados na seção anterior

---

## Arquivos Auditados

| Arquivo                      | LOC  | Status                           |
| ---------------------------- | ---- | -------------------------------- |
| `agent/always-alive.js`      | 1194 | ✅ Auditado — bug NEW-01         |
| `agent/session-manager.js`   | 302  | ✅ Auditado — OK                 |
| `api/bridge-stream.js`       | ~200 | ✅ Auditado — OK                 |
| `bridges/nerv-bridge.js`     | ~350 | ✅ Auditado — OK (alt. bcb76c8c) |
| `channel/client.js`          | 406  | ✅ Auditado — OK                 |
| `channel/inject.js`          | 431  | ✅ Auditado — OK                 |
| `config/custom-agents.js`    | 308  | ✅ Auditado — bug NEW-05         |
| `config/session.js`          | ~180 | ✅ Auditado — TODO UPG-03        |
| `conversation-hub/store.js`  | 753  | ✅ Auditado — bug NEW-04         |
| `lib/client.js`              | 406  | ✅ Auditado — bug NEW-02         |
| `lib/hooks.js`               | 310  | ✅ Auditado — OK                 |
| `lib/telemetry.js`           | ~220 | ✅ Auditado — OK                 |
| `routes/agent.js`            | ~300 | ✅ Auditado — OK                 |
| `routes/sessions.js`         | 562  | ✅ Auditado — bug NEW-03         |
| `terminal/http-handlers.js`  | 646  | ✅ Auditado — OK                 |
| `terminal/server.js`         | 433  | ✅ Auditado — bug NEW-06         |
| `tools/hub-tools.js`         | 327  | ✅ Auditado — melhoria UPG-04    |
| `tools/session-rpc-tools.js` | 302  | ✅ Auditado — OK                 |
| `tools/web-tools.js`         | 322  | ✅ Auditado — OK (SSRF correto)  |
| `bridges/gh-bridge.js`       | ~350 | ✅ Auditado — OK                 |

---

_Gerado em 2026-03-27 — Git HEAD `bcb76c8c`_
