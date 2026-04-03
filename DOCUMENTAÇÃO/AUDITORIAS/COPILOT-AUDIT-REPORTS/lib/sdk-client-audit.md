# sdk-client.js — Auditoria

**Módulo**: `src/copilot/lib/` **Arquivo**: `sdk-client.js` **LOC**: 435 | **Score**: 8.5/10

## Responsabilidade

Singleton de `CopilotClient` com session registry em memória. Suporta `cliUrl` (CLI externo via
PM2), OTLP telemetria, `forceStop`, e funções auxiliares de diagnóstico.

## ACHADO C13-01 — P4 **[FIXED]**

**`_startError` race: N waiters retentam criação após primeira falha**

Quando múltiplos chamadores concorrentes aguardam `_starting=false`, todos acordam simultaneamente
após uma falha de inicialização. Apenas o **primeiro** waiter lê e limpa `_startError`; os demais
não encontram o erro, não encontram `_client`, e **retentam a criação do cliente**:

```js
// N waiters acordam:
if (_startError) {
  const err = _startError;
  _startError = null; // ← Apenas o 1º limpa
  throw err;
}
if (_client) return _client;
// Waiter 2, 3... chegam aqui: sem erro, sem cliente → tentam criar novamente
```

Em cenário de alta concorrência com CLI indisponível, isso pode gerar múltiplas tentativas paralelas
de inicialização — cada uma falhando e sobrescrevendo `_startError` — storm de erros.

**Correção recomendada**: usar uma Promise compartilhada para todos os waiters:

```js
let _startPromise = null; // Compartilhada entre waiters

export async function getClient(overrides = {}) {
  if (_client && _client.getState() === 'connected') return _client;
  if (_startPromise) return _startPromise;

  _startPromise = _doStart(overrides).finally(() => {
    _startPromise = null;
  });
  return _startPromise;
}
```

## ACHADO C13-02 — P5

**`resumeClientSession` retorna sessão stale sem revalidar conectividade**

Se uma sessão está no registry `_sessions` mas o CLI foi reiniciado ou a sessão expirou,
`resumeClientSession` retorna o objeto stale sem detectar que está desconectado. O erro só aparece
ao tentar usar a sessão.

## Destaques Positivos

- `_resetClientState()` e `_injectClientForTest()` para isolamento de testes perfeito
- `buildClientOptions` suporta `COPILOT_CLI_URL` e telemetria OTLP via env
- `stopClient()` retorna array de erros (não swallows failures)
- `forceStopClient()` com type-safe check `typeof anyClient.forceStop === 'function'`
- `getClient()` UPG-05: backoff exponencial para waiters (100→200→400→...→2000ms)
- NEW-02 fix: `_startError` propagado para waiters antes de limpar

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
