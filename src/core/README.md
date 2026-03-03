# src/core

**Propósito**: Núcleo da aplicação — configuração, logger, identidade, schemas, validadores,
constantes e políticas de inicialização.  
**Status**: Canônico.  
**Público**: Todos os módulos do runtime; mantenedores da fundação do sistema.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Carregamento e validação da configuração global (`config.js`).
- Logger centralizado (`logger.js`).
- Gerenciamento de identidade do robô (`identity_manager.js`).
- Schemas Zod para validação de dados (`schemas/`).
- Validadores de pré-condições (`validators/`).
- Constantes centralizadas (`constants/`).
- Contexto de janela de contexto para LLMs (`context/`).
- Políticas de resiliência e retry (`retry_policy.js`, `infra_failure_policy.js`).

## O que não deve ficar aqui

- Lógica de domínio de missões → `src/missions/`
- Automação de browser → `src/driver/`
- Lógica de execução de tarefas → `src/kernel/`
- Tipos TypeScript puros → `src/types/`

## Entradas principais

| Arquivo/Pasta                | Descrição                                          |
| ---------------------------- | -------------------------------------------------- |
| `config.js`                  | Carregamento e acesso à configuração global        |
| `logger.js`                  | Logger centralizado do sistema                     |
| `identity_manager.js`        | Gerenciamento de identidade e robot_id             |
| `constants/`                 | Constantes centralizadas por domínio               |
| `schemas/`                   | Schemas Zod para tarefas, DNA e bootstrap          |
| `validators/`                | Validadores de pré-condições                       |
| `context/`                   | Motor de gerenciamento de janela de contexto LLM   |
| `authority.js`               | Controle de autoridade e permissões                |
| `doctor.js`                  | Diagnóstico de saúde do ambiente                   |
| `env_bootstrap.js`           | Inicialização e validação de variáveis de ambiente |
| `forensics.js`               | Análise forense de falhas                          |
| `retry_policy.js`            | Política de retry para operações resilientes       |
| `boot_resilience_manager.js` | Gerenciamento de resiliência no boot               |
| `hardware.js`                | Informações de hardware do sistema                 |
| `memory.js`                  | Utilitários de gerenciamento de memória            |

## Regras de manutenção

- Este módulo é importado por praticamente todos os outros; evite dependências circulares.
- Novas constantes devem ir para `constants/` com arquivo dedicado por domínio.
- Novos schemas devem ir para `schemas/`.
- Não importe de `src/kernel/`, `src/driver/` ou `src/server/` aqui.

## Links relacionados

- Constantes: `src/core/constants/`
- Schemas: `src/core/schemas/`
- Contexto LLM: `src/core/context/`
- Tipos: `src/types/core/`
