# api/bridge-stream.js — Auditoria

**Módulo**: `src/copilot/api/` **Arquivo**: `bridge-stream.js` **LOC**: 140 | **Score**: 8.8/10

## Responsabilidade

Rota SSE `GET /stream` — push de todos os eventos `AGENT_EVENTS` em tempo real. Suporta filtro
opcional por `?events=event1,event2`.

## Achados

### P5 — Filtro `?events=` não suporta wildcards apesar do comentário sugerir

**Localização**: `bridge-stream.js:59` — `allowedEvents = new Set(eventsParam.split(',')...)`

**Descrição**: O comentário e JSDoc mencionam `?events=task.*,dialog.*`, sugerindo suporte a padrões
glob/wildcard. Porém, o código usa `allowedEvents.has(evt)` com match exato — `'task.*'` não filtra
`'task.queued'` nem `'task.delta'`. Clientes que tentarem usar wildcards receberão nenhum evento do
namespace desejado.

**Sugestão**: Implementar suporte a glob com `micromatch` ou string prefix (`'task.'`) ou corrigir a
documentação para indicar apenas match exato.

---

### P5 — `MAX_SSE_CLIENTS=0` na env não desativa o limite (truthy guard)

**Localização**: `bridge-stream.js:38` — `Number(process.env['MAX_SSE_CLIENTS']) || 100`

**Descrição**: Se `MAX_SSE_CLIENTS=0`, `Number('0') = 0` — e `0 || 100 = 100`. Não é possível
configurar um limite de 0 (que significaria "sem limite ajustado"). P5 de usabilidade.

---

### P5 — Sem cap real de clientes SSE simultâneos (apenas setMaxListeners)

**Localização**: `bridge-stream.js:38–39`

**Descrição**: `MAX_SSE_CLIENTS` é usado apenas para ajustar o threshold de aviso do EventEmitter
(`agent.setMaxListeners(...)`). Não há contagem de clientes conectados nem rejeição de novas
conexões quando o limite é atingido. Padrão consistente com `routes/agent.js` e `routes/hooks.js`,
mas representa exposição a DoS por file-descriptor exhaustion.

---

## Destaques Positivos

- `G2-SEC-08`: `MAX_SSE_LIFETIME_MS` (default 24h) envia evento `reconnect` e fecha conexão ao
  expirar
- `req.on('close')` limpa **todos** os handlers (`handlers.forEach(off)`) +
  `clearInterval(heartbeat)` + `clearTimeout(lifetimeTimer)` — sem leaks
- `G2-PERF-05`: single `sseHandler` factory com `bind` por evento → menod closures que V8 otimiza
  melhor
- `SEC-VULN-02`: `String(event).replace(/[\r\n]/g, '_')` — sanitização do nome de evento SSE (header
  injection)
- `G2-API-10`: filtro de eventos por query param `?events=` backward-compatible (sem param = todos)
- `ARCH-05`: `setMaxListeners` dinâmico ajustado por `MAX_SSE_CLIENTS × AGENT_EVENTS.length`
- Heartbeat a cada 15s com `sendEvt('heartbeat', { ts: Date.now() })`

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
