# scripts/health

**Propósito**: Scripts de verificação de saúde do sistema — Chrome, LSP, MCP, endpoints e
diagnóstico geral.  
**Status**: Canônico.  
**Público**: Desenvolvedores e operações.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo                    | Descrição                                        |
| -------------------------- | ------------------------------------------------ |
| `healthcheck.js`           | Healthcheck principal do sistema                 |
| `check-chrome.js`          | Verifica conexão com Chrome externo (porta 9224) |
| `diagnose-lsp.mjs`         | Diagnóstico do servidor LSP (tsserver)           |
| `diagnose-mcp.mjs`         | Diagnóstico dos servidores MCP upstream          |
| `doctor.sh`                | Script shell de diagnóstico completo             |
| `health-posix.sh`          | Healthcheck para sistemas POSIX                  |
| `health-windows.ps1`       | Healthcheck para Windows (PowerShell)            |
| `test-health-endpoints.sh` | Testa endpoints `/health` da API                 |
| `test-health-logic.js`     | Testa lógica de healthcheck                      |

## Regras de manutenção

- Usar `npm run diagnose` como entrada principal.
- Scripts shell devem passar no `shellcheck`.

## Links relacionados

- Scripts pai: `scripts/README.md`
- Saúde RAG: `npm run rag:health`
- Saúde LSP: `npm run lsp:health`
