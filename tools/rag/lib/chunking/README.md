# tools/rag/lib/chunking

**Propósito**: Módulos de divisão de documentos em chunks para indexação RAG — suporte a código JS,
Markdown e texto puro.  
**Status**: Canônico.  
**Público**: Desenvolvedores do sistema RAG.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo                | Descrição                                                     |
| ---------------------- | ------------------------------------------------------------- |
| `chunk_dispatcher.mjs` | Dispatcher — seleciona o chunker adequado por tipo de arquivo |
| `chunk_js_ast.mjs`     | Chunking de JavaScript via AST                                |
| `chunk_code.mjs`       | Chunking genérico de código                                   |
| `chunk_md.mjs`         | Chunking de documentos Markdown                               |
| `chunk_plain.mjs`      | Chunking de texto puro                                        |
| `merge_ranges.mjs`     | Mescla intervalos de chunks sobrepostos                       |

## Links relacionados

- RAG lib: `tools/rag/lib/README.md`
- Testes: `tests/unit/rag/test_chunking.spec.js`
