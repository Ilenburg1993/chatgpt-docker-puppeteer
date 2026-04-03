# Módulo conversation-hub/ — Relatório Consolidado

**Escopo**: `src/copilot/conversation-hub/` **Fase**: F11 — COPILOT-FULL-AUDIT MF-II **Data**:
2026-06-10 **Arquivos auditados**: 6 | **LOC total**: 2206

---

## 1. Visão Geral do Módulo

O módulo `conversation-hub/` implementa o ambiente permanente LLM-A ↔ LLM-B ↔ Usuário:

| Arquivo            | LOC | Responsabilidade                                                      |
| ------------------ | --- | --------------------------------------------------------------------- |
| `index.js`         | 13  | Barrel de exportação                                                  |
| `hub.js`           | 262 | Facade singleton: compõe store + orchestrator + socket namespace      |
| `store-helpers.js` | 162 | Typedefs + helpers FTS5 (init, migração de tokenizer, sanitização)    |
| `store.js`         | 677 | Persistência SQLite: sessions, turns, memórias, FTS search            |
| `orchestrator.js`  | 646 | Lógica de diálogo: mutex por sessão, 3 modos de execução, eventos     |
| `socket-ns.js`     | 446 | Namespace /copilot: auth JWT, rate limit, inject, histórico real-time |

---

## 2. Achados Consolidados

### Índice de Severidade

| ID     | Arquivo            | Severidade | Título curto                                                          |
| ------ | ------------------ | ---------- | --------------------------------------------------------------------- |
| C11-01 | `socket-ns.js`     | **P4**     | `turns:history` sem verificação de autorização por sessão             |
| C11-02 | `socket-ns.js`     | **P4**     | `sessions:list` retorna todas as sessões sem filtro                   |
| C11-03 | `store.js`         | **P4**     | `syncFromSdkHistory` usa `LIKE '%id%'` — full-table scan por mensagem |
| C11-04 | `hub.js`           | P5         | `#bridgeToNerv` não encaminha `turn:delta` e `turn:user_pending`      |
| C11-05 | `store-helpers.js` | P5         | `sanitizeFtsQuery` usa phrase-search — reduz recall multi-palavra     |
| C11-06 | `store.js`         | P5         | `writeTurn` é `async` sem necessidade estrutural (só retry sleep)     |
| C11-07 | `orchestrator.js`  | P5         | `setFallbackAgent` module-level não resetado entre testes             |
| C11-08 | `orchestrator.js`  | P5         | `#callViaSimpleChat` aciona WARN em casos legítimos                   |

**Total**: 3×P4 + 5×P5 = 8 achados

---

## 3. Achados Detalhados (P4)

### C11-01 — `turns:history` sem verificação de autorização por sessão

Qualquer cliente Socket.io autenticado pode solicitar o histórico de qualquer sessão sem ter feito
`join:session`. Proteção por UUID é obscuridade, não autorização.

```js
// Proposta — verificar membership na sala:
if (!socket.rooms.has(data.hubSession)) {
  socket.emit('error:history', { reason: 'Você não está na sessão solicitada.' });
  return;
}
```

---

### C11-02 — `sessions:list` sem filtro de acesso

Qualquer cliente recebe metadados de todas as sessões (ativas e encerradas). Em ambientes
compartilhados, expõe metadados de outras conversas.

---

### C11-03 — `syncFromSdkHistory`: `LIKE '%sdkTurnId%'` full scan por mensagem

Para cada mensagem do histórico SDK, a deduplicação executa `LIKE '%id%'` sobre a coluna `metadata`
(texto JSON) de toda a sessão — O(n) sem índice.

**Correção recomendada**: adicionar coluna `sdk_turn_id TEXT` indexada:

```sql
ALTER TABLE copilot_conversation_turns ADD COLUMN sdk_turn_id TEXT;
CREATE UNIQUE INDEX idx_turns_sdk ON copilot_conversation_turns(hub_session_id, sdk_turn_id)
    WHERE sdk_turn_id IS NOT NULL;
```

---

## 4. Destaques Positivos do Módulo

| Destaque                               | Arquivo           | Impacto                                   |
| -------------------------------------- | ----------------- | ----------------------------------------- |
| Mutex por sessão via Promise chain     | `orchestrator.js` | Sem race conditions em concurrent sends   |
| BUG-01: UNIQUE + retry WAL             | `store.js`        | Proteção robusta contra conflitos SQLite  |
| WAL checkpoint passivo + unref         | `store.js`        | Não bloqueia readers nem o processo       |
| BUG-HIGH-03: task.delta listener       | `orchestrator.js` | Streaming real-time em dialog loop        |
| SEC-N09: sanitização de injeção        | `socket-ns.js`    | Bloqueia prompt injection via user:inject |
| Rate limit duplo (socket + IP)         | `socket-ns.js`    | Anti-flood de injeções                    |
| JWT auth configurável por env          | `socket-ns.js`    | Auth por default, desabilitável           |
| SEC-05: join:session valida existência | `socket-ns.js`    | Previne entrada em sessão fantasma        |
| ARCH-03: lazy setFallbackAgent         | `orchestrator.js` | Quebra ciclo de imports                   |
| close() gracioso com ARCH-04           | `store.js`        | Timer limpo + DB anulado corretamente     |

---

## 5. Scores por Arquivo

| Arquivo                      | Score      |
| ---------------------------- | ---------- |
| `index.js`                   | 10.0/10    |
| `hub.js`                     | 9.0/10     |
| `store-helpers.js`           | 8.5/10     |
| `store.js`                   | 8.5/10     |
| `orchestrator.js`            | 9.0/10     |
| `socket-ns.js`               | 8.0/10     |
| **Módulo conversation-hub/** | **8.8/10** |

---

## 6. Referências

- [index-audit.md](./index-audit.md)
- [hub-audit.md](./hub-audit.md)
- [store-helpers-audit.md](./store-helpers-audit.md)
- [store-audit.md](./store-audit.md)
- [orchestrator-audit.md](./orchestrator-audit.md)
- [socket-ns-audit.md](./socket-ns-audit.md)

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
