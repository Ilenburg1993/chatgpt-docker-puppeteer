# tests/fixtures/rag

**Propósito**: Amostras de documentos e dados para testes do sistema RAG (Retrieval-Augmented Generation).  
**Status**: Canônico.  
**Público**: Desenvolvedores de testes RAG.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Documentos de exemplo em múltiplos formatos (JS, JSON, Markdown) para testes de indexação e recuperação.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `sample.js` | Documento JavaScript de exemplo para chunking e indexação |
| `sample.json` | Documento JSON de exemplo |
| `sample.md` | Documento Markdown de exemplo |

## Regras de manutenção

- Documentos devem ser mínimos — apenas o suficiente para testar o pipeline RAG.
- Não incluir código real do projeto como fixture (evitar falsos positivos em busca semântica).

## Links relacionados

- Fixtures pai: `tests/fixtures/README.md`
- Testes RAG unitários: `tests/unit/rag/`
- Testes RAG integração: `tests/integration/rag/`
- Sistema RAG: `tools/rag/`
