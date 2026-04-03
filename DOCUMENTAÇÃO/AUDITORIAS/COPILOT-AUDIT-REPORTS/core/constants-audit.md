# core/constants.js — Auditoria

**Módulo**: `src/copilot/core/` **Arquivo**: `constants.js` **LOC**: 76 | **Score**: 8.5/10

## Responsabilidade

Centraliza constantes do módulo copilot:

| Constante               | Valor         | Override env                        |
| ----------------------- | ------------- | ----------------------------------- |
| `LLM_B_TERMINAL_PORT`   | 3009          | `LLM_B_TERMINAL_PORT`               |
| `MAX_QUEUE_SIZE`        | 100           | —                                   |
| `LLM_B_TURN_TIMEOUT_MS` | 120_000 ms    | `LLM_B_TURN_TIMEOUT`                |
| `MAX_SSE_CLIENTS`       | 50            | `MAX_SSE_CLIENTS`                   |
| `AGENT_EVENTS`          | readonly      | — (re-exportado de agent/events.js) |
| `TOOL_CATEGORIES`       | Object.freeze | —                                   |

## Achados

### P4 — `MAX_SSE_CLIENTS` padrão inconsistente entre `constants.js` (50) e `bridge-stream.js` (100)

**Localização**: `constants.js:46` vs `bridge-stream.js:38`

**Descrição**: A constante centralizada define o default como `50`:

```js
// constants.js
export const MAX_SSE_CLIENTS = Number(process.env['MAX_SSE_CLIENTS'] ?? 50);
```

Mas `bridge-stream.js` lê a mesma variável independentemente com default diferente:

```js
// bridge-stream.js
const MAX_SSE_CLIENTS = Number(process.env['MAX_SSE_CLIENTS']) || 100;
```

Sem a env var, `bridge-stream.js` usa 100, não 50. Se outro código importar `MAX_SSE_CLIENTS` de
`core/`, obterá 50. Há duas fontes de verdade divergindo silenciosamente.

**Sugestão**: `bridge-stream.js` deve importar `MAX_SSE_CLIENTS` de `#copilot/core` em vez de reler
a env:

```js
import { MAX_SSE_CLIENTS } from '#copilot/core';
agent.setMaxListeners?.(MAX_SSE_CLIENTS * (AGENT_EVENTS.length + 2));
```

---

### P5 — Env var `LLM_B_TURN_TIMEOUT` não tem sufixo `_MS`, divergindo do nome da constante

**Localização**: `constants.js:36`

**Descrição**: A constante exportada se chama `LLM_B_TURN_TIMEOUT_MS` (unidade explícita no nome),
mas a variável de ambiente para sobrescrever é `LLM_B_TURN_TIMEOUT` (sem sufixo). Um operador que
tentar usar `LLM_B_TURN_TIMEOUT_MS=60000` no ambiente não verá efeito.

**Sugestão**: Documentar no comentário JSDoc que a env override é `LLM_B_TURN_TIMEOUT` (sem `_MS`),
ou renomear a env para `LLM_B_TURN_TIMEOUT_MS` por consistência.

---

## Destaques Positivos

- `TOOL_CATEGORIES` com `Object.freeze()` — imutável em runtime
- `AGENT_EVENTS` re-exportado via barrel — única fonte de verdade
- `LLM_B_TURN_TIMEOUT_MS` com `?? 120_000` (null-coalescing) — evita `NaN` se env é `undefined`
- JSDoc com `@type` em todas as exportações

---

## Status de Correção

### [FIXED] INC-CORE-001 — `bridge-stream.js` e `sessions.js` agora importam `MAX_SSE_CLIENTS` de `#copilot/core`

`bridge-stream.js` foi atualizado para importar `MAX_SSE_CLIENTS` de `#copilot/core` em vez de
definir a variável local com default `100`. `sessions.js` também unificado para usar o import ao
invés de definição local. Agora todos os consumidores usam o mesmo valor padrão de `50` (controlado
pela env var `MAX_SSE_CLIENTS`).

**Pontuação atualizada: 9.0/10**

### [FIXED] GAP-CORE-001 — Env var `LLM_B_TURN_TIMEOUT` agora aceita também `LLM_B_TURN_TIMEOUT_MS`

A constante `LLM_B_TURN_TIMEOUT_MS` agora aceita override via **ambas** as env vars:
`LLM_B_TURN_TIMEOUT_MS` (preferível) e `LLM_B_TURN_TIMEOUT` (legado, deprecado com comentário).
Operador que usar `LLM_B_TURN_TIMEOUT_MS=60000` agora verá efeito.

**Pontuação atualizada: 9.2/10**

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
