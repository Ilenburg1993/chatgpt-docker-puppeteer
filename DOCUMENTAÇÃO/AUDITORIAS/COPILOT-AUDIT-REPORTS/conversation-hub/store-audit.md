# Auditoria — `store.js`

**Módulo**: `src/copilot/conversation-hub/store.js` **LOC**: 677 **Data**: 2026-06-10 **Auditor**:
Copilot Full-Audit MF-II

---

## 1. Propósito

Camada de persistência SQLite para o Conversation Hub. Usa `better-sqlite3` (síncrono) para todas as
operações, exceto `writeTurn` que é `async` por conta dos retries com backoff. Gerencia:

- `copilot_hub_sessions` — sessões da conversa
- `copilot_conversation_turns` — turnos de cada sessão
- `copilot_memories` — memórias semânticas com FTS5
- WAL checkpoint periódico (5 min)

---

## 2. Achados

### FINDING-P4-1 — `syncFromSdkHistory`: `LIKE '%sdkTurnId%'` é full-table scan por mensagem

**Severidade**: P4 — Médio **Localização**: `syncFromSdkHistory()` linhas ~600-615

```js
const escapedId = sdkTurnId.replace(/%/g, '\\%').replace(/_/g, '\\_');
const exists = db
  .prepare(
    `SELECT 1 FROM copilot_conversation_turns
     WHERE hub_session_id = ? AND metadata LIKE ? ESCAPE '\\'`,
  )
  .get(hubSessionId, `%${escapedId}%`);
```

Para cada mensagem do histórico SDK, executa `LIKE '%id%'` sobre a coluna `metadata` (JSON text) de
toda a sessão. Sem índice sobre `metadata`, isso é O(n) por mensagem onde `n` é o número de turnos
na sessão. Para sessões com centenas de turnos e sincronizações frequentes, isso é potencialmente
lento.

**Proposta**: adicionar coluna `sdk_turn_id` com índice único, ou usar `readTurns()` em memória para
dedup antes da transaction:

```sql
-- migration: adicionar coluna indexada
ALTER TABLE copilot_conversation_turns ADD COLUMN sdk_turn_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_sdk_turn_id ON copilot_conversation_turns(hub_session_id, sdk_turn_id) WHERE sdk_turn_id IS NOT NULL;
```

---

### FINDING-P5-1 — `writeTurn` é `async` sem necessidade estrutural (apenas pela retry sleep)

**Severidade**: P5 — Baixo **Localização**: `writeTurn()` linhas ~280-325

```js
async writeTurn(hubSessionId, opts) {
    // ... doWrite é sync (better-sqlite3)
    for (let attempt = 0; attempt < WRITE_MAX_RETRIES; attempt++) {
        try { return doWrite(); }
        catch { await sleep(RETRY_DELAYS_MS[attempt]); } // único async
    }
}
```

`better-sqlite3` é síncrono por design. A única razão para `async` é o `await sleep()` nos retries.
Na ausência de conflito (esmagadora maioria das chamadas), `writeTurn()` completa de forma
efetivamente síncrona. Callers que usam `await writeTurn()` pagam custo de microtask
desnecessariamente. Alternativa: expor `writeTurnSync()` para uso interno e manter `async` apenas na
API pública.

---

## 3. Pontos Positivos

- **BUG-01**: constraint `UNIQUE (hub_session_id, turn_number)` com retry logic (3 tentativas,
  backoff 5+15+40ms) — excelente proteção contra race conditions em WAL mode.
- **BUG-C02**: retry com `await sleep()` em vez de `Atomics.wait()` (bloquearia event loop) —
  correto.
- WAL checkpoint com `PASSIVE` mode + `unref()` — não bloqueia readers nem o processo.
- **ARCH-04**: referência do timer no `#checkpointTimer` — `close()` limpa corretamente.
- Todas as queries usam prepared statements — sem possibilidade de SQL injection.
- `sanitizeFtsQuery` previne FTS injection.
- `injectUserMessage` → `writeTurn(role='user')` com `user_read=0` — semântica de leitura limpa.
- `close()` no store para testes: cancela timer, anula DB e flag.

---

## 4. Score

| Dimensão                        | Nota       |
| ------------------------------- | ---------- |
| Segurança (prepared statements) | 10/10      |
| Performance (dedup scan)        | 7/10       |
| Resiliência (retry WAL)         | 10/10      |
| **Global**                      | **8.5/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._

---

## Status de Correção (2026-04-03)

### [FIXED] C11-03 (P4) — deduplicação O(1) com sdk_turn_id indexado

store.js: syncFromSdkHistory agora usa coluna sdk_turn_id (migration v7) para dedup — SELECT por
índice UNIQUE. INSERT também persiste sdk_turn_id diretamente na coluna. Elimina LIKE scan O(n) em
metadata JSON que era ineficiente em tabelas grandes.

### [IMPROVED] T-08 (P4) — countHubSessions() com COUNT(\*)

Adicionado método countHubSessions({status?}) no ConversationStore. handleHubHealth agora usa
countHubSessions() em vez de listHubSessions({limit:1000}).length.

**Pontuação atualizada: 9.0/10**
