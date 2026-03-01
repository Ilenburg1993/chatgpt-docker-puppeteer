**Status**: Canônico de apoio.  
**Escopo**: aprofundamento da camada HTTP, realtime e supervisão do produto.  
**Quando consultar**: ao alterar rotas, dashboard API, socket hub, bridge NERV do servidor ou serviços de controle expostos externamente.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# SERVER

**Propósito**: documentar `src/server/` como a superfície externa do runtime.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção, auditoria e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/server/` expõe o sistema para fora do loop principal:

- API HTTP;
- dashboard API;
- realtime via Socket.io;
- supervisão e watchers;
- ponte entre dashboard e NERV.

Essa camada não substitui o runtime principal, mas é a principal interface humana e programática do
produto.

## Estrutura interna de `src/server/`

### `main.js`

É o bootstrap do processo de servidor.

Responsabilidades:

- inicializar lifecycle do servidor;
- bind do engine HTTP;
- persistir estado de descoberta do processo server;
- montar socket hub, NERV local e `ServerNERVAdapter`;
- carregar rotas e watchers;
- publicar readiness e coordenar shutdown.

### `engine/`

É a infraestrutura local do processo server.

Peças principais:

- `app.js`: composição do app Express e recursos compartilhados;
- `server.js`: bind do servidor HTTP;
- `socket.js`: hub Socket.io, autenticação, CORS, rooms e batching de updates;
- `lifecycle.js`: coordenação de sinais e shutdown.

### `api/router.js`

É a topologia principal da API.

Responsabilidades observáveis:

- instalar timeout global de request;
- bloquear métodos mutantes em modo delegated;
- registrar endpoints de saúde;
- instalar métricas;
- montar domínios de rota.

Domínios explícitos já presentes:

- `/api/health*`
- `/api/metrics`
- `/api/tasks`, `/api/queue`, `/api/results`, `/api/artifacts`
- `/api/system`
- `/api/config`
- `/api/missions`
- `/api/control`
- `/api/dashboard`
- `/api/rag`
- `/api/mcp` (quando habilitado)

Isso significa que `server` é, de fato, uma fachada multi-domínio do runtime.

### `api/controllers/`

Concentra controllers por domínio de API. É onde a topologia exposta em `router.js` delega o
trabalho.

### `dashboard-api/`

É a camada específica do dashboard operacional.

Peças principais:

- `task_sync_bridge.js`
- `telemetry_aggregator.js`

Função:

- consolidar dados de task e telemetria para a UI.

### `domain/`

É a camada de domínio exposta pelo servidor para controle operacional.

Peças principais:

- `task_control_service.js`
- `mission_control_service.js`
- `control_command_service.js`
- `rbac_policy.js`

Responsabilidades:

- encapsular mutações controladas de task e missão;
- aplicar guardrails de status, versão e permissão;
- separar regra de negócio da borda HTTP.

Aprofundamento específico: [SERVER_DOMAIN.md](./SERVER_DOMAIN.md).

### `middleware/`

Middlewares de segurança, autorização e integridade.

Peças principais:

- `auth.js`
- `authorize.js`
- `deny_if_delegated.js`
- `request_id.js`
- `schema_guard.js`
- `error_handler.js`

Função:

- blindar a borda HTTP antes que controllers e serviços de domínio executem.

Aprofundamento específico: [SERVER_MIDDLEWARE.md](./SERVER_MIDDLEWARE.md).

### `nerv_adapter/server_nerv_adapter.js`

É a bridge entre NERV e dashboard/socket.

Responsabilidades:

- retransmitir eventos NERV públicos ao dashboard;
- receber comandos do dashboard e traduzi-los para comandos NERV;
- filtrar eventos privados;
- rastrear estatísticas de broadcast, comandos e clientes.

### `realtime/`

Camada de tempo real e feed operacional.

Peças observáveis:

- `ssot_event_feed.js`
- `bus/`
- `streams/`
- `telemetry/`

Função:

- transmitir o estado do sistema de forma contínua para consumers externos.

Aprofundamento específico: [SERVER_REALTIME.md](./SERVER_REALTIME.md).

### `supervisor/`

Supervisão e remediação.

Peças principais:

- `reconcilier.js`
- `remediation.js`

### `watchers/`

Watchers de FS e logs.

Peças principais:

- `fs_watcher.js`
- `log_watcher.js`

Função:

- observar sinais físicos do ambiente e disparar notificações rápidas.

Aprofundamento específico: [SERVER_WATCHERS.md](./SERVER_WATCHERS.md).

### `handlers/`

Handlers de integração expostos pelo servidor.

Peças observáveis:

- `mcp-handler.js`
- `openai-handler.js`
- `openai-transformer.js`

Função:

- expor protocolos especializados e camadas de compatibilidade de integração.

Aprofundamento específico: [SERVER_HANDLERS.md](./SERVER_HANDLERS.md).

## Fluxos principais

### Fluxo HTTP

1. O request entra pelo engine Express.
2. Middlewares aplicam timeout, auth, guards e `request_id`.
3. O router resolve o domínio.
4. Controllers e serviços de domínio processam a operação.
5. A resposta volta ao cliente com observabilidade e error handling padronizados.

### Fluxo dashboard realtime

1. O socket hub autentica e conecta o cliente.
2. O cliente entra na malha de rooms do dashboard.
3. `ServerNERVAdapter` retransmite eventos públicos do NERV.
4. O dashboard recebe updates batch, telemetria e estado.

### Fluxo dashboard -> runtime

1. O dashboard emite comando.
2. `ServerNERVAdapter` normaliza o payload.
3. O comando é traduzido para `ActionCode` adequado.
4. O envelope é publicado no NERV.

## Relação com outros subsistemas

### Server x NERV

- `ServerNERVAdapter` é a borda principal entre a camada externa e o barramento.

### Server x Infra

- O server depende de DB, RBAC, token blocklist, telemetry e suporte de runtime.

### Server x Agent/Kernel

- O server observa e controla o runtime, mas não substitui o loop principal nem o motor de
  execução.

## Restrições e guardrails

- O modo delegated deve continuar bloqueando mutações onde o contrato exigir.
- O server não deve expor eventos privados do NERV ao dashboard.
- O socket hub deve continuar respeitando autenticação, CORS e política de comando.

## Dívida e observações estruturais

- `reconcilier.js` mantém a grafia atual da árvore, mas é parte válida do subsistema até eventual
  correção nominal.
- O servidor concentra múltiplos domínios (`system`, `control`, `missions`, `rag`, `mcp`); isso
  exige atenção à separação entre borda HTTP e regra de domínio.

## Referências no código

- `src/server/main.js`
- `src/server/engine/app.js`
- `src/server/engine/server.js`
- `src/server/engine/socket.js`
- `src/server/api/router.js`
- `src/server/domain/task_control_service.js`
- `src/server/domain/mission_control_service.js`
- `src/server/nerv_adapter/server_nerv_adapter.js`
- `src/server/dashboard-api/task_sync_bridge.js`
- `src/server/dashboard-api/telemetry_aggregator.js`
- `src/server/middleware/schema_guard.js`
- `src/server/handlers/mcp-handler.js`
- `src/server/realtime/ssot_event_feed.js`
- `src/server/supervisor/reconcilier.js`
- `src/server/watchers/fs_watcher.js`
