# src/server/api/utils

**Propósito**: Utilitários da API REST — envelope de respostas e views de tarefas.  
**Status**: Canônico.  
**Público**: Mantenedores de controllers e integrações da API.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `api_envelope.js`: padroniza o formato de resposta da API (envelope JSON).
- `task_views.js`: views de tarefas para serialização de resposta.

## O que não deve ficar aqui

- Middlewares de validação → `src/server/middleware/`
- Lógica de domínio → `src/server/domain/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `api_envelope.js` | Formato padronizado de envelope de resposta API |
| `task_views.js` | Serialização de tarefas para respostas da API |

## Regras de manutenção

- Todo response body deve usar `api_envelope.js`.

## Links relacionados

- Módulo pai: `src/server/api/`
