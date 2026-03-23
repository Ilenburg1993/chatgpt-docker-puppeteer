# Auditoria Profunda — `sessionStart` vs `userPromptSubmitted`

**Data:** 2026-03-14 **Escopo:**

- `.github/hooks/scripts/session-start.sh`
- `.github/hooks/scripts/log-prompt.sh`
- `.github/hooks/copilot-hooks.json`
- evidências operacionais em `logs/audit-*.jsonl`

---

## 1) Objetivo

Validar com alta confiança **quando cada hook dispara**, eliminar ambiguidades de lifecycle e
aplicar upgrades estruturais para rastreabilidade/auditoria contínua.

---

## 2) Confirmação dos gatilhos (com evidência)

## ✅ `sessionStart`

Dispara no evento de sessão do Copilot (início/reativação de sessão no ciclo da plataforma), **não**
em cada turno.

### Evidências

1. Registro oficial de hook:
   - `copilot-hooks.json` mapeia `sessionStart -> ./scripts/session-start.sh`.
2. Semântica de protocolo no repositório:
   - `hooks-protocol.instructions.md` define SESSION como `sessionStart -> sessionEnd`.
3. Evidência empírica nos logs atuais:
   - sessão `8c19c988-b622-44ee-8207-717464587212`: `sessionStart=0`, `userPromptSubmitted=7` (ou
     seja: vários turnos sem novo `sessionStart`).

### Conclusão técnica

`sessionStart` **não é hook de turno**. É hook de lifecycle de sessão e pode ser raro em sessões
longas ou retomadas.

---

## ✅ `userPromptSubmitted`

Dispara quando o usuário envia prompt na **caixa de chat** do VS Code, abrindo novo TURN.

### Evidências

1. Registro oficial de hook:
   - `copilot-hooks.json` mapeia `userPromptSubmitted -> ./scripts/log-prompt.sh`.
2. Semântica de protocolo no repositório:
   - `hooks-protocol.instructions.md` afirma explicitamente:
     - dispara ao digitar na caixa de chat;
     - respostas de `vscode_askQuestions` são `postToolUse`, não novos prompts.
3. Implementação atual de `log-prompt.sh`:
   - cria evento `userPromptSubmitted`;
   - reseta/inicia `current_turn`;
   - emite `turnStart`.

### Conclusão técnica

Sua leitura está correta: `userPromptSubmitted` é o gatilho confiável para início de TURN via chat
box, inclusive em retomadas de sessão.

---

## 3) Problemas encontrados na auditoria

1. **Assimetria de schema em fallback sem `sponge` (RECONNECT-02):**
   - havia caminho que não restaurava completamente campos strict/askQuestions de `current_turn`.
2. **Observabilidade insuficiente de hooks no contexto:**
   - faltava telemetria explícita e persistente para contagem de invocações por hook.
3. **Gap de rastreabilidade semântica de trigger:**
   - faltava evento dedicado classificando `userPromptSubmitted` como gatilho de chat box.
4. **Heal incompleto em `manual_recovery`:**
   - ajuste de `session.id` sem atualizar `session.vs_code_session_id` no mesmo fluxo.

---

## 4) Upgrades aplicados (correções + aprimoramentos + upgrades amplos)

## 4.1 Em `session-start.sh`

1. **Classificação explícita do gatilho de `sessionStart`**
   - novo `SESSIONSTART_TRIGGER_KIND` por `source`.
2. **Observabilidade persistente no contexto**
   - novo bloco `hook_observability` com:
     - `sessionStart_count`
     - `userPromptSubmitted_count`
     - `last_sessionStart_at`
     - `last_sessionStart_source`
     - `last_userPromptSubmitted_at`
     - `last_userPromptSubmitted_hash`
3. **Incremento de `sessionStart_count` em `inline_restart`**
   - preservando histórico sem resetar estatísticas acumuladas.
4. **Enriquecimento do evento `sessionStart` no audit**
   - adicionados `trigger_kind` e `semantic_note` para desambiguar sessão vs turno.

## 4.2 Em `log-prompt.sh`

1. **Correção de schema no fallback sem `sponge` (RECONNECT-02)**
   - inclui `session.strict_turn_close_requires_key=true`.
   - inclui campos `last_askquestions_*` em `current_turn`.
2. **Heal de identidade completo em `manual_recovery`**
   - atualiza também `session.vs_code_session_id`.
3. **Evento explícito de classificação do hook**
   - novo evento `hookInvocation_userPromptSubmitted` com:
     - `classification` (`new_session_first_prompt` ou `session_resume_or_continuation`)
     - `semantic_note` (chat box vs askQuestions).
4. **Observabilidade persistente por turno**
   - incremento de `hook_observability.userPromptSubmitted_count`.
   - atualização de `last_userPromptSubmitted_at` e `last_userPromptSubmitted_hash`.
5. **Contexto de auto-recovery mais completo**
   - passa a incluir `hook_observability` já na criação mínima de contexto.

---

## 5) Matriz canônica de “quando dispara”

| Hook                  | Dispara quando                                         | Não dispara quando                                       |
| --------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| `sessionStart`        | início/reativação de sessão no lifecycle da plataforma | cada novo turno normal                                   |
| `userPromptSubmitted` | usuário envia prompt na chat box (novo TURN)           | resposta de `vscode_askQuestions` (isso é `postToolUse`) |

---

## 6) Impacto esperado

1. Menos confusão operacional entre SESSION e TURN.
2. Diagnóstico forense mais rápido por contadores e timestamps de hook no próprio contexto.
3. Menor risco de “falso entendimento” sobre ausência de `sessionStart` em sessões longas.
4. Melhor robustez de schema em fallback sem `sponge`.

---

## 7) Recomendações de operação contínua

1. Tratar `userPromptSubmitted` como gatilho primário de TURN.
2. Tratar `sessionStart` como evento de sessão (não usar como marcador de cada turno).
3. Em auditorias futuras, consultar primeiro:
   - `hook_observability` no `session-context-<sid>.json`;
   - eventos `sessionStart`, `hookInvocation_userPromptSubmitted`, `turnStart` no audit.

---

## 8) Resumo executivo

- Sua hipótese foi confirmada no essencial:
  - `sessionStart` é raro e não acompanha cada turno;
  - `userPromptSubmitted` é o gatilho confiável para novo turno via chat box.
- Foram aplicados upgrades estruturais e correções para tornar esse comportamento:
  - **observável**,
  - **audítavel**,
  - **consistente** mesmo em caminhos de recovery/fallback.
