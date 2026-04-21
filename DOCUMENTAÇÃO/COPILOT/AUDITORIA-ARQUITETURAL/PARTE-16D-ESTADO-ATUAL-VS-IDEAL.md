# PARTE-16D — Estado Atual vs Estado Ideal (Pós-F120)

**Data**: 2026-04-08 **Baseline**: commit `bfe96b57` **Referência**: PARTE-14D (estado ideal
original), PARTE-16A/B/C (nova auditoria)

---

## 1. Comparativo de Progresso

### 1.1 O que foi Alcançado (PARTE-14E: F49-F120)

| Dimensão                | Antes (F48)  | Depois (F120)    | % Progresso |
| ----------------------- | ------------ | ---------------- | ----------: |
| Arquivos em `agent/`    | 37 (7.200L)  | 53 (7.736L)      |        100% |
| Testes em `agent/`      | 3            | 11               |        100% |
| God modules em `agent/` | 9            | 2                |         78% |
| Tipos/schemas Zod       | 12           | 35+              |        100% |
| Error hierarchy         | CopilotError | 8 subclasses     |        100% |
| Retry centralizado      | 0            | core/retry.js    |        100% |
| Timeout centralizado    | 0            | core/abort-utils |        100% |
| Shutdown centralizado   | 0            | core/shutdown.js |        100% |
| OTEL spans              | 0            | turn/tool spans  |        100% |
| Coverage thresholds CI  | 0            | 30/20/30         |        100% |
| Typecheck CI            | 0            | typecheck job    |        100% |
| Event catalog           | 0            | Documentado      |        100% |

### 1.2 O que Ficou Fora do Escopo (Dívida Herdada)

| Dimensão                     | Valor Atual    | Estado Ideal | Gap             |
| ---------------------------- | -------------- | ------------ | --------------- |
| God modules (todo o copilot) | 22             | ≤8           | 14 a decompor   |
| Módulos com 0 testes         | 2 (5.156L)     | 0            | 2 módulos       |
| FS sync no runtime           | ~60            | ≤10          | ~50 a migrar    |
| Catch blocks vazios          | ~133           | ≤20          | ~113 a corrigir |
| Retry duplicado              | 4              | 0            | 4 a migrar      |
| Shutdown não integrado       | ~14 process.on | ≤3           | ~11 a migrar    |
| Timers sem cleanup           | ~15            | ≤3           | ~12 a corrigir  |
| SEC issues médias            | 4              | 0            | 4 a corrigir    |
| Testes totais                | 2.342          | ≥3.000       | +658 a criar    |
| Coverage lines               | ~30%           | ≥45%         | +15% a subir    |

---

## 2. Estado Ideal Expandido (Pós-PARTE-16)

### 2.1 Por Subsistema

| Subsistema            | Estado Atual                              | Estado Ideal Pós-16                           |
| --------------------- | ----------------------------------------- | --------------------------------------------- |
| **core/**             | Retry+abort+shutdown+errors bem faturados | +safe-json, +timer-registry, +circuit-breaker |
| **config/**           | Env+system-prompt bem organizados         | Sem mudança necessária                        |
| **db/**               | SQLite com shutdown handler               | Sem mudança necessária                        |
| **observability/**    | Logger+OTEL+metrics existem mas 1 teste   | Cobertura ≥20%, catch blocks corrigidos       |
| **agent/**            | 11 testes, 2 god modules restantes        | always-alive <400L, loop-manager <400L        |
| **terminal/**         | 3 testes, 5 god modules                   | index/server/engine/repl <400L, ≥8 testes     |
| **tools/**            | 6 testes, 3 god modules                   | crud/introspection split, ≥10 testes          |
| **conversation-hub/** | 0 testes, 4 god modules                   | orchestrator/store split, ≥6 testes           |
| **bridges/**          | 0 testes, 3 god modules                   | retry migrado, ≥4 testes                      |
| **channel/**          | 1 teste, 1 god module (556L!)             | client <400L, ≥3 testes                       |
| **hooks/**            | 4 testes, 1 god module                    | factory split, manter testes                  |
| **sdk/**              | 2 testes, 1 god module                    | client split, manter testes                   |
| **api/**              | 3 testes, 0 god modules                   | origin validation, manter testes              |
| **audit/**            | 8 testes, 1 god module                    | pipeline split (pode esperar)                 |

### 2.2 Princípios Arquiteturais Alvo

1. **Nenhum módulo sem testes** — todo subsistema com ≥1 arquivo de teste
2. **Nenhum arquivo >500L** — decomposição agressiva dos 22 remanescentes
3. **100% FS async no runtime** — sync permitido somente em init/shutdown
4. **Shutdown centralizado** — todos os handlers via `registerShutdownHandler`
5. **Retry/timeout centralizados** — zero padrões duplicados
6. **Timer lifecycle** — todo timer registrado com cleanup function
7. **Error handling explícito** — zero catch blocks vazios sem justificativa
8. **Security baseline** — zero issues de severidade média ou acima

---

## 3. Matriz de Risco por Cenário

### 3.1 Cenário: Sessão Longa (>4h)

| Risco                           | Probabilidade | Impacto  | Mitigação Atual | Gap         |
| ------------------------------- | ------------- | -------- | --------------- | ----------- |
| Memory leak (metrics unbounded) | 🟡 Média      | 🟡 Médio | Nenhuma         | PRF-03      |
| Memory leak (event-collector)   | 🟡 Média      | 🟡 Médio | Nenhuma         | PRF-07      |
| Timer accumulation              | 🟢 Baixa      | 🟢 Baixo | Parcial         | CNF-T01..06 |
| SQLite WAL growth               | 🟢 Baixa      | 🟢 Baixo | Checkpoint      | ✅ OK       |
| Log file growth                 | 🟢 Baixa      | 🟢 Baixo | Rotation        | ✅ OK       |

### 3.2 Cenário: Crash e Recovery

| Risco                         | Probabilidade | Impacto  | Mitigação Atual  | Gap         |
| ----------------------------- | ------------- | -------- | ---------------- | ----------- |
| State corruption (sync write) | 🟡 Média      | 🔴 Alto  | Nenhuma          | CNF-F01..03 |
| Orphan timers pós-crash       | 🟡 Média      | 🟢 Baixo | Nenhuma          | CNF-T01..06 |
| Incomplete shutdown           | 🟡 Média      | 🟡 Médio | Parcial (entry)  | PAD-09..12  |
| DB corruption                 | 🟢 Baixa      | 🔴 Alto  | WAL mode + exit  | ✅ OK       |
| Session state loss            | 🟡 Média      | 🟡 Médio | Snapshot restore | RC-01..02   |

### 3.3 Cenário: Ataque via Tool Input

| Risco                           | Probabilidade | Impacto  | Mitigação Atual   | Gap    |
| ------------------------------- | ------------- | -------- | ----------------- | ------ |
| Path traversal (file tools)     | 🟢 Baixa      | 🟡 Médio | isWithinWorkspace | SEC-04 |
| Shell injection (session-tools) | 🟢 Baixa      | 🔴 Alto  | Timeout only      | SEC-01 |
| SSRF (web-tools)                | 🟢 Baixa      | 🟡 Médio | URL validation    | SEC-05 |
| SQL injection (todo store)      | 🟢 Baixa      | 🟡 Médio | Prepared stmts    | ✅ OK  |
| XSS (terminal output)           | 🟢 Baixa      | 🟢 Baixo | Non-browser env   | ✅ N/A |

---

## 4. Matriz de Impacto de Mudança

Estimativa do impacto de cada tipo de refatoração planejada:

| Faixa Planejada                 | Arquivos Toc. | Testes Novos | Risco de Break | Dependências  |
| ------------------------------- | ------------: | -----------: | -------------- | ------------- |
| F1: Foundation hardening        |          8-12 |          5-8 | 🟢 Baixo       | core/ only    |
| F2: Security hardening          |           4-6 |          4-6 | 🟢 Baixo       | tools, server |
| F3: Catch block audit           |         20-30 |          0-2 | 🟢 Baixo       | Scattered     |
| F4: Timer cleanup               |          8-10 |          3-5 | 🟢 Baixo       | Scattered     |
| F5: conversation-hub tests      |           0-2 |         6-10 | 🟢 Baixo       | Nenhum        |
| F6: bridges tests               |           0-2 |          4-6 | 🟢 Baixo       | Nenhum        |
| F7: terminal decomposição       |         10-15 |          5-8 | 🟡 Médio       | terminal/\*   |
| F8: tools decomposição + testes |          8-12 |         6-10 | 🟡 Médio       | tools/\*      |
| F9: observability tests         |           0-2 |          4-6 | 🟢 Baixo       | Nenhum        |
| F10: God module decomp tier-2   |         10-15 |          5-8 | 🟡 Médio       | Multiple      |
| F11: God module decomp tier-3   |          8-12 |          3-5 | 🟡 Médio       | Multiple      |
| F12: Performance hardening      |          6-10 |          2-4 | 🟡 Médio       | FS paths      |
| F13: API consistency            |           4-8 |          2-4 | 🟢 Baixo       | api, server   |
| F14: Coverage + CI + relatório  |           2-4 |          0-2 | 🟢 Baixo       | CI config     |
| **TOTAL**                       |    **88-140** |    **49-82** |                |               |

---

## 5. Conclusão

O PARTE-14E endereçou com sucesso a dívida técnica do subsistema `agent/`, que era o mais crítico.
No entanto, a auditoria pós-F120 revela que **a maioria da dívida técnica reside nos subsistemas
periféricos** — terminal (7.618L), tools (6.120L), conversation-hub (2.473L) e bridges (2.183L) —
que não foram tocados pelo roadmap anterior.

O PARTE-16E propõe 14 faixas cobrindo **todo o módulo copilot** com foco em:

1. **Confiabilidade**: FS async, catch blocks, timer cleanup, shutdown integration
2. **Segurança**: execSync migration, auth hardening, origin validation
3. **Cobertura**: 49-82 novos testes, alvo de 45% coverage lines
4. **Decomposição**: Reduzir de 22 para ≤8 god modules (≤500L each)
5. **Padronização**: Retry/timeout/shutdown centralizados em 100% dos módulos

Estimativa de escopo: ~88-140 arquivos tocados, ~49-82 testes novos.
