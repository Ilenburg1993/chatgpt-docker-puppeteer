# PARTE 11F — Roadmap de Refatoração: Fases 13–16 (Hardening & Extensibilidade)

**Data**: 2026-07-21
**Pré-requisitos**: Fases 1–12 concluídas.
**Escopo**: Barrel consistency, import aliases, error handling, testes, extensibilidade.

> **STATUS (2026-07-22)**: ✅ **TODAS AS FASES CONCLUÍDAS E PUSHADAS**.
> Ver [PARTE-12](PARTE-12-STATUS-POS-F16.md) para métricas finais e roadmap de continuidade F17–F22.

---

## Fase 13: Import Path Aliases

**Objetivo**: Substituir todos os paths relativos profundos (`../../`, `../../../`) por aliases
`#copilot/*`.

### F13.1 — Auditar imports relativos profundos

1. `grep -rn "from '\.\./\.\." src/copilot --include='*.js' | wc -l`
2. Classificar por profundidade:
   - `../../` — 2 níveis (avaliar se aliás melhora)
   - `../../../` — 3+ níveis (obrigatório usar alias)

### F13.2 — Atualizar `package.json` exports/imports

1. Garantir que `#copilot/*` path aliases cobrem todas as pastas:
   - `#copilot/core`, `#copilot/sdk`, `#copilot/config`, `#copilot/hooks`, `#copilot/audit`
   - `#copilot/observability`, `#copilot/agent`, `#copilot/api`, `#copilot/bridges`
   - `#copilot/channel`, `#copilot/conversation-hub`, `#copilot/terminal`, `#copilot/tools`
   - `#copilot/db`
2. Adicionar aliases novos (ex: `#copilot/sdk/*` após rename de lib/)

### F13.3 — Substituir imports `../../../` por aliases

1. Para cada arquivo com import de 3+ níveis:
   - Substituir por alias `#copilot/módulo`
2. Priorizar arquivos com mais imports profundos

### F13.4 — Substituir imports `../../` selecionados

1. Em módulos onde `../../` cruza fronteira de subsistema:
   - Ex: `terminal/handlers-system.js` → `../../bridges/git-bridge.js` → `#copilot/bridges/git-bridge`
2. Manter `../../` para imports DENTRO do mesmo subsistema (ex: `dialog/loop-manager.js` →
   `../config.js`)

### F13.5 — Atualizar tsconfig paths

1. `tsconfig.json` (e variantes) devem ter paths consistentes com `package.json` imports

### Validação F13

- lint + typecheck
- 0 imports com `../../../`
- Imports relativos restantes são apenas intra-subsistema

---

## Fase 14: Barrel Consistency

**Objetivo**: Garantir que cada diretório tem barrel completo e que importadores externos usam o
barrel (não imports profundos).

### F14.1 — Auditar barrels existentes

1. Para cada diretório com `index.js`:
   - Listar todos os exports
   - Verificar que cobrem todos os arquivos do diretório
   - Verificar que nenhum importador externo bypassa o barrel

### F14.2 — Criar barrels faltantes

1. `api/express/index.js`, `api/bridge/index.js`, `api/sse/index.js` (criados em F7)
2. `audit/index.js` (criado em F6)
3. `sdk/index.js` (criado em F9)
4. `terminal/dialog/index.js`, `terminal/handlers/index.js` (criados em F12)

### F14.3 — Redirecionar imports profundos para barrels

1. Buscar imports que apontam para arquivos internos de subdiretórios que têm barrel
2. Redirecionar para barrel
3. Exceções: imports entre arquivos DO MESMO diretório (permitido usar relative)

### Validação F14

- Cada diretório com barrel: nenhum importador externo aponta para arquivo interno

---

## Fase 15: Error Handling Consistency

**Objetivo**: Garantir uso consistente da hierarquia de erros de `core/errors.js` em todo o sistema.

### F15.1 — Auditar uso de erros custom

1. `grep -rn "new Error(" src/copilot --include='*.js'` — listar errors genéricos
2. Classificar:
   - Erros que deveriam usar `CopilotError` (erros de negócio)
   - Erros que deveriam usar `SessionError` (falhas de sessão)
   - Erros que deveriam usar `BridgeError` (falhas de ponte)
   - Erros legítimos com `new Error()` (programação geral)

### F15.2 — Criar erros adicionais se necessário

1. Avaliar se faltam classes de erro para padrões recorrentes:
   - `ToolError` (falhas de tools)
   - `AuditError` (falhas de auditoria)
   - `ConfigError` (config inválida)
2. Adicionar a `core/errors.js` se justificado

### F15.3 — Migrar erros genéricos para tipados

1. Substituir `new Error(msg)` por `new XyzError(msg)` onde aplicável
2. Priorizar: módulos com catch que fazem instanceof check

### Validação F15

- lint
- `new Error(` restantes são legítimos (ex: assertion errors, not-implemented)

---

## Fase 16: Preparação para Extensibilidade

**Objetivo**: Garantir que a arquitetura suporte novos agentes, modelos e canais de comunicação.

### F16.1 — Plugin Interface para Agents

1. Documentar o contrato de um agent plugin:
   - Quais métodos deve implementar
   - Como registrar no sistema
   - Como receber/enviar tools
2. Criar `sdk/agent-contract.js` com tipos/interface
3. `AlwaysAliveAgent` deve satisfazer esse contrato

### F16.2 — Plugin Interface para Channels

1. Documentar o contrato de um channel (LLM-A ↔ LLM-B):
   - Interface: sendMessage, receiveMessage, connect, disconnect
   - Como registrar no sistema
2. `channel/client.js` e `channel/inject.js` devem satisfazer esse contrato

### F16.3 — Plugin Interface para Bridges

1. Documentar o contrato de um bridge:
   - mount(agent), unmount(), events
2. `nerv-bridge.js` e `mcp-tool-bridge.js` devem satisfazer

### F16.4 — Registry de Plugins

1. Avaliar se vale criar um plugin registry central:
   - Permite register/unregister de agentes, canais, bridges em runtime
   - Hoje não necessário, mas documenta o path para futuro

### Validação F16

- JSDoc completo nas interfaces
- Nenhum breaking change nos módulos existentes

---

## Tracking de Commits

| Fase | Tipo     | Template                                                              |
| ---- | -------- | --------------------------------------------------------------------- |
| F13  | refactor | `refactor(copilot): F13.N — substituir imports relativos por aliases` |
| F14  | refactor | `refactor(copilot): F14 — barrel consistency em diretório`            |
| F15  | refactor | `refactor(copilot): F15.N — error handling consistency`               |
| F16  | docs     | `docs(copilot): F16.N — plugin interface para COMPONENTE`             |

---

## Métricas Finais Esperadas (pós-F16)

| Métrica                        | Anterior (pré-F1) | Alvo (pós-F16) |
| ------------------------------ | ----------------- | -------------- |
| Arquivos deprecated            | 6                 | 0              |
| God Modules (>600 lines)       | 11                | ≤4             |
| Overlaps                       | 7                 | 0              |
| process.env fora de config     | 41                | 0              |
| Sistemas de auditoria          | 3                 | 1              |
| Diretórios HTTP                | 3                 | 2              |
| Imports com `../../../`        | ~15               | 0              |
| Diretórios sem barrel          | ~3                | 0              |
| Erros sem classe tipada        | ~30+              | <10            |
| Plugin interfaces documentadas | 0                 | 3+             |
