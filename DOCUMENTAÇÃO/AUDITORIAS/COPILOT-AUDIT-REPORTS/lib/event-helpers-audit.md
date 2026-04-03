# event-helpers.js — Auditoria

**Módulo**: `src/copilot/lib/` **Arquivo**: `event-helpers.js` **LOC**: 140 | **Score**: 9.5/10

## Responsabilidade

Utilitários de espera de eventos: `waitForEvent(emitter, event, opts)` e
`raceEvents(emitter, events, opts)`. Ambos suportam `timeoutMs`, `timeoutError` customizado e
`AbortSignal`.

## Achados

Nenhum achado de impacto real.

_(P5 marginal: ausência de aviso quando `emitter.setMaxListeners()` não está configurado para
múltiplas chamadas simultâneas ao mesmo evento, mas fora do escopo normal de uso.)_

## Destaques Positivos

- Cleanup completo em **todos os caminhos** (resolve, reject, abort, timeout)
- `raceEvents` retorna `{ event: string, data: unknown }` — discriminador claro
- Nenhum listener vazado: cada finally remove `successListener`, `errorListener`, `abortListener`,
  `timeoutId` corretamente
- Timeout default 30s razoável para sessões Copilot

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
