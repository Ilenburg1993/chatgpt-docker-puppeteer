**DOCUMENTAÇÃO — Subsistema SERVER**

Propósito: descrever a camada de entrada HTTP/WebSocket do sistema, como o servidor
expõe APIs REST, adapters Socket.io (real-time) e a ponte com o barramento NERV.

Responsabilidades principais
- Expor endpoints de controle e observabilidade: `/health`, `/metrics`, `/api/*`.
- Adaptadores em tempo real (Socket.io) para publicar e receber envelopes NERV.
- Validar e sanitizar requisições, aplicar autenticação/limitação e acrescentar `correlationId`.
- Integrar TelemetryBridge e encaminhar eventos para NERV via `ServerNERVAdapter`.

Arquivos de referência (no repositório)
- `src/server/api/router.js` — definições das rotas REST.
- `src/server/ServerNERVAdapter.js` (ou equivalente) — adapta eventos HTTP/WS para envelopes NERV.
- `ecosystem.config.js` / `package.json` — formas comuns de iniciar o servidor (PM2 / npm).

API REST (endpoints recomendados)
- `GET /health`
  - Retorno: `{ status: 'ok'|'degraded'|'down', services: { infra, kernel, drivers } }`.
- `GET /metrics`
  - Retorno: métrica no formato Prometheus (integração com `prom-client`).
- `POST /api/envelope`
  - Corpo: envelope NERV (actor, messageType, actionCode, correlationId, target, payload).
  - Ação: valida e publica no NERV (via adapter). Retorna `202 Accepted` com `correlationId`.
- `GET /api/tasks/:id`
  - Retorna status da task (consultando Kernel/TaskRuntime).
- `POST /api/drivers/:id/recycle`
  - Solicita reciclagem do driver/page identificado.

Exemplo: enviar envelope via HTTP
```json
POST /api/envelope
{
  "actor": "server",
  "messageType": "command",
  "actionCode": "DRIVER_EXECUTE_TASK",
  "correlationId": "uuid",
  "target": "driver:page-42",
  "payload": { "taskId": "t-1", "spec": { "text": "..." } }
}
```

Real-time (Socket.io) — eventos e contratos
- Eventos de entrada (cliente -> servidor):
  - `nerv:send` — payload: envelope; servidor valida e publica no NERV.
  - `nerv:subscribe` — subscreve o socket a envelopes com filtros (actor, actionCode).
- Eventos de saída (servidor -> cliente):
  - `nerv:event` — envelopes recebidos do NERV são retransmitidos a sockets subscritos.
  - `telemetry` — sinais vitais e incidentes.

Segurança, validação e escalabilidade
- Autenticação: suportar `x-api-key` ou JWT para endpoints sensíveis.
- Rate limiting: aplicar limites por IP/API key em endpoints de criação de tasks.
- CORS: configurar restrições e listas de origens confiáveis
- TLS/Proxy: executar atrás de proxy TLS (nginx / load balancer) em produção.

Observabilidade e logs
- Enriquecer logs com `requestId`/`correlationId` e `user` onde aplicável.
- Instrumentar rotas com métricas: `http_requests_total`, `http_request_duration_seconds`.
- Exportar `/metrics` para Prometheus e integrar alertas em casos `5xx` ou latência alta.

Runbook — operações comuns
1) Iniciar em desenvolvimento:
```bash
# Usual: usar Makefile/npm
make start
# ou
npm run daemon:start
```
2) Iniciar via PM2 (produção):
```bash
pm2 start ecosystem.config.js --only server
pm2 logs server
```
3) Ver health:
```bash
curl -s http://localhost:PORT/health | jq .
```
4) Reprocessar envelope errante:
 - Checar logs com `correlationId`, re-publicar envelope via `POST /api/envelope`.

Falhas e triagem rápida
- `500 Internal Server Error` em `/api/envelope`:
  - Validar schema do envelope, checar `ServerNERVAdapter` e conexão com NERV.
- Conexões WebSocket caindo:
  - Verificar limites de conexões do servidor, temporizadores de heartbeat (ping/pong) e
    consumo de CPU/memória. Reiniciar processo se necessário.

Testes sugeridos
- Unit: rotas do `router.js` com mocks do adapter NERV.
- Integration: iniciar servidor em modo teste e validar fluxo HTTP -> NERV -> Kernel (mocks).
- E2E: simular cliente WebSocket subscrevendo e recebendo `nerv:event`.

Boas práticas de implementação
- Validar envelopes com Zod/schema centralizado em `src/core/constants`.
- Não assumir confiança do cliente — sanitize/escape qualquer campo que será armazenado.
- Garantir que `ServerNERVAdapter` devolve respostas rápidas (assíncrono: `202 Accepted`).

Próximos passos
- Gerar exemplos de implementação de `POST /api/envelope` com validação Zod e testes.
- Documentar `ServerNERVAdapter` especificamente (mapeamento de actionCodes).
