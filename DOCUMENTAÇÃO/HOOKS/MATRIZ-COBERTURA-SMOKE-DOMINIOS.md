# Matriz de Cobertura — Smoke por Domínios (F5.3)

**Data**: 2026-03-15 **Escopo**: consolidar a cobertura da decomposição da suíte smoke por domínio.

## Entrypoints

- Legado compatível: `.github/hooks/scripts/smoke-test.sh`
  - `--quiet`: reduz saída
  - `--domains`: delega para agregador de domínios
  - `--all`: roda legado + agregador de domínios
- Agregador de domínios: `.github/hooks/scripts/smoke-test-domains.sh`

## Matriz domínio → suíte → cobertura

| Domínio  | Suíte                                                   | Cobertura principal                                                                                                                         |
| -------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Core     | `.github/hooks/scripts/smoke-domains/smoke-core.sh`     | Dependências básicas, presença/executabilidade dos hooks críticos, blocos mínimos de `session-context.json`, presença do protocolo canônico |
| Policy   | `.github/hooks/scripts/smoke-domains/smoke-policy.sh`   | Integração com `hooks-lib/policy.sh`, uso de helpers `policy_*`, reason codes críticos de autorização/continuidade                          |
| Recovery | `.github/hooks/scripts/smoke-domains/smoke-recovery.sh` | Guards de `session_id`, sinais de HEAL v2 no fluxo do stop, cobertura de watchdog para cenários stale/auto-recovery                         |
| Close    | `.github/hooks/scripts/smoke-domains/smoke-close.sh`    | Contratos de fechamento com `close_key_validated`, eventos de autorização/rejeição, idempotência no pós-tool, hardening de close no stop    |
| Git Push | `.github/hooks/scripts/smoke-domains/smoke-git-push.sh` | Evento `gitPush`, flag `pending_section_after_push`, integração com `continue-section`, instalação de pre-push                              |

## Critérios de aprovação por domínio

- Cada suíte retorna `exit 0` quando não há falhas.
- Cada suíte falha com `exit > 0` quando qualquer check obrigatório quebra.
- O agregador retorna o número de domínios com falha.

## Observações de compatibilidade

- O fluxo legado foi preservado (modo padrão de `smoke-test.sh`).
- A decomposição por domínios é incremental e não substitui de imediato os checks legados de alta
  granularidade.
- `--all` permite coexistência e comparação contínua entre legado e domínio durante rollout.
