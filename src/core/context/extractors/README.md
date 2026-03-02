# src/core/context/extractors

**Propósito**: Extratores de conteúdo estruturado do contexto — código e JSON.  
**Status**: Canônico.  
**Público**: Mantenedores do sistema de contexto LLM.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `code_logic.js`: extração de blocos de código do contexto.
- `json_logic.js`: extração e validação de estruturas JSON do contexto.

## O que não deve ficar aqui

- Motor de montagem do contexto → `src/core/context/engine/`
- Transformadores de saída → `src/core/context/transformers/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `code_logic.js` | Extrai blocos de código de conteúdo de contexto |
| `json_logic.js` | Extrai e valida JSON de conteúdo de contexto |

## Regras de manutenção

- Extratores devem ser funções puras sem efeitos colaterais.
- Novos formatos de extração recebem arquivo dedicado.

## Links relacionados

- Módulo pai: `src/core/context/`
