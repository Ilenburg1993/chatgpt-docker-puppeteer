# Auditoria: hooks/presets/deny-all.js

**ID de rastreamento**: F06-14 **Arquivo**: `src/copilot/hooks/presets/deny-all.js` **LOC**: 77
**Módulo**: hooks/ **Data**: 2026-04-03 **Auditor**: MF-II Copilot Full Audit

---

## 1. Metadados

| Campo       | Valor                                   |
| ----------- | --------------------------------------- |
| Caminho     | `src/copilot/hooks/presets/deny-all.js` |
| Módulo pai  | `#copilot/hooks/presets`                |
| Exportações | `createDenyAllPreset`                   |
| Importações | `createPermissionHandler`, logger       |

---

## 2. Contexto no Módulo

Preset que bloqueia todas as tools. Retorna `{ hooks, onPermissionRequest }` onde ambos devem
funcionar em tandem para bloquear ferramentas em todos os pontos de interceptação.

---

## 3. Análise Crítica

### 🔴 BUG-DA-001 | P2 | onPermissionRequest NÃO nega tools

```js
const onPermissionRequest = createPermissionHandler({
  allowAll: false,
  denyTools: [], // lista de deny VAZIA!
});
```

`createPermissionHandler({ allowAll: false, denyTools: [] })` cai no path da lógica:

- `allowAll = false` → não aprova tudo
- `allowTools` → undefined → pula
- `denyPatterns` → undefined → pula
- `denyTools` → `[]` (vazio) → pula
- **Default**: aprova!

`onPermissionRequest` retorna `approve` para TUDO. O "deny-all" só funciona se `hooks.onPreToolUse`
for usado. Se apenas `onPermissionRequest` for configurado (uso comum em alguns integrações),
NENHUMA tool será negada.

**Typo na JSDoc**: `"bloqueia todass as tools"` (duplo 's').

### 3.1 onPreToolUse correto

```js
const hooks = {
  async onPreToolUse(input) {
    if (exceptTools.includes(input.toolName)) return { permissionDecision: 'allow' };
    return { permissionDecision: 'deny', additionalContext: 'blocked' };
  },
};
```

`onPreToolUse` funciona corretamente. `exceptTools` é aplicado apenas aqui, não em
`onPermissionRequest`. Para bloquear via `exceptTools` nos dois pontos, seria necessário passar
`allowTools: exceptTools` ao `createPermissionHandler`.

---

## 4. Issues Encontrados

| ID         | Tipo | Sev | Descrição                                                        |
| ---------- | ---- | --- | ---------------------------------------------------------------- |
| BUG-DA-001 | BUG  | P2  | onPermissionRequest de deny-all approva tudo — contradição fatal |
| BUG-DA-002 | BUG  | P4  | Typo na JSDoc: "todass"                                          |
| GAP-DA-001 | GAP  | P3  | exceptTools não aplicado em onPermissionRequest                  |

---

## 5. Proposta de Correção

```js
// Corrigido:
const onPermissionRequest = createPermissionHandler({
  allowAll: false,
  allowTools: exceptTools.length > 0 ? exceptTools : undefined,
  // Se exceptTools vazio → allowTools undefined → cai no default deny
});
// Mas wait: com allowTools: undefined e allowAll: false → default aprova!
// A solução correta:
const onPermissionRequest = createPermissionHandler({
  allowTools: exceptTools.length > 0 ? exceptTools : ['__NENHUMA_TOOL_EXISTE__'],
  // allowTools com lista não-vazia que exclui tudo → deny para tools não na lista
});
```

---

## 6. Pontuação de Saúde

| Dimensão         | Nota    | Justificativa                             |
| ---------------- | ------- | ----------------------------------------- |
| Corretude        | 4.0     | onPermissionRequest semanticamente oposto |
| Segurança        | 4.5     | Falsa sensação de segurança               |
| Arquitetura      | 7.5     | Estrutura do preset ok                    |
| Manutenibilidade | 7.0     | Typo na doc, lógica confusa               |
| Performance      | 9.5     | Sem issues                                |
| Testabilidade    | 8.0     | Testável                                  |
| **Média**        | **6.8** |                                           |

---

## 6. Status de Correção (2026-04-03)

### [FIXED] BUG-DA-001 (P2) — onPermissionRequest agora nega corretamente

**Correção aplicada**: Substituído `createPermissionHandler({ allowAll: false, denyTools: [] })` por
lógica bifurcada:

- Se `exceptTools` não-vazio → `createPermissionHandler({ allowTools: exceptTools })` (whitelist)
- Se `exceptTools` vazio → `createPermissionHandler({ onRequest: (_) => false })` (deny-all
  incondicional)

**Arquivo**: `src/copilot/hooks/presets/deny-all.js`

### [FIXED] BUG-DA-002 (P4) — Typo "todass" corrigido

**Correção**: Corrigido na linha 5 do JSDoc (`todass` → `todas`).

### [FIXED] GAP-DA-001 (P3) — exceptTools agora aplicado em onPermissionRequest

**Correção**: `allowed` Set (existente de `exceptTools`) agora é usado na lógica de
`onPermissionRequest`, garantindo consistência entre os dois interceptores.

### Pontuação atualizada: 9.0/10 (era 6.8)

---

## 6. Status de Correção (2026-04-03)

### [FIXED] BUG-DA-001 (P2) — onPermissionRequest nega corretamente

Substituído `createPermissionHandler({ allowAll: false, denyTools: [] })` por lógica bifurcada:

- `exceptTools` não-vazio → allowTools whitelist
- `exceptTools` vazio → onRequest callback que retorna false incondicionalmente

### [FIXED] BUG-DA-002 (P4) — Typo "todass" corrigido

### [FIXED] GAP-DA-001 (P3) — exceptTools aplicado em onPermissionRequest via allowed Set

**Pontuação atualizada: 9.0/10**

---

## 6. Status de Correção (2026-04-03)

### [FIXED] BUG-DA-001 (P2) — onPermissionRequest nega corretamente

Substituído createPermissionHandler({ allowAll: false, denyTools: [] }) por lógica bifurcada:

- exceptTools não-vazio → allowTools whitelist estrita
- exceptTools vazio → onRequest callback que retorna false incondicionalmente

### [FIXED] BUG-DA-002 (P4) — Typo "todass" corrigido

### [FIXED] GAP-DA-001 (P3) — exceptTools aplicado em onPermissionRequest via Set

**Pontuação atualizada: 9.0/10**
