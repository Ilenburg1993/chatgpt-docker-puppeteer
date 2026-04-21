# 13-TERMINAL-UX-HARDENING — Diagnóstico e Hardening da UX do Terminal LLM-B

**Auditoria Profunda de `src/copilot`** · Abril 2026 **Escopo**: `src/copilot/terminal/*`,
superfícies REPL/SSE/frontend/runtime ligadas à UX do operador **Documentado em**: 2026-04-18

---

## 1. Resumo executivo

O terminal LLM-B já possuía bastante capacidade operacional, mas a UX ainda estava atrasada em
relação ao runtime.

O problema central não era falta de funcionalidade. Era **falta de uma camada semântica única de
atividade**.

Antes desta onda:

- o sistema já emitia eventos ricos (`assistant.intent`, `tool.execution_*`, `task.*`, `dialog.*`,
  `session.usage`);
- o operador já tinha dezenas de comandos;
- mas ainda era difícil responder rapidamente: **“o que a LLM-B está fazendo agora?”**

Nesta rodada, o terminal ganhou:

- camada canônica de atividade em tempo real;
- comando dedicado `/activity [n]`;
- integração da atividade em `/status`, `/diagnose` e `/metrics`;
- broadcast SSE `terminal.activity`;
- correção do toggle `streaming` nos caminhos incrementais;
- toggles semânticos adicionais para `tools` e `intent`.
- milestones de boot na própria camada de atividade (`Inicializando terminal`, `Carregando aliases`,
  `Configurando DI`, `Inicializando conversation hub`, `Subindo servidor copilot`).
- prompt dinâmico com `modelo/reasoning` e marcador `MODE:<SDK>` quando a sessão vanilla sai de
  `interactive`.
- uso de `assistant.streaming_delta` como sinal operacional de progresso de resposta.
- leitura de `progressMessage` real do SDK em `tool.execution_progress`, com fallback para `%`
  quando existir.
- consumo explícito de `tool.execution_partial_result` como streaming incremental de saída de tool.
- consumo direto dos sinais vanilla do SDK (`session.mode_changed`, `session.plan_changed`,
  `exit_plan_mode.completed`) no lugar de um plan mode local paralelo.
- exibição de `session.info`, `session.warning`, `session.model_change` e `session.context_changed`
  na UX do operador.
- exibição de `session.task_complete`, `session.truncation`, `session.snapshot_rewind`,
  `session.shutdown`, `session.handoff` e `session.workspace_file_changed` na UX do operador.

---

## 2. Diagnóstico da situação anterior

### 2.1 A UX era mais pobre do que o runtime

O runtime já sabia muito, mas mostrava pouco de forma unificada.

Havia visibilidade parcial e espalhada de:

- boot do dialog loop;
- reasoning;
- tool lifecycle;
- tasks internas;
- compaction;
- ask_user;
- usage/context window.

Mas essas informações estavam divididas entre:

- linhas efêmeras no stdout;
- snapshots de `/status`;
- métricas em `/metrics`;
- diagnósticos em `/diagnose`;
- eventos SSE independentes.

### 2.2 Sintoma principal

O operador precisava inferir manualmente:

- se a LLM-B estava pensando;
- se estava executando tool;
- se estava só transmitindo delta;
- se estava presa num task runner;
- se havia progresso real ou só espera.

### 2.3 Bug real de UX

O toggle de `streaming` não governava todos os caminhos de renderização incremental.

Na prática:

- o usuário desligava streaming;
- parte do output incremental ainda aparecia por caminhos paralelos.

Isso foi tratado como bug funcional da UX, não apenas cosmética.

---

## 3. Melhorias implementadas

### 3.1 `activity-state.js`

Foi criada uma SSOT específica para atividade do terminal:

- fase (`idle`, `boot`, `turn`, `thinking`, `streaming`, `tool`, `task`, `compaction`, `question`,
  `subagent`, `system`, `error`);
- label;
- detalhe;
- severidade;
- progresso opcional;
- tool ativa opcional;
- timeline curta em memória.

### 3.2 `/activity`

O terminal agora possui um comando dedicado para atividade atual + timeline recente.

Isso reduz a dependência de interpretação manual do stdout.

### 3.3 `/status`, `/diagnose` e `/metrics`

Esses comandos agora incorporam a atividade atual como parte da leitura operacional do sistema.

Além disso, `/status` passou a mostrar:

- metadata local do modelo (`cost`, `speed`, `contextWindow`);
- timeline curta da atividade recente;
- distinção mais visível entre “atividade atual” e “dica operacional” baseada em shadow expirada.

### 3.4 Toggle de streaming corrigido

O estado `streaming=false` agora afeta melhor os caminhos incrementais relevantes, inclusive o bloco
de task streaming do terminal.

### 3.5 Toggles adicionais

`/display` passou a suportar também:

- `tools`
- `intent`

Isso permite separar melhor:

- thinking/reasoning;
- intents do assistente;
- execução de tools;
- resposta incremental.

### 3.6 SSE de atividade

O terminal agora publica:

- `terminal.activity`

para consumidores externos, unificando o estado de atividade sem exigir parsing de múltiplos eventos
diferentes.

### 3.7 Coalescência anti-spam

Para evitar que cada delta ou progress encha a timeline, a camada de atividade agora:

- coalesce updates semanticamente idênticos;
- permite `recordHistory=false` nos fluxos mais ruidosos.

### 3.8 `ask_user` melhor refletido para o operador

Além da activity geral, o terminal passou a mostrar com mais precisão o estado da shadow de
`ask_user`:

- `fresh`
- `active`
- `expiring_soon`
- `expired`

com idade e tempo restante visíveis em comandos de diagnóstico/status.

### 3.9 Default do runtime e compatibilidade com o SDK

O stack terminal/agent passou a operar com `gpt-5-mini` + `reasoning=high` como defaults canônicos.

Essa troca foi feita preservando a superfície do SDK:

- `SessionConfig.model`
- `SessionConfig.reasoningEffort`
- `listModels()` para descoberta dinâmica
- troca em runtime via `/model` e `/reasoning`

Também foi mantida a conformidade de `ask_user`:

- `allowFreeform` omitido continua significando `true`, como no contrato real do SDK.

### 3.10 Plan mode e streaming — alinhamento fino com o SDK

Havia um drift conceitual importante: o comando `/plan` do terminal havia nascido como **prefixo
local de prompt**, enquanto o SDK já expunha sinais próprios de modo e arquivo de plano.

Nesta rodada, o terminal passou a deixar isso explícito:

- `/plan` agora é apenas fachada para `mode.get/set` e `plan.read/update/delete` do SDK;
- `/status`, `/diagnose`, `/metrics` e `/usage now` exibem o modo real observado do SDK;
- o prompt dinâmico passou a mostrar `MODE:<...>` quando o SDK não está em `interactive`;
- `tool.execution_partial_result` passou a ser tratado como streaming de tool de primeira classe, em
  vez de cair entre `progress` e `complete`.

### 3.11 Mais sinais vanilla do SDK na última milha

Além de modo/plano/streaming, o terminal passou a propagar para a UX e para SSE sinais de sessão que
já existiam no SDK, mas ainda não chegavam ao operador de forma clara:

- `session.task_complete`
- `session.truncation`
- `session.snapshot_rewind`
- `session.shutdown`
- `session.handoff`
- `session.workspace_file_changed`

Isso reduz a assimetria entre o que o SDK realmente emite e o que o operador humano consegue
perceber no REPL.

---

## 4. Estado atual

### Mitigado

- falta de “atividade atual” consolidada;
- parte da inconsistência do toggle `streaming`;
- baixa visibilidade de tool/intention/progresso;
- ausência de feed canônico de atividade para dashboards.

### Ainda aberto

- heurísticas temporais mais ricas (`recém-restaurada`, `expirando`, `reapada`);
- persistência opcional de janelas curtas de atividade para post-mortem;
- narrativa ainda mais guiada do turno do ponto de vista do operador.
- agrupamento/curadoria adicional de `session.info` e `session.warning` para reduzir ruído em
  sessões longas.

---

## 5. Conclusão

O terminal deixou de ser apenas um REPL cheio de comandos e começou a se comportar como um **console
operacional do runtime contínuo da LLM-B**.

Essa mudança é arquitetural, não apenas estética.
