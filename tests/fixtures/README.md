# tests/fixtures

**Propósito**: Dados estáticos de fixtures usados nos testes — configurações, identidades,
respostas, tarefas e exemplos para MCP e RAG.  
**Status**: Canônico.  
**Público**: Todos os desenvolvedores que escrevem testes.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Fixtures JSON/TXT/JS organizados por domínio em subpastas.
- Dados válidos e inválidos para testes de validação e erro.

## O que não deve ficar aqui

- Mocks de módulos → `tests/mocks/`.
- Dados de produção ou segredos reais.
- Saídas geradas por testes (artefatos temporários).

## Entradas principais

| Pasta        | Descrição                                     |
| ------------ | --------------------------------------------- |
| `config/`    | Fixtures de configuração válida e inválida    |
| `dna/`       | Fixtures de identidade do agente              |
| `mcp/`       | Servidor MCP de exemplo para testes           |
| `rag/`       | Amostras de documentos para testes de RAG     |
| `responses/` | Respostas de IA simuladas                     |
| `tasks/`     | Tarefas válidas e inválidas (ChatGPT, Gemini) |

## Regras de manutenção

- Nomes no formato `<nome>.<tipo>.fixture.<ext>` (ex: `config-valido.fixture.json`).
- Nunca incluir dados sensíveis ou credenciais reais.
- Fixtures compartilhados por múltiplos suítes ficam aqui; fixtures específicos ficam junto ao
  teste.

## Links relacionados

- Hub de testes: `tests/README.md`
- Mocks: `tests/mocks/`
