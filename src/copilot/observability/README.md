# observability/

Coleta transversal do runtime: logging, métricas, tracing, timelines e snapshots operacionais.

## Pergunta que esta pasta responde

> Como o sistema observa o que aconteceu **sem** virar dono da semântica do SDK ou do agent?

## Regra arquitetural principal

- `observability/` **consome** sinais já estabilizados.
- A tradução do vanilla do SDK acontece em `event-handlers/`, não aqui.
- Esta pasta não deve reinterpretar payload bruto do SDK em paralelo ao runtime.

## Conteúdo

| Diretório/Arquivo      | Responsabilidade                              |
| ---------------------- | --------------------------------------------- |
| `logger.js`            | logger central                                |
| `error-tracker.js`     | tracking/deduplicação de erros                |
| `event-collector.js`   | timeline de eventos para UX/auditoria         |
| `tool-stats.js`        | estatísticas de tools                         |
| `snapshots.js`         | snapshots observáveis do sistema              |
| `event-bus-runtime.js` | acoplamento do EventBus ao runtime observável |
| `collectors/`          | coletores especializados                      |
| `observers/`           | observers por domínio                         |
| `otel.js`              | tracing/OTEL                                  |

## Fronteiras importantes

- `event-handlers/` = traduz o SDK
- `agent/` = executa o runtime
- `observability/` = coleta, mede e registra

## Critério prático

Se a pergunta for “quem decide o significado do evento?” a resposta não é `observability/`.

Esta pasta deve:

- consumir sinais já estabilizados;
- registrar, medir e correlacionar;
- produzir timelines, alertas e snapshots observáveis.

Ela não deve:

- selecionar runtime;
- criar payload HTTP canônico;
- reinterpretar `SessionEvent` cru em paralelo a `event-handlers/`.

Se você estiver escrevendo código e pensar “vou parsear esse `SessionEvent` do SDK aqui dentro”,
provavelmente o lugar certo não é esta pasta.
