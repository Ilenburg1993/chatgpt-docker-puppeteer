---
name: copilot-full-audit
description: >-
  Skill canônica para auditoria completa e profunda de todo o diretório src/copilot. Cobre leitura
  integral de 160 arquivos, análise isolada por módulo, análise integrada cross-module, detecção de
  bugs/leaks/races/security/gaps, propostas de upgrade, geração de relatórios MD e execução de
  correções. Use quando o objetivo é uma varredura completa do sistema copilot, não apenas um módulo
  isolado. Para módulos individuais, use code-audit ou code-audit-and-fix.
user-invocable: true
---

# copilot-full-audit — Auditoria Completa de src/copilot

## Overview

Skill para conduzir uma auditoria completa, profunda e sistemática do diretório `src/copilot/` (160
arquivos JS, ~19.439 LOC, 15 módulos). Diferente das skills `code-audit` (escopo pontual) e
`code-audit-and-fix` (fix imediato), esta skill opera em **escala de repositório** com processo
multi-fase, múltiplos relatórios de saída e tipologia padronizada.

### Identidade operacional

- `audit_mode`: `full_repository_audit`
- `profile`: `systematic_exhaustive`
- `proposal_depth`: `deep`
- `output`: Múltiplos arquivos MD em `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-AUDIT-REPORTS/`
- `escalate_to`:
  - `code-audit-and-fix` para correções imediatas durante a execução
  - `semantic-logic-audit` para fluxos críticos que requeiram deep-dive

### Documento guia

**OBRIGATÓRIO**: Ler antes de iniciar qualquer fase:

```
DOCUMENTAÇÃO/AUDITORIAS/COPILOT-FULL-AUDIT-PLAN.md
```

Este documento contém:

- Mapa completo de todos os arquivos e módulos
- Tipologia de nomenclatura padronizada
- 16 fases com 145 subfases detalhadas
- Templates de relatório
- Critérios de conclusão

---

## When To Use

- Auditoria completa de `src/copilot/` (todos os módulos)
- Varredura sistemática buscando bugs, leaks, races, gaps, security issues
- Geração de relatórios formais por módulo e por fluxo integrado
- Planejamento de roadmap de correções e upgrades em escala

## When Not To Use

- Auditoria de um único arquivo ou módulo → use `code-audit`
- Fix rápido de bug conhecido → use `reactive-bug-audit`
- Auditoria apenas de observabilidade → use workflow específico do V3
- Análise de performance isolada → use `performance-audit`

---

## Preconditions

1. **Plano de auditoria atualizado**: verificar que `COPILOT-FULL-AUDIT-PLAN.md` está na versão mais
   recente
2. **Testes passando**: `npm run test:unit` deve estar green antes de iniciar
3. **Git limpo**: sem mudanças uncommitted (para poder commitar correções incrementais)
4. **Diretório de output criado**: `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-AUDIT-REPORTS/`

---

## Visão Arquitetural — Referência para Análise

O plano (seções 3.5-3.6) contém o diagnóstico arquitetural completo AS-IS e a visão TO-BE. Durante a
auditoria, **todo achado deve ser avaliado também sob a lente arquitetural**:

### Problemas estruturais já mapeados (usar como radar)

| Problema                                   | Indicador                       | Tipo esperado |
| ------------------------------------------ | ------------------------------- | ------------- |
| Logger bypass (76 imports diretos)         | `#copilot/observability/logger` | `ARCH-*`      |
| SDK espalhado (22 files)                   | `@github/copilot-sdk` direto    | `ARCH-*`      |
| core/ importando de agent/                 | `AGENT_EVENTS` re-export        | `ARCH-*`      |
| hooks↔agent circular                       | session-hooks bidirecional      | `ARCH-*`      |
| Singletons sem lifecycle (~30 `let`)       | `let _module = null`            | `ARCH-*`      |
| Maps sem TTL (~37)                         | `new Map()` sem cleanup         | `LEAK-*`      |
| Observability como god module (87 imports) | coupling extremo                | `ARCH-*`      |
| Módulos sem cobertura (core, obs, routes)  | 0 specs                         | `TEST-*`      |

### Camadas de referência (TO-BE)

```
Infrastructure → Utilities → Observability → Domain Logic → Orchestration → Interface
```

Ao analisar cada módulo, verificar se suas imports respeitam a direção das camadas. Importações
upward são violações (ARCH-\*). Referência completa: plano §3.6.

### Como anotar achados arquiteturais

Achados arquiteturais usam tipo `ARCH-{MOD}-{SEQ}` e devem incluir:

- Qual camada viola qual
- Import path concreto (arquivo + linha)
- Impacto no delta AS-IS→TO-BE (qual transformação resolve)
- Complexidade estimada da transformação

---

## Tipologia de Nomenclatura

### Formato de ID: `{TIPO}-{MÓDULO}-{SEQ}`

**Tipos**: `BUG` | `RACE` | `LEAK` | `SEC` | `PERF` | `GAP` | `INC` | `DEAD` | `TYPO` | `ARCH` |
`TEST` | `UPG` | `INTG`

**Módulos**: `AGENT` | `API` | `BRDG` | `CHAN` | `CONF` | `CONV` | `CORE` | `DB` | `HOOK` | `LIB` |
`OBS` | `ROUTE` | `TERM` | `TOOLS` | `TYPES`

**Severidade**: `P0` (crítica) | `P1` (alta) | `P2` (média) | `P3` (baixa) | `P4` (info)

Exemplo: `BUG-AGENT-003` = Bug #3 encontrado no módulo agent/, `SEC-TOOLS-001` = Vulnerabilidade #1
no módulo tools/

---

## Workflow Completo

### Macro-Fase I — Leitura e Mapeamento (F01-F04)

**Objetivo**: Ler integralmente todos os 160 arquivos JS de `src/copilot/`. Não analisar ainda —
apenas ler, mapear estruturas, anotar pontos de atenção.

**Método de leitura**:

1. Para cada arquivo, usar `read_file` com range amplo (100-200 linhas por call)
2. Para arquivos > 500 LOC, ler em 3-4 batches
3. Anotar em memória de sessão: exports, imports, estado interno, event handlers
4. Não corrigir nada durante a leitura — apenas catalogar

**Agrupamento**:

- F01: agent/ + hooks/ (40 arquivos, os mais interligados)
- F02: observability/ + bridges/ + api/ (25 arquivos, telemetria)
- F03: tools/ + config/ + terminal/ (59 arquivos, o maior cluster)
- F04: channel/ + conv-hub/ + core/ + db/ + lib/ + types/ + routes/ (36 arquivos)

**Deliverable por fase**: Anotações internas (session memory) com mapa de cada módulo lido.

### Macro-Fase II — Análise Isolada (F05-F10)

**Objetivo**: Para cada módulo, aplicar o checklist de análise e catalogar questões encontradas.

**Checklist por arquivo** (aplicar em cada .js):

```
□ Contratos de entrada: params validados? defaults seguros?
□ Contratos de saída: return types corretos? errors propagados?
□ Estado interno: Maps/Sets com TTL? Cleanup em destroy/detach?
□ Error handling: catch genérico? finally garante cleanup?
□ Edge cases: null, undefined, empty array, timeout, overflow?
□ Invariantes: precondições verificadas? postcondições garantidas?
□ JSDoc: typedefs corretos? @param/@returns completos?
□ Segurança: injection? path traversal? SSRF? secrets exposure?
□ Concurrency: race conditions? concurrent writes? event ordering?
□ Resources: file handles fechados? timers limpos? listeners removidos?
```

**Para cada questão encontrada, registrar**:

```markdown
### {TIPO}-{MOD}-{SEQ} — {Título curto}

- **Severidade**: P{0-4}
- **Arquivo**: `{path}`#{L1-L2}
- **Descrição**: Explicação técnica detalhada
- **Cenário**: Como se manifesta / quando causa problema
- **Proposta**: Correção sugerida (código quando possível)
- **Impacto**: O que acontece se não corrigido
```

**Deliverable por fase**: Relatório MD do módulo em `COPILOT-AUDIT-REPORTS/`

### Macro-Fase III — Análise Integrada (F11-F14)

**Objetivo**: Verificar fluxos end-to-end que cruzam múltiplos módulos.

**4 fluxos críticos**:

1. **Telemetria E2E** (F11): SDK event → event-collector → observer → metrics → REST
   - Verificar: deduplicação, completude, shapes, OTEL propagation
2. **Session lifecycle** (F12): boot → init → start → reconnect → shutdown
   - Verificar: cleanup, state persistence, resource release
3. **Tool pipeline** (F13): registration → permission → execution → audit
   - Verificar: authorization bypass, error propagation, result handling
4. **Terminal LLM-B** (F14): bootstrap → REPL → dialog → commands
   - Verificar: state sync, command safety, concurrent access

**Deliverable**: 4 relatórios de integração em `COPILOT-AUDIT-REPORTS/INTEGRATION-*.md`

### Macro-Fase IV — Consolidação e Correções (F15-F16)

**Objetivo**: Consolidar achados, priorizar, corrigir.

**F15**: Consolidar todos os relatórios em `00-SUMMARY.md` + `ISSUES-CONSOLIDATED.md` +
`ROADMAP-FIXES.md`

**F16**: Executar correções priorizadas:

1. P0 primeiro (bloqueantes)
2. P1 (alto impacto)
3. P2 (melhorias)
4. Quality gates após cada batch
5. Commit incremental por batch de correções

---

## Regras de Execução

### R1 — Leitura integral obrigatória

Cada arquivo deve ser lido **por completo** antes de qualquer análise. Não auditar com base em grep
ou leitura parcial.

### R2 — Não corrigir durante a leitura

Macro-Fase I é READ-ONLY. Anotar, não corrigir. Correções são Macro-Fase IV.

### R3 — Tipologia estrita

Todo achado DEVE usar o formato `{TIPO}-{MOD}-{SEQ}`. Sem exceções. Permitir busca e filtragem.

### R4 — Evidência antes de conclusão

Todo achado deve apontar arquivo, linhas e cenário de manifestação. Sem "pode ser um problema".

### R5 — Testes intactos entre fases

Rodar `npm run test:unit` ao final de cada macro-fase. Se falhar, corrigir antes de prosseguir.

### R6 — Commit incremental

Não acumular centenas de linhas sem commit. Commitar ao final de cada batch de correções.

### R7 — Um relatório por módulo

Cada módulo gera exatamente um relatório MD. Não fragmentar em múltiplos arquivos por módulo.

### R8 — Relatório de integração por fluxo

Cada fluxo cross-module gera exatamente um relatório `INTEGRATION-*.md`.

### R9 — Sem ferramentas automáticas para achados

ESLint, TypeScript, Prettier NÃO são fontes de achados. São quality gates. A análise é manual e
semântica, baseada em leitura integral e raciocínio causal.

### R10 — Template de progresso em session memory

Manter arquivo de progresso em `/memories/session/` com estado de cada fase/subfase, para retomada
em caso de interrupção.

### R11 — Análise arquitetural em cada módulo

Todo módulo analisado na Macro-Fase II deve ser avaliado sob a lente do diagnóstico arquitetural
(plano §3.5-3.6). Verificar: violações de camada, barrel bypasses, SDK direto, singletons sem
lifecycle, Maps sem TTL. Registrar como `ARCH-{MOD}-{SEQ}` com referência ao delta TO-BE.

---

## Ferramentas do Workflow

| Ferramenta               | Uso                                           |
| ------------------------ | --------------------------------------------- |
| `read_file`              | Leitura integral de cada arquivo              |
| `grep_search` / `rg`     | Busca de padrões, dead code, cross-references |
| `run_in_terminal`        | Quality gates, node --check, testes           |
| `replace_string_in_file` | Correções na Macro-Fase IV                    |
| `create_file`            | Relatórios de saída                           |
| `manage_todo_list`       | Tracking de progresso por subfase             |
| `memory` (session)       | Anotações intermediárias e estado de retomada |

---

## Integração com Outras Skills

| Situação                       | Skill a invocar        |
| ------------------------------ | ---------------------- |
| Deep-dive em fluxo crítico     | `semantic-logic-audit` |
| Fix imediato durante auditoria | `code-audit-and-fix`   |
| Bug com stack trace específico | `reactive-bug-audit`   |
| Performance hotspot            | `performance-audit`    |
| Segurança aprofundada          | `security-checklist`   |
| Typing/JSDoc fixes             | `typing-fix-protocol`  |

---

## Anti-Patterns (Erros Comuns a Evitar)

1. **Ler parcialmente e concluir** — Nunca auditar com base em grep/snippet. Ler o arquivo inteiro.
2. **Corrigir durante a leitura** — Macro-Fase I é READ-ONLY. Anotar pontos para a Macro-Fase II/IV.
3. **Achado sem cenário** — "Pode ser um problema" não é achado. Descrever quando e como se
   manifesta.
4. **Ignorar testes existentes** — Antes de criar novos testes, verificar se já existe spec cobrindo
   o caso.
5. **Acumular edições sem commit** — Commitar após cada batch de 5-10 correções, não centenas.
6. **Duplicar achados entre módulos** — Usar a tabela `ISSUES-CONSOLIDATED.md` para dedup.
7. **Escopo creep em upgrades** — UPGs são propostas; implementar apenas após priorização.
8. **Confundir anotação com relatório** — Anotações (Fase I) são rascunho interno; relatórios (Fase
   II) são formais com template.
9. **Pular F10 por ter muitos módulos** — F10 agrupa módulos menores mas CADA UM merece checklist
   completo.
10. **Esquecer de rodar testes** — `npm run test:unit` ao final de CADA macro-fase, não apenas no
    final.

---

## Prioridade de Análise por Módulo

Ordenados por risco ponderado. Na Macro-Fase II, analisar nesta ordem:

| Prioridade | Módulo            | Justificativa                                            |
| ---------- | ----------------- | -------------------------------------------------------- |
| 🔴 1       | tools/            | Maior LOC, shell/file/web = superfície de segurança alta |
| 🔴 2       | agent/            | State machine complexa, concurrency, lifecycle           |
| 🔴 3       | observability/    | 0 specs, hub central, Maps com potential leaks           |
| 🟠 4       | hooks/            | Permission handling, prompt injection surface            |
| 🟠 5       | terminal/         | HTTP handlers, command dispatch, 27 arquivos             |
| 🟠 6       | conversation-hub/ | Multi-session isolation, store consistency               |
| 🟡 7-15    | Demais            | Menor LOC e/ou boa cobertura de testes                   |

---

## Protocolo de Retomada Após Interrupção

1. Ler `/memories/session/copilot-audit-progress.md` (se existir)
2. Ler `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-FULL-AUDIT-PLAN.md` (seções 9-12 para contexto)
3. Ler esta skill
4. Identificar última subfase concluída
5. Retomar da próxima subfase pendente
6. Não reler arquivos já lidos (usar anotações em session memory)
7. Rodar `npm run test:unit` para garantir baseline intacto

---

## Clarificação: Anotações vs Relatórios

| Conceito        | Quando            | Onde                            | Formato           |
| --------------- | ----------------- | ------------------------------- | ----------------- |
| **Anotação**    | Macro-Fase I      | `/memories/session/`            | Rascunho livre    |
| **Relatório**   | Macro-Fase II/III | `COPILOT-AUDIT-REPORTS/XX-*.md` | Template formal   |
| **Consolidado** | Macro-Fase IV     | `COPILOT-AUDIT-REPORTS/00-*.md` | Tabelas + roadmap |

> Na Fase I, ANOTA-SE suspeitas. Na Fase II, VERIFICA-SE e FORMALIZA-SE com evidência. A anotação
> NÃO é achado — o achado nasce na Fase II com ID/tipo/severidade/cenário.

---

## Critérios de Conclusão

A auditoria está concluída quando:

- [ ] Todos os 160 arquivos lidos integralmente
- [ ] 15 relatórios de módulo gerados
- [ ] 4 relatórios de integração gerados
- [ ] `00-SUMMARY.md` consolidado
- [ ] `ISSUES-CONSOLIDATED.md` com todas as questões
- [ ] `ROADMAP-FIXES.md` priorizado
- [ ] Correções P0 implementadas e testadas
- [ ] Quality gates green após correções
- [ ] Commits incrementais para cada batch

---

## Quick Reference — Módulos de src/copilot

| #   | Módulo            | Files | LOC  | Responsabilidade principal                 |
| --- | ----------------- | ----- | ---- | ------------------------------------------ |
| 1   | agent/            | 22    | 4914 | Core agent, dialog loop, task execution    |
| 2   | tools/            | 23    | 5716 | Tool implementations (file, git, shell…)   |
| 3   | observability/    | 9     | 3784 | Metrics, OTEL, audit, event collection     |
| 4   | hooks/            | 18    | 3334 | SDK hooks, permissions, presets, lifecycle |
| 5   | terminal/         | 27    | 2800 | LLM-B terminal, REPL, commands             |
| 6   | conversation-hub/ | 6     | 2206 | Multi-session orchestration, store         |
| 7   | bridges/          | 10    | 2044 | Git, GitHub, NERV, MCP integration         |
| 8   | lib/              | 12    | 1904 | Utilities, validators, SDK client          |
| 9   | routes/           | 7     | 1546 | Express routes for API                     |
| 10  | config/           | 9     | 1540 | Session config, prompts, MCP, tools        |
| 11  | channel/          | 3     | 1175 | SSE client, inject script                  |
| 12  | api/              | 6     | 741  | HTTP bridge layer                          |
| 13  | core/             | 3     | 515  | Constants, errors                          |
| 14  | types/            | 3     | 515  | SDK types, structured messages             |
| 15  | db/               | 2     | 358  | SQLite, migrations                         |
