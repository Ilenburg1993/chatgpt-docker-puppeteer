---
name: copilot-full-audit
description: >-
  Skill canônica para auditoria completa e profunda de todo o diretório src/copilot. Cobre leitura
  integral de 160 arquivos, geração de 160 MDs individuais por arquivo, 15 consolidados por módulo,
  7 integrações cross-module, visão arquitetural global, detecção de bugs/leaks/races/security/gaps,
  propostas de upgrade e execução de correções. Use quando o objetivo é uma varredura completa do
  sistema copilot, não apenas um módulo isolado. Para módulos individuais, use code-audit ou
  code-audit-and-fix.
user-invocable: true
---

# copilot-full-audit v2.0 — Auditoria Completa de src/copilot

## Overview

Skill para conduzir uma auditoria completa, profunda e sistemática do diretório `src/copilot/` (160
arquivos JS, ~35.859 LOC, 15 módulos). Diferente das skills `code-audit` (escopo pontual) e
`code-audit-and-fix` (fix imediato), esta skill opera em **escala de repositório** com processo
multi-fase, templates padronizados e ~186 artefatos MD de saída.

### Identidade operacional

- `audit_mode`: `full_repository_audit`
- `profile`: `systematic_exhaustive`
- `proposal_depth`: `deep`
- `output`: ~186 arquivos MD em `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-AUDIT-REPORTS/`
- `methodology`: `1 arquivo lido → 1 MD individual criado → consolidado por módulo`
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
- Tipologia de nomenclatura padronizada (13 tipos × 15 módulos × 5 severidades)
- 31 fases com ~294 subfases detalhadas
- 4 templates exaustivos de relatório
- Diagnóstico arquitetural AS-IS e visão TO-BE
- Critérios de conclusão

### Templates disponíveis

4 templates padronizados em `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-AUDIT-REPORTS/templates/`:

| Template                              | Quando usar                         | Seções |
| ------------------------------------- | ----------------------------------- | ------ |
| `TEMPLATE-ARQUIVO-INDIVIDUAL.md`      | Após ler cada arquivo               | 15     |
| `TEMPLATE-MODULO-CONSOLIDADO.md`      | Após todos os MDs de um módulo      | 16     |
| `TEMPLATE-INTEGRACAO-CROSS-MODULE.md` | Para cada fluxo E2E                 | 12     |
| `TEMPLATE-VISAO-ARQUITETURAL.md`      | Após todos os módulos e integrações | 8      |

---

## When To Use

- Auditoria completa de `src/copilot/` (todos os módulos)
- Varredura sistemática buscando bugs, leaks, races, gaps, security issues
- Geração de documentação de auditoria por arquivo e por módulo
- Análise de fluxos cross-module end-to-end
- Planejamento de roadmap de correções e upgrades em escala

## When Not To Use

- Auditoria de um único arquivo ou módulo → use `code-audit`
- Fix rápido de bug conhecido → use `reactive-bug-audit`
- Auditoria apenas de observabilidade → use workflow específico do V3
- Análise de performance isolada → use `performance-audit`

---

## Preconditions

1. **Plano de auditoria atualizado**: verificar que `COPILOT-FULL-AUDIT-PLAN.md` está na v2.0+
2. **Testes passando**: `npm run test:unit` deve estar green antes de iniciar
3. **Git limpo**: sem mudanças uncommitted (para poder commitar correções incrementais)
4. **Diretório de output criado**: `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-AUDIT-REPORTS/`
5. **Templates presentes**: 4 templates em `COPILOT-AUDIT-REPORTS/templates/`

---

## Visão Arquitetural — Referência para Análise

O plano (seções 3.3-3.4) contém o diagnóstico arquitetural completo AS-IS e a visão TO-BE. Durante a
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
| Sync I/O em produção (15+ files)           | `readFileSync`/`writeFileSync`  | `PERF-*`      |

### Camadas de referência (TO-BE)

```
Layer 1 — Infrastructure:  db/
Layer 2 — Utilities:       lib/, types/, core/
Layer 3 — Observability:   observability/
Layer 4 — Domain Logic:    hooks/, config/, tools/, bridges/, channel/
Layer 5 — Orchestration:   agent/, conversation-hub/, terminal/
Layer 6 — Interface:       routes/, api/
```

Ao analisar cada arquivo, verificar se suas imports respeitam a direção das camadas. Importações
upward são violações (ARCH-\*). Referência completa: plano §3.4.

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

## Metodologia v2.0 — "1 Arquivo Lido → 1 MD Criado"

### Mudança fundamental

| Aspecto                  | v1.x (obsoleto)                | v2.0 (atual)                             |
| ------------------------ | ------------------------------ | ---------------------------------------- |
| Leitura                  | Ler em batches, anotar memória | Ler arquivo → escrever MD imediatamente  |
| Output por arquivo       | Anotação informal              | MD formal com template de 15 seções      |
| Output por módulo        | 1 relatório por macro-fase     | 1 MD consolidado APÓS todos individuais  |
| Output integração        | 4 fluxos                       | 7 fluxos (incluindo segurança, conv-hub) |
| Fases MF-II              | 6 fases genéricas              | 13 fases (1 por módulo)                  |
| Total de fases           | 16                             | 31                                       |
| Total artefatos de saída | ~20 MDs                        | ~186 MDs                                 |

### Ritmo operacional obrigatório

```
PARA CADA módulo M:
  PARA CADA arquivo A em M:
    1. Ler A integralmente (read_file)
    2. Analisar A usando checklist de 14 itens
    3. Escrever MD individual de A (TEMPLATE-ARQUIVO-INDIVIDUAL.md)
  FIM
  4. Escrever MD consolidado de M (TEMPLATE-MODULO-CONSOLIDADO.md)
FIM

PARA CADA fluxo F (7 fluxos):
  5. Analisar fluxo cross-module F
  6. Escrever MD de integração de F (TEMPLATE-INTEGRACAO-CROSS-MODULE.md)
FIM

7. Escrever ARCHITECTURE-VISION.md (TEMPLATE-VISAO-ARQUITETURAL.md)
8. Escrever ISSUES-CONSOLIDATED.md + ROADMAP-FIXES.md + 00-SUMMARY.md
```

---

## Workflow Completo — 5 Macro-Fases, 31 Fases

### Macro-Fase I — Leitura Exploratória (F01-F04) ✅ CONCLUÍDA

> MF-I foi concluída. Todos os 160 arquivos lidos. Anotações em session memory. A partir da v2.0, o
> trabalho recomeça na MF-II com releitura integral.

| Fase | Escopo                                                       | Files | Status |
| ---- | ------------------------------------------------------------ | ----- | ------ |
| F01  | agent/ + hooks/                                              | 40    | ✅     |
| F02  | observability/ + bridges/ + api/                             | 25    | ✅     |
| F03  | tools/ + config/ + terminal/                                 | 59    | ✅     |
| F04  | channel/ + conv-hub/ + core/ + db/ + lib/ + types/ + routes/ | 36    | ✅     |

### Macro-Fase II — Leitura Individual + Documentação por Arquivo (F05-F17)

**Objetivo**: Reler cada arquivo integralmente, aplicar checklist, produzir MD individual por
arquivo. Ao terminar todos os arquivos de um módulo, produzir MD consolidado.

**Ritmo: 1 arquivo lido → 1 MD individual → (ao final do módulo) 1 MD consolidado**

| Fase | Módulo               | Files | MDs Individuais | MD Consolidado                            |
| ---- | -------------------- | ----- | --------------- | ----------------------------------------- |
| F05  | agent/               | 22    | 22              | `01-agent.md`                             |
| F06  | hooks/               | 18    | 18              | `04-hooks.md`                             |
| F07  | tools/               | 23    | 23              | `02-tools.md`                             |
| F08  | observability/       | 9     | 9               | `03-observability.md`                     |
| F09  | terminal/            | 27    | 27              | `05-terminal.md`                          |
| F10  | bridges/             | 10    | 10              | `06-bridges.md`                           |
| F11  | conversation-hub/    | 6     | 6               | `07-conversation-hub.md`                  |
| F12  | config/              | 9     | 9               | `08-config.md`                            |
| F13  | lib/                 | 12    | 12              | `09-lib.md`                               |
| F14  | routes/              | 7     | 7               | `10-routes.md`                            |
| F15  | channel/             | 3     | 3               | `11-channel.md`                           |
| F16  | api/                 | 6     | 6               | `12-api.md`                               |
| F17  | core/ + db/ + types/ | 8     | 8               | `13-core.md` + `14-types.md` + `15-db.md` |

**Total MF-II**: 160 MDs individuais + 15 MDs consolidados = 175 artefatos

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
□ Dead code: exports sem consumidores? imports não usados?
□ Performance: sync I/O? unbounded growth? O(n²)?
□ Arquitetura: violação de camada? barrel bypass? SDK direto?
□ Testes: spec existe? cenários edge cobertos?
```

### Macro-Fase III — Integração Cross-Module + Visão Arquitetural (F18-F25)

**Objetivo**: Analisar fluxos end-to-end e produzir visão integrada.

| Fase | Fluxo / Deliverable             | Artefato                                                        |
| ---- | ------------------------------- | --------------------------------------------------------------- |
| F18  | Telemetria E2E                  | `INTEGRATION-telemetry.md`                                      |
| F19  | Session lifecycle E2E           | `INTEGRATION-session-lifecycle.md`                              |
| F20  | Tool execution pipeline E2E     | `INTEGRATION-tool-pipeline.md`                                  |
| F21  | Terminal LLM-B E2E              | `INTEGRATION-terminal.md`                                       |
| F22  | Conversation Hub E2E            | `INTEGRATION-conv-hub.md`                                       |
| F23  | Segurança transversal           | `INTEGRATION-security.md`                                       |
| F24  | Visão arquitetural consolidada  | `ARCHITECTURE-VISION.md`                                        |
| F25  | Relatórios consolidados globais | `00-SUMMARY.md` + `ISSUES-CONSOLIDATED.md` + `ROADMAP-FIXES.md` |

**Checklist por fluxo cross-module**:

```
□ Data flow: dados do ponto A ao Z, transformações corretas?
□ Event flow: emissão→consumo completo, deduplicação, ordenação?
□ Error flow: erros no ponto A chegam ao ponto Z?
□ State consistency: estado compartilhado é consistente?
□ Resource lifecycle: abertos no módulo A são fechados no B?
□ Contract alignment: tipos do módulo A casam com expectativas do B?
□ Concurrency: 2 invocações simultâneas do fluxo são seguras?
```

### Macro-Fase IV — Execução de Correções e Upgrades (F26-F31)

| Fase | Escopo                       | Ação                                |
| ---- | ---------------------------- | ----------------------------------- |
| F26  | Correções P0 (críticas)      | Fix + test:unit após cada correção  |
| F27  | Correções P1 (altas)         | Fix + test:unit por batch           |
| F28  | Correções P2 (médias)        | Fix + test:unit por batch           |
| F29  | Upgrades priorizados         | Implementar UPGs P1-P2 selecionados |
| F30  | Transformações arquiteturais | T5, T6, T4, T8, T1 (do delta TO-BE) |
| F31  | Quality gates finais         | test + lint + format + commit final |

---

## Regras de Execução

### R1 — Leitura integral obrigatória

Cada arquivo deve ser lido **por completo** antes de gerar o MD individual. Não auditar com base em
grep ou leitura parcial.

### R2 — MD imediato após leitura

Após ler um arquivo, o MD individual DEVE ser criado imediatamente, antes de ler o próximo arquivo.
Ritmo: `read → write → read → write → ...`

### R3 — Consolidação ao final do módulo

O MD consolidado do módulo é escrito APENAS após TODOS os MDs individuais do módulo estarem prontos.

### R4 — Tipologia estrita

Todo achado DEVE usar o formato `{TIPO}-{MOD}-{SEQ}`. Sem exceções. Permitir busca e filtragem.

### R5 — Evidência antes de conclusão

Todo achado deve apontar arquivo, linhas e cenário de manifestação. Sem "pode ser um problema".

### R6 — Testes intactos entre macro-fases

Rodar `npm run test:unit` ao final de cada macro-fase e antes de qualquer correção.

### R7 — Commit incremental em MF-IV

Não acumular centenas de linhas sem commit durante correções. Commitar após cada batch.

### R8 — Sem ferramentas automáticas para achados

ESLint, TypeScript, Prettier NÃO são fontes de achados. São quality gates. A análise é manual e
semântica.

### R9 — Template de progresso em session memory

Manter arquivo de progresso em `/memories/session/` com estado de cada fase/subfase.

### R10 — Análise arquitetural em cada arquivo

Todo arquivo analisado deve ser avaliado sob a lente do diagnóstico arquitetural (plano §3.3-3.4).

### R11 — Pontuação obrigatória

Todo MD individual deve incluir a seção "Pontuação de Saúde" (6 dimensões + média ponderada),
conforme o `TEMPLATE-ARQUIVO-INDIVIDUAL.md`.

### R12 — Releitura completa

Mesmo que o arquivo já tenha sido lido na MF-I, ele DEVE ser relido integralmente na MF-II. A MF-I
serve como briefing, não como substituto.

---

## Ferramentas do Workflow

| Ferramenta               | Uso                                           |
| ------------------------ | --------------------------------------------- |
| `read_file`              | Leitura integral de cada arquivo              |
| `grep_search` / `rg`     | Busca de padrões, dead code, cross-references |
| `run_in_terminal`        | Quality gates, node --check, testes           |
| `replace_string_in_file` | Correções na Macro-Fase IV                    |
| `create_file`            | MDs individuais, consolidados, integração     |
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
2. **Pular a escrita do MD** — Cada arquivo lido gera 1 MD. Sem exceções.
3. **Achado sem cenário** — "Pode ser um problema" não é achado. Descrever quando e como se
   manifesta.
4. **Ignorar testes existentes** — Antes de criar novos testes, verificar se já existe spec.
5. **Acumular edições sem commit** — Commitar após cada batch de 5-10 correções.
6. **Duplicar achados entre módulos** — Usar a tabela `ISSUES-CONSOLIDATED.md` para dedup.
7. **Escopo creep em upgrades** — UPGs são propostas; implementar apenas após priorização.
8. **Escrever consolidado antes dos individuais** — O consolidado vem DEPOIS de todos os MDs do
   módulo.
9. **Pular módulos menores** — core/, db/, types/ são pequenos mas CADA UM merece checklist
   completo.
10. **Esquecer de rodar testes** — `npm run test:unit` ao final de CADA macro-fase.
11. **Usar grep como substituto de leitura** — R1 exige leitura integral, grep é complementar.
12. **Não atualizar progresso** — Session memory deve refletir a última subfase concluída (R9).

---

## Prioridade de Análise por Módulo (Ordem de Risco)

Na Macro-Fase II, a ordem recomendada por risco ponderado:

| Prioridade | Fase | Módulo            | LOC  | Justificativa                                  |
| ---------- | ---- | ----------------- | ---- | ---------------------------------------------- |
| 🔴 1       | F07  | tools/            | 5716 | Maior LOC, shell/file/web sec surface, 3 specs |
| 🔴 2       | F05  | agent/            | 4914 | State machine, concurrency, lifecycle          |
| 🔴 3       | F08  | observability/    | 3784 | 0 specs, god module, Maps com leaks            |
| 🟠 4       | F06  | hooks/            | 3334 | Permission handling, prompt injection          |
| 🟠 5       | F09  | terminal/         | 4920 | HTTP handlers, commands, 27 arquivos           |
| 🟠 6       | F11  | conversation-hub/ | 2206 | Multi-session isolation, store                 |
| 🟡 7       | F10  | bridges/          | 2044 | External API calls, error handling             |
| 🟡 8       | F12  | config/           | 1540 | Validation, defaults                           |
| 🟡 9       | F13  | lib/              | 1904 | Utilities, boa cobertura (10 specs)            |
| 🟡 10      | F14  | routes/           | 1546 | HTTP middleware, auth, 1 spec                  |
| 🟢 11      | F15  | channel/          | 1175 | SSE client, relativamente isolado              |
| 🟢 12      | F16  | api/              | 741  | HTTP bridge, 4 specs                           |
| 🟢 13      | F17  | core/db/types     | 1035 | Constants, DB/SQL, type definitions            |

---

## Protocolo de Retomada Após Interrupção

1. Ler `/memories/session/copilot-audit-progress.md` (se existir)
2. Ler `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-FULL-AUDIT-PLAN.md` (plano v2.0)
3. Ler esta skill
4. Verificar `COPILOT-AUDIT-REPORTS/` para MDs já criados
5. Identificar última subfase concluída (pelo progresso + MDs existentes)
6. Retomar da próxima subfase pendente
7. **Reler** o arquivo da subfase pendente — NÃO pular leitura mesmo com anotações da MF-I (R12)
8. Rodar `npm run test:unit` para garantir baseline intacto

### Template de progresso (session memory)

```markdown
# Copilot Full Audit — Progresso

## Última atualização: {timestamp}

## Fase atual: {FXX-YY}

### Macro-Fase II: Leitura + Documentação

- [x] F05-01 always-alive.js → agent/always-alive-audit.md ✅
- [x] F05-02 dialog-loop-manager.js → agent/dialog-loop-manager-audit.md ✅
- [ ] F05-03 dialog-loop-wirer.js (em progresso)
- ...
- [ ] F05-23 — CONSOLIDAÇÃO → 01-agent.md

### Achados por módulo

| Módulo | BUG | RACE | LEAK | SEC | PERF | ARCH | Total |
| ------ | --- | ---- | ---- | --- | ---- | ---- | ----- |
| agent/ |     |      |      |     |      |      |       |
```

---

## Clarificação: MDs Individuais vs Consolidados vs Integração

| Conceito            | Quando               | Template                              | Onde                                                          |
| ------------------- | -------------------- | ------------------------------------- | ------------------------------------------------------------- |
| **MD Individual**   | Após ler 1 arquivo   | `TEMPLATE-ARQUIVO-INDIVIDUAL.md`      | `COPILOT-AUDIT-REPORTS/{módulo}/`                             |
| **MD Consolidado**  | Após todos do módulo | `TEMPLATE-MODULO-CONSOLIDADO.md`      | `COPILOT-AUDIT-REPORTS/XX-{módulo}.md`                        |
| **MD Integração**   | Macro-Fase III       | `TEMPLATE-INTEGRACAO-CROSS-MODULE.md` | `COPILOT-AUDIT-REPORTS/INTEGRATION-*.md`                      |
| **MD Arquitetural** | Macro-Fase III       | `TEMPLATE-VISAO-ARQUITETURAL.md`      | `COPILOT-AUDIT-REPORTS/ARCHITECTURE-VISION.md`                |
| **Consolidados**    | Macro-Fase III       | — (tabelas)                           | `00-SUMMARY.md`, `ISSUES-CONSOLIDATED.md`, `ROADMAP-FIXES.md` |

---

## Estrutura de Saída Completa

```
DOCUMENTAÇÃO/AUDITORIAS/COPILOT-AUDIT-REPORTS/
├── templates/                               ← 4 templates
│   ├── TEMPLATE-ARQUIVO-INDIVIDUAL.md
│   ├── TEMPLATE-MODULO-CONSOLIDADO.md
│   ├── TEMPLATE-INTEGRACAO-CROSS-MODULE.md
│   └── TEMPLATE-VISAO-ARQUITETURAL.md
├── agent/                                   ← 22 MDs individuais
├── tools/                                   ← 23 MDs individuais
├── observability/                           ← 9 MDs individuais
├── hooks/                                   ← 18 MDs individuais
├── terminal/                                ← 27 MDs individuais
├── bridges/                                 ← 10 MDs individuais
├── conversation-hub/                        ← 6 MDs individuais
├── config/                                  ← 9 MDs individuais
├── lib/                                     ← 12 MDs individuais
├── routes/                                  ← 7 MDs individuais
├── channel/                                 ← 3 MDs individuais
├── api/                                     ← 6 MDs individuais
├── core/                                    ← 3 MDs individuais
├── types/                                   ← 3 MDs individuais
├── db/                                      ← 2 MDs individuais
├── 01-agent.md ... 15-db.md                 ← 15 consolidados
├── INTEGRATION-*.md                         ← 7 integrações
├── ARCHITECTURE-VISION.md                   ← visão global
├── ISSUES-CONSOLIDATED.md                   ← todas as questões
├── ROADMAP-FIXES.md                         ← roadmap priorizado
└── 00-SUMMARY.md                            ← sumário executivo
```

---

## Critérios de Conclusão

A auditoria v2.0 está concluída quando:

- [ ] Todos os 160 arquivos relidos integralmente (MF-II)
- [ ] 160 MDs individuais gerados (1 por arquivo)
- [ ] 15 MDs consolidados gerados (1 por módulo)
- [ ] 7 MDs de integração cross-module gerados
- [ ] 1 MD de visão arquitetural global gerado
- [ ] `ISSUES-CONSOLIDATED.md` com todas as questões
- [ ] `ROADMAP-FIXES.md` priorizado
- [ ] `00-SUMMARY.md` atualizado
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
| 5   | terminal/         | 27    | 4920 | LLM-B terminal, REPL, commands             |
| 6   | conversation-hub/ | 6     | 2206 | Multi-session orchestration, store         |
| 7   | bridges/          | 10    | 2044 | Git, GitHub, NERV, MCP integration         |
| 8   | lib/              | 12    | 1904 | Utilities, validators, SDK client          |
| 9   | routes/           | 7     | 1546 | Express routes for API                     |
| 10  | config/           | 9     | 1540 | Session config, prompts, MCP, tools        |
| 11  | channel/          | 3     | 1175 | SSE client, inject script                  |
| 12  | api/              | 6     | 741  | HTTP bridge layer                          |
| 13  | core/             | 3     | 162  | Constants, errors                          |
| 14  | types/            | 3     | 515  | SDK types, structured messages             |
| 15  | db/               | 2     | 358  | SQLite, migrations                         |
