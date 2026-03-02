# src/core/context/transformers

**Propósito**: Transformadores de conteúdo do contexto LLM — identidade, metadados e resumo.  
**Status**: Canônico.  
**Público**: Mantenedores do sistema de contexto LLM.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `identity.js`: transformações relacionadas à identidade do agente no contexto.
- `metadata.js`: enriquecimento com metadados de tarefa e sessão.
- `summary.js`: geração de resumos comprimidos do contexto.

## O que não deve ficar aqui

- Extratores → `src/core/context/extractors/`
- Controle de limites → `src/core/context/limits/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `identity.js` | Adiciona informações de identidade do agente ao contexto |
| `metadata.js` | Enriquece o contexto com metadados de tarefa e sessão |
| `summary.js` | Gera resumos comprimidos do histórico de contexto |

## Regras de manutenção

- Transformadores devem ser funções puras que recebem e retornam o contexto.

## Links relacionados

- Módulo pai: `src/core/context/`
