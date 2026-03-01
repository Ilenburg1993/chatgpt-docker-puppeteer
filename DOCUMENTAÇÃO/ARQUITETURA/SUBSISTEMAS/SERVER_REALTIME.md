**Status**: Canônico de apoio.  
**Escopo**: aprofundamento da subtrilha `src/server/realtime/`.  
**Quando consultar**: ao alterar feeds SSOT, streaming de logs, telemetria de hardware, bridge com PM2 ou broadcast contínuo para o dashboard.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# SERVER REALTIME

**Propósito**: documentar `src/server/realtime/` como plano de streaming contínuo do servidor.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção, observabilidade e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/server/realtime/` complementa a API HTTP. Em vez de responder requisições pontuais, essa
trilha:

- empurra estado incremental do SSOT;
- transmite eventos de processo;
- expõe log tail operacional;
- publica métricas de hardware em pulso contínuo.

Ela é o plano vivo do dashboard.

## Componentes principais

### `ssot_event_feed.js`

É o feed mais importante da trilha.

Responsabilidades:

- manter um cursor interno (`_lastEventId`) sobre a tabela `events`;
- consultar batches ordenados do SSOT;
- normalizar `payload_json`;
- descobrir task ids e mission ids afetados;
- emitir `ssot:events_batch` para a room `dashboards`;
- montar batches derivados de atualização de tasks e missões.

Características relevantes:

- polling com cadência configurável;
- lote com limite defensivo;
- opção de iniciar do começo ou do último evento conhecido;
- modo de compatibilidade para emissores legados (`DASHBOARD_EMIT_TASK_UPDATED_COMPAT`).

Este arquivo é a base do replay incremental do dashboard.

### `bus/pm2_bridge.js`

É a ponte entre o barramento do PM2 e o Socket Hub do servidor.

Responsabilidades:

- conectar ao daemon PM2 via `pm2Raw`;
- abrir o bus de `process:event`;
- filtrar apenas processos gerenciados (`agente-gpt`, `dashboard-web`, `chrome-proxy`);
- emitir snapshot inicial;
- publicar eventos críticos e métricas periódicas;
- fazer health check e auto-recuperação da ponte.

É um canal de supervisão de processo, não um orquestrador de runtime.

### `streams/log_tail.js`

É o streamer de telemetria textual.

Responsabilidades:

- vigiar `agente_current.log`;
- lidar com rotação física do arquivo;
- ler apenas a cauda recente (janela deslizante);
- emitir fragmentos via `notify('log_stream', ...)`.

Essa escolha evita ler arquivos grandes a cada mudança.

### `telemetry/hardware.js`

É o pulso periódico de hardware.

Responsabilidades:

- consultar `doctor.getHardwareMetrics()`;
- normalizar payload com compatibilidade entre versões de dashboard;
- emitir `sys_metrics` a cada ciclo;
- tratar falhas como não-críticas.

O intervalo atual observado é de 5 segundos.

## Fluxos principais

### Fluxo de eventos SSOT

1. O runtime persiste eventos em `events`.
2. `ssot_event_feed.js` consulta novos registros após `last_event_id`.
3. O feed normaliza o batch.
4. O Socket Hub publica os eventos na room do dashboard.
5. O frontend atualiza tarefas, missões e timelines em tempo quase real.

### Fluxo de eventos PM2

1. O PM2 emite `process:event`.
2. `pm2_bridge.js` filtra processos de interesse.
3. O bridge produz payload normalizado de status/uptime/CPU/memória.
4. O dashboard recebe snapshot, métricas ou alerta crítico.

### Fluxo de logs

1. O arquivo de log cresce.
2. O watcher detecta `change`.
3. O streamer lê apenas a cauda recente.
4. O chunk é emitido para consumidores conectados.

## Relação com outros subsistemas

### Server Realtime x Infra DB

- o feed SSOT depende diretamente da tabela `events`;
- essa trilha observa a fonte de verdade, não cria um estado paralelo.

### Server Realtime x Engine Socket

- `realtime/` produz payloads;
- `server/engine/socket.js` continua sendo o hub soberano de entrega.

### Server Realtime x Dashboard UI

- o dashboard consome essa trilha para refresh incremental;
- sem ela, a UI passa a depender de polling HTTP mais pesado e perde continuidade.

## Restrições e guardrails

- O feed não deve virar fonte de verdade; a autoridade continua no banco.
- A room `dashboards` e os contratos de evento precisam permanecer estáveis.
- O bridge de PM2 deve continuar observacional; ele não deve assumir controle dos processos.
- O log tail deve continuar defensivo em volume e tolerante à rotação.

## Sinais operacionais a investigar

- `last_event_id` parado apesar de mutações no sistema;
- crescimento de erro no parse de `payload_json`;
- quedas recorrentes do bus PM2;
- log watcher reiniciando em loop por rotação ou permissão;
- clientes conectados sem receber `sys_metrics`.

## Referências no código

- `src/server/realtime/ssot_event_feed.js`
- `src/server/realtime/bus/pm2_bridge.js`
- `src/server/realtime/streams/log_tail.js`
- `src/server/realtime/telemetry/hardware.js`
- `src/server/engine/socket.js`
