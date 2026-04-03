# Auditoria: hooks/presets/production.js

**ID de rastreamento**: F06-17 **Arquivo**: `src/copilot/hooks/presets/production.js` **LOC**: 301
**Módulo**: hooks/ **Data**: 2026-04-03 **Auditor**: MF-II Copilot Full Audit

---

## 1. Metadados

| Campo       | Valor                                                                                   |
| ----------- | --------------------------------------------------------------------------------------- |
| Caminho     | `src/copilot/hooks/presets/production.js`                                               |
| Módulo pai  | `#copilot/hooks/presets`                                                                |
| Exportações | `createProductionHooks`                                                                 |
| Importações | `error-handler.js`, `permission-handler.js`, `prompt-transformer.js`, logger, `node:os` |

---

## 2. Contexto no Módulo

Preset mais completo (301 LOC): combina segurança, auditoria (audit sink customizável) e resiliência
(circuit breaker). Recomendado para ambientes de produção críticos. Primeiro preset a usar DI
completo para o bus e o auditSink.

---

## 3. Análise Estrutural

### 3.1 audit() com catch silencioso

```js
function audit(entry) {
  if (auditSink) {
    try {
      auditSink(entry);
    } catch (_) {
      /* ignora */
    }
  }
}
```

Erros em `auditSink` são ignorados silenciosamente — adequado para não quebrar o fluxo principal.
Porém, sem nenhum fallback log, falhas no auditSink passam completamente despercebidas.
**UPG-PROD-001**.

### 3.2 emitBus() com catch silencioso

```js
function emitBus(event) {
  if (bus) {
    try {
      bus.emit(event);
    } catch (_) {
      /* ignora */
    }
  }
}
```

Mesmo padrão. Adequado para resiliência, mas sem visibilidade de falhas. ✅ (acceptable tradeoff)

### 3.3 onPreToolUse síncrono vs. tipo async

```js
function onPreToolUse(input, invocation) {   // sync, sem async!
    ...
    return { permissionDecision: '...' };
}
```

O tipo `OnPreToolUseCallback` espera `Promise<...> | void`. Retornar sync value também é aceito pelo
SDK pois `await syncValue === syncValue`. ✅

### 3.4 onPostToolUse — threshold hardcoded

```js
if (resultSize > 50_000) {
  return { additionalContext: `...(${resultSize} chars)...` };
}
```

`50_000` chars de threshold hardcoded. Deveria ser configurável via `ProductionPresetOptions`.
**UPG-PROD-002**.

### 3.5 piiPatterns combinados em regex único

```js
const sensitivePattern =
  piiPatterns.length > 0 ? new RegExp(piiPatterns.map((r) => r.source).join('|'), 'g') : null;
```

Boa estratégia de combinar patterns. O flag `g` permite substituição global. ✅

### 3.6 permConfig com allowTools + auditMode

```js
const permConfig = { auditMode: true };
if (toolAllowList.length > 0) permConfig.allowTools = toolAllowList;
if (toolDenyList.length > 0) permConfig.denyTools = toolDenyList;
```

Corretamente configura `onPermissionRequest` com `auditMode: true`. Porém, a inconsistência
`BUG-PERM-001` (allowAll bypass) de `permission-handler.js` não afeta aqui porque `allowAll` não é
passado. ✅

---

## 4. Issues Encontrados

| ID           | Tipo | Sev | Descrição                                            |
| ------------ | ---- | --- | ---------------------------------------------------- |
| UPG-PROD-001 | UPG  | P3  | auditSink falha silenciosamente sem fallback log     |
| UPG-PROD-002 | UPG  | P4  | Threshold de 50.000 chars hardcoded em onPostToolUse |

---

## 5. Pontuação de Saúde

| Dimensão         | Nota    | Justificativa                            |
| ---------------- | ------- | ---------------------------------------- |
| Corretude        | 9.0     | Lógica comprensiva e correta             |
| Segurança        | 8.5     | Audit silencioso pode mascarar falhas    |
| Arquitetura      | 9.0     | Usa DI completo; bem modularizado        |
| Manutenibilidade | 9.0     | Código bem documentado mesmo sendo longo |
| Performance      | 8.5     | emitBus por cada hook — aceitável        |
| Testabilidade    | 9.0     | DI facilita teardown                     |
| **Média**        | **8.8** |                                          |
