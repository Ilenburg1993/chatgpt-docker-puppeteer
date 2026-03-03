# tests/manual

**Propósito**: Testes que requerem interação humana ou ambiente real (browser, Chrome conectado) —
não executados em CI automatizado.  
**Status**: Especializado.  
**Público**: Desenvolvedores realizando diagnóstico e validação local.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Scripts de teste manual para browser pool, conexão Chrome, proxy e MCP/Ollama.
- Specs de kernel que requerem lock e controle manual de estado.

## O que não deve ficar aqui

- Testes automatizáveis → migrar para `tests/integration/` ou `tests/unit/`.

## Entradas principais

| Arquivo/Pasta                      | Descrição                                            |
| ---------------------------------- | ---------------------------------------------------- |
| `kernel/`                          | Specs manuais de pausa, lock e recuperação do kernel |
| `test_browser_pool.js`             | Teste manual do pool de browser                      |
| `test_chrome_connection.js`        | Teste de conexão com Chrome externo                  |
| `test_chrome_proxy_integration.js` | Integração manual com proxy Chrome                   |
| `test_connection_orchestrator.js`  | Teste manual do orquestrador de conexões             |
| `test_mcp_ollama.sh`               | Teste shell de integração MCP + Ollama               |
| `test_ollama_timeouts.js`          | Teste manual de timeouts do Ollama                   |
| `test_puppeteer_launcher.js`       | Teste do launcher Puppeteer                          |

## Regras de manutenção

- Documentar pré-condições necessárias (Chrome rodando, Ollama disponível, etc.).
- Não referenciar em `npm test` ou CI workflows.

## Links relacionados

- Hub de testes: `tests/README.md`
- Testes legados: `tests/legacy/`
