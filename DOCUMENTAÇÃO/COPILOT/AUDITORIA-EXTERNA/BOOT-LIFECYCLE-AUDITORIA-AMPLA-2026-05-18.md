# Auditoria Ampla — Boot e Lifecycle do Terminal LLM-B

Data: `2026-05-18`

Escopo principal:

- `src/copilot/boot/**`
- `src/copilot/terminal/bootstrap.js`
- `src/copilot/runtime-wiring.js`
- `src/copilot/agent/lifecycle/**`
- `src/copilot/agent/session/**`
- `src/copilot/dialog/**`
- `src/copilot/presentation/runtime/**`
- `src/copilot/server/**`

---

## 1. Objetivo desta auditoria

Esta auditoria verifica se o processo de boot e lifecycle da LLM-B está:

1. semanticamente coerente;
2. carregando as capacidades certas nos owners corretos;
3. expondo por default a maior superfície funcional segura possível;
4. deixando explícitas as guardas que ainda existem por razões de robustez.

O objetivo não é apenas listar bugs; é separar claramente **config**, **client**, **session**,
**dialog**, **runtime**, **agent**, **terminal** e **server**, e então propor a situação ideal e o
roadmap de execução.

---

## 2. Taxonomia canônica do sistema

### 2.1 `config`

`config/` declara defaults e knobs. Ele não deveria decidir topologia de processo nem wiring
operacional.

### 2.2 `boot`

`boot/` transforma defaults e contexto do workspace em um **perfil efetivo de processo**:

- host/porta/token;
- entrypoint canônico;
- plano de fases;
- preflight do SDK;
- baseline de sessão (`sessionDefaults`).

### 2.3 `client`

`client` é o `CopilotClient`: transporte, conexão com CLI/server, lifecycle de sessões, RPC
server-scoped.

### 2.4 `session`

`session` é a conversa SDK viva: tools, hooks, MCP, custom agents, skills, system message,
permissions e streaming.

### 2.5 `dialog`

`dialog` governa o loop de input: start/stop/resume/recovery, canal READY/REPLY, `ask_user`, bounce
controlado e watchdog.

### 2.6 `runtime`

`runtime` é a composição operacional contínua em torno da sessão: ownership, fila, bridges,
observers, keepalive, handoff, quota, health e surfaces de controle.

### 2.7 `agent`

`agent` é o governador da sessão/runtime. Ele não é o `client`, não é a `session`, e não é a borda
terminal.

### 2.8 `terminal`

`terminal` é host de UX local e REPL. Ele não deve decidir configuração profunda do SDK fora dos
gateways próprios.

### 2.9 `server`

`server` é host HTTP/Socket.IO. Ele deve refletir o runtime e expor superfícies, não decidir boot de
SDK por conta própria.

---

## 3. Estado atual — leitura executiva

### 3.1 O que está forte

- `terminal/bootstrap.js` está corretamente consolidado como entrypoint canônico.
- `boot/runtime-bootstrap.js` já possui plano de fases, preflight, validation gate e rollbacks.
- `runtime-wiring.js` já funciona como composition root explícito do runtime vivo.
- `performBootWiring()` já modela o pós-init do agent em pipeline observável.
- `presentation/runtime/lifecycle.js` já projeta boot/shutdown para superfícies de status.

### 3.2 O que estava desalinhado

Os principais desalinhamentos encontrados foram estes:

1. **defaults conservadores demais** em flags que, na prática, reduziam superfície funcional por
   default;
2. **hardcode local** de `includeSubAgentStreamingEvents: false` no inicializador da sessão;
3. **ambiguidade semântica** entre `sdk.enabled` como “SDK ativo” versus “rotas HTTP /sdk
   habilitadas”;
4. **pouca visibilidade operacional** sobre quais capacidades realmente estão ligadas no boot
   efetivo.

### 3.3 O que continua guardado de forma deliberada

O principal guardrail mantido conscientemente é:

- `includeSubAgentStreamingEvents` continua **guardado por default**;

isso não é descuido: é uma proteção explícita até que a narrativa terminal para deltas de subagente
esteja totalmente rica e livre de ruído operacional.

---

## 4. Bugs, gaps e oportunidades identificados

## BUG-BL-001 — defaults subcarregavam capacidades

### Situação atual anterior

- `COPILOT_SDK_ENABLED=false`
- `COPILOT_ENABLE_CONFIG_DISCOVERY=false`
- `COPILOT_TERMINAL_ENABLED=false`

Mesmo no perfil canônico terminal-first, isso comunicava — e em um caso efetivamente produzia — um
runtime menos capaz por default.

### Situação ideal

- `/sdk/*` habilitado por default;
- config discovery ligado por default;
- terminal marcado como perfil canônico ligado por default.

### Status

**Corrigido nesta rodada.**

---

## BUG-BL-002 — falta de knob explícito para streaming de subagentes

### Situação atual anterior

`initOrResumeSession()` embutia `includeSubAgentStreamingEvents: false` localmente.

### Problema

O comportamento existia, mas sem um knob nomeado de configuração/base declarativa de boot.

### Situação ideal

Ter uma flag explícita, observável e documentável.

### Status

**Corrigido nesta rodada** com `COPILOT_INCLUDE_SUBAGENT_STREAMING_EVENTS` e projeção em
`boot/sessionDefaults`.

---

## GAP-BL-001 — baixa observabilidade das capacidades efetivas do boot

### Situação atual anterior

O runtime já expunha boot/shutdown, mas não sintetizava claramente:

- se `/sdk/*` está habilitado;
- se discovery está ligado por default;
- se streaming de subagentes está guardado;
- se SessionFs está ativo;
- se a `boot-surface-validation` realmente passou.

### Situação ideal

Resumo curto, verificável e estável no projection layer.

### Status

**Corrigido nesta rodada** em `presentation/runtime/lifecycle.js`.

---

## GAP-BL-002 — semântica de owners ainda precisava ficar explícita em documentação

### Situação atual

O código já apontava na direção certa, mas a taxonomia ainda podia gerar confusão entre:

- `client` e `session`;
- `agent` e `runtime`;
- `boot` e `config`;
- `server` e `terminal`.

### Situação ideal

Documentação explícita com owners e fronteiras.

### Status

**Endurecido nesta rodada** nesta auditoria e no `boot/README.md`.

---

## 5. Situação ideal final

Ao final da trilha de boot/lifecycle, o estado ideal é:

1. boot config declarando claramente defaults de processo e de sessão;
2. runtime status expondo o que está realmente carregado e o que está guardado;
3. session bootstrap sem hardcodes opacos de capability;
4. superfícies `/sdk`, discovery, SessionFs e skills ligadas por default no perfil canônico;
5. guardrails residuais nomeados explicitamente, não escondidos em objetos literais locais.

---

## 6. Roadmap amplo — faixas, fases e subfases

## Faixa BL-1 — Defaults e baseline efetiva

### Fase BL-1.1 — Defaults pró-capacidade

- habilitar `/sdk/*` por default;
- habilitar `enableConfigDiscovery` por default;
- alinhar `terminal.enabled` ao perfil canônico.

**Status:** concluída nesta rodada.

### Fase BL-1.2 — Guardas nomeadas

- transformar guardas implícitas em knobs observáveis;
- remover hardcodes silenciosos do boot de sessão.

**Status:** parcialmente concluída nesta rodada com `COPILOT_INCLUDE_SUBAGENT_STREAMING_EVENTS`.

## Faixa BL-2 — Observabilidade do lifecycle

### Fase BL-2.1 — Projection de capacidades

- expor resumo estável de capacidades efetivas no projection layer;
- distinguir “desabilitado”, “guardado” e “validado”.

**Status:** concluída nesta rodada.

### Fase BL-2.2 — Health/UX operacional

- propagar essa leitura para status/health de forma mais rica quando necessário;
- adicionar scorecards/avisos de drift entre boot config e runtime efetivo.

**Status:** pendente.

## Faixa BL-3 — Consolidação de owner de sessão

### Fase BL-3.1 — Baseline de sessão unificada

- reduzir split semântico entre `session-setup.js` e `initializer.js`;
- tornar mais explícito o owner dos defaults de `SessionConfig` no fluxo canônico.

**Status:** pendente.

### Fase BL-3.2 — Projeção de knobs avançados

- avaliar exposição explícita de `defaultAgent`, `customAgents`, MCP e discovery na baseline
  resumida;
- distinguir contrato disponível de contrato efetivamente aplicado.

**Status:** pendente.

## Faixa BL-4 — Streaming de subagentes

### Fase BL-4.1 — Telemetria e narrativa

- enriquecer deltas e narrativa terminal por `agentId`;
- validar ruído/legibilidade da UX.

### Fase BL-4.2 — Reavaliação do default

- só então decidir se `includeSubAgentStreamingEvents` pode virar `true` por default.

**Status:** pendente; guardrail mantido conscientemente.

---

## 7. Implementação iniciada nesta rodada

Esta rodada já executou a Faixa BL-1 e parte da BL-2:

- defaults pró-capacidade ligados por default;
- knob explícito de streaming de subagentes;
- summary de lifecycle/capacidades no projection layer;
- endurecimento documental das fronteiras de owner.

---

## 8. Veredito final

O boot/lifecycle atual já era estruturalmente bom, mas ainda carregava uma herança de defaults
conservadores e algumas ambiguidades semânticas que faziam a LLM-B parecer menos capaz do que
realmente poderia ser.

Depois desta rodada, a situação ficou significativamente melhor:

- **mais capacidade por default**;
- **mais clareza de owners**;
- **mais visibilidade do que está ativo versus guardado**.

O principal item deliberadamente não destravado por default continua sendo o streaming de
subagentes, e isso agora está documentado como decisão arquitetônica explícita, não como efeito
colateral escondido.
