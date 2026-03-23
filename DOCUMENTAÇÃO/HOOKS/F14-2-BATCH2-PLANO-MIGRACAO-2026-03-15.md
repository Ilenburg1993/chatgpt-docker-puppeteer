# F14.2 — Batch 2 (3 hooks restantes) — Plano de migração segura

**Data**: 2026-03-15 **Fase**: F14.2 (em execução) **Escopo restante**: `pre-tool-use`,
`post-tool-use`, `session-start`

## Diagnóstico rápido de complexidade

| Script                     | Linhas | Funções locais | Risco dominante                                   |
| -------------------------- | -----: | -------------: | ------------------------------------------------- |
| `scripts/pre-tool-use.sh`  |   1059 |              1 | policy de autorização + redaction + guards        |
| `scripts/post-tool-use.sh` |    895 |              1 | pós-decisão de policy + validação askQuestions    |
| `scripts/session-start.sh` |   1177 |              1 | bootstrap crítico da sessão + briefing + recovery |

## Estratégia recomendada (ordem)

1. **`pre-tool-use.sh`** (pré-policy)
2. **`post-tool-use.sh`** (pós-policy, depende da semântica pre)
3. **`session-start.sh`** (bootstrap crítico, por último)

## Contrato de migração por script

Para cada hook restante, aplicar o mesmo padrão usado em `session-end` e subagents:

1. Script vira entrypoint fino (bootstrap + source common/policy/core/aux + source entry-lib +
   dispatch).
2. Lógica principal migra para `run_<hook>_hook` na entry-lib dedicada.
3. Diagnóstico via `get_errors` após cada migração.
4. Atualizar `.github/hooks/state/f14-auto-hook-entry-lib-status.json` imediatamente.

## Regras de segurança de rollout

- **Não mudar contratos externos** (payloads, reason-codes, eventos).
- Manter fallback/warnings em `source` para não quebrar runtime se lib falhar.
- Evitar refactors colaterais: só extração script->entry-lib nesta fase.
- Atualizar roadmap/plano a cada avanço parcial relevante.

## Critério de saída do Batch 2

- Os 3 hooks remanescentes migrados para entry-libs dedicadas.
- `f14-auto-hook-entry-lib-status.json` com `migrated_in_f14_2=8` (excluindo `agentStop`
  referência).
- F14.2 marcada como concluída no ROADMAP/PLANO.
