# CODEX_AUDIT_PLAYBOOK

## Objetivo
Padronizar execucao da auditoria continua em ondas, com rastreabilidade no tracker vivo.

## Fluxo Canonico por Rodada
1. Preflight semantico:
   - `npm run audit:preflight`
2. Baseline de runtime:
   - `npm run daemon:status`
   - `npm run mcp:diagnose`
   - `npm run rag:health -- --json`
3. Triagem rapida:
   - `npm run audit:quick`
4. Foco por onda (A-E):
   - coletar P0/P1
   - propor correcoes com causa-raiz Top 3
   - definir rollback e testes
5. Atualizar artefatos de governanca:
   - `DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_TRACKER.md`
   - `DOCUMENTAÇÃO/BUGS/rodadas/CODEX_AUDIT_<YYYY-MM-DD_HH-mm>.md`

## Rotina Gradual por Ondas (Codigo Inteiro)
1. Onda A: `src/main.js`, `src/server/main.js`, `src/server/engine/*`
2. Onda B: `src/core/*`, `src/nerv/*`, `src/integration/*`
3. Onda C: `src/driver/*`, `src/infra/*`, `src/logic/*`
4. Onda D: `src/server/api/*`, `src/server/dashboard-api/*`, `src/server/realtime/*`
5. Onda E: `src/dashboard-ui/*` + integração ponta-a-ponta

### Critério Objetivo por Onda
- Triagem `P0/P1` primeiro.
- Causa-raiz Top 3 por achado.
- Patch proposto + rollback.
- Comandos de validação explícitos.
- Atualização obrigatória de tracker e snapshot.

## Gate para RAG Degradado
- Se `rag:health` reportar `ok=false`, seguir em modo lexical.
- Marcar risco explicitamente no tracker e no snapshot.
- Nao bloquear triagem P0/P1 por indisponibilidade de embedding.

## Estrutura de Saida por Achado
- `bug_id`
- `severidade`
- `tipo`
- `causa_raiz_top3`
- `patch_proposto`
- `comandos_validacao`
- `rollback`
