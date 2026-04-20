# terminal/dialog/

Camada de diálogo e render do terminal.

## Pergunta que esta pasta responde

> Como a verdade já lida do runtime vira prompt, waiting state, SSE e output humano no terminal?

## Arquivos

| Arquivo | Função |
| --- | --- |
| `engine.js` | envio de turnos, waiting loop, notifications e coordenação do dialog loop |
| `engine-persistence.js` | persistência auxiliar ligada ao engine |
| `output.js` | prompt dinâmico, waiting prompt, formatação visual e helpers de stdout |
| `sse.js` | broadcast SSE, IDs e critical events |
| `turn-display.js` | renderização de turnos/trechos do diálogo |
| `index.js` | barrel público |

## Regra de uso

- Esta pasta **não** deve decidir semântica do SDK por conta própria.
- Ela consome projections/estado já estabilizados por `frontend/`, `agent/` e `sdk/`.
- Se existir um evento vanilla do SDK (ex.: `assistant.streaming_delta`, `tool.execution_progress`, `session.mode_changed`), a UX deve partir dele e só então ampliar.

## Heurística prática

- `output.js` = “qual prompt/texto eu mostro?”
- `engine.js` = “como um turno anda no terminal?”
- `sse.js` = “como clientes externos observam isso?”
