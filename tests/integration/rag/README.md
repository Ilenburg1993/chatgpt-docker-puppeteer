# tests/integration/rag

**Propósito**: Testes de integração do sistema RAG — fluxo completo de indexação, busca e tratamento de erros.  
**Status**: Canônico.  
**Público**: Desenvolvedores do sistema RAG (`tools/rag/`).  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `test_rag_end_to_end.spec.js` | Pipeline RAG completo: indexação → busca → resposta |
| `test_multi_llm_integration.spec.js` | RAG com múltiplos providers de LLM |
| `test_rag_errors.spec.js` | Tratamento de erros no pipeline RAG |

## Regras de manutenção

- Usar fixtures de `tests/fixtures/rag/` como base de documentos.
- Não conectar a Ollama real — usar cliente mock ou servidor local.

## Links relacionados

- Testes de integração: `tests/integration/README.md`
- Testes unitários RAG: `tests/unit/rag/`
- Sistema RAG: `tools/rag/`
