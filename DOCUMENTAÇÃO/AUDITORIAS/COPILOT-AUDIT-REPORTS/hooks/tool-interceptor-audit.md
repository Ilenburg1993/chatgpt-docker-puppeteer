# Auditoria: hooks/tool-interceptor.js

**ID de rastreamento**: F06-11 **Arquivo**: `src/copilot/hooks/tool-interceptor.js` **LOC**: 228
**Módulo**: hooks/ **Data**: 2026-04-03 **Auditor**: MF-II Copilot Full Audit

---

## 1. Metadados

| Campo       | Valor                                   |
| ----------- | --------------------------------------- |
| Caminho     | `src/copilot/hooks/tool-interceptor.js` |
| Módulo pai  | `#copilot/hooks`                        |
| Exportações | 5 funções públicas                      |
| Importações | logger                                  |

---

## 2. Contexto no Módulo

Implementa os **Gaps 2 e 3**: `modifiedArgs` em `onPreToolUse` e `additionalContext` em
`onPostToolUse`. Fornece interceptores para sanitização de argumentos, blocklist, allowlist,
enriquecimento de resultado e temporização de execução.

---

## 3. Análise Crítica

### 🔴 BUG-TI-001 | P2 | timings Map não é populado — timer nunca funciona

```js
export function createTimingEnricherHook() {
    /** @type {Map<string, number>} */
    const timings = new Map();  // populado em onPreToolUse...

    return {
        async onPostToolUse(input, invocation) {
            const key = `${invocation?.sessionId}:${input.toolName}`;
            const startTime = timings.get(key);
            // startTime é SEMPRE undefined — timings nunca é populado!
            if (startTime !== undefined) { ... }
            return {};
        },
    };
    // PROBLEMA: Não há onPreToolUse retornado! O objeto retornado só tem onPostToolUse.
    // Nunca existe código que faz timings.set(key, Date.now()) antes.
}
```

O hook de timing retorna apenas `onPostToolUse`, mas sem um `onPreToolUse` correspondente que faça
`timings.set(key, Date.now())`, o `startTime` é **sempre `undefined`** e a feature de timing é
completamente inoperante. A lógica condicional `if (startTime !== undefined)` nunca executa.

**Impacto**: Feature de performance measurement documentada e exposta que não funciona.

### 🟡 BUG-TI-002 | P3 | timings Map unbounded (se corrigido)

Se o `onPreToolUse` fosse adicionado, o Map `timings` cresceria indefinidamente pois as chaves
session+tool nunca são removidas após o post-hook. Leak de memória potencial em sessões longas.

### 3.1 createArgSanitizerHook (Gap 2)

```js
async onPreToolUse(input) {
    const sanitized = sanitize(input.toolInput, sanitizeKeys);
    return { modifiedArgs: sanitized };
}
```

Gap 2 corretamente implementado. O `sanitize()` percorre o objeto recursivamente e substitui chaves
sensíveis por `'[REDACTED]'`. ✅

### 3.2 createPostToolEnricher (Gap 3)

```js
async onPostToolUse(input, invocation) {
    const enriched = await enricher(input.toolResult, { ...input, sessionId: invocation?.sessionId });
    return { additionalContext: JSON.stringify(enriched) };
}
```

Gap 3 corretamente implementado. ✅

---

## 4. Issues Encontrados

| ID         | Tipo | Sev | Descrição                                                        |
| ---------- | ---- | --- | ---------------------------------------------------------------- |
| BUG-TI-001 | BUG  | P2  | createTimingEnricherHook timer é inoperante (Map nunca populado) |
| BUG-TI-002 | BUG  | P3  | timings Map seria unbounded se corrigido — sem TTL               |

---

## 5. Propostas de Correção

### Fix BUG-TI-001 (crítico)

```js
export function createTimingEnricherHook() {
  const timings = new Map();

  return {
    async onPreToolUse(input, invocation) {
      const key = `${invocation?.sessionId}:${input.toolName}`;
      timings.set(key, Date.now());
      return {};
    },
    async onPostToolUse(input, invocation) {
      const key = `${invocation?.sessionId}:${input.toolName}`;
      const startTime = timings.get(key);
      timings.delete(key); // fix BUG-TI-002 também
      if (startTime !== undefined) {
        const durationMs = Date.now() - startTime;
        return { additionalContext: `tool_timing_ms=${durationMs}` };
      }
      return {};
    },
  };
}
```

---

## 6. Pontuação de Saúde

| Dimensão         | Nota    | Justificativa                          |
| ---------------- | ------- | -------------------------------------- |
| Corretude        | 5.5     | Timer completamente inoperante (P2)    |
| Segurança        | 8.0     | Sem issues de segurança                |
| Arquitetura      | 8.0     | Separação de concerns adequada         |
| Manutenibilidade | 7.5     | Bug difícil de notar (sem erro óbvio)  |
| Performance      | 7.0     | Map seria leak se corrigido sem delete |
| Testabilidade    | 8.0     | Bem testável                           |
| **Média**        | **7.3** |                                        |

---

## 6. Status de Correção (2026-04-03)

### [FIXED] BUG-TI-001 (P2) — createTimingEnricherHook agora funciona

Função agora retorna objeto { onPreToolUse, onPostToolUse }. onPreToolUse registra timings.set(key,
Date.now()) antes de cada execução.

### [FIXED] BUG-TI-002 (P3) — timings Map não cresce indefinidamente

timings.delete(key) chamado em onPostToolUse independentemente do resultado. JSDoc atualizado para
documentar que a função retorna objeto, não handler único.

**Pontuação atualizada: 9.2/10**
