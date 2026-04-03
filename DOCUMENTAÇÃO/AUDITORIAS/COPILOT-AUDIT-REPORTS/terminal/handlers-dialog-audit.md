# Auditoria — `handlers-dialog.js`

**Módulo**: `src/copilot/terminal/handlers-dialog.js` **LOC**: 154 **Data**: 2026-06-10 **Auditor**:
Copilot Full-Audit MF-II

---

## 1. Propósito

Handlers para gestão de sessões, turns do hub, memórias e health do conversation hub no terminal
LLM-B. Faz proxy entre HTTP e `conversationStore`.

---

## 2. Endpoints mapeados

| Handler                | Endpoint                  | Observação                              |
| ---------------------- | ------------------------- | --------------------------------------- |
| `handleListSessions`   | `GET /sessions`           | Lista sessões com filtro, limit, offset |
| `handleListTurns`      | `GET /sessions/:id/turns` | Paginação de turns por sessão           |
| `handleStoreMemory`    | `POST /memory`            | Persiste memória com tag                |
| `handleRecallMemories` | `GET /memory`             | Busca semântica ou por tag              |
| `handleDeleteMemory`   | `DELETE /memory/:id`      | Remove memória por ID                   |
| `handleHubHealth`      | `GET /hub-health`         | Estado do hub (contagem de sessões)     |

---

## 3. Achados

### FINDING-P4-1 — `handleHubHealth()` faz dois full table scans com `limit: 1000`

**Severidade**: P4 — Médio **Localização**: `handleHubHealth()` linhas ~135-154

```js
const activeSessions = await conversationStore.listHubSessions({ status: 'active', limit: 1000 });
const allSessions = await conversationStore.listHubSessions({ limit: 1000 });
```

Um endpoint `/hub-health` é tipicamente chamado com frequência (health probes, dashboard). Carregar
até 1000 registros em memória POR CONSULTA — e duas vezes — é desnecessário para uma leitura de
saúde. A query deveria usar `COUNT(*)` via índice ao invés de carregar todos os registros.

**Proposta**: expor método `countHubSessions(filter)` na camada de store:

```js
const activeCount = await conversationStore.countHubSessions({ status: 'active' });
const totalCount = await conversationStore.countHubSessions({});
```

Como alternativa de curto prazo, reduzir o limit:

```js
const activeSessions = await conversationStore.listHubSessions({ status: 'active', limit: 50 });
```

---

### FINDING-P5-2 — `handleListSessions`: parâmetro `status` não validado **[FIXED]**

**Severidade**: P5 — Baixo **→ CORRIGIDO**

**Status**: Whitelist `VALID_STATUS = new Set(['active', 'closed', 'error'])` implementada. Retorna
400 se status inválido com mensagem descritiva. **Localização**: `handleListSessions()` linhas
~15-35

```js
const status = params.status; // qualquer string é passada ao store
const sessions = await conversationStore.listHubSessions({ status, limit, offset });
```

Se `status` contiver valor inválido (e.g., `"active; DROP TABLE"`), ele é passado diretamente para o
store. Dado que `conversationStore` usa parâmetros preparados (conforme auditoria da camada db), o
risco de SQL injection é baixo. Porém a resposta pode retornar lista vazia sem informar que o valor
era inválido.

**Proposta**: whitelist de valores permitidos:

```js
const VALID_STATUSES = new Set(['active', 'closed', 'archived']);
const status = VALID_STATUSES.has(params.status) ? params.status : undefined;
```

---

### FINDING-P5-3 — `handleListTurns`: sem totalCount na paginação

**Severidade**: P5 — Cosmético **Localização**: `handleListTurns()` linhas ~45-65

O response retorna `{ turns, count: turns.length }` mas não inclui o total de turns na sessão. O
cliente não pode calcular `totalPages` nem saber se há mais páginas além da atual.

---

## 4. Pontos positivos

- `handleDeleteMemory` lida com memoryId inválido retornando 404 — não lança.
- `handleRecallMemories` suporta tanto `tag` quanto `search` (busca textual) — flexível.
- `handleStoreMemory` valida `content` obrigatório — retorna 400 se ausente.
- Handlers são thin proxies para `conversationStore` — sem lógica duplicada.

---

## 5. Score

| Dimensão                   | Nota       |
| -------------------------- | ---------- |
| Correção lógica            | 8/10       |
| Performance (health scans) | 5.5/10     |
| Validação de input         | 7/10       |
| **Global**                 | **7.0/10** |

---

## 6. Status de Correção

### [FIXED] FINDING-P4-1 (T-08) — `handleHubHealth()` full table scans O(n)

`handleHubHealth()` agora utiliza `conversationStore.countHubSessions({ status: 'active' })` e
`conversationStore.countHubSessions()` que executam `COUNT(*)` via índice — eliminando os dois full
table scans com `listHubSessions({ limit: 1000 })`.

**Pontuação atualizada: 8.5/10**

---

## 6. Status de Correção

### [FIXED] FINDING-P4-1 (T-08) — `handleHubHealth()` full table scans O(n)

`handleHubHealth()` agora utiliza `countHubSessions()` com `COUNT(*)` via índice.

### [FIXED] FINDING-P5-3 (T-26) — `handleListTurns` sem `totalCount`

`handleListTurns()` agora inclui `totalCount` via `conversationStore.countTurns(sessionId)`.
Clientes de paginação agora recebem o total de turnos da sessão no response.

**Pontuação atualizada: 8.5/10**

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
