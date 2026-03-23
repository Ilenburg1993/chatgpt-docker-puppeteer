# F7.2 — Matriz de Acoplamento por Domínio (2026-03-16)

## Escopo

Análise do acoplamento do sistema de hooks entre `scripts/` e `hooks-lib/`, com foco em risco de
regressão e custo de rollback.

## Matriz

| Domínio         | Superfície principal                                  | Acoplamento atual | Risco  | Custo de rollback | Ação prioritária                                                              |
| --------------- | ----------------------------------------------------- | ----------------- | ------ | ----------------- | ----------------------------------------------------------------------------- |
| Runtime         | `common.sh`, `config.sh`, scripts automáticos         | Alto              | **P1** | Médio             | Fatiar helpers de runtime/contexto sem quebrar contratos de entrada/lock      |
| Policy          | `policy.sh`, `agent-stop-lib.sh`, `pre/post-tool-use` | Alto              | **P0** | Alto              | Isolar reason-codes e decisões de fechamento em checks contratuais explícitos |
| Lifecycle       | `session-start/end`, `subagent-*`, `pre-compact`      | Médio/Alto        | **P1** | Médio             | Consolidar start/end core/aux e reduzir regras inline remanescentes           |
| Audit/Reporting | `audit.jsonl`, `generate-*`, `sync-transcript-*`      | Médio             | **P2** | Baixo/Médio       | Padronizar emitters e formato de eventos/sumários                             |
| Maintenance     | backlog/findings/rotate/sync                          | Médio             | **P2** | Baixo             | Convergir wrappers recém-criados para uso progressivo nos scripts             |
| Testing         | `smoke-test*.sh`, `verify-script-lib-coverage.sh`     | Alto              | **P0** | Médio             | Completar split de cenários V90/AS e integrar check estrutural em gate        |

## Hotspots técnicos (ranking)

1. **P0** `hooks-lib/agent-stop-lib.sh` — alta densidade de regras e impacto transversal.
2. **P0** `scripts/smoke-test.sh` — volume alto e diagnóstico ainda concentrado.
3. **P1** `hooks-lib/common.sh` — domínio híbrido (runtime/context/recovery/subturn).
4. **P1** `scripts/session-start.sh` e `scripts/session-end.sh` — coordenação lifecycle + side-jobs.
5. **P2** scripts operacionais manuais — baixa criticidade, mas agora com cobertura Script↔Lib
   formalizada.

## Resultado

- Matriz de acoplamento publicada para orientar execução F7.3/F8/F9.
- Priorização inicial definida em P0/P1/P2 com foco em risco real de regressão.

## Subfases adicionais propostas para fechar F7 com rigor

- **F7.7** Migrar módulos legados do root de `hooks-lib/` para subpastas por domínio.
- **F7.8** Publicar índice machine-readable (`script/lib/domínio/owner`).
- **F7.9** Consolidar governança de diretórios (`README` e naming canônico).
- **F7.10** Integrar `verify-script-lib-coverage.sh` ao fluxo canônico de validação.
