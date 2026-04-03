# Visão Arquitetural Consolidada — src/copilot

> Gerado como etapa final da Macro-Fase III do Copilot Full Audit. Plano:
> `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-FULL-AUDIT-PLAN.md` v2.0 Este documento é escrito APÓS todos os
> MDs de módulo e de integração estarem completos.

---

## 1. Sumário Executivo

> 10-15 frases que qualquer desenvolvedor/líder técnico deve ler para entender o estado arquitetural
> atual do sistema.

{Sumário executivo}

---

## 2. Visão Macro — Estado Atual (AS-IS)

### 2.1 Mapa de módulos com health scores

| #   | Módulo    | Files   | LOC     | Score Saúde | Achados | Top Risk          |
| --- | --------- | ------- | ------- | ----------- | ------- | ----------------- |
| 1   | agent/    | 22      | 4914    | {0-10}      | {N}     | {principal risco} |
| 2   | tools/    | 23      | 5716    | {0-10}      | {N}     | {principal risco} |
| …   | …         | …       | …       | {0-10}      | {N}     | …                 |
|     | **TOTAL** | **160** | **{N}** | **{avg}**   | **{N}** |                   |

### 2.2 Grafo de acoplamento entre módulos

```
                    ┌──────────┐
               ┌───→│ observ.  │←── {N} módulos importam
               │    └──────────┘
               │         ↑
  ┌─────────┐  │    ┌──────────┐     ┌──────────┐
  │ agent/  │──┼───→│ hooks/   │←───→│ config/  │
  └─────────┘  │    └──────────┘     └──────────┘
       ↕       │         ↑                ↑
  ┌─────────┐  │    ┌──────────┐     ┌──────────┐
  │ tools/  │──┘    │ lib/     │←────│ types/   │
  └─────────┘       └──────────┘     └──────────┘
       ↑                 ↑
  ┌─────────┐       ┌──────────┐
  │terminal/│       │ routes/  │
  └─────────┘       └──────────┘
```

> Representar numericamente: quantos imports cruzam entre cada par de módulos.

### 2.3 Métricas de acoplamento consolidadas

| Métrica                       | Valor | Interpretação   |
| ----------------------------- | ----- | --------------- |
| Total de imports cross-module | {N}   | {alto/normal}   |
| Barrel bypasses               | {N}   | {alto/normal}   |
| SDK direto (sem façade)       | {N}   | {alto/normal}   |
| Dependências circulares       | {N}   | {pares}         |
| Module-level `let` singletons | {N}   | {com/sem reset} |
| Maps/Sets sem TTL             | {N}   | {leak risk}     |
| Módulos com 0 specs           | {N}   | {quais}         |

---

## 3. Conformidade com o Modelo TO-BE

### 3.1 Modelo de camadas de referência

```
Layer 1 — Infrastructure:  db/, infra/ (pool, locks, storage)
Layer 2 — Utilities:       lib/, types/, core/
Layer 3 — Observability:   observability/
Layer 4 — Domain Logic:    hooks/, config/, tools/, bridges/, channel/
Layer 5 — Orchestration:   agent/, conversation-hub/, terminal/
Layer 6 — Interface:       routes/, api/, server/
```

### 3.2 Violações de camada detectadas

| Violação                | De (camada) | Para (camada)  | Arquivo        | Linha |
| ----------------------- | ----------- | -------------- | -------------- | ----- |
| {descrição da violação} | {layer N}   | {layer M, M>N} | `{arquivo}.js` | L{N}  |

### 3.3 Score de conformidade por módulo

| Módulo | Camada esperada | Imports corretos | Imports upward | % Conformidade |
| ------ | --------------- | ---------------- | -------------- | -------------- |
| agent/ | 5               | {N}              | {N}            | {N}%           |
| …      | …               | …                | …              | …%             |

---

## 4. Análise de Princípios Arquiteturais (P1-P10)

| Princípio               | Code | Conformidade Global | Gaps                       |
| ----------------------- | ---- | ------------------- | -------------------------- |
| Single import path      | P1   | {0-10}              | {barrier bypasses}         |
| Observable by default   | P2   | {0-10}              | {modules not instrumented} |
| Explicit lifecycle      | P3   | {0-10}              | {singletons without init}  |
| Contract-first          | P4   | {0-10}              | {missing types}            |
| Test-driven             | P5   | {0-10}              | {modules with 0 specs}     |
| Defense in depth        | P6   | {0-10}              | {missing validation}       |
| Fail gracefully         | P7   | {0-10}              | {unhandled errors}         |
| Configuration over code | P8   | {0-10}              | {hardcoded values}         |
| Dependency injection    | P9   | {0-10}              | {direct instantiation}     |
| Resource bounded        | P10  | {0-10}              | {unbounded collections}    |

---

## 5. Consolidação Global de Achados

### 5.1 Por tipo

| Tipo  | Total   | P0  | P1  | P2  | P3  | P4  |
| ----- | ------- | --- | --- | --- | --- | --- |
| BUG   | {N}     |     |     |     |     |     |
| RACE  | {N}     |     |     |     |     |     |
| LEAK  | {N}     |     |     |     |     |     |
| SEC   | {N}     |     |     |     |     |     |
| PERF  | {N}     |     |     |     |     |     |
| GAP   | {N}     |     |     |     |     |     |
| INC   | {N}     |     |     |     |     |     |
| DEAD  | {N}     |     |     |     |     |     |
| ARCH  | {N}     |     |     |     |     |     |
| TEST  | {N}     |     |     |     |     |     |
| INTG  | {N}     |     |     |     |     |     |
| TYPO  | {N}     |     |     |     |     |     |
| **∑** | **{N}** |     |     |     |     |     |

### 5.2 Por módulo

| Módulo | Total | P0  | P1  | P2  | P3  | P4  | Score  |
| ------ | ----- | --- | --- | --- | --- | --- | ------ |
| agent/ | {N}   |     |     |     |     |     | {0-10} |
| tools/ | {N}   |     |     |     |     |     | {0-10} |
| …      | …     |     |     |     |     |     | …      |

### 5.3 Top-10 achados mais críticos do sistema

| #   | ID               | Título   | Módulo   | Sev | Impacto em 1 frase |
| --- | ---------------- | -------- | -------- | --- | ------------------ |
| 1   | `{TIPO-MÓD-SEQ}` | {título} | {módulo} | P0  | {impacto}          |
| …   | …                | …        | …        | …   | …                  |

---

## 6. Roadmap de Transformação

### 6.1 Ondas de correção priorizadas

| Onda | Descrição                    | Achados cobertos | Esforço | Impacto |
| ---- | ---------------------------- | ---------------- | ------- | ------- |
| 1    | Correções P0 (bloqueantes)   | {IDs}            | {S/M/L} | 🔴      |
| 2    | Correções P1 (alto impacto)  | {IDs}            | {S/M/L} | 🟠      |
| 3    | Correções P2 (melhorias)     | {IDs}            | {S/M/L} | 🟡      |
| 4    | Transformações arquiteturais | {IDs T1-T9}      | {S/M/L} | 🟣      |
| 5    | Cobertura de testes          | {IDs TEST-\*}    | {S/M/L} | 🔵      |

### 6.2 Pré-requisitos e dependências entre ondas

```
Onda 1 ← sem deps (executar primeiro)
Onda 2 ← depende de Onda 1 concluída
Onda 3 ← pode rodar em paralelo com Onda 2
Onda 4 ← depende de Ondas 1-3
Onda 5 ← pode iniciar após Onda 2
```

---

## 7. Recomendações Finais

### 7.1 Ações imediatas (esta semana)

1. {Ação 1}
2. {Ação 2}
3. {Ação 3}

### 7.2 Ações a médio prazo (próximo mês)

1. {Ação 1}
2. {Ação 2}

### 7.3 Ações a longo prazo (roadmap trimestral)

1. {Ação 1}
2. {Ação 2}

---

## 8. Índice de Todos os Relatórios

### 8.1 MDs Individuais (por módulo)

| Módulo | Arquivos | Relatórios individuais             |
| ------ | -------- | ---------------------------------- |
| agent/ | 22       | `COPILOT-AUDIT-REPORTS/agent/*.md` |
| tools/ | 23       | `COPILOT-AUDIT-REPORTS/tools/*.md` |
| …      | …        | …                                  |

### 8.2 MDs de Módulo (consolidados)

| Módulo | Relatório                           |
| ------ | ----------------------------------- |
| agent/ | `COPILOT-AUDIT-REPORTS/01-agent.md` |
| tools/ | `COPILOT-AUDIT-REPORTS/02-tools.md` |
| …      | …                                   |

### 8.3 MDs de Integração

| Fluxo             | Relatório                                        |
| ----------------- | ------------------------------------------------ |
| Telemetria E2E    | `COPILOT-AUDIT-REPORTS/INTEGRATION-telemetry.md` |
| Session lifecycle | `COPILOT-AUDIT-REPORTS/INTEGRATION-session.md`   |
| Tool pipeline     | `COPILOT-AUDIT-REPORTS/INTEGRATION-tools.md`     |
| Terminal LLM-B    | `COPILOT-AUDIT-REPORTS/INTEGRATION-terminal.md`  |
| Conv Hub E2E      | `COPILOT-AUDIT-REPORTS/INTEGRATION-conv-hub.md`  |
| Security global   | `COPILOT-AUDIT-REPORTS/INTEGRATION-security.md`  |

### 8.4 MDs Consolidados

| Documento           | Relatório                                      |
| ------------------- | ---------------------------------------------- |
| Visão arquitetural  | `COPILOT-AUDIT-REPORTS/ARCHITECTURE-VISION.md` |
| Issues consolidadas | `COPILOT-AUDIT-REPORTS/ISSUES-CONSOLIDATED.md` |
| Roadmap             | `COPILOT-AUDIT-REPORTS/ROADMAP-FIXES.md`       |
| Sumário executivo   | `COPILOT-AUDIT-REPORTS/00-SUMMARY.md`          |

---

_Gerado por copilot-full-audit skill v2.0 — Visão Arquitetural Consolidada_
