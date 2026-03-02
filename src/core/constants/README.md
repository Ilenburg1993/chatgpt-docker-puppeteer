# src/core/constants

**Propósito**: Constantes centralizadas do sistema, organizadas por domínio (browser, logging, tarefas e compartilhadas).  
**Status**: Canônico.  
**Público**: Todos os módulos do runtime.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Constantes de configuração de browser (`browser.js`).
- Constantes de logging (`logging.js`).
- Constantes relacionadas a tarefas (`tasks.js`).
- Constantes compartilhadas entre domínios (`shared.js`).
- Ponto de entrada unificado (`index.js`).

## O que não deve ficar aqui

- Valores configuráveis em runtime → `config.json`
- Schemas de validação → `src/core/schemas/`
- Variáveis de ambiente → `src/core/env_bootstrap.js`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `index.js` | Exporta todas as constantes centralizadas |
| `browser.js` | Constantes de browser e automação |
| `logging.js` | Níveis e categorias de log |
| `tasks.js` | Estados, tipos e limites de tarefas |
| `shared.js` | Constantes compartilhadas por múltiplos domínios |

## Regras de manutenção

- Nunca use strings mágicas no código; referencie constantes daqui.
- Adicione um arquivo novo por domínio quando o volume justificar.
- Exporte tudo via `index.js`.

## Links relacionados

- Módulo pai: `src/core/`
- Tipos correlatos: `src/types/core/`
