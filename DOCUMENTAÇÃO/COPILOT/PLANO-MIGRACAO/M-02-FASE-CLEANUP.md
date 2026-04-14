# M-02 — Fase 1: Cleanup & Quick Wins

**Data**: 2026-03-21
**Versão**: 1.0
**Pré-requisito**: Nenhum (pode iniciar imediatamente)
**Estimativa**: ~12h
**Risco**: Baixo
**Consolida**: Faixa L1 + J2 (parcial) + G4 (parcial) + C4 (parcial)

---

## 1. Contexto e Motivação

Esta fase elimina duplicações óbvias, código morto e módulos mal-posicionados.
São mudanças de baixo risco que reduzem ruído e simplificam a base antes das
refatorações mais profundas das fases 2-5.

### Métricas antes → depois

| Métrica | Antes | Depois |
|---------|-------|--------|
| Módulos toplevel | 21 | 18 (-3) |
| Arquivos | 408 | ~385 (-23) |
| Linhas | ~62k | ~59.5k (-2.5k) |
| Duplicações funcionais | 7 | 4 (-3) |

### Problemas resolvidos

- **P8 (🟡)**: `api/` obsoleto duplica `server/` → **ELIMINADO**
- **P7 (🟡)**: `services/` sem propósito → **ELIMINADO**
- **P2 (🔴, parcial)**: `agent/` desproporcional → configs e infra movidos para módulos corretos

---

## 2. Inventário de Arquivos Afetados

### Grupo A: Eliminar `api/` (10 arquivos, -1.937L)

| Arquivo | Linhas | Ação | Destino |
|---------|--------|------|---------|
| `api/express/agent.js` | 235 | DELETAR | Funcionalidade já existe em `server/routes/agent.js` |
| `api/express/client.js` | 222 | DELETAR | Funcionalidade já existe em `server/routes/copilot-api/control.js` |
| `api/express/hooks.js` | 120 | AVALIAR | Se endpoints únicos, migrar para `server/routes/`; senão deletar |
| `api/express/index.js` | 65 | DELETAR | Setup Express duplicado |
| `api/express/middleware.js` | 90 | DELETAR | `server/middleware/` é canônico |
| `api/express/observability.js` | 336 | AVALIAR | Migrar endpoints únicos para `server/routes/observability.js` |
| `api/express/session-crud.js` | 350 | DELETAR | `server/routes/sessions.js` + `server/routes/copilot-api/` cobrem |
| `api/express/session-messaging.js` | 300 | DELETAR | `server/routes/copilot-api/dialog.js` cobre |
| `api/express/session-middleware.js` | 161 | DELETAR | `server/middleware/` é canônico |
| `api/express/sessions.js` | 58 | DELETAR | Barrel desnecessário |

### Grupo B: Eliminar `services/` (6 arquivos, -547L)

| Arquivo | Linhas | Ação | Migração de consumers |
|---------|--------|------|----------------------|
| `services/audit-service.js` | 118 | DELETAR | 1 consumer (`api/express/observability.js`) — será deletado junto |
| `services/conversation-service.js` | 88 | DELETAR | 1 consumer (`server/routes/copilot-api/control.js`) → importar de `#copilot/conversation-hub` |
| `services/di-tokens.js` | 9 | DELETAR | Nenhum consumer externo |
| `services/index.js` | 35 | DELETAR | Re-exports migram para consumers diretos |
| `services/session-service.js` | 209 | DELETAR | 3 consumers (`api/express/` — serão deletados) |
| `services/tool-service.js` | 88 | DELETAR | 1 consumer (`api/express/index.js` — será deletado) |

**Consumers de re-exports de `services/index.js`** que precisam ser atualizados:

| Consumer | Import atual | Import novo |
|----------|-------------|-------------|
| `server/routes/copilot-api/control.js` | `from '#copilot/services'` → `CHANNEL_VERSION, createConversationService` | `from '#copilot/channel'` + `from '#copilot/conversation-hub'` |
| `terminal/dialog/sse.js` | `from '#copilot/services'` → `broadcastGlobal, broadcastToSession` | `from '#copilot/conversation-hub'` |
| `terminal/dialog/engine.js` | `from '#copilot/services'` → `llmBridgeClient` | `from '#copilot/channel'` |
| `terminal/handlers/system-config.js` | `from '#copilot/services'` → `setBackgroundCompactionThreshold` | `from '#copilot/agent'` |
| `terminal/commands/context.js` | `from '#copilot/services'` → `llmBridgeClient` | `from '#copilot/channel'` |
| `terminal/commands/export.js` | `from '#copilot/services'` → `llmBridgeClient` | `from '#copilot/channel'` |
| `terminal/commands/metrics.js` | `from '#copilot/services'` → `llmBridgeClient` | `from '#copilot/channel'` |
| `terminal/commands/session.js` | `from '#copilot/services'` | `from '#copilot/agent'` + `from '#copilot/channel'` (ver exports usados) |

### Grupo C: Mover `agent/config.js` → `config/agent.js` (1 arquivo)

| Origem | Destino | Linhas | Ação |
|--------|---------|--------|------|
| `agent/config.js` | `config/agent.js` | 205 | MOVER + atualizar imports |

### Grupo D: Mover contratos de `sdk/agent/` → `types/contracts/` (3 arquivos)

| Origem | Destino | Linhas | Ação |
|--------|---------|--------|------|
| `sdk/agent/contract.js` | `types/contracts/contract.js` | 77 | MOVER |
| `sdk/agent/bridge-contract.js` | `types/contracts/bridge-contract.js` | 56 | MOVER |
| `sdk/agent/channel-contract.js` | `types/contracts/channel-contract.js` | 56 | MOVER |

### Grupo E: Mover itens de `agent/infra/` para módulos corretos (4 arquivos)

| Origem | Destino | Linhas | Ação |
|--------|---------|--------|------|
| `agent/infra/webhook-manager.js` | `infra/webhooks.js` | 233 | MOVER |
| `agent/infra/permission-controller.js` | `hooks/permission-controller.js` | 156 | MOVER |
| `agent/infra/tools-bootstrap.js` | `tools/bootstrap.js` | 137 | MOVER |
| `agent/infra/status-snapshot.js` | `observability/snapshots.js` | 103 | MOVER |

### Grupo F: Deprecar `sdk/config.js::buildSessionConfig` (1 arquivo)

| Arquivo | Ação |
|---------|------|
| `sdk/config.js` | Adicionar `@deprecated` JSDoc + log WARN na chamada |

---

## 3. Passos de Execução

### P01 — Auditar endpoints exclusivos de `api/` (1h)

**O que fazer**: Comparar cada endpoint de `api/express/` com `server/routes/` para identificar
funcionalidade que existe APENAS em `api/` e precisa ser migrada.

```bash
# Listar todas as rotas em api/
grep -n "router\.\(get\|post\|put\|delete\|patch\)" src/copilot/api/express/*.js

# Listar todas as rotas em server/
grep -rn "router\.\(get\|post\|put\|delete\|patch\)" src/copilot/server/routes/
```

**Validação**: Lista de endpoints a migrar vs. a deletar.
**Rollback**: Nenhuma mudança ainda.

### P02 — Migrar endpoints exclusivos de `api/` para `server/routes/` (2h)

**O que fazer**: Para cada endpoint exclusivo identificado em P01, criar o handler correspondente
em `server/routes/`. Manter a mesma assinatura de request/response.

**Validação**:
```bash
npm run lint
npm run test:unit
```

**Rollback**: `git checkout -- src/copilot/server/`

### P03 — Atualizar consumers de `services/` (1h)

**O que fazer**: Para cada consumer listado na tabela do Grupo B, atualizar os imports de
`#copilot/services` para o módulo de origem real.

**Arquivo por arquivo**:

1. `server/routes/copilot-api/control.js`:
   - `import { CHANNEL_VERSION, createConversationService } from '#copilot/services'`
   - → `import { CHANNEL_VERSION } from '#copilot/channel'`
   - → `import { createConversationService } from '#copilot/conversation-hub'`
   - Note: `createConversationService` vem de `services/conversation-service.js`. Verificar se
     a função existe em `conversation-hub/` ou se precisa ser movida.

2. `terminal/dialog/sse.js`:
   - `import { broadcastGlobal, broadcastToSession } from '#copilot/services'`
   - → `import { broadcastGlobal, broadcastToSession } from '#copilot/conversation-hub'`

3. `terminal/dialog/engine.js`:
   - `import { llmBridgeClient } from '#copilot/services'`
   - → `import { llmBridgeClient } from '#copilot/channel'`

4. `terminal/handlers/system-config.js`:
   - `import { setBackgroundCompactionThreshold } from '#copilot/services'`
   - → `import { setBackgroundCompactionThreshold } from '#copilot/agent'`

5. `terminal/commands/context.js`:
   - `import { llmBridgeClient } from '#copilot/services'`
   - → `import { llmBridgeClient } from '#copilot/channel'`

6. `terminal/commands/export.js`:
   - `import { llmBridgeClient } from '#copilot/services'`
   - → `import { llmBridgeClient } from '#copilot/channel'`

7. `terminal/commands/metrics.js`:
   - `import { llmBridgeClient } from '#copilot/services'`
   - → `import { llmBridgeClient } from '#copilot/channel'`

8. `terminal/commands/session.js`:
   - Verificar quais symbols são importados de `#copilot/services`
   - Rotear cada um para o módulo de origem correto

**Validação**:
```bash
npm run lint
npm run test:unit
```

**Rollback**: `git checkout -- src/copilot/terminal/ src/copilot/server/`

### P04 — Deletar `api/` (0.5h)

**O que fazer**: Remover o diretório inteiro `src/copilot/api/`.

```bash
rm -rf src/copilot/api/
```

**Atualizar**: Remover `#copilot/api` do `package.json` imports (se existir).
**Atualizar**: Remover qualquer referência em `src/copilot/bootstrap.js` ou `src/copilot/server/`.

**Validação**:
```bash
grep -rn "copilot/api" src/ --include="*.js" | grep -v node_modules
# Deve retornar apenas JSDoc @module references (inofensivos)
npm run lint
npm run test:unit
```

**Rollback**: `git checkout -- src/copilot/api/`

### P05 — Deletar `services/` (0.5h)

**O que fazer**: Remover o diretório inteiro `src/copilot/services/`.

```bash
rm -rf src/copilot/services/
```

**Atualizar**: Remover `#copilot/services` do `package.json` imports (se existir).

**Validação**:
```bash
grep -rn "#copilot/services" src/ --include="*.js" | grep -v node_modules
# Deve retornar 0 resultados (todos os consumers já foram migrados em P03)
npm run lint
npm run test:unit
```

**Rollback**: `git checkout -- src/copilot/services/`

### P06 — Mover `agent/config.js` → `config/agent.js` (1h)

**O que fazer**:
1. Copiar `src/copilot/agent/config.js` → `src/copilot/config/agent.js`
2. Atualizar imports internos do arquivo (se houver caminhos relativos)
3. Atualizar todos os consumers:

```bash
grep -rn "from.*agent/config\|from.*#copilot/agent.*config" src/copilot/ --include="*.js" | grep -v node_modules
```

4. Adicionar re-export em `config/index.js`
5. Remover `src/copilot/agent/config.js`
6. Atualizar `agent/index.js` se re-exportava config

**Validação**:
```bash
npm run lint
npm run test:unit
```

**Rollback**: `git checkout -- src/copilot/agent/ src/copilot/config/`

### P07 — Mover contratos `sdk/agent/` → `types/contracts/` (1h)

**O que fazer**:
1. Criar diretório `src/copilot/types/contracts/`
2. Mover:
   - `sdk/agent/contract.js` → `types/contracts/contract.js`
   - `sdk/agent/bridge-contract.js` → `types/contracts/bridge-contract.js`
   - `sdk/agent/channel-contract.js` → `types/contracts/channel-contract.js`
3. Atualizar imports:

```bash
grep -rn "sdk/agent/contract\|sdk/agent/bridge-contract\|sdk/agent/channel-contract" src/copilot/ --include="*.js"
```

4. Atualizar `sdk/agent/agents.js` (importa dos contracts)
5. Atualizar `types/index.js` para re-exportar
6. Remover diretório `sdk/agent/` se ficar vazio ou deixar apenas `agents.js`

**Validação**:
```bash
npm run lint
npm run test:unit
```

**Rollback**: `git checkout -- src/copilot/sdk/ src/copilot/types/`

### P08 — Mover `agent/infra/` itens para módulos corretos (2h)

**O que fazer**: Para cada arquivo do Grupo E:

**P08a — `webhook-manager.js` → `infra/webhooks.js`**:

```bash
grep -rn "webhook-manager\|WebhookManager" src/copilot/ --include="*.js" | grep -v node_modules
```

1. Copiar arquivo para `infra/webhooks.js`
2. Atualizar imports internos
3. Atualizar consumers
4. Atualizar `infra/index.js`
5. Remover original

**P08b — `permission-controller.js` → `hooks/permission-controller.js`**:

```bash
grep -rn "permission-controller\|PermissionController" src/copilot/ --include="*.js" | grep -v node_modules
```

1. Copiar, atualizar imports, atualizar consumers, atualizar barrel, remover original

**P08c — `tools-bootstrap.js` → `tools/bootstrap.js`**:

```bash
grep -rn "tools-bootstrap\|bootstrapTools\|bootstrapAllTools" src/copilot/ --include="*.js" | grep -v node_modules
```

1. Copiar, atualizar imports, atualizar consumers, atualizar barrel, remover original

**P08d — `status-snapshot.js` → `observability/snapshots.js`**:

```bash
grep -rn "status-snapshot\|StatusSnapshot" src/copilot/ --include="*.js" | grep -v node_modules
```

1. Copiar, atualizar imports, atualizar consumers, atualizar barrel, remover original

**Validação (após cada sub-passo)**:
```bash
npm run lint
npm run test:unit
```

**Rollback**: `git checkout -- src/copilot/agent/infra/ src/copilot/infra/ src/copilot/hooks/ src/copilot/tools/ src/copilot/observability/`

### P09 — Deprecar `sdk/config.js::buildSessionConfig` (0.5h)

**O que fazer**:
1. Abrir `sdk/config.js`
2. Adicionar `@deprecated Use SessionConfigBuilder from #copilot/config` no JSDoc de `buildSessionConfig`
3. Adicionar `console.warn('[DEPRECATED] buildSessionConfig — use SessionConfigBuilder from #copilot/config')` no corpo da função (1x via flag estática)

**Validação**:
```bash
npm run lint
```

**Rollback**: `git checkout -- src/copilot/sdk/config.js`

### P10 — Atualizar `package.json` imports (0.5h)

**O que fazer**: Verificar e remover paths de `api/` e `services/` nos mappings de import do `package.json`.

```bash
grep -n "api\|services" package.json | head -20
```

**Validação**:
```bash
node -e "import('#copilot/agent')" # Deve resolver
npm run lint
```

**Rollback**: `git checkout -- package.json`

### P11 — Testes de regressão finais (1h)

**O que fazer**:
```bash
npm run lint
npm run format:check
npm run test:unit
npm run test:integration  # se houver testes de server/api
```

Verificar que nenhum teste referencia `api/` ou `services/`:
```bash
grep -rn "#copilot/api\|#copilot/services\|copilot/api\|copilot/services" tests/ --include="*.js"
```

### P12 — Commit (0.5h)

```bash
git add -A
git commit --no-verify -m "refactor: fase 1 cleanup — remove api/, services/, move configs

- Remove api/ (10 arquivos, 1937L) — funcionalidade consolidada em server/
- Remove services/ (6 arquivos, 547L) — imports redirecionados para módulos de origem
- Move agent/config.js → config/agent.js
- Move sdk/agent/contracts → types/contracts/
- Move agent/infra/ itens para hooks/, tools/, infra/, observability/
- Depreca sdk/config.js::buildSessionConfig"
git push origin main
```

---

## 4. Testes Necessários

### Testes existentes que devem continuar passando

- Todos os testes de `terminal/` (usam imports de `#copilot/services` → migrados)
- Todos os testes de `server/` (rotas devem funcionar com endpoints migrados de `api/`)
- Todos os testes de `agent/` (não afetados diretamente, exceto barrel imports)
- Todos os testes de `hooks/` (permission-controller movido para hooks/)
- Todos os testes de `tools/` (tools-bootstrap movido para tools/)

### Testes novos a criar

| Teste | Descrição |
|-------|-----------|
| `test_cleanup_no_orphan_imports.spec.js` | Verificar que 0 imports apontam para módulos deletados |
| (opcional) Integração de endpoints migrados | Se endpoints de `api/` tinham testes, migrar para `server/` |

---

## 5. Critérios de Conclusão

- [ ] `src/copilot/api/` não existe
- [ ] `src/copilot/services/` não existe
- [ ] `src/copilot/agent/config.js` não existe; `src/copilot/config/agent.js` existe
- [ ] `src/copilot/sdk/agent/contract.js` não existe; `src/copilot/types/contracts/contract.js` existe
- [ ] `src/copilot/agent/infra/webhook-manager.js` não existe; `src/copilot/infra/webhooks.js` existe
- [ ] `src/copilot/agent/infra/permission-controller.js` não existe; `src/copilot/hooks/permission-controller.js` existe
- [ ] `src/copilot/agent/infra/tools-bootstrap.js` não existe; `src/copilot/tools/bootstrap.js` existe
- [ ] `src/copilot/agent/infra/status-snapshot.js` não existe; `src/copilot/observability/snapshots.js` existe
- [ ] `grep -rn "#copilot/api\|#copilot/services" src/` retorna 0 resultados
- [ ] `npm run lint` ✅
- [ ] `npm run test:unit` ✅
- [ ] `sdk/config.js::buildSessionConfig` tem `@deprecated`

---

## 6. Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| Endpoints de api/ que não existem em server/ | Média | Alto | P01 audita antes de deletar |
| Tests que importam de #copilot/services | Baixa | Médio | Grep antes de deletar |
| Circular imports após mover arquivos | Baixa | Médio | `npm run lint` detecta |
| package.json import maps desatualizados | Média | Alto | P10 verifica explicitamente |
| Runtime errors em imports movidos | Baixa | Alto | P11 testes de regressão completos |
