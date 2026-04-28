# 26 — Score Inicial de Maturidade Arquitetural por Módulo

**Status**: baseline quantitativa inicial **Última atualização**: 2026-04-27 **Escopo desta etapa**:
atribuir uma nota inicial de maturidade arquitetural a cada módulo de primeiro nível de
`src/copilot/`, para servir como baseline de evolução da revolução.

---

## 1. Objetivo deste documento

Este score inicial não pretende fingir precisão matemática absoluta. Ele existe para criar uma base
comparável ao longo do tempo.

Cada módulo recebe notas de **0 a 5** em cinco critérios:

1. **owner clarity** — clareza do owner principal;
2. **seam health** — qualidade dos seams de consumo/exposição;
3. **boundary hygiene** — limpeza de fronteira/importação;
4. **observability readiness** — condição de ser observado/governado sem gambiarras;
5. **doc coverage** — clareza documental atual.

A nota final é apenas indicativa; o valor principal está na decomposição por critério.

---

## 2. Escala usada

| Nota | Significado resumido                                 |
| ---- | ---------------------------------------------------- |
| 0    | caótico / sem owner discernível                      |
| 1    | muito frágil / owner concorrente dominante           |
| 2    | parcialmente estruturado, mas com conflito relevante |
| 3    | razoável, porém com dívida arquitetural relevante    |
| 4    | forte, com pontos de melhoria localizados            |
| 5    | muito maduro e nitidamente governável                |

---

## 3. Score por módulo

| Módulo              | Owner clarity | Seam health | Boundary hygiene | Observability readiness | Doc coverage | Média |
| ------------------- | ------------: | ----------: | ---------------: | ----------------------: | -----------: | ----: |
| `sdk/`              |           4.5 |         4.0 |              4.5 |                     4.5 |          5.0 |   4.5 |
| `agent/`            |           3.0 |         2.5 |              2.5 |                     3.5 |          4.0 |   3.1 |
| `event-handlers/`   |           4.0 |         4.0 |              4.0 |                     3.5 |          4.0 |   3.9 |
| `events/`           |           3.5 |         3.5 |              3.5 |                     4.0 |          3.5 |   3.6 |
| `hooks/`            |           3.0 |         2.5 |              3.0 |                     3.5 |          4.0 |   3.2 |
| `tools/`            |           3.5 |         3.0 |              3.0 |                     3.5 |          4.0 |   3.4 |
| `presentation/`     |           3.5 |         3.0 |              3.0 |                     3.5 |          4.0 |   3.4 |
| `server/`           |           3.5 |         3.0 |              3.0 |                     3.5 |          3.5 |   3.3 |
| `terminal/`         |           3.0 |         2.5 |              2.5 |                     3.5 |          4.0 |   3.1 |
| `conversation-hub/` |           3.0 |         2.5 |              3.0 |                     3.0 |          4.0 |   3.1 |
| `bridges/`          |           3.5 |         3.0 |              3.5 |                     4.0 |          4.0 |   3.6 |
| `infra/`            |           2.5 |         3.0 |              3.0 |                     3.0 |          2.0 |   2.7 |
| `channel/`          |           2.5 |         2.5 |              3.0 |                     3.0 |          4.0 |   3.0 |
| `plugins/`          |           1.5 |         2.0 |              3.0 |                     2.5 |          2.0 |   2.2 |
| `config/`           |           4.0 |         3.5 |              3.5 |                     3.0 |          4.0 |   3.6 |
| `boot/`             |           4.0 |         3.5 |              3.5 |                     3.0 |          3.5 |   3.5 |
| `core/`             |           4.5 |         4.0 |              4.0 |                     3.5 |          3.5 |   3.9 |
| `types/`            |           2.5 |         3.0 |              3.5 |                     2.5 |          4.0 |   3.1 |
| `dialog/`           |           2.0 |         3.0 |              3.5 |                     2.0 |          1.5 |   2.4 |
| `observability/`    |           3.5 |         3.0 |              3.0 |                     4.5 |          4.0 |   3.6 |
| `audit/`            |           3.0 |         2.5 |              3.0 |                     4.0 |          4.0 |   3.3 |
| `db/`               |           4.0 |         3.5 |              4.0 |                     3.0 |          3.0 |   3.5 |
| `logs/`             |           0.5 |         1.0 |              0.5 |                     1.0 |          0.5 |   0.7 |
| `.github/` interna  |           0.5 |         1.0 |              0.5 |                     1.0 |          0.5 |   0.7 |

---

## 4. Leitura do score

## 4.1 Módulos mais maduros hoje

Os módulos que partem mais fortes para a revolução são:

- `sdk/`
- `core/`
- `event-handlers/`
- `config/`
- `observability/` (com ressalvas)
- `bridges/`

## 4.2 Módulos com maior urgência de clarificação

Os módulos com maior urgência de redefinição são:

- `plugins/`
- `dialog/`
- `infra/`
- `channel/`
- `agent/` (não por fraqueza, mas por densidade)
- `conversation-hub/`

## 4.3 Anti-owners deliberadamente mal pontuados

`logs/` e `.github/` interna recebem notas baixíssimas porque a auditoria os trata como artefatos,
não como módulos arquiteturalmente saudáveis.

---

## 5. Metas de maturidade pós-revolução

| Módulo/Grupo                                                                   |               Meta sugerida |
| ------------------------------------------------------------------------------ | --------------------------: |
| `sdk/`, `core/`, `event-handlers/`, `config/`                                  |                     4.5–5.0 |
| `agent/`, `presentation/`, `server/`, `terminal/`, `conversation-hub/`         |                     4.0–4.5 |
| `hooks/`, `tools/`, `bridges/`, `boot/`, `events/`, `audit/`, `observability/` |                     4.0–4.5 |
| `infra/`, `channel/`, `types/`, `dialog/`, `plugins/`                          | 3.5–4.5 (após clarificação) |
| `logs/`, `.github/` interna                                                    |   fora da matriz de módulos |

---

## 6. Decisões preliminares desta etapa

### D26-01

O score será usado como baseline comparativo, não como verdade absoluta.

### D26-02

A revolução deve elevar sobretudo `agent/`, `presentation/`, `conversation-hub/`, `channel/`,
`infra/`, `plugins/` e `dialog/`.

### D26-03

`logs/` e `.github/` interna devem sair da leitura normal de maturidade modular.

---

## 7. Conclusão desta etapa

O score inicial confirma a tese central da auditoria:

- o sistema já tem blocos muito maduros;
- a revolução não começa do zero;
- mas há módulos críticos demais ainda operando abaixo da clareza necessária para uma arquitetura
  governável de longo prazo.
