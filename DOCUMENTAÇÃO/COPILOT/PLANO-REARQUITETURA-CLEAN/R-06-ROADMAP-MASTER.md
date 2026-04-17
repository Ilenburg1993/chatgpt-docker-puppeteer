# R-06 — Roadmap Master da Rearquitetura Clean de `src/copilot/`

**Data**: 2026-04-15
**Status**: canônico para o próximo ciclo

> **Expansão operacional**: este documento é a espinha dorsal do roadmap. O detalhamento expandido por
> faixas, fases e subfases está em
> [`R-16-ROADMAP-GERAL-INTEGRADO.md`](./R-16-ROADMAP-GERAL-INTEGRADO.md).

---

## 1. Visão geral

Este roadmap reorganiza o backlog inteiro de `src/copilot/` em **programas**, **ondas**, **fases** e **subfases**.

Ele substitui, para fins operacionais, a navegação por múltiplas séries históricas dispersas.

Leitura complementar obrigatória para evitar drift do alvo:

- [`R-04-ARQUITETURA-ALVO-E-PRINCIPIOS.md`](./R-04-ARQUITETURA-ALVO-E-PRINCIPIOS.md)
- [`R-04A-ENDSTATE-E-CRITERIOS-DE-SUCESSO.md`](./R-04A-ENDSTATE-E-CRITERIOS-DE-SUCESSO.md)

`R-06` e `R-16` dizem **como avançar**; `R-04` e `R-04A` deixam explícito **para onde** a linha clean deve convergir.

---

## 2. Programas da nova linha clean

| Programa | Documento | Escopo principal                                                     |
| -------- | --------- | -------------------------------------------------------------------- |
| P0       | `R-07`    | governança, baseline, métricas, inventário, gates                    |
| P1       | `R-08`    | `agent/`, lifecycle, dialog, session runtime, compat residual        |
| P2       | `R-09`    | `sdk/`, ownership de sessão e fronteiras do wrapper                  |
| P3       | `R-10`    | `events/`, `hooks/`, `observability/`, `audit/`, `event-handlers/`   |
| P4       | `R-11`    | `server/`, `terminal/`, `channel/`, `conversation-hub/`              |
| P5       | `R-12`    | `tools/`, `config/`, `core/`, `infra/`, `types/`, `plugins/`         |
| P6       | `R-13`    | segurança, qualidade, testes, typing, performance, docs, deprecation |
| P7       | `R-15`    | capabilities avançadas e backlog pós-base saudável                   |

---

## 3. Estratégia por ondas

## Onda A — Rebase e fechamento do centro operacional

**Objetivo**: transformar o material auditado em baseline executável e fechar o núcleo do runtime.

Inclui:

- P0 completo
- P1 fase 1 e fase 2
- início de P6 em segurança/gates mínimos

### Entregas-chave

- linha clean canônica consolidada;
- baseline mensurável;
- fechamento do backlog residual mais crítico do `agent/`;
- remoção planejada de compatibilidade residual prioritária.

## Onda B — Fronteiras de sessão, eventos e observabilidade

**Objetivo**: reduzir o custo sistêmico que hoje emana do `agent/` para `sdk/`, `events/`, `hooks/` e `observability/`.

Inclui:

- P2 completo ou quase completo
- P3 fase 1 a fase 3
- reforço de P6 em testes e typing

## Onda C — Borda do sistema e orquestração distribuída

**Objetivo**: corrigir as fronteiras de apresentação e comunicação.

Inclui:

- P4 completo
- partes estruturais de P5
- segurança e observability de borda via P6

## Onda D — Plataformas internas, qualidade e remoção de dívida

**Objetivo**: fechar a base com tools/config/core/infra/types mais limpos e com gates fortes.

Inclui:

- restante de P5
- P6 completo
- grande limpeza de legados, deprecateds e taxonomias mortas

## Onda E — Capacidades avançadas

**Objetivo**: só depois de base saudável, expandir UX, RPC, TSServer, multi-session, plugins e outras capabilities grandes.

Inclui:

- P7

---

## 4. Sequenciamento recomendado

```text
Onda A
  ├─ P0 Governança e baseline
  ├─ P1 Agent core e lifecycle
  └─ P6 Segurança e gates mínimos

Onda B
  ├─ P2 SDK e fronteiras de sessão
  ├─ P3 Eventos, hooks e observabilidade
  └─ P6 Testes, typing e coverage gating

Onda C
  ├─ P4 Server, terminal, channel e hub
  └─ P5 Ferramentas, config, core, infra e types (núcleo)

Onda D
  ├─ P5 Consolidação final
  └─ P6 Remoção de dívida residual e governança forte

Onda E
  └─ P7 Capacidades avançadas e expansões
```

---

## 5. Fases por programa

## P0 — Governança e baseline

### F0.1 — congelar leitura factual do baseline
### F0.2 — consolidar hubs documentais canônicos
### F0.3 — fechar matriz de métricas e indicadores
### F0.4 — alinhar gates mínimos de qualidade e segurança
### F0.5 — definir critérios de aceitação por programa

## P1 — Agent core e lifecycle

### F1.1 — fechar backlog residual do `agent/` atual
- background tasks
- health runtime
- compat residual imediata

### F1.2 — decompor melhor `session/` e `lifecycle/`
- boot
- setup
- snapshot
- recovery
- state IO

### F1.3 — consolidar `dialog/` como domínio explícito
- loop manager
- turn control
- watchdog
- streaming/abort/retry quando fizer sentido estrutural

### F1.4 — slim da fachada pública
- `always-alive.js`
- API pública do módulo
- pontos de fan-in externos

### F1.5 — remoção de compatibilidade residual e regressão ampla

## P2 — SDK e fronteiras de sessão

### F2.1 — retirar ownership de sessão do SDK fino
### F2.2 — consolidar config builders e remover duplicação
### F2.3 — reduzir imports diretos de `sdk` fora do módulo
### F2.4 — alinhar `custom-agents`, contratos e barrels
### F2.5 — hardening de typing/documentação do wrapper

## P3 — Eventos, hooks e observabilidade

### F3.1 — governança do event model
### F3.2 — unificação prática de bridges e naming
### F3.3 — consolidar `event-handlers/`, observers e collectors
### F3.4 — fechar error pipeline e health projections
### F3.5 — reduzir fan-out de `observability/`

## P4 — Server, terminal, channel e hub

### F4.1 — desacoplar `server` de `terminal`
### F4.2 — alinhar rotas, handlers, health e realtime
### F4.3 — fortalecer `channel/` como contrato de comunicação
### F4.4 — formalizar lifecycle do `conversation-hub`
### F4.5 — estabilizar ownership de sessão conversacional

## P5 — Tools, config, core, infra e types

### F5.1 — governança da plataforma de tools
### F5.2 — reorganizar config e bootstrap runtime
### F5.3 — endurecer `core/` e fronteiras de utilidades centrais
### F5.4 — revisar `infra/`, storage, timers, queues e locks
### F5.5 — elevar `types/` a camada contratual mais relevante
### F5.6 — decidir destino de `plugins/` e `logs/`

## P6 — Segurança, qualidade e governança

### F6.1 — autenticação, autorização, validação e superfícies HTTP
### F6.2 — matriz de testes por domínio
### F6.3 — typing, JSDoc e contratos compartilhados
### F6.4 — performance, leaks e timers
### F6.5 — limpeza de deprecateds, dead code e taxonomias mortas
### F6.6 — documentação e índices canônicos

## P7 — Capacidades avançadas

### F7.1 — terminal UX avançado
### F7.2 — extensões RPC e orchestration avançada
### F7.3 — TSServer/context intelligence
### F7.4 — multi-session e session operations avançadas
### F7.5 — plugins e ecossistema de extensões
### F7.6 — dashboards e telemetria expandida

---

## 6. Subfases prioritárias imediatas

### Prioridade 1

- P0/F0.1 a F0.4
- P1/F1.1
- P1/F1.2
- P6/F6.1

### Prioridade 2

- P2/F2.1 a F2.3
- P3/F3.1 a F3.4
- P4/F4.1

### Prioridade 3

- P4/F4.2 a F4.5
- P5/F5.1 a F5.5
- P6/F6.2 a F6.6

### Prioridade 4

- P7 completo

---

## 7. Dependências críticas

| Dependência                                 | Motivo                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| P1 antes de P4 amplo                        | não adianta redesenhar bordas sem estabilizar o runtime do agente                   |
| P2 antes de parte de P4                     | ownership de sessão e boundary com hub dependem do SDK fino                         |
| P3 antes do fechamento de health/monitoring | eventos e observability precisam de governança antes de projections mais ambiciosas |
| P6 contínuo desde a Onda A                  | segurança e qualidade não podem ser apêndice tardio                                 |
| P7 só depois das Ondas A–D                  | capabilities avançadas dependem de base estrutural saudável                         |

---

## 8. Critérios macro de sucesso por onda

### Onda A

- baseline medido e governado;
- `agent/` com backlog residual principal endereçado;
- docs canônicas consolidadas.

### Onda B

- `sdk/` mais fino e menos stateful;
- event model e observability mais governáveis;
- testes de fronteira cobrindo os principais contratos.

### Onda C

- `server/`, `terminal/`, `channel/` e `hub` com ownership mais claro;
- menos acoplamento presentation ↔ orchestration.

### Onda D

- plataforma interna endurecida;
- dívida residual e deprecateds drasticamente reduzidos;
- documentação e qualidade operando como gates maduros.

### Onda E

- capabilities avançadas liberadas com risco muito menor.

---

## 9. Leitura final do roadmap

O ponto central deste roadmap é que o próximo ciclo não será bem-sucedido se continuar tratando cada documento antigo como mini-roadmap independente.

A rearquitetura clean exige:

- uma linha mestra única;
- backlog estruturado por programas;
- e disciplina para não misturar “arrumar a base” com “ficaria legal ter isso no terminal”.

Ambas são importantes. Só não devem disputar a mesma fila sem juiz.
