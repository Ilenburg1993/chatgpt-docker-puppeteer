#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail

# Helpers de briefing para session-start-lib.

session_start_write_briefing_base() {
    local briefing_file="${1:-}"
    local session_date="${2:-unknown}"
    local close_key="${3:-}"

    cat > "$briefing_file" << BRIEFING_EOF
# Briefing de Sessão — ${session_date}

> **Para o agente de IA:** Este arquivo é gerado automaticamente pelo hook \`sessionStart\`.
> Leia-o como primeiro ato de toda sessão, antes de qualquer ação.
> Após lê-lo, **invoque \`vscode_askQuestions\`** com o Template E (Session Kickoff)
> para definir com o usuário o rumo desta sessão.

---

## ╔══ PROTOCOLO DE ENCERRAMENTO — LEITURA OBRIGATÓRIA ══╗

> **SESSION ≠ SECTION ≠ TURN — distinção crítica para o agente LLM**

| Conceito    | Encerra como?                           | Autorização    |
|-------------|------------------------------------------|----------------|
| **TURN**    | Com \`vscode_askQuestions\` como último ato | **OBRIGATÓRIA** |
| **SECTION** | \`bash start-section.sh "nome"\` (autônomo)| **Nenhuma**    |
| **SESSION** | Template F + KEY digitada + execução automática de \`session-close.sh\` | **OBRIGATÓRIA**|

> ⚠️ **Terminar de escrever uma resposta = encerrar um TURN, NÃO a SESSION.**
> A SESSION só encerra quando o usuário explicitamente digita a chave abaixo.

---

## 🚨 INSTRUÇÕES CRÍTICAS PARA O AGENTE COPILOT (BUG-79 Hardening)

### ❌ **NUNCA faça isto:**
- Tentar encerrar a SESSION diretamente (sem Template F)
- Assumir que pode fechar porque tem acesso ao close_key abaixo
- Contornar o protocolo de encerramento por qualquer motivo (token budget baixo, etc)
- Resumir e "encerrar conversa" implicitamente

### ✅ **FAÇA isto quando a SESSION deve encerrar:**

1. **Invoque \`vscode_askQuestions\`** com **TEMPLATE F** (Session Close)
   - Não use outro template
   - Inclua instrução clara: "Digite a chave de encerramento:"

2. **Aguarde a resposta do usuário**
   - O usuário digitará a chave 16 hex abaixo (ENCERRAR-XXXXXXXX)

3. **Deixe post-tool-use.sh executar session-close.sh** automaticamente
   - Não tente chamar session-close.sh você mesmo (hooks fazem isto)

4. **Apenas após tudo isto: a SESSION encerrará**
   - Nunca antes. Sempre com autorização do usuário

### 💡 **Se o token budget ficar baixo:**
- **NÃO encerre a SESSION**
- Invoque Template D (Checkpoint) para avisar o usuário
- Deixe o usuário decidir se continua ou se encerra a SESSION
- O agente não toma decisões autônomas de encerramento

### 📋 **Referência rápida:**
- **Encerrar SESSION**: \`vscode_askQuestions\` Template F + KEY + execução automática em \`post-tool-use.sh\`
- **Avisar sobre token budget**: \`vscode_askQuestions\` Template D (Checkpoint)
- **Trocar de fase**: \`bash start-section.sh "nome-nova-fase"\`
- **Terminar TURN**: obrigatório chamar \`vscode_askQuestions\` como último ato do turno

---


### 🔐 Chave desta SESSION (mostrar no Template F):
\`\`\`
${close_key}
\`\`\`

### Fluxo de encerramento de SESSION (3 etapas obrigatórias):
1. Agente chama \`vscode_askQuestions\` com **Template F** (exibe a chave acima)
2. Usuário digita a chave \`${close_key}\` no campo livre
3. \`post-tool-use.sh\` valida a chave e executa \`session-close.sh\` automaticamente

---

BRIEFING_EOF

    return 0
}

session_start_append_unauthorized_close_section() {
   local briefing_file="${1:-}"
   local prev_unauth_flag_stale="${2:-false}"
   local prev_unauth_sid="${3:-}"
   local prev_unauth_ts="${4:-}"
   local prev_unauth_turn="${5:-0}"
   local violation_emojis="${6:-⛔}"
   local violation_level="${7:-AVISO DE VIOLAÇÃO}"
   local consecutive_violations="${8:-0}"

   if [ "$prev_unauth_flag_stale" = "true" ]; then
      cat >> "$briefing_file" << STALE_VIOLATION_EOF

---

## ℹ️ Nota informativa — Violação registrada em sessão anterior

> A sessão **\`${prev_unauth_sid}\`** encerrou sem autorização (\`vscode_askQuestions\` ausente).
> O flag foi **removido automaticamente** pois pertence a uma sessão diferente.
> Esta sessão começa com contador de violações zerado.
>
> - **Sessão violadora**: \`${prev_unauth_sid}\`
> - **Horário**: \`${prev_unauth_ts}\`
> - **Turno**: \`${prev_unauth_turn}\`

---

STALE_VIOLATION_EOF
   else
      cat >> "$briefing_file" << VIOLATION_EOF

---

## ${violation_emojis} ${violation_level} — AÇÃO OBRIGATÓRIA IMEDIATA ${violation_emojis}

> **A sessão anterior encerrou SEM autorização do usuário.**
> O agente não chamou \`vscode_askQuestions\` antes de finalizar o turno.
>
> - **Sessão violadora**: \`${prev_unauth_sid}\`
> - **Horário da violação**: \`${prev_unauth_ts}\`
> - **Turno**: \`${prev_unauth_turn}\`
> - **Violações consecutivas**: \`${consecutive_violations}\`
>
> **PRIMEIRA AÇÃO DESTA SESSÃO (antes de qualquer outra coisa):**
>
> 1. Informar o usuário sobre esta violação
> 2. Pedir desculpas explicitamente
> 3. Invocar \`vscode_askQuestions\` para recuperar a autorização
>
> **Esta violação será registrada no audit.jsonl e rastreada.**
> O arquivo \`.github/hooks/state/UNAUTHORIZED_CLOSE.flag\` SÓ é removido
> quando o agente chama \`vscode_askQuestions\` corretamente.

---

VIOLATION_EOF
   fi

   return 0
}

session_start_append_no_key_section() {
   local briefing_file="${1:-}"
   local prev_no_key_sid="${2:-}"
   local prev_no_key_ts="${3:-}"
   local prev_no_key_turns="${4:-0}"

   cat >> "$briefing_file" << NO_KEY_EOF

---

## 🔐 ALERTA — SESSÃO ANTERIOR ENCERROU SEM CHAVE DE AUTORIZAÇÃO 🔐

> A sessão anterior foi encerrada **sem que a SESSION CLOSE KEY fosse fornecida**.
> Isso indica encerramento acidental (crash, timeout, fechamento direto da janela).
>
> - **Sessão afetada**: \`${prev_no_key_sid}\`
> - **Horário**: \`${prev_no_key_ts}\`
> - **Turnos executados**: \`${prev_no_key_turns}\`
>
> **Ação recomendada**: revisar o que estava sendo feito e verificar se algo ficou
> em estado inconsistente (commits pendentes, arquivos abertos, etc.).

---

NO_KEY_EOF

   return 0
}

session_start_append_abrupt_close_section() {
   local briefing_file="${1:-}"
   local prev_close_mode="${2:-ok}"
   local prev_session_id="${3:-}"

   if [ "$prev_close_mode" = "key_validated" ]; then
      cat >> "$briefing_file" << ABRUPT_EOF

---

## ⚠️ AVISO — KEY VALIDADA MAS \`session-close.sh\` NÃO FOI EXECUTADO

> **A sessão anterior validou a close_key (Template F), mas \`session-close.sh\` não foi chamado.**
> O evento \`sessionCloseAuthorized\` não foi registrado — encerramento parcialmente auditado.
>
> - **Sessão afetada**: \`${prev_session_id}\`
> - A KEY foi fornecida corretamente via \`vscode_askQuestions\`, mas o script de close não executou.
> - Possível causa: Copilot encerrou abruptamente após o usuário digitar a KEY, antes de \`session-close.sh\`.
>
> **Ação recomendada**: verificar se havia trabalho pendente; o \`post-tool-use.sh\` tenta
> auto-invocar \`session-close.sh\`, mas falhou ou não foi acionado desta vez.

---

ABRUPT_EOF
   else
      cat >> "$briefing_file" << ABRUPT_EOF

---

## ⚡ AVISO — ENCERRAMENTO ABRUPTO SEM KEY (\`session-close.sh\` não executado)

> **A sessão anterior encerrou sem registrar \`sessionEnd\` nem \`sessionCloseAuthorized\`.**
> Isso ocorre quando o VS Code / Copilot é fechado abruptamente
> (timeout, crash, reinicialização ou fechamento direto da janela).
>
> - **Sessão afetada**: \`${prev_session_id}\`
> - A \`close_key\` **não foi validada** — encerramento não auditado pelo sistema.
> - Causas comuns: inatividade prolongada, restart do container, crash do processo.
>
> **Para evitar encerramentos abruptos**:
> - Mantenha o turno ativo respondendo ao agente regularmente
> - Antes de encerrar, solicite ao agente para executar o Template F
> - Não feche a janela do VS Code sem confirmar o encerramento da sessão
>
> **Ação recomendada**: verificar se havia trabalho pendente e se algo ficou
> em estado inconsistente (commits, arquivos abertos, locks, etc.).

---

ABRUPT_EOF
   fi

   return 0
}

session_start_append_reconnect_section() {
   local briefing_file="${1:-}"
   local prev_session_id="${2:-}"
   local prev_reconnect_count="${3:-0}"

   cat >> "$briefing_file" << RECONNECT_EOF

---

## 🔄 INFORMAÇÃO — SESSÃO ANTERIOR ENCERROU POR RECONEXÃO DO CLIENTE

> O VS Code Client (lado Windows) desconectou e reconectou durante a sessão anterior,
> gerando um novo session_id sem disparar o evento \`sessionStart\`.
> Esta sessão agora começa com identificação limpa.
>
> - **Sessão afetada**: \`${prev_session_id}\`
> - **Reconexões detectadas**: ${prev_reconnect_count}
> - **Causas comuns**: Windows sleep/hibernação, VS Code restart, WSL2 network reset.
>
> **Recomendações para sessões mais estáveis**:
> - Evitar hibernate/sleep do Windows durante sessões ativas
> - SSH keepalive configurado (ServerAliveInterval=60) para evitar silent drops
> - Não fechar a janela do VS Code sem encerrar a sessão via Template F

---

RECONNECT_EOF

   return 0
}

session_start_append_close_key_quickref() {
   local briefing_file="${1:-}"
   local close_key="${2:-}"

   cat >> "$briefing_file" << CLOSE_KEY_EOF

---

## 🔐 CHAVE DE ENCERRAMENTO (referência rápida)

\`\`\`
${close_key}
\`\`\`

> SESSION fecha com: **Template F** → usuário digita KEY → execução automática de \`session-close.sh\`.
> TURN fecha com \`vscode_askQuestions\` (obrigatório) e **não pode ser retomado** após fechamento.
> A SESSION pode ser retomada com novo prompt no mesmo chat.

---

CLOSE_KEY_EOF

   return 0
}

session_start_append_ask_fail_section() {
   local briefing_file="${1:-}"
   local prev_ask_api_failures="${2:-0}"
   local prev_ask_error_at="${3:-desconhecido}"

   cat >> "$briefing_file" << ASK_FAIL_EOF

---

## ⚠️ ALERTA — Falha de API do \`vscode_askQuestions\` na sessão anterior

> O \`vscode_askQuestions\` falhou **${prev_ask_api_failures}x** com erro **"Response contained no choices"**.
>
> Este erro ocorre quando:
> - O contexto acumulado excede o limite do modelo (mais comum)
> - A API do Copilot está sobrecarregada/indisponível
> - O timeout (~4 min) é atingido antes da resposta
>
> **Última falha registrada**: \`${prev_ask_error_at}\`
>
> **Sintoma para o usuário**: A UI do VS Code exibe o esquema das perguntas + o erro inline,
> o que pode parecer "corrupção" em arquivos abertos — **é um artefato visual, não corrupcão real**.
>
> **Ações recomendadas**:
> 1. Mantenha as perguntas do \`vscode_askQuestions\` curtas (< 200 chars cada)
> 2. Se a sessão estiver longa, prefira respostas inline ao invés de \`vscode_askQuestions\`
> 3. Não interprete o artefato visual como corrupção — verifique o arquivo diretamente

---

ASK_FAIL_EOF

   return 0
}

session_start_append_watchdog_section() {
   local briefing_file="${1:-}"
   local wd_emoji="${2:-⚠️}"
   local wd_status="${3:-unknown}"
   local wd_critical="${4:-0}"
   local wd_warn="${5:-0}"
   local wd_alerts_md="${6:-- (detalhes não disponíveis)}"

   cat >> "$briefing_file" << WD_EOF

---

## ${wd_emoji} Watchdog — ${wd_status^^} (${wd_critical} crítico(s), ${wd_warn} aviso(s))

> O watchdog detectou anomalias no início desta sessão.
> Veja o relatório completo em \`state/watchdog-report.json\`.

${wd_alerts_md}

---

WD_EOF

   return 0
}

session_start_resolve_origin_labels() {
   local source="${1:-unknown}"

   case "$source" in
      "new")
         _SESSION_ORIGEM="🆕 \`new\` — sessão fresca (VS Code abriu nova janela de chat)"
         _SESSION_STATS_NOTE="Estatísticas zeradas (sessão nova)"
         ;;
      "inline_restart")
         _SESSION_ORIGEM="🔄 \`inline_restart\` — VS Code reconectou a mesma conversa"
         _SESSION_STATS_NOTE="⚠️ Estatísticas **preservadas** da sessão anterior (CTX não zerado)"
         ;;
      "reconnect_rollover")
         _SESSION_ORIGEM="🔃 \`reconnect_rollover\` — reconexão do cliente VS Code (HEAL aplicado)"
         _SESSION_STATS_NOTE="Estatísticas da sessão anterior recuperadas via HEAL"
         ;;
      "healed_from_real_session" | "healed_from_consecutive_mismatch")
         _SESSION_ORIGEM="🩹 \`${source}\` — sessão recuperada por HEAL automático"
         _SESSION_STATS_NOTE="Estatísticas parcialmente recuperadas do CTX anterior"
         ;;
      "manual_recovery")
         _SESSION_ORIGEM="🛠️ \`manual_recovery\` — recuperação manual de emergência"
         _SESSION_STATS_NOTE="Estatísticas limitadas (CTX criado manualmente)"
         ;;
      *)
         _SESSION_ORIGEM="\`${source}\`"
         _SESSION_STATS_NOTE="(origem desconhecida)"
         ;;
   esac

   export _SESSION_ORIGEM _SESSION_STATS_NOTE
   return 0
}

session_start_append_active_state_section() {
   local briefing_file="${1:-}"

   cat >> "$briefing_file" << ACTIVE_STATE_EOF

---

## 📍 Estado Ativo — SESSION → SECTION → TURN

| Dimensão | Valor |
|----------|-------|
| **ID da Sessão** | \`${SESSION_ID}\` |
| **Sessão lógica** | #${LOGICAL_SESSION_NUMBER} |
| **Origem da sessão** | ${_SESSION_ORIGEM} |
| **Estatísticas** | ${_SESSION_STATS_NOTE} |
| **Turno** | #1 (primeiro turno desta sessão) |
| **Seção ativa** | \`"início"\` — seção 1 |
| **Seção iniciada em** | ${SESSION_DATE} |

> **Invariante**: sempre deve haver uma SESSION, uma SECTION e um TURN ativos.
> A seção \`"início"\` é criada automaticamente em toda nova sessão.
> Use \`bash .github/hooks/scripts/start-section.sh "nome"\` para abrir uma nova seção
> (a seção anterior será encerrada automaticamente com \`sectionEnd\`).

---

ACTIVE_STATE_EOF

   return 0
}

session_start_append_briefing_body_section() {
   local briefing_file="${1:-}"

   cat >> "$briefing_file" << BRIEFING_BODY_EOF

## Estado do Backlog

| Prioridade      | Tarefas abertas |
|-----------------|-----------------|
| 🔴 Alta          | ${COUNT_ALTA}  |
| 🟡 Média         | ${COUNT_MEDIA} |
| 🔵 Backlog Livre | ${COUNT_BACKLOG} |
| **Total**       | **${TOTAL_OPEN}** |

## Próxima tarefa sugerida (Alta Prioridade)

${NEXT_TASK}

## Findings pendentes

- Total registrado em \`logs/findings.jsonl\`: **${OPEN_FINDINGS}**
- Findings críticos/high: **${CRITICAL_FINDINGS}**

> Se \`CRITICAL_FINDINGS > 0\`, considere priorizar a resolução desses findings
> antes de selecionar uma nova tarefa do backlog.

## Saúde do Sistema

**Status**: ${HEALTH_STATUS}
**Rede**: $(if [ "${NET_CHECK_ENABLED:-true}" != "true" ]; then echo "ℹ️ SKIP (health check desabilitado)"; elif [ "$NET_OK" = "true" ]; then echo "✅ OK (ping ${NET_CHECK_HOST})"; else echo "⛔ FALHA (sem resposta de ${NET_CHECK_HOST})"; fi)
**Reconexões VS Code (histórico)**: ${RECENT_RECONNECT_COUNT} $([ "${RECENT_RECONNECT_COUNT:-0}" -ge 20 ] && echo "⛔ CRÍTICO" || ([ "${RECENT_RECONNECT_COUNT:-0}" -ge 5 ] && echo "⚠️ ELEVADO" || echo "✅ ok"))

$(if [ -n "$HEALTH_CRITICAL" ]; then printf '%s\n' "$HEALTH_CRITICAL"; fi)
$(if [ -n "$HEALTH_WARNINGS" ]; then printf '%s\n' "$HEALTH_WARNINGS"; fi)

## Tendências históricas

| Métrica | Valor |
|---|---|
| Sessões registradas | ${TREND_SESSIONS} |
| Total de chamadas de ferramenta | ${TREND_TOTAL_TOOLS} |
| Taxa de falha de ferramentas | ${TREND_ERROR_RATE} |

### Top ferramentas (todas as sessões)

| Ferramenta | Chamadas |
|---|---|
${TREND_TOP_TOOLS_TABLE}

### Ferramentas com mais falhas

${TREND_TOP_FAILURES}

## Performance por ferramenta (médias históricas)

| Ferramenta | Média | Amostras |
|---|---|---|
${TREND_PERF_TABLE}

## Sessão atual

- **ID**: ${SESSION_ID}
- **Início**: ${SESSION_DATE}
- **Origem**: ${SOURCE}
- **Workspace**: ${CWD}

## Continuidade — Sessão Anterior

$(if [ -n "$PREV_SESSION_ID" ] && [ "$PREV_SESSION_ID" != "$SESSION_ID" ]; then
        echo "> **Recovery ativo.** Dados recuperados do último checkpoint da sessão anterior."
        echo ""
        echo "- **Sessão anterior**: \`${PREV_SESSION_ID}\`"
        echo "- **Checkpoint**: \`${PREV_CHECKPOINT_TS:-N/D}\`"
        echo "- **Turnos concluídos**: ${PREV_TURN_COUNT}"
        echo "- **Tarefas abertas**: ${PREV_TASKS_OPEN}"
        echo ""
        echo "> Verifique \`.github/hooks/state/pending-tasks.md\` para retomar de onde parou."
    else
        echo "> Nenhuma sessão anterior identificada, ou sessão continuando (\`source=${SOURCE}\`)."
    fi)

## Ação imediata recomendada

1. **SE** \`initialPrompt\` está vazio → invocar \`vscode_askQuestions\` com Template E (Session Kickoff)
2. **SE** há findings críticos → apresentá-los ao usuário antes de prosseguir
3. **SE** a sessão tem prompt explícito → executar o prompt e, ao concluir, invocar Template A
4. **SE** sessão anterior detectada → confirmar com usuário se deseja retomar tarefas abertas

---
*Gerado automaticamente. Não editar manualmente.*
BRIEFING_BODY_EOF

   return 0
}

session_start_append_runtime_alert_sections() {
   local briefing_file="${1:-}"
   local prev_session_id_from_ctx="${2:-}"
   local state_dir="${3:-}"
   local ctx_file="${4:-}"

   _PREV_ASK_API_FAILURES=0
   if [ -n "$prev_session_id_from_ctx" ]; then
      _PREV_SID_SHORT_H4="${prev_session_id_from_ctx:0:8}"
      _PREV_CTX_H4="$state_dir/session-context-${_PREV_SID_SHORT_H4}.json"
      [ -f "$_PREV_CTX_H4" ] || _PREV_CTX_H4="$state_dir/session-context.json"
      _PREV_ASK_API_FAILURES="$(jq -r '.session_stats.askquestions_api_failures // 0' "$_PREV_CTX_H4" 2> /dev/null || echo 0)"
   fi
   if [ "${_PREV_ASK_API_FAILURES:-0}" -gt 0 ] 2> /dev/null; then
      _PREV_ASK_ERROR_AT="$(jq -r '.current_turn.askquestions_api_error_at // "desconhecido"' "$ctx_file" 2> /dev/null || echo 'desconhecido')"
      session_start_append_ask_fail_section \
         "$briefing_file" \
         "${_PREV_ASK_API_FAILURES}" \
         "${_PREV_ASK_ERROR_AT}"
   fi

   WD_REPORT="$state_dir/watchdog-report.json"
   if [ -f "$WD_REPORT" ] && jq empty "$WD_REPORT" 2> /dev/null; then
      WD_STATUS="$(jq -r '.status // "healthy"' "$WD_REPORT" 2> /dev/null || echo 'healthy')"
      if [ "$WD_STATUS" != "healthy" ]; then
         WD_CRITICAL="$(jq -r '.summary.critical // 0' "$WD_REPORT" 2> /dev/null || echo 0)"
         WD_WARN="$(jq -r '.summary.warnings // 0' "$WD_REPORT" 2> /dev/null || echo 0)"
         WD_EMOJI="⚠️"
         [ "$WD_STATUS" = "critical" ] && WD_EMOJI="🚨"
         WD_ALERTS_MD="$(jq -r '.alerts[] | "- **[\(.level | ascii_upcase)]** `\(.code)`: \(.message)"' \
            "$WD_REPORT" 2> /dev/null || echo '- (detalhes não disponíveis)')"
         [ -z "$WD_ALERTS_MD" ] && WD_ALERTS_MD="- (detalhes não disponíveis)"
         session_start_append_watchdog_section \
            "$briefing_file" \
            "${WD_EMOJI}" \
            "${WD_STATUS}" \
            "${WD_CRITICAL}" \
            "${WD_WARN}" \
            "${WD_ALERTS_MD}"
      fi
   fi

   return 0
}

session_start_render_full_briefing() {
   local briefing_file="${1:-}"
   local session_date="${2:-unknown}"
   local close_key="${3:-}"
   local source="${4:-new}"
   local state_dir="${5:-}"
   local ctx_file="${6:-}"

   session_start_write_briefing_base "$briefing_file" "$session_date" "$close_key"

   if [ "${PREV_UNAUTH_CLOSE:-false}" = "true" ]; then
      session_start_append_unauthorized_close_section \
         "$briefing_file" \
         "${PREV_UNAUTH_FLAG_STALE:-false}" \
         "${PREV_UNAUTH_SID:-}" \
         "${PREV_UNAUTH_TS:-}" \
         "${PREV_UNAUTH_TURN:-0}" \
         "${VIOLATION_EMOJIS:-⛔}" \
         "${VIOLATION_LEVEL:-AVISO DE VIOLAÇÃO}" \
         "${CONSECUTIVE_VIOLATIONS:-0}"
   fi

   if [ "${PREV_NO_KEY_CLOSE:-false}" = "true" ]; then
      session_start_append_no_key_section \
         "$briefing_file" \
         "${PREV_NO_KEY_SID:-}" \
         "${PREV_NO_KEY_TS:-}" \
         "${PREV_NO_KEY_TURNS:-0}"
   fi

   if [ "${PREV_ABRUPT_CLOSE:-false}" = "true" ]; then
      session_start_append_abrupt_close_section \
         "$briefing_file" \
         "${PREV_CLOSE_MODE:-ok}" \
         "${PREV_SESSION_ID:-}"
   fi

   if [ "${PREV_CLOSE_MODE:-ok}" = "abrupt_reconnect" ]; then
      session_start_append_reconnect_section \
         "$briefing_file" \
         "${PREV_SESSION_ID:-}" \
         "${PREV_RECONNECT_COUNT:-0}"
   fi

   session_start_append_close_key_quickref "$briefing_file" "$close_key"

   session_start_append_runtime_alert_sections \
      "$briefing_file" \
      "${PREV_SESSION_ID_FROM_CTX:-}" \
      "$state_dir" \
      "$ctx_file"

   session_start_resolve_origin_labels "$source"
   session_start_append_active_state_section "$briefing_file"
   session_start_append_briefing_body_section "$briefing_file"

   return 0
}
