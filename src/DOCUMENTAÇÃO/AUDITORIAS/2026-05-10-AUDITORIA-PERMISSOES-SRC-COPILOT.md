# Auditoria Ampla — Permissões em `src/copilot`

> Data: 2026-05-10 Escopo: arquitetura de permissão, enforcement de camada (`hooks`), fluxos de
> decisão e hardening de fallback.

---

## 1) Decisão arquitetural consolidada

**Decisão:** `hooks/` é camada final. Nenhum módulo fora de `src/copilot/hooks/**` deve depender de
`#copilot/hooks` ou `hooks/**` via import relativo.

### Enforcement implementado

Foi adicionada a regra **F24** em `eslint.config.mjs`:

- alvo: `src/copilot/**/*.js`
- exceção: `src/copilot/hooks/**`
- detecção:
  - `^#copilot/hooks(?:$|/)`
  - `^(?:\.{1,2}/)+.*hooks(?:/|\.js$)`
- severidade atual: `error` (enforcement ativo)

---

## 2) Situação atual de dependências em hooks (runtime)

Estado após o lote atual: **0 violações runtime ativas** fora de `hooks/**`.

Resultado validado por:

- varredura de imports runtime em `src/copilot/**/*.js` para `#copilot/hooks` e `hooks/**`
- lint focal dos arquivos anteriormente infratores

---

## 3) Auditoria ampla de permissões (estado sistêmico)

### 3.1 Fontes de decisão de permissão identificadas

1. **SDK canonical handler**: `src/copilot/sdk/session/permissions.js`
   - `createPermissionHandler()`
   - `createAllowlistPermissionHandler()`
   - `approveAll` (re-export canônico)
2. **Controller de modo operacional**: `PermissionController`
   - modo `approve_all`, `audit_only`, `selective`
3. **Hooks pre-tool decision** (decisão antecipada): `permissionDecision` em `onPreToolUse`
4. **Handler formal de permissão do SDK**: `onPermissionRequest`
5. **Rota RPC/UI para pending permissions**: `sdk/rpc/ops.js`, rotas HTTP `server/routes/sdk/*`
6. **Pipeline de auditoria**: `audit/pipeline-permission.js`

### 3.2 Riscos observados

- Risco histórico de **fallback permissivo implícito** em auditoria de permissão (approve-all em
  erro).
- Acoplamento do runtime de policy com camada hooks (`agent/ports/permission-port`), agora reduzido.
- Múltiplos pontos de decisão (`onPreToolUse` + `onPermissionRequest`) ainda sem avaliador único
  compartilhado por preset.

---

## 4) Correções e upgrades aplicados nesta execução

1. **Fail-closed em auditoria de permissão**
   - `src/copilot/audit/pipeline-permission.js`
   - ausência/erro no `baseHandler` agora resulta em `reject`, não `approve-all`.

2. **Fonte canônica de `approveAll` padronizada**
   - `src/copilot/sdk/config.js`
   - `src/copilot/sdk/session/lifecycle.js`
   - ambos agora dependem da camada canônica `sdk/session/permissions.js`.

3. **PermissionController promovido para SDK**
   - novo: `src/copilot/sdk/session/permission-controller.js`
   - `src/copilot/sdk/index.js` exporta `PermissionController`.
   - `src/copilot/agent/ports/permission-port.js` migrou para `#copilot/sdk`.
   - `src/copilot/hooks/permission-controller.js` virou compat layer de re-export.

4. **Policy configurável de default decision**
   - `src/copilot/sdk/session/permissions.js`
   - adicionado `defaultDecision: 'allow' | 'deny'` no `PermissionHandlerConfig`.

5. **Enforcement arquitetural hooks-final-layer (lint)**
   - regra F24 adicionada e validada em arquivos infratores.

6. **Migração de runtime de hooks para superfícies neutras**
   - novos módulos canônicos: `sdk/session/hook-bus`, `sdk/session/hook-registry`,
     `sdk/session/hook-logger`, `audit/hook-audit-trail`.
   - módulos legados em `hooks/*` convertidos para compat re-export.
   - consumers fora de hooks migrados para `#copilot/sdk` / `#copilot/audit`.

---

## 5) Padronizações recomendadas (próximo lote)

### P1 — Consolidação de decisão única por preset

Criar um avaliador comum por preset (ex.: `evaluateToolPermission(tool,args,ctx)`), usado por:

- `onPreToolUse`
- `onPermissionRequest`

Objetivo: eliminar drift semântico entre “pré-decisão” e “decisão formal de permissão”.

### P1 — Consolidação de semântica de decisão

Unificar as decisões de permissão entre `onPreToolUse` e `onPermissionRequest` com avaliador
canônico compartilhado por preset/perfil.

### P2 — Hardening contínuo da F24

- Estado atual: `error`
- Próximo foco: manter zero violações e impedir regressões em novos módulos.

---

## 6) Critério de conclusão da decisão arquitetural

A decisão “nenhuma parte de `src/copilot` depende de hooks” será considerada concluída quando:

1. Regra F24 em `error`;
2. `grep` de imports runtime para `#copilot/hooks` e `hooks/**` fora de `hooks/**` retorna zero;
3. módulos de runtime (`bootstrap/observability/server/agent`) sem dependência direta de `hooks/*`.

Status atual destes critérios: **atingido**.
