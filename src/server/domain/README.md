# src/server/domain

**Propósito**: Serviços de domínio do servidor — implementam lógica de negócio acessada pelos
controllers da API.  
**Status**: Canônico.  
**Público**: Mantenedores dos controllers e da lógica de servidor.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `task_control_service.js`: serviço de controle de tarefas.
- `mission_control_service.js`: serviço de controle de missões.
- `control_command_service.js`: serviço de comandos de controle do sistema.
- `rbac_policy.js`: políticas de controle de acesso baseado em papéis.

## O que não deve ficar aqui

- Controllers HTTP → `src/server/api/controllers/`
- Lógica de domínio de missões → `src/missions/`
- Persistência → `src/infra/db/`

## Entradas principais

| Arquivo                      | Descrição                                  |
| ---------------------------- | ------------------------------------------ |
| `task_control_service.js`    | Lógica de negócio para controle de tarefas |
| `mission_control_service.js` | Lógica de negócio para controle de missões |
| `control_command_service.js` | Serviço de comandos de controle do sistema |
| `rbac_policy.js`             | Políticas de RBAC para autorização         |

## Regras de manutenção

- Serviços de domínio não devem acessar `req`/`res` HTTP diretamente.
- Persistência deve ser via repositórios de `src/infra/db/`.

## Links relacionados

- Módulo pai: `src/server/`
- Controllers: `src/server/api/controllers/`
- Middleware RBAC: `src/server/middleware/authorize.js`
