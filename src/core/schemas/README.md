# src/core/schemas

**Propósito**: Schemas Zod para validação de dados centrais — tarefas, DNA, bootstrap e tipos
compartilhados.  
**Status**: Canônico.  
**Público**: Todos os módulos que produzem ou consomem dados de tarefa, missão e configuração.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Schema de bootstrap do sistema (`bootstrap_state_schema.js`).
- Schema de DNA do agente (`dna_schema.js`).
- Schema de tarefas versão atual e v5 (`task_schema.js`, `task_schema_v5.js`).
- Migração entre versões de schema (`migrator_v4_to_v5.js`).
- Núcleo de schemas reutilizável (`schema_core.js`).
- Tipos compartilhados (`shared_types.js`).
- Healer de tarefas corrompidas (`task_healer.js`).

## O que não deve ficar aqui

- Validadores com lógica de negócio → `src/core/validators/`
- Schemas específicos de servidor → `src/server/`
- Tipos TypeScript puros → `src/types/`

## Entradas principais

| Arquivo                     | Descrição                               |
| --------------------------- | --------------------------------------- |
| `task_schema.js`            | Schema canônico de tarefas              |
| `task_schema_v5.js`         | Schema de tarefas versão 5              |
| `dna_schema.js`             | Schema do DNA do agente                 |
| `bootstrap_state_schema.js` | Schema de estado de bootstrap           |
| `schema_core.js`            | Primitivos e utilitários de schema      |
| `shared_types.js`           | Tipos Zod compartilhados                |
| `migrator_v4_to_v5.js`      | Migração de tarefas v4 → v5             |
| `task_healer.js`            | Correção de tarefas com dados inválidos |

## Regras de manutenção

- Toda mudança no schema de tarefa exige versão e migrator correspondente.
- Use `schema_core.js` para primitivos reutilizáveis.

## Links relacionados

- Módulo pai: `src/core/`
- Validadores: `src/core/validators/`
- Tipos: `src/types/`
