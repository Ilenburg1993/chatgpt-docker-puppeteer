# 102 — Situação ideal unificada canônica (multi-runtime + multi-agent)

**Data:** 2026-05-01 **Objetivo:** definir o TO-BE unificado para todos os fluxos de `src/copilot`
sem perda de funcionalidade e com espaço de expansão futura.

---

## 1) Princípio orientador

> Qualquer capacidade deve nascer no owner canônico da camada, ser projetada por superfície pública
> estável e chegar às bordas como adapter fino.

---

## 2) Arquitetura alvo unificada

```text
Control Plane (commands/contracts/governance)
  -> Boot Plane (boot/config/plan/lifecycle-runner)
    -> Runtime Plane (agent/* + runtime-registry)
      -> Capability Plane (sdk/* + facades + ports)
        -> Projection Plane (presentation/*)
          -> Edge Plane (server/*, terminal/*)
            -> Transport Plane (channel/*, SSE, socket)

Cross-cutting: events/*, event-handlers/*, observability/*, audit/*
```

---

## 3) SSOTs finais por domínio

| Domínio                                | SSOT ideal                                                            |
| -------------------------------------- | --------------------------------------------------------------------- |
| boot e faseamento                      | `boot/*`                                                              |
| runtime vivo do agente                 | `agent/*`                                                             |
| seleção e targeting de runtime         | `presentation/runtime-targeting.js` + `presentation/agent-runtime.js` |
| capacidades vanilla do SDK             | `sdk/*`                                                               |
| tradução de `SessionEvent`             | `event-handlers/*`                                                    |
| projeções compartilhadas de borda      | `presentation/*`                                                      |
| UX terminal                            | `terminal/*`                                                          |
| protocolo HTTP/SSE/Socket              | `server/*`                                                            |
| transporte LLM-A↔LLM-B                 | `channel/*`                                                           |
| sessão conversacional e memória        | `conversation-hub/*`                                                  |
| observabilidade e trilhas de auditoria | `observability/*` + `audit/*`                                         |

---

## 4) Invariantes de canonicidade (obrigatórios)

1. **Single canonical boot path** para runtime local.
2. **No semantic re-implementation** de capability SDK fora de `sdk/*`.
3. **No direct edge-to-runtime internals**: bordas passam por façades/projections.
4. **Runtime selection explícita**: toda borda informa `requestedRuntimeId`, `runtimeId`, fallback.
5. **Event translation única**: sessão SDK sempre entra por `event-handlers/*`.
6. **Fallbacks temporários com sunset**: sem fallback indefinido.

---

## 5) Modelo alvo multi-runtime

## 5.1 Runtime identity model

Cada runtime deve possuir envelope padrão:

- `runtimeId` (chave estável);
- `runtimeType` (default/tenant/sandbox/background);
- `agentProfileId`;
- `sessionBinding` (`sdkSessionId`, `hubSessionId`);
- `health/status`;
- `capabilitySnapshot`.

## 5.2 Isolamento mínimo obrigatório

- locks/filas por `runtimeId`;
- stream channels por `runtimeId` (e quando aplicável `runtimeId:sessionId`);
- rate-limiter state por `runtimeId`;
- ownership de sessão sem estado global implícito fora de registries oficiais.

## 5.3 Seleção/fallback seguro

- fallback para runtime default só ocorre com metadata explícita;
- payloads de status/diagnose sempre evidenciam fallback;
- fallback silencioso passa a ser violação contratual.

---

## 6) Modelo alvo multi-agent

## 6.1 Separar runtime de agent profile

- `runtime` = instância viva operacional;
- `agent profile` = policy/persona/capabilities;
- mapeamento `runtimeId -> agentProfileId` explícito e versionado.

## 6.2 Capabilities por profile

- catálogo de tools/hooks/policies por profile;
- profile define restrições de execução/permissão;
- projeções de borda mostram profile ativo e capabilities habilitadas.

## 6.3 Estratégia de evolução segura

- iniciar com multi-runtime homogêneo (mesmo profile);
- evoluir para multi-profile por feature flag;
- manter compatibilidade do runtime default durante toda a transição.

---

## 7) Situação ideal por borda

## 7.1 Server

- routers 100% adapters;
- `server/routes/sdk/*` sempre via `deps.js`;
- zero payload de domínio montado ad hoc fora de `presentation`.

## 7.2 Terminal

- frontend usa apenas `gateways/*` + `projections/*` + `frontend/index.js`;
- comandos não conhecem internals de runtime;
- fallback SSE reduzido ao mínimo e eventualmente removido.

## 7.3 Channel

- canal de transporte puro;
- sem assumir ownership de timeline de sessão canônica;
- timeline de UX reconciliada por projection unificada.

---

## 8) Critérios de pronto TO-BE

1. nenhum fluxo PR aberto na matriz canônico/paralelo;
2. fluxos PC com sunset e telemetria;
3. cobertura contratual dos boundaries críticos;
4. suporte a múltiplos runtimes com isolamento comprovado;
5. profile multi-agent endereçável sem quebrar default runtime.

---

## 9) Resultado esperado

Com o TO-BE aplicado, `src/copilot` passa a ter:

- uma arquitetura canônica única por domínio;
- expansão previsível para multi-runtime/multi-agent;
- mais funcionalidade sem regressão de governança;
- menor custo cognitivo por fluxo operacional.
