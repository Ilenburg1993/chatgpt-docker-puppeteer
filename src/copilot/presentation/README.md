# presentation/

Camada de **projeções compartilhadas de borda**.

## Pergunta que esta pasta responde

> O que `server/`, `terminal/` e outras bordas precisam consumir em comum sem depender umas das outras?

## Regra arquitetural principal

- `presentation/` não é fonte de verdade do runtime.
- Ela monta **projeções e handlers compartilhados** usando `agent/`, `sdk/`, `conversation-hub/`, `observability/`
  e estado legítimo do terminal quando isso for inevitável.
- Serve para evitar acoplamentos como `server -> terminal/handlers/*`.

## Arquivos

| Arquivo                | Função                                                                      |
| ---------------------- | --------------------------------------------------------------------------- |
| `index.js`             | barrel/hub canônico das superfícies compartilhadas                          |
| `agent-runtime.js`     | accessor compartilhado do runtime default / runtimes registrados            |
| `agent-control.js`     | controle compartilhado do agente (inject, pipeline, dialog, handoff)        |
| `agent-http-errors.js` | mapeamento canônico `Error -> HTTP` para o runtime do agente                |
| `conversation-hub.js`  | handlers compartilhados de sessões, turns, memory e health do hub           |
| `realtime.js`          | contratos compartilhados de realtime / SSE crítico / reset de rate limiters |
| `sdk-sessions.js`      | ownership e projections compartilhadas da sessão SDK                        |
| `system-config.js`     | health/config compartilhados para server e terminal                         |
| `system-metrics.js`    | métricas, budget, git/gh e observabilidade compartilhada                    |

## Heurística prática

- Se uma borda precisa consumir algo **igual** à outra, considere `presentation/`.
- Se a lógica é puramente do terminal, deixe em `terminal/`.
- Se a lógica é puramente do server, deixe em `server/`.
- Se a capability nasce no SDK, comece em `sdk/` e só depois projete aqui se houver uso compartilhado.

## Runtime compartilhado

`agent-runtime.js` é o novo ponto canônico para bordas consumirem:

- runtime default atual do agent;
- futuros runtimes nomeados vindos da `AgentRuntimeRegistry`;
- metadata segura de runtimes conhecidos para health/config/UX.

Isso evita que `terminal/` e `server/` precisem conhecer diretamente a combinação de:

- singleton lazy `getAgent()`;
- registry explícita de runtimes;
- política de seleção do runtime default.

## Anti-drift

- `presentation/` não deve inventar semântica paralela ao SDK.
- `presentation/` não deve virar dumping ground de utilitários genéricos.
- Se o código começa a abrir `AgentContext` ou a reinterpretar `SessionEvent` cru aqui dentro, a fronteira está errada.
