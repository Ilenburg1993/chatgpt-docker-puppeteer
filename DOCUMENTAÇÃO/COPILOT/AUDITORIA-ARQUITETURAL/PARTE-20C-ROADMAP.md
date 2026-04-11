# PARTE-20C — Roadmap: Migração para Arquitetura Ideal de `src/copilot`

**Data**: 2026-04-10 | **Status**: Canônico — Em Execução | **Versão**: 1.1  
**Referência**: PARTE-20A (problemas), PARTE-20B (ideal), PARTE-20D (grafos), PARTE-20E (critérios)  
**Última atualização de progresso**: 2026-04-11

---

## Visão Geral do Roadmap

O roadmap está organizado em **7 faixas temáticas** (A–G), cada uma com **múltiplas fases** e subfases. As faixas são projetadas para serem executadas em paralelo quando possível, mas respeitando as dependências entre elas.

| Faixa | Tema | Prioridade | Esforço |
|---|---|---|---|
| **A** | Violações Críticas de Camada | 🔴 Imediata | Médio |
| **B** | God Objects — Decomposição | 🔴 Alta | Alto |
| **C** | Duplicações e SSOT | 🟠 Alta | Médio |
| **D** | Reorganização de Módulos | 🟠 Alta | Médio |
| **E** | Injeção de Dependência | 🟠 Média | Alto |
| **F** | Nomenclatura e Contratos | 🟡 Média | Baixo |
| **G** | Hardening e Automação | 🟡 Baixa | Médio |

---

## FAIXA A — Violações Críticas de Camada

> **Objetivo**: Eliminar as 3 violações de importação que invertem a hierarquia de dependências.  
> **Blocker**: Nenhum — pode começar imediatamente.  
> **Critérios satisfeitos**: C2

### FA-1 — Fix: `core/error-handlers.js` não deve importar `observability/` ✅ CONCLUÍDO

**Subfase FA-1.1 — Análise e estratégia**
- [x] Ler `core/error-handlers.js` completo — entender como `logger` e `errorTracker` são usados
- [x] Mapear todos os 20 call sites de `core/error-handlers.js` (maior fan-in do sistema)
- [x] Decidir estratégia: (c) callback injection via `registerCoreErrorHandler()`

**Subfase FA-1.2 — Implementar solução**
- [x] Adicionar `registerCoreErrorHandler(logger, tracker)` em `core/error-handlers.js`
- [x] Criar `observability/bootstrap.js` que chama `registerCoreErrorHandler(logger, errorTracker)`
- [x] Modificar `core/error-handlers.js` para usar funções registradas em vez de imports estáticos
- [x] Garantir que bootstrap.js é chamado no `src/main.js` antes de qualquer uso

**Subfase FA-1.3 — Validação**
- [x] `npm run typecheck:node` → 0 errors
- [x] `npm run test:unit` → baseline mantido
- [x] Verificado: `core/` não importa mais de `observability/`

---

### FA-2 — Fix: `agent/lifecycle/agent-lifecycle.js` não deve importar `terminal/` ✅ CONCLUÍDO

**Subfase FA-2.1 — Análise**
- [x] Ler `agent/lifecycle/agent-lifecycle.js` — entender uso de `getHubSessionId`
- [x] Verificar se `terminal/state.js` tem outros consumidores no `agent/`
- [x] Decidir estratégia: (a) `core/shared-state.js`

**Subfase FA-2.2 — Criar `core/shared-state.js`**
- [x] Criar `core/shared-state.js` com `getHubSessionId()` + setter
- [x] `terminal/state.js` passa a delegar para `core/shared-state.js`
- [x] `agent/lifecycle/agent-lifecycle.js` importa de `core/shared-state.js`

**Subfase FA-2.4 — Validação**
- [x] Verificado zero `agent → terminal` edges para hubSessionId
- [x] `npm run test:unit` → baseline mantido
- [x] `npm run typecheck:node` → 0 errors

---

### FA-3 — Fix: `bridges/nerv-bridge.js` não deve importar `agent/` ✅ CONCLUÍDO

**Subfase FA-3.1 — Análise**
- [x] Ler `bridges/nerv-bridge.js` — entender o que usa de `agent/index.js`
- [x] Mapear todos os consumidores de `nerv-bridge.js`
- [x] Decidir: (a) injeção na factory

**Subfase FA-3.2 — Refatorar como publisher passivo**
- [x] Refatorar `createNervBridge(agent)` factory — `nerv-bridge.js` não importa `agent/` mais
- [x] Atualizar caller (`boot-wiring.js`) para usar a factory
- [x] Bridge publica eventos via agent injetado

**Subfase FA-3.3 — Validação**
- [x] Verificado zero `bridges → agent` edges directos
- [x] `npm run typecheck:node` → 0 errors

---

## FAIXA B — God Objects — Decomposição

> **Objetivo**: Dividir os 4 god objects (>450 LoC, múltiplos concerns) em módulos coesos.  
> **Blocker**: FA-1 e FA-2 devem ser concluídas antes de decompor `always-alive.js`.  
> **Critérios satisfeitos**: C1, C5

### FB-1 — Decomposição de `agent/always-alive.js` (603 LoC) ⭐ AVALIADO — JÁ É FACADE

> **Avaliação (2026-04-11)**: A leitura completa das 603 linhas revelou que `always-alive.js` já está
> bem decomposto: toda lógica real foi extraída para `agent-lifecycle.js`, `agent-messaging.js`,
> `agent-state.js`, `agent-dialog-controller.js`, `queue-processor.js` etc. O arquivo restante é
> puramente facade/proxy + JSDoc (nenhum método contém lógica de negócio). Decompor mais seria
> over-engineering (criaria mais indireção sem ganho real de coesão ou testabilidade).

**Subfase FB-1.1 — Mapeamento de concerns**
- [x] Ler `agent/always-alive.js` completo — mapear responsabilidades por seção
- [x] Identificar: bootstrap, conexão/reconexão, configuração de tools, public API, state management
- [x] Conclusão: todos os concerns já estão delegados para módulos dedicados

**Subfases FB-1.2/1.3/1.4/1.5 — Não necessárias**
- [x] O arquivo já é uma facade pura: extrair mais seria over-engineering
- [ ] Nenhum API externo quebrado (verificar todos os importadores)

---

### FB-2 — Decomposição de `agent/dialog/loop-manager.js` (600 LoC) ⭐ AVALIADO — COESO

> **Avaliação (2026-04-11)**: A leitura completa revelou que `loop-manager.js` já delegou lógica
> para `turn-executor.js`, `backpressure.js`, `watchdog.js`, `protocol.js`, `model-fallback.js` e
> `event-wiring.js`. Os ~600 LoC restantes são ~40% JSDoc e o resto é uma classe coesa
> (`DialogLoopManager`) cujas responsabilidades (start/stop/pause/resume/sendTurn) são todas
> facetas do mesmo concern: ciclo de vida do dialog loop. Decompor mais fragmentaria uma abstração
> naturalmente coesa.

**Subfase FB-2.1 — Mapeamento de concerns**
- [x] Ler `loop-manager.js` — mapear: loop principal, retry logic, event dispatch, abort, model fallback, backpressure
- [x] Verificar relação com `backpressure.js`, `watchdog.js`, `turn-executor.js`, `model-fallback.js`, `protocol.js`
- [x] Conclusão: a classe é coesa; lógica pesada já foi extraída para sub-módulos dedicados

**Subfases FB-2.2/2.3/2.4/2.5 — Não necessárias**
- [x] O arquivo é uma classe coesa com responsabilidade única: dialog loop lifecycle

---

### FB-3 — Decomposição de `conversation-hub/store.js` (562 LoC)

**Subfase FB-3.1 — Análise do store**
- [ ] Ler `store.js` — mapear: CRUD básico, queries, índices, snapshot, migração
- [ ] Verificar `store-helpers.js`, `store-queries.js`, `store-sync.js`, `store-memories.js` — já parcialmente extraídos?
- [ ] Definir o que ainda está no store.js que deveria estar nos outros

**Subfase FB-3.2 — Criar `conversation-hub/store/` subdiretório**
- [ ] Mover `store.js` + variants para `store/`
- [ ] `store.js` → `store/store-core.js` (CRUD básico, < 200 LoC)
- [ ] Extrair para `store/store-indexes.js` (índices em memória)
- [ ] Atualizar `conversation-hub/index.js`

**Subfase FB-3.3 — Validação**
- [ ] `conversation-hub/index.js` mantém API pública idêntica
- [ ] `npm run test:unit` passa

---

### FB-4 — Decomposição de `channel/inject.js` (451 LoC)

**Subfase FB-4.1 — Análise**
- [ ] Ler `inject.js` — mapear: criação de sessão temporária, envio de mensagem, gestão de resposta, retry, abort
- [ ] Definir fronteiras: `session-factory.js` vs `message-injector.js`

**Subfase FB-4.2 — Criar `channel/session-factory.js`**
- [ ] Extrair criação/gestão de sessão temporária
- [ ] Máximo 200 LoC

**Subfase FB-4.3 — Criar `channel/message-injector.js`**
- [ ] Extrair lógica de injeção de mensagem, streaming, retry
- [ ] Máximo 200 LoC

**Subfase FB-4.4 — Atualizar `channel/index.js`**
- [ ] Re-export das novas factories
- [ ] Manter compatibilidade retroativa

---

### FB-5 — Divisão de arquivos grandes em outros módulos (>400 LoC)

**Subfase FB-5.1 — `channel/client.js` (557 LoC)**
- [ ] Extrair protocolo StructuredMessage para `client-structured-protocol.js`
- [ ] `client.js` fica < 250 LoC (chat, história, questão básica)

**Subfase FB-5.2 — `audit/pipeline.js` (537 LoC)**
- [ ] Extrair handlers de pipeline para `pipeline-handlers.js`
- [ ] `pipeline.js` fica com core < 200 LoC

**Subfase FB-5.3 — `conversation-hub/socket-ns.js` (482 LoC)**
- [ ] Extrair handlers de socket para `socket-ns-handlers.js`
- [ ] `socket-ns.js` fica com setup < 200 LoC

**Subfase FB-5.4 — `sdk/rpc.js` (484 LoC)**
- [ ] Extrair `rpc-client.js` + `rpc-server.js`
- [ ] `rpc.js` como barrel ou core < 200 LoC

**Subfase FB-5.5 — `conversation-hub/orchestrator.js` (438 LoC)**
- [ ] Extrair estratégias de retry/fallback para `orchestrator-strategies.js`
- [ ] `orchestrator.js` fica < 250 LoC

**Subfase FB-5.6 — `observability/observers/dialog-task-handlers.js` (424 LoC)**
- [ ] Separar handlers de dialog de handlers de task
- [ ] `dialog-handlers.js` + `task-handlers.js`

---

## FAIXA C — Duplicações e SSOT

> **Objetivo**: Eliminar as 6 duplicações de responsabilidade.  
> **Critérios satisfeitos**: C6

### FC-1 — Unificar `url-validator` em `core/security/` ✅ CONCLUÍDO

**Subfase FC-1.1**
- [x] Criar `core/security/` diretório
- [x] Criar `core/security/url-validator.js` unificado (5 exports: `isPrivateIp`, `validateUrl`, `validateUrlString`, `validateWebhookUrl`, `checkResolvedIp`)
- [x] União: API funcional `{safe, reason}` do sdk/ + throws API + DNS rebinding do agent/infra/
- [x] Atualizar imports: `webhook-manager.js`, `web-tools.js`, `webhooks.js` → `#copilot/core/security/url-validator`
- [x] Originais convertidos em shims deprecated com re-export
- [x] Barrels atualizados: `agent/infra/index.js` e `sdk/index.js`

---

### FC-2 — Unificar configuração de sessão (`config/` + `sdk/config.js`)

**Subfase FC-2.1 — Análise**
- [ ] Ler `config/session-config.js` e `sdk/config.js` — mapear diferenças e sobreposições
- [ ] Identificar qual dos dois tem mais funcionalidades e quais chamadores cada um tem

**Subfase FC-2.2 — Consolidar em `config/session-config.js`**
- [ ] Mover toda lógica de merge de config de `sdk/config.js` para `config/session-config.js`
- [ ] `sdk/config.js` vira re-export ou é removido
- [ ] Atualizar todos os importadores

---

### FC-3 — Resolver conflito de naming `session-lifecycle` (hooks vs sdk) ✅ CONCLUÍDO

**Subfase FC-3.1**
- [x] Renomear `hooks/session-lifecycle.js` → `hooks/session-hooks.js` (original virou shim deprecated)
- [x] Renomear `sdk/session-lifecycle.js` → `sdk/sdk-session-wrapper.js` (original virou shim deprecated)
- [x] Atualizar importadores: `hooks/index.js`, `sdk/index.js`, `agent/lifecycle/session-setup.js`
- [x] `npm run typecheck:node` → 0 errors

---

### FC-4 — Centralizar pipeline de auditoria

**Subfase FC-4.1**
- [ ] Confirmar que `hooks/presets/audit.js` já usa `audit/ring-buffer.js` (não duplica código)
- [ ] Confirmar que `observability/event-collector.js` não duplica lógica de `audit/pipeline.js`
- [ ] Se houver duplicação: criar interface única em `audit/` para event collection

---

### FC-5 — Resolver handlers duplicados no terminal ✅ CONCLUÍDO

**Subfase FC-5.1**
- [x] Comparar `terminal/handlers-agent.js` vs `terminal/handlers/agent.js` — eram re-export shims
- [x] Verificado: zero importadores externos (apenas auto-referências e JSDoc comments)
- [x] Removidos: `terminal/handlers-agent.js`, `handlers-dialog.js`, `handlers-shared.js`, `handlers-system.js`
- [x] `terminal/index.js` e `terminal/route-table.js` já usavam versão em `handlers/`

---

### FC-6 — `terminal/dialog.js` vs `agent/dialog/`

**Subfase FC-6.1**
- [ ] Documentar claramente em JSDoc/README a distinção:
  - `agent/dialog/` = diálogo do agente com o SDK Copilot (loop de AI)
  - `terminal/dialog.js` = re-export de `terminal/dialog/` (motor do terminal interativo LLM-B)
- [ ] Renomear `terminal/dialog.js` → `terminal/terminal-dialog.js` para eliminar ambiguidade

---

## FAIXA D — Reorganização de Módulos

> **Objetivo**: Reorganizar módulos com baixa coesão e fronteiras mal definidas.  
> **Critérios satisfeitos**: C1, C3

### FD-1 — Reorganizar `bridges/` por natureza

**Subfase FD-1.1 — Criar subdiretórios**
- [ ] Criar `bridges/git/`, `bridges/mcp/`, `bridges/nerv/`
- [ ] Mover `git-bridge.js` → `bridges/git/git-bridge.js`
- [ ] Mover `bridges/gh/` → `bridges/git/github/`
- [ ] Mover `mcp-tool-bridge.js`, `mcp-tool-schema.js` → `bridges/mcp/`
- [ ] Refatorar/mover `nerv-bridge.js` → `bridges/nerv/event-publisher.js`
- [ ] Atualizar `bridges/index.js` como barrel

**Subfase FD-1.2 — Criar README.md para `bridges/`**
- [ ] Documentar os 3 sub-domínios e quando usar cada um

---

### FD-2 — Mover `logs/` para fora de `src/`

**Subfase FD-2.1**
- [ ] Identificar onde os log paths são configurados (`config/env.js`)
- [ ] Criar `var/logs/copilot/` no projeto
- [ ] Atualizar `config/env.js` para apontar para novo path
- [ ] Atualizar `.gitignore` para excluir `var/logs/`
- [ ] Mover arquivos de log existentes
- [ ] Remover `src/copilot/logs/`

---

### FD-3 — Clarificar fronteira `channel/` vs `conversation-hub/`

**Subfase FD-3.1 — Documentação**
- [ ] Criar `channel/README.md` — definir escopo: "Client LLM-A ↔ LLM-B via AlwaysAliveAgent"
- [ ] Criar `conversation-hub/README.md` — definir escopo: "Gestão multi-sessão de conversas"
- [ ] Verificar se `conversation-hub → channel` edge é legítima ou deve ser removida

---

### FD-4 — Criar READMEs para todos os módulos ✅ CONCLUÍDO

Para cada módulo de nível 1: `agent/`, `api/`, `audit/`, `bridges/`, `channel/`, `config/`, `conversation-hub/`, `core/`, `db/`, `hooks/`, `observability/`, `sdk/`, `terminal/`, `tools/`

**Subfase FD-4.x (1 task por módulo)**
- [x] `core/README.md` — L0, contracts & utils, import rules
- [x] `sdk/README.md` — L1-L2, SDK wrapper
- [x] `agent/README.md` — L4, AlwaysAliveAgent orchestration
- [x] `tools/README.md` — L3, custom tool definitions
- [x] `bridges/README.md` — L3, NERV/MCP/Git adapters
- [x] `hooks/README.md` — já existia previamente
- [x] `observability/README.md` — L2, logging & metrics
- [x] `config/README.md` — L1, env vars & session config
- [x] `terminal/README.md` — L6, REPL + inject server
- [x] `channel/README.md` — L5, LLM-A↔LLM-B messaging
- [x] `conversation-hub/README.md` — L5, multi-session management
- [x] `api/README.md` — L6, Express routes
- [x] `audit/README.md` — L2, audit pipeline
- [x] `db/README.md` — L1, persistence

---

### FD-5 — Terminal: consolidar estrutura

**Subfase FD-5.1 — Limpar flat handlers (FA-5)**
- (coberto em FC-5)

**Subfase FD-5.2 — Reorganizar terminal internals**
- [ ] Criar `terminal/repl/` subdir para `repl.js`, `repl-listeners.js`
- [ ] Criar `terminal/server/` subdir para `server.js`, `index.js`, `route-table.js`
- [ ] Mover `terminal/state.js` para `terminal/state/index.js` (ou deixar flat após FC-2 hubSessionId fix)
- [ ] Atualizar todos os imports internos do terminal

---

## FAIXA E — Injeção de Dependência

> **Objetivo**: Eliminar singleton imports diretos em camadas superiores.  
> **Blocker**: FAIXA A deve estar completa.  
> **Critérios satisfeitos**: C4

### FE-1 — `api/express/**` — factory pattern com DI

**Subfase FE-1.1 — Análise**
- [ ] Listar todas as 5 express routes que importam `alwaysAliveAgent` diretamente
- [ ] Verificar se roteamento já suporta factories

**Subfase FE-1.2 — Criar router factory**
- [ ] Modificar `api/express/index.js` para exportar `createRouter(agent)` factory
- [ ] Atualizar `api/express/agent.js`, `webhooks.js`, `client.js`, `observability.js` para receber `agent` como parâmetro
- [ ] O caller (`src/main.js` ou bootstrap) injeta `alwaysAliveAgent` uma vez

**Subfase FE-1.3 — Validação**
- [ ] Nenhum express route faz `import { alwaysAliveAgent }` direto
- [ ] `npm run test:integration` passa

---

### FE-2 — `channel/client.js` e `channel/inject.js` — DI explícita

**Subfase FE-2.1**
- [ ] Modificar `LlmBridgeClient` para receber `agent` no constructor: `new LlmBridgeClient(agent)`
- [ ] Modificar `inject.js` factories para receber `agent` como parâmetro
- [ ] Atualizar todos os callers

---

### FE-3 — `terminal/` — passar agent no bootstrap

**Subfase FE-3.1**
- [ ] Modificar `terminal/index.js` para receber `agent` como parâmetro de inicialização
- [ ] Propagar `agent` internamente via context/state — sem imports diretos de `agent/index.js`
- [ ] `terminal/repl.js`, `terminal/dialog/engine.js`, `terminal/handlers/*` recebem agent do context

---

### FE-4 — `bridges/nerv/` — DI na factory

- (coberto em FA-3.2)

---

### FE-5 — `observability/agent-event-observer.js` — receber agent por parâmetro

**Subfase FE-5.1**
- [ ] Modificar `createAgentEventObserver(agent)` para aceitar agent como parâmetro
- [ ] Atualizar callers

---

## FAIXA F — Nomenclatura e Contratos

> **Objetivo**: Eliminar nomes ambíguos e criar contratos explícitos.  
> **Critérios satisfeitos**: C3, C7

### FF-1 — Renomeações prioritárias

**Subfase FF-1.1 — Módulo-nível** (sem mudança de comportamento)
- [ ] `hooks/session-lifecycle.js` → `hooks/session-hooks.js` (FC-3 acima)
- [ ] `sdk/session-lifecycle.js` → `sdk/sdk-session-wrapper.js` (FC-3 acima)
- [ ] `terminal/dialog.js` → `terminal/terminal-dialog.js` (FC-6 acima)
- [ ] `agent/types.js` → `agent/agent-types.js`
- [ ] `hooks/types.js` → `hooks/hook-types.js`
- [ ] `core/events.js` → `core/event-types.js`
- [ ] `core/schemas.js` → `core/validation-schemas.js`

**Subfase FF-1.2 — Arquivo-nível**
- [ ] `sdk/utils.js` → avaliar conteúdo, renomear descritivamente
- [ ] `bridges/gh/shared.js` → `bridges/gh/gh-shared.js` ou `bridges/gh/auth.js` (dependendo do conteúdo)

---

### FF-2 — Documentar API pública de cada módulo

Para os 5 módulos mais importados:

**Subfase FF-2.1 — `core/index.js`**
- [ ] Adicionar JSDoc de topo com lista de exports e intenção de uso

**Subfase FF-2.2 — `agent/index.js`**
- [ ] Documentar: quais exports são para uso externo vs interno

**Subfase FF-2.3 — `sdk/index.js`**
- [ ] 35 exports — verificar se todos são necessários; candidatos a remoção/consolidação

**Subfase FF-2.4 — `tools/index.js`**
- [ ] Apenas 2 exports — verificar se public API está completa

**Subfase FF-2.5 — `hooks/index.js`**
- [ ] 20 exports — verificar se todos são públicos ou se alguns são internals vazando

---

### FF-3 — Contratos via typedefs centralizadas

**Subfase FF-3.1**
- [ ] Verificar que toda interface pública entre módulos tem typedef em `sdk/types.js` ou no `types.js` do próprio módulo
- [ ] Garantir que nenhum módulo usa `@type {any}` na sua API pública
- [ ] Adicionar `@module` tag a todos os arquivos que ainda não têm

---

## FAIXA G — Hardening e Automação de CI

> **Objetivo**: Garantir que a arquitetura ideal é mantida automaticamente.  
> **Blocker**: FAIXAS A, B, C, D devem estar majoritariamente completas.  
> **Critérios satisfeitos**: C2 (enforcement), C5 (gate)

### FG-1 — CI gate: violações de camada

**Subfase FG-1.1**
- [ ] Criar `scripts/check-layer-violations.js` usando `madge --json`
- [ ] Definir lista de dependências proibidas (based on C2 hierarchy)
- [ ] Script retorna exit code 1 se qualquer violação encontrada
- [ ] Adicionar ao pipeline CI (`npm run check:layers`)

---

### FG-2 — CI gate: tamanho de arquivos

**Subfase FG-2.1**
- [ ] Criar `scripts/check-file-size.js` — alerta arquivos > 300 LoC, falha em > 400 LoC
- [ ] Excluir `sdk/types.js` e barrels da verificação
- [ ] Adicionar ao CI como warning inicialmente, depois falha

---

### FG-3 — Testes de contrato entre módulos

**Subfase FG-3.1 — `agent/` → `tools/`**
- [ ] Teste: `tools/index.js` exporta todos os tools esperados pelo bootstrap

**Subfase FG-3.2 — `api/` → `agent/`**
- [ ] Teste de integração: router factory funciona com agent mockado

**Subfase FG-3.3 — `bridges/` → sem agent**
- [ ] Teste: importar qualquer arquivo de `bridges/` não deve importar `agent/`

---

### FG-4 — Documetação de arquitetura auto-gerada

**Subfase FG-4.1**
- [ ] `npm run docs:deps` — gera grafo de dependências atualizado (madge → SVG)
- [ ] Adicionar ao README.md de `src/copilot/`
- [ ] Script verifica se grafo atual difere do grafo aprovado → alerta em PR

---

### FG-5 — Cobertura de testes por módulo

**Subfase FG-5.1 — Auditoria de cobertura**
- [ ] Para cada módulo: verificar se existe arquivo de teste correspondente
- [ ] Listar módulos sem teste: `agent/infra/`, `bridges/`, `channel/`, `config/`

**Subfase FG-5.2 — Criar testes mínimos**
- [ ] `tests/copilot/bridges/` — testes de bridges (mock de infra externa)
- [ ] `tests/copilot/channel/` — testes de channel client
- [ ] `tests/copilot/config/` — testes de builders de config

---

## Sequência de Execução Recomendada

```
FASE 1 — Correções Imediatas (sem risco, alta prioridade) ✅ CONCLUÍDA
  FA-1 (core→observability fix) ✅
  FA-2 (agent→terminal fix) ✅
  FA-3 (bridges→agent fix) ✅
  FD-2 (mover logs/) — PENDENTE (baixo risco, adiado para Fase 5)
  FC-5 (eliminar handlers duplos terminal) ✅

FASE 2 — Refatoração Estrutural Low-Risk ✅ CONCLUÍDA
  FC-1 (url-validator unificado) ✅
  FC-3 (renomear session-lifecycle) ✅
  FF-1 (renomeações) — PARCIAL (FC-3 cobre hooks + sdk; types/schemas adiado por risco JSDoc)
  FD-1 (reorganizar bridges/) — PENDENTE
  FD-4 (READMEs de módulo) ✅

FASE 3 — Decomposição de God Objects — EM ANDAMENTO
  FB-1 (always-alive.js) ⭐ JÁ É FACADE — decomposição desnecessária
  FB-2 (loop-manager.js) — PRÓXIMO
  FB-3 (store.js)
  FB-4 (inject.js)
  FB-5 (demais arquivos grandes)

FASE 4 — Injeção de Dependência
  FE-1 (api/ DI)
  FE-2 (channel/ DI)
  FE-3 (terminal/ DI)
  FE-4 (bridges/ DI)
  FE-5 (observability/ DI)

FASE 5 — Consolidação e Contratos
  FC-2 (config/ consolidação)
  FC-4 (audit centralização)
  FF-2 (documentar APIs públicas)
  FF-3 (typedefs e contratos)
  FD-3 (clarificar channel vs hub)

FASE 6 — Hardening de CI
  FG-1 (gate layer violations)
  FG-2 (gate file size)
  FG-3 (testes de contrato)
  FG-4 (docs auto-geradas)
  FG-5 (cobertura de testes)
```

---

## Estimativa de Número de Tarefas

| Faixa | Subfases | Esforço estimado | Status |
|---|---|---|---|
| A — Violações | 10 subfases | 3–5 sessões | ✅ CONCLUÍDA |
| B — God Objects | 20 subfases | 6–10 sessões | ⚡ Em andamento |
| C — Duplicações | 10 subfases | 3–5 sessões | 🟡 Parcial (FC-1/3/5 OK) |
| D — Reorganização | 15 subfases | 3–5 sessões | 🟡 Parcial (FD-4 OK) |
| E — DI | 10 subfases | 4–6 sessões | ⬜ Pendente |
| F — Nomenclatura | 8 subfases | 2–3 sessões | 🟡 Parcial (FC-3 cobre FF-1 parcial) |
| G — Hardening | 10 subfases | 3–5 sessões | ⬜ Pendente |
| **Total** | **~83 subfases** | **24–39 sessões** | |

---

## Correções de Lint/Quality Aplicadas (fora das faixas)

- **`await await` duplo** em `terminal/handlers/system-config.js:305,326` — bug corrigido
- **`@ts-nocheck`** em 4 spec files SDK — adicionado `eslint-disable @typescript-eslint/ban-ts-comment`
- **`@ts-ignore`** em `test_sdk_session_lifecycle.spec.js:119` — substituído por `@ts-expect-error`
- **`eslint-disable` unused** em `agent/session/boot-wiring.js:173` — diretiva removida

---

## Estado Esperado ao Final do Roadmap

```
src/copilot/
├── Hierarquia de camadas: ✅ ENFORÇADA POR CI
├── Violações de camada: ✅ ZERO
├── Ciclos arquiteturais: ✅ ZERO
├── God objects >400 LoC: ✅ ZERO
├── Duplicações de responsabilidade: ✅ ZERO
├── READMEs de módulo: ✅ 14/14
├── Testes de contrato: ✅ Cobrindo boundaries críticos
├── DI em camadas superiores: ✅ Sem singleton import direto
├── Logs runtime: ✅ Fora de src/
└── Nomenclatura consistente: ✅ Sem nomes ambíguos
```

**Resultado final**: `src/copilot` sustentável, auditável, extensível e com arquitetura compreensível por qualquer desenvolvedor em < 30 minutos de leitura dos READMEs e do grafo de dependências.
