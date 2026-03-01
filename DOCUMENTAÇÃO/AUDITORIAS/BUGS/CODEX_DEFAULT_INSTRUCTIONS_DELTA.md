# CODEX_DEFAULT_INSTRUCTIONS_DELTA

## Regras Operacionais Locais (Auditoria Continua)

1. Sempre iniciar rodada com preflight semantico (`npm run audit:preflight`).
2. Sempre registrar evidencia no tracker vivo (`CODEX_AUDIT_TRACKER.md`).
3. Sempre separar `P0/P1` (canal primario) de backlog tecnico (`P2/P3`).
4. Toda correcao deve incluir:
   - comando de validacao,
   - risco de regressao,
   - hint de rollback.
5. Se RAG estiver degradado, seguir com fallback lexical e risco marcado.
6. Em ondas incrementais, fechar escopo da rodada antes de abrir nova onda.

## Referencias

- Tracker: `DOCUMENTAÇÃO/AUDITORIAS/BUGS/CODEX_AUDIT_TRACKER.md`
- Playbook: `DOCUMENTAÇÃO/AUDITORIAS/BUGS/CODEX_AUDIT_PLAYBOOK.md`
