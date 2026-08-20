# MCP Stateful Streamable HTTP — runbook de reinicio

Data: 2026-06-13 Estado: pronto para reinicio com runtime stateful obrigatório no caminho OAuth;
GET/SSE autenticado ainda em diagnóstico por timeout remoto.

## Objetivo

Subir o MCP remoto usando o novo caminho stateful Streamable HTTP, mantendo fallback controlado
apenas por flag explicita.

## Codigo incluido neste corte

- `src/copilot/mcp/adapters/http-body.js`: leitura segura de body JSON e classificacao
  initialize/session.
- `src/copilot/mcp/adapters/http-stateful-router.js`: initialize stateful, reuso por
  `Mcp-Session-Id`, GET/SSE em transporte vivo, DELETE com `204`, event store e auth binding.
- `src/copilot/mcp/control-plane/session-runtime.js`: runtime process-local com TTL, limites,
  tombstones e metricas.
- `src/copilot/mcp/control-plane/session-store.js`: store SQLite de metadados redigidos.
- `src/copilot/mcp/control-plane/event-store.js`: event store compativel com SDK para resumability.
- `src/copilot/mcp/control-plane/stream-registry.js`: registry process-local de streams SSE
  redigido.

## Comandos canonicos sincronizados

Makefile:

```bash
make copilot-mcp-up
make copilot-mcp-restart
make copilot-mcp-status
make copilot-mcp-stateful-up
make copilot-mcp-stateful-restart
make copilot-mcp-stateful-status
make copilot-mcp-stateless-compat-up
make copilot-mcp-stateless-compat-restart
make copilot-mcp-h2-up
make copilot-mcp-h2-restart
make copilot-mcp-h2-status
make mcp-stateful-typecheck
make mcp-stateful-lint
make mcp-stateful-unit
make mcp-stateful-validate-fast
make mcp-stateful-validate-full
make mcp-stateful-restart-ready
make mcp-stateful-secret-ensure
make mcp-stateful-secret-status
make mcp-stateful-env-print
make mcp-stateful-rollback-env
```

package.json:

```bash
npm run mcp:stateful:typecheck
npm run mcp:stateful:lint
npm run mcp:stateful:unit
npm run mcp:stateful:validate:fast
npm run mcp:stateful:validate:full
npm run mcp:stateful:restart-ready
npm run mcp:stateful:secret:ensure
npm run mcp:stateful:secret:status
npm run mcp:stateful:env
npm run mcp:stateful:rollback-env
npm run mcp:stateful:restart
npm run copilot:mcp:stateful:restart-ready
```

## Segredo canonico de sessao

O segredo de hash de sessao agora e criado/carregado automaticamente pelos comandos stateful
canonicos. O arquivo local e ignorado pelo Git:

```text
src/copilot/.ai/mcp/stateful-session.env
```

Crie ou valide o arquivo sem imprimir o segredo bruto:

```bash
make mcp-stateful-secret-ensure
make mcp-stateful-secret-status
```

Os comandos `make copilot-mcp-up`, `make copilot-mcp-restart`, `make copilot-mcp-h2-up` e
`make copilot-mcp-h2-restart` carregam esse env automaticamente com:

```text
COPILOT_MCP_HTTP_STATEFUL_SESSIONS=true
COPILOT_MCP_HTTP_STATELESS_COMPAT=false
COPILOT_MCP_HTTP_ENFORCE_POST_SESSION_CONTRACT=true
COPILOT_MCP_HTTP_SESSION_TTL_MS=600000
COPILOT_MCP_HTTP_MAX_SESSIONS=256
COPILOT_MCP_HTTP_SESSION_ID_HASH_SECRET=<valor do arquivo local>
```

Notas:

- O segredo e persistente entre reinicios.
- O arquivo recebe permissao `0600`.
- O valor bruto nao e impresso por `status`; apenas um preview redigido.
- Arquivos antigos com `COPILOT_MCP_HTTP_MAX_SESSIONS=32` sao auto-atualizados para `256` sem
  rotacionar o segredo.
- O limite existe para conter consumo de memoria, streams vivos, event/resume state e
  abusos/retries; saturacao agora retorna 503 claro antes do SDK.

## Rollback imediato

```bash
export COPILOT_MCP_HTTP_STATEFUL_SESSIONS=false
export COPILOT_MCP_HTTP_STATELESS_COMPAT=true
unset COPILOT_MCP_HTTP_ENFORCE_POST_SESSION_CONTRACT
```

Depois reinicie o processo MCP.

## Estado auditado em 2026-06-14 UTC

> Atualização desta rodada: documentação revisada contra o código atual; transformação de código
> ficou limitada por bloqueio de escrita em arquivos-fonte do workspace nesta sessão, então os itens
> novos abaixo ficam como próximos patches aplicáveis. Probes confirmaram que algumas ações mutáveis
> são barradas antes de alcançar o MCP; a mitigação é planejar com ferramenta read-only, reduzir
> payload, suprimir diff e aplicar em chamada única quando a camada host permitir.

- [x] `mcp_runtime_health` indica stateful policy carregada: `enabled=true`,
      `statelessCompat=false`, contrato pós-initialize ativo e fallback stateless indisponível no
      processo atual.
- [x] Smoke OAuth autenticado executa `mcp_runtime_health` e `tools/list` via sessão; `tools/list`
      retornou 102/102 tools após normalização de resposta POST em SSE.
- [ ] GET/SSE autenticado ainda aborta por timeout; manter este ponto como gate de promoção antes de
      declarar P0 remoto encerrado.
- [ ] O gate vivo de Cloudflare ainda pode reprovar por contador agregado `requestErrorRate` até o
      processo MCP carregar a heurística nova; o teste unitário da heurística já passou no
      `mcp-full` job `36828763-587d-4f35-9127-c11fd87cfe30`.

## Checklist antes do reinicio

- [x] `typecheck` passou.
- [x] `lint` passou.
- [x] `unit-mcp` passou.
- [x] `mcp-full` passou.
- [x] Auth binding anti-hijack coberto por teste.
- [x] DELETE encerra sessao e retorna 204 quando o transporte nao escreveu resposta.
- [x] GET/SSE usa transporte vivo e registry de stream redigido.
- [x] Event store SDK-compatible integrado ao transporte stateful.

## Sequencia operacional

1. Rodar `make mcp-stateful-secret-status` para validar/atualizar o env local sem imprimir segredo
   bruto.
2. Rodar `make mcp-stateful-restart-ready`.
3. Reiniciar com `make copilot-mcp-restart`.
4. Manter o Cloudflare Tunnel apontando para o mesmo origin HTTP/2+.
5. Executar `make copilot-mcp-smoke-refresh` e `make copilot-mcp-oauth-smoke` apos o processo subir.
6. Confirmar:
   - policy `enabled=true`;
   - `statelessCompat=false`;
   - `statefulSessionRuntime=true`;
   - initialize remoto retorna `Mcp-Session-Id`;
   - POST subsequente sem `Mcp-Session-Id` retorna 400;
   - sessao desconhecida retorna 404;
   - DELETE retorna 204.

## Limitacoes conhecidas para proxima faixa

- Heartbeat/retry customizado para SSE ainda nao foi aprofundado alem do comportamento do transporte
  SDK.
- Smoke SSE remoto autenticado e reconnect remoto com `Last-Event-ID` ainda ficam para a proxima
  faixa.
- Multi-runtime/HA real ainda exige sticky routing ou roteamento por session owner; o rollout atual
  permanece single-origin stateful.
