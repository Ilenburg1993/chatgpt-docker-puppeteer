**Status**: Canônico de apoio.  
**Escopo**: aprofundamento da camada `src/infra/db/` e do SSOT SQLite.  
**Quando consultar**: ao alterar schema, repositórios, locks em nível de task, RBAC, eventos SSOT ou
persistência de auditoria/inferência.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# INFRA DB

**Propósito**: documentar `src/infra/db/` como núcleo de persistência transacional do runtime.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção, auditoria e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/infra/db/` é a materialização do SSOT do sistema. Essa trilha define:

- onde o runtime persiste estado durável;
- como o schema evolui;
- como tasks, missões, eventos e tentativas são lidos e mutados;
- como domínios auxiliares (auditoria, inferência, RBAC e preferências) compartilham a mesma base.

Ela não é apenas um "acesso a SQLite". É o contrato de consistência entre `agent`, `kernel`,
`missions`, `server`, `audit_agent` e `inference_gateway`.

## Componentes estruturais

### `sqlite.js`

É a porta de entrada soberana da conexão com o banco.

Responsabilidades:

- resolver o caminho físico via `MAESTRO_DB_PATH`, `DB_PATH`, config ou fallback em `data/`;
- abrir um singleton `better-sqlite3`;
- aplicar pragmas de concorrência (`WAL`, `synchronous = NORMAL`, `foreign_keys = ON`,
  `busy_timeout`);
- executar migrations pendentes;
- expor `getDb()`, `closeDb()` e `resolveDbPath()`.

Regra prática: quem precisa do banco deve passar por `getDb()`, não abrir conexões paralelas.

### `migrations.js`

É a trilha de evolução do schema.

Responsabilidades:

- manter migrations append-only;
- garantir que cada versão seja idempotente;
- criar e expandir tabelas sem quebrar instalações existentes.

O baseline observável já cobre:

- `schema_migrations`;
- `missions`;
- `tasks`;
- `task_dependencies`;
- `events`;
- `artifacts`;
- `task_attempts`;
- extensões incrementais para bloqueios, artifacts derivados e metadados adicionais.

## Famílias de repositório

### Núcleo operacional

- `task_repo.js`: CRUD de tasks, estágios/status, claim/release de locks, retries e limpeza de fila.
- `task_attempt_repo.js`: tentativa por dispatch/correlation, heartbeat, status de execução e erro.
- `events_repo.js`: trilha de eventos SSOT consumida pelo realtime.
- `mission_repo.js`: CRUD e estado de missões.
- `mission_step_repo.js`: granularidade de etapas dentro da missão.

Esses arquivos sustentam o plano principal do runtime.

### Artifacts e rastreabilidade

- `artifact_repo.js`: metadata de artifacts persistidos fora do banco.
- `audit_diff_repo.js`
- `audit_finding_repo.js`
- `audit_job_repo.js`
- `audit_job_run_repo.js`
- `audit_patch_repo.js`
- `audit_watch_rule_repo.js`

Essa família conecta o SSOT operacional à malha de auditoria e remediação.

### Controle e segurança

- `control_operation_repo.js`: trilha de operações de controle com idempotência e diff.
- `rbac_repo.js`: usuários, papéis, permissões e bootstrap por ambiente.
- `token_blocklist.js`: invalidação/expiração de tokens.
- `user_pref_repo.js`: preferências persistidas do usuário.

Essa camada dá sustentação ao `server` e ao dashboard administrativo.

### Inferência e serviços auxiliares

- `inference_backend_repo.js`
- `inference_model_repo.js`
- `inference_profile_repo.js`
- `inference_client_policy_repo.js`

Ela ancora a configuração persistida do `src/inference_gateway/`.

### Compatibilidade e importação

- `legacy_import.js`: migração de filas legadas em disco para o SSOT atual.
- `diagnostic_job_repo.js`: jobs de diagnóstico e relatórios auxiliares.

## Contratos estruturais importantes

### `task_repo.js`

É o repositório mais crítico da trilha.

Responsabilidades observáveis:

- normalizar task V5 ou legado antes de persistir;
- espelhar `stage` e `status` do banco na visão carregada da task;
- operar paginação segura;
- fazer claim transacional da próxima task elegível;
- manter `execute_after_ms`, contadores de `attempts`, locks, `blocked_reason` e timestamps.

Qualquer mudança de semântica em task precisa avaliar este arquivo antes de alterar kernel, workers
ou API.

### `events_repo.js`

É a base do feed SSOT e da reconciliação externa.

Responsabilidades:

- registrar eventos imutáveis;
- preservar ordenação por `id` autoincremental;
- permitir consumo incremental por cursores (`last_event_id`).

O `server/realtime/ssot_event_feed.js` depende diretamente deste contrato.

### `rbac_repo.js`

Acopla autenticação e autorização persistidas ao server.

Responsabilidades:

- definir matriz papel -> permissão;
- normalizar username e hashing de senha;
- fazer bootstrap inicial por variáveis de ambiente;
- validar credenciais.

## Fluxos principais

### Boot do SSOT

1. Um processo chama `getDb()`.
2. `sqlite.js` resolve o caminho físico.
3. O singleton é aberto.
4. Pragmas de concorrência são aplicados.
5. `migrations.js` reconcilia o schema.
6. Os repositórios passam a operar sobre a mesma conexão.

### Dispatch e execução de task

1. Workers ou serviços consultam/filtram tasks.
2. `task_repo.js` faz claim com lock e TTL.
3. O runtime atualiza status e attempts.
4. `task_attempt_repo.js` registra a tentativa vinculada ao correlation id.
5. `events_repo.js` registra os eventos observáveis da transição.

### Consumo de realtime

1. Mutações persistem eventos em `events`.
2. O feed SSOT lê `events` em ordem crescente.
3. O dashboard recebe batches consistentes, sem depender de memória local do processo.

## Relação com outros subsistemas

### Infra DB x Agent

- workers dependem de locks, status e claiming corretos;
- o plano operacional em `src/agent/` é tão confiável quanto o SSOT que o alimenta.

### Infra DB x Kernel

- o kernel reage ao estado persistido, não a uma fila informal em memória;
- divergência entre transição técnica e persistida deve ser tratada como bug estrutural.

### Infra DB x Server

- a API e o dashboard leem e mutam estado via serviços que terminam nesta trilha;
- o realtime também depende dela para replay e continuidade.

## Restrições e guardrails

- Não abrir conexões SQLite paralelas fora de `sqlite.js`.
- Não modificar schema "na mão" fora de `migrations.js`.
- Não introduzir atalho que contorne repositórios em mutações críticas.
- Migrations devem continuar append-only e idempotentes.
- O banco continua sendo o SSOT; caches e snapshots em memória são derivados.

## Sinais operacionais a investigar

- crescimento de `database is locked` apesar de `busy_timeout`;
- `schema_migrations` divergente entre ambientes;
- tasks presas com `lock_expires_at_ms` vencido;
- eventos faltando ou `last_event_id` parado;
- inconsistência entre `tasks.latest_attempt_id` e `task_attempts`.

## Referências no código

- `src/infra/db/sqlite.js`
- `src/infra/db/migrations.js`
- `src/infra/db/task_repo.js`
- `src/infra/db/task_attempt_repo.js`
- `src/infra/db/events_repo.js`
- `src/infra/db/mission_repo.js`
- `src/infra/db/mission_step_repo.js`
- `src/infra/db/rbac_repo.js`
- `src/infra/db/control_operation_repo.js`
