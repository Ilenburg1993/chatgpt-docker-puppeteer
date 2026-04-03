# Auditoria: hooks/presets/interactive.js

**ID de rastreamento**: F06-15 **Arquivo**: `src/copilot/hooks/presets/interactive.js` **LOC**: 108
**Módulo**: hooks/ **Data**: 2026-04-03 **Auditor**: MF-II Copilot Full Audit

---

## 1. Metadados

| Campo       | Valor                                      |
| ----------- | ------------------------------------------ |
| Caminho     | `src/copilot/hooks/presets/interactive.js` |
| Módulo pai  | `#copilot/hooks/presets`                   |
| Exportações | `createInteractivePreset`                  |
| Importações | `createPermissionHandler`, logger          |

---

## 2. Contexto no Módulo

Preset interativo: onPreToolUse retorna `'ask'` para tools não categorizadas, delegando aprovação ao
usuário via `onUserInputRequest`. Adequado para modo supervisionado.

---

## 3. Análise Estrutural

### 3.1 autoAllow com hardcoded defaults

```js
const autoAllow = new Set([
  'read_file',
  'list_dir',
  'grep_search',
  'file_search',
  'semantic_search',
  'search_files',
  ...autoAllowTools.map((t) => t.toLowerCase()),
]);
```

Lista hardcoded de read-only tools. Adequado. O spread de `autoAllowTools` permite extensão. ✅

### 3.2 Inconsistência onPermissionRequest

```js
const onPermissionRequest = createPermissionHandler({ allowAll: true });
```

`allowAll: true` aprova tudo em `onPermissionRequest`. Mas `onPreToolUse` pode retornar `'ask'`. Se
apenas `onPermissionRequest` for configurado (sem `hooks`), todas as tools são aprovadas — o preset
não é "interativo" nesse cenário. **GAP-INTER-001** (mesmo padrão de deny-all.js).

### 3.3 Recuperação de erros

```js
if (input.recoverable) return { errorHandling: 'retry', retryCount: 1 };
return { errorHandling: 'skip' };
```

`retryCount: 1` é razoável para modo supervisionado. ✅

---

## 4. Issues Encontrados

| ID            | Tipo | Sev | Descrição                                             |
| ------------- | ---- | --- | ----------------------------------------------------- |
| GAP-INTER-001 | GAP  | P3  | onPermissionRequest inconsistente com modo interativo |

---

## 5. Pontuação de Saúde

| Dimensão         | Nota    | Justificativa                     |
| ---------------- | ------- | --------------------------------- |
| Corretude        | 8.0     | onPreToolUse ok, onPermission gap |
| Segurança        | 7.5     | Gap na segunda linha de defesa    |
| Arquitetura      | 8.5     | Bem organizado                    |
| Manutenibilidade | 9.0     | Código limpo                      |
| Performance      | 9.5     | Set lookup O(1)                   |
| Testabilidade    | 9.0     | Bem testável                      |
| **Média**        | **8.6** |                                   |

---

## 6. Status de Correção (2026-04-03)

### [FIXED] GAP-INTER-001 (P3) — onPermissionRequest espelha lógica do onPreToolUse

Substituído `createPermissionHandler({ allowAll: true })` por
`createPermissionHandler({ onRequest: ... })` que avalia autoDeny/autoAllow e retorna false
conservador para tools não categorizadas (ask não disponível em onPermissionRequest).

**Pontuação atualizada: 9.0/10**

---

## 6. Status de Correção (2026-04-03)

### [FIXED] GAP-INTER-001 (P3) — onPermissionRequest espelha lógica do onPreToolUse

Substituído createPermissionHandler({ allowAll: true }) por onRequest callback que avalia
autoDeny/autoAllow e retorna false conservador para tools não categorizadas.

**Pontuação atualizada: 9.0/10**
