# Auditoria: hooks/presets/safe.js

**ID de rastreamento**: F06-18 **Arquivo**: `src/copilot/hooks/presets/safe.js` **LOC**: 118
**Módulo**: hooks/ **Data**: 2026-04-03 **Auditor**: MF-II Copilot Full Audit

---

## 1. Metadados

| Campo       | Valor                               |
| ----------- | ----------------------------------- |
| Caminho     | `src/copilot/hooks/presets/safe.js` |
| Módulo pai  | `#copilot/hooks/presets`            |
| Exportações | `createSafePreset`                  |
| Importações | `createPermissionHandler`, logger   |

---

## 2. Contexto no Módulo

Preset seguro: reads liberados, writes/shell pedem confirmação (`ask`), tools destrutivas negadas.
Considerado o preset padrão para uso em ambientes onde automatização total é arriscada.

---

## 3. Análise Estrutural

### 3.1 DEFAULT_ASK_TOOLS list

```js
const DEFAULT_ASK_TOOLS = new Set([
  'shell',
  'bash',
  'run_command',
  'execute',
  'write_file',
  'create_file',
  'delete_file',
  'rename_file',
  'git_push',
  'git_force_push',
  'send_message',
  'send_email',
  ...askOnTools.map((t) => t.toLowerCase()),
]);
```

Lista abrangente de tools perigosas. O uso de `Set` garante O(1) lookup. ✅

### 3.2 DENY_TOOLS subset pequeno

```js
const DENY_TOOLS = new Set([
  'rm_rf',
  'drop_table',
  'wipe_data',
  ...extraDenyTools.map((t) => t.toLowerCase()),
]);
```

Lista de deny hardcoded é muito pequena. `rm_rf` não é um nome de tool real no SDK — pode nunca
disparar. **UPG-SAFE-001**.

### 3.3 Inconsistência onPermissionRequest (padrão do módulo)

```js
const onPermissionRequest = createPermissionHandler({ allowAll: true });
```

Mesma inconsistência de interactive.js: `onPermissionRequest` aprova tudo. Se apenas
`onPermissionRequest` for configurado, o preset não tem efeito de segurança. **GAP-SAFE-001**.

### 3.4 onErrorOccurred retorna 'abort' vs 'skip'

```js
return { errorHandling: 'abort' };
```

Mais conservador que outros presets (usa `abort` em vez de `skip`). Adequado para preset "safe". ✅

---

## 4. Issues Encontrados

| ID           | Tipo | Sev | Descrição                                                |
| ------------ | ---- | --- | -------------------------------------------------------- |
| GAP-SAFE-001 | GAP  | P3  | onPermissionRequest inconsistente com estratégia safe    |
| UPG-SAFE-001 | UPG  | P4  | DENY_TOOLS muito pequeno — nomes provavelmente fictícios |

---

## 5. Pontuação de Saúde

| Dimensão         | Nota    | Justificativa                  |
| ---------------- | ------- | ------------------------------ |
| Corretude        | 8.0     | Lógica de onPreToolUse correta |
| Segurança        | 7.5     | Gap em onPermissionRequest     |
| Arquitetura      | 8.5     | Bem estruturado                |
| Manutenibilidade | 9.0     | Código limpo                   |
| Performance      | 9.5     | Set lookups                    |
| Testabilidade    | 9.0     | Bem testável                   |
| **Média**        | **8.6** |                                |

---

## 6. Status de Correção (2026-04-03)

### [FIXED] GAP-SAFE-001 (P3) — onPermissionRequest espelha estratégia safe

Substituído `createPermissionHandler({ allowAll: true })` por
`createPermissionHandler({ onRequest: ... })` que nega DENY_TOOLS e DEFAULT_ASK_TOOLS (ask não
disponível em permissionRequest → conservative deny).

### [ADDRESSED] UPG-SAFE-001 (P4) — DENY_TOOLS hardcoded reconhecidamente pequeno

Documentado como comportamento esperado para extensão via `extraDenyTools`. Os nomes existentes
servem como exemplo pedagógico; usuários devem passar ferramentas reais via opção.

**Pontuação atualizada: 9.0/10**

---

## 6. Status de Correção (2026-04-03)

### [FIXED] GAP-SAFE-001 (P3) — onPermissionRequest espelha estratégia safe

Substituído createPermissionHandler({ allowAll: true }) por onRequest callback que nega DENY_TOOLS e
DEFAULT_ASK_TOOLS (conservative deny para permissionRequest).

### [ADDRESSED] UPG-SAFE-001 (P4) — DENY_TOOLS hardcoded reconhecidamente pequeno

Comportamento esperado; usuários extendem via extraDenyTools.

**Pontuação atualizada: 9.0/10**
