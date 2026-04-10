# PARTE-17C — Roadmap de Transformação Arquitetural: SDK Facade

**Data**: 2026-03-20 (rev.3 — transformação arquitetural completa)
**Escopo**: TODO `src/copilot/` (263 arquivos, ~46.525 linhas)
**Pré-requisitos**: PARTE-17A rev.3 + PARTE-17B rev.3
**Autor**: Auditoria automatizada PARTE-17

---

## Sumário Executivo

Este roadmap detalha a execução da transformação arquitetural proposta na PARTE-17B, organizada em
**12 faixas** com **~67 fases** e estimativa de **~250 testes** adicionais. A execução segue um
modelo de migração progressiva: cada faixa pode ser commitada independentemente, com backward
compatibility até a faixa final de cleanup.

### Visão Geral das Faixas

| Faixa | Nome                             | Fases | Testes est. | Prioridade | Dependência |
| :---: | -------------------------------- | ----: | ----------: | :--------: | :---------: |
|   1   | SDK Facade: Novos Módulos        |     8 |         ~25 |     P0     |      —      |
|   2   | defineTool Migration             |     5 |         ~20 |     P0     |      1      |
|   3   | approveAll Migration             |     4 |         ~15 |     P0     |      1      |
|   4   | CopilotClient Migration          |     5 |         ~20 |     P0     |      1      |
|   5   | Constants & Types Consolidation  |     6 |         ~20 |     P1     |      1      |
|   6   | Config Builder Unification       |     8 |         ~30 |     P0     |    1, 4     |
|   7   | Session Registry Merge           |     6 |         ~25 |     P0     |    4, 6     |
|   8   | Config Barrel Cleanup            |     4 |         ~15 |     P1     |    1, 5     |
|   9   | Hooks Type Alignment             |     5 |         ~20 |     P1     |      5      |
|  10   | ESLint Enforcement               |     3 |         ~10 |     P1     |   2-4, 8    |
|  11   | API Routes & Client Feature Wrap |     6 |         ~25 |     P1     |    4, 7     |
|  12   | Cleanup, Deprecation & Docs      |     7 |         ~25 |     P2     |    1-11     |

**Total**: **67 fases** | **~250 testes** | **~35 arquivos modificados** | **5 arquivos novos**

---

## Faixa 1 — SDK Facade: Novos Módulos

**Objetivo**: Criar os novos arquivos da facade sem quebrar nada existente.
**Dependência**: Nenhuma.
**Impacto**: Aditivo (zero breaking changes).

### Fases

| #   | Fase                                      | Descrição                                                                                                                                   | Testes |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| F1  | `sdk/tools.js` — Criar módulo             | Re-exportar `defineTool` de `@github/copilot-sdk` + `buildTool` de `tool-factory.js`. Incluir `withSkipPermission`.                         | 3      |
| F2  | `sdk/permissions.js` — Criar módulo       | Re-exportar `approveAll` + preset helpers (`createApproveAllPermission`, etc. de `hooks/permission`).                                       | 3      |
| F3  | `sdk/constants.js` — Criar módulo         | Re-exportar `SYSTEM_PROMPT_SECTIONS`.                                                                                                       | 2      |
| F4  | `sdk/types.js` — Criar módulo             | Consolidar todas as typedefs SDK. Zero runtime (apenas JSDoc exports).                                                                      | 3      |
| F5  | `sdk/config.js` — Criar builder unificado | `buildUnifiedSessionConfig()` + `CONFIG_PRESETS`. Teste de paridade: gerar config igual ao caminho atual do agent.                          | 5      |
| F6  | `sdk/config.js` — Presets                 | Implementar presets `always-alive`, `api-default`, `read-only`.                                                                             | 3      |
| F7  | `sdk/client.js` — Adicionar wrappers      | `createClient()`, `getLastSessionId()`, `getForegroundSessionId()`, `setForegroundSessionId()`, `onSessionCreated()`, `onSessionDeleted()`. | 4      |
| F8  | `sdk/index.js` — Atualizar barrel         | Adicionar re-exports dos novos módulos (tools, permissions, constants, types, config).                                                      | 2      |

**Subtotal**: 8 fases, ~25 testes

### Critério de Aceite
- Todos os novos módulos exportam corretamente
- `npm run test:unit` continua passando (zero regressão)
- `npm run typecheck:node` sem erros novos

---

## Faixa 2 — defineTool Migration

**Objetivo**: Migrar 10 arquivos que usam `defineTool` diretamente de `@github/copilot-sdk` para `#copilot/sdk/tools`.
**Dependência**: Faixa 1 (F1: `sdk/tools.js` deve existir).

### Fases

| #   | Fase                               | Descrição                                                                           | Arquivos | Testes |
| --- | ---------------------------------- | ----------------------------------------------------------------------------------- | -------- | ------ |
| F9  | Migrate tools/git + shell          | `tools/git/index.js`, `tools/shell/index.js`                                        | 2        | 4      |
| F10 | Migrate tools/session + rpc        | `tools/session-tools.js`, `tools/session-rpc-tools.js`                              | 2        | 4      |
| F11 | Migrate tools/task + introspection | `tools/task-tools.js`, `tools/introspection-tools.js`                               | 2        | 4      |
| F12 | Migrate tools/todo/*               | `tools/todo/crud-tools.js`, `tools/todo/bulk-tools.js`, `tools/todo/query-tools.js` | 3        | 4      |
| F13 | Migrate bridges/mcp-tool-bridge    | `bridges/mcp-tool-bridge.js`                                                        | 1        | 4      |

**Subtotal**: 5 fases, ~20 testes

### Padrão de Migração

Cada fase segue o mesmo padrão:
1. Alterar import: `@github/copilot-sdk` → `#copilot/sdk/tools`
2. Verificar que a tool continua funcionando via testes existentes
3. Adicionar smoke test se não houver cobertura
4. (Opcional) Considerar migração de `defineTool` → `buildTool` para ganhar logging automático

---

## Faixa 3 — approveAll Migration

**Objetivo**: Migrar 5 arquivos que importam `approveAll` diretamente.
**Dependência**: Faixa 1 (F2: `sdk/permissions.js` deve existir).

### Fases

| #   | Fase                                        | Descrição                                                             | Arquivos | Testes |
| --- | ------------------------------------------- | --------------------------------------------------------------------- | -------- | ------ |
| F14 | Migrate config/session-config               | `config/session-config.js`                                            | 1        | 3      |
| F15 | Migrate hooks/permission + agent/permission | `hooks/permission-handler.js`, `agent/infra/permission-controller.js` | 2        | 4      |
| F16 | Migrate api/session-crud                    | `api/express/session-crud.js`                                         | 1        | 4      |
| F17 | Migrate audit/pipeline                      | `audit/pipeline.js`                                                   | 1        | 4      |

**Subtotal**: 4 fases, ~15 testes

---

## Faixa 4 — CopilotClient Migration

**Objetivo**: Eliminar instanciação direta de `CopilotClient` fora de `sdk/client.js`.
**Dependência**: Faixa 1 (F7: `createClient()` wrapper deve existir).

### Fases

| #   | Fase                                   | Descrição                                                                                                                                               | Testes |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| F18 | `createClient()` wrapper — smoke tests | Testar que `createClient({telemetry})` retorna `CopilotClient` funcional                                                                                | 4      |
| F19 | Migrate `agent-lifecycle.js`           | `new CopilotClient()` → `createClient()`. Verificar que telemetry é passado corretamente.                                                               | 4      |
| F20 | Migrate `entry.js`                     | Import type JSDoc → de `sdk/types.js` ou `sdk/client.js`                                                                                                | 2      |
| F21 | Singleton unification analysis         | Analisar se agent deve usar `getClient()` (singleton) ou `createClient()` (factory). Documentar decisão.                                                | 2      |
| F22 | Apply singleton decision               | Se F21 decide usar `getClient()`: migrar agent para singleton. Se F21 decide manter factory: garantir que não há conflito com singleton usado pela API. | 8      |

**Subtotal**: 5 fases, ~20 testes

### Decisão Arquitetural (F21)

**Opção A — Agent usa `getClient()` singleton**: Mais simples. Agent e API compartilham a mesma instância. Registry unificado naturalmente. Risco: se o agent crashar o client, a API também perde acesso.

**Opção B — Agent usa `createClient()` factory**: Mais isolado. Cada camada tem sua instância. Requer `registerExternalSession()` para unificar registries. Mais resiliente a crashes isolados.

**Recomendação**: Opção B (factory) com `registerExternalSession()` — mantém isolamento de fault domains enquanto unifica observabilidade via registry.

---

## Faixa 5 — Constants & Types Consolidation

**Objetivo**: Unificar fontes de tipos e constantes em `sdk/types.js` e `sdk/constants.js`.
**Dependência**: Faixa 1 (F3, F4).

### Fases

| #   | Fase                              | Descrição                                                                                  | Testes |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------ | ------ |
| F23 | `core/sdk-types.js` → deprecated  | Substituir conteúdo por re-exports de `sdk/types.js`. Manter arquivo por backward compat.  | 3      |
| F24 | Migrate `config/system-prompt.js` | `SYSTEM_PROMPT_SECTIONS` → de `sdk/constants.js`                                           | 3      |
| F25 | Audit inline `@typedef` usage     | `rg` para encontrar todos os `@typedef {import('@github/copilot-sdk')` inline e catalogar. | 2      |
| F26 | Migrate inline types (batch 1)    | Top 10 arquivos com typedefs inline → importar de `sdk/types.js`                           | 4      |
| F27 | Migrate inline types (batch 2)    | Remaining files com typedefs inline                                                        | 4      |
| F28 | Validate type consistency         | Rodar `npm run typecheck:node` e verificar que nenhum tipo foi perdido na migração.        | 4      |

**Subtotal**: 6 fases, ~20 testes

---

## Faixa 6 — Config Builder Unification

**Objetivo**: Estabelecer `buildUnifiedSessionConfig()` como ÚNICO builder de sessão.
**Dependência**: Faixas 1 (F5-F6), 4 (client migration).

### Fases

| #   | Fase                                                         | Descrição                                                                                                                                           | Testes |
| --- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| F29 | Parity test: agent config                                    | Capturar output de `initOrResumeSession` config manual e comparar com `buildUnifiedSessionConfig(opts, 'agent')`. Garantir paridade field-by-field. | 5      |
| F30 | Parity test: API config                                      | Capturar output de `session-crud.js` config e comparar com `buildUnifiedSessionConfig(opts, 'api')`.                                                | 4      |
| F31 | Migrate `initializer.js`                                     | Substituir config manual por chamada a `buildUnifiedSessionConfig()`.                                                                               | 4      |
| F32 | Migrate `session-crud.js`                                    | Substituir config inline por chamada a `buildUnifiedSessionConfig()` com preset `api-default`.                                                      | 4      |
| F33 | Deprecate `config/session-config.js::buildAlwaysAliveConfig` | Redirecionar para `buildUnifiedSessionConfig()` com preset. Adicionar JSDoc `@deprecated`.                                                          | 3      |
| F34 | Remove `sdk/session.js::buildSessionConfig` helper           | Funcionalidade absorvida por `sdk/config.js`. Manter `createSession`, `resumeSession`, etc.                                                         | 3      |
| F35 | Remove preset field duplication                              | Garantir que defaults vão apenas em `CONFIG_PRESETS`, não espalhados em 3 builders.                                                                 | 3      |
| F36 | Integration test: full agent boot                            | Teste E2E: boot do agent usando novo config builder, verificar session criada com campos corretos.                                                  | 4      |

**Subtotal**: 8 fases, ~30 testes

---

## Faixa 7 — Session Registry Merge

**Objetivo**: Unificar os dois registros de sessão em um só registry em `sdk/client.js`.
**Dependência**: Faixas 4, 6.

### Fases

| #   | Fase                                      | Descrição                                                                                 | Testes |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------- | ------ |
| F37 | `registerExternalSession()` — Implementar | Adicionar ao `sdk/client.js` com metadados (source, model, createdAt).                    | 4      |
| F38 | Wire: `initializer.js` → register         | Após `resumeOrCreate()`, chamar `registerExternalSession(session, {source: 'agent'})`.    | 4      |
| F39 | Wire: `session.js` → register             | `createSession()` e `resumeSession()` chamam `registerExternalSession()` automaticamente. | 4      |
| F40 | Verify: `listActiveSessions()`            | Testar que sessions do agent E da API aparecem em `listActiveSessions()`.                 | 5      |
| F41 | Verify: Cleanup                           | Testar que `disconnectSession()` remove de ambos os registries.                           | 4      |
| F42 | Edge case: session rotation               | Testar que rotação de sessão (agent) registra nova e remove antiga no registry.           | 4      |

**Subtotal**: 6 fases, ~25 testes

---

## Faixa 8 — Config Barrel Cleanup

**Objetivo**: Remover re-exports de SDK de `config/index.js` — resolver P3.
**Dependência**: Faixas 1, 5.

### Fases

| #   | Fase                                                  | Descrição                                                                                                 | Testes |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------ |
| F43 | Audit: consumidores de `config/` que usam SDK exports | `rg "from '#copilot/config'" -l` → identificar quais usam `getToolsConfig` vs `BUILTIN_HANDLER_MAP`.      | 3      |
| F44 | Migrate consumidores (batch 1)                        | Atualizar imports para apontar para `#copilot/sdk/custom-tools` e `#copilot/sdk/tools-state` diretamente. | 4      |
| F45 | Migrate consumidores (batch 2)                        | Remaining files.                                                                                          | 4      |
| F46 | Remove SDK re-exports de `config/index.js`            | Limpar barrel. Verificar que nenhum consumidor quebrou.                                                   | 4      |

**Subtotal**: 4 fases, ~15 testes

---

## Faixa 9 — Hooks Type Alignment

**Objetivo**: Alinhar `hooks/types.js` com tipos do SDK — resolver P4.
**Dependência**: Faixa 5 (`sdk/types.js` deve estar pronto).

### Fases

| #   | Fase                                                      | Descrição                                                                      | Testes |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------ | ------ |
| F47 | Audit: quais tipos em hooks/types.js são paralelos ao SDK | Comparação field-by-field dos 12 tipos candidatos.                             | 2      |
| F48 | Migrate tipos idênticos                                   | Tipos que são cópia exata do SDK → substituir por re-export/import.            | 4      |
| F49 | Extend tipos divergentes                                  | Tipos que adicionam campos ao SDK → mudar para `extends` ou intersection type. | 4      |
| F50 | Manter tipos próprios                                     | Documentar quais tipos são EXCLUSIVOS do projeto (sem equivalente SDK).        | 4      |
| F51 | Validate: typecheck hooks/                                | `npm run typecheck:node` no escopo de hooks/. Zero erros novos.                | 6      |

**Subtotal**: 5 fases, ~20 testes

---

## Faixa 10 — ESLint Enforcement

**Objetivo**: Garantir que nenhum novo import direto de `@github/copilot-sdk` seja adicionado fora de `sdk/`.
**Dependência**: Faixas 2-4 (migrações de import concluídas), Faixa 8 (config cleanup).

### Fases

| #   | Fase                           | Descrição                                                                                    | Testes |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------- | ------ |
| F52 | Implementar ESLint rule        | `no-restricted-imports` para `@github/copilot-sdk` com exceção para `src/copilot/sdk/**`.    | 3      |
| F53 | Dry run: verificar 0 violações | `npx eslint src/copilot/ --rule 'no-restricted-imports: error'`. Se houver sobras, corrigir. | 4      |
| F54 | Adicionar ao CI pipeline       | Garantir que a rule está ativa em `npm run lint`.                                            | 3      |

**Subtotal**: 3 fases, ~10 testes

---

## Faixa 11 — API Routes & Client Feature Wrap

**Objetivo**: Migrar API routes para usar wrappers completos de `sdk/client.js` — resolver P8.
**Dependência**: Faixas 4, 7.

### Fases

| #   | Fase                                          | Descrição                                                                                    | Testes |
| --- | --------------------------------------------- | -------------------------------------------------------------------------------------------- | ------ |
| F55 | Migrate `session-crud.js` foreground methods  | `client.getForegroundSessionId()` → `getForegroundSessionId()` de wrapper                    | 4      |
| F56 | Migrate `session-crud.js` last session        | `client.getLastSessionId()` → `getLastSessionId()` de wrapper                                | 3      |
| F57 | Migrate `session-crud.js` list sessions       | `client.listSessions(filter)` → `listSessions(filter)` de wrapper (unificado com session.js) | 4      |
| F58 | Migrate `boot-wiring.js` client events        | `client.on('session.created')` → `onSessionCreated(cb)` de wrapper                           | 4      |
| F59 | Migrate `boot-wiring.js` client events (cont) | `client.on('session.deleted')` → `onSessionDeleted(cb)` de wrapper                           | 4      |
| F60 | Integration test: API + Agent sessions        | Cenário completo: agent cria sessão + API cria sessão → ambas aparecem em `GET /sessions`.   | 6      |

**Subtotal**: 6 fases, ~25 testes

---

## Faixa 12 — Cleanup, Deprecation & Documentation

**Objetivo**: Remover código deprecated, atualizar documentação, validar estado final.
**Dependência**: Todas as faixas anteriores.

### Fases

| #   | Fase                                            | Descrição                                                                                      | Testes |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------ |
| F61 | Remove `core/sdk-types.js` (se possível)        | Se nenhum consumidor externo a `src/copilot/` usa, remover. Caso contrário, manter deprecated. | 3      |
| F62 | Remove `buildSessionConfig` dead code           | Função já movida para `sdk/config.js` na Faixa 6. Remover da `sdk/session.js`.                 | 2      |
| F63 | Remove `buildAlwaysAliveConfig` (se deprecated) | Se nenhum consumidor direto, remover. Senão, manter redirect.                                  | 2      |
| F64 | Audit: zero direct SDK imports                  | `rg "from '@github/copilot-sdk'" src/copilot/ -l --glob '!sdk/'` → deve retornar 0 resultados. | 3      |
| F65 | Update ARCHITECTURE.md                          | Documentar nova arquitetura de facade SDK em `DOCUMENTAÇÃO/ARQUITETURA/`.                      | 5      |
| F66 | Update PARTE-17A/B/C                            | Adicionar seção de status "EXECUTADO" com referências de commits.                              | 3      |
| F67 | Final validation suite                          | Run completo: lint + typecheck + test:unit + test:integration. Todas as métricas verdes.       | 7      |

**Subtotal**: 7 fases, ~25 testes

---

## Ordem de Execução Recomendada

```
FASE 1 ──────────────────────────────────────────────────── (Ground layer)
   │
   ├──→ FAIXA 2 (defineTool) ─────┐
   ├──→ FAIXA 3 (approveAll) ─────┤
   ├──→ FAIXA 4 (CopilotClient) ──┤── Podem ser paralelas entre si
   └──→ FAIXA 5 (types/consts) ───┤
                                   │
                          ┌────────▼────────┐
                          │  FAIXA 6        │ (Config Unification)
                          │  Depende: 1, 4  │
                          └────────┬────────┘
                                   │
                     ┌─────────────┼─────────────┐
                     │             │              │
              ┌──────▼──────┐ ┌───▼───┐   ┌─────▼─────┐
              │ FAIXA 7     │ │FAIXA 8│   │ FAIXA 9   │
              │ Reg. Merge  │ │Barrel │   │ Hooks Type│
              │ Dep: 4, 6   │ │Dep:1,5│   │ Dep: 5    │
              └──────┬──────┘ └───┬───┘   └─────┬─────┘
                     │            │              │
                     └────────────┼──────────────┘
                                  │
                          ┌───────▼───────┐
                          │   FAIXA 10    │ (ESLint Enforcement)
                          │   Dep: 2-4, 8 │
                          └───────┬───────┘
                                  │
                          ┌───────▼───────┐
                          │   FAIXA 11    │ (API Routes Wrap)
                          │   Dep: 4, 7   │
                          └───────┬───────┘
                                  │
                          ┌───────▼───────┐
                          │   FAIXA 12    │ (Cleanup & Docs)
                          │   Dep: 1-11   │
                          └───────────────┘
```

---

## Commits Sugeridos

| Faixa | Commits | Mensagem sugerida                                                              |
| :---: | :-----: | ------------------------------------------------------------------------------ |
|   1   |   1-2   | `feat(sdk): add facade modules (tools, permissions, constants, types, config)` |
|   2   |    1    | `refactor(tools): migrate defineTool imports to sdk/tools facade`              |
|   3   |    1    | `refactor(permissions): migrate approveAll imports to sdk/permissions facade`  |
|   4   |    1    | `refactor(agent): migrate CopilotClient instantiation to sdk/client facade`    |
|   5   |    1    | `refactor(types): consolidate SDK type sources into sdk/types`                 |
|   6   |   1-2   | `refactor(config): unify session config builders into sdk/config`              |
|   7   |    1    | `refactor(session): merge session registries into unified client registry`     |
|   8   |    1    | `refactor(config): remove SDK re-exports from config barrel`                   |
|   9   |    1    | `refactor(hooks): align hook types with SDK type definitions`                  |
|  10   |    1    | `chore(lint): add no-restricted-imports for @github/copilot-sdk`               |
|  11   |    1    | `refactor(api): wrap remaining client features in sdk/client facade`           |
|  12   |   1-2   | `chore(cleanup): remove deprecated SDK wrappers, update docs`                  |

**Total estimado**: 12-15 commits

---

## Métricas de Progresso

### Checkpoint por Faixa

| Faixa | Métrica de Verificação                                                                   |
| :---: | ---------------------------------------------------------------------------------------- |
|   1   | Novos módulos exportam corretamente; testes passam                                       |
|   2   | `rg "from '@github/copilot-sdk'.*defineTool" src/copilot/ --glob '!sdk/'` → 0 matches    |
|   3   | `rg "from '@github/copilot-sdk'.*approveAll" src/copilot/ --glob '!sdk/'` → 0 matches    |
|   4   | `rg "from '@github/copilot-sdk'.*CopilotClient" src/copilot/ --glob '!sdk/'` → 0 matches |
|   5   | `core/sdk-types.js` deprecated; todos types de `sdk/types.js`                            |
|   6   | Apenas 1 config builder ativo: `buildUnifiedSessionConfig()`                             |
|   7   | `listActiveSessions()` retorna sessions de agent E API                                   |
|   8   | `config/index.js` sem re-exports de `sdk/`                                               |
|   9   | `hooks/types.js` sem typedefs paralelos ao SDK                                           |
|  10   | `npm run lint` — 0 violações de `no-restricted-imports`                                  |
|  11   | Nenhuma API route acessa `client.method()` diretamente                                   |
|  12   | `rg "from '@github/copilot-sdk'" src/copilot/ --glob '!sdk/'` → **0 matches**            |

### Métrica Final

```bash
# O comando abaixo DEVE retornar 0 resultados após Faixa 12:
rg "from '@github/copilot-sdk'" src/copilot/ --glob '!**/sdk/**' -c
# Resultado esperado: 0

# Quantidade de testes:
npm run test:unit 2>&1 | grep -E "pass|fail"
# Resultado esperado: ~3351+ pass, 0 fail (3101 base + ~250 novos)
```

---

## Riscos e Mitigações por Faixa

| Faixa | Risco Principal                             | Mitigação                                            |
| :---: | ------------------------------------------- | ---------------------------------------------------- |
|   1   | Novos módulos com exports incorretos        | Testes de import/export em cada módulo               |
|   2   | Tool quebrando por import path errado       | Testes existentes de tools + smoke tests novos       |
|   3   | Permission handler com behavior diferente   | Comparar behavior antes/depois com teste de paridade |
|   4   | Agent boot falhando com novo client wrapper | Teste de integração: full agent boot cycle           |
|   5   | Tipo ausente no novo `sdk/types.js`         | typecheck completo após cada batch                   |
|   6   | Config divergência agent vs API             | Testes de paridade field-by-field (F29-F30)          |
|   7   | Session leak no registry merge              | Testes de lifecycle: create → use → cleanup          |
|   8   | Consumidor não migrado quebrando            | `rg` antes de remover re-exports                     |
|   9   | Tipo de hook incompatível com SDK           | typecheck hooks/ + testes de hook invocation         |
|  10   | False positive/negative na ESLint rule      | Dry run com análise manual                           |
|  11   | API route regression                        | Testes HTTP de cada endpoint afetado                 |
|  12   | Arquivo removido ainda referenciado         | `rg` + typecheck + test suite completo               |

---

## Estimativa de Esforço

| Faixa | Complexidade | Horas est. (agente) | Horas est. (humano) |
| :---: | :----------: | :-----------------: | :-----------------: |
|   1   |    Média     |         ~2h         |         ~4h         |
|   2   |    Baixa     |         ~1h         |         ~2h         |
|   3   |    Baixa     |        ~0.5h        |         ~1h         |
|   4   |  Média-Alta  |         ~2h         |         ~4h         |
|   5   |    Média     |        ~1.5h        |         ~3h         |
|   6   |     Alta     |         ~3h         |         ~6h         |
|   7   |     Alta     |        ~2.5h        |         ~5h         |
|   8   |    Baixa     |         ~1h         |         ~2h         |
|   9   |    Média     |        ~1.5h        |         ~3h         |
|  10   |    Baixa     |        ~0.5h        |         ~1h         |
|  11   |    Média     |         ~2h         |         ~3h         |
|  12   |    Média     |         ~2h         |         ~4h         |

---

## Checklist de Qualidade por Faixa

Cada faixa deve satisfazer antes de commit:

- [ ] `npm run lint` — 0 erros
- [ ] `npm run format:check` — 0 diffs
- [ ] `npm run typecheck:node` — 0 erros novos
- [ ] `npm run test:unit` — 0 falhas
- [ ] Se tocar `sdk/client.js` ou `sdk/session.js` → `npm run test:integration`
- [ ] `rg` de verificação específico da faixa (vide Métricas de Progresso)

---

*Documento gerado pela auditoria PARTE-17, rev.3. Roadmap de transformação arquitetural para SDK Facade.*
