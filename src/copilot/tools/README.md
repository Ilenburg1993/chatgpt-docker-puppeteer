# tools/

**Camada**: L3 — definição e registro de custom tools do agente.

Cada tool é uma função registrada no SDK que o agente pode chamar durante o diálogo.

## Subdomínios

| Diretório/Arquivo  | Responsabilidade                               |
| ------------------ | ---------------------------------------------- |
| `file/`            | Tools de leitura/escrita de arquivos           |
| `git/`             | Tools de operações git                         |
| `todo/`            | Tools de gestão de TODOs (CRUD, bulk, queries) |
| `shell/`           | Tools de execução de comandos shell            |
| `web-tools.js`     | Fetch de URLs (anti-SSRF)                      |
| `code-tools.js`    | Análise de código                              |
| `session-tools.js` | Gestão de sessão                               |
| `hook-tools.js`    | Interação com hooks                            |
| `hub-tools.js`     | Interação com conversation hub                 |
| `tool-factory.js`  | Factory de registro de tools no SDK            |
| `index.js`         | Barrel de exportação                           |

## Regras de importação

- **Pode importar**: `core/`, `config/`, `observability/`, `sdk/`, `bridges/`
- **NÃO pode importar**: `agent/` (tools são registradas pelo agent, não o contrário)
