# CHECKLIST 05: Contratos de Dominio (Fonte de Verdade)

Objetivo

- Definir tipos canonicos para os objetos centrais do sistema.
- Reduzir dependencia de `src/types/*/augmentations.d.ts` com `unknown`.

Checklist (contratos prioritarios)

1. Task V5

- [ ] Definir `TaskV5` canonico (meta, spec, policy, state, history, result).
- [ ] Definir enums/literais canonicos:
  - [ ] `STATUS_VALUES`
  - [ ] `TaskState` (lifecycle)
  - [ ] `CONNECTION_MODES`
- [ ] Garantir que:
  - [ ] Queue cache, scheduler, loader usam `TaskV5`.
  - [ ] Controllers retornam shapes consistentes.

2. Driver Contracts

- [ ] Tipar `TargetDriver` e `BaseDriver` como interface publica.
- [ ] Tipar “module mesh” (recovery, handles, inputResolver, frameNavigator, biomechanics,
      submission).
- [ ] Tipar o “execution envelope” de mensagens NERV relacionadas a Driver.

3. NERV Message Contracts

- [ ] Tipar `Envelope` (kind/type, actorRole, actionCode, payload).
- [ ] Tipar payloads por `actionCode` (discriminated union).

4. HTTP API Contracts

- [ ] Tipar request/response por endpoint critico:
  - [ ] tasks
  - [ ] dna
  - [ ] health
  - [ ] rag

5. Observability Contracts

- [ ] Tipar logs estruturados (shape minima).
- [ ] Tipar telemetria (KernelTelemetry).

Guia pragmatico (como tipar)

- [ ] Preferir `unknown` na fronteira.
- [ ] Validar com Zod ao entrar.
- [ ] Usar tipo concreto internamente.

Definição de Pronto (DoD)

- Existe um conjunto de tipos canonicos para Task/Driver/NERV/API.
- `src/types/*/augmentations.d.ts` vira suporte fino, nao “tipo principal”.
- `npm run typecheck` verde.

Riscos comuns

- Fazer contrato “bonito” mas divergente do runtime. Tipos devem ser derivados do codigo real, ou o
  codigo deve ser ajustado.

---

Arquivo gerado automaticamente por solicitação. Não farei commit/push sem sua autorização.
