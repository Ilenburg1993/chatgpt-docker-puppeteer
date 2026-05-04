# 00 — Pré-Auditoria Arquitetural Ampla de `src/copilot`

**Status**: fase de pré-auditoria **Última atualização**: 2026-04-27 **Escopo**: `src/copilot/`
completo **Base factual**: leitura do documento
`DOCUMENTAÇÃO/ARQUITETURA/SDK-WRAPPER-IDEAL-ARCHITECTURE.md`, inventário vivo do filesystem, READMEs
canônicos de módulos, gates arquiteturais atuais e sinais de fronteira/importação levantados no
código.

---

## 1. Propósito desta pré-auditoria

Esta pré-auditoria existe para **preparar a auditoria arquitetural ampla e profunda** de
`src/copilot/` de forma organizada, segura e cumulativa.

Ela não é um simples “sumário”. Ela deve funcionar como:

1. **mapa global do território**;
2. **catálogo inicial das dúvidas arquiteturais críticas**;
3. **plano de produção documental** da auditoria;
4. **contrato metodológico** para as próximas fases;
5. **baseline AS-IS** (situação atual) contra a qual será construída a situação ideal.

---

## 2. Princípio norteador da auditoria

O princípio mais importante para esta auditoria é:

> `src/copilot/` deve evoluir como um **runtime Copilot local com fronteiras explícitas e
> responsabilidades auditáveis**, e não como um agregado de submódulos que crescem por conveniência.

Isso implica investigar, com profundidade:

- **quem é dono de quê**;
- **quem traduz, quem orquestra, quem projeta, quem expõe, quem persiste, quem observa**;
- onde existem **camadas legítimas** e onde existem **camadas improvisadas**;
- onde uma pasta virou **owner real** de um domínio e onde virou apenas **depósito histórico**;
- onde há **duplicação funcional**;
- onde há **ambiguidade de fronteira**;
- onde há **desvio em relação ao SDK**.

---

## 3. Base factual levantada nesta pré-auditoria

### 3.1 Escala de `src/copilot/`

Snapshot levantado a partir do filesystem vivo:

- **69 diretórios** (incluindo a raiz `src/copilot/`)
- **541 arquivos**
- **24 módulos/pastas de primeiro nível**
- **3 arquivos raiz imediatos**:
  - `src/copilot/README.md`
  - `src/copilot/bootstrap.js`
  - `src/copilot/runtime-wiring.js`

### 3.2 Composition roots e entrypoints reais

Os arquivos-raiz indicam uma estrutura importante já existente:

| Arquivo             | Papel atual                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `README.md`         | mapa canônico do runtime e da direção arquitetural desejada                                                   |
| `bootstrap.js`      | entrypoint canônico do módulo Copilot; orquestra observability, DI, preflight, runtime wiring e host terminal |
| `runtime-wiring.js` | composition root do runtime Copilot já montado                                                                |

Atualização 2026-05-04: o antigo `src/copilot/agent.js` foi removido para eliminar o último
entrypoint compatível paralelo do runtime local.

Conclusão preliminar: `src/copilot/` **já possui um centro de composição explícito**, mas esse
centro convive com muitas superfícies laterais e históricos de compatibilidade que merecem
auditoria.

### 3.3 Módulos de maior massa arquitetural

Os maiores módulos por número de arquivos hoje são:

| Módulo           | Arquivos | LOC aprox. | Leitura preliminar                                   |
| ---------------- | -------: | ---------: | ---------------------------------------------------- |
| `agent/`         |       79 |     17.412 | principal owner do runtime contínuo                  |
| `terminal/`      |       59 |      9.862 | borda operacional humana/REPL                        |
| `sdk/`           |       44 |     10.212 | wrapper canônico do `@github/copilot-sdk`            |
| `server/`        |       43 |      7.117 | superfície HTTP/SSE/Socket                           |
| `tools/`         |       35 |      7.951 | tools customizadas e domínio de execução operacional |
| `observability/` |       34 |      6.276 | logging, métricas, tracking, OTel, coletores         |
| `presentation/`  |       30 |      5.261 | projeções e handlers compartilhados de borda         |
| `config/`        |       29 |      2.777 | configuração declarativa/builders/ports              |
| `hooks/`         |       27 |      5.482 | políticas e callbacks do SDK                         |

### 3.4 Módulos que exigem tratamento especial

Nem tudo sob `src/copilot/` tem o mesmo status semântico:

| Módulo     | Natureza                      | Observação                                                                               |
| ---------- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| `logs/`    | artefato/runtime              | não é módulo de domínio; não deve ser tratado como owner arquitetural de comportamento   |
| `.github/` | artefato/runtime/estado       | armazena snapshots/hooks state; precisa de análise de pertencimento e eventual relocação |
| `dialog/`  | módulo muito pequeno          | precisa ser auditado quanto a sobreposição com `agent/dialog/` e `terminal/dialog/`      |
| `plugins/` | módulo pequeno porém sensível | pode virar extensão real ou compat shim mascarado                                        |

---

## 4. Leituras canônicas já absorvidas nesta pré-auditoria

### 4.1 `src/copilot/README.md`

O README raiz declara explicitamente:

- `sdk/` como **fonte de verdade local do vanilla**;
- `event-handlers/` como **boundary de tradução** dos eventos do SDK;
- `agent/` como **owner do runtime contínuo**;
- `presentation/` como **camada de acesso compartilhado das bordas**;
- `terminal/` como **UX da LLM-B**;
- `server/` como **borda HTTP**;
- `observability/` como **coleta** e não como interpretação canônica do SDK.

Essa visão é forte e promissora, mas a auditoria precisa medir **quanto do código real já obedece a
essa tese** e onde ainda há drift.

### 4.2 `DOCUMENTAÇÃO/ARQUITETURA/SDK-WRAPPER-IDEAL-ARCHITECTURE.md`

O documento anexo reforça uma regra arquitetural central já operacional no repositório:

> Nenhuma chamada ao `@github/copilot-sdk` deve existir fora de um wrapper dedicado e completo.

Esse documento também consolida:

- `sdk/` como camada SSOT do vendor SDK;
- `agent/facades/*` e `agent/ports/*` como fronteiras permitidas de consumo do SDK;
- a separação entre caller-side e provider-side de ELICITATION;
- a direção atual da Fase 4 de observabilidade dos wrappers.

Logo, esta auditoria ampla **não parte do zero**: ela precisa respeitar e expandir o que já foi
consolidado no eixo `sdk/`.

### 4.3 `scripts/check-copilot-global-architecture.mjs`

O gate global já expressa uma camada arquitetural observável:

| Layer            | Módulos mapeados no script                      |
| ---------------- | ----------------------------------------------- |
| 0                | `boot`, `core`, `types`, `db`                   |
| 1                | `config`                                        |
| 2                | `sdk`, `events`, `event-handlers`               |
| 3                | `hooks`, `tools`, `bridges`, `plugins`, `infra` |
| 4                | `agent`, `channel`                              |
| 5                | `conversation-hub`                              |
| 6                | `presentation`                                  |
| 7                | `server`, `terminal`                            |
| cross-cutting    | `observability`, `audit`                        |
| runtime-artifact | `logs`, `.github`                               |

Essa classificação é particularmente importante porque já transforma parte da arquitetura em regra
executável. A auditoria deverá confrontar:

1. a **arquitetura desejada declarada** nos READMEs;
2. a **arquitetura executável** codificada nos gates;
3. a **arquitetura de fato** revelada pelas dependências reais entre módulos.

---

## 5. Panorama AS-IS por pasta: tarefa atual vs. tarefa ideal

### 5.1 Tabela-mestra de responsabilidade atual e ideal

| Módulo              | Tarefa atual observada                                                                                  | Situação ideal a validar/propor                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `sdk/`              | wrapper canônico do vendor SDK, lifecycle, RPC, types, telemetry vanilla                                | continuar como **única** fronteira com `@github/copilot-sdk`, reforçando SSOT e telemetria                          |
| `agent/`            | runtime contínuo, session lifecycle, dialog loop, health, runtime registry, façades                     | seguir como owner do runtime, com menos acesso cru a contexto e mais contratos semânticos                           |
| `hooks/`            | composição de hooks do SDK, permission handling, prompt/tool interception, elicitation provider helpers | virar owner inequívoco de policy/callbacks do SDK, sem absorver responsabilidades de runtime ou tradução de eventos |
| `event-handlers/`   | tradução do `SessionEvent` vanilla para sinais internos                                                 | permanecer como boundary de tradução, sem virar projection, HTTP ou state store                                     |
| `events/`           | catálogo, schemas, middleware, emitter events, nomes de eventos internos                                | consolidar-se como catálogo/event grammar do sistema, evitando sobreposição com `event-handlers/`                   |
| `observability/`    | coleta, métricas, error tracking, bootstrap observável, event bus runtime                               | ser estritamente consumer/correlator, sem reinterpretar o SDK em paralelo                                           |
| `presentation/`     | projections/shared handlers para server e terminal, targeting de runtime, SDK session facade de borda   | ser a camada única de projeções compartilhadas das bordas                                                           |
| `server/`           | HTTP/SSE/Socket adapters, rotas `/sdk` e `/copilot-api`, middleware                                     | continuar como borda externa, sem reabrir topologia interna do runtime                                              |
| `terminal/`         | frontend operacional local, REPL, comandos, render, SSE local, projections de consumo                   | continuar como UX humana da LLM-B, consumindo `presentation/` e `sdk/` em vez de inventar semântica paralela        |
| `tools/`            | tools customizadas registradas no SDK e conectadas ao runtime                                           | ficar claramente separada de `sdk/tools/` (registry/state) e de lógica de policy que pertence a `hooks/`            |
| `bridges/`          | adapters para NERV, MCP, Git/GitHub e integração externa                                                | manter-se como adapters, evitando acoplamento direto com `agent/` fora de portas/capabilities explícitas            |
| `conversation-hub/` | store e orquestração multi-sessão persistida                                                            | clarificar a fronteira com `agent/` e `presentation/`, especialmente ownership de sessão, memory e replay           |
| `config/`           | env, builders, MCP/custom agents, session config, system prompt                                         | tornar-se claramente declarativo/port-driven, sem puxar lógica operacional do runtime                               |
| `core/`             | primitives, DI, error handling, retry, shared-state, schemas                                            | endurecer-se como base estável de baixo nível                                                                       |
| `infra/`            | SSE infra, storage, queue, registry e adapters técnicos                                                 | separar com mais nitidez infra técnica de domínio e de projections de borda                                         |
| `audit/`            | pipeline, writer, ring buffer, audit logs e permissões                                                  | definir melhor a fronteira com `observability/` e `logs/`                                                           |
| `channel/`          | client/inject/SSE client para transporte e integração externa                                           | esclarecer se é transporte real de domínio ou shim de integração/borda                                              |
| `boot/`             | contrato/config/plano de boot, workspace/skills                                                         | consolidar-se como módulo exclusivo do processo de inicialização                                                    |
| `db/`               | SQLite SSOT e migrations locais ao copilot                                                              | permanecer mínimo e subordinado ao domínio que o consome                                                            |
| `types/`            | contratos/tipos do subsistema copilot                                                                   | decidir se é apenas barrel/typedef surface ou se deve absorver contratos hoje espalhados                            |
| `dialog/`           | protocolo/índice mínimos                                                                                | verificar se é domínio autônomo ou resíduo de desmembramento incompleto                                             |
| `plugins/`          | registry/tokens de plugins                                                                              | definir se será extensão real de produto ou superfície administrativa secundária                                    |
| `.github/`          | snapshots/estado de hooks dentro de `src/copilot`                                                       | reavaliar pertencimento; forte candidato a sair da árvore de código-dominio                                         |
| `logs/`             | artefatos de execução dentro da árvore `src/copilot`                                                    | reavaliar localização; não deveria competir semanticamente com módulos de código                                    |

### 5.2 Fronteiras mais sensíveis já identificadas

As seguintes fronteiras precisam de investigação obrigatória e profunda:

1. **`sdk/` vs `agent/`**
   - onde termina a capacidade vanilla do SDK;
   - onde começa a ergonomia/governança/runtime contínuo do agent;
   - onde o `agent` ainda duplica semântica que deveria nascer em `sdk/`.

2. **`hooks/` vs `event-handlers/` vs `events/`**
   - `hooks/` é policy/callback do SDK;
   - `event-handlers/` é tradução do SDK;
   - `events/` é gramática/catálogo do sistema;
   - a auditoria precisa provar se essas três linhas estão realmente claras hoje.

3. **`agent/` vs `presentation/`**
   - o runtime é do `agent`;
   - as bordas compartilhadas são de `presentation`;
   - investigar se ainda há lógica de borda presa no `agent` ou lógica de runtime indevidamente
     subida.

4. **`presentation/` vs `server/` vs `terminal/`**
   - verificar o quanto `presentation/` já virou owner real das projeções compartilhadas e o quanto
     `server/` e `terminal/` ainda montam sua própria semântica paralela.

5. **`observability/` vs `audit/` vs `logs/`**
   - logging, métricas, audit trail, snapshots, timelines e arquivos persistidos ainda têm zonas de
     potencial sobreposição.

6. **`conversation-hub/` vs `agent/session/*`**
   - ownership de sessão, turns, state, replay, memory e sincronização precisa ser explicitado com
     precisão.

7. **`config/` vs `boot/` vs `sdk-config-port`**
   - distinção entre configuração declarativa, contrato de boot e ports para capacidades do SDK.

8. **`tools/` vs `sdk/tools/*` vs `hooks/`**
   - distinguir implementação de tools, registry/state da superfície SDK e policy de interceptação.

9. **`bridges/` vs `infra/` vs `channel/`**
   - separar adapter externo de infraestrutura técnica e de transporte.

10. **artefatos dentro de `src/copilot/`**
    - `.github/` e `logs/` dentro da árvore merecem análise de adequação arquitetural e de
      governança.

---

## 6. Hipóteses de confusão arquitetural que a auditoria deverá provar ou refutar

### 6.1 Hipóteses de duplicação/overlap

1. Existem **múltiplas camadas traduzindo ou reformatando o mesmo sinal** (`sdk` → `event-handlers`
   → `agent` → `presentation` → `terminal/server`) sem contrato único suficientemente explícito.
2. `hooks/` pode estar acumulando tanto **policy do SDK** quanto partes de **integração de
   runtime**.
3. `presentation/` pode estar correta em tese, mas ainda coexistindo com atalhos diretos em
   `server/` e `terminal/`.
4. `observability/` e `audit/` podem ter áreas de fronteira pouco nítidas entre **telemetria**,
   **log operacional** e **trilha de auditoria**.
5. `conversation-hub/` e `agent/` podem compartilhar responsabilidades de sessão que deveriam estar
   mais rigidamente particionadas.

### 6.2 Hipóteses de falta de clareza funcional

1. `dialog/` de topo talvez não tenha um papel suficientemente claro frente a `agent/dialog/` e
   `terminal/dialog/`.
2. `plugins/` pode estar arquiteturalmente subdefinido.
3. `channel/` pode ser ao mesmo tempo transporte, inject layer e bridge, o que pede clarificação.
4. `infra/` pode estar misturando infraestrutura transversal legítima com adapters que pertencem a
   outros domínios.

### 6.3 Hipóteses de drift em relação ao SDK

1. Ainda pode haver funcionalidades centrais do SDK não plenamente promovidas em `src/copilot`.
2. Algumas capacidades já promovidas podem ter chegado a `agent/`, `terminal/` ou `server/` sem
   documentação suficientemente explícita da base vanilla.
3. A função ideal de `hooks/` precisa ser revisitada à luz do SDK atual (`0.3.x`), especialmente em:
   - permission handling;
   - elicitation;
   - session hooks;
   - user input;
   - possíveis gaps ainda não consumidos pelo runtime local.

---

## 7. O que será investigado pela auditoria ampla

### 7.1 Trilhas obrigatórias

#### Trilha A — Taxonomia estrutural completa

- todas as pastas de primeiro nível;
- todas as subpastas;
- todos os arquivos;
- arquivos-raiz de `src/copilot/`;
- artefatos internos (`logs`, `.github`) que convivem com código.

#### Trilha B — Responsibility mapping (AS-IS)

Para **cada módulo**, a auditoria vai responder:

1. qual é sua função atual real;
2. qual é sua função declarada/documentada;
3. quais arquivos exercem essa função de fato;
4. quais responsabilidades parecem sobrar ou faltar;
5. onde há duplicação com outros módulos.

#### Trilha C — Boundary mapping

Para as principais fronteiras, a auditoria vai identificar:

- entradas autorizadas;
- saídas autorizadas;
- imports permitidos/indevidos;
- bypasses e atalhos;
- composition roots legítimos;
- dependências circulares, frágeis ou ideologicamente incorretas.

#### Trilha D — Comunicação cross-module

Será analisado como cada módulo conversa com os demais, incluindo:

- chamadas diretas;
- façades;
- ports;
- event bus;
- HTTP adapters;
- SSE/socket;
- state stores compartilhados;
- DI tokens;
- composition roots.

#### Trilha E — Situação ideal (TO-BE)

Para cada módulo, a auditoria proporá:

- missão ideal;
- fronteira ideal;
- imports ideais;
- owners ideais de contrato;
- seams ideais de integração;
- quais responsabilidades devem sair, entrar ou ser unificadas.

#### Trilha F — Roadmap de transformação

Será produzido um roadmap em **muitas faixas, fases e subfases**, incluindo:

- hardening de fronteiras;
- remoção de duplicações;
- extração de SSOTs;
- consolidação de façades;
- redesenho de composição roots;
- normalização de `hooks/`, `events/`, `observability/` e `presentation/`;
- expansão de aderência ao SDK.

---

## 8. Catálogo de documentos que deverão ser gerados

Para manter os arquivos em tamanho seguro, a auditoria ampla será quebrada em vários MDs. O catálogo
inicial proposto é o seguinte.

### 8.1 Núcleo da auditoria

| Ordem | Documento planejado                             | Objetivo                                     |
| ----- | ----------------------------------------------- | -------------------------------------------- |
| 00    | `00-PRE-AUDITORIA-PLANO-MESTRE.md`              | plano, escopo, método, hipóteses e artefatos |
| 01    | `01-INVENTARIO-ESTRUTURAL-MODULOS-E-ESCALA.md`  | inventário de módulos, pastas e escala       |
| 02    | `02-INVENTARIO-COMPLETO-DE-ARQUIVOS-PARTE-A.md` | inventário de arquivos — parte A             |
| 03    | `03-INVENTARIO-COMPLETO-DE-ARQUIVOS-PARTE-B.md` | inventário de arquivos — parte B             |
| 04    | `04-GRAFOS-E-FRONTEIRAS.md`                     | grafos estruturais e de comunicação          |

### 8.2 Análise arquitetural por domínio

| Ordem | Documento planejado                       | Foco                                                     |
| ----- | ----------------------------------------- | -------------------------------------------------------- |
| 05    | `05-TAXONOMIA-ARQUITETURAL-POR-MODULO.md` | mapa de missão atual vs ideal por módulo                 |
| 06    | `06-COMPOSITION-ROOTS-E-BOOT.md`          | `agent.js`, `bootstrap.js`, `runtime-wiring.js`, `boot/` |
| 07    | `07-SDK-E-FRONTEIRA-VANILLA.md`           | `sdk/` e aderência ao SDK                                |
| 08    | `08-AGENT-RUNTIME-E-FRONTEIRAS.md`        | `agent/` em profundidade                                 |
| 09    | `09-HOOKS-E-POLICIES.md`                  | `hooks/` atual vs ideal                                  |
| 10    | `10-EVENTS-E-TRADUCAO-DE-SINAIS.md`       | `events/` + `event-handlers/`                            |
| 11    | `11-PRESENTATION-SHARED-EDGE-LAYER.md`    | `presentation/`                                          |
| 12    | `12-SERVER-HTTP-SSE-SOCKET-BOUNDARY.md`   | `server/`                                                |
| 13    | `13-TERMINAL-UX-E-CONSUMO-DO-RUNTIME.md`  | `terminal/`                                              |
| 14    | `14-CONVERSATION-HUB-E-PERSISTENCIA.md`   | `conversation-hub/` + `db/`                              |
| 15    | `15-TOOLS-E-EXECUCAO-OPERACIONAL.md`      | `tools/`                                                 |
| 16    | `16-BRIDGES-INFRA-CHANNEL-PLUGINS.md`     | `bridges/`, `infra/`, `channel/`, `plugins/`             |
| 17    | `17-CONFIG-TYPES-DIALOG-E-ARTEFATOS.md`   | `config/`, `types/`, `dialog/`, `.github/`, `logs/`      |
| 18    | `18-OBSERVABILITY-AUDIT-E-LOGS.md`        | `observability/`, `audit/`, `logs/`                      |

### 8.3 Consolidação cross-module

| Ordem | Documento planejado                              | Foco                                        |
| ----- | ------------------------------------------------ | ------------------------------------------- |
| 19    | `19-MATRIZ-DE-COMUNICACAO-CROSS-MODULE.md`       | quem chama quem, por qual seam              |
| 20    | `20-MATRIZ-DE-DUPLICACOES-E-SOBREPOSICOES.md`    | duplicações, overlaps e owners concorrentes |
| 21    | `21-MATRIZ-DE-FRONTEIRAS-E-DECISOES.md`          | onde começa/termina cada módulo             |
| 22    | `22-SITUACAO-IDEAL-ALVO.md`                      | arquitetura TO-BE consolidada               |
| 23    | `23-ROADMAP-MACRO-FAIXAS-E-FASES.md`             | roadmap de transformação                    |
| 24    | `24-ROADMAP-SUBFASES-E-ORDEM-DE-ATAQUE.md`       | backlog executável por ondas                |
| 25    | `25-SUMARIO-EXECUTIVO-E-DECISOES-ESTRUTURAIS.md` | síntese final da auditoria ampla            |

---

## 9. Roadmap da própria auditoria (faixas, fases e subfases)

### Faixa 0 — Pré-auditoria e baseline

- F0.1 inventário estrutural completo
- F0.2 leitura das teses arquiteturais já existentes
- F0.3 captura dos grafos AS-IS
- F0.4 catálogo de artefatos da auditoria

### Faixa 1 — Taxonomia e ownership por módulo

- F1.1 mapear função atual de cada módulo
- F1.2 mapear função declarada/documentada
- F1.3 detectar owners concorrentes
- F1.4 propor owner ideal por domínio

### Faixa 2 — Composition roots, boot e lifecycle macro

- F2.1 `agent.js` compat vs boot canônico
- F2.2 `bootstrap.js` como root de processo
- F2.3 `runtime-wiring.js` como composition root
- F2.4 `boot/` como contrato operacional

### Faixa 3 — Domínio SDK e suas fronteiras

- F3.1 `sdk/` vs resto do runtime
- F3.2 capabilities vanilla encontradas
- F3.3 capabilities vanilla ainda ausentes
- F3.4 aderência aos guardrails do SDK

### Faixa 4 — Runtime contínuo do agente

- F4.1 `agent/` como owner do runtime
- F4.2 session/dialog/lifecycle/state
- F4.3 façades e ports
- F4.4 relação com conversation-hub, hooks, tools e observability

### Faixa 5 — Sistema de hooks, eventos e tradução de sinais

- F5.1 função atual de `hooks/`
- F5.2 função ideal de `hooks/`
- F5.3 `event-handlers/` como boundary de tradução
- F5.4 `events/` como gramática/catálogo
- F5.5 gaps, drift e overlaps

### Faixa 6 — Bordas e projeções

- F6.1 `presentation/` como shared edge layer
- F6.2 `server/` como borda externa
- F6.3 `terminal/` como borda humana
- F6.4 comparação entre bordas e duplicações de payload/projection

### Faixa 7 — Persistência, memória, store e artefatos

- F7.1 `conversation-hub/`
- F7.2 `db/`
- F7.3 `logs/`
- F7.4 `.github/` e snapshots internos

### Faixa 8 — Adapters, tools e infraestrutura

- F8.1 `tools/`
- F8.2 `bridges/`
- F8.3 `infra/`
- F8.4 `channel/`
- F8.5 `plugins/`

### Faixa 9 — Observabilidade e trilha de auditoria

- F9.1 `observability/`
- F9.2 `audit/`
- F9.3 relação entre métricas, logs, tracking e audit trail

### Faixa 10 — Situação ideal e roadmap de transformação

- F10.1 arquitetura TO-BE consolidada
- F10.2 unificações propostas
- F10.3 roadmap por faixas/fases/subfases
- F10.4 ordem de execução e critérios de pronto

---

## 10. Perguntas-mãe que esta auditoria precisa responder

1. Onde **começa e termina** `sdk/` em relação a `agent/`?
2. Qual é a função **ideal** de `hooks/`? Ela está hoje limitada a policies do SDK ou absorvendo
   mais do que deveria?
3. Onde **termina o runtime** e onde **começa a borda compartilhada** (`presentation/`)?
4. Até que ponto `terminal/` e `server/` já são consumidores adequados de `presentation/`?
5. `event-handlers/`, `events/` e `observability/` estão em papéis distintos ou ainda parcialmente
   sobrepostos?
6. Quais funcionalidades centrais do SDK já foram absorvidas corretamente e quais ainda não foram
   encontradas/promovidas em `src/copilot`?
7. Quais pastas existem hoje como **domínios legítimos** e quais existem como **agregados
   históricos**?
8. Quais módulos precisam ser endurecidos como SSOT e quais precisam perder protagonismo?

---

## 11. Conclusão desta pré-auditoria

O estado atual de `src/copilot/` não é caótico no sentido bruto — ele já possui uma tese
arquitetural forte, vários READMEs locais, gates de boundary e uma direção clara em torno do SDK.

Mas ele ainda é **densamente complexo**, com muitos módulos, muitos seams, muita massa histórica e
várias zonas onde a fronteira entre “owner real” e “consumer de conveniência” ainda pode estar
imprecisa.

Portanto, a auditoria ampla precisa ser executada como **trabalho de sistema**, não como revisão de
pastas isoladas.

Os anexos 01–04 compõem o baseline inicial desta trilha.
