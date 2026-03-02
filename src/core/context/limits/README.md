# src/core/context/limits

**Propósito**: Controle de orçamento de tokens e guardrails da janela de contexto LLM.  
**Status**: Canônico.  
**Público**: Mantenedores do sistema de contexto LLM.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `budget_manager.js`: gerenciamento do orçamento de tokens disponíveis.
- `guardrails.js`: regras de proteção e limites máximos da janela de contexto.

## O que não deve ficar aqui

- Lógica de extração de conteúdo → `src/core/context/extractors/`
- Configuração de modelos LLM → `src/inference_gateway/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `budget_manager.js` | Gerencia o orçamento de tokens da janela de contexto |
| `guardrails.js` | Aplica limites e proteções à janela de contexto |

## Regras de manutenção

- Limites de tokens devem ser configuráveis via `config.json`, não hardcoded.

## Links relacionados

- Módulo pai: `src/core/context/`
