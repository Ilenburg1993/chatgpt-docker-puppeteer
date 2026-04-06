# PARTE 11D — Roadmap de Refatoração: Fases 5–8 (Unificação & Centralização)

**Data**: 2026-07-21
**Pré-requisitos**: Fases 1–4 concluídas (higiene).
**Escopo**: Centralização de config, unificação de auditoria, merge de rotas HTTP.

---

## Fase 5: Centralização Global de `process.env`

**Objetivo**: Criar `config/env.js` como SSOT de variáveis de ambiente. Reduzir 41 arquivos com
`process.env` direto para 0.

### F5.1 — Criar `config/env.js`

1. Auditar TODOS os `process.env.X` em `src/copilot/` (excluindo `agent/config.js` já centralizado)
2. Agrupar por subsistema
3. Criar `config/env.js` com helpers `envStr`, `envBool`, `envInt`
4. Exportar objeto `ENV` com TODAS as variáveis usadas

### F5.2 — Migrar `agent/config.js` para usar `config/env.js`

1. `agent/config.js` passa a importar de `config/env.js` as variáveis base
2. Mantém constantes derivadas (thresholds, timeouts) como está
3. Re-exporta para consumo dentro de `agent/`

### F5.3 — Migrar `observability/` (10 arquivos)

1. `logger.js` — substituir `process.env.LOG_LEVEL` → `ENV.LOG_LEVEL`
2. `metrics.js` — substituir variáveis de intervalo
3. `otel.js` — substituir OTEL configs
4. `event-collector.js` — substituir qualquer env var
5. `audit-log.js` — substituir paths de log

### F5.4 — Migrar `terminal/` (7+ arquivos)

1. `server.js`, `state.js`, `dialog.js`, `index.js`, `repl.js` — porta, timeouts
2. `bootstrap.js` — `COPILOT_SDK_ENABLED` (arquivo será eliminado em F1, mas se existir)
3. `handlers-system.js` — qualquer env var
4. `workspace-context.js` — CWD, etc.

### F5.5 — Migrar `api/` (3 arquivos)

1. `bridge-control.js`, `bridge-stream.js`, `sse-replay-buffer.js`

### F5.6 — Migrar `bridges/` (3 arquivos)

1. `mcp-tool-bridge.js`, `alias-store.js`, `gh/shared.js`

### F5.7 — Migrar `config/` interno (3 arquivos)

1. `custom-agents.js`, `mcp-servers.js`, `tools/registry.js`

### F5.8 — Migrar `channel/` (1 arquivo)

1. `inject.js`

### F5.9 — Migrar `hooks/` (3 arquivos)

1. `audit.js`, `presets/audit.js`

### F5.10 — Migrar `conversation-hub/` (1 arquivo)

1. `socket-ns.js`

### F5.11 — Migrar `db/` (1 arquivo)

1. `sqlite.js`

### F5.12 — Migrar `routes/` (3 arquivos)

1. `agent.js`, `observability.js`, `sessions.js`

### F5.13 — Migrar `tools/` (5 arquivos)

1. `shell/index.js`, `web-tools.js`, `introspection-tools.js`, `session-rpc-tools.js`,
   `task-tools.js`

### F5.14 — Migrar `lib/` (1 arquivo)

1. `sdk-client.js`

### Validação F5

- `grep -rn 'process\.env\b' src/copilot --include='*.js' | grep -v config/env.js | grep -v
  agent/config.js` — deve retornar 0 (ou apenas as 4 exceções justificadas: NODE_ENV em
  condicionais dinâmicos)
- lint + typecheck + format:check

---

## Fase 6: Unificação de Auditoria

**Objetivo**: Merge de 3 sistemas de auditoria em pipeline unificado `audit/`.

### F6.1 — Criar `audit/ring-buffer.js`

1. Extrair a melhor implementação de ring buffer (de `hooks/audit.js` ou
   `observability/audit-log.js`)
2. Generalizar para reuso (tamanho configurável, tipagem genérica)

### F6.2 — Criar `audit/jsonl-writer.js`

1. Extrair lógica JSONL I/O de `observability/audit-log.js`
2. Incluir rotação automática
3. Manter batch I/O com setImmediate

### F6.3 — Criar `audit/pipeline.js`

1. Criar handler `onPostToolUse` unificado que:
   - Registra no ring buffer
   - Escreve JSONL (assíncrono)
   - Emite no HookBus
2. Exportar `isHighRiskTool()` (movido de `agent/infra/tool-audit-logger.js`)
3. Exportar `buildAuditPermissionHandler()` (movido de `agent/infra/tool-audit-logger.js`)
4. Exportar `getAuditTail()` e `getAuditSummary()`

### F6.4 — Criar `audit/index.js`

1. Barrel exports

### F6.5 — Redirecionar importadores de `hooks/audit.js`

1. Buscar todos os importadores
2. Redirecionar para `audit/pipeline.js` ou `audit/index.js`
3. Remover `hooks/audit.js`

### F6.6 — Redirecionar importadores de `observability/audit-log.js`

1. Buscar todos os importadores
2. Redirecionar para `audit/`
3. Simplificar `observability/audit-log.js` para re-export ou remover

### F6.7 — Redirecionar importadores de `agent/infra/tool-audit-logger.js`

1. Buscar importadores (agent/session/initializer.js, hooks/presets/)
2. Redirecionar para `audit/`
3. Remover `agent/infra/tool-audit-logger.js`
4. Atualizar `agent/infra/index.js`

### Validação F6

- Confirmar que apenas `audit/` contém lógica de auditoria de tools
- lint + typecheck
- Verificar que `logs/tool-permissions-audit.jsonl` e `logs/tool-execution-audit.jsonl` convergem
  para um único arquivo

---

## Fase 7: Unificação de Rotas HTTP

**Objetivo**: Merge `api/` + `routes/` em estrutura unificada.

### F7.1 — Criar estrutura `api/express/`

1. Mover `routes/agent.js` → `api/express/agent.js`
2. Mover `routes/client.js` → `api/express/client.js`
3. Mover `routes/sessions.js` → `api/express/sessions.js`
4. Mover `routes/hooks.js` → `api/express/hooks.js`
5. Mover `routes/webhooks.js` → `api/express/webhooks.js`
6. Mover `routes/observability.js` → `api/express/observability.js`
7. Mover `routes/middleware.js` → `api/express/middleware.js`
8. Mover `api/sdk-api.js` → `api/express/index.js` (renomear)

### F7.2 — Criar estrutura `api/bridge/`

1. Mover `api/bridge-control.js` → `api/bridge/control.js`
2. Mover `api/bridge-dialog.js` → `api/bridge/dialog.js`
3. Mover `api/bridge-stream.js` → `api/bridge/stream.js`
4. Mover `api/bridge-tasks.js` → `api/bridge/tasks.js`
5. Mover `api/http-bridge.js` → `api/bridge/index.js`

### F7.3 — Criar estrutura `api/sse/`

1. Mover `api/sse-utils.js` → `api/sse/utils.js`
2. Mover `api/sse-replay-buffer.js` → `api/sse/replay-buffer.js`
3. Mover `api/event-fanout.js` → `api/sse/fanout.js`

### F7.4 — Criar `api/index.js` barrel

1. Re-exportar de `api/express/`, `api/bridge/`, `api/sse/`

### F7.5 — Eliminar `routes/` (diretório vazio)

1. Confirmar que todos os arquivos foram movidos
2. Remover `routes/`

### F7.6 — Atualizar importadores

1. Buscar todas as importações de `../routes/`, `#copilot/routes/`
2. Redirecionar para `api/express/`
3. Confirmar que `sdk-api.js` (agora `api/express/index.js`) monta os routers corretamente

### Validação F7

- lint + typecheck
- Confirmar que `api/express/index.js` monta todos os sub-routers
- Confirmar que importadores de routes/* redirecionados

---

## Fase 8: Merge `types/` em `core/`

**Objetivo**: Mover tipos compartilhados para `core/`, eliminando diretório `types/`.

### F8.1 — Mover `types/sdk.js` → `core/sdk-types.js`

1. Copiar com renomeação
2. Atualizar importadores
3. Remover original

### F8.2 — Mover `types/structured-message.js` → `core/structured-message.js`

1. Copiar com renomeação
2. Atualizar importadores
3. Remover original

### F8.3 — Atualizar `core/index.js`

1. Adicionar exports dos novos arquivos

### F8.4 — Eliminar `types/index.js` e diretório `types/`

1. Buscar importadores de `types/index.js`
2. Redirecionar para `core/`
3. Remover `types/` inteiro

### Validação F8

- lint + typecheck
- `core/index.js` exporta tipos corretamente

---

## Tracking de Commits

| Fase | Tipo | Template |
| --- | --- | --- |
| F5 | refactor | `refactor(copilot): F5.N — centralizar process.env de SUBSISTEMA em config/env.js` |
| F6 | refactor | `refactor(copilot): F6.N — unificar auditoria em audit/` |
| F7 | refactor | `refactor(copilot): F7.N — unificar rotas HTTP em api/` |
| F8 | refactor | `refactor(copilot): F8.N — mover types/ para core/` |
