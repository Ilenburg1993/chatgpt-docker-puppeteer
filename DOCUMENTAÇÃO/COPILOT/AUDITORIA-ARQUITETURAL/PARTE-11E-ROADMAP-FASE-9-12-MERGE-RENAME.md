# PARTE 11E — Roadmap de Refatoração: Fases 9–12 (Merge & Rename)

**Data**: 2026-07-21
**Pré-requisitos**: Fases 1–8 concluídas.
**Escopo**: Merge lib/→sdk/, movimentações, decomposição de God Modules.

> **STATUS (2026-07-22)**: ✅ **TODAS AS FASES CONCLUÍDAS E PUSHADAS**.
> Ver [PARTE-12](PARTE-12-STATUS-POS-F16.md) para métricas finais e roadmap de continuidade.

---

## Fase 9: Merge `lib/` → `sdk/`

**Objetivo**: Renomear e reestruturar `lib/` em `sdk/` com naming mais claro, eliminando os
deprecated já removidos em F1.

### F9.1 — Criar diretório `sdk/`

1. Criar `src/copilot/sdk/`

### F9.2 — Mover arquivos de lib/ → sdk/

1. `lib/sdk-client.js` → `sdk/client.js`
2. `lib/session.js` → `sdk/session.js`
3. `lib/agents.js` → `sdk/agents.js`
4. `lib/tools-registry.js` → `sdk/tools-registry.js`
5. `lib/event-helpers.js` → `sdk/event-helpers.js`
6. `lib/http-request.js` → `sdk/http-request.js`
7. `lib/url-validator.js` → `sdk/url-validator.js`
8. `lib/utils.js` → `sdk/utils.js`
9. `lib/index.js` → `sdk/index.js` (atualizar paths internos)

### F9.3 — Merge `lib/models.js` + `lib/model-registry.js` → `sdk/models.js`

1. Analisar overlap entre os dois arquivos
2. Fusionar em um único módulo com seções claras:
   - Model listing/routing (ex-models.js)
   - ModelRegistry catalog (ex-model-registry.js)
   - ModelSelector heuristic
   - ModelStatsTracker
3. Se resultado >600 lines: split em `sdk/models/listing.js` + `sdk/models/registry.js`

### F9.4 — Mover `config/tools/registry.js` → `sdk/custom-tools.js`

1. Renomear para evitar confusão com `sdk/tools-registry.js`
2. Mover de `config/tools/` para `sdk/`

### F9.5 — Mover `config/tools/state.js` → `sdk/tools-state.js`

1. Mover e ajustar imports

### F9.6 — Eliminar `config/tools/` (vazio após F9.4-F9.5)

1. Remover `config/tools/index.js` e diretório

### F9.7 — Atualizar import path alias

1. Se o projeto usa `#copilot/lib/*`: atualizar para `#copilot/sdk/*`
2. Atualizar `package.json` imports/exports se necessário
3. Atualizar `tsconfig*.json` paths se necessário

### F9.8 — Redirecionar TODOS os importadores de lib/

1. Buscar `#copilot/lib/`, `from '../lib/'`, `from '../../lib/'`
2. Redirecionar para `#copilot/sdk/` ou paths relativos correspondentes
3. Confirmar 0 imports para lib/

### F9.9 — Eliminar diretório `lib/`

1. Remover diretório e todos os arquivos restantes

### F9.10 — Criar `sdk/index.js` barrel

1. Re-exportar todos os módulos sdk/

### Validação F9

- `grep -rn "lib/" src/copilot --include='*.js'` — 0 resultados
- lint + typecheck
- `#copilot/sdk/*` resolve corretamente

---

## Fase 10: Movimentações Pontuais

### F10.1 — Mover `bridges/alias-store.js` → `terminal/alias-store.js`

1. Copiar arquivo
2. Atualizar importadores (terminal/repl.js, terminal/index.js, terminal/commands/alias.js)
3. Remover original
4. Confirmar que bridges/ não importa mais alias-store

### F10.2 — Renomear `config/pinned-files-loader.js` → `config/pinned-files.js`

1. Renomear arquivo
2. Atualizar importadores e barrel

### F10.3 — Renomear `core/agent-events.js` → `core/events.js`

1. São eventos do sistema inteiro, não apenas do agent
2. Renomear e ajustar importadores
3. Atualizar `core/index.js`
4. Atualizar `core/constants.js` que re-importa agent-events

### Validação F10

- lint + typecheck

---

## Fase 11: Decomposição de God Modules em `observability/`

### F11.1 — Decompor `observability/event-collector.js` (1.411 lines)

1. Analisar responsabilidades internas:
   - Coleção de eventos SDK
   - Coleção de eventos agent
   - Coleção de eventos hooks
   - Processamento e agregação
2. Criar `observability/events/` subdiretório
3. Extrair coletores por domínio
4. Manter barrel `observability/events/index.js`
5. `event-collector.js` original vira thin wrapper ou é eliminado

### F11.2 — Decompor `observability/agent-event-observer.js` (945 lines)

1. Analisar seções:
   - Binding de listeners
   - Transformação de eventos para métricas
   - Integração OTel
2. Extrair para `observability/events/agent-observer.js`
3. Se necessário, split em `binder.js` + `transformer.js`

### F11.3 — Decompor `observability/metrics.js` (551 lines)

1. Analisar seções:
   - Agregação de métricas
   - Token tracking
   - Latency tracking
   - Summary builders
2. Criar `observability/metrics/` subdiretório se >400 lines continuar
3. Ou manter como está se decomposição não traz valor

### F11.4 — Atualizar `observability/index.js`

1. Re-exportar de novos subdiretórios
2. Manter backward-compat para importadores existentes

### Validação F11

- lint + typecheck
- Nenhum arquivo em `observability/` >600 lines

---

## Fase 12: Decomposição de God Modules em `terminal/`

### F12.1 — Decompor `terminal/dialog.js` (944 lines)

1. Analisar seções:
   - `ensureDialogLoop` — lógica de inicialização
   - `sendTurn` — envio e processamento
   - Display/rendering de resposta
   - Event handling
2. Criar `terminal/dialog/` subdiretório:
   - `dialog/engine.js` — sendTurn, processamento
   - `dialog/loop.js` — ensureDialogLoop
   - `dialog/index.js` — barrel
3. `terminal/dialog.js` vira barrel ou é eliminado

### F12.2 — Decompor `terminal/handlers-system.js` (722 lines)

1. Analisar seções por domínio:
   - Health/config handlers
   - Metrics/stats handlers
   - Git/GitHub handlers
   - Tools/skills handlers
   - SSE handlers
2. Criar `terminal/handlers/` subdiretório:
   - `handlers/system-health.js` — health, config
   - `handlers/system-metrics.js` — metrics, stats
   - `handlers/system-git.js` — git, gh
   - `handlers/system-tools.js` — tools, skills
3. Ou manter agrupado se decomposição não vale a pena

### F12.3 — Reorganizar handlers em `terminal/handlers/`

1. Mover `handlers-agent.js` → `handlers/agent.js`
2. Mover `handlers-dialog.js` → `handlers/dialog.js`
3. Mover `handlers-shared.js` → `handlers/shared.js`
4. Mover/split `handlers-system.js` per F12.2
5. Criar `handlers/index.js` barrel

### F12.4 — Atualizar `terminal/route-table.js` e `terminal/server.js`

1. Redirecionar imports para `handlers/`

### Validação F12

- lint + typecheck
- Nenhum arquivo em `terminal/` >600 lines (exceto possivelmente repl.js que é 574)

---

## Tracking de Commits

| Fase | Tipo     | Template                                                   |
| ---- | -------- | ---------------------------------------------------------- |
| F9   | refactor | `refactor(copilot): F9.N — merge lib/ em sdk/`             |
| F10  | refactor | `refactor(copilot): F10.N — mover/renomear ARQUIVO`        |
| F11  | refactor | `refactor(copilot): F11.N — decompor observability/MÓDULO` |
| F12  | refactor | `refactor(copilot): F12.N — decompor terminal/MÓDULO`      |
