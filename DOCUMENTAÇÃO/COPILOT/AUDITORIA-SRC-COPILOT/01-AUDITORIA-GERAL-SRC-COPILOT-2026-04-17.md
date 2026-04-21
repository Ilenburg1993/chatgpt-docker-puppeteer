# Auditoria geral ampla de `src/copilot`

Data: `2026-04-17`

## Resumo executivo

Esta rodada encontrou um conjunto consistente de problemas em cinco frentes:

- segurança e autorização;
- concorrência e integridade de sessão;
- timers/retries/cleanup;
- observabilidade e falhas silenciosas;
- governança de testes/documentação.

O problema principal não é “um arquivo ruim”; é um acúmulo de fissuras pequenas em um subsistema de
alta complexidade operacional.

## Achados priorizados

## A. Críticos e altos

### AUD-001 — `POST /steer` ficou sem proteção admin

- Severidade: `Alta`
- Confiança: `Confirmado`
- Evidência:
  - `src/copilot/server/routes/copilot-api/control.js:71-80`

Problema:

- `/start`, `/stop` e `/permissions` usam `requireAdmin`;
- `/steer` ficou exposto sem o mesmo middleware.

Impacto:

- redirecionamento operacional do agente por requisição HTTP não autenticada no nível
  administrativo;
- quebra de simetria de segurança do plano de controle.

Proposta:

- aplicar `requireAdmin` também em `/steer`;
- adicionar teste dedicado cobrindo autorização positiva e negativa.

### AUD-002 — Namespace `/copilot` autentica token, mas não autoriza por sessão

- Severidade: `Crítica`
- Confiança: `Confirmado`
- Evidência:
  - `src/copilot/server/socket/hub-ns.js:188-199`
  - `src/copilot/server/socket/hub-ns.js:223-255`
  - `src/copilot/server/socket/hub-ns.js:268-319`

Problema:

- qualquer cliente com token válido consegue:
  - listar sessões;
  - entrar em qualquer `hubSession`;
  - ler histórico;
  - injetar mensagem.

Impacto:

- exposição de dados entre sessões;
- escrita cruzada;
- impossibilidade de isolar usuários/agentes/dashboards por ownership.

Proposta:

- introduzir ownership explícito por sessão;
- validar autorização em `join`, `sessions:list`, `turns:history`, `user:inject`;
- limitar payload e paginação no próprio handler.

### AUD-003 — `LlmBridgeClient.chat()` é vulnerável a cross-talk concorrente

- Severidade: `Alta`
- Confiança: `Confirmado`
- Evidência:
  - `src/copilot/channel/client.js:189-223`
  - `src/copilot/channel/client.js:295-340`

Problema:

- `chat()` usa listeners globais `once/on` em `task.queued`, `task.delta` e `question.pending`;
- o comentário diz que isso evita contaminação concorrente, mas não há correlação forte entre
  chamada e evento antes da captura do `taskId`.

Impacto:

- resposta/chunks/pergunta podem ser associados ao turno errado quando há concorrência;
- histórico, streaming e `taskId` ficam inconsistentes.

Proposta:

- serializar `chat()` por instância, ou
- usar correlação explícita de request antes do subscribe, ou
- mover a API para um contrato que já devolva `taskId` de forma síncrona/segura.

### AUD-004 — Fechar sessão não impede escrita tardia de turno já em voo

- Severidade: `Alta`
- Confiança: `Confirmado`
- Evidência:
  - `src/copilot/conversation-hub/orchestrator.js:192-203`
  - `src/copilot/conversation-hub/orchestrator.js:226-263`
  - `src/copilot/conversation-hub/send-pipeline.js:79-87`
  - `src/copilot/conversation-hub/send-pipeline.js:141-163`

Problema:

- `closeSession()` marca a sessão como fechada e limpa mapas locais;
- porém `executeSendToLlmB()` continua podendo gravar turnos `llm_b`/erro após o fechamento se a
  chamada já estava em andamento;
- `writeTurn()` não valida status `active`.

Impacto:

- “sessão zumbi”: timeline continua crescendo após close;
- inconsistência entre estado lógico e persistência.

Proposta:

- validar status antes de cada `writeTurn`;
- cancelar pipeline em voo ao fechar sessão;
- impedir insert em sessão `closed` via regra de domínio ou trigger/check.

### AUD-005 — CORS default inválido e composição multi-origin incorreta

- Severidade: `Alta`
- Confiança: `Confirmado`
- Evidência:
  - `src/copilot/server/app.js:54-55`
  - `src/copilot/server/middleware/cors.js:38-43`

Problema:

- `Access-Control-Allow-Origin: http://localhost:*` não é um valor válido para browser;
- quando `origin` é array, o middleware junta com vírgula, o que também não é semântica válida de
  CORS.

Impacto:

- clientes browser podem falhar no preflight ou ignorar a resposta;
- o comportamento real diverge do pretendido.

Proposta:

- refletir a `Origin` recebida quando estiver numa allowlist;
- nunca emitir múltiplas origens em um único header;
- cobrir com teste de browser contract.

### AUD-006 — Comentário `skipAuth` não bate com a ordem real dos middlewares

- Severidade: `Alta`
- Confiança: `Confirmado`
- Evidência:
  - `src/copilot/server/app.js:61-64`
  - `src/copilot/server/router.js:68-84`
  - `src/copilot/server/routes/health.js:30-31`

Problema:

- a documentação de rota diz que `/health`, `/hub-health` e `/metrics` são `skipAuth`;
- o app instala auth global antes de montar os routers.

Impacto:

- contratos operacionais de health/metrics ficam enganosos;
- scrapers e checks externos podem falhar sem ficar claro por quê.

Proposta:

- implementar exemption real por rota, ou
- remover a promessa de `skipAuth`, ou
- separar um sub-app público de health/metrics.

### AUD-007 — `EventBus` promete suportar handlers async, mas não trata rejeições async

- Severidade: `Alta`
- Confiança: `Confirmado`
- Evidência:
  - `src/copilot/core/event-bus.js:24-27`
  - `src/copilot/core/event-bus.js:95-103`
  - `src/copilot/core/event-bus.js:255-289`

Problema:

- a assinatura do handler aceita `Promise<void>`;
- a entrega usa `void handler(event)` dentro de `try/catch`, o que só captura erro síncrono;
- rejeições assíncronas escapam para unhandled rejection.

Impacto:

- falhas intermitentes no bus podem vazar como ruído global;
- a intenção de “swallow” não é realmente cumprida.

Proposta:

- usar `Promise.resolve(handler(event)).catch(...)`;
- logar contexto do handler e do event type.

### AUD-008 — `SessionKeepalive` pode executar ticks sobrepostos

- Severidade: `Alta`
- Confiança: `Confirmado`
- Evidência:
  - `src/copilot/agent/session/keepalive.js:62-70`
  - `src/copilot/agent/session/keepalive.js:113-155`

Problema:

- `setInterval` dispara `#tick()` assíncrono sem trava de reentrância;
- se `ping()` ou `session.send()` atrasarem mais que o intervalo, múltiplos heartbeats podem
  coexistir.

Impacto:

- pings duplicados;
- gasto desnecessário de PR;
- estado de atividade atualizado fora de ordem.

Proposta:

- adicionar flag/mutex `#tickInFlight`;
- preferir `setTimeout` recursivo após conclusão do tick.

### AUD-009 — Timeouts por `Promise.race` sem cleanup aparecem em vários pontos

- Severidade: `Alta`
- Confiança: `Confirmado`
- Evidência:
  - `src/copilot/server/routes/sdk/session-messaging.js:125-130`
  - `src/copilot/tools/session-rpc-tools.js:82-87`
  - `src/copilot/tools/experimental-rpc-tools.js:86-93`
  - `src/copilot/core/shutdown.js:80-85`

Problema:

- a Promise de timeout não é cancelada quando a operação termina antes;
- timers ficam vivos até expirar.

Impacto:

- pressão desnecessária em runtime de longa duração;
- ruído e retenção de closures.

Proposta:

- padronizar helper com cleanup explícito;
- substituir chamadas abertas por `withTimeout()` onde possível.

### AUD-010 — `infra/storage.writeJson()` não faz escrita atômica apesar do contrato

- Severidade: `Alta`
- Confiança: `Confirmado`
- Evidência:
  - `src/copilot/infra/storage.js:32-46`

Problema:

- o comentário promete temp-file + rename;
- a implementação usa `writeFile` direto.

Impacto:

- risco de arquivo parcial/corrompido em crash/interrupção.

Proposta:

- alinhar implementação ao contrato;
- adicionar fsync/rename quando aplicável.

### AUD-011 — `readJson()` mascara corrupção de dados

- Severidade: `Alta`
- Confiança: `Confirmado`
- Evidência:
  - `src/copilot/infra/storage.js:22-28`

Problema:

- qualquer erro de leitura/parse vira `defaultValue` silenciosamente.

Impacto:

- corrupção de arquivo pode parecer “config vazia”;
- incidentes ficam invisíveis.

Proposta:

- diferenciar `ENOENT` de `JSON inválido`;
- logar parse failure com contexto;
- opcionalmente renomear arquivo corrompido.

### AUD-012 — `observability/logger` usa I/O síncrono na trilha quente

- Severidade: `Alta`
- Confiança: `Confirmado`
- Evidência:
  - `src/copilot/observability/logger.js:71-110`
  - `src/copilot/observability/logger.js:178-235`
  - `src/copilot/observability/logger.js:283-310`

Problema:

- `appendFileSync`, `statSync`, `renameSync`, `readdirSync`, `unlinkSync` em cada trilha de
  log/rotação.

Impacto:

- bloqueio de event loop em subsistema que deveria diagnosticar, não piorar latência.

Proposta:

- mover para writer assíncrono/bufferizado;
- fazer rotação fora da trilha crítica.

### AUD-013 — `event-bus-runtime` singleton pode grudar no bus antigo

- Severidade: `Alta`
- Confiança: `Confirmado`
- Evidência:
  - `src/copilot/observability/event-bus-runtime.js:118-131`

Problema:

- `attachObservabilityBusRuntime()` retorna `_runtime` atual se `attached`;
- não verifica se `bus`/`metrics` recebidos mudaram.

Impacto:

- em reinicialização parcial, a observabilidade pode continuar ligada ao barramento errado.

Proposta:

- comparar dependências recebidas;
- re-anexar ou rejeitar attach inconsistente.

### AUD-014 — `quota-monitor` falha silenciosamente e pode congelar snapshots

- Severidade: `Média-alta`
- Confiança: `Confirmado`
- Evidência:
  - `src/copilot/sdk/telemetry/quota-monitor.js:117-127`

Problema:

- erros de `_fetch()` são totalmente engolidos.

Impacto:

- quota stale sem alarme;
- health falso-positivo.

Proposta:

- no mínimo `WARN` com rate limiting;
- contador de falhas consecutivas e health degradado.

### AUD-015 — `web_fetch` trata `404/500 text/*` como sucesso

- Severidade: `Média-alta`
- Confiança: `Confirmado`
- Evidência:
  - `src/copilot/tools/web-tools.js:105-173`

Problema:

- valida `content-type`, mas não exige `response.ok`.

Impacto:

- o chamador pode interpretar erro HTTP como conteúdo válido;
- fluxos automáticos passam a operar em cima de páginas de erro.

Proposta:

- exigir `response.ok` ou retornar status não-2xx como erro estruturado.

## B. Médios estruturais

### AUD-016 — `runPipeline()` não trata erros de spawn adequadamente

- Evidência: `src/copilot/tools/shell/executor.js:112-168`
- Problema:
  - não há listeners de `error` por processo;
  - só `stdout/stderr` do último processo são capturados.
- Impacto:
  - diagnósticos pobres;
  - risco de pipeline pendurada em falhas de spawn.

### AUD-017 — `withRetry()` acumula listeners de abort por tentativa

- Evidência: `src/copilot/core/retry.js:65-80`
- Problema:
  - cada tentativa adiciona `signal.addEventListener('abort', ...)` sem remoção explícita quando o
    timer resolve.
- Impacto:
  - vazamento de listeners em sinais long-lived.

### AUD-018 — `registerShutdownHandler()` não deduplica handlers

- Evidência: `src/copilot/core/shutdown.js:60-63`
- Problema:
  - múltiplos boots/restarts parciais podem duplicar cleanup handlers.
- Impacto:
  - shutdown repetido, logs duplicados e cleanup fora de ordem.

### AUD-019 — `agent/lifecycle/entry.js` usa `process.exit()` em rotas sensíveis

- Evidência: `src/copilot/agent/lifecycle/entry.js:107-109`, `119`, `184-186`
- Problema:
  - o processo encerra de forma abrupta após parte do shutdown.
- Impacto:
  - risco de perder flush final de estado/logs/telemetria.

### AUD-020 — `health-registry` não protege resoluções de container nos closures

- Evidência: `src/copilot/server/routes/health-registry.js:20-55`
- Problema:
  - o código assume `container.resolve(...)` sempre disponível.
- Impacto:
  - health registry pode quebrar em bootstrap parcial/testes.

### AUD-021 — `custom-tools.json` e `tools-config.json` têm drift entre comentário e path real

- Evidência:
  - `src/copilot/sdk/tools/custom.js:3-6`, `48`
  - `src/copilot/sdk/tools/state.js:5-9`, `23`
- Problema:
  - comentários falam em raiz do projeto;
  - path real aponta para dentro de `src/copilot/`.
- Impacto:
  - troubleshooting confuso;
  - logs `ENOENT` difíceis de interpretar.

### AUD-022 — ausência de arquivos opcionais é tratada como erro engolido

- Evidência:
  - `src/copilot/sdk/tools/custom.js:158-177`
  - `src/copilot/sdk/tools/state.js:37-59`
- Problema:
  - falta de arquivo opcional gera `logSwallowed`, não um fluxo normal de “arquivo opcional
    ausente”.
- Impacto:
  - ruído recorrente em teste/boot;
  - observabilidade poluída.

### AUD-023 — `README` do módulo está parcialmente defasado

- Evidência: `src/copilot/README.md`
- Problema:
  - diretórios e responsabilidades não batem plenamente com a árvore atual.
- Impacto:
  - onboarding e auditoria mais lentos;
  - maior risco de alteração em lugar errado.

## C. Testes e governança

### AUD-024 — A suíte padrão e a suíte real usam runners diferentes

- Severidade: `Alta`
- Confiança: `Confirmado`
- Evidência:
  - `package.json:328-338`
  - `97` arquivos `copilot` importando `vitest`
  - execução representativa:
    - `node --strip-types --test tests/unit/copilot/test_keepalive.spec.js`
    - erro: `Vitest mocker was not initialized in this environment`

Problema:

- `npm test` usa `node --test`;
- parte relevante da suíte foi escrita com `vitest`.

Impacto:

- falsa sensação de cobertura;
- possível falha em CI/local dependendo do conjunto executado.

Proposta:

- unificar runner ou segmentar a suíte de forma explícita no script principal;
- falhar cedo quando arquivos `vitest` forem executados pelo runner errado.

### AUD-025 — Há `39` testes `copilot` skipped/pending

- Evidência: `tests/unit/copilot`, `tests/integration/copilot`, `tests/regression/copilot`

Problema:

- múltiplos testes críticos estão pulados, inclusive E2E e lifecycle.

Impacto:

- regressões em partes centrais passam despercebidas.

Proposta:

- triagem por motivo:
  - arquivo removido;
  - API changed;
  - pending reimplementation;
- zerar o backlog por ondas.

### AUD-026 — Testes que passam não cobrem os principais riscos desta auditoria

Validados nesta rodada:

- `test_agent_health_routes.spec.js`
- `test_hub_orchestrator.spec.js`
- `test_llm_bridge_client.spec.js`

Gap:

- não cobrem:
  - cross-talk concorrente;
  - close mid-flight;
  - auth/authorization por sessão;
  - leaks de timer em `Promise.race`;
  - compatibilidade de runner.

## Síntese por área

### Agent / Dialog / Session

- forte concentração de complexidade em `always-alive.js`, `loop-manager.js`, `boot-steps.js`;
- risco maior em concorrência, retries, keepalive e shutdown.

### Channel / Hub

- melhores candidatos a bugs funcionais reais de runtime;
- muita confiança nos achados de cross-talk, sessão zumbi e paginação frouxa.

### Server / API / Socket

- maior concentração de risco de segurança e drift de contrato;
- autorização mais fraca do que a autenticação faz parecer.

### Observability / Core

- logs e bus cumprem papel importante, mas hoje ainda podem:
  - ocultar falhas;
  - gerar falsa saúde;
  - bloquear o loop sob carga.

### SDK / Tools

- há sinais de path drift, arquivos opcionais mal modelados e timeouts padronizados sem cleanup.

## Recomendações de remediação

### Onda 1 — Segurança e integridade

1. Proteger `/steer`.
2. Implementar authorization por sessão no namespace Socket.IO.
3. Limitar `limit/offset/history` em sockets e APIs.
4. Impedir `writeTurn()` em sessão não ativa.

### Onda 2 — Concorrência e timers

1. Corrigir correlação de `LlmBridgeClient.chat()`.
2. Adicionar guard de reentrância no keepalive.
3. Padronizar helper de timeout com cleanup.
4. Revisar `process.exit()` e duplicação de shutdown handlers.

### Onda 3 — Observabilidade e governança

1. Substituir I/O síncrono do logger por writer assíncrono.
2. Fazer `logSwallowed`/silent catch emitirem sinal útil sem ruído excessivo.
3. Alinhar comentários, READMEs e paths persistidos.
4. Unificar a estratégia de teste (`node:test` vs `vitest`).

## Veredito final

`src/copilot` não parece um módulo “colapsado”, mas sim um módulo que cresceu rápido e agora
acumula:

- dívida de coordenação concorrente;
- dívida de segurança por autorização incompleta;
- dívida de runtime por timers e fallbacks silenciosos;
- dívida de governança por teste/documentação em drift.

Há achados suficientes para justificar múltiplas ondas de correção, começando por segurança e
integridade de sessão.
