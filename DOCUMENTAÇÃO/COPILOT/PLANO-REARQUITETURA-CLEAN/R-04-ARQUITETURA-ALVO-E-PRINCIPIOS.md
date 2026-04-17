# R-04 — Arquitetura-alvo e princípios da rearquitetura clean

**Data**: 2026-04-15 **Status**: proposta canônica desta série

> **Complemento operacional obrigatório**:
> [`R-04A-ENDSTATE-E-CRITERIOS-DE-SUCESSO.md`](./R-04A-ENDSTATE-E-CRITERIOS-DE-SUCESSO.md)
> traduz este documento em end-state explícito, invariantes e critérios objetivos de convergência.

---

## 1. Objetivo desta arquitetura-alvo

A arquitetura-alvo desta série não busca “reescrever tudo”.

Ela busca quatro resultados simultâneos:

1. **ownership claro por módulo**;
2. **fronteiras mais estreitas entre domínios**;
3. **redução do custo de coordenação** em `agent/`, `sdk/`, `observability/`, `server/` e
   `terminal/`;
4. **base saudável o suficiente** para suportar as capabilities futuras já previstas no backlog.

---

## 2. Princípios estruturais

### P1 — Fachadas finas, domínios explícitos

Módulos de topo devem ser fachadas de domínio, não depósitos de detalhes internos.

### P2 — Ownership de sessão fora do SDK fino

`sdk/` deve ser essencialmente stateless. Ownership de sessão ativa, replay e registry deve viver em
camadas de orquestração adequadas.

### P3 — `agent/` coordena; não absorve tudo

`agent/` deve ser o coração operacional do runtime, mas não o lugar onde o sistema inteiro despeja
responsabilidades “porque está perto”.

### P4 — Eventos são contrato, não fumaça mágica

O ecossistema orientado a eventos deve ser tratado como contrato versionável e governável.

### P5 — Observability é infraestrutura transversal governada

`observability/` deve ser usada com parcimônia e por interfaces mais estáveis, reduzindo imports
diretos desnecessários.

### P6 — Presentation ≠ orchestration

`server/`, `terminal/` e `channel/` não podem continuar a se misturar como se fossem a mesma camada.

### P7 — Compatibilidade residual deve ter prazo de validade

Shims, barrels e aliases só são aceitáveis quando:

- explicitamente rastreados;
- com consumidores mapeados;
- com plano de remoção.

### P8 — Roadmap base e backlog de capabilities são trilhas distintas

Features novas não entram na mesma fila das correções estruturais obrigatórias sem dependências
claramente resolvidas.

### P9 — Teste, segurança e docs são gates, não apêndices

Arquitetura saudável exige governança operacional, não apenas desenho bonito.

### P10 — Documentação canônica deve ser menor, mais forte e mais navegável

A nova linha clean existe justamente para reduzir entropia documental.

---

## 3. Modelo-alvo por camadas

## L6 — Presentation & Interfaces

- `server/`
- `terminal/`
- porções externas de `channel/`

**Responsabilidade**:

- expor HTTP, Socket, SSE e UX terminal;
- traduzir protocolos externos para contratos de runtime;
- não concentrar ownership profundo de sessão/rule engine.

## L5 — Orchestration Runtime

- `agent/`
- `conversation-hub/`
- parte orquestradora de `channel/`

**Responsabilidade**:

- lifecycle do agente;
- coordenação de turnos e diálogos;
- ownership de sessão conversacional e runtime operacional;
- health e background tasks.

## L4 — Policies & Runtime Services

- `hooks/`
- `tools/`
- `event-handlers/`
- `config/`
- partes de `bridges/`

**Responsabilidade**:

- políticas de permissão/prompt/tool interception;
- execução de tools;
- builders e configuração de runtime;
- reação semântica a eventos.

## L3 — Cross-Cutting Infrastructure

- `observability/`
- `events/`
- `audit/`

**Responsabilidade**:

- event model governado;
- métricas, tracing, health projections;
- error pipeline;
- trilhas de auditoria.

## L2 — Core Shared Runtime

- `core/`
- `infra/`
- `db/`
- `types/`

**Responsabilidade**:

- contratos centrais, utilidades, storage, filas, locks, schemas, tipos compartilhados.

## L1 — External SDK / Vendor Facade

- `sdk/`

**Responsabilidade**:

- wrapper fino sobre `@github/copilot-sdk`;
- adaptação técnica previsível;
- mínimo possível de estado e policy.

---

## 4. Ownership-alvo por módulo principal

| Módulo              | Ownership alvo                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `agent/`            | runtime principal do agente, lifecycle, dialog, session runtime, health, background tasks |
| `sdk/`              | wrapper fino, builders técnicos, adaptadores do vendor SDK                                |
| `conversation-hub/` | sessão conversacional, replay, store, hub orchestration                                   |
| `presentation/`     | projections e handlers compartilhados entre `server/` e `terminal/`                       |
| `server/`           | API HTTP/Socket/SSE, roteamento e apresentação remota                                     |
| `terminal/`         | UX local, REPL, streaming, comandos, renderização                                         |
| `channel/`          | canal LLM-A ↔ LLM-B e injeção de contexto                                                 |
| `tools/`            | catálogo e runtime de tools                                                               |
| `hooks/`            | políticas de sessão, permissões, filtros e transforms                                     |
| `event-handlers/`   | efeitos de domínio disparados por eventos                                                 |
| `observability/`    | métricas, tracing, pipeline de erro, projections de health                                |
| `events/`           | catálogo, schemas e governança de eventos                                                 |
| `config/`           | builders, defaults, prompt/config runtime                                                 |
| `core/`             | contratos centrais e utilidades fundamentais                                              |
| `infra/`            | recursos compartilhados e mecanismos técnicos                                             |
| `types/`            | tipos compartilhados e contratos de superfície                                            |
| `bridges/`          | integrações externas e adapters de borda                                                  |
| `audit/`            | auditoria operacional transversal                                                         |
| `plugins/`          | extensão/plugin model, quando amadurecido                                                 |

---

## 5. Desenho-alvo do `agent/`

```text
agent/
├── always-alive.js              # fachada pública mínima
├── agent-context.js             # composição de subestados com rollout controlado
├── background-tasks.js          # tracker central de fire-and-forget
├── health-check.js              # snapshot de saúde canônico
├── error-policy.js              # classificação de erro retry/fatal/ignore
├── event-bridge-map.js          # mapa declarativo de bridge
├── event-bridge-wiring.js       # wiring lazy e desacoplado
├── dialog/                      # domínio do diálogo
├── lifecycle/                   # start/stop/reconnect
├── messaging/                   # fila e envio ao SDK
├── session/                     # setup, boot, keepalive, snapshot, recovery
├── facades/                     # facades locais, pequenas e estáveis
└── state/                       # snapshots e projeções de estado
```

### Metas do `agent/`

- `always-alive.js` descer para faixa de **300–450L**;
- shims residuais saírem da condição “temporária eterna”;
- `session/` e `lifecycle/` perderem coordenação incidental;
- `dialog/` seguir isolado como domínio próprio;
- `backgroundTasks` e `health` virarem infraestrutura nativa do runtime.

---

## 6. Desenho-alvo do `sdk/`

O `sdk/` ideal desta linha clean deve ser:

- stateless ou quase-stateless;
- centrado em adaptação técnica ao vendor SDK;
- com `session registry` e ownership de sessão fora dele;
- sem duplicação com `config/`;
- com menos importadores diretos fora do seu domínio.

### Meta operacional

Reduzir ao longo do programa:

- imports diretos de `sdk` fora de `sdk/`;
- lógica de ownership de sessão em `sdk/session/client.js`;
- artefatos legados como `sdk/config.js` e restos de contratos em locais indevidos.

---

## 7. Desenho-alvo do ecossistema de eventos e observabilidade

### Eventos

- naming governado;
- schemas conhecidos;
- ownership por domínio;
- bridges explícitos;
- menos difusão de emissão ad-hoc.

### Observability

- error pipeline unificado;
- projections de health reaproveitáveis;
- menos imports diretos fora de pontos realmente necessários;
- relação mais limpa com `server/`, `terminal/`, `agent/` e `tools/`.

---

## 8. Desenho-alvo de `server/`, `terminal/`, `channel/` e `conversation-hub`

### `server/`

- serve API e realtime;
- não depende de detalhes de UX do terminal além de contratos estáveis.

### `terminal/`

- concentra UX local e experiência de uso;
- não deve ser backend acoplado informal do server.

### `channel/`

- contrato de canal e injeção entre atores LLM;
- sem ownership difuso de runtime principal.

### `conversation-hub/`

- ownership claro de store, replay, sessão conversacional e sincronização de histórico.

---

## 9. Princípios de execução do roadmap

1. **fechar base estrutural primeiro**;
2. **reduzir compatibilidade residual com critério**;
3. **apertar segurança, teste, typing e documentação como gates**;
4. **só então expandir capabilities avançadas**.

---

## 10. Critérios macro de sucesso

> Os critérios macro abaixo continuam válidos como síntese.
> A versão operacional detalhada, usada como régua de checkpoint, está em `R-04A`.

Ao final da rearquitetura clean, espera-se:

- `agent/` e `sdk/` significativamente mais finos e menos difusos;
- boundaries claras entre `server/`, `terminal/`, `channel/` e `conversation-hub/`;
- ecossistema de eventos e observability com governança mais forte;
- backlog de deprecações e compatibilidade residual reduzido de forma objetiva;
- documentação canônica simples o suficiente para orientar execução contínua.

---

## 11. Conclusão

A arquitetura-alvo desta série não é uma fantasia de “sistema perfeito”; ela é uma arquitetura
**realista para o baseline atual**, desenhada para absorver o histórico já acumulado e transformar o
repositório em uma base mais governável.

Se o `as-is` de hoje é um sistema que cresce por muita competência local e alguma gravidade
estrutural, o target desta linha clean é um sistema que cresce por **domínio, ownership e contratos
mais claros**.
