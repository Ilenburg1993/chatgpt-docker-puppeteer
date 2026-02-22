# NERV — Neural Event Relay Vector

## Resumo

O `NERV` é o barramento de eventos do sistema: uma camada técnica para transporte e roteamento de
"envelopes" IPC entre subsistemas (Kernel, Driver, Server, Infra). Ele é intencionalmente projetado
como uma fronteira técnica — não toma decisões de negócio, não interpreta payloads e não drena
buffers automaticamente.

## Responsabilidades principais

- Construir e expor a interface de emissão/recepção de envelopes (`emit`, `receive`, `onEvent`,
  `onActor`).
- Fornecer transporte físico (local in-process e/ou remoto via Socket.io) através de
  `hybridTransport`.
- Manter observabilidade técnica (telemetria e `health`).
- Gerenciar buffers inbound/outbound (exposição apenas; sem auto-drain).

## Arquitetura e módulos internos

- `src/nerv/nerv.js`: fábrica principal — função `createNERV(config)` que monta e retorna a API
  pública.
- `transport/`: camada física (framing, connection, reconnect) e `hybrid_transport.js`
  (EventEmitter + Socket.io).
- `emission/`: emissores (`emitCommand`, `emitEvent`, `emitAck`) que empurram envelopes para
  `buffers`/transport.
- `reception/`: receptor factual que expõe `receive` e `onReceive` para handlers.
- `buffers/`: implementa filas técnicas (inbound/outbound) e políticas de pressão.
- `correlation/`: store de correlação (causalidade de mensagens).
- `telemetry/`: pontos de telemetria (`nerv:...`) usados por todos os submódulos.
- `health/`: snapshot observacional com `report()`, `getStatus()` e `onChange()`.
- `shared/nerv/envelope.js` e `shared/nerv/constants.js`: define o envelope canônico e vocabulário
  (MessageType, ActionCode, ActorRole, PROTOCOL_VERSION).

## Criação e opções de configuração

API de construção: `await createNERV(config)`

Principais opções em `config` (exemplos extraídos do código):

- `mode`: `'local' | 'hybrid'` (default: `'local'`) — define EventEmitter vs EventEmitter+Socket.io.
- `buffers`: limites/limiares para inbound/outbound.
- `transport`: `{ adapter, reconnect? }` para adaptar transporte remoto/custom.
- `health.thresholds`: `maxOutboundBuffer`, `maxInboundBuffer`.
- `socketUrl` / `socketOptions`: usada pelo adapter Socket.io quando `mode==='hybrid'`.

Também há variáveis ambiente observadas no projeto (ex.: `NERV_BUFFER_SIZE`, `NERV_TELEMETRY`,
`NERV_SOCKET_URL`).

## API pública retornada por `createNERV`

O objeto público exposto (congelado) contém, entre outros:

- `emit(envelope)` / `send(envelope)` — emite envelope via transporte (fast-path local + opcional
  remota).
- `emitCommand`, `emitEvent`, `emitAck` — helpers especializados.
- `receive(frame)` — ingestão factual de um frame desserializado.
- `onReceive(handler)` — registra handler para envelopes recebidos.
- `onEvent(actionCode, handler)` — registra handler filtrado por `actionCode` (via
  `hybridTransport.onEvent`).
- `onCommand(handler)`, `onActor(actor, handler)` — registradores utilitários.
- `buffers` — referência aos objetos de buffer (inspeção apenas).
- `transport` — referência ao transporte físico (start/stop/send/onReceive).
- `health` — observabilidade (`report`, `getStatus`, `onChange`).
- `telemetry` — interface de telemetria interna (emite eventos técnicos).
- `getStatus()` — snapshot de conectividade/status do transporte.
- `shutdown()` — tentativa de parada graciosa das camadas de transporte/adapters.

## Protocolos e Envelopes

- O envelope NERV é criado por `createEnvelope()` em `src/shared/nerv/envelope.js`.
- Estrutura esperada: `protocol` (version, timestamp) | `identity` (actor, target) | `causality`
  (msg_id, correlation_id) | `type` (message_type, action_code) | `payload`.
- Campos são validados estritamente; envelopes são imutáveis (deepFreeze).
- Vocabulário canônico está em `src/shared/nerv/constants.js` (`PROTOCOL_VERSION`, `MessageType`,
  `ActionCode`, `ActorRole`).

## Transporte híbrido (visão técnica)

- `hybridTransport` combina um `EventEmitter` local (fast-path) com um `socketAdapter` (Socket.io)
  quando `mode==='hybrid'`.
- `send(envelope)` sempre emite localmente e, se híbrido, serializa e envia via Socket.io.
- `onReceive(handler)` registra handlers locais; `onEvent(actionCode, handler)` e
  `onActor(actor, handler)` são conveniências que filtram envelopes.
- O transporte relata telemetria para eventos como `hybrid_transport_sent`,
  `hybrid_transport_parse_error`, `hybrid_transport_handler_error`.

## Observabilidade / Health

- `health.report(type, data)` aceita tipos como `transport:connected`, `transport:disconnected`,
  `transport:error`, `buffer:update`, `emission`, `reception`.
- `getStatus()` retorna snapshot com `transport`, `buffers` e `activity`.
- `onChange(handler)` permite registrar callbacks que recebem snapshots sempre que o estado muda.
- Limiares configuráveis (`maxOutboundBuffer`, `maxInboundBuffer`) disparam telemetria de anomalia.

## Boas práticas e segurança operacional

- NERV é uma camada técnica — as políticas e decisões de negócio pertencem ao `Kernel` /
  `Policy Engine`.
- Evitar uso abusivo de listeners sem unsubscribe (o `EventEmitter` local aumenta `maxListeners`
  para 100, mas é boa prática remover listeners após uso).
- Não confiar em entregabilidade: envelopes enviados via `send` podem falhar no meio físico; a
  camada de retry é externa (reconnect disponível no `transport`).
- Não manipular diretamente os `buffers` sem entender as implicações de pressão (usar `health` para
  monitorar).

## Depuração e ferramentas

- Mapear eventos NERV automaticamente: `node scripts/analyze-code-graph.js --nerv` (gera relatórios
  em `analysis/`).
- Gerar grafo de dependências: `npm run analyze:graph:export` → `analysis/dependency-graph.dot` e
  `analysis/graph.svg`.
- Logs e telemetria: usar `pm2 logs` (quando em daemon) e conferir `logs/crash_reports/` em falhas.
- Para testar transporte híbrido localmente, defina `mode: 'hybrid'` em `createNERV()` e aponte
  `socketUrl` para um servidor de testes Socket.io.

## Runbook rápido — reiniciar NERV

1. Parar o processo (ou chamar `await nerv.shutdown()` dentro do processo).
2. Verificar `analysis/graph.svg` e `logs/pm2` para causas imediatas.
3. Reiniciar via PM2: `npm run daemon:restart` ou `npx pm2 restart agente-gpt`.

## Próximos passos recomendados

- Documentar `KERNEL`, `DRIVER`, `INFRA` com foco em interações NERV:
  - mapas de eventos (ActionCode relevantes)
  - exemplos de envelopes por fluxo (TASK_START → DRIVER_EXECUTE_TASK → DRIVER_TASK_COMPLETED)
- Adicionar exemplos de troubleshooting com comandos `curl` ou scripts de teste que enviem envelopes
  de teste.

## Referências no código

- `src/nerv/nerv.js`
- `src/nerv/transport/hybrid_transport.js`
- `src/nerv/emission/emission.js`
- `src/nerv/reception/reception.js`
- `src/nerv/health/health.js`
- `src/shared/nerv/envelope.js`
- `src/shared/nerv/constants.js`
