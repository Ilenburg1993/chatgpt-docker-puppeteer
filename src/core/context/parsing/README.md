# src/core/context/parsing

**Propósito**: Parsing de referências e estruturas do contexto LLM.  
**Status**: Canônico.  
**Público**: Mantenedores do sistema de contexto LLM.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `ref_parser.js`: parsing de referências a arquivos, funções e símbolos no contexto.

## O que não deve ficar aqui

- Extratores de código ou JSON → `src/core/context/extractors/`
- Transformadores de saída → `src/core/context/transformers/`

## Entradas principais

| Arquivo         | Descrição                                                   |
| --------------- | ----------------------------------------------------------- |
| `ref_parser.js` | Faz parsing de referências de contexto (arquivos, símbolos) |

## Regras de manutenção

- Parser deve ser stateless e determinístico.

## Links relacionados

- Módulo pai: `src/core/context/`
