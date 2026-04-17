# R-02 — Mapa `as-is` de `src/copilot/`

**Data-base**: 2026-04-15 **Status**: vigente para esta série

---

## 1. Snapshot global

| Métrica                          |                                    Valor |
| -------------------------------- | ---------------------------------------: |
| Arquivos `.js` em `src/copilot/` |                                      426 |
| Linhas em `src/copilot/`         |                                   63.869 |
| Diretórios top-level em disco    |                                       22 |
| Diretórios top-level com `.js`   |                                       20 |
| Módulo com maior LOC             | `agent/` (8.327L em medição operacional) |
| Segundo maior módulo             |                          `sdk/` (7.913L) |
| Terceiro maior módulo            |                        `tools/` (7.101L) |
| Quarto maior módulo              |                     `terminal/` (5.943L) |

> Observação: pequenas diferenças de 1–2 linhas entre medições documentais e operacionais são
> esperadas por comentários/edições recentes. A leitura arquitetural não muda com isso — o dragão
> continua grande.

---

## 2. Totais por diretório de topo

| Diretório           | Arquivos `.js` | Linhas | Leitura rápida                                                |
| ------------------- | -------------: | -----: | ------------------------------------------------------------- |
| `agent/`            |             62 |  8.327 | maior hotspot estrutural                                      |
| `sdk/`              |             38 |  7.913 | fronteira ainda stateful e vazada                             |
| `tools/`            |             33 |  7.101 | plataforma grande, mas relativamente saudável                 |
| `terminal/`         |             47 |  5.943 | muito rico em capabilities, precisa governança com `server/`  |
| `observability/`    |             33 |  5.860 | transversal e acoplado demais                                 |
| `server/`           |             41 |  5.304 | cresceu bastante e precisa fronteira melhor                   |
| `hooks/`            |             25 |  4.610 | já melhorou, mas ainda conversa demais com outros eixos       |
| `core/`             |             20 |  3.146 | base útil, ainda com alguns sinais de acoplamento impróprio   |
| `config/`           |             24 |  2.550 | consolidado, mas ainda misto entre builders e runtime         |
| `conversation-hub/` |             12 |  2.217 | orquestração relevante, lifecycle ainda subexplorado          |
| `events/`           |             20 |  2.299 | catálogo relevante, mas inflado para a governança atual       |
| `bridges/`          |             13 |  2.192 | integrações externas importantes                              |
| `channel/`          |              8 |  1.437 | comunicação com LLM-B; precisa fronteira mais explícita       |
| `presentation/`     |              5 |  1.228 | SSOT compartilhada das bordas `server/` / `terminal/`         |
| `infra/`            |             11 |  1.023 | já mais saudável que no passado                               |
| `audit/`            |              9 |    906 | subsistema auxiliar, mas merece alinhamento com observability |
| `event-handlers/`   |             13 |    802 | avanço positivo vindo de `agent/`                             |
| `db/`               |              3 |    437 | pequeno, mas estruturalmente importante                       |
| `plugins/`          |              3 |    268 | embrionário                                                   |
| `types/`            |              4 |    219 | pequeno, mas insuficiente para o volume contratual existente  |
| `logs/`             |              0 |      0 | diretório vazio, sinal de drift taxonômico                    |

---

## 3. Leitura por camadas — estado real

### 3.1 Camada de apresentação / borda externa

- `server/`
- `terminal/`
- partes de `channel/`

**Problema atual**: a dependência estrutural direta `server → terminal` já foi zerada, mas a borda
ainda exige governança de contratos compartilhados, DI interna e ownership mais claro entre
`server/`, `terminal/` e `presentation/`.

### 3.2 Camada de orquestração

- `agent/`
- `conversation-hub/`
- partes de `channel/`

**Problema atual**: ownership de sessão, fluxo e estado operacional ainda está repartido demais.

### 3.3 Camada de políticas e runtime de domínio

- `tools/`
- `hooks/`
- `config/`
- `event-handlers/`
- partes de `bridges/`

**Problema atual**: boa parte dessa camada ainda importa infraestrutura transversal demais.

### 3.4 Camada transversal / core

- `core/`
- `events/`
- `observability/`
- `infra/`
- `db/`
- `types/`
- `audit/`

**Problema atual**: `observability/` e `events/` aparecem demais como dependências diretas; isso
reduz encapsulamento e eleva fan-out.

---

## 4. Mapa de sinais de acoplamento

### 4.1 Imports e fan-in

| Sinal                               | Valor | Interpretação                                      |
| ----------------------------------- | ----: | -------------------------------------------------- |
| imports de `sdk` fora de `sdk/`     |    95 | a fronteira do SDK ainda não está bem fechada      |
| imports de `observability`          |    97 | logging/metrics/tracing espalhados demais          |
| imports de `agent` fora de `agent/` |    52 | `agent` virou API de conveniência para muita coisa |
| imports `server → terminal`         |     0 | slice estrutural principal de P4 já foi fechado    |

### 4.2 Eventos

| Sinal                              | Valor | Interpretação                                                          |
| ---------------------------------- | ----: | ---------------------------------------------------------------------- |
| referências a EventBus / emissão   |   733 | topologia orientada a eventos muito forte, porém ainda pouco governada |
| `event-handlers/` fora de `agent/` |   sim | bom avanço, mas ainda incompleto como programa                         |

### 4.3 Dívida visível

| Sinal                            | Valor | Interpretação                                  |
| -------------------------------- | ----: | ---------------------------------------------- |
| arquivos com `@deprecated`       |    20 | limpeza residual ainda necessária              |
| marcadores `TODO/FIXME/HACK/XXX` |    21 | backlog embutido no código permanece relevante |
| `catch {}` silenciosos           |    12 | risco de swallow de erro ainda existe          |

---

## 5. Estado `as-is` do `agent/` dentro do sistema

### 5.1 Papel real atual

`agent/` hoje é simultaneamente:

- fachada pública do AlwaysAlive runtime;
- coordenador de sessão e lifecycle;
- centro do loop de diálogo;
- ponte para health, background tasks e estado;
- consumidor intenso de `sdk/`, `events/`, `observability/`, `config/`, `hooks/`, `tools/`,
  `conversation-hub/` e `server/` indiretamente.

### 5.2 Relação com o restante de `src/copilot`

Principais fronteiras quentes:

- `agent ↔ sdk`
- `agent ↔ observability`
- `agent ↔ hooks`
- `agent ↔ event-handlers/events`
- `agent ↔ conversation-hub`
- `server ↔ terminal ↔ agent`
- `channel ↔ terminal ↔ agent`

### 5.3 Hotspots internos atuais do `agent/`

| Subárvore    | Linhas | Diagnóstico                                               |
| ------------ | -----: | --------------------------------------------------------- |
| `session/`   |  1.975 | boot, init, keepalive, snapshot e wiring continuam densos |
| `dialog/`    |  1.902 | domínio já bem mais modular, mas ainda grande             |
| `lifecycle/` |  1.299 | coordenação operacional ainda pesada                      |

---

## 6. O que o mapa `as-is` já permite concluir

### 6.1 O problema não é local

O problema arquitetural de `src/copilot/` não pode ser resolvido só dentro de `agent/`.

O módulo é o epicentro, mas a crise é de **fronteiras entre módulos**.

### 6.2 `sdk/`, `observability/` e `server/terminal` precisam entrar no mesmo programa de reestruturação

Tentar “arrumar só o agent” sem mexer nessas fronteiras produziria um falso progresso:

- menos LOC local;
- mesma difusão sistêmica.

### 6.3 A documentação atual confirma backlog suficiente para um plano multi-programa

O volume de backlog residual em:

- `M-03`, `M-04`, `M-05`, `M-06`, `M-07`
- `ROADMAP-UPGRADES-SRC-COPILOT.md`
- auditorias antigas

é grande o bastante para justificar um roadmap novo por programas, e não só por fases lineares.

---

## 7. Conclusão do mapa `as-is`

O estado atual de `src/copilot/` é o de um sistema funcional, avançado e parcialmente refatorado,
mas ainda fortemente condicionado por:

- fronteiras herdadas;
- compatibilidade residual;
- event-driven fan-out alto;
- ausência de uma linha documental única para as próximas grandes ondas.

Este mapa `as-is` serve como base factual para os próximos documentos:

- `R-03` — foco no `agent/`;
- `R-04` — arquitetura-alvo;
- `R-05` — gaps e transformações;
- `R-06` — roadmap master.
