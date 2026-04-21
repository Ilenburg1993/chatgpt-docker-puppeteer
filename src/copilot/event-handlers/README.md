# event-handlers/

Boundary de tradução entre **eventos vanilla da sessão SDK** e os eventos internos consumidos pelo
runtime.

## Pergunta que esta pasta responde

> Como um `SessionEvent` do `@github/copilot-sdk` vira um sinal operacional estável para `agent/`,
> `terminal/`, `observability/` e demais consumidores internos?

## Regra arquitetural principal

- Se o SDK já emite um evento vanilla, **o primeiro lugar a tocar esse evento é aqui**.
- O restante do sistema deve preferir os sinais traduzidos daqui, em vez de re-interpretar o payload
  do SDK em múltiplos lugares.
- Ampliações são permitidas, mas **sempre em cima** do payload vanilla do SDK — nunca por semântica
  paralela.

## Arquivos

| Arquivo                   | Função                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `session-lifecycle.js`    | lifecycle de sessão (`idle`, `info`, `warning`, `model_change`, `tools_updated`)                          |
| `streaming.js`            | deltas vanilla (`assistant.message_delta`, `assistant.reasoning_delta`, `assistant.streaming_delta`)      |
| `tool-lifecycle.js`       | tool execution (`start`, `progress`, `partial_result`, `user_requested`)                                  |
| `mode-and-tools.js`       | `session.mode_changed` e `session.plan_changed`                                                           |
| `sdk-responses.js`        | sinais vanilla de resposta/lifecycle complementar (`turn_start/end`, truncation, handoff, shutdown, etc.) |
| `interaction-events.js`   | interação/hook/subagent/permission/`exit_plan_mode.completed`                                             |
| `usage.js`                | `assistant.usage`                                                                                         |
| `compaction.js`           | compaction de infinite session                                                                            |
| `mcp-events.js`           | status e OAuth de MCP                                                                                     |
| `system-notifications.js` | notificações sistêmicas                                                                                   |
| `catch-all.js`            | catálogo de conhecidos e proteção contra drift                                                            |

## Fluxo canônico

```text
SDK SessionEvent
  -> event-handlers/*
    -> callbacks.emit(...)
      -> agent/session/event-wirer
        -> AlwaysAliveAgent EventEmitter
          -> terminal / observability / presentation / server
```

## Heurística prática

- Se a dúvida é **"qual é o payload real do SDK?"**, olhe
  `node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts`.
- Se a dúvida é **"qual é a forma estável usada internamente?"**, olhe esta pasta.
- Se a dúvida é **"como isso aparece para o operador do terminal?"**, olhe
  `terminal/sdk-session-events.js` e `terminal/repl-listeners.js`.

## Critério de fronteira com `agent/` e `observability/`

- `event-handlers/` traduz;
- `agent/` orquestra e mantém estado;
- `observability/` coleta o sinal já estabilizado.

Se um módulo daqui começar a montar payload HTTP, fazer health do runtime ou guardar estado mutável
de sessão, a fronteira está errada.
