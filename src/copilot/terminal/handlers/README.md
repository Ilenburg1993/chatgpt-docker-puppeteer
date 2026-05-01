# terminal/handlers/

**Camada**: borda HTTP compatível do terminal LLM-B.

Este diretório é deliberadamente pequeno. Ele existe para manter compatibilidade com consumidores
que importam handlers a partir do terminal, mas a lógica canônica vive em `presentation/`.

## Como ler este diretório

1. Comece por `index.js`, o barrel público.
2. Use `module-map.js` como inventário executável.
3. Leia `agent.js`, `dialog.js`, `system-config.js` e `system-metrics.js` como adapters de
   `presentation/`.
4. Trate `shared.js` apenas como contrato de tipos local.

## Mapa atual de papéis

| Papel                  | Arquivos                                                         |
| ---------------------- | ---------------------------------------------------------------- |
| `barrel`               | `index.js`                                                       |
| `inventory`            | `module-map.js`                                                  |
| `presentation-adapter` | `agent.js`, `dialog.js`, `system-config.js`, `system-metrics.js` |
| `type-contract`        | `shared.js`                                                      |

## Regra para novos arquivos

Todo novo arquivo JS neste diretório precisa aparecer em `module-map.js`. A regra preferencial é:
não adicionar arquivos aqui. Se a mudança envolver payload, estado, runtime, SDK ou domínio, o owner
deve ser `presentation/`, `server/runtime-state`, `agent/` ou `sdk/`, e este diretório deve
continuar somente como adapter fino.
