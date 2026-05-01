# 103 — Plano de execução para convergência canônica geral (`src/copilot`)

**Data:** 2026-05-01
**Objetivo:** executar a transição final para fluxo canônico unificado em todas as camadas.

---

## 1) Estratégia de execução

- **Onda curta, validação contínua** (`typecheck:strict`, `lint`, `test:unit`);
- **contract-first** para impedir regressão enquanto migra;
- **uma dívida paralela por vez** (fechar PR antes de abrir novo);
- **telemetria e metadata explícita** em fallback/compat paths.

---

## 2) Backlog executivo por ondas

## Onda E1 — Governança de fronteira de fluxo (imediata)

**Meta:** bloquear reabertura de bypasss arquiteturais.

Ações:

1. criar contrato de fronteira para manter `#copilot/channel` isolado no gateway de diálogo do terminal;
2. reforçar regra de composição em `server/routes/sdk/*` (via `deps.js`);
3. documentar matriz de fluxos e prioridade de convergência.

Critério de pronto:

- novo contrato verde em `tests/unit/copilot/contracts/*`;
- docs 100–103 publicadas.

## Onda E2 — Convergência de fallback de runtime

**Meta:** transformar fallback implícito em fallback explícito e auditável.

Ações:

1. padronizar metadata `requestedRuntimeId/runtimeId/runtimeFound/usedDefaultRuntimeFallback` em todas as bordas;
2. elevar fallback silencioso a warning canônico de projection;
3. adicionar testes de regressão para fallback e runtime inexistente.

Critério de pronto:

- ausência de fallback silencioso em command/route crítico.

## Onda E3 — Timeline unificada de sessão/diálogo

**Meta:** reduzir dualidade `llmBridgeClient.history` vs histórico de sessão SDK.

Ações:

1. definir projection reconciliada de timeline;
2. ajustar `/now` e diagnostics para expor origem de timeline;
3. criar trilha de migração sem quebrar UX atual.

Critério de pronto:

- uma narrativa canônica de histórico por runtime.

## Onda E4 — Redução de compat paths

**Meta:** reduzir caminhos paralelos controlados.

Ações:

1. planejar sunset do `server/handler-bridge.js`;
2. reduzir dependência de `wireLegacySetters`;
3. consolidar política PM2/compat entrypoint com guardrails de execução única.

Critério de pronto:

- compat paths com uso residual mínimo e janela de remoção definida.

## Onda E5 — Multi-runtime/multi-agent readiness

**Meta:** estruturar base de expansão futura.

Ações:

1. reforçar isolamento por `runtimeId` em concorrência/stream/rate-limiter;
2. introduzir metadata de `agentProfileId` por runtime;
3. preparar contratos de capabilities por profile.

Critério de pronto:

- runtimes múltiplos e profiles preparados sem quebrar default runtime.

---

## 3) Priorização objetiva (próximas 2 semanas)

1. **E1** (agora)
2. **E2** (seguida)
3. **E3** (em paralelo de baixo risco com E2)
4. **E4**
5. **E5**

---

## 4) Execução iniciada nesta rodada

- investigação profunda transversal concluída;
- mapeamento e matriz de fluxos publicados (docs 100/101);
- TO-BE unificado publicado (doc 102);
- plano executivo detalhado publicado (doc 103);
- onda E1 iniciada com criação de contrato arquitetural novo (ver `tests/unit/copilot/contracts/test_canonical_flow_governance.spec.js`).

---

## 5) Gate de validação por onda

Comandos obrigatórios por merge de onda:

```bash
npm run typecheck:strict
npm run lint
npm run test:unit
```

Recomendado durante execução incremental:

```bash
npx vitest run tests/unit/copilot/contracts/*.spec.js
```

---

## 6) Definição de sucesso

O plano está completo quando:

- todos os fluxos críticos operam em caminho canônico único;
- paralelos PR = 0;
- paralelos PC com sunset explícito;
- multi-runtime/multi-agent preparado com contratos e isolamento comprovado.
