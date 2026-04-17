# terminal/

**Camada**: L6 — Terminal Permanente LLM-B (REPL interativo + inject server).

Superfície de interação humana via linha de comando, servidor HTTP de injeção e handlers de comandos
especializados.

## Subdomínios

| Diretório/Arquivo   | Responsabilidade                                                         |
| ------------------- | ------------------------------------------------------------------------ |
| `handlers/`         | Handlers HTTP por domínio (agent, dialog, system-config, system-metrics) |
| `frontend/`         | Fachada interna do terminal como frontend principal da LLM-B             |
| `dialog/`           | Motor de diálogo do terminal (engine, pipeline, REPL)                    |
| `index.js`          | Entry point — orquestra boot do terminal                                 |
| `repl.js`           | REPL readline interativo                                                 |
| `repl-listeners.js` | Listeners de eventos do REPL                                             |
| `state.js`          | Estado do terminal (hubSessionId, flags)                                 |
| `alias-store.js`    | Store de aliases customizados                                            |
| `file-context.js`   | Contexto de arquivos para o terminal                                     |

## Papel arquitetural atual

O terminal é o **frontend principal da LLM-B** para dois públicos:

- o usuário humano via REPL/TTY;
- a LLM-A via inject server HTTP e superfícies de diálogo contínuo.

Isso significa que o terminal pode consumir diretamente as SSOTs do runtime (`agent/`, `channel/`,
`conversation-hub/` e, quando necessário, `sdk/`), mas **não** deve voltar a servir de
pseudo-backend compartilhado para o `server/`.

As superfícies compartilhadas entre bordas vivem em `src/copilot/presentation/`; já as leituras e
operações especificamente voltadas à UX do terminal passam a convergir em `terminal/frontend/`.

Estado atual da convergência terminal-first:

- `commands/session`, `diagnose`, `metrics`, `usage`, `memory`, `resume`, `search`, `config`, `context` e `errors`
	já consomem `terminal/frontend/*` como consumer layer canônica;
- o recorte de `container.resolve()` em `terminal/commands/` caiu de **22** para **0** ocorrências;
- `repl.js`, `repl-listeners.js`, `dialog/output.js`, `dialog/engine.js`, `dialog/engine-persistence.js`,
	`terminal-agent-wiring.js` e `index.js` já convergiram para o gateway `terminal/frontend/llm-b-runtime.js`;
- o recorte total de `container.resolve()` em `src/copilot/terminal/` caiu para **2** ocorrências, com apenas **1** no runtime efetivo do módulo;
- `server/` permanece em **0 imports estruturais diretos** de `terminal/`.

## Regras de importação

- **Pode importar**: qualquer módulo (é a camada mais alta depois de `api/`)
- **NÃO pode ser importado por**: `core/`, `config/`, `sdk/`, `agent/` (violação de camada)
