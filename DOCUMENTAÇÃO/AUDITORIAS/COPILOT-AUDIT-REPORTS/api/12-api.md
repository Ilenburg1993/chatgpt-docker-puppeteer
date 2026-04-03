# 12 — api/ — Módulo Consolidado

**Módulo**: `src/copilot/api/` **Arquivos**: 6 | **LOC total**: 741 **Score**: 8.5/10 **Data**:
2026-06

## Visão Geral

Camada de API pública do sistema Copilot. Dois agregadores principais:

| Agregador       | Arquivo          | Monta em         | Sub-módulos                                                |
| --------------- | ---------------- | ---------------- | ---------------------------------------------------------- |
| **HTTP Bridge** | `http-bridge.js` | `/api/copilot/*` | bridge-control, bridge-tasks, bridge-stream, bridge-dialog |
| **SDK API**     | `sdk-api.js`     | `/api/sdk/*`     | 6 routers da pasta routes/ (F14)                           |

## Mapa Funcional

### http-bridge (4 sub-módulos)

| Rota                 | Arquivo        | Descrição                             |
| -------------------- | -------------- | ------------------------------------- |
| `GET /status`        | bridge-control | Snapshot do AgentStatus               |
| `GET /health`        | bridge-control | Health check 200/503 com diagnósticos |
| `GET /session`       | bridge-control | Dados da sessão ativa                 |
| `POST /start`        | bridge-control | Inicia o agente                       |
| `POST /stop`         | bridge-control | Para o agente (stopDialogLoop + stop) |
| `GET /permissions`   | bridge-control | Modo de permissão atual               |
| `POST /permissions`  | bridge-control | Altera modo (admin only)              |
| `POST /send`         | bridge-tasks   | Enfileira mensagem (async/sync)       |
| `POST /answer`       | bridge-tasks   | Responde `question.pending`           |
| `GET /stream`        | bridge-stream  | SSE de todos os AGENT_EVENTS          |
| `POST /dialog/start` | bridge-dialog  | Inicia dialog loop §15.8              |
| `POST /dialog/turn`  | bridge-dialog  | Turno de diálogo                      |
| `POST /dialog/stop`  | bridge-dialog  | Encerra dialog loop (DL-PERM)         |

## Achados por Severidade

### P4 (2)

| ID        | Arquivo           | Título                                                                                   |
| --------- | ----------------- | ---------------------------------------------------------------------------------------- |
| API-P4-01 | bridge-control.js | `hubStore` false positive: `conversationStore.db?.prepare(...)` short-circuits sem throw |
| API-P4-02 | bridge-tasks.js   | TOCTOU+silent swallow: cliente recebe `ok:true` mas mensagem descartada por QUEUE_FULL   |

**API-P4-01 (bridge-control)**: `conversationStore.db?.prepare('SELECT 1').get()` — se `db` for
`null`, o `?.` short-circuits a chain inteira e retorna `undefined` sem lançar exceção. O
`try/catch` retorna `{ ok: true }` mesmo com banco indisponível. Fix: verificar
`!conversationStore.db` antes da query.

**API-P4-02 (bridge-tasks)**: A verificação GAP-03 de fila cheia tem janela TOCTOU. No modo
`waitForResponse=false`, se `sendMessage` rejeita com QUEUE_FULL no intervalo entre check e enqueue,
o `.catch` apenas loga sem feedback ao cliente — que já recebeu `{ ok: true, taskId }`. O `taskId`
retornado nunca emitirá eventos SSE.

### P5 (5)

| ID        | Arquivo           | Título                                                             |
| --------- | ----------------- | ------------------------------------------------------------------ |
| API-P5-01 | bridge-control.js | `POST /stop` e `POST /start` sem `requireAdmin`                    |
| API-P5-02 | bridge-control.js | `status === 'starting'` não consta como estado healthy             |
| API-P5-03 | bridge-tasks.js   | `randomUUID()` como taskId pode não coincidir com internal task ID |
| API-P5-04 | bridge-stream.js  | Filtro `?events=` não suporta wildcards                            |
| API-P5-05 | bridge-stream.js  | Sem cap real de SSE simultâneos                                    |
| API-P5-06 | bridge-dialog.js  | `/dialog/turn` sem AbortController no nível da rota                |

## Padrões Notáveis

### `_makeAdminAuthMiddleware()` — fail-safe por ambiente

- Produção sem token → 503 (falha segura: endpoint inacessível sem configuração)
- Dev sem token → next() com WARN log (bypass documentado)
- Qualquer ambiente com token → verificação Bearer correta

### `bridge-stream.js` — SSE robusto com sanitização e lifetime cap

- `SEC-VULN-02`: `String(event).replace(/[\r\n]/g, '_')` previne header injection em nomes de evento
- `MAX_SSE_LIFETIME_MS` (default 24h) com evento `reconnect` antes de fechar
- `req.on('close')` limpa handlers + timers com simetria perfeita

### `bridge-dialog.js` — Dialog Loop com guard DL-PERM

- `_turnInFlight` impede turnos concorrentes na camada HTTP
- `POST /dialog/stop` exige `{ force: true }` explícito — previne encerramento acidental
- Diferenciação rigorosa de status HTTP: 409/429/504/500

## Score por Arquivo

| Arquivo           | LOC     | Score      | P4    | P5    |
| ----------------- | ------- | ---------- | ----- | ----- |
| http-bridge.js    | 40      | 9.5/10     | 0     | 0     |
| sdk-api.js        | 39      | 9.5/10     | 0     | 0     |
| bridge-control.js | 243     | 8.5/10     | 1     | 2     |
| bridge-tasks.js   | 128     | 8.3/10     | 1     | 2     |
| bridge-dialog.js  | 151     | 9.0/10     | 0     | 2     |
| bridge-stream.js  | 140     | 8.8/10     | 0     | 3     |
| **TOTAL**         | **741** | **8.5/10** | **2** | **9** |

## Referências

| Arquivo                        | Path                                                 |
| ------------------------------ | ---------------------------------------------------- |
| http-bridge.js                 | [http-bridge-audit.md](./http-bridge-audit.md)       |
| sdk-api.js                     | [sdk-api-audit.md](./sdk-api-audit.md)               |
| bridge-control.js              | [bridge-control-audit.md](./bridge-control-audit.md) |
| bridge-tasks.js                | [bridge-tasks-audit.md](./bridge-tasks-audit.md)     |
| bridge-dialog.js               | [bridge-dialog-audit.md](./bridge-dialog-audit.md)   |
| bridge-stream.js               | [bridge-stream-audit.md](./bridge-stream-audit.md)   |
| Módulo anterior (F15 channel/) | [../channel/11-channel.md](../channel/11-channel.md) |

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II — F16 api/._
