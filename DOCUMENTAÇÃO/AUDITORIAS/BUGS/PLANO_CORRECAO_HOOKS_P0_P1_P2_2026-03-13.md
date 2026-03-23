# Plano de Correção por Ondas — Hooks + Instruções

- **Data**: 2026-03-13
- **Origem**: `AUDITORIA_HOOKS_PROFUNDA_2026-03-13.md`
- **Escopo aprovado**: scripts de hooks **+** `AGENTS.md` **+** instruções correlatas

## Objetivo

Eliminar primeiro os riscos de bloqueio indevido/encerramento incorreto de sessão (P0), normalizar
contrato e métricas (P1), e finalizar com hardening de qualidade/shell hygiene (P2).

## Status de execução (atual)

- **P0**: 🔄 Em andamento (H001, H004, H005 concluídos + novo foco H049/H050/H051/H052/H053)
- **P1**: ⏳ Pendente
- **P2**: ⏳ Pendente

### Novo bug confirmado (foco imediato P0)

- **P0-H049 — Recovery contaminado por checkpoint sintético**
  - Sintoma: sessão iniciou com `recovery.close_mode=abrupt_no_key` indevido.
  - Evidência: arquivo real em runtime `.github/hooks/checkpoints/sess_test123_turn10.json` foi
    eleito como sessão anterior, gerando alerta falso de encerramento incorreto.
  - Impacto: briefing e telemetria acusam encerramento incorreto mesmo sem incidente real.

- **P0-H050 — Ausência de sanidade em seleção de checkpoint**
  - Gap: seleção usava apenas recência (`find|sort`) sem filtrar artefatos de teste e sem validar
    `checkpoint_ts` no futuro.
  - Impacto: qualquer fixture residual pode contaminar recovery e induzir ações erradas no começo da
    sessão.

- **P0-H051 — Divergência semântica TURN x SESSION em docs de referência**
  - Gap: critérios de encerramento legítimo de TURN variam entre documentos canônicos e
    implementação atual.
  - Impacto: interpretações inconsistentes de “turno encerrado corretamente” e risco de regressão de
    protocolo.

- **P0-H052 — Falso positivo no guard de `session-close.sh` (Mechanism 5)**
  - Sintoma: evento `sessionClose_direct_blocked` disparado em comando legítimo de `git add` apenas
    por citar o caminho do arquivo `session-close.sh` como argumento.
  - Causa: detecção textual ampla (substring) tratava qualquer ocorrência de `session-close.sh` como
    execução direta.
  - Impacto: bloqueios indevidos, ruído de auditoria e diagnóstico incorreto de tentativa de
    encerramento de sessão.

- **P0-H053 — Recovery stale persistido no contexto ativo**
  - Sintoma: `session-context` permanece com `recovery.close_mode=abrupt_no_key` e `prev_session_id`
    sintético mesmo após correções no `session-start.sh`.
  - Causa: o bloco `recovery` contaminado em sessão antiga não era reavaliado/neutralizado durante o
    ciclo normal de tools.
  - Impacto: briefing e telemetria seguem sinalizando incidente já mitigado, gerando ações
    operacionais indevidas.

### Evidências rápidas da P0

- `agent-stop.sh`: Nível 3 agora é **opt-in** via `session.enforce_close_key_on_stop`.
- `pre-tool-use.sh`: guard de `git push` virou telemetria (`gitPush_detected` /
  `gitPush_requires_template_g`) sem bloqueio por close_key.
- `post-tool-use.sh`: validação de close key feita por parse estruturado de `answers`.

### Validação executada

- `bash -n` nos 3 scripts alterados: **OK**.
- `shellcheck` nos 3 scripts: sem erros novos críticos; warnings históricos SC2015 permanecem.
- `smoke-test.sh --quiet`: **1 falha pré-existente** (`session-start.sh` classificado no teste de
  guard), sem indício de regressão da P0.

---

## Onda P0 (bloqueadores operacionais)

### Itens

1. **H001** — `agent-stop.sh`: remover bloqueio global por `close_key_validated=false` em fim de
   TURN.
2. **H004** — `pre-tool-use.sh`: desacoplar guard de `git push` do estado `close_key_validated`.
3. **H005** — `post-tool-use.sh`: validação de close key apenas por parse estruturado de `answers`.
4. **H049** — `session-start.sh`: ignorar checkpoints sintéticos (`sess_test*`) na detecção de
   sessão anterior.
5. **H050** — `session-start.sh`: descartar checkpoints com `checkpoint_ts` no futuro (sanity
   check).
6. **H051** — harmonizar semântica de encerramento TURN/SESSION entre contrato executável e docs de
   referência.
7. **H052** — `pre-tool-use.sh`: restringir bloqueio do Mechanism 5 apenas a invocação direta de
   `session-close.sh`.
8. **H053** — `pre-tool-use.sh`: sanitizar `recovery` stale já persistido (sessão antiga
   contaminada).

### Entregáveis técnicos

- Ajuste de gating em `agent-stop.sh` para ativar regras de close apenas quando houver intenção
  explícita de encerramento de SESSION.
- Guard de push migrado para lógica de autorização própria (Template G), sem travar fluxo normal de
  entrega.
- Parser de resposta de `vscode_askQuestions` robusto (sem `grep` textual amplo no payload).
- Hardening de recovery em `session-start.sh` com filtro anti-fixture + validação temporal de
  checkpoint.
- Novo cenário de regressão no `test-level1-detect.sh` garantindo que checkpoint sintético não
  contamina recovery.
- Matriz de convergência TURN/SESSION baseada nos documentos de referência canônicos.
- Regressão no smoke-test garantindo: (a) `session-close.sh` como argumento **não bloqueia**; (b)
  chamada direta continua **bloqueada**.
- Regressão no smoke-test garantindo saneamento de `recovery` contaminado no runtime (sess_test\* →
  `close_mode=ok`).

### Critérios de aceite

- TURN normal finaliza sem exigir Template F.
- `git push` não é bloqueado em fluxo normal de trabalho.
- Key só valida quando aparece no campo esperado da resposta do usuário.
- Checkpoint sintético em runtime não altera `recovery.close_mode` (permanece `ok` sem sessão válida
  anterior).
- Checkpoint com timestamp futuro não é usado para inferência de sessão anterior.
- Semântica de legitimidade de encerramento alinhada entre implementação e docs canônicos.
- Guard anti-M5 não gera falso positivo quando `session-close.sh` aparece apenas como argumento de
  outro comando.
- Contexto ativo não mantém `recovery` contaminado após a primeira execução de ferramenta.

### Validação

- `npm run lint`
- `bash .github/hooks/scripts/smoke-test.sh`
- cenário manual: turno normal (sem intenção de close), push normal, fechamento com Template F
  válido.
- `bash .github/hooks/test-level1-detect.sh` com cenário anti-contaminação (synthetic checkpoint
  ignored).

### Referências obrigatórias desta onda (canônicas)

- `DOCUMENTAÇÃO/HOOKS/GUIA-HOOKS-COPILOT.md`
- `DOCUMENTAÇÃO/HOOKS/ARQUITETURA-CANONICA-SESSION-SECTION-TURN-SUBTURN.md`

---

## Onda P1 (consistência de contrato e observabilidade)

### Itens

1. **H002/H003/H012** — alinhar protocolo entre scripts e docs (`session-start.sh`,
   `.github/AGENTS.md`, instruções).
2. **H008/H009** — corrigir nomenclatura de eventos/campos de compliance.
3. **H010/H011** — corrigir fluxo de SID após `heal_v1` em subagentes.
4. **H006** — revisar estado intermediário entre `session-close` e `sessionEnd` real.

### Entregáveis técnicos

- Contrato único para encerramento de SESSION, sem instruções conflitantes.
- Métricas coerentes entre produção de eventos e leitura em relatórios.
- SID consistente em start/stop de subagente após heal.
- Estado de sessão com transição explícita (`pending_close_authorized` ou equivalente).

### Critérios de aceite

- Sem conflitos textuais em `AGENTS.md` e briefing gerado.
- Contadores de unauthorized condizem com eventos reais.
- Sem logs de SID divergente pós-heal em subagentes.

### Validação

- `npm run lint`
- `bash .github/hooks/scripts/smoke-test.sh`
- inspeção de `audit.jsonl` em cenário de reconnect + subagente.

---

## Onda P2 (higiene e robustez shell)

### Itens

- **H013–H048**: corrigir warnings ShellCheck (SC2015/SC2016/SC2002/SC2034/SC2126).

### Estratégia

1. Trocar padrões `A && B || C` por blocos `if/then/else`.
2. Corrigir pontos com `cat` desnecessário.
3. Tratar variáveis não usadas.
4. Comentar explicitamente os casos intencionais de string literal (`SC2016`) quando aplicável.

### Critérios de aceite

- ShellCheck limpo nos scripts-alvo (ou com `disable` local justificado).
- Nenhum comportamento funcional alterado fora do escopo.

### Validação

- `shellcheck .github/hooks/hooks-lib/common.sh .github/hooks/scripts/*.sh`
- `bash .github/hooks/scripts/smoke-test.sh`

---

## Ordem de execução recomendada

1. **P0 completo** em branch dedicada.
2. **P1 completo** com revisão de contrato e docs.
3. **P2 completo** em lote controlado.

## Risco e rollback

- Manter commits pequenos por item crítico.
- Rollback por commit se regressão em fluxo de sessão/turno.
- Nunca mesclar P1/P2 antes de estabilizar P0.

## Definition of Done (DoD)

- P0/P1/P2 concluídos.
- `smoke-test.sh` passando.
- ShellCheck sem alertas relevantes novos.
- Documentação alinhada com comportamento real dos scripts.
- Recovery não contaminado por fixtures de teste em nenhum bootstrap de sessão.
