# src/core/context/engine

**Propósito**: Motor de processamento do contexto — orquestra a montagem e compressão da janela de
contexto para LLMs.  
**Status**: Canônico.  
**Público**: Mantenedores do sistema de contexto LLM.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `context_engine.js`: lógica central de montagem e gerenciamento da janela de contexto.

## O que não deve ficar aqui

- Extratores de conteúdo específico → `src/core/context/extractors/`
- Controle de limites de tokens → `src/core/context/limits/`
- Parsing de referências → `src/core/context/parsing/`

## Entradas principais

| Arquivo             | Descrição                                         |
| ------------------- | ------------------------------------------------- |
| `context_engine.js` | Motor de montagem da janela de contexto para LLMs |

## Regras de manutenção

- Mantenha a engine desacoplada de qualquer LLM específico.
- Orquestre via chamadas para os submódulos de `context/`.

## Links relacionados

- Módulo pai: `src/core/context/`
