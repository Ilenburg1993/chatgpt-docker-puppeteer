# Auditoria — `route-table.js`

**Módulo**: `src/copilot/terminal/route-table.js` **LOC**: 214 **Data**: 2026-06-10 **Auditor**:
Copilot Full-Audit MF-II

---

## 1. Propósito

Tabela declarativa de rotas para o servidor HTTP do Terminal LLM-B. Define todos os endpoints, seus
métodos, handlers, configurações de rate limiting, autenticação e extração de parâmetros de URL.

---

## 2. Estrutura da tabela

Cada entrada `RouteEntry` contém:

- `method` — `'GET' | 'POST' | 'PUT' | 'DELETE'`
- `path` — string exata ou `RegExp` para captura de params
- `handler` — função do `http-handlers.js`
- `skipAuth?` — bypass de autenticação (`/health`, `/hub-health`, `/metrics`)
- `body?` — flag de parse de request body
- `rateLimiter?` — referência ao rate limiter (inject/write/sse)
- `params?` — função extratora de parâmetros de URL
- `async?` — indica se o handler retorna Promise

---

## 3. Achados

### FINDING-P4-1 — Ausência de rota `OPTIONS` para CORS preflight

**Severidade**: P4 — Médio _(Complementa `server-audit.md` FINDING-P4-1)_

`ROUTE_TABLE` não contém nenhuma entrada com `method: 'OPTIONS'`. Clientes do dashboard Vue fazendo
requisições `PUT /config` ou `DELETE /memory/:id` com header `Authorization` disparam preflight
`OPTIONS` que resulta em 404.

---

### FINDING-P5-2 — `matchRoute` é O(n) linear scan via `Array.find()`

**Severidade**: P5 — Baixo **Localização**: `matchRoute()` linhas ~200-214

```js
export function matchRoute(method, pathname) {
  return ROUTE_TABLE.find((r) => {
    if (r.method !== method) return false;
    if (typeof r.path === 'string') return r.path === pathname;
    return r.path.test(pathname);
  });
}
```

Com ~30 rotas, O(n) é negligível (< 1µs por chamada). Se a tabela crescer para centenas de rotas, um
índice composto `Map<method, RouteEntry[]>` traria O(1) para string routes com fallback a regex. Por
ora: bem aceitável.

---

### FINDING-P5-3 — Regex routes compiladas em todo module load mas sem cache explícito

**Severidade**: P5 — Cosmético

As RegExps (`/^\/sessions\/[^/]+\/turns$/`, etc.) são literais no `ROUTE_TABLE` — compiladas uma vez
quando o módulo é importado. Isso é correto e eficiente. Documentado como "não há recompilação por
requisição".

---

## 4. Pontos positivos

- Tabela declarativa com tipo `RouteEntry` bem documentado — nova rota = nova linha.
- `skipAuth` explícito — fácil auditoria de endpoints públicos sem ler a lógica de auth.
- `params()` extractors na tabela — sem parsing de URL espalhado pelos handlers.
- Rate limiter por rota (inject/write/sse) — configuração centralizada.
- `path: /regex/` para routes dinâmicas — sem framework de roteamento externo.
- Documentação inline dos endpoints por grupos (`Agent`, `System`, `Dialog`, `Memory`).

---

## 5. Score

| Dimensão                       | Nota       |
| ------------------------------ | ---------- |
| Completude de rotas            | 8.5/10     |
| Segurança (skipAuth auditável) | 9/10       |
| Performance                    | 9/10       |
| **Global**                     | **8.8/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
