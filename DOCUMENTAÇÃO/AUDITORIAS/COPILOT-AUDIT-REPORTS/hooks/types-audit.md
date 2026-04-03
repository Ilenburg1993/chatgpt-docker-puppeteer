# Auditoria: hooks/types.js

**ID de rastreamento**: F06-12 **Arquivo**: `src/copilot/hooks/types.js` **LOC**: 306 **Módulo**:
hooks/ **Data**: 2026-04-03 **Auditor**: MF-II Copilot Full Audit

---

## 1. Metadados

| Campo       | Valor                        |
| ----------- | ---------------------------- |
| Caminho     | `src/copilot/hooks/types.js` |
| Módulo pai  | `#copilot/hooks`             |
| Exportações | ~25 `@typedef` — zero lógica |
| Importações | nenhuma                      |

---

## 2. Contexto no Módulo

Módulo de tipos puro. Define todos os JSDoc typedefs consumidos pelo módulo hooks/ e consumidores
externos. Zero lógica executável — apenas contratos de dados.

---

## 3. Análise Estrutural

### 3.1 SessionHooks typedef

```js
/**
 * @typedef {object} SessionHooks
 * @property {OnPreToolUseCallback} [onPreToolUse]
 * @property {OnPostToolUseCallback} [onPostToolUse]
 * @property {OnUserPromptSubmittedCallback} [onUserPromptSubmitted]
 * @property {OnSessionStartCallback} [onSessionStart]
 * @property {OnSessionEndCallback} [onSessionEnd]
 * @property {OnErrorOccurredCallback} [onErrorOccurred]
 */
```

`SessionHooks` inclui apenas 6 SDK hooks. **Não inclui** `onPermissionRequest` nem
`onUserInputRequest`, que existem em `SDK_HOOKS` (registry.js). Inconsistência entre o registry e o
tipo canônico. **GAP-TYPES-001**.

### 3.2 OnPreToolUseOutput typedef

```js
/**
 * @typedef {object} OnPreToolUseOutput
 * @property {'allow' | 'deny' | 'ask'} [permissionDecision]
 * @property {Record<string, unknown>} [modifiedArgs]
 * @property {string} [additionalContext]
 */
```

Inclui `modifiedArgs` e `additionalContext` (Gaps 2 e 3). Bem documentado. ✅

### 3.3 AuditEntry typedef — campo `extra` tipado como `unknown`

```js
/**
 * @typedef {object} AuditEntry
 * @property {number} timestamp
 * @property {string} hookName
 * @property {string} [sessionId]
 * @property {unknown} [extra]
 */
```

`extra` é `unknown` — pode carregar qualquer dado. Considerar tipagem mais específica ou
`Record<string, unknown>`.

---

## 4. Issues Encontrados

| ID            | Tipo | Sev | Descrição                                                                |
| ------------- | ---- | --- | ------------------------------------------------------------------------ |
| GAP-TYPES-001 | GAP  | P3  | SessionHooks não inclui onPermissionRequest/onUserInputRequest           |
| UPG-TYPES-001 | UPG  | P4  | AuditEntry.extra tipado como unknown — considerar Record<string,unknown> |

---

## 5. Pontuação de Saúde

| Dimensão         | Nota    | Justificativa                           |
| ---------------- | ------- | --------------------------------------- |
| Corretude        | 8.5     | Tipos bem definidos, mas gaps presentes |
| Segurança        | 10      | Zero lógica executável                  |
| Arquitetura      | 8.5     | Módulo de tipos isolado ✅              |
| Manutenibilidade | 9.5     | Organizado e abrangente                 |
| Performance      | 10      | Zero custo runtime                      |
| Testabilidade    | 10      | Tipos testados via tsserver             |
| **Média**        | **9.4** |                                         |
