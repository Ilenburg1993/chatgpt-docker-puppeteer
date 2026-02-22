# Análise: post-create.sh - Problemas de Idempotência e Reexecução

**Data:** 03 de Fevereiro de 2026 **Versão Script Atual:** v5.2.1 **Status:** 🟡 PROBLEMA
IDENTIFICADO - Correção Necessária

---

## 🔍 Problema Identificado

### Sintoma Reportado

> "Quando o post-create dava erro após o container subir ele não rodava mais"

### Causa Raiz Confirmada

**AUSÊNCIA DE TRAP HANDLER PARA LIMPEZA EM CASO DE ERRO**

#### Fluxo do Problema:

```bash
# 1. Script inicia
touch "${IN_PROGRESS_MARKER}"  # Marca início

# 2. Se algum comando falhar (set -e)
[comando que falha]  # exit 1

# 3. Script ABORTA imediatamente
# ❌ IN_PROGRESS_MARKER nunca é removido
# ❌ COMPLETED_MARKER nunca é criado

# 4. Próxima execução
if [[ -f "${IN_PROGRESS_MARKER}" ]]; then
    RUNTIME_MODE="replay"  # Detecta execução interrompida
    # ✅ AUTORIZA reexecução (isso está correto)
fi
```

### Por Que o Problema Ocorre

1. **Linha 474:** `touch "${IN_PROGRESS_MARKER}"` cria o marcador
2. **Linha 29:** `set -euo pipefail` faz script abortar em qualquer erro
3. **SEM TRAP:** Não há `trap` para limpar o marker em caso de erro
4. **Linha 1333:** `rm -f "${IN_PROGRESS_MARKER}"` só executa se chegar ao final

**Resultado:** Se qualquer comando falha, o marker fica órfão.

---

## 📊 Análise do Sistema de Gatekeeper Atual

### Lógica de Marcadores (Linhas 330-354)

```bash
readonly IN_PROGRESS_MARKER="/tmp/post-create.in-progress"
readonly COMPLETED_MARKER="/tmp/post-create.done"

# Estado inconsistente (ambos presentes)
if [[ -f "${COMPLETED_MARKER}" && -f "${IN_PROGRESS_MARKER}" ]]; then
    # ✅ CORREÇÃO EXISTE: Remove IN_PROGRESS, preserva COMPLETED
    rm -f "${IN_PROGRESS_MARKER}"
fi
```

**Status:** ✅ **Correção de estado inconsistente já implementada**

### Lógica de Modos Operacionais (Linhas 415-440)

```bash
if [[ -f "${COMPLETED_MARKER}" && "${FORCE_REEXECUTION}" != "true" ]]; then
    RUNTIME_MODE="reentry"
    # ✅ Aborta para preservar idempotência

elif [[ -f "${IN_PROGRESS_MARKER}" ]]; then
    RUNTIME_MODE="replay"
    # ✅ AUTORIZA reexecução após falha

elif [[ -f "${STATE_FILE}" && -s "${STATE_FILE}" && "${FORCE_REEXECUTION}" == "true" ]]; then
    RUNTIME_MODE="replay"

else
    RUNTIME_MODE="bootstrap"
fi
```

**Status:** ✅ **Lógica de replay já implementada corretamente**

### Gatekeeper de Idempotência (Linhas 450-462)

```bash
if [[ "${RUNTIME_MODE}" == "reentry" ]]; then
    log "Gatekeeper: Execução abortada para preservar idempotência por container."
    exit 0  # ✅ Exit limpo
fi

if [[ "${RUNTIME_MODE}" == "replay" ]]; then
    log "Gatekeeper: Reexecução estrutural AUTORIZADA (replay consciente)."
    # ✅ Continua execução
fi
```

**Status:** ✅ **Gatekeeper funcionando corretamente**

---

## 🎯 Problema Real: Falta de Cleanup em Erro

### Cenário de Falha

```bash
#!/usr/bin/env bash
set -euo pipefail  # ← Qualquer erro = exit imediato

# ... código ...

touch "/tmp/post-create.in-progress"  # Linha 474

# PROBLEMA: Se qualquer comando aqui falhar:
some_command_that_fails  # exit 1

# ❌ Linhas abaixo NUNCA executam:
rm -f "/tmp/post-create.in-progress"  # Linha 1333
touch "/tmp/post-create.done"          # Linha 1334
```

### O Que Deveria Acontecer

```bash
#!/usr/bin/env bash
set -euo pipefail

# ✅ TRAP HANDLER (FALTA IMPLEMENTAR)
trap cleanup EXIT ERR

cleanup() {
    local exit_code=$?

    if [[ $exit_code -ne 0 ]]; then
        # Erro detectado - NÃO remover IN_PROGRESS
        # Deixar para próxima execução detectar (replay mode)
        error "Script falhou com código ${exit_code}"
        error "IN_PROGRESS_MARKER mantido para diagnóstico"
    fi
}

touch "/tmp/post-create.in-progress"

# Se falhar aqui, trap captura e loga
some_command_that_fails
```

---

## ✅ Boas Notícias: Sistema Já Tem Recovery

### O Sistema JÁ SE RECUPERA, Mas Não Documenta

**Linhas 428-431:**

```bash
elif [[ -f "${IN_PROGRESS_MARKER}" ]]; then
    RUNTIME_MODE="replay"
    warn "Gatekeeper: Execução anterior INTERROMPIDA (IN_PROGRESS detectado)."
    warn "→ Reexecução estrutural AUTORIZADA para recuperação."
```

**Isso significa:**

1. ✅ Falhou na primeira vez → IN_PROGRESS fica órfão
2. ✅ Segunda execução → Detecta IN_PROGRESS
3. ✅ Mode = "replay" → Reexecução é AUTORIZADA
4. ✅ Script roda novamente

**PROBLEMA:** Não há logging/diagnóstico adequado do erro original.

---

## 🔧 Correções Necessárias

### Correção 1: Adicionar Trap Handler (Crítico)

**Local:** Após linha 29 (logo após `set -euo pipefail`)

**Implementação:**

```bash
set -euo pipefail

# ---------------------------------------------------------------------------
# TRAP HANDLER — Cleanup e Diagnóstico de Erro
# ---------------------------------------------------------------------------
cleanup_on_error() {
    local exit_code=$?
    local line_num="${BASH_LINENO[0]:-unknown}"

    # Exit 0 = sucesso normal, não fazer nada
    [[ $exit_code -eq 0 ]] && return 0

    echo ""
    error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    error "FALHA NO POST-CREATE (EXIT CODE: ${exit_code})"
    error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    error "Linha aproximada: ${line_num}"
    error "Script: ${SCRIPT_NAME} v${SCRIPT_VERSION}"
    error ""
    error "AÇÃO AUTOMÁTICA:"
    error "  → IN_PROGRESS_MARKER mantido para diagnóstico"
    error "  → Próxima execução entrará em modo REPLAY (recovery)"
    error ""
    error "AÇÕES DISPONÍVEIS:"
    error "  1. Rebuild container (automático via VS Code)"
    error "  2. Inspecionar logs: ${LOG_FILE:-/tmp/post-create.log}"
    error "  3. Forçar reexecução: REEXECUTE_POST_CREATE=true"
    error ""
    error "DIAGNÓSTICO RECOMENDADO:"
    error "  • Verificar variáveis ENV (SECTION 3)"
    error "  • Verificar permissões de volumes"
    error "  • Consultar: .devcontainer/TROUBLESHOOTING_SSH.md"
    error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # NÃO remover IN_PROGRESS_MARKER
    # Sistema de replay detectará e reexecutará
}

# Instalar trap para ERR e EXIT
trap cleanup_on_error ERR EXIT
```

### Correção 2: Melhorar Logging de Replay (Médio)

**Local:** Linhas 428-431

**Antes:**

```bash
elif [[ -f "${IN_PROGRESS_MARKER}" ]]; then
    RUNTIME_MODE="replay"
    warn "Gatekeeper: Execução anterior INTERROMPIDA (IN_PROGRESS detectado)."
    warn "→ Reexecução estrutural AUTORIZADA para recuperação."
```

**Depois:**

```bash
elif [[ -f "${IN_PROGRESS_MARKER}" ]]; then
    RUNTIME_MODE="replay"
    warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    warn "RECOVERY MODE ATIVADO"
    warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    warn "Gatekeeper: Execução anterior INTERROMPIDA (IN_PROGRESS detectado)."
    warn "→ Possível falha anterior detectada"
    warn "→ Reexecução estrutural AUTORIZADA para recuperação"
    warn "→ Marcador: ${IN_PROGRESS_MARKER}"

    # Verificar idade do marker (diagnóstico)
    if command -v stat >/dev/null 2>&1; then
        marker_age=$(( $(date +%s) - $(stat -c%Y "${IN_PROGRESS_MARKER}" 2>/dev/null || echo 0) ))
        if [[ $marker_age -gt 0 ]]; then
            warn "→ Idade do marker: ${marker_age}s (desde última tentativa)"
        fi
    fi

    warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
```

### Correção 3: Adicionar Validação no Final (Baixo)

**Local:** Antes da linha 1333 (antes do commit final)

**Implementação:**

```bash
# ---------------------------------------------------------------------------
# 4 COMMIT FINAL DA TRANSAÇÃO DE BOOTSTRAP
# ---------------------------------------------------------------------------

# Validação de sanidade antes do commit
if [[ ! -f "${IN_PROGRESS_MARKER}" ]]; then
    error "INCONSISTÊNCIA: IN_PROGRESS_MARKER não existe no commit final"
    error "→ Possível remoção prematura ou lógica quebrada"
    exit 1
fi

# Commit atômico
rm -f "${IN_PROGRESS_MARKER}" 2>/dev/null || true
touch "${COMPLETED_MARKER}"

log "Gatekeeper: Execução concluída com sucesso (COMPLETED)."
```

---

## 📋 Melhorias Adicionais Recomendadas

### Melhoria 1: Timestamp no Marker

**Benefício:** Diagnóstico de loops infinitos

```bash
# Ao criar marker
echo "$(date -Iseconds)" > "${IN_PROGRESS_MARKER}"

# Ao detectar marker antigo
if [[ -f "${IN_PROGRESS_MARKER}" ]]; then
    marker_timestamp=$(cat "${IN_PROGRESS_MARKER}" 2>/dev/null || echo "unknown")
    warn "→ Timestamp da falha anterior: ${marker_timestamp}"
fi
```

### Melhoria 2: Contador de Tentativas

**Benefício:** Prevenir loops infinitos de replay

```bash
readonly MAX_REPLAY_ATTEMPTS=3
readonly REPLAY_COUNTER_FILE="/tmp/post-create.replay-count"

if [[ "${RUNTIME_MODE}" == "replay" ]]; then
    replay_count=$(cat "${REPLAY_COUNTER_FILE}" 2>/dev/null || echo 0)
    replay_count=$((replay_count + 1))
    echo "$replay_count" > "${REPLAY_COUNTER_FILE}"

    if [[ $replay_count -gt $MAX_REPLAY_ATTEMPTS ]]; then
        error "LOOP INFINITO DETECTADO: ${replay_count} tentativas de replay"
        error "→ Possível erro estrutural que não pode ser recuperado"
        exit 1
    fi

    warn "→ Tentativa de replay: ${replay_count}/${MAX_REPLAY_ATTEMPTS}"
fi

# No sucesso, limpar contador
rm -f "${REPLAY_COUNTER_FILE}" 2>/dev/null || true
```

### Melhoria 3: Log de Erro Persistente

**Benefício:** Forense post-mortem

```bash
readonly ERROR_LOG="${LOG_DIR}/post-create.last-error.log"

cleanup_on_error() {
    local exit_code=$?
    [[ $exit_code -eq 0 ]] && return 0

    # Salvar contexto do erro
    {
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "POST-CREATE ERROR REPORT"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "Timestamp: $(date -Iseconds)"
        echo "Exit Code: ${exit_code}"
        echo "Line: ${BASH_LINENO[0]:-unknown}"
        echo "Script Version: ${SCRIPT_VERSION}"
        echo "Runtime Mode: ${RUNTIME_MODE:-unknown}"
        echo ""
        echo "Environment:"
        echo "  USER: ${CURRENT_USER:-unknown}"
        echo "  UID: ${CURRENT_UID:-unknown}"
        echo "  HOME: ${HOME_DIR:-unknown}"
        echo "  PROJECT_ROOT: ${PROJECT_ROOT:-unknown}"
        echo ""
        echo "Últimas 20 linhas do log:"
        tail -n 20 "${LOG_FILE}" 2>/dev/null || echo "(log indisponível)"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    } > "${ERROR_LOG}"

    error "Relatório de erro salvo em: ${ERROR_LOG}"
}
```

---

## 🎯 Resumo: O Que Está Funcionando vs O Que Falta

### ✅ JÁ FUNCIONA (Não Precisa Mudar)

1. **Detecção de IN_PROGRESS** (linhas 428-431)
   - Sistema detecta execução interrompida
   - Mode = "replay" autoriza reexecução

2. **Cleanup de Estado Inconsistente** (linhas 351-354)
   - Remove IN_PROGRESS se COMPLETED também existe

3. **Gatekeeper de Idempotência** (linhas 450-462)
   - Impede reexecução se já completado
   - Autoriza replay se interrompido

4. **Marcadores Efêmeros** (linhas 336-337)
   - `/tmp/` garante limpeza em reinicialização do container

### ❌ FALTA IMPLEMENTAR (Correções Necessárias)

1. **Trap Handler** (CRÍTICO)
   - Logging adequado de erro
   - Preservação de IN_PROGRESS_MARKER
   - Instruções de recovery para o usuário

2. **Logging de Replay** (MÉDIO)
   - Banner mais visível
   - Timestamp e diagnóstico

3. **Proteções Adicionais** (BAIXO)
   - Contador de tentativas
   - Log de erro persistente
   - Validação de sanidade no commit

---

## 🚀 Próximos Passos

### Implementação Recomendada

**Prioridade 1:** Trap Handler **Prioridade 2:** Logging de Replay **Prioridade 3:** Melhorias
opcionais

### Teste Recomendado

```bash
# 1. Introduzir erro intencional no post-create.sh
# Adicionar após linha 500:
exit 1  # TESTE: Forçar erro

# 2. Rebuild container
# Expectativa: Script falha, logs mostram trap handler

# 3. Rebuild novamente (sem remover container)
# Expectativa: Mode = "replay", script roda de novo

# 4. Remover exit 1 forçado
# Expectativa: Script completa com sucesso
```

---

**Conclusão:** O sistema JÁ TEM a lógica de recovery (replay mode), mas falta logging adequado e
trap handler para melhorar o diagnóstico e UX quando ocorrem erros.
