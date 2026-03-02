# src/infra/db

**Propósito**: Banco de dados SQLite e repositórios de dados — persiste tarefas, missões, auditorias, inferências e configurações de usuário.  
**Status**: Canônico.  
**Público**: Módulos que precisam de persistência relacional; mantenedores de schema de banco de dados.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Núcleo SQLite (`sqlite.js`) e migrations (`migrations.js`).
- Repositórios de tarefas, missões e passos (`task_repo.js`, `task_attempt_repo.js`, `mission_repo.js`, `mission_step_repo.js`).
- Repositórios de auditoria (`audit_job_repo.js`, `audit_finding_repo.js`, `audit_patch_repo.js`, etc.).
- Repositórios de inferência (`inference_model_repo.js`, `inference_profile_repo.js`, etc.).
- Repositórios de controle e eventos (`control_operation_repo.js`, `events_repo.js`).
- Repositórios de RBAC e usuários (`rbac_repo.js`, `user_pref_repo.js`, `token_blocklist.js`).
- Importação legada (`legacy_import.js`).

## O que não deve ficar aqui

- Storage de arquivos e artefatos → `src/infra/storage/`
- Cache em memória → `src/infra/queue/cache.js`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `sqlite.js` | Conexão e utilitários SQLite |
| `migrations.js` | Gerenciamento de migrações do schema |
| `task_repo.js` | Repositório de tarefas |
| `mission_repo.js` | Repositório de missões |
| `audit_job_repo.js` | Repositório de jobs de auditoria |
| `inference_model_repo.js` | Repositório de modelos de inferência |

## Regras de manutenção

- Toda mudança de schema requer migration versionada em `migrations.js`.
- Repositórios não devem conter lógica de negócio; apenas CRUD.

## Links relacionados

- Módulo pai: `src/infra/`
- Storage de arquivos: `src/infra/storage/`
