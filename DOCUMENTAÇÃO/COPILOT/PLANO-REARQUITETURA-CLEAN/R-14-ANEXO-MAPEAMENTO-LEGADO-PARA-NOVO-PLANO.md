# R-14 — Anexo: mapeamento do legado para o novo plano clean

**Objetivo**: permitir continuidade sem perder o valor do acervo histórico

---

## 1. Regra geral

A partir desta série:

- o acervo antigo continua como **fonte histórica, evidencial e analítica**;
- a série `PLANO-REARQUITETURA-CLEAN/` passa a ser a **referência operacional principal**.

---

## 2. Mapeamento por diretório legado

| Diretório/arquivo legado          | Papel histórico                                                 | Onde cai na nova linha                              |
| --------------------------------- | --------------------------------------------------------------- | --------------------------------------------------- |
| `PLANO-MIGRACAO/`                 | plano operacional da primeira grande leva                       | `R-06` + programas `R-07` a `R-13`                  |
| `AUDITORIA-SDK-COPILOT/`          | inventário e visão de SDK/agent antigos                         | `R-02`, `R-03`, `R-04`, `R-09`                      |
| `AUDITORIA-DEEP-SRC-COPILOT/`     | auditoria transversal por eixo                                  | `R-00`, `R-01`, `R-05`, `R-06`, `R-13`              |
| `AUDITORIA-ARQUITETURAL/`         | acervo muito amplo de análises e roadmaps                       | fonte histórica transversal para toda a série clean |
| `ROADMAP-UPGRADES-SRC-COPILOT.md` | capabilities e upgrades futuros, muito centrados em terminal/UX | `R-15` e partes de `R-11`                           |

---

## 3. Mapeamento dos documentos `M-00` a `M-07`

| Documento antigo                        | Novo ponto principal   |
| --------------------------------------- | ---------------------- |
| `M-00-VISAO-GERAL.md`                   | `R-01`, `R-04`, `R-06` |
| `M-01-INVENTARIO-SITUACAO-ATUAL.md`     | `R-02`                 |
| `M-02-FASE-CLEANUP.md`                  | `R-07`, `R-13`         |
| `M-03-FASE-AGENT-REFACTOR.md`           | `R-03`, `R-08`         |
| `M-03A-AUDITORIA-ARQUITETURAL-AGENT.md` | `R-03`, `R-08`         |
| `M-04-FASE-SDK-STATELESS.md`            | `R-09`                 |
| `M-05-FASE-EVENT-UNIFICATION.md`        | `R-10`                 |
| `M-06-FASE-OBSERVABILITY-ERRORS.md`     | `R-10`, `R-13`         |
| `M-07-FASES-FUTURAS.md`                 | `R-15`                 |

---

## 4. Mapeamento de temas antigos para programas novos

| Tema antigo                            | Programa novo |
| -------------------------------------- | ------------- |
| cleanup estrutural residual            | P0 + P6       |
| refactor do agent                      | P1            |
| SDK stateless                          | P2            |
| unificação de eventos                  | P3            |
| error pipeline / observability         | P3 + P6       |
| server/routes/api/terminal boundary    | P4            |
| conversation hub lifecycle             | P4            |
| tools/config/core/infra/types          | P5            |
| segurança, testes, typing, docs        | P6            |
| RPC/TSServer/terminal UX/multi-session | P7            |

---

## 5. Como usar o acervo antigo daqui para frente

### Use diretamente o acervo legado quando precisar de

- evidência histórica;
- comparação de snapshots;
- detalhes de uma onda antiga já executada;
- justificativa de decisões passadas.

### Use a série clean quando precisar de

- roadmap operacional atual;
- arquitetura-alvo;
- prioridades e dependências;
- backlog estruturado para as próximas ondas.

---

## 6. Nota de governança

Se um novo documento for criado fora desta série para orientar execução arquitetural ampla, ele deve:

- apontar explicitamente para esta série;
- ou ser incorporado a ela.

O objetivo é evitar que o sistema volte a ter quatro “roadmaps principais” ao mesmo tempo. Um já é divertido o bastante.
