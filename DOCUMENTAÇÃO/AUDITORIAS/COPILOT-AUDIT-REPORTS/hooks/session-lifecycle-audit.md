# Auditoria: hooks/session-lifecycle.js

**ID de rastreamento**: F06-10 **Arquivo**: `src/copilot/hooks/session-lifecycle.js` **LOC**: 132
**Módulo**: hooks/ **Data**: 2026-04-03 **Auditor**: MF-II Copilot Full Audit

---

## 1. Metadados

| Campo       | Valor                                                              |
| ----------- | ------------------------------------------------------------------ |
| Caminho     | `src/copilot/hooks/session-lifecycle.js`                           |
| Módulo pai  | `#copilot/hooks`                                                   |
| Exportações | `createSessionHooks` (factory)                                     |
| Importações | `#copilot/observability` (logger, defaultMetrics, defaultAuditLog) |

---

## 2. Contexto no Módulo

Implementa o **Gap 4**: retorno de `additionalContext` em `onSessionStart`. Fornece os hooks de
ciclo de vida completos da sessão com DI via context object: `emitWebhook`, `getModel`,
`scheduleFallback`, `emit`, `getContextSnapshot`.

---

## 3. Análise Estrutural

### 3.1 Gap 4: additionalContext em onSessionStart

```js
async onSessionStart(input) {
    const snap = await ctx.getContextSnapshot?.();
    const extra = {
        sessionId: invocation?.sessionId,
        model: await ctx.getModel?.(),
        source: input.source,
        host: os.hostname(),
        nodeVersion: process.version,
        ...snap,
    };
    return { additionalContext: JSON.stringify(extra) };
}
```

Gap 4 implementado corretamente. ✅

### 3.2 Rate limit fallback com process.env direto

```js
async onErrorOccurred(input) {
    if (['rate_limit', 'quota'].includes(input.errorContext)) {
        const fallbackModel = process.env['COPILOT_FALLBACK_MODEL'];
        if (fallbackModel) await ctx.scheduleFallback?.(fallbackModel);
    }
    // ...
}
```

Acesso direto a `process.env` dentro do handler — deveria ser injetado via config/DI para
testabilidade. **UPG-SL-001**.

### 3.3 defaultMetrics e defaultAuditLog como singletons

Cada evento de sessão escreve diretamente nos singletons de observabilidade. Sem buffer ou throttle
— em sessões de alta frequência pode causar pressão de I/O no audit log. **P4**.

---

## 4. Issues Encontrados

| ID          | Tipo | Sev | Descrição                                                            |
| ----------- | ---- | --- | -------------------------------------------------------------------- |
| UPG-SL-001  | UPG  | P3  | process.env['COPILOT_FALLBACK_MODEL'] hardcoded — deveria vir via DI |
| ARCH-SL-001 | ARCH | P4  | Escrita direta em singletons defaultMetrics/defaultAuditLog          |

---

## 5. Pontuação de Saúde

| Dimensão         | Nota    | Justificativa                         |
| ---------------- | ------- | ------------------------------------- |
| Corretude        | 9.0     | Gap 4 correto, fallback funcional     |
| Segurança        | 8.5     | process.env acesso direto             |
| Arquitetura      | 7.5     | Singletons hardcoded, env direto      |
| Manutenibilidade | 8.5     | DI parcial — ctx injetado mas env não |
| Performance      | 8.5     | Audit sem buffer                      |
| Testabilidade    | 7.5     | process.env dificulta testes isolados |
| **Média**        | **8.3** |                                       |
