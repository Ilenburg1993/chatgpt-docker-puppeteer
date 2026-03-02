# src/driver/extractors

**Propósito**: Extratores de conteúdo estruturado da página web — recupera dados parseados após interações de browser.  
**Status**: Canônico.  
**Público**: Mantenedores de drivers e processadores de resposta de LLM.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `structured_extractor.js`: extração de dados estruturados (JSON, código, texto) do DOM da página.

## O que não deve ficar aqui

- Extratores de contexto LLM → `src/core/context/extractors/`
- Parsing de respostas de API → `src/infra/storage/response_adapter.js`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `structured_extractor.js` | Extrai conteúdo estruturado do DOM após interação com LLM |

## Regras de manutenção

- Extratores devem ser tolerantes a falhas de DOM e retornar `null` em caso de erro.

## Links relacionados

- Módulo pai: `src/driver/`
