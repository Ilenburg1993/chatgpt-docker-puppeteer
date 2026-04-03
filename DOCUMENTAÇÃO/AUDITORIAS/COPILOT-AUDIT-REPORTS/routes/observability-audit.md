# observability.js — Auditoria (routes/)

**Módulo**: `src/copilot/routes/` **Arquivo**: `observability.js` **LOC**: 208 | **Score**: 9.0/10

## Responsabilidade

10 endpoints de observabilidade: health, metrics, errors (buffer + stats + clear), logs, audit
(in-memory + flush + tail ), OTEL status, log-level dinâmico.

## Achados

### C14-OB01 — P5

**`POST /observability/log-level` com dynamic import — padrão incomum**

```js
const { log: obsLog } = await import('#copilot/observability/logger');
obsLog.setLevel(level.toUpperCase());
```

Import dinâmico dentro de handler Express. Em ESM com cache de módulos este obtém a mesma instância
que o import top-level — funciona corretamente. Mas é incomum e pode confundir mantenedores. Poderia
importar no top-level e chamar `log.setLevel()` diretamente se `log` é a função com método
`.setLevel()`.

### C14-OB02 — P5

**Sem autenticação nos endpoints `POST .../clear` e `POST .../flush`**

`POST /observability/errors/clear` e `POST /observability/audit/flush` são operações destrutivas sem
proteção de auth própria (depende do parent router).

## Destaques Positivos

- `GET /observability/errors` cap `Math.min(n, 100)` — protege contra tamanho excessivo
- `GET /observability/logs` cap `Math.min(n, 200)` — idem
- `GET /observability/audit-tail` cap `Math.max(..., 1)` e `Math.min(..., 500)` — robustez
- Múltiplos filtros (`sessionId`, `tool`, `type`, `source`, `level`) bem implementados
- Resposta `observability/health` consolida todos os subsistemas em uma única call

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
