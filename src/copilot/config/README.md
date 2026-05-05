# config/

**Camada**: L1 — depende apenas de `core/`.

Configuração do agente: variáveis de ambiente, sessão, system prompt, custom agents, pinned files.

## Conteúdo

| Arquivo             | Responsabilidade                                   |
| ------------------- | -------------------------------------------------- |
| `env.js`            | Carregamento de variáveis de ambiente com defaults |
| `session-config.js` | Builder de configuração de sessão do SDK           |
| `system-prompt/`    | System prompt modular (builders, live reload, SDK) |
| `custom-agents.js`  | Registro e gestão de agentes customizados          |
| `pinned-files.js`   | Loader de arquivos fixos para contexto             |
| `model-registry.js` | Registro de modelos disponíveis                    |

## Regras de importação

- **Pode importar**: `core/`, `node:*`
- **NÃO pode importar**: `agent/`, `sdk/`, `tools/`, `bridges/`, `terminal/`

## Regra arquitetural 2.1

- `index.js` deve ser **barrel puro**: apenas import/export, JSDoc mínimo e tipagem;
- constantes declarativas e builders concretos devem viver em módulos semânticos próprios;
- watch/reload, parsing e composição operacional não pertencem ao barrel.
