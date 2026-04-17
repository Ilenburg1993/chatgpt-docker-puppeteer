# Catálogo amplo de achados e gaps de `src/copilot`

Data: `2026-04-17`

## Como ler este catálogo

Este documento mistura três camadas:

- `Confirmado`: bug/gap sustentado por leitura direta e/ou validação local;
- `Alto indício`: problema muito provável, pronto para triagem/patchedown;
- `Heurístico`: sinal operacional/estrutural que ainda precisa de validação contextual.

Objetivo:

- permitir continuidade por outras pessoas ou LLMs sem recomeçar do zero;
- manter rastreável o backlog amplo;
- separar claramente “já confirmado” de “ainda precisa validar”.

## 1. Catálogo de achados confirmados

| ID | Severidade | Arquivos principais | Resumo |
| --- | --- | --- | --- |
| CAT-001 | Alta | `server/routes/copilot-api/control.js` | `/steer` sem proteção admin |
| CAT-002 | Crítica | `server/socket/hub-ns.js` | autenticação sem autorização por sessão |
| CAT-003 | Alta | `channel/client.js` | cross-talk possível em `chat()` concorrente |
| CAT-004 | Alta | `conversation-hub/orchestrator.js`, `send-pipeline.js` | sessão fechada ainda recebe turnos tardios |
| CAT-005 | Alta | `server/app.js`, `server/middleware/cors.js` | CORS default inválido e multi-origin incorreto |
| CAT-006 | Alta | `server/app.js`, `server/router.js`, `routes/health.js` | `skipAuth` prometido, mas não efetivado no app |
| CAT-007 | Alta | `core/event-bus.js` | handlers async podem rejeitar sem tratamento |
| CAT-008 | Alta | `agent/session/keepalive.js` | keepalive reentrante/overlap |
| CAT-009 | Alta | `server/routes/sdk/session-messaging.js`, `tools/session-rpc-tools.js`, `tools/experimental-rpc-tools.js` | timeouts por `Promise.race` sem cleanup |
| CAT-010 | Alta | `infra/storage.js` | escrita JSON não é atômica apesar do contrato |
| CAT-011 | Alta | `infra/storage.js` | leitura JSON mascara corrupção |
| CAT-012 | Alta | `observability/logger.js` | logging síncrono em hot path |
| CAT-013 | Alta | `observability/event-bus-runtime.js` | singleton pode reter bus/metrics antigos |
| CAT-014 | Média-alta | `sdk/telemetry/quota-monitor.js` | falhas de quota ficam silenciosas |
| CAT-015 | Média-alta | `tools/web-tools.js` | `web_fetch` aceita `404/500 text/*` como sucesso |
| CAT-016 | Média | `tools/shell/executor.js` | pipeline sem tratamento adequado de spawn error |
| CAT-017 | Média | `core/retry.js` | listeners de abort acumulam por tentativa |
| CAT-018 | Média | `core/shutdown.js` | handlers não deduplicados |
| CAT-019 | Média | `agent/lifecycle/entry.js` | `process.exit()` em pontos sensíveis |
| CAT-020 | Média | `server/routes/health-registry.js` | closures assumem container sempre consistente |
| CAT-021 | Média | `sdk/tools/custom.js`, `sdk/tools/state.js` | comentário de persistência diverge do path real |
| CAT-022 | Média | `sdk/tools/custom.js`, `sdk/tools/state.js` | ausência de arquivo opcional tratada como erro engolido |
| CAT-023 | Média | `src/copilot/README.md` | drift documental do módulo |
| CAT-024 | Alta | `package.json`, `tests/unit/copilot/test_keepalive.spec.js` | runner padrão incompatível com parte da suíte |
| CAT-025 | Alta | `tests/unit/copilot`, `tests/integration/copilot`, `tests/regression/copilot` | 39 testes skipped/pending |

## 2. Sinais de swallow/silent failure — 62 pontos

Observação:

- nem todo ponto abaixo é bug confirmado;
- todos são candidatos fortes a review de robustez, diagnóstico e perda silenciosa de erro.

```text
src/copilot/core/error-handlers.js:7: * - `logSwallowed(err, context)` — loga (DEBUG) + registra no ErrorTracker sem rethrow
src/copilot/core/error-handlers.js:141:export function logSwallowed(err, context) {
src/copilot/core/error-handlers.js:162:        logSwallowed(err, context);
src/copilot/core/event-bus.js:260:                } catch (_) {
src/copilot/core/event-bus.js:275:                    } catch (_) {
src/copilot/core/event-bus.js:288:                } catch (_) {
src/copilot/terminal/terminal-agent-wiring.js:100:                logSwallowed(e, 'terminal.index.watchdogWriteTurn');
src/copilot/terminal/terminal-agent-wiring.js:206:            logSwallowed(e, 'terminal.index.reconnectWriteTurn');
src/copilot/terminal/terminal-agent-wiring.js:218:            logSwallowed(e, 'terminal.index.fatalWriteTurn');
src/copilot/terminal/file-context.js:263:            logSwallowed(e, 'terminal.fileContext.readFile');
src/copilot/server/routes/sdk/observability.js:99:                logSwallowed(e, 'api.observability.getAgent');
src/copilot/terminal/alias-store.js:95:        logSwallowed(e, 'terminal.aliasStore.write');
src/copilot/terminal/repl.js:253:        await ensureDialogLoop().catch((e) => logSwallowed(e, 'terminal.repl.ensureDialogLoop'));
src/copilot/terminal/repl.js:305:        logSwallowed(e, 'terminal.repl.stopLoop');
src/copilot/config/pinned-files.js:142:            logSwallowed(e, 'config.pinnedFiles.readdir');
src/copilot/config/pinned-files.js:154:                logSwallowed(e, 'config.pinnedFiles.stat');
src/copilot/config/pinned-files.js:170:            logSwallowed(e, 'config.pinnedFiles.loadFile');
src/copilot/config/pinned-files.js:221:                        logSwallowed(e, 'config.pinnedFiles.watchSubdirs');
src/copilot/config/pinned-files.js:275:                logSwallowed(e, 'config.pinnedFiles.reloadFile');
src/copilot/db/sqlite.js:204:                logSwallowed(e, 'db.sqlite.close');
src/copilot/sdk/session/client.js:310:            logSwallowed(e, 'sdk.client.disconnect');
src/copilot/sdk/tools/custom.js:176:        logSwallowed(e, 'sdk.customTools.loadRegistry');
src/copilot/agent/event-bridge-wiring.js:67:        } catch (_busWiringErr) {
src/copilot/agent/event-bridge-wiring.js:73:                logSwallowed(_busWiringErr, 'AlwaysAliveAgent.eventBusWiring');
src/copilot/agent/always-alive.js:555:        this.stop().catch((e) => logSwallowed(e, 'AlwaysAliveAgent.Symbol.dispose'));
src/copilot/agent/session/boot-steps.js:175:            .catch((e) => logSwallowed(e, 'agent.bootWiring.cleanup')),
src/copilot/agent/session/snapshot.js:155:            logSwallowed(e, 'snapshot.listAsync.parseFile');
src/copilot/agent/session/snapshot.js:242:            logSwallowed(e, 'snapshot.pruneAsync.rmFile');
src/copilot/agent/session/hook-context.js:182:            logSwallowed(e, 'hookContext.readTodoStore');
src/copilot/agent/lifecycle/entry.js:164:                shutdown('IPC:stop').catch((e) => logSwallowed(e, 'agent.entry.ipcShutdown'));
src/copilot/agent/lifecycle/entry.js:220:        pingClient.stop().catch((e) => logSwallowed(e, 'agent.entry.pingStop'));
src/copilot/agent/lifecycle/state-io.js:100:    readStateAsync().catch((e) => logSwallowed(e, 'stateIo.readState.asyncFallback'));
src/copilot/agent/lifecycle/state-io.js:121:    writeStateAsync(updates).catch((e) => logSwallowed(e, 'stateIo.writeState.asyncFallback'));
src/copilot/agent/lifecycle/state-io.js:178:    clearStateAsync().catch((e) => logSwallowed(e, 'stateIo.clearState.asyncFallback'));
src/copilot/agent/lifecycle/state-io.js:203:                logSwallowed(e, 'stateIo.readStateAsync.rmCorrupt');
src/copilot/agent/lifecycle/state-io.js:219:            logSwallowed(e, 'stateIo.readStateAsync.rmCorruptOuter');
src/copilot/agent/lifecycle/state-io.js:237:        logSwallowed(e, 'stateIo.clearStateAsync.rm');
src/copilot/agent/lifecycle/state-io.js:253:        _writeQueue.then(() => undefined).catch((e) => logSwallowed(e, 'stateIo.drainWrites')),
src/copilot/agent/lifecycle/agent-lifecycle.js:253:                logSwallowed(e, 'agent.lifecycle.stopBootWait'),
src/copilot/conversation-hub/hub.js:280:                        logSwallowed(e, 'hub.closeSession');
src/copilot/conversation-hub/hub.js:284:                logSwallowed(e, 'hub.listSessionsOnShutdown');
src/copilot/conversation-hub/hub.js:335:            } catch (_err) {
src/copilot/conversation-hub/orchestrator.js:250:        const tail = next.then(() => {}).catch((e) => logSwallowed(e, 'hub.orchestrator.tail'));
src/copilot/conversation-hub/orchestrator.js:260:        }).catch((e) => logSwallowed(e, 'hub.orchestrator.inflightCleanup'));
src/copilot/conversation-hub/store.js:251:            logSwallowed(e, 'hub.store.parseMetadata');
src/copilot/agent/background-tasks.js:86:                    logSwallowed(error, `agent.background.${label}`);
src/copilot/agent/dialog/loop-manager.js:494:                logSwallowed(e, 'agent.loopManager.writeState'),
src/copilot/agent/dialog/loop-manager.js:625:            (error) => logSwallowed(error, `agent.loopManager.${meta.label ?? 'background'}`),
src/copilot/agent/dialog/agent-dialog-controller.js:132:                } catch (_) {
src/copilot/agent/dialog/backpressure.js:73:        this.#mutex = next.then(() => {}).catch((e) => logSwallowed(e, 'agent.backpressure.mutex'));
src/copilot/agent/facades/agent-session-ops.js:57:        logSwallowed(e, 'agent.sessionLog');
src/copilot/hooks/error-handler.js:91:            } catch (_) {
src/copilot/hooks/error-handler.js:215:            } catch (_) {
src/copilot/hooks/error-handler.js:243:                } catch (_) {
src/copilot/hooks/error-handler.js:270:                } catch (_) {
src/copilot/hooks/presets/production.js:122:            } catch (_) {
src/copilot/hooks/presets/production.js:303:                } catch (_) {
src/copilot/tools/todo/store.js:135:                logSwallowed(e, 'todo.store.parseRow');
src/copilot/tools/session-tools.js:70:                logSwallowed(e, 'session-tools.readPendingTasks');
src/copilot/tools/session-tools.js:115:            logSwallowed(e, 'session-tools.gitInfo');
src/copilot/audit/pipeline-permission.js:120:            logSwallowed(e, 'audit.pipeline.logPermission');
src/copilot/tools/web-tools.js:359:                    logSwallowed(e, 'web-tools.parseUrl');
src/copilot/audit/jsonl-writer.js:63:                logSwallowed(e, 'audit.jsonlWriter.write');
src/copilot/audit/pipeline-audit-log.js:163:                    logSwallowed(e, 'audit.pipeline.statToolAudit');
src/copilot/audit/pipeline-audit-log.js:167:                logSwallowed(e, 'audit.pipeline.flushToolAudit');
src/copilot/sdk/tools/state.js:58:        logSwallowed(e, 'sdk.toolsState.loadConfig');
src/copilot/observability/event-collector.js:103:        logSwallowed(e, 'event-collector.flush');
src/copilot/observability/event-collector.js:136:                logSwallowed(e, 'event-collector.stat');
src/copilot/observability/event-collector.js:140:            logSwallowed(e, 'event-collector.persist');
src/copilot/observability/logger.js:59:} catch (_) {
src/copilot/observability/logger.js:83:                } catch (_) {
src/copilot/observability/logger.js:194:        } catch (_) {
src/copilot/observability/logger.js:221:        } catch (_) {
src/copilot/observability/logger.js:233:        } catch (_) {
src/copilot/observability/logger.js:289:    } catch (_) {
src/copilot/observability/logger.js:308:    } catch (_) {
src/copilot/observability/metrics.js:285:                    logSwallowed(e, 'metrics.snapshot');
src/copilot/server/socket/hub-ns.js:413:        logSwallowed(e, 'hub.socketNs.unmount');
src/copilot/channel/client.js:201:                        logSwallowed(e, 'channel.client.onDelta');
src/copilot/channel/client.js:212:                    logSwallowed(e, 'channel.client.onQuestion');
src/copilot/channel/sse-client.js:97:                                logSwallowed(e, 'channel.sseClient.parseJson');
```

## 3. Timers, intervals e waits assíncronos — 64 pontos

Observação:

- muitos destes usos são legítimos;
- eles merecem triagem porque `src/copilot` é um processo de longa duração.

```text
src/copilot/terminal/terminal-agent-wiring.js:63:            const timeout = setTimeout(() => resolve(false), 5_000);
src/copilot/terminal/terminal-agent-wiring.js:72:            const interval = setInterval(() => {
src/copilot/terminal/terminal-agent-wiring.js:76:            setTimeout(() => clearInterval(interval), 5_100);
src/copilot/terminal/index.js:109:    _reflectionTimer = setInterval(runReflection, reflectionIntervalMs);
src/copilot/terminal/repl.js:235:        const timeout = setTimeout(() => rejectReady(new Error('Timeout aguardando restart')), 30_000);
src/copilot/core/retry.js:66:                const timer = setTimeout(resolve, finalDelay);
src/copilot/core/retry.js:109:                timer = setTimeout(() => {
src/copilot/core/shutdown.js:83:                    setTimeout(() => reject(new Error(`Shutdown handler "${handler.name}" timeout`)), 5_000),
src/copilot/terminal/dialog/engine.js:121:            await new Promise((r) => setTimeout(r, delay));
src/copilot/terminal/dialog/engine.js:138:            const timeout = setTimeout(() => reject(new Error('Timeout aguardando idle')), 30_000);
src/copilot/terminal/dialog/engine.js:144:                    setTimeout(check, 500);
src/copilot/terminal/dialog/engine.js:154:            const timeout = setTimeout(
src/copilot/terminal/dialog/engine.js:167:                    setTimeout(check, 500);
src/copilot/terminal/dialog/engine.js:351:            setTimeout(() => {
src/copilot/infra/sse/utils.js:164:        heartbeatTimer = setInterval(() => send('heartbeat', { ts: Date.now() }, { skipBuffer: true }), heartbeatMs);
src/copilot/infra/sse/utils.js:171:        lifetimeTimer = setTimeout(() => {
src/copilot/channel/inject.js:135:        req.setTimeout(timeoutMs, () => {
src/copilot/channel/inject.js:212:                await new Promise((r) => setTimeout(r, waitMs));
src/copilot/channel/inject.js:307:        await new Promise((r) => setTimeout(r, pollIntervalMs));
src/copilot/channel/client.js:143:                    await new Promise((r) => setTimeout(r, waitMs));
src/copilot/channel/client.js:234:                timeoutHandle = setTimeout(
src/copilot/channel/sse-client.js:121:        reconnectTimer = setTimeout(() => {
src/copilot/infra/webhooks.js:190:                await new Promise((r) => setTimeout(r, delay));
src/copilot/infra/webhooks.js:194:            const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
src/copilot/config/pinned-files.js:245:        const timer = setTimeout(async () => {
src/copilot/sdk/http-request.js:55:        req.setTimeout(timeoutMs, () => {
src/copilot/sdk/telemetry/quota-monitor.js:123:            _timer = setInterval(() => {
src/copilot/server/routes/copilot-api/tasks.js:65:                const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
src/copilot/server/routes/sdk/session-messaging.js:129:                        setTimeout(() => reject(new Error(`Timeout após ${timeoutMs}ms`)), timeoutMs + 5000),
src/copilot/sdk/event-helpers.js:22: *     new Promise((_, reject) => setTimeout(() => reject(...), timeoutMs)),
src/copilot/sdk/event-helpers.js:72:        timer = setTimeout(onTimeout, timeoutMs);
src/copilot/sdk/event-helpers.js:86: *     new Promise((r) => setTimeout(r, 15_000)),
src/copilot/sdk/event-helpers.js:134:        timer = setTimeout(() => {
src/copilot/agent/background-tasks.js:128:                new Promise((resolve) => setTimeout(resolve, remainingMs)),
src/copilot/hooks/composer.js:133:                timer = setTimeout(() => {
src/copilot/conversation-hub/store.js:87:            const checkpointTimer = setInterval(
src/copilot/conversation-hub/store.js:381:        const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
src/copilot/agent/lifecycle/agent-lifecycle.js:269:                new Promise((resolve) => setTimeout(resolve, shutdownTimeoutMs)),
src/copilot/agent/session/boot-steps.js:189:    const bootRecoveryTimer = setTimeout(() => {
src/copilot/agent/session/boot-steps.js:260:    const metricsTimer = setInterval(() => {
src/copilot/agent/session/keepalive.js:67:        this.#timer = setInterval(() => {
src/copilot/agent/lifecycle/entry.js:198:                setTimeout(() => reject(new TimeoutError('Ping timeout (5s)')), PING_TIMEOUT_MS),
src/copilot/agent/lifecycle/reconnect-policy.js:81:                await new Promise((r) => setTimeout(r, delay));
src/copilot/agent/lifecycle/state-io.js:254:        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
src/copilot/tools/todo/store.js:343:    return setInterval(() => {
src/copilot/tools/shell/executor.js:146:        const timer = setTimeout(() => {
src/copilot/tools/experimental-rpc-tools.js:89:                setTimeout(
src/copilot/tools/session-rpc-tools.js:86:                setTimeout(() => reject(new TimeoutError(`RPC timeout (${RPC_TIMEOUT_MS}ms)`)), RPC_TIMEOUT_MS),
src/copilot/tools/web-tools.js:103:            const timer = setTimeout(() => controller.abort(), timeout);
src/copilot/tools/web-tools.js:219:            const timer = setTimeout(() => controller.abort(), 15_000);
src/copilot/tools/web-tools.js:312:            const timer = setTimeout(() => controller.abort(), 15_000);
src/copilot/tools/hook-tools.js:273:            const autoCleanupTimer = setTimeout(() => {
src/copilot/agent/dialog/turn-executor.js:125:    const timeoutHandle = setTimeout(() => {
src/copilot/agent/dialog/turn-executor.js:206:            const newTimeout = setTimeout(() => {
src/copilot/agent/dialog/turn-executor.js:278:        const retryTimeout = setTimeout(() => {
src/copilot/bridges/mcp-tool-bridge.js:82:        socket.setTimeout(portProbeTimeoutMs);
src/copilot/bridges/mcp-tool-bridge.js:298:        await new Promise((r) => setTimeout(r, bootDelay));
src/copilot/bridges/mcp-tool-bridge.js:389:        _timer = setTimeout(async () => {
src/copilot/agent/dialog/loop-manager.js:375:                const timer = setTimeout(() => {
src/copilot/bridges/gh/ci.js:96:        await new Promise((r) => setTimeout(r, intervalMs));
src/copilot/agent/dialog/watchdog.js:91:        this.#timer = setInterval(() => {
src/copilot/observability/error-alerting.js:234:    _interval = setInterval(check, 30_000);
src/copilot/observability/metrics.js:277:        _snapshotTimer = setInterval(() => {
src/copilot/presentation/agent-control.js:112:            await new Promise((r) => setTimeout(r, Math.min(step.waitMs ?? 0, MAX_WAIT_MS)));
```

## 4. Testes `copilot` skipped/pending — 39 entradas

```text
tests/unit/copilot/test_session_keepalive.spec.js:13:describe.skip('SessionKeepalive', async () => {
tests/unit/copilot/test_config_tools_registry.spec.js:3:describe.skip('test_config_tools_registry.spec.js — API changed', () => {
tests/unit/copilot/test_config_tools_registry.spec.js:4:    it('pending reimplementation', () => {});
tests/unit/copilot/test_session_manager.spec.js:3:describe.skip('test_session_manager.spec.js — source module deleted', () => {
tests/unit/copilot/test_session_manager.spec.js:4:    it('pending reimplementation', () => {});
tests/unit/copilot/test_terminal_turn_serialization.spec.js:3:describe.skip('test_terminal_turn_serialization.spec.js — source module deleted', () => {
tests/unit/copilot/test_terminal_turn_serialization.spec.js:4:    it('pending reimplementation', () => {});
tests/unit/copilot/test_lib_permissions.spec.js:3:describe.skip('test_lib_permissions.spec.js — source module deleted', () => {
tests/unit/copilot/test_lib_permissions.spec.js:4:    it('pending reimplementation', () => {});
tests/unit/copilot/test_sse_utils.spec.js:3:describe.skip('test_sse_utils.spec.js — source module deleted', () => {
tests/unit/copilot/test_sse_utils.spec.js:4:    it('pending reimplementation', () => {});
tests/unit/copilot/test_permission_controller.spec.js:19:describe.skip('PermissionController › análise estrutural (G2-DX-12/13/15)', async () => {
tests/unit/copilot/test_sdk_api.spec.js:3:describe.skip('test_sdk_api.spec.js — source module deleted', () => {
tests/unit/copilot/test_sdk_api.spec.js:4:    it('pending reimplementation', () => {});
tests/unit/copilot/test_http_bridge_health.spec.js:3:describe.skip('test_http_bridge_health.spec.js — source module deleted', () => {
tests/unit/copilot/test_http_bridge_health.spec.js:4:    it('pending reimplementation', () => {});
tests/unit/copilot/test_http_handlers.spec.js:3:describe.skip('test_http_handlers.spec.js — source module deleted', () => {
tests/unit/copilot/test_http_handlers.spec.js:4:    it('pending reimplementation', () => {});
tests/unit/copilot/test_lib_models.spec.js:3:describe.skip('test_lib_models.spec.js — API changed', () => {
tests/unit/copilot/test_lib_models.spec.js:4:    it('pending reimplementation', () => {});
tests/unit/copilot/test_http_bridge_dialog.spec.js:3:describe.skip('test_http_bridge_dialog.spec.js — source module deleted', () => {
tests/unit/copilot/test_http_bridge_dialog.spec.js:4:    it('pending reimplementation', () => {});
tests/unit/copilot/test_session_manager_streaming.spec.js:3:describe.skip('test_session_manager_streaming.spec.js — source module deleted', () => {
tests/unit/copilot/test_session_manager_streaming.spec.js:4:    it('pending reimplementation', () => {});
tests/unit/copilot/test_lib_hooks.spec.js:3:describe.skip('test_lib_hooks.spec.js — API changed', () => {
tests/unit/copilot/test_lib_hooks.spec.js:4:    it('pending reimplementation', () => {});
tests/unit/copilot/test_sdk_client.spec.js:3:describe.skip('test_sdk_client.spec.js — source module deleted', () => {
tests/unit/copilot/test_sdk_client.spec.js:4:    it('pending reimplementation', () => {});
tests/unit/copilot/test_lib_client.spec.js:3:describe.skip('test_lib_client.spec.js — source module deleted', () => {
tests/unit/copilot/test_lib_client.spec.js:4:    it('pending reimplementation', () => {});
tests/unit/copilot/test_tool_audit_logger.spec.js:3:describe.skip('test_tool_audit_logger.spec.js — source module deleted', () => {
tests/unit/copilot/test_tool_audit_logger.spec.js:4:    it('pending reimplementation', () => {});
tests/unit/copilot/test_model_registry.spec.js:3:describe.skip('test_model_registry.spec.js — source module deleted', () => {
tests/unit/copilot/test_model_registry.spec.js:4:    it('pending reimplementation', () => {});
tests/unit/copilot/test_http_bridge_stream.spec.js:3:describe.skip('test_http_bridge_stream.spec.js — source module deleted', () => {
tests/unit/copilot/test_http_bridge_stream.spec.js:4:    it('pending reimplementation', () => {});
tests/integration/copilot/test_session_e2e.spec.js:3:describe.skip('test_session_e2e.spec.js — source module deleted', () => {
tests/integration/copilot/test_session_e2e.spec.js:4:    it('pending reimplementation', () => {});
tests/integration/copilot/test_always_alive_lifecycle.spec.js:143:describe.skip('AlwaysAliveAgent › ciclo stop/start › F4.7 (UPG-12)', { timeout: BOOT_TIMEOUT_MS * 7 }, () => {
```

## 5. Testes `copilot` que dependem de `vitest` — 97 arquivos

Motivo de incluir este bloco:

- `npm test` usa `node --test`;
- esta lista mostra o tamanho do desalinhamento;
- um caso representativo falhou de fato ao ser executado com `node --test`.

```text
tests/regression/copilot/test_lifecycle_a1_fixes.spec.js
tests/unit/copilot/test_core_abort_utils.spec.js
tests/unit/copilot/test_terminal_runtime_frontend.spec.js
tests/unit/copilot/terminal/test_handlers_system_metrics.spec.js
tests/unit/copilot/terminal/test_commands_export.spec.js
tests/unit/copilot/terminal/test_commands_context.spec.js
tests/unit/copilot/terminal/test_commands_diagnose.spec.js
tests/unit/copilot/terminal/test_commands_config_errors.spec.js
tests/unit/copilot/terminal/test_file_context.spec.js
tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js
tests/unit/copilot/terminal/test_commands_memory_resume_search.spec.js
tests/unit/copilot/test_error_alerting_jsonl.spec.js
tests/unit/copilot/test_cleanup.spec.js
tests/unit/copilot/channel/test_channel_modules.spec.js
tests/unit/copilot/config/test_faixa_c_session_config_builder.spec.js
tests/unit/copilot/config/test_custom_agents.spec.js
tests/unit/copilot/test_audit_pipeline.spec.js
tests/unit/copilot/test_plugin_registry.spec.js
tests/unit/copilot/terminal/test_commands_session.spec.js
tests/unit/copilot/test_client_dialog.spec.js
tests/unit/copilot/test_keepalive.spec.js
tests/unit/copilot/test_loop_manager.spec.js
tests/unit/copilot/test_agent_integration.spec.js
tests/unit/copilot/test_core_error_handlers.spec.js
tests/unit/copilot/sdk/test_sdk_config_path_f27.spec.js
tests/unit/copilot/sdk/test_sdk_barrel_f23.spec.js
tests/unit/copilot/sdk/test_sdk_events.spec.js
tests/unit/copilot/sdk/test_sdk_rpc_advanced.spec.js
tests/unit/copilot/sdk/test_sdk_tools.spec.js
tests/unit/copilot/sdk/test_sdk_provider.spec.js
tests/unit/copilot/sdk/test_sdk_permissions.spec.js
tests/unit/copilot/sdk/test_sdk_client_facade.spec.js
tests/unit/copilot/sdk/test_sdk_system_message.spec.js
tests/unit/copilot/sdk/test_custom_tools.spec.js
tests/unit/copilot/sdk/test_sdk_error_handling_f31.spec.js
tests/unit/copilot/sdk/test_sdk_constants.spec.js
tests/unit/copilot/sdk/test_sdk_quota_monitor_f25.spec.js
tests/unit/copilot/sdk/test_sdk_tools_registry_f28.spec.js
tests/unit/copilot/sdk/test_sdk_agents.spec.js
tests/unit/copilot/sdk/test_sdk_config.spec.js
tests/unit/copilot/sdk/test_sdk_types.spec.js
tests/unit/copilot/sdk/test_sdk_rpc.spec.js
tests/unit/copilot/sdk/test_sdk_migration_f19.spec.js
tests/unit/copilot/sdk/test_sdk_eslint_types_f20.spec.js
tests/unit/copilot/sdk/test_sdk_migration_tools.spec.js
tests/unit/copilot/sdk/test_sdk_client_events.spec.js
tests/unit/copilot/sdk/test_sdk_boot_auth_f24.spec.js
tests/unit/copilot/sdk/test_sdk_final_integration_f34.spec.js
tests/unit/copilot/sdk/test_sdk_telemetry.spec.js
tests/unit/copilot/sdk/test_sdk_models.spec.js
tests/unit/copilot/sdk/test_sdk_barrel.spec.js
tests/unit/copilot/sdk/test_sdk_client.spec.js
tests/unit/copilot/sdk/test_sdk_tool_stats_f32.spec.js
tests/unit/copilot/sdk/test_sdk_server_rpc_health.spec.js
tests/unit/copilot/sdk/test_sdk_zero_bypass_f33.spec.js
tests/unit/copilot/sdk/test_sdk_rpc_edge_cases.spec.js
tests/unit/copilot/sdk/test_sdk_session_lifecycle.spec.js
tests/unit/copilot/sdk/test_sdk_session_registry_f26.spec.js
tests/unit/copilot/test_session_setup.spec.js
tests/unit/copilot/sdk/test_sdk_consumer_migration_f30.spec.js
tests/unit/copilot/sdk/test_sdk_integration.spec.js
tests/unit/copilot/test_terminal_frontend_primary.spec.js
tests/unit/copilot/test_event_wiring.spec.js
tests/unit/copilot/agent/test_faixa_b_event_handlers.spec.js
tests/unit/copilot/agent/test_hook_context_webhook_manager.spec.js
tests/unit/copilot/hooks/test_presets.spec.js
tests/unit/copilot/hooks/test_faixa_e_hooks_optimization.spec.js
tests/unit/copilot/test_hooks_factory.spec.js
tests/unit/copilot/test_backpressure.spec.js
tests/unit/copilot/test_data_structures_metrics.spec.js
tests/unit/copilot/agent/test_always_alive_lazy_singleton.spec.js
tests/unit/copilot/contracts/test_di_contracts.spec.js
tests/unit/copilot/contracts/test_barrel_contracts.spec.js
tests/unit/copilot/contracts/test_services_contracts.spec.js
tests/unit/copilot/contracts/test_types_contracts.spec.js
tests/unit/copilot/contracts/test_arch_contracts.spec.js
tests/unit/copilot/tools/test_session_rpc_tools.spec.js
tests/unit/copilot/tools/test_code_permission_tools.spec.js
tests/unit/copilot/tools/test_git_tools.spec.js
tests/unit/copilot/tools/shell/test_shell_tools_expanded.spec.js
tests/unit/copilot/tools/test_introspection_tools.spec.js
tests/unit/copilot/tools/test_session_tools.spec.js
tests/unit/copilot/tools/test_web_tools.spec.js
tests/unit/copilot/tools/test_hub_tools.spec.js
tests/unit/copilot/tools/file/test_read_tools.spec.js
tests/unit/copilot/test_snapshot.spec.js
tests/unit/copilot/agent/test_agent_session_event_handlers.spec.js
tests/unit/copilot/tools/file/test_write_tools.spec.js
tests/unit/copilot/test_turn_executor.spec.js
tests/unit/copilot/observability/test_collectors.spec.js
tests/unit/copilot/observability/test_dialog_task_handlers.spec.js
tests/unit/copilot/observability/test_session_handlers.spec.js
tests/unit/copilot/observability/test_otel.spec.js
tests/unit/copilot/observability/test_tool_stats.spec.js
tests/unit/copilot/contracts/test_barrel_contracts_i7.spec.js
tests/unit/copilot/observability/test_metrics.spec.js
tests/unit/copilot/test_model_fallback.spec.js
```

## 6. Marcadores de TODO/FIXME/HACK/XXX — 21 sinais

```text
src/copilot/terminal/commands/diagnose.js:13: * - TODOs pendentes (top-5)
src/copilot/terminal/commands/diagnose.js:119:${C.cyan}  TODOs PENDENTES (top-5)${C.reset}
src/copilot/terminal/index.js:193:    // F7.1: cleanup diário de tarefas TODO antigas (done/cancelled > 7 dias)
src/copilot/events/schemas/builtin-schemas.js:5: * Schemas built-in para TODOS os 122 tipos de evento bus SSOT do sistema. Cobertura: 100% dos bus events.
src/copilot/sdk/session/client-events.js:134: * Subscreve a TODOS os lifecycle events do CopilotClient (wildcard).
src/copilot/sdk/session/events.js:182: * Subscreve a TODOS os eventos de uma sessão (wildcard).
src/copilot/db/README.md:5:Abstração de banco de dados para conversas, TODOs e estado do agente.
src/copilot/bridges/nerv-event-bus-adapter.js:7: * Escuta o **EventBus centralizado**, capturando TODOS os eventos (hooks, hub, services, system) — não só os do agent.
src/copilot/agent/session/hook-context.js:174:        // Contagem de TODOs pendentes (best-effort — falha silenciosa)
src/copilot/agent/session/hook-context.js:190:                `- TODOs ativos (todo/in_progress): ${pendingCount}`,
src/copilot/tools/README.md:13:| `todo/`            | Tools de gestão de TODOs (CRUD, bulk, queries) |
src/copilot/tools/todo/store.js:45:const TODOS_FILE = path.join(WORKSPACE_ROOT, '.github', 'hooks', 'state', 'todos.json');
src/copilot/tools/todo/store.js:61:        if (count.n === 0 && fs.existsSync(TODOS_FILE)) {
src/copilot/tools/todo/store.js:62:            const raw = fs.readFileSync(TODOS_FILE, 'utf8');
src/copilot/tools/todo/store.js:286:export const TODO_MAX_AGE_DAYS = 7;
src/copilot/tools/todo/store.js:292: * @param {number} [maxAgeDays] - Limite de retenção em dias (default: {@link TODO_MAX_AGE_DAYS})
src/copilot/tools/todo/store.js:295:export async function cleanupExpiredTasks(maxAgeDays = TODO_MAX_AGE_DAYS) {
src/copilot/tools/todo/store.js:336:    const { intervalMs = 24 * 60 * 60 * 1000, maxAgeDays = TODO_MAX_AGE_DAYS } = opts;
src/copilot/tools/introspection-tools.js:73:// TODO(RF-026): derivar categorias do ToolRegistry para evitar manutenção manual.
src/copilot/config/system-prompt/sections/tool-instructions.js:15:- **manage_todo_list**: Atualize TODOs a cada conclusão de tarefa. Último TODO = vscode_askQuestions.
src/copilot/config/system-prompt/sections/last-instructions.js:11:1. Confirme que manage_todo_list está atualizado com todos os TODOs completados.
```

## 7. Observações finais para próximas ondas

### Itens prontos para patch quase direto

- proteger `/steer`;
- corrigir CORS;
- impedir join/history/list sem autorização por sessão;
- limpar timers de `Promise.race`;
- tornar `writeJson()` realmente atômico;
- adicionar trava de reentrância em keepalive.

### Itens que pedem design, não só patch

- correlação robusta de turnos em `LlmBridgeClient`;
- modelo de ownership de `hubSession`;
- unificação de runners de teste;
- política padrão de tratamento para `logSwallowed`.

### Itens que merecem nova varredura dedicada

- observabilidade/event-collector;
- watchers/hot-reload de `PinnedFilesLoader`;
- shell tooling e sandboxing;
- health/metrics/public routes contract.

