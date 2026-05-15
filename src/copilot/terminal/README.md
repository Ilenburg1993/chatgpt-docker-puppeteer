# terminal/

**Camada**: L6 — frontend operacional da LLM-B.

O terminal é a borda humana do runtime contínuo:

- REPL interativo;
- banners e comandos operacionais;
- SSE/UI local;
- injeção HTTP para integração com LLM-A e outros clientes.

## Papel arquitetural atual

O terminal **não** implementa versões paralelas do SDK.

Ele consome:

- `agent/` para lifecycle e estado do agente;
- `presentation/agent-runtime.js` como accessor compartilhado do runtime default;
- `sdk/` apenas por gateways terminal-owned quando precisar de contratos vanilla de sessão;
- `frontend/` como camada de projeção/consumo do runtime;
- `dialog/` como camada de render/prompt/espera/envio.

## Estrutura recomendada

Use `module-map.js` como inventário executável da borda terminal. O mapa diferencia arquivos de
boot, orquestração, REPL, adapters de evento, estado local e subdiretórios de superfície. O mapa
também declara `risk` e scorecard para orientar a ordem de decomposição.

| Área                                     | Função                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `module-map.js`                          | inventário executável da raiz do terminal                                  |
| `index.js`                               | barrel público puro da borda terminal                                      |
| `runtime-root.js`                        | composition root explícito do terminal                                     |
| `frontend/`                              | consumer layer canônica do runtime para o terminal                         |
| `frontend/gateways/sdk-session.js`       | única ponte runtime do terminal para helpers vanilla de sessão SDK         |
| `frontend/gateways/tools.js`             | única ponte terminal-owned para file tools e introspecção de tools         |
| `frontend/operational-guidance/`         | guidance operacional para boot, /status, /sdk doctor, /fs e recuperação    |
| `state/sdk/`                             | sub-surface estreita para elicitations, permissões e user input do SDK     |
| `state/ui/`                              | sub-surface estreita para display policy, detalhe e tema visual            |
| `state/repl-runtime/`                    | sub-surface estreita para controles runtime do REPL e rate-limiter reset   |
| `dialog/`                                | prompt dinâmico, output helpers, waiting UX, engine de diálogo             |
| `commands/`                              | comandos REPL finos, orientados a operações do runtime                     |
| `state/display-policy.js`                | presets de densidade visual e impacto em prompt/waiting                    |
| `state/pending-question-answer.js`       | roteamento de respostas humanas para `ask_user` pendente sem deadlock      |
| `state/pending-question-replay.js`       | dedupe/replay de perguntas pendentes após rewire/restart                   |
| `presentation/runtime-ui-state-store.js` | estado de UI compartilhado usado pelo terminal e outras bordas             |
| `repl/repl-banner.js`                    | banner operacional do REPL e lista compacta de comandos/endpoints          |
| `repl/repl-command-parser.js`            | parser puro de comandos slash e aliases resolvidos                         |
| `repl/repl-input-routing.js`             | policy de comandos imediatos e fila durante input concorrente              |
| `repl/repl-listeners.js`                 | tradução de eventos do agente/SDK para UX local                            |
| `repl/repl-multiline.js`                 | estado de input multiline por continuação com barra invertida              |
| `repl/live-status-line.js`               | linha viva permanente com heartbeat, modelo, esforço e atividade atual     |
| `terminal-phases/`                       | fases de boot do terminal e submódulos finos de banner/reflection/shutdown |
| `events/event-adapters.js`               | composition root canônico dos adapters de eventos para REPL/headless       |
| `events/event-adapter-events.js`         | matriz de eventos cobertos, em passthrough e ignorados no terminal         |
| `events/sdk-session-events.js`           | tradução dedicada dos sinais vanilla da sessão SDK para stdout/SSE         |
| `events/agent-runtime-events.js`         | tradução dedicada dos sinais normalizados do runtime/agent para stdout/SSE |
| `events/tool-activity-presenter.js`      | narrativa operacional de tools, arquivos e comandos para o streaming live  |
| `state/turn-trace-state.js`              | resumo canônico por turno de tools/arquivos tocados para `/activity`       |
| `events/task-stream-events.js`           | render e SSE do streaming de tarefas internas (`task.*`)                   |
| `events/agent-sse-passthrough.js`        | passthrough SSE explícito e estreito para eventos sem adapter dedicado     |
| `wiring/terminal-agent-wiring.js`        | SSE + wiring de alto nível entre terminal e agent                          |
| `index.js` / `bootstrap.js`              | boot do terminal                                                           |

## Intervenção Imediata

O terminal diferencia três intenções de input concorrente:

- mensagem normal: entra na fila canônica do dialog loop;
- `/steer <msg>`: usa o modo SDK immediate para redirecionar o turno ativo;
- `/interrupt <msg>`: aborta o turno SDK atual e enfileira a mensagem como substituta.

`/abort` está disponível para abortar o turno ativo sem criar uma substituição. Esses comandos
furam a fila local do REPL para evitar deadlocks em turnos longos ou degradados.

## Papéis da raiz

| Papel              | Arquivos/diretórios                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `entrypoint`       | `bootstrap.js`, `module-map.js`                                                                |
| `barrel`           | `index.js`                                                                                     |
| `boot`             | `bootstrap-lifecycle.js`, `terminal-phases/`                                                   |
| `orchestrator`     | `runtime-root.js`                                                                              |
| `repl`             | `repl/` e seus módulos de lifecycle, parsing, routing, banner, multiline e status vivo         |
| `event-adapter`    | `events/` com adapters, presenters, passthrough e matriz de cobertura                          |
| `wiring`           | `wiring/terminal-agent-wiring.js`, `wiring/`                                                   |
| `passthrough`      | `events/agent-sse-passthrough.js`                                                              |
| `sdk-adapter`      | `state/sdk-interactions.js`                                                                    |
| `dev-tooling`      | `dev-watch.js` — watcher seletivo in-process para hot-reload em modo dev/supervisionado        |
| `state`            | `state/` com activity, display, pending questions, rate limiter, SDK interactions e turn trace |
| `store`            | `stores/alias-store.js`, `stores/`                                                             |
| `command-surface`  | `commands/`                                                                                    |
| `dialog-surface`   | `dialog/`                                                                                      |
| `frontend-surface` | `frontend/`                                                                                    |
| `handler-surface`  | `handlers/`                                                                                    |

## Riscos da raiz

| Risco     | Arquivos/diretórios                                                                                                                                                                                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hotspot` | `repl/`, `repl/repl.js`, `repl/repl-command-router.js`, `events/`, `events/agent-runtime-events.js`, `events/sdk-session-events.js`, `state/`, `state/display-policy.js`, `state/sdk-interactions.js`, `state/turn-trace-state.js`, `wiring/`, `wiring/terminal-agent-wiring.js`, `commands/`, `dialog/`, `frontend/` |
| `watch`   | `runtime-root.js`, `repl/repl-lifecycle.js`, `state/activity-state.js`, `events/io-activity-events.js`, `stores/`, `stores/alias-store.js`, `terminal-phases/`                                                                                                                                                        |
| `stable`  | arquivos pequenos de boot, estado, passthrough, handlers, stores e adapters já finos                                                                                                                                                                                                                                  |

Regra local: arquivos acima de 300 linhas precisam ser `hotspot`; arquivos acima de 220 linhas
precisam ser ao menos `watch`. O scorecard exportado por `module-map.js` deve ser consultado antes
de novas features em UX.

## Lifecycle e ownership

- O entrypoint executável continua sendo `terminal/bootstrap.js`.
- O lifecycle fatal de boot fica em `terminal/bootstrap-lifecycle.js`, que registra sinais de
  processo e chama `runShutdown('boot_failure')` antes de encerrar em falha fatal.
- `terminal/index.js` é barrel puro e não concentra lógica operacional.
- `terminal/runtime-root.js` é owner de recursos de UX local: aliases, pinned files, activity
  listeners, reflection loop, TODO cleanup e REPL.
- O boot do terminal é dividido em fases exportadas pela surface pública do terminal, para que o
  `BootLifecycleReport` diferencie aliases, runtime config, pinned context, ConversationHub, HTTP
  server, listeners e REPL.
- Dentro de `terminal-phases/`, `boot-banner.js`, `boot-reflection-loop.js` e `boot-shutdown.js`
  isolam a política operacional do boot, mantendo `boot-listeners.js` focado no wiring vivo da fase
  `terminal-runtime-listeners`.
- `server/index.js` é o único owner do HTTP server; o terminal injeta `startCopilotServer`, mas não
  registra segundo shutdown handler para fechar o mesmo server.
- Timers do terminal devem ser registrados em `core/timer-registry.js` e handlers explícitos devem
  usar `SHUTDOWN_PRIORITY`.

## Regra de ouro

Se algo já existe no SDK vanilla — por exemplo:

- mode/plan
- streaming
- usage
- workspace file change
- truncation / snapshot rewind / handoff

o terminal deve **observar e ampliar** esse comportamento, não recriá-lo localmente.

## Acesso ao runtime

O terminal ainda tem módulos que operam diretamente sobre a façade pública do agent, mas a direção
arquitetural canônica agora é:

```text
agent/
	-> presentation/agent-runtime.js
		-> terminal/frontend/
			-> terminal/dialog/ e comandos
```

Ou seja: sempre que o acesso ao runtime puder ser compartilhado com outras bordas, ele deve preferir
passar por `presentation/agent-runtime.js`.

## Critério prático: o que permanece no terminal

Continua no `terminal/` quando for:

- prompt/render/waiting UX;
- parsing de comandos do REPL;
- narrativa operacional local;
- detalhes exclusivamente humanos da interação.

Deve sair do `terminal/` quando virar:

- projection compartilhada com `server/`;
- parsing compartilhado de `runtimeId`;
- capability pública de runtime ou façade de borda reutilizável.

## Estado atual relevante

- `/plan` usa somente `mode.get/set` e `plan.read/update/delete` do SDK;
- o prompt dinâmico mostra `MODE:<SDK>` quando a sessão está fora de `interactive`;
- `presentation/runtime-ui-state-store.js` não guarda mais um “plan mode local” paralelo — apenas a
  última projeção observada do SDK;
- `events/sdk-session-events.js` reflete sinais vanilla da sessão SDK ao operador;
- comandos, status, state e adapters consomem helpers vanilla da sessão SDK via
  `frontend/gateways/sdk-session.js`, sem imports diretos de `#copilot/sdk/session`;
- `events/agent-runtime-events.js` reflete sinais já normalizados pelo runtime/agent ao operador;
- `events/event-adapters.js` é a via preferencial única para registrar adapters em modo REPL ou
  headless;
- `events/event-adapter-events.js` governa a matriz “adapter explícito / passthrough SSE / ignorado”
  dos eventos do agent no terminal;
- `state/sdk-interactions.js` rastreia `elicitation` e permissões SDK para `/status`, `/now` e
  comandos;
- `events/tool-activity-presenter.js` normaliza a narrativa live de tools, caminhos de arquivos e
  operações;
- `state/turn-trace-state.js` reconcilia `assistant.turn_*`, tools e alterações de workspace em um
  resumo por turno exibido por `/activity`;
- `events/task-stream-events.js` concentra a narrativa do streaming de tarefas internas do runtime;
- `events/agent-sse-passthrough.js` transmite apenas a janela residual de eventos do agent que ainda
  não ganharam adapter dedicado, eliminando o fallback genérico por default;
- `repl/repl-listeners.js` agora orquestra essas duas fronteiras em vez de acumular toda a semântica
  sozinho.

## Regras de importação

- **Pode importar**: qualquer camada abaixo, porque é uma borda
- **Não deve ser importado por**: `sdk/`, `core/`, `config/`, `agent/`

## Política barrel-first local

- todo `index.js` deve ser barrel puro;
- composition roots devem ter nome explícito (`runtime-root.js`, `dialog-runtime.js`);
- imports entre subpastas irmãs do terminal devem passar via barrels do respectivo submódulo;
- imports same-folder privados podem permanecer diretos quando não cruzarem fronteiras de módulo.
- imports do terminal para `#copilot/sdk/session` ficam restritos ao gateway `frontend/gateways/sdk-session.js`.
- imports do terminal para `#copilot/tools` ficam restritos ao gateway `frontend/gateways/tools.js`; comandos e
  projections devem consumir esse gateway.

## Superfícies públicas autorizadas

Superfícies públicas canônicas do terminal no `package.json`:

- `#copilot/terminal`
- `#copilot/terminal/commands`
- `#copilot/terminal/dialog`
- `#copilot/terminal/frontend`
- `#copilot/terminal/handlers`
- `#copilot/terminal/stores`
- `#copilot/terminal/state/repl-runtime`

Regra: não expor wildcard `#copilot/terminal/*`; novos acessos públicos exigem barrel explícito e contrato deliberado.

## Nota de clareza arquitetural

Se houver dúvida entre `frontend/` e `dialog/`:

- **`frontend/` responde “de onde vem a verdade consumida pelo terminal?”**
- **`dialog/` responde “como essa verdade vira prompt, espera, render e envio?”**

## Nota operacional importante

O terminal pode rodar de forma destacada/headless (task, PM2, processo órfão, painel fechado). Por
isso, **logging e observabilidade não podem depender de um TTY vivo** para manter `/inject`, SSE,
health ou rotas HTTP funcionais. stdout/stderr são sinks oportunistas; o fluxo canônico do runtime
precisa continuar funcional mesmo quando esses streams estão indisponíveis.
