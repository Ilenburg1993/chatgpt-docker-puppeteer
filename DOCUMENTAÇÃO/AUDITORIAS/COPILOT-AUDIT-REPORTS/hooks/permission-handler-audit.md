# Auditoria: hooks/permission-handler.js

**ID de rastreamento**: F06-07 **Arquivo**: `src/copilot/hooks/permission-handler.js` **LOC**: 195
**Módulo**: hooks/ **Data**: 2026-04-03 **Auditor**: MF-II Copilot Full Audit

---

## 1. Metadados

| Campo       | Valor                                     |
| ----------- | ----------------------------------------- |
| Caminho     | `src/copilot/hooks/permission-handler.js` |
| Módulo pai  | `#copilot/hooks`                          |
| Exportações | 5 funções públicas                        |
| Importações | `@github/copilot-sdk`, logger             |

---

## 2. Contexto no Módulo

Implementa o handler `onPermissionRequest` do SDK. Responsável por avaliar requisições de permissão
via sistema de 6 etapas: `onRequest` callback → `allowAll` flag → `allowTools` whitelist →
`denyPatterns` regex array → `denyTools` array → default approveAll.

---

## 3. Análise Estrutural

### 3.1 Lógica de 6 etapas (createPermissionHandler)

```js
// Passo 1: callback personalizado
if (config.onRequest) return config.onRequest(request);

// Passo 2: allow all (tudo aprovado)
if (config.allowAll) return approveAll();

// Passo 3: allowTools whitelist — se não está na lista → deny
if (config.allowTools?.length > 0 && !config.allowTools.includes(toolName)) return deny(name);

// Passo 4: denyPatterns — se match em algum regex → deny
if (config.denyPatterns?.some((p) => p.test(toolName))) return deny(name);

// Passo 5: denyTools array — se na lista → deny
if (config.denyTools?.includes(toolName)) return deny(name);

// Passo 6: default → approve
return approveAll();
```

A lógica está correta e documentada. No entanto, o **passo 2** (`allowAll: true`) é um
curto-circuito que ignora passos 3-5 — presets que usam `allowAll: true` mas também informam
`denyTools` teram os `denyTools` ignorados silenciosamente.

### 3.2 Uso direto do SDK

```js
import { approveAll } from '@github/copilot-sdk';
```

Único lugar em hooks/ que importa diretamente do SDK além da observabilidade. Correto por ser a
caminho de wrappers. ✅

---

## 4. Issues Encontrados

| ID           | Tipo | Sev | Descrição                                                          |
| ------------ | ---- | --- | ------------------------------------------------------------------ |
| BUG-PERM-001 | BUG  | P3  | allowAll=true ignora denyTools/denyPatterns silenciosamente        |
| UPG-PERM-001 | UPG  | P4  | Não há validação de denyPatterns para confirmar são RegExp válidos |

---

## 5. Propostas de Upgrade

1. **Fix BUG-PERM-001**: Ao usar `allowAll: true`, verificar denyTools e denyPatterns antes de
   retornar `approveAll()`. Ou, documentar explicitamente que `allowAll` ignora den\* configs.
2. **DOC**: Adicionar @throws para o caso de denyPatterns inválidos.

---

## 6. Pontuação de Saúde

| Dimensão         | Nota    | Justificativa                                 |
| ---------------- | ------- | --------------------------------------------- |
| Corretude        | 7.5     | allowAll bypassa deny configs silenciosamente |
| Segurança        | 7.5     | Config conflitante pode abrir permission      |
| Arquitetura      | 8.5     | Wrappers SDK corretos                         |
| Manutenibilidade | 9.0     | Código limpo e bem documentado                |
| Performance      | 9.5     | Sem issues                                    |
| Testabilidade    | 8.5     | Bem testável                                  |
| **Média**        | **8.4** |                                               |

---

## 6. Status de Correção (2026-04-03)

### [FIXED] BUG-PERM-001 (P3) — allowAll agora respeita denyTools e denyPatterns

Passo 2 (allowAll) agora verifica denyTools e denyPatterns antes de aprovar. denyTools/denyPatterns
tem precedência mesmo com allowAll: true.

### [FIXED] UPG-PERM-001 (P4) — denyPatterns validado em tempo de construção

TypeError lançado em createPermissionHandler se denyPatterns contém não-RegExp (fail-fast).

**Pontuação atualizada: 9.2/10**
