# src/copilot/ — mapa canônico do runtime

Hub arquitetural do runtime Copilot local.

Este diretório tem uma regra simples:

> sempre que existir um conceito análogo no `@github/copilot-sdk`, o código local deve **partir do
> SDK vanilla** e só depois ampliar ergonomia, UX ou governança.

## Fluxo canônico de ponta a ponta

```text
terminal:llm-b
  -> terminal/bootstrap.js
    -> bootstrap.js
      -> runtime-wiring.js
        -> terminal/index.js
          -> server/index.js
          -> repl.js

Copilot SDK session
  -> event-handlers/               (tradução do vanilla para sinais internos estáveis)
    -> agent/                      (AlwaysAliveAgent + lifecycle/dialog/session)
      -> presentation/agent-runtime.js (accessor compartilhado do runtime)
        -> terminal/frontend/      (consumer layer / projections)
          -> terminal/dialog/      (prompt, waiting, render, SSE)
            -> terminal/repl/repl.js    (operador)

Em paralelo:

SDK/agent events
  -> observability/                (coleta, métricas, tracing, auditoria)
  -> presentation/ + server/routes/ (HTTP/Socket/UI compartilhada)
```

## Regra prática por pasta

| Pasta               | Papel principal                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `sdk/`              | wrapper canônico do `@github/copilot-sdk` e SSOT de tipos/capabilities/operações vanilla |
| `event-handlers/`   | tradução de `SessionEvent` vanilla para sinais internos do runtime                       |
| `agent/`            | orquestração do runtime contínuo (`AlwaysAliveAgent`)                                    |
| `terminal/`         | UX local da LLM-B (REPL, SSE, status, comandos)                                          |
| `observability/`    | logging, métricas, tracing e coletores do runtime                                        |
| `presentation/`     | accessors e projeções compartilhadas entre bordas                                        |
| `conversation-hub/` | store/orquestração de sessões/turnos persistidos                                         |
| `hooks/`            | policies e callbacks configuráveis sobre a sessão SDK                                    |
| `tools/`            | custom tools registradas sobre a superfície do SDK                                       |
| `infra/`            | primitivas compartilhadas de I/O, cache, índice, locks, storage e SSE                    |
| `config/`           | defaults, builders e configuração declarativa                                            |
| `core/`             | erros, constantes, contratos centrais e utilitários base                                 |

## Boot Canônico

O boot local tem uma única autoridade executável:

```text
npm run terminal:llm-b
  -> src/copilot/terminal/bootstrap.js
    -> bootCopilot()
      -> readCopilotBootConfig()
      -> startTerminalServer({ startCopilotServer, wireRuntime, startTodoCleanupJob, bootConfig })
        -> startCopilotServer()
        -> startRepl()
```

Regras:

- `terminal/bootstrap.js` é o entrypoint canônico para execução local e PM2 `llm-b-terminal`;
- `server/index.js` é dono apenas de HTTP/Socket.IO e nunca inicia REPL ou agent sozinho;
- `terminal/index.js` é o host da UX local e compõe o server por injeção;
- `boot/` registra o contrato vivo de boot, resolve workspace/skills/porta/token e guarda o baseline
  mínimo de capacidades vanilla do SDK que o projeto deve preservar.
- `boot/config.js` é o arquivo canônico para variáveis operacionais de boot:
  `COPILOT_WORKING_DIRECTORY`, `COPILOT_SKILL_DIRECTORIES`, `COPILOT_PINNED_CONTEXT_DIRS`,
  `LLM_B_TERMINAL_HOST`, `LLM_B_TERMINAL_PORT`, `LLM_B_TERMINAL_TOKEN` e `COPILOT_CLI_URL`.

## Critério rápido de responsabilidade por camada

| Se a responsabilidade é…                                           | Camada preferencial |
| ------------------------------------------------------------------ | ------------------- |
| contrato vanilla do SDK                                            | `sdk/`              |
| tradução de `SessionEvent` cru                                     | `event-handlers/`   |
| source-of-truth do runtime contínuo                                | `agent/`            |
| façade pública estratégica do runtime / SDK                        | `agent/facades/`    |
| payload/shared handler compartilhado entre `server/` e `terminal/` | `presentation/`     |
| seleção compartilhada de `runtimeId`                               | `presentation/`     |
| REPL, prompt, render, waiting UX                                   | `terminal/`         |
| logging, métricas, tracing, timelines                              | `observability/`    |

Em resumo:

- `agent/` governa o runtime;
- `presentation/` governa o acesso compartilhado das bordas ao runtime;
- `terminal/` governa a UX local;
- `server/` governa protocolo HTTP;
- `sdk/` continua sendo a SSOT do vanilla.

## Perguntas rápidas de arquitetura

### “Quero consumir `mode/plan`, sessions, agents ou outras capabilities vanilla do SDK”

- comece em `sdk/`
- se fizer sentido como API pública do runtime, exponha via `agent/facades/agent-sdk-access.js`
- se a UX do terminal precisar de projeção pronta, use `terminal/frontend/sdk-session-projection.js`

### “Quero reagir a um evento do SDK”

- primeiro veja `node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts`
- depois mapeie em `event-handlers/`
- só então consuma esse sinal em `agent/`, `terminal/` ou `observability/`

### “Quero melhorar a UX do terminal”

- se a verdade do runtime puder ser compartilhada com outras bordas, comece em
  `presentation/agent-runtime.js`
- se for consumo de runtime: `terminal/frontend/`
- se for render/prompt/SSE: `terminal/dialog/`
- se for reação visível a eventos do runtime: `terminal/repl/repl-listeners.js` e
  `terminal/events/sdk-session-events.js`

### “Quero saber por que um evento aparece no terminal”

```text
sdk/generated/session-events.d.ts
  -> src/copilot/event-handlers/
    -> src/copilot/agent/session/wiring/event-wirer.js
      -> AlwaysAliveAgent EventEmitter
        -> terminal/events/sdk-session-events.js ou terminal/repl/repl-listeners.js
```

## READMEs locais recomendados

- `agent/README.md`
- `agent/facades/README.md`
- `sdk/README.md`
- `event-handlers/README.md`
- `observability/README.md`
- `infra/README.md`
- `tools/file/README.md`
- `terminal/README.md`
- `terminal/frontend/README.md`
- `terminal/dialog/README.md`

## Anti-drift

- não recriar `plan mode`, `usage`, `streaming`, `mode`, `plan.md`, `ask_user` ou qualquer conceito
  já existente no SDK como semântica paralela;
- quando o runtime ampliar algo, deixar explícito **qual é a base vanilla** e **qual é o valor
  agregado local**.
