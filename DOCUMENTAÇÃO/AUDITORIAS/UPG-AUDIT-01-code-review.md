# Code Review — UPG-AUDIT-01 (Isolamento Per-Session de Arquivos de Auditoria)

**Data**: 2026-03-12 **Escopo**: Todos os scripts em `.github/hooks/scripts/` e
`hooks-lib/common.sh` **Feature revisada**: Isolamento de arquivos de auditoria por sessão
(`audit-{SID_SHORT}.jsonl`) **Metodologia**: Leitura completa de todos os scripts afetados,
verificação de padrões de locking, routing de AUDIT_FILE e cobertura de casos de borda.

---

## Resumo Executivo

O UPG-AUDIT-01 introduz isolamento per-session de arquivos de auditoria, mas a implementação
apresenta **2 bugs críticos** que tornam o isolamento amplamente inoperante em produção:

1. **Flock race condition** em 4 scripts VS Code hooks — o per-session context file nunca é
   protegido por lock.
2. **~50+ escritas hardcoded** para `$LOG_DIR/audit.jsonl` que ignoram o `$AUDIT_FILE` per-session —
   a maioria dos eventos vai para o arquivo global mesmo quando o override está ativo.

Adicionalmente, 2 bugs de prioridade HIGH e 3 de prioridade MÉDIO foram identificados.

---

## 🔴 CRÍTICO 1 — Flock Race Condition (fd 9 vinculado antes do override)

**Arquivos afetados**: `pre-tool-use.sh`, `agent-stop.sh`, `log-prompt.sh`, `session-end.sh`

**Problema**: O `exec 9>` abre o file descriptor 9 vinculado ao lock **global**
(`state/session-context.json.lock`) _antes_ do bloco UPG-AUDIT-01 fazer o override de `_CTX_LOCK`.
Depois disso, atualizar a variável `_CTX_LOCK` não tem efeito — fd 9 já está bound ao arquivo
original.

```bash
# pre-tool-use.sh — SEQUÊNCIA QUEBRADA
37: _CTX_LOCK="${CTX_FILE}.lock"          # ← global: state/session-context.json.lock
38: exec 9> "$_CTX_LOCK"                  # ← fd 9 fica permanentemente no lock GLOBAL
39: if command -v flock > /dev/null 2>&1; then
40:     flock -x -w 3 9 2> /dev/null      # ← adquire lock no global, não no per-session
...
58: # UPG-AUDIT-01: resolve per-session paths
62:     AUDIT_FILE="$(resolve_audit_file "$_SID_SHORT")"
63:     _CTX_LOCK="${CTX_FILE}.lock"       # ← variável atualizada, mas fd 9 IGNORADO
64:     mkdir -p ...
```

O `session-context-{SID}.json` per-session **nunca é protegido por flock** nestes scripts — qualquer
escrita concorrente cria race condition.

**Referência (como deve ser feito)**: `session-close.sh` lê `current-session-id.txt` → monta
`_CTX_LOCK` → só então `exec 9>`. É o padrão correto.

**Fix para todos os 4 scripts** — mover a leitura de stdin e o override per-session para ANTES do
`exec 9>`:

```bash
# Ler INPUT antes de abrir flock (stdin só pode ser lido uma vez)
INPUT="$(cat 2> /dev/null || true)"
SESSION_ID_PAYLOAD="$(printf '%s' "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || true)"

# UPG-AUDIT-01: resolver per-session ANTES de abrir o fd
apply_per_session_paths "${SESSION_ID_PAYLOAD:-}" 2> /dev/null || true
_CTX_LOCK="${CTX_FILE}.lock"

# Agora sim: abrir flock no lock correto
exec 9> "$_CTX_LOCK"
if command -v flock > /dev/null 2>&1; then
  flock -x -w 3 9 2> /dev/null
fi

# Processar INPUT que já foi lido acima
# (não chamar INPUT="$(cat)" novamente — stdin foi consumido)
```

> **Nota**: Ler stdin com `cat` antes de `exec 9>` requer que o script NÃO use mais `cat` depois.
> Verificar que todos os casos de leitura posterior de INPUT usem a variável já capturada.

---

## 🔴 CRÍTICO 2 — ~50+ escritas hardcoded ignoram per-session routing

**Problema**: O mecanismo UPG-AUDIT-01 define `AUDIT_FILE` por sessão, mas quase todos os eventos de
auditoria são escritos diretamente no arquivo global hardcoded — `"$LOG_DIR/audit.jsonl"` — tornando
o isolamento essencialmente inoperante.

**Inventário completo de locais afetados**:

| Script                | Linhas com `$LOG_DIR/audit.jsonl` hardcoded                         |
| --------------------- | ------------------------------------------------------------------- |
| `pre-tool-use.sh`     | 132, 225, 267, 286, 290, 314, 372, 446, 496                         |
| `agent-stop.sh`       | 93, 109, 157, 175, 274, 342, 363, 398, 414, 471, 479, 599, 645, 803 |
| `log-prompt.sh`       | 116, 135, 149, 159, 309, 343, 439                                   |
| `session-end.sh`      | 104, 175                                                            |
| `error-occurred.sh`   | 56, 74, 80                                                          |
| `tool-use-failure.sh` | 70, 94                                                              |
| `subagent-start.sh`   | 58, 76                                                              |
| `subagent-stop.sh`    | 65, 108                                                             |
| `pre-compact.sh`      | 64, 89                                                              |
| `start-section.sh`    | 118, 196                                                            |
| `start-turn.sh`       | 84, 113                                                             |
| `section-end.sh`      | 99–126                                                              |

**Fix**: Substituir `>> "$LOG_DIR/audit.jsonl"` por `>> "$AUDIT_FILE"` em todos os casos — após
garantir que `AUDIT_FILE` é inicializado via `apply_per_session_paths` ou `resolve_audit_file` antes
de qualquer escrita.

Comando para auditar os casos restantes:

```bash
rg -n 'LOG_DIR/audit\.jsonl' .github/hooks/scripts/
```

---

## 🟠 HIGH 3 — `agent-stop.sh` linha 289 e `session-end.sh` linha 198: AUDIT_FILE sobrescrito mid-script

**Problema**: Após o bloco UPG-AUDIT-01 corretamente definir `AUDIT_FILE` per-session via
`apply_per_session_paths`, o script o sobrescreve explicitamente de volta para o arquivo global,
corrompendo o estado da variável para todo o código que segue.

```bash
# agent-stop.sh, linha 289
AUDIT_FILE="$LOG_DIR/audit.jsonl"   # ← SOBRESCREVE o per-session AUDIT_FILE

if [ -f "$AUDIT_FILE" ]; then
    LAST_PROMPT_LINE="$(awk '/"userPromptSubmitted"/{last=NR} END{print last+0}' "$AUDIT_FILE")"
    # ... lê do global, eventos pós-linha-289 vão para global
```

**Fix**: Usar variável local de leitura para a análise, sem tocar em `AUDIT_FILE`:

```bash
# USE variável separada para a leitura de estratégia
_ANALYSIS_AUDIT="$LOG_DIR/audit.jsonl" # ou $AUDIT_FILE se quiser per-session
if [ -f "$_ANALYSIS_AUDIT" ]; then
  LAST_PROMPT_LINE="$(awk '...' "$_ANALYSIS_AUDIT")"
  # AUDIT_FILE permanece per-session para escritas subsequentes
fi
```

---

## 🟠 HIGH 4 — `generate-section-summary.sh` linha 74: AUDIT_FILE sobrescrito após override per-session

```bash
# Linhas 30–37: correto
_SID_SHORT="$(sid_short "$_SID")"
AUDIT_FILE="$LOG_DIR/audit-${_SID_SHORT}.jsonl"   # ← per-session definido corretamente

# ... código intermediário ...

# Linha 74: BUG — desfaz o override acima
AUDIT_FILE="$LOG_DIR/audit.jsonl"   # ← sobrescreve com global!

if [ -f "$AUDIT_FILE" ] && [ -s "$AUDIT_FILE" ]; then   # lê do global
    ...
```

A análise de seção sempre lê o `audit.jsonl` global, ignorando os eventos per-session. Qualquer
sessão com SID definido terá o summary gerado a partir de dados incorretos.

**Fix**: Remover a linha 74 ou transformar em fallback:

```bash
# Fallback apenas quando per-session não existe:
[ -f "$AUDIT_FILE" ] || AUDIT_FILE="$LOG_DIR/audit.jsonl"
```

---

## 🟡 MÉDIO 5 — Leak de tempfile em scripts de analytics (sem `trap EXIT`)

**Arquivos afetados**: `analytics.sh`, `generate-daily-report.sh`, `export-metrics.sh`

```bash
# analytics.sh, linha 31
if [ ${#_SID_AUDIT_FILES[@]} -gt 0 ] && _MERGED_AUDIT="$(mktemp 2>/dev/null)"; then
    cat "${_SID_AUDIT_FILES[@]}" > "$_MERGED_AUDIT" 2>/dev/null || true
    AUDIT_FILE="$_MERGED_AUDIT"
    # ← sem trap para remover $_MERGED_AUDIT ao sair
```

Em sistemas de longa duração ou quando o script termina por `set -e`, o arquivo temporário permanece
em `/tmp/`.

**Fix**: Adicionar imediatamente após o mktemp:

```bash
trap 'rm -f "${_MERGED_AUDIT:-}"' EXIT
```

---

## 🟡 MÉDIO 6 — `error-occurred.sh`: define AUDIT_FILE per-session mas nunca a usa

O script define `AUDIT_FILE` no bloco per-session, mas todas as escritas posteriores usam
`"$LOG_DIR/audit.jsonl"` hardcoded:

```bash
# Bloco per-session (correto):
AUDIT_FILE="$(resolve_audit_file "$_SID_SHORT")"

# Linha 56, 74, 80: ignora AUDIT_FILE
}' >> "$LOG_DIR/audit.jsonl"
```

**Fix**: Substituir todas as escritas por `>> "$AUDIT_FILE"`. Verificar também que
`source common.sh` cobre `resolve_audit_file` — o script parece não carregar `common.sh`
explicitamente.

---

## 🟡 MÉDIO 7 — `manual-session-init.sh`: evento de recovery escrito no global

Depois de invocar `session-start.sh` (que cria o arquivo per-session) e `set_current_session_id`, o
script loga `session_manual_recovery` no `AUDIT_FILE` global:

```bash
AUDIT_FILE="$LOG_DIR/audit.jsonl"   # global — não é atualizado após session-start.sh
# ...
}' >> "$AUDIT_FILE"   # evento vai para o global, não per-session
```

**Fix**: Após chamar `session-start.sh`, resolver o novo per-session AUDIT_FILE:

```bash
bash "$HOOKS_DIR/scripts/session-start.sh" <<< ""
_NEW_SID="$(get_current_session_id)"
AUDIT_FILE="$(resolve_audit_file "$(sid_short "$_NEW_SID")")"
# agora o evento vai para o arquivo correto
}' >> "$AUDIT_FILE"
```

---

## 🟢 LOW 8 — `subagent-start.sh` / `subagent-stop.sh`: escrevem CTX_FILE sem flock

Os hooks de subagente usam `apply_per_session_paths` corretamente, mas modificam
`session-context.json` sem adquirir nenhum flock. Não é regressão do UPG-AUDIT-01 (era assim antes),
mas vale atenção em cenários com subagentes paralelos.

---

## 🟢 LOW 9 — `sync-transcript-errors.sh`: nome de variável `AUDIT_LOG` inconsistente

Cosmético apenas. O script usa `AUDIT_LOG` de forma **internamente consistente** (override
per-session correto, todas as escritas via `$AUDIT_LOG`). Considerar renomear para `AUDIT_FILE` para
alinhar com o restante do codebase.

---

## ✅ Itens Verificados e Confirmados Corretos

| Script / Aspecto                                  | O que foi verificado                                                                          | Resultado      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------- |
| `session-close.sh` — flock                        | flock aberto **depois** do override per-session (lê `current-session-id.txt` primeiro)        | ✅ Correto     |
| `sync-transcript-errors.sh` — AUDIT_LOG           | usa `$AUDIT_LOG` em **todas** as escritas; sem hardcodes                                      | ✅ Correto     |
| `rotate-audit.sh` — nomenclatura de arquivo       | formato `YYYYMMDD_HHMMSS` (com `_` na posição 9) não casa com glob `audit-????????.jsonl`     | ✅ Sem colisão |
| `migrate-per-session-audit.sh`                    | idempotente, `--dry-run`, resolve symlinks via `readlink -f`                                  | ✅ Correto     |
| `session-start.sh` — flock                        | não usa flock (correto para criação de novos arquivos)                                        | ✅ Correto     |
| Glob `audit-????????.jsonl` — colisão de nomes    | archives usam `YYYYMMDD_HHMMSS` (15 chars + `_`); SID_SHORT tem 8 hex chars; sem sobreposição | ✅ Sem colisão |
| `apply_per_session_paths()` — fallback silencioso | documentado no código; comportamento intencional para backward compat                         | ✅ Intencional |

---

## Priorização para Correção

| Prioridade | ID                                     | Impacto em produção                                        |
| ---------- | -------------------------------------- | ---------------------------------------------------------- |
| 🔴 CRÍTICO | 1 — Flock race                         | Per-session CTX_FILE sem proteção de lock                  |
| 🔴 CRÍTICO | 2 — Hardcodes audit.jsonl              | ~95% dos eventos vão para o global — isolamento inoperante |
| 🟠 HIGH    | 3 — AUDIT_FILE overwrite mid-script    | Escritas pós-linha-289 vão para global                     |
| 🟠 HIGH    | 4 — generate-section-summary           | Summaries lêm dados da sessão errada                       |
| 🟡 MÉDIO   | 5 — Tempfile leak analytics            | Acúmulo de `/tmp/` em longa duração                        |
| 🟡 MÉDIO   | 6 — error-occurred.sh inconsistente    | Erros não auditados per-session                            |
| 🟡 MÉDIO   | 7 — manual-session-init recovery event | Evento de recovery na trilha global                        |
| 🟢 LOW     | 8 — subagent sem flock                 | Pre-existente, risco baixo                                 |
| 🟢 LOW     | 9 — AUDIT_LOG naming                   | Cosmético                                                  |

**Ordem recomendada de correção**:

1. CRÍTICO 2 primeiro (mecânico — `sd '"$LOG_DIR/audit.jsonl"' '"$AUDIT_FILE"'` com revisão manual
   de contexto)
2. CRÍTICO 1 (requer cuidado com a ordem de leitura de stdin antes de `exec 9>`)
3. HIGH 3 e 4 (substituição de variável local)
4. MÉDIO 5, 6, 7 (pequenas adições pontuais)
