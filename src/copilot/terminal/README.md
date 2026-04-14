# terminal/

**Camada**: L6 — Terminal Permanente LLM-B (REPL interativo + inject server).

Superfície de interação humana via linha de comando, servidor HTTP de injeção e handlers de comandos
especializados.

## Subdomínios

| Diretório/Arquivo   | Responsabilidade                                                         |
| ------------------- | ------------------------------------------------------------------------ |
| `handlers/`         | Handlers HTTP por domínio (agent, dialog, system-config, system-metrics) |
| `dialog/`           | Motor de diálogo do terminal (engine, pipeline, REPL)                    |
| `index.js`          | Entry point — orquestra boot do terminal                                 |
| `server.js`         | Servidor HTTP `:3009` para injeção de mensagens                          |
| `repl.js`           | REPL readline interativo                                                 |
| `repl-listeners.js` | Listeners de eventos do REPL                                             |
| `state.js`          | Estado do terminal (hubSessionId, flags)                                 |
| `route-table.js`    | Mapeamento de rotas HTTP → handlers                                      |
| `alias-store.js`    | Store de aliases customizados                                            |
| `file-context.js`   | Contexto de arquivos para o terminal                                     |

## Regras de importação

- **Pode importar**: qualquer módulo (é a camada mais alta depois de `api/`)
- **NÃO pode ser importado por**: `core/`, `config/`, `sdk/`, `agent/` (violação de camada)
