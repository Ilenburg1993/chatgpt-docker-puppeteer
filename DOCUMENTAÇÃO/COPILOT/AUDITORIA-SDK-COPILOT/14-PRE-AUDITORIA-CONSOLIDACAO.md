# 14 — Pré-Auditoria de Consolidação: Plano de Migração Unificado

**Data**: 2026-03-21
**Propósito**: Planejar a série de documentos que consolidam e ampliam o roadmap de migração
da situação atual para a situação ideal de `src/copilot/`.
**Input**: Todos os 15 documentos existentes (00-13 + este).

---

## 1. Diagnóstico do Estado Documental Atual

### 1.1 Documentos existentes e seus papéis

| # | Documento | Linhas | Papel | Status |
|---|-----------|--------|-------|--------|
| 00 | [00-PRE-AUDITORIA.md](./00-PRE-AUDITORIA.md) | ~200 | Escopo original da auditoria SDK | Finalizado |
| 01 | [01-INVENTARIO-SDK-COMPLETO.md](./01-INVENTARIO-SDK-COMPLETO.md) | ~200 | Mapeamento API-a-API do SDK | Finalizado |
| 02 | [02-GAPS-FUNCIONAIS-SDK.md](./02-GAPS-FUNCIONAIS-SDK.md) | ~300 | Gaps funcionais organizados em faixas | Finalizado |
| 03 | [03-BUGS-MISALIGNMENTS.md](./03-BUGS-MISALIGNMENTS.md) | ~200 | BUG-01 a BUG-11 catalogados | Finalizado |
| 04 | [04-ARQUITETURA-ATUAL.md](./04-ARQUITETURA-ATUAL.md) | ~200 | Diagrama de 5 camadas original | Finalizado |
| 05 | [05-ARQUITETURA-IDEAL.md](./05-ARQUITETURA-IDEAL.md) | ~100 | Proposta 7 camadas (SDK-focused) | **Supersedido por 13** |
| 06 | [06-TSSERVER-SDK-INTERNALIZACAO.md](./06-TSSERVER-SDK-INTERNALIZACAO.md) | ~150 | TSServer ↔ SDK integration | Finalizado |
| 07 | [07-ROADMAP-MASTER.md](./07-ROADMAP-MASTER.md) | ~720 | Roadmap com 12 faixas (A-L) | **Complexo e fragmentado** |
| 08a | [08-SYSTEM-PROMPT-MODULAR.md](./08-SYSTEM-PROMPT-MODULAR.md) | ~100 | Design do system prompt modular | Finalizado |
| 08b | [08-AUDITORIA-DUPLICATAS-IMPORTS.md](./08-AUDITORIA-DUPLICATAS-IMPORTS.md) | ~150 | Auditoria de imports duplicados | Finalizado |
| 09 | [09-AGENT-LOGICA-FLUXO.md](./09-AGENT-LOGICA-FLUXO.md) | ~400 | Lógica e fluxo completo do agent | Finalizado |
| 10 | [10-AGENT-SITUACAO-ATUAL.md](./10-AGENT-SITUACAO-ATUAL.md) | ~300 | Análise crítica do agent (9 débitos) | Finalizado |
| 11 | [11-AGENT-SITUACAO-IDEAL.md](./11-AGENT-SITUACAO-IDEAL.md) | ~300 | Proposta K1-K8 para agent | Finalizado |
| 12 | [12-ARQUITETURA-GERAL-AUDITORIA-PROFUNDA.md](./12-ARQUITETURA-GERAL-AUDITORIA-PROFUNDA.md) | ~400 | Auditoria completa de 408 arquivos | Finalizado |
| 13 | [13-ARQUITETURA-IDEAL-GERAL.md](./13-ARQUITETURA-IDEAL-GERAL.md) | ~300 | Proposta de consolidação C1-C11 | Finalizado |

### 1.2 Problemas do roadmap atual (07)

O `07-ROADMAP-MASTER.md` cresceu organicamente ao longo de múltiplas sessões e apresenta:

1. **Fragmentação**: 12 faixas (A-L) com sobreposições entre G/K/L e entre J/L
2. **Sobreposições não resolvidas**: G1↔K1↔L2 (agent decomposition), G3↔L4 (event routing), G4↔L1 (cleanup), J2↔L1 (dead code)
3. **Sequenciamento ambíguo**: Sprints 4-7 têm dependências cruzadas não totalmente explícitas
4. **Faixas concluídas poluem a leitura**: A, I, B, C, E estão ✅ mas ocupam ~40% do doc
5. **Falta contexto técnico**: Cada subfase tem 1 linha — insuficiente para um agente sem contexto
6. **Estimativas imprecisas**: Faixas G e D foram estimadas antes da auditoria profunda (doc 12)
7. **Sem critérios de validação por fase**: Apenas métricas globais no final
8. **Sem inventário de riscos por fase**: Apenas risco geral por faixa

### 1.3 O que falta para um plano de migração completo

Para que um agente LLM possa executar o plano sem contexto prévio, cada documento deve conter:

- **Contexto técnico**: Quais arquivos existem, o que fazem, quantas linhas
- **Motivação**: Por que esta mudança é necessária (com evidência)
- **Passos atômicos**: Cada passo é 1 operação verificável (criar/mover/deletar/editar)
- **Validação**: Comando(s) para validar que o passo foi executado corretamente
- **Rollback**: Como reverter se algo falhar
- **Dependências**: O que deve estar concluído antes de iniciar este passo

---

## 2. Plano de Documentos a Gerar

### Estrutura proposta: Série MIGRAÇÃO-* (M-00 a M-07)

Todos os novos documentos ficam em: `DOCUMENTAÇÃO/COPILOT/PLANO-MIGRACAO/`

| # | Documento | Conteúdo | Estimativa de linhas |
|---|-----------|----------|---------------------|
| **M-00** | `M-00-VISAO-GERAL.md` | Master doc: visão geral do plano de migração, mapa de documentos, sequenciamento, métricas globais, progresso tracker. Substitui/consolida o papel do 07-ROADMAP-MASTER.md como ponto de entrada. | ~400L |
| **M-01** | `M-01-INVENTARIO-SITUACAO-ATUAL.md` | Inventário completo e autocontido: todos os 408 arquivos organizados por módulo com path, linhas e responsabilidade. Consolida dados de docs 01, 04, 09, 12. Serve como referência para todos os M-0x. | ~600L |
| **M-02** | `M-02-FASE-CLEANUP.md` | Fase 1: Quick wins e limpeza. Remove api/, services/, dead code. Move configs. Consolida L1 + J2 + G4 parcial. Cada passo com: arquivo(s) afetado(s), comando, validação. | ~500L |
| **M-03** | `M-03-FASE-AGENT-REFACTOR.md` | Fase 2: Refactoring do agent (K1-K8 completo + L2). AgentContext partitioning, test coverage, boot pipeline, message chain simplification, event bridge, health check. Cada passo atômico. | ~700L |
| **M-04** | `M-04-FASE-SDK-STATELESS.md` | Fase 3: Tornar sdk/ stateless (L3 + J1 + J2 residual). Mover session registry, remover sdk/config.js, alinhar imports. Cada passo atômico. | ~400L |
| **M-05** | `M-05-FASE-EVENT-UNIFICATION.md` | Fase 4: Unificação de event bus (L4 + G3 + K6 consolidado). Merge 3 buses, bridge automático, observability trim. Cada passo atômico. | ~500L |
| **M-06** | `M-06-FASE-OBSERVABILITY-ERRORS.md` | Fase 5: Error pipeline + observability consolidation (L5 + K3 + parte de F1/F2). Error pipeline unificado, OTEL cleanup, health endpoints. | ~400L |
| **M-07** | `M-07-FASES-FUTURAS.md` | Fases 6+: Features novas não refatoração (D1-D5 experimental RPC, H1-H2 TSServer, G2 Hub lifecycle). Mantém detalhamento mas como "roadmap futuro" pós-migração. | ~400L |

**Total estimado**: ~3.900L em 8 documentos.

### Relação entre documentos existentes e novos

```
                    EXISTENTES (00-13)                    NOVOS (M-00 a M-07)
                    ──────────────────                    ────────────────────

00-PRE-AUDITORIA ─────────────────┐
01-INVENTÁRIO-SDK ────────────────┤
04-ARQUITETURA-ATUAL ─────────────┼──► M-01 (inventário consolidado)
09-AGENT-LOGICA-FLUXO ───────────┤
12-AUDITORIA-PROFUNDA ───────────┘

02-GAPS-FUNCIONAIS ───────────────┐
03-BUGS-MISALIGNMENTS ───────────┼──► M-00 (visão geral + progresso)
07-ROADMAP-MASTER ───────────────┘

05-ARQUITETURA-IDEAL ────────────┐
13-ARQUITETURA-IDEAL-GERAL ──────┼──► Referência direta em M-02 a M-06
11-AGENT-SITUACAO-IDEAL ─────────┘

08a,08b-AUDITORIAS ──────────────┐
10-AGENT-SITUACAO-ATUAL ─────────┼──► Evidências em M-02 a M-06
06-TSSERVER-SDK ─────────────────┘

07-ROADMAP Faixas D,H ──────────── ► M-07 (fases futuras)
07-ROADMAP Faixas G,J ──────────── ► Subsumidas por M-02 a M-05
07-ROADMAP Faixas A,I,B,C,E ───── ► ✅ JÁ CONCLUÍDAS (referência histórica em M-00)
```

### Princípios de cada documento M-0x (Fase)

Cada documento de fase (M-02 a M-06) seguirá esta estrutura:

```markdown
# M-0x — Fase N: [Nome]

## 1. Contexto e Motivação
- Problema(s) resolvido(s) com evidência (referência a doc 12/13)
- Métricas antes → depois esperadas

## 2. Pré-Requisitos
- Fases anteriores que devem estar concluídas
- Estado esperado do codebase antes de iniciar

## 3. Inventário de Arquivos Afetados
- Tabela: arquivo | ação (criar/mover/editar/deletar) | linhas | módulo origem → destino

## 4. Passos de Execução
- Cada passo numerado (P01, P02, ...)
- Para cada passo:
  - O que fazer (descrição técnica)
  - Arquivo(s) e linhas afetadas
  - Comando(s) git/npm/editor
  - Validação (npm run test, grep, etc.)
  - Rollback (git checkout, etc.)

## 5. Testes Necessários
- Novos testes a criar
- Testes existentes que devem continuar passando

## 6. Critérios de Conclusão
- Checklist verificável

## 7. Riscos e Mitigações
- Risk matrix por step
```

---

## 3. Dados Essenciais para Reprodução Sem Contexto

### 3.1 Faixas já concluídas (histórico)

| Faixa | Commit | Conteúdo |
|-------|--------|----------|
| A (Bug Fixes, 18h) | `3e3379e6` | BUG-01 a BUG-11 corrigidos. 11 testes. `Partial<SessionConfig>`, validação reasoningEffort, compaction threshold, boot-wiring |
| A3.2 (Experimental, 4h) | `f9a2071b` | experimental.js reescrito (20 funções SDK-aligned), experimental-rpc-tools.js (20 LLM tools) |
| I (System Prompt, 14h) | `713112be` | 10 seções modulares, mode.js (replace/customize), assembler, capture.js, 35 testes |
| B+I2.4 (Events, 32h) | `5a182a38` | 4 event handler files, 22 event subscriptions, SDK defaults captured |
| C (Config Builders, 20h) | `1340932f` | SessionConfigBuilder (21+ campos), ClientOptionsBuilder, 42 testes |
| E (Hooks Optimization, 16h) | `6c54c83f` | tool-filter, factory, composer, session-hooks, audit-trail, compliance routes, 52 testes |

### 3.2 Números-chave do codebase

- **Total**: 408 arquivos JS, ~62.000 linhas, 21 módulos em `src/copilot/`
- **Top 4**: agent (8.620L), sdk (8.096L), terminal (7.111L), tools (6.928L)
- **Event buses**: 3 (EventBus core, SDK session events, HookBus)
- **Error handling layers**: 5 (core/errors, core/handlers, hooks/error-handler, obs/tracker, obs/alerting)
- **DI tokens**: 11 (subutilizados — maioria dos módulos usa singletons diretos)
- **Message send chain**: 7 níveis de indireção
- **Duplicações funcionais**: 7 pares identificados (doc 12 §3.1)
- **Node.js**: ≥ 24, ESM, `// @ts-check` + JSDoc
- **Testes**: Vitest 4.1.1, `globals: true`
- **SDK**: `@github/copilot-sdk` ≥ 0.2.0

### 3.3 7 Duplicações Funcionais (referência rápida)

| # | Módulo A | Módulo B | Natureza |
|---|----------|----------|----------|
| D1 | `core/error-handlers.js` | `hooks/error-handler.js` | Complementares mas naming confuso |
| D2 | `observability/error-tracker.js` | `observability/error-alerting.js` + `bus-actions/error-alerter.js` | 3 módulos para 1 problema |
| D3 | `sdk/config.js` | `config/session-config.js` | Overlap real (sdk/config.js é legacy) |
| D4 | `sdk/session/lifecycle.js` | `agent/session/initializer.js` | Long delegation chain |
| D5 | `agent/session/event-handlers/` | `observability/collectors/` | Ambos escutam mesmos SDK events |
| D6 | `agent/infra/` | `infra/` root | Naming confuso, propósitos diferentes |
| D7 | `api/express/` | `server/routes/` | Duplicação funcional (api/ é legacy) |

### 3.4 Arquitetura Ideal (6 camadas, resumo do doc 13)

```
L5 PRESENTATION:   server/ + terminal/           (api/ ELIMINADO)
L4 ORCHESTRATION:  agent/ (<4000L) + conv-hub/ + channel/
L3 POLICIES:       hooks/ + tools/ + event-handlers/ (MOVIDO de agent/)
L2 CONFIGURATION:  config/ + bridges/
L1 SDK FACADE:     sdk/ (STATELESS, sem registry)
L0 CORE:           core/ + events/ + infra/ + db/ + observability/ (CONSOLIDADO)
```

### 3.5 11 Consolidações propostas (C1-C11, resumo do doc 13)

| # | Ação | Módulos afetados | Impacto estimado |
|---|------|-----------------|------------------|
| C1 | Eliminar api/ | api/ → server/ | -1937L, -10 arquivos |
| C2 | Eliminar services/ | services/ → inline | -547L, -6 arquivos |
| C3 | Mover event-handlers de agent/ para L3 | agent/ → event-handlers/ | ~700L movidas |
| C4 | Mover infra de agent/ | agent/infra/ → infra/,hooks/,tools/,obs/ | ~4 arquivos |
| C5 | SDK stateless | sdk/session/client.js → agent/ ou conv-hub/ | ~386L refatoradas |
| C6 | Consolidar sdk/agent/ em config/ | sdk/agent/ → config/ + types/ | ~4 arquivos |
| C7 | Mover agent/config.js para L2 | agent/ → config/ | ~1 arquivo |
| C8 | Unificar event buses | HookBus + SDK events → EventBus | -2 buses |
| C9 | Error pipeline unificado | 3 obs módulos → 1 pipeline | -2 arquivos |
| C10 | Simplificar chain de envio | 7→4 níveis | ~3 merges |
| C11 | Trim observability | collectors + bus-actions → observers | -8 arq, -1500L |

### 3.6 Convenções do projeto

- **Estilo**: 4 espaços, 120 colunas, aspas simples, ponto-e-vírgula
- **JSDoc**: robusto em APIs públicas (`@param`, `@returns`, `@throws`)
- **Imports**: preferir aliases `#core/*`, `#infra/*`, `#copilot/*`
- **Validação**: `npm run lint && npm run format:check && npm run test:unit`
- **Se alterar driver/kernel/server**: `npm run test:integration`
- **Commits**: `git commit --no-verify -m "tipo: descrição"`
- **Push**: `git push origin main`
- **Linguagem**: pt-BR em documentação

---

## 4. Sequenciamento: Ordem de Execução dos M-0x

```
M-00 (Visão Geral)           ─── documento de entrada, escrito primeiro
     │
M-01 (Inventário) ────────── referência constante por todos os M-02+
     │
M-02 (Cleanup) ──────────── FASE 1: quick wins independentes
     │
M-03 (Agent Refactor) ───── FASE 2: depende de M-02
     │
M-04 (SDK Stateless) ────── FASE 3: depende de M-03
     │
M-05 (Event Unification) ── FASE 4: depende de M-03, parcialmente de M-04
     │
M-06 (Obs + Errors) ──────── FASE 5: depende de M-05
     │
M-07 (Fases Futuras) ──────  FASE 6+: features novas pós-migração
```

---

## 5. Decisão

**Próximos passos**:
1. Criar diretório `DOCUMENTAÇÃO/COPILOT/PLANO-MIGRACAO/`
2. Gerar M-00 (visão geral)
3. Gerar M-01 (inventário completo)
4. Gerar M-02 a M-06 (fases de migração)
5. Gerar M-07 (fases futuras)
6. Commit e push
