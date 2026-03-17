# Política de Versionamento de Contratos (F8.1)

## Escopo

Esta política define como versionar e evoluir contratos executáveis do sistema de hooks, com foco em policy/stop.

## Contratos canônicos

- `contracts/session-context.schema.json` (estado persistido da sessão)
- `contracts/turn-authorization-context.schema.json` (contexto executável de autorização do TURN)
- `contracts/stop-decision.schema.json` (payload de decisão do `agentStop`)
- `contracts/events-contract.md` (contrato semântico de eventos)
- `contracts/contract-registry.json` (registro de versões e nível de compatibilidade)

## Regras de compatibilidade

1. **SemVer obrigatório** por contrato (`MAJOR.MINOR.PATCH`).
2. **PATCH**: correções sem alterar shape/semântica observável.
3. **MINOR**: adição de campos opcionais, mantendo retrocompatibilidade.
4. **MAJOR**: remoção, renomeação ou mudança de tipo/campo obrigatório.
5. **Dual shape obrigatório** no `agentStop` enquanto houver consumidores legados:
   - top-level (`decision`, `decisionReason`) **e**
   - `hookSpecificOutput` canônico.
6. **Dual read obrigatório** para eventos legados quando aplicável (ex.: `toolFailure` e `toolUseFailure`).

## Fluxo de mudança

1. Atualizar `contracts/contract-registry.json` (versão + path + nível de compatibilidade).
2. Atualizar o contrato alvo (`.json`/`.md`) com nota de versão.
3. Atualizar `events-contract.md` se houver impacto de evento/campo.
4. Atualizar smoke/checks contratuais (subfase F8.2).
5. Sincronizar `ROADMAP`, `PLANO` e `pending-tasks.md`.

## Critério de aceite F8.1

- Contratos de **policy/stop** com versão explícita e registro centralizado.
- Regras de compatibilidade formalizadas neste documento.
- Registro de contratos publicado em `contract-registry.json`.
