# tools

**Propósito**: Ferramentas auxiliares externas ao runtime do produto — RAG, MCP, Ollama, análise de
projeto e geração de skills.  
**Status**: Canônico de apoio.  
**Público**: Desenvolvedores e o Audit Agent.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Tooling auxiliar que suporta desenvolvimento, auditoria e operações, mas não faz parte do runtime
  `src/`.

## O que não deve ficar aqui

- Código de produção → `src/`.
- Scripts de automação → `scripts/`.

## Entradas principais

| Arquivo/Pasta              | Descrição                                           |
| -------------------------- | --------------------------------------------------- |
| `bin/`                     | Binários auxiliares (gitleaks)                      |
| `mcp/`                     | Servidor MCP unificado para desenvolvimento         |
| `ollama/`                  | Cliente Ollama auxiliar                             |
| `outputs/`                 | Saídas geradas por ferramentas de análise           |
| `rag/`                     | Sistema RAG completo (indexação, busca, embeddings) |
| `generate_skills_index.js` | Gera índice de skills disponíveis                   |
| `mapeador_projeto.py`      | Mapeador de estrutura do projeto (Python)           |
| `skills_sync.sh`           | Sincroniza skills com o catálogo                    |

## Links relacionados

- RAG: `tools/rag/README.md`
- Hub de documentação: `DOCUMENTAÇÃO/`
