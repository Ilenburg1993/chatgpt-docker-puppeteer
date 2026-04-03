# Auditoria — `error-tracker.js`

**Módulo**: `src/copilot/observability/error-tracker.js` **LOC**: 232 **Data**: 2026-06-10
**Auditor**: Copilot Full-Audit MF-II

---

## 1. Propósito

Registro centralizado de erros para `src/copilot` com:

- Ring buffer dos últimos N erros (padrão 100) com contexto completo (`message`, `stack`,
  `errorType`, `source`, `sessionId`, `toolName`, `metadata`)
- Handlers opcionais para `uncaughtException` / `unhandledRejection` no processo Node.js
- Contagem por tipo de erro (`_byType`) e por source (`_bySource`)
- API: `trackError()`, `getErrors()`, `getStats()`, `clearErrors()`, `registerGlobalHandlers()`,
  `destroy()`
- `extractErrorInfo(err)`: suporta `Error`, string, ou qualquer valor

---

## 2. Arquitetura interna

```
createErrorTracker(opts)
├── _buffer: ErrorEntry[]         ← ring buffer, max opts.maxRecords (padrão 100)
├── _totalRegistered: number      ← contador que ultrapassa o buffer (não é resetado por shift)
├── _byType: Record<string, n>    ← contagem por errorType (Error.constructor.name)
├── _bySource: Record<string, n>  ← contagem por source
├── _uncaughtHandler / _rejectionHandler  ← handlers globais opcionais
```

---

## 3. Achados

### FINDING-P5-1 — `getErrors(n, filterSource)` filtra antes de fatiar

**Severidade**: P5 — Baixo **Localização**: `getErrors()` (~linha 165)

```js
function getErrors(n = 20, filterSource) {
  const buf = filterSource ? _buffer.filter((e) => e.source === filterSource) : _buffer;
  return buf.slice(-n); // n aplicado após filtro
}
```

Se `filterSource` retornar apenas 3 entradas e `n = 20`, o retorno terá apenas 3 itens — esperado
pelo consumidor que pediu 20. Mas se o consumidor espera "as últimas 20 entradas que tenham
source=X", o comportamento é correto. O problema é que não está documentado que `n` se aplica ao
resultado filtrado, não ao buffer completo.

**Proposta**: Documentar explicitamente no JSDoc:

```js
/**
 * @param {number} [n=20] - Máximo de entradas a retornar (pós-filtro). Default is `20`
 * @param {string} [filterSource] - Se definido, retorna apenas erros desta fonte.
 * @returns {ErrorEntry[]}
 */
```

---

### FINDING-P5-2 — `_totalRegistered` não é resetado por `clearErrors()`

**Severidade**: P5 — Cosmético **Localização**: `clearErrors()` (~linha 175)

```js
function clearErrors() {
    _buffer.length = 0;
    _totalRegistered = 0;  // ← É resetado
    Object.keys(_byType).forEach(...);
    Object.keys(_bySource).forEach(...);
}
```

Verificação: `_totalRegistered` é de fato zerado em `clearErrors()`. Não é um bug. Porém, o
`_idCounter` (variável de módulo) **não** é resetado — IDs continuam únicos globalmente mesmo após
`clearErrors()`. Isso é o correto, mas pode confundir ao inspecionar: `getStats().total = 0` mas
novos erros terão IDs com contadores altos (ex: `err-1234567890-150`).

---

### FINDING-P5-3 — `registerGlobalHandlers()` pode ser chamado múltiplas vezes sem proteção completa

**Severidade**: P5 — Baixo **Localização**: `registerGlobalHandlers()` (~linha 195)

```js
function registerGlobalHandlers() {
  if (_uncaughtHandler) return; // Já registrado — proteção OK
  // ...
  process.on('uncaughtException', _uncaughtHandler);
  process.on('unhandledRejection', _rejectionHandler);
}
```

A proteção `if (_uncaughtHandler) return` garante idempotência por instância. Porém, se múltiplas
instâncias de `createErrorTracker({ registerGlobalHandlers: true })` forem criadas, cada uma
adiciona seus próprios handlers globais. Em caso de `uncaughtException`, todos os trackers receberão
o erro — redundância não-intencional.

O singleton `defaultErrorTracker` não registra handlers globais (`registerGlobalHandlers: false`) —
comportamento correto para evitar este problema.

**Proposta**: Documentar que handlers globais devem ser registrados em no máximo uma instância.

---

### FINDING-P5-4 — `destroy()` não faz cleanup completo de referências circulares

**Severidade**: P5 — Cosmético **Localização**: `destroy()` (~linha 210)

`destroy()` remove listeners do processo e chama `clearErrors()`. Porém, a função closure
`trackError` / `getErrors` ainda mantém referência para `_buffer`, `_byType`, `_bySource`. Isso é
correto (o objeto retornado por `createErrorTracker` tem lifetime esperado), mas objetos que retêm
referência ao tracker e não chamam `destroy()` podem impedir GC.

Para o singleton `defaultErrorTracker`, isso nunca é problema (alive for process lifetime).

---

## 4. Pontos positivos

- **`extractErrorInfo(err)`** trata `Error`, string e objetos arbitrários — robusto para uso em
  handlers `_safe()` do agente.
- **`source` no `trackError`** permite triagem por origem (tool, sdk, uncaughtException, etc.).
- **`getStats().last`** expõe o erro mais recente diretamente — conveniente para dashboards.
- **`autoRegister: false`** por padrão no singleton — não polui handlers globais sem intenção.
- Ring buffer ordena por inserção (mais recente último) → `getErrors()` com `slice(-n)` retorna os
  mais recentes corretamente.
- `destroy()` usa `process.off()` (correto) — não acumula handlers em cleanup.

---

## 5. Score

| Dimensão        | Nota     |
| --------------- | -------- |
| Correção lógica | 9/10     |
| API e JSDoc     | 9/10     |
| Robustez        | 9/10     |
| Completude      | 9/10     |
| **Global**      | **9/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
