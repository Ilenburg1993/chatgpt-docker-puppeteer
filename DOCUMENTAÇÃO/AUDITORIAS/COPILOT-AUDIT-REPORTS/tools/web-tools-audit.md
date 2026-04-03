# Audit: src/copilot/tools/web-tools.js

**Módulo**: `copilot/tools` **Arquivo**: `src/copilot/tools/web-tools.js` **LOC**: 396 **Data**:
2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Fornece `web_fetch` e `web_search` com proteção SSRF robusta via `validateUrl()`, rate-limit em
memória (20 req/min), validação de content-type e verificação pós-redirect. `web_search` usa API
JSON do DuckDuckGo com fallback para HTML scraping. Há comentários explícitos sobre fragilidade do
scraping. `webSearchTool` pode ser desabilitado via `WEB_SEARCH_DISABLED=true`.

**Score**: 8.5/10

---

## Achados

### P4 — RATE_WINDOW Compartilhado entre web_fetch e web_search

**Localização**: Função `checkRateLimit()`, `RATE_WINDOW` Map.

```js
const RATE_WINDOW = new Map();
const MAX_REQUESTS_PER_MINUTE = 20;
```

`web_fetch` e `web_search` compartilham o mesmo rate limiter. Um burst de 15 buscas + 5 fetches
esgota o limite. Não há configuração separada por tool.

**Impacto**: Baixo; documentado no description de `web_search` ("pool compartilhado com web_fetch").

---

### P4 — HTML Scraping Frágil para DDG Fallback

**Localização**: `webSearchTool`, bloco de fallback HTML scraping.

O próprio código documenta: "AVISO: este parsing é frágil por design — depende do layout HTML do DDG
que pode mudar sem aviso."

Regex como `/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gs` é suscetível a mudanças
no DOM do DDG.

**Impacto**: Médio. Quando DDG mudar layout, `web_search` retornará 0 resultados silenciosamente
(com log WARN, mas sem erro explícito ao caller).

**Recomendação**: Considerar retornar campo `source: 'html_scraping'` + flag `may_be_stale: true`
para que o caller saiba que a busca usou o fallback frágil.

---

### P4 — web_search Exportação Condicional Pode Confundir

**Localização**: Linha final do arquivo.

```js
export const webTools = [
  webFetchTool,
  ...(process.env['WEB_SEARCH_DISABLED'] === 'true' ? [] : [webSearchTool]),
];
```

A composição dinâmica do array de export baseada em env var significa que o módulo exporta um array
diferente dependendo do ambiente. IDEs e type checkers sempre verão `Tool[]` sem indicação de qual
tool pode faltar.

**Impacto**: Baixo operacionalmente; pode ser confuso em testes.

---

## Positivos

- `validateUrl()` aplicado ao URL inicial E ao URL pós-redirect — dupla proteção SSRF (OWASP A10)
- Rate limit com limpeza de buckets antigos: `if (k < bucket - 1) RATE_WINDOW.delete(k)` — sem
  memory leak
- content-type check: apenas `text/*` aceito em `web_fetch`
- Stream com `reader.cancel()` quando `received > limit` — sem leitura desnecessária
- `AbortController` com `clearTimeout(timer)` em `finally` — sem timer leaks
- DDG JSON API tentada primeiro, HTML scraping apenas como fallback
- SSRF filtering aplicado a resultados DDG em AMBOS os caminhos (JSON + HTML)
