# observability/

**Camada**: L2 — depende de `core/`, `config/`.

Logging, métricas, tracing e event collection para todo o sistema copilot.

## Conteúdo

| Diretório/Arquivo    | Responsabilidade                                  |
| -------------------- | ------------------------------------------------- |
| `logger.js`          | Logger central (`log()` com níveis)               |
| `error-tracker.js`   | Tracker de erros com deduplcação                  |
| `bootstrap.js`       | Injeção de logger+tracker nos handlers de `core/` |
| `event-collector.js` | Coletor de eventos para timeline/auditoria        |
| `tool-stats.js`      | Estatísticas de uso de tools                      |
| `collectors/`        | Coletores especializados (context, performance)   |
| `observers/`         | Observers de eventos do agent/dialog/task         |
| `index.js`           | Barrel de exportação                              |

## Regras de importação

- **Pode importar**: `core/`, `config/`, `node:*`
- **NÃO pode importar**: `agent/`, `sdk/`, `tools/`, `bridges/`
