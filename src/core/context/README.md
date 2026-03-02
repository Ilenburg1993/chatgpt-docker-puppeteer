# src/core/context

**Propósito**: Motor de gerenciamento da janela de contexto para LLMs — extração, parsing, transformação e controle de limites de tokens.  
**Status**: Canônico.  
**Público**: Módulos que constroem prompts e gerenciam contexto para chamadas a LLMs.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Motor principal de contexto (`context_core.js`).
- Engine de processamento (`engine/`).
- Extratores de conteúdo (`extractors/`).
- Controle de orçamento e guardrails de tokens (`limits/`).
- Parsing de referências e estruturas (`parsing/`).
- Transformadores de conteúdo (`transformers/`).

## O que não deve ficar aqui

- Chamadas diretas a APIs de LLM → `src/inference_gateway/`
- Schemas de tarefas → `src/core/schemas/`
- Lógica de missão → `src/missions/`

## Entradas principais

| Arquivo/Pasta | Descrição |
|---|---|
| `context_core.js` | Núcleo do sistema de gerenciamento de contexto |
| `engine/` | Motor de processamento do contexto |
| `extractors/` | Extratores de código e JSON do contexto |
| `limits/` | Gerenciamento de orçamento e guardrails de tokens |
| `parsing/` | Parsing de referências e estruturas de contexto |
| `transformers/` | Transformadores de identidade, metadados e resumo |

## Regras de manutenção

- Não acesse LLMs diretamente aqui; use `src/inference_gateway/`.
- Mantenha cada sub-responsabilidade isolada em sua subpasta.

## Links relacionados

- Módulo pai: `src/core/`
- Gateway de inferência: `src/inference_gateway/`
