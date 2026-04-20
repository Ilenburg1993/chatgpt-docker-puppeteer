# agent-runtime-events.js

Módulo de tradução dos **sinais já normalizados pelo runtime local** para a UX do terminal.

## O que entra aqui

- `question.pending`
- tool lifecycle já reemitido pelo agent (`tool.execution_start/progress/partial_result/complete`)
- `session.error` reemitido pelo runtime
- compaction
- intents
- subagentes
- `stopped`

## O que NÃO entra aqui

- eventos vanilla da sessão SDK como `session.mode_changed`, `session.plan_changed`, `session.truncation`,
  `session.workspace_file_changed`, `assistant.turn_start`, etc.

Esses pertencem a `sdk-session-events.js`.

## Regra prática

Se o payload nasce no SDK, prefira `sdk-session-events.js`.
Se o payload já foi estabilizado pelo runtime/agent, use este módulo.
