---
name: audit-agent-background-llm-ops
description:
  'Use when implementing or operating the background Audit Agent (LLM engineering assistant), including inference-gateway policies, ollama host supervisor, job pipeline, approval flow, and CPU/budget controls.'
---

# Audit Agent Background LLM Ops

## Overview

Skill para implementação e operação do novo subsistema `Audit Agent` neste repositório.
Foco: `Audit Agent` + `Inference Gateway` + `ollama-host-supervisor` + integração com `MCP/LSP/RAG`
sem violar SSOT/control-plane.

## When To Use

- Criar o `audit-agent` em PM2.
- Implementar `Inference Gateway` e políticas por `clientTag`.
- Diagnosticar uso excessivo de CPU por consumidores de LLM (com correção cirúrgica por tag/policy).
- Integrar jobs/findings/patches ao dashboard/control plane.
- Implementar rollout semi-auto com `dry-run` + approval.

## Canonical Principles

1. `Audit Agent` não substitui `audit runner`.
2. Toda mutação passa por `control_command_service`.
3. Inferência requer `clientTag` obrigatório.
4. `LSP/TSServer` e `RAG` são fontes de contexto/semântica, não governança de patch.
5. V1 é `semi_auto`: sem apply automático de patch.

## Minimal Implementation Order

1. Governança/documentação (`CODEX_AUDIT_AGENT_MASTER_PLAN.md` + tracker)
2. Contratos anti-confusão (`InferenceClientTag`, policies, budgets)
3. `ollama-host-supervisor` + readiness/degraded
4. `Inference Gateway` (generate/embed/listModels)
5. Domínio DB (`audit_jobs/*`, `inference_*`)
6. `audit-agent` loop básico (manual jobs)
7. Control plane `AUDIT_*` / `INFERENCE_*`
8. Dashboard/realtime

## Operational Guardrails

- `AUDIT_AGENT_MAX_CONCURRENT_JOBS=1` (V1)
- `AUDIT_AGENT_MAX_PARALLEL_LLM_CALLS=1` (V1)
- Budgets/timeout/circuit breaker por `clientTag`
- `dry-run` obrigatório antes de `AUDIT_PATCH_APPLY`
- `reason` + `idempotency_key` obrigatórios para comandos críticos

## Done Criteria (per phase)

- Runtime atual permanece estável (`audit:quick`, `typecheck:full`, `lint --quiet` verdes)
- Sem side effects de import nos entrypoints
- Realtime/SSOT/control-plane preservados
- Nova funcionalidade entra atrás de flags/defaults seguros
