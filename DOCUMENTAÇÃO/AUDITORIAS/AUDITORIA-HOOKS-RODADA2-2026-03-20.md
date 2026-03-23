# Auditoria de Hooks — 2ª Rodada (2026-03-20)

**Status**: Em progresso → RESOLVIDO **Contexto**: Esta é a segunda rodada de auditoria do sistema
de hooks. A primeira (62 GAPs) foi concluída e todos os itens estão marcados como RESOLVIDO no
documento `AUDITORIA-GERAL-HOOKS-2026-03-19.md`.

**Metodologia**: Leitura sistemática de todos os arquivos da camada de hooks (`.github/hooks/lib/`,
`.github/hooks/lib/api/`, `.github/hooks/scripts/`) com foco em:

1. Inconsistências internas entre módulos
2. Bugs silenciosos (código que compila/executa mas produz comportamento errado)
3. Ausência de tratamento de erros em operações críticas
4. Desvios do comportamento esperado pelo protocolo

---

## Resumo Executivo

| Severidade | Quantidade | Status    |
| ---------- | ---------- | --------- |
| HIGH       | 1          | RESOLVIDO |
| MEDIUM     | 5          | RESOLVIDO |
| LOW        | 5          | RESOLVIDO |
| **Total**  | **11**     |           |

---

## NEW-J — HIGH: `hook_validate_payload` chamado em subshell (validação rica morta)

**Arquivo**: `.github/hooks/lib/hook-payload-api.sh` **Severidade**: HIGH **Tipo**: Bug silencioso
(comportamento incorreto, código compila sem erro)

### Descrição

Em `hook_api_parse()`, o comentário menciona "validação rica por evento (módulo 14 — GAP-26)". O
código chama:

```bash
_val_result=$(hook_validate_payload 2>/dev/null || true)
if [ -n "$_val_result" ]; then
    _val_errors=$(printf '%s' "$_val_result" | jq -r '.error_count // 0' ...)
```

**O problema**: `hook_validate_payload()` em `api/14-validate-events.sh` NÃO emite nada em stdout —
ela apenas seta variáveis de processo (`_HV_ERRORS`, `_HV_WARNINGS`) e retorna via exit code.

Ao chamar dentro de subshell `$(...)`:

1. `_val_result` é **sempre vazio** (nenhum stdout é produzido)
2. As variáveis `_HV_ERRORS`/`_HV_WARNINGS` setadas dentro do subshell **não propagam** para o
   processo pai
3. A condição `if [ -n "$_val_result" ]` é **sempre false**
4. Os erros de validação **nunca são logados** no audit.jsonl
5. A validação semântica rica do módulo 14 é **código morto** neste fluxo

### Correção

Substituir `hook_validate_payload` por `hook_validate_load`, que chama a mesma lógica MAS emite JSON
via stdout (`.error_count`, `.warning_count`, `.errors`, `.warnings`).

```bash
# Antes (bugado):
_val_result=$(hook_validate_payload 2> /dev/null || true)

# Depois (correto):
_val_result=$(hook_validate_load 2> /dev/null || true)
```

**Status**: ✅ RESOLVIDO

---

## NEW-K — MEDIUM: Migração de schema define `strict_turn_close=false`

**Arquivo**: `.github/hooks/lib/api/13-state-version.sh` **Severidade**: MEDIUM **Tipo**: Bug de
lógica — viola invariante do protocolo

### Descrição

A migração de schema v0→v1 inicializa `strict_turn_close` com `false` para sessões legadas:

```bash
if [[ -z "$stc" || "$stc" == "null" ]]; then
  update_nested_state 'strict_turn_close' 'false' 2> /dev/null || true
fi
```

Mas `init_state()` em `common.sh` cria NOVAS sessões com `"strict_turn_close": true`.

Resultado: sessões legadas migradas ficam com enforcement **desligado**, enquanto sessões novas
começam com enforcement **ligado**. Sessões migradas podem encerrar turns sem `vscode_askQuestions`
sem que o hook `Stop` bloqueie.

### Correção

Alterar o valor default na migração de `'false'` para `'true'`:

```bash
update_nested_state 'strict_turn_close' 'true' 2> /dev/null || true
```

**Status**: ✅ RESOLVIDO

---

## NEW-A — MEDIUM: `increment_field` e `decrement_field_floor0` sem cleanup de temp file

**Arquivo**: `.github/hooks/lib/common.sh` **Severidade**: MEDIUM **Tipo**: Inconsistência de
tratamento de erros / possível corrupção de state

### Descrição

`update_nested_state()` tem tratamento robusto de erros após jq e mv:

```bash
jq ... "$STATE_FILE" > "$tmp" || {
  rm -f "$tmp"
  return 1
}
mv -f "$tmp" "$STATE_FILE" || {
  rm -f "$tmp"
  return 1
}
```

Mas `increment_field()` e `decrement_field_floor0()` não têm este tratamento:

```bash
jq --argjson v "$new_val" "${path} = \$v" "$STATE_FILE" > "$tmp" # sem || handler
mv -f "$tmp" "$STATE_FILE"                                       # sem || handler
```

Se `jq` falhar (e.g., `$STATE_FILE` corrompido), `$tmp` conterá output parcial/vazio e o `mv`
sobrescreverá `$STATE_FILE` com conteúdo inválido. Se `mv` falhar, `$tmp` fica como arquivo órfão em
`$STATE_DIR`.

### Correção

Adicionar os mesmos guards que `update_nested_state`:

```bash
jq --argjson v "$new_val" "${path} = \$v" "$STATE_FILE" > "$tmp" || {
  rm -f "$tmp"
  return 1
}
mv -f "$tmp" "$STATE_FILE" || {
  rm -f "$tmp"
  return 1
}
```

**Status**: ✅ RESOLVIDO

---

## NEW-C — MEDIUM: `hook_is_destructive_cmd` regex incompleto

**Arquivo**: `.github/hooks/lib/api/04-predicates.sh` **Severidade**: MEDIUM **Tipo**: Segurança —
comandos destrutivos não detectados

### Descrição

O padrão atual captura `rm -rf` e `rm -r`:

```bash
\brm\s+-rf?\b
```

Mas não detecta variantes destrutivas comuns:

- `rm -f arquivo` (remove forçado sem recursão — pode destruir arquivos críticos)
- `git clean -fd` (remove arquivos untracked recursivamente)
- `dd if=/dev/zero of=<path>` (sobrescreve arquivo com zeros)
- `chmod 000` / `chmod 777` em caminhos sistêmicos

### Correção

Ampliar o padrão de regex para incluir estas variantes:

```bash
\brm\s+-[a-zA-Z]*[fr][a-zA-Z]*\b # rm com qualquer combinação contendo -f ou -r
\bgit\s+clean\s+.*-f             # git clean com -f (force)
\bdd\b.*\bof=                    # dd com of= (output file)
```

**Status**: ✅ RESOLVIDO

---

## NEW-I — MEDIUM: `subagent_start/stop_counters` usam read-modify-write manual

**Arquivo**: `.github/hooks/lib/subagent-lib.sh` **Severidade**: MEDIUM (baixo impacto prático mas
inconsistência arquitetural) **Tipo**: Inconsistência — deveria usar
`increment_field`/`decrement_field_floor0`

### Descrição

`subagent_start_counters()` e `subagent_stop_counters()` implementam incremento/decremento
manualmente via `read_field` + `update_nested_state`, em vez de usar as funções canônicas
`increment_field` e `decrement_field_floor0` de `common.sh`:

```bash
# Manual (atual):
current_active=$(read_field ".session_stats.subagents_active")
new_active=$((current_active + 1))
update_nested_state "session_stats.subagents_active" "$new_active"
total=$(read_field ".session_stats.subagents_total")
update_nested_state "session_stats.subagents_total" "$((total + 1))"
```

Isso resulta em 4 operações de I/O no state (2 reads + 2 writes) em vez de 2. Além disso,
`subagent_start_counters` faz incremento de `subagents_active` e `subagents_total` separados quando
poderia usar `increment_field` para ambos.

### Correção

Refatorar para usar `increment_field` e `decrement_field_floor0`:

```bash
subagent_start_counters() {
  increment_field ".session_stats.subagents_active"
  increment_field ".session_stats.subagents_total" > /dev/null
}

subagent_stop_counters() {
  decrement_field_floor0 ".session_stats.subagents_active"
}
```

**Status**: ✅ RESOLVIDO

---

## NEW-L — MEDIUM: `extract_prompt_preview` usa `head -c80` (não UTF-8 safe)

**Arquivo**: `.github/hooks/lib/user-prompt-submit-lib.sh` **Severidade**: MEDIUM **Tipo**:
Regressão — GAP-12 foi corrigido em `subagent-lib.sh` mas não aqui

### Descrição

GAP-12 (rodada anterior) corrigiu `subagent-lib.sh` para usar `cut -c1-80` em vez de `head -c80`
para preservar fronteiras de caracteres UTF-8. Mas `user-prompt-submit-lib.sh` ainda usa:

```bash
printf '%s' "$prompt" | head -c80
```

`head -c80` trunca em 80 **bytes**, podendo cortar no meio de um caractere multibyte UTF-8, gerando
sequências inválidas no `audit.jsonl`.

### Correção

Utilizar `cut -c1-80` (truncagem por caractere, UTF-8 safe):

```bash
printf '%s' "$prompt" | cut -c1-80
```

**Status**: ✅ RESOLVIDO

---

## NEW-D — LOW: `hook_response_has_error` — padrões apenas em inglês

**Arquivo**: `.github/hooks/lib/api/04-predicates.sh` **Severidade**: LOW **Tipo**: Completude — não
detecta erros em português

### Descrição

O grep de respostas de erro detecta apenas termos ingleses:

```bash
grep -qiE '\berror\b|\bfail\b|\bexception\b|\bfatal\b'
```

Como o projeto produz logs e mensagens em pt-BR, os padrões em português ficam de fora: `erro`,
`falha`, `falhou`, `exceção`, `fatal`.

### Correção

Adicionar alternativas em português ao padrão:

```bash
grep -qiE '\berror\b|\bfail\b|\bexception\b|\bfatal\b|\berro\b|\bfalha\b|\bfalhou\b'
```

**Status**: ✅ RESOLVIDO

---

## NEW-F — LOW: `\x27` em bracket expression não porta em todos os shells

**Arquivo**: `.github/hooks/lib/pre-tool-use-lib.sh` **Severidade**: LOW **Tipo**: Portabilidade de
shell

### Descrição

A função `maybe_capture_turn_intent` usa:

```bash
["\x27]([^"\x27]+)["\x27]
```

`\x27` (hex para `'`) dentro de um bracket expression `[...]` em regex POSIX pode não ser
interpretado como escape hexadecimal em todos os shells/implementações de `grep`. Comportamento
correto não é garantido por `dash`, `ash` ou `busybox sh`.

### Correção

Usar a aspa literal escapada por variável ou usar `'"'"'` para incluir aspas simples:

```bash
["\x27] → ["']   # forma portável: inclui " e '
```

**Status**: ✅ RESOLVIDO

---

## NEW-G — LOW: Comparação `turn_count -eq 0` frágil com `2>/dev/null` parcial

**Arquivo**: `.github/hooks/lib/stop-lib.sh` **Severidade**: LOW **Tipo**: Robustez — edge case de
estado corrompido

### Descrição

A expressão:

```bash
[ -z "$turn_count" ] || [ "$turn_count" -eq 0 ] 2> /dev/null
```

O `2>/dev/null` está associado apenas ao segundo `[ ... ]`. Se `turn_count` contiver um valor
inválido (e.g., `"null"` como string), o primeiro `[ -z "$turn_count" ]` retorna false e o segundo
`-eq 0` falha com erro silenciado — mas o resultado do `||` pode ser unpredictable: `true` retorna
de `[ -z ... ]` sendo false, então depende do exit code do segundo comando que é silenciado.

### Correção

Usar aritmética defensiva com fallback:

```bash
[ "${turn_count:-0}" = "0" ] || [ "${turn_count:-0}" = "null" ]
```

**Status**: ✅ RESOLVIDO

---

## NEW-H — LOW: `wc -l` produz output com espaços à esquerda em alguns sistemas

**Arquivo**: `.github/hooks/lib/session-close-lib.sh` **Severidade**: LOW **Tipo**: Portabilidade

### Descrição

Em `_rotate_audit_log()`:

```bash
count=$(find "$ARCHIVE_DIR" -name "audit-*.jsonl" | sort | wc -l)
```

Em sistemas baseados em BSD (macOS) e algumas versões de Linux, `wc -l` produz output com espaços à
esquerda: `"    5"` em vez de `"5"`. A comparação `[ "$count" -gt "$MAX_AUDIT_FILES" ]` ainda
funciona pois bash faz trim de espaços em comparações aritméticas, mas usos como `"${count:-0}"` em
outras operações podem falhar.

### Correção

Normalizar o output de `wc -l`:

```bash
count=$(find "$ARCHIVE_DIR" -name "audit-*.jsonl" | sort | wc -l | tr -d ' ')
```

**Status**: ✅ RESOLVIDO

---

## Referências

- Documento de auditoria anterior: `DOCUMENTAÇÃO/AUDITORIAS/AUDITORIA-GERAL-HOOKS-2026-03-19.md`
- Arquivos modificados nesta rodada:
  - `.github/hooks/lib/hook-payload-api.sh` (NEW-J)
  - `.github/hooks/lib/api/13-state-version.sh` (NEW-K)
  - `.github/hooks/lib/common.sh` (NEW-A)
  - `.github/hooks/lib/api/04-predicates.sh` (NEW-C, NEW-D)
  - `.github/hooks/lib/subagent-lib.sh` (NEW-I)
  - `.github/hooks/lib/user-prompt-submit-lib.sh` (NEW-L)
  - `.github/hooks/lib/pre-tool-use-lib.sh` (NEW-F)
  - `.github/hooks/lib/stop-lib.sh` (NEW-G)
  - `.github/hooks/lib/session-close-lib.sh` (NEW-H)
