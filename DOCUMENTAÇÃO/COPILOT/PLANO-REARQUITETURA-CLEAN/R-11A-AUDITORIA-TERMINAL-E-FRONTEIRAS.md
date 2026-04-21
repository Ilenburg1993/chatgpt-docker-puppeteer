# R-11A — Auditoria do `terminal/` e das suas fronteiras

**Programa**: P4 **Escopo**: `src/copilot/terminal/` e suas relações com `server/`, `agent/`,
`channel/`, `conversation-hub/`, `observability/` e `sdk/` **Status**: ativo **Data-base**:
2026-04-15

---

## 1. Propósito

Este documento aprofunda a parte do P4 que diz respeito ao `terminal/`.

Ele existe porque o módulo cresceu para além de um simples REPL e hoje cumpre, ao mesmo tempo,
papéis de:

- UX local;
- adaptador HTTP;
- projeção de health/metrics/diagnose;
- ponte com `agent/`, `channel/` e `conversation-hub/`;
- e, em alguns pontos, pseudo-camada de aplicação reaproveitada pelo `server/`.

Em resumo: o terminal ficou poderoso, mas também ficou estruturalmente caro.

---

## 2. Snapshot factual do módulo

### 2.1 Inventário atual

Estado auditado de `src/copilot/terminal/`:

- **47 arquivos `.js`**;
- **23** arquivos em `commands/`;
- **6** arquivos em `handlers/`;
- **6** arquivos em `dialog/`;
- baseline histórico da linha clean: **~7,1k linhas**.

### 2.2 Acoplamentos medidos no recorte

No estado atual do módulo:

- **16** imports de `#copilot/agent`;
- **12** imports de `#copilot/conversation-hub`;
- **5** imports de `#copilot/channel`;
- **12** imports de `#copilot/observability`;
- **2** imports de `#copilot/sdk`;
- **4** imports de `#copilot/events`;
- **73** ocorrências de DI/`container.resolve()` ou import de container no recorte do terminal.

### 2.3 Acoplamento inverso crítico

Após os cinco primeiros cortes práticos do P4, o `server/` não importa mais runtime do terminal
diretamente em nenhum ponto estrutural.

Os blocos abaixo já saíram da dependência direta `server → terminal` e foram extraídos para
superfícies compartilhadas de `presentation/`:

- `health/config` → `src/copilot/presentation/system-config.js`
- `sessions/memory/hub-health` → `src/copilot/presentation/conversation-hub.js`
- `SSE/rate-limiter-state` → `src/copilot/presentation/realtime.js`
- `observability/git/quota/pr-budget` → `src/copilot/presentation/system-metrics.js`
- `agent-control` (`context`, `inject`, `pipeline`, `dialog pause/resume`, `handoff`) →
  `src/copilot/presentation/agent-control.js`

Esse número continua sendo o melhor sinal de que o terminal ainda funciona, em parte, como
pseudo-backend compartilhado — mas agora com uma redução concreta e mensurável do acoplamento.

---

## 3. Mapa funcional do terminal atual

### 3.1 Boot e wiring

Principais arquivos:

- `index.js`
- `bootstrap.js`
- `di-wiring.js`
- `terminal-agent-wiring.js`
- `repl.js`
- `repl-listeners.js`

Papel atual:

- inicializar o modo terminal;
- registrar DI e setters legados;
- subir o servidor de injeção / integração com `server/`;
- conectar listeners de runtime do `AlwaysAliveAgent`;
- iniciar e coordenar o REPL.

### 3.2 Superfície de comandos

O `terminal/commands/` concentra uma superfície muito rica:

- sessão (`session.js`, `resume.js`, `memory.js`);
- health/diagnose/metrics/errors/usage (`diagnose.js`, `metrics.js`, `errors.js`, `usage.js`);
- contexto/configuração (`context.js`, `config.js`, `skills.js`, `tools.js`);
- integração operacional (`git.js`, `gh.js`, `audit.js`, `search.js`, `export.js`).

O problema não é a riqueza da superfície; o problema é que parte dela acessa domínios demais
diretamente.

### 3.3 Superfície HTTP do terminal

`terminal/handlers/` hoje serve como coleção de handlers reaproveitados por outras bordas:

- `system-config.js`
- `system-metrics.js`
- `dialog.js`
- `agent.js`

Na prática, o terminal deixou de ser só consumidor e passou a ser fornecedor acidental de handlers
para o `server/`.

### 3.4 Motor de diálogo local

`terminal/dialog/` concentra:

- `engine.js`
- `engine-persistence.js`
- `sse.js`
- `output.js`
- `turn-display.js`

Esse conjunto mistura:

- orquestração de turno local;
- streaming/renderização;
- persistência no hub;
- emissão SSE;
- controle de fila de turns.

É uma separação melhor do que antes, mas ainda não totalmente estabilizada como boundary.

### 3.5 Estado local e utilidades de UX

Arquivos como:

- `state.js`
- `alias-store.js`
- `file-context.js`
- `workspace-context.js`
- `rate-limiter-state.js`

representam a parte mais legitimamente “terminal” do módulo: estado local, ergonomia, anexos, alias,
contexto de workspace e pequenos mecanismos de suporte à experiência interativa.

---

## 4. Diagnóstico arquitetural

## A1 — o terminal tem três identidades ao mesmo tempo

Hoje o módulo atua como:

1. UX local e REPL;
2. adaptador HTTP/diagnóstico;
3. camada de aplicação compartilhada por `server/`.

Essas três identidades não são equivalentes e não deveriam morar indistintamente no mesmo boundary.

## A2 — DI está difusa demais no módulo

`73` ocorrências de `container.resolve()` / import de container são um sinal claro de dependência
implícita demais.

Isso aumenta:

- custo de teste;
- custo de leitura;
- chance de acoplamento invisível;
- e dificuldade de migrar ownership para APIs canônicas.

## A3 — `server/` ainda reaproveita handlers do terminal como camada comum

O `server/` importa `terminal/handlers/*`, `terminal/dialog/sse.js` e
`terminal/rate-limiter-state.js`.

Isso inverte o desenho ideal de P4: duas bordas deveriam consumir contratos comuns, não uma borda
depender da outra.

## A4 — a superfície de comandos mistura UX e domínio demais

Vários comandos ainda falam diretamente com:

- `agent/`;
- `conversation-hub/`;
- `channel/`;
- `observability/`;
- e container/DI.

Isso não é necessariamente errado em todos os casos, mas hoje está heterogêneo demais: alguns
comandos usam facades canônicas, outros entram pelo container, outros usam bridges diretamente.

## A5 — progresso recente existe e deve ser preservado

Há avanços importantes que **não** devem ser perdidos na rearquitetura:

- `/health`, `/status` e `/diagnose` já convergiram para o snapshot canônico do `agent`;
- a relação com `conversationStore` e `getAgent()` melhorou em alguns comandos;
- o terminal já deixou de ser apenas “um script grande” e ganhou subpastas com intenção arquitetural
  real.

Ou seja: não partimos do zero; partimos de um módulo bom, mas estruturalmente espalhado.

## A6 — há drift documental no próprio módulo

O `README.md` de `terminal/` ainda cita artefatos como `server.js` e `route-table.js`, embora a
topologia atual tenha mudado.

Esse é um sintoma importante: o boundary já mudou na prática, mas a narrativa do módulo não
acompanhou totalmente.

---

## 5. Situação ideal a atingir

### Modelo SSOT de borda para P4

O alvo consolidado da Faixa F é que cada borda consuma uma única fonte de verdade por domínio:

- `agent/` é a SSOT de health/runtime do agente;
- `conversation-hub/` é a SSOT de sessões, turnos e memória conversacional;
- `presentation/` é a SSOT de projections e handlers compartilhados consumidos por `server/` e
  `terminal`;
- `terminal/` fica restrito à UX local, adapters finos e estado legítimo de interação humana.

Isso significa, na prática, que `server/` e `terminal/` não devem mais compartilhar lógica por
imports cruzados diretos; ambos devem convergir para o mesmo ponto canônico em `presentation/`.

### Regra de compatibilidade com `agent` e SDK

As extrações de P4 **não** devem deslocar o papel central do terminal como interface operacional da
LLM-B.

Por isso, o guardrail da Faixa F passa a ser explícito:

- `terminal/index.js`, `terminal/repl.js`, `terminal/repl-listeners.js`, `terminal-agent-wiring.js`
  e `terminal/dialog/engine.js` continuam podendo depender diretamente de `agent/`, `channel/`,
  `conversation-hub/` e, quando necessário, de superfícies do SDK;
- o que está sendo extraído para `presentation/` são apenas **projections, handlers e contratos de
  borda** que antes faziam o `server/` depender do `terminal/`;
- nenhuma dessas extrações deve duplicar ou substituir o runtime truth de `agent/` nem o wrapper do
  SDK.

Em resumo: o terminal continua sendo a interface da LLM-B; o que muda é que `server/` e `terminal/`
passam a apontar para a mesma SSOT de presentation nas superfícies compartilhadas.

## T1 — `terminal/` como borda de UX local

O terminal deve ser dono de:

- REPL;
- frontend principal da LLM-B para humano e LLM-A;
- renderização local;
- comandos orientados à experiência humana;
- alias/anexos/contexto local;
- streaming e output local.

Ele **não** deve ser o lugar onde `server/` busca handlers reaproveitáveis por conveniência.

## T2 — server e terminal como consumidores irmãos de contratos comuns

O estado ideal de P4 é:

- `server/` consome projections/serviços canônicos;
- `terminal/` consome projections/serviços canônicos;
- nenhum dos dois depende do outro para operar sua superfície principal.

## T3 — comando local ≠ serviço de domínio compartilhado

Comandos de REPL devem ser finos e orientados a UX.

Quando precisarem de saúde, memória, sessão, replay, métricas, quota, git, gh ou store, devem chamar
superfícies canônicas pertencentes ao domínio certo:

- `agent/`
- `conversation-hub/`
- `channel/`
- `observability/`
- `bridges/`

## T4 — handlers HTTP do terminal devem ser adapters finos

Se o terminal expuser handlers HTTP, eles devem ser:

- finos;
- explicitamente de presentation local;
- desacoplados do `server/`;
- e sem virar depósito de lógica compartilhada.

## T5 — DI deve ficar concentrada no boot e em costuras específicas

O ideal não é “zerar DI”, e sim:

- concentrar wiring em `index.js` / `di-wiring.js` / seams claros;
- criar uma camada `terminal/frontend/*` para compor leituras e operações multi-domínio do frontend
  principal;
- reduzir `container.resolve()` espalhado por comandos e handlers;
- preferir imports/facades estáveis quando o domínio já tiver uma superfície canônica.

## T6 — capabilities avançadas do terminal ficam em trilha separada

O backlog avançado de terminal continua valioso, mas deve ficar em P7 até a base de P4 estar melhor
fechada.

Isso vale para:

- UX muito sofisticada;
- multi-session rica no REPL;
- streaming avançado;
- superfícies extras de diagnose/context intelligence;
- integrações mais profundas de TSServer/RPC.

---

## 6. Transformações recomendadas para o roadmap

## R1 — Classificar todo o `terminal/` por papel arquitetural

Cada arquivo do terminal deve ser classificado como:

- boot/wiring;
- REPL/commands;
- handlers HTTP;
- dialog engine/streaming;
- estado e UX local;
- compatibilidade/transição.

## R2 — Extrair contratos compartilhados para fora do `terminal/`

Tudo que hoje é importado pelo `server/` a partir do `terminal/` deve ser reavaliado e, idealmente,
movido para superfícies mais canônicas.

### Estado atual deste eixo

Os cinco primeiros slices já foram executados:

- `health` e `config` saíram de `terminal/handlers/system-config.js`;
- surgiu a superfície compartilhada `src/copilot/presentation/system-config.js`;
- `server/routes/health.js` e `server/routes/config.js` deixaram de depender diretamente de
  `terminal/handlers/system-config.js`;
- `terminal/handlers/system-config.js` virou adapter fino/re-export.
- `sessions`, `memory` e `hub-health` saíram de `terminal/handlers/dialog.js`;
- surgiu a superfície compartilhada `src/copilot/presentation/conversation-hub.js`;
- `server/routes/sessions.js`, `server/routes/memory.js` e a rota `/hub-health` migraram para essa
  mesma SSOT;
- `terminal/handlers/dialog.js` virou adapter fino/re-export.
- `CRITICAL_EVENTS` e `rate-limiter-state` saíram de `terminal/dialog/sse.js` e
  `terminal/rate-limiter-state.js`;
- surgiu a superfície compartilhada `src/copilot/presentation/realtime.js`;
- `server/routes/sse.js` e `server/middleware/rate-limiter-state.js` migraram para essa mesma SSOT;
- `terminal/dialog/sse.js` e `terminal/rate-limiter-state.js` viraram adapters finos.
- `metrics/errors/audit/tool-stats/history/git/gh/quota/pr-budget` saíram de
  `terminal/handlers/system-metrics.js`;
- surgiu a superfície compartilhada `src/copilot/presentation/system-metrics.js`;
- `server/routes/observability.js`, `server/routes/git.js` e a parte de quota/pr-budget em
  `server/routes/agent.js` migraram para essa mesma SSOT;
- `terminal/handlers/system-metrics.js` virou adapter fino/re-export.
- `context/inject/pipeline/dialog-control/handoff` saíram de `terminal/handlers/agent.js`;
- surgiu a superfície compartilhada `src/copilot/presentation/agent-control.js`;
- `server/routes/agent.js` migrou para essa mesma SSOT;
- `terminal/handlers/agent.js` virou adapter fino/re-export.

Próxima fila recomendada para este eixo:

1. redução mais pesada de DI em `commands/` e `dialog/`;
2. atualização do `README` do terminal;
3. contract tests ampliados do P4.

## R3 — Reduzir a difusão de DI no terminal

Foco em comandos, handlers e dialog engine que ainda dependem demais do container.

## R4 — Reorganizar o backlog do terminal em duas filas

- fila estrutural de P4;
- fila de capabilities de P7.

## R5 — Atualizar a narrativa documental do módulo

O módulo terminal precisa ter docs coerentes com a árvore real e com o novo boundary alvo.

---

## 7. Relação com o restante da série clean

Esta auditoria alimenta diretamente:

- `R-11` — programa P4;
- `R-16` — roadmap integrado da Faixa F;
- `R-15` — backlog avançado que deve continuar fora da fila estrutural.

Também depende fortemente de:

- `R-08` (runtime/health do `agent`);
- `R-09` (ownership de sessão);
- `R-10` (events/observability/projections).

---

## 8. Primeira fila recomendada do terminal

O primeiro corte implementável recomendado para o terminal era:

1. **extrair para superfícies canônicas** o que o `server/` ainda importa hoje de `terminal/`;
2. começar por blocos com melhor relação risco/ganho:
   - health/config projections;
   - sessões/memória/dialog list endpoints;
   - rate limiter state e `CRITICAL_EVENTS` de SSE;
3. só depois atacar a redução mais pesada de DI espalhada em `commands/` e `dialog/`.

### Situação após os primeiros cortes executados

Os cinco primeiros subcortes dessa fila já foram entregues:

- `health/config projections` foram extraídos para `src/copilot/presentation/system-config.js`;
- o terminal ficou como consumidor e adapter fino dessa superfície;
- o `server/` deixou de depender desse handler específico do terminal.
- `sessions/memory/hub-health` foram extraídos para `src/copilot/presentation/conversation-hub.js`;
- o terminal ficou como consumidor e adapter fino dessa superfície;
- o `server/` deixou de depender desse handler específico do terminal também.
- `SSE/rate-limiter-state` foram extraídos para `src/copilot/presentation/realtime.js`;
- o terminal ficou como consumidor e adapter fino dessa superfície;
- o `server/` deixou de depender desses contratos específicos do terminal também.
- `agent/system-metrics` (na prática: observability/git/quota/pr-budget) foram extraídos para
  `src/copilot/presentation/system-metrics.js`;
- o terminal ficou como consumidor e adapter fino dessa superfície;
- o `server/` deixou de depender desses contratos específicos do terminal também.
- `agent-control` foi extraído para `src/copilot/presentation/agent-control.js`;
- o terminal ficou como consumidor e adapter fino dessa superfície;
- o `server/` deixou de depender desse último contrato específico do terminal também.

Com isso, a fila recomendada fica reordenada assim:

1. consolidar `terminal/frontend/*` como camada interna do frontend principal da LLM-B;
2. redução mais pesada de DI em `commands/` e `dialog/`;
3. atualização documental do módulo terminal;
4. contract tests ampliados de P4.

### Situação após o primeiro corte terminal-first

Os dois primeiros slices dessa fila já entraram:

- surgiu `src/copilot/terminal/frontend/llm-b-frontend.js` como camada interna explícita para
  composição de UX local;
- `commands/session.js`, `commands/diagnose.js`, `commands/metrics.js` e `commands/usage.js`
  passaram a consumir essa camada;
- `commands/memory.js`, `commands/resume.js` e `commands/search.js` também passaram a consumir essa
  camada;
- `commands/config.js`, `commands/context.js` e `commands/errors.js` também passaram a consumir essa
  camada;
- surgiu `src/copilot/terminal/frontend/llm-b-runtime.js` como gateway runtime explícito do
  terminal;
- `repl.js`, `repl-listeners.js`, `dialog/output.js`, `dialog/engine.js`,
  `dialog/engine-persistence.js`, `terminal-agent-wiring.js` e `index.js` passaram a consumir esse
  gateway;
- o recorte de DI direta em `terminal/commands/` caiu de **22** para **0** ocorrências;
- o recorte total de `container.resolve()` em `src/copilot/terminal/` caiu para **2** ocorrências,
  com apenas **1** no runtime do módulo;
- o terminal passou a expor, de forma mais uniforme, o binding canônico `runtime ↔ sdk ↔ hub` na UX
  local.

Validação focada mais recente do slice terminal-first:

- **44/44** testes verdes em `vitest` cobrindo `terminal/frontend/*` e os comandos já migrados;
- **14/14** testes verdes em `node:test` cobrindo contratos de `dialog/output`, `dialog/engine`,
  `repl-listeners`, `terminal-agent-wiring` e `terminal/index`;
- **26/26** testes verdes em `vitest` na rodada do gateway runtime.

### Justificativa

Esse corte inicial:

- reduz acoplamento `server → terminal` sem exigir refactor total do REPL;
- cria contratos compartilhados que vão servir tanto ao `server/` quanto ao próprio `terminal/`;
- prepara o terreno para o terminal deixar de operar como pseudo-backend.

---

## 9. Conclusão

O `terminal/` não é um problema por excesso de capacidade; ele é um problema por **excesso de
responsabilidades misturadas**.

O caminho ideal não é amputar o módulo, e sim:

1. preservar o que é UX local legítima;
2. extrair o que virou serviço compartilhado acidental;
3. reduzir DI difusa;
4. alinhar o terminal ao mesmo conjunto de contratos canônicos que `server/` e o runtime já deveriam
   consumir.

Esse é o lugar correto do terminal dentro da rearquitetura clean: uma borda poderosa, mas
disciplinada.
