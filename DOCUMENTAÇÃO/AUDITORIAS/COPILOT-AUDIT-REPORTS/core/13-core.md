# 13 — core/ — Módulo Consolidado

**Módulo**: `src/copilot/core/` **Arquivos**: 3 | **LOC total**: 162 **Score**: 9.0/10 **Data**:
2026-06

## Visão Geral

Núcleo do módulo copilot: constantes canônicas, hierarquia de erros e barrel de contratos centrais.
Acessado via alias `#copilot/core` por todos os outros sub-módulos.

## Mapa Funcional

### constants.js (76 LOC)

| Exportação              | Tipo                              | Valor default                          |
| ----------------------- | --------------------------------- | -------------------------------------- |
| `LLM_B_TERMINAL_PORT`   | `number`                          | 3009                                   |
| `MAX_QUEUE_SIZE`        | `number`                          | 100                                    |
| `LLM_B_TURN_TIMEOUT_MS` | `number`                          | 120_000 ms (env: `LLM_B_TURN_TIMEOUT`) |
| `MAX_SSE_CLIENTS`       | `number`                          | 50 (env: `MAX_SSE_CLIENTS`)            |
| `AGENT_EVENTS`          | `readonly string[]`               | re-export de `agent/events.js`         |
| `TOOL_CATEGORIES`       | `Readonly<Record<string,string>>` | 14 categorias congeladas               |

### errors.js (63 LOC)

```
Error
└── CopilotError (code='COPILOT_ERROR')
    ├── SessionError (code='SESSION_ERROR')
    └── BridgeError  (code='BRIDGE_ERROR')
```

## Achados por Severidade

### P4 (1)

| ID         | Arquivo      | Título                                                                         |
| ---------- | ------------ | ------------------------------------------------------------------------------ |
| CORE-P4-01 | constants.js | `MAX_SSE_CLIENTS` default inconsistente: constants.js=50, bridge-stream.js=100 |

**CORE-P4-01**: `bridge-stream.js` lê `process.env['MAX_SSE_CLIENTS']` independentemente com
`|| 100` como default. A constante canônica `MAX_SSE_CLIENTS` em `core/constants.js` usa `?? 50`
como default. Sem a env var, `bridge-stream.js` adota 100 enquanto qualquer consumidor de
`#copilot/core` recebe 50. Fix: `bridge-stream.js` importar de `#copilot/core`.

### P5 (2)

| ID         | Arquivo      | Título                                                                          |
| ---------- | ------------ | ------------------------------------------------------------------------------- |
| CORE-P5-01 | constants.js | Env override `LLM_B_TURN_TIMEOUT` sem sufixo `_MS` diverge do nome da constante |
| CORE-P5-02 | errors.js    | `Error.captureStackTrace` não chamado — stack trace inclui frame do construtor  |

## Score por Arquivo

| Arquivo      | LOC     | Score      | P4    | P5    |
| ------------ | ------- | ---------- | ----- | ----- |
| constants.js | 76      | 8.5/10     | 1     | 1     |
| errors.js    | 63      | 9.0/10     | 0     | 1     |
| index.js     | 23      | 9.5/10     | 0     | 0     |
| **TOTAL**    | **162** | **9.0/10** | **1** | **2** |

## Referências

| Arquivo                    | Path                                       |
| -------------------------- | ------------------------------------------ |
| constants.js               | [constants-audit.md](./constants-audit.md) |
| errors.js                  | [errors-audit.md](./errors-audit.md)       |
| index.js                   | [index-audit.md](./index-audit.md)         |
| Módulo anterior (F16 api/) | [../api/12-api.md](../api/12-api.md)       |

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II — F17 core/._
