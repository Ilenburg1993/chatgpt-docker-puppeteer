# Plano de Correções, Aprimoramentos e Upgrades do Sistema de Hooks

**Versão**: 1.1 **Data de criação**: 2026-03-11 **Última atualização**: 2026-03-11 (Sessão de
implementação — fase 1 concluída) **Status**: Ativo — documento vivo atualizado continuamente
**Complemento**: `GUIA-HOOKS-COPILOT.md` (arquitetura, fluxo, conceitos permanentes)

> **Propósito**: Este documento registra todos os bugs identificados, correções propostas,
> aprimoramentos e upgrades do sistema de hooks. Diferentemente do GUIA (que documenta a arquitetura
> e os conceitos estáveis), este documento é evolutivo: cada sessão de trabalho pode adicionar novas
> entradas, marcar itens como concluídos, e registrar decisões tomadas.

---

## Premissas Fundamentais (Imutáveis)

> Estas premissas definem as regras de ouro do sistema. Toda correção ou melhoria DEVE respeitá-las.

### PREMISSA-1 — Soberania do VS Code sobre identidades de plataforma

**O `session_id` é SEMPRE fornecido pelo VS Code. Nunca o geramos.**

- Variáveis **dadas pelo VS Code** (campo `session_id` em todos os hooks): devemos **capturar e
  registrar** para sincronizar o sistema.
- Variáveis **criadas por nós** (ex: `close_key`, `section_id`, `logical_restart_count`): são nossa
  responsabilidade.
- Quando há divergência entre o que o VS Code envia e o que nosso CTX tem, o VS Code é a **fonte da
  verdade**.

**Corolário**: Nunca criar UUIDs aleatórios para substituir ou simular um `session_id` do VS Code.
Se o VS Code não enviou um novo `session_id`, o `session_id` atual se mantém.

### PREMISSA-2 — Integridade dos scripts auto-iniciados

**Scripts invocados automaticamente pelo VS Code (via hooks) NUNCA devem ser chamados manualmente em
produção.**

Isso se aplica a todos os 10 scripts registrados em `copilot-hooks.json`:

| Hook Event            | Script                | Observação                                                                                         |
| --------------------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| `sessionStart`        | `session-start.sh`    | Payload: `timestamp, session_id, cwd, source`                                                      |
| `userPromptSubmitted` | `log-prompt.sh`       | Payload: `timestamp, session_id`                                                                   |
| `preToolUse`          | `pre-tool-use.sh`     | Payload: `timestamp, session_id, cwd, tool_name, tool_use_id, tool_input (obj), stop_hook_active`  |
| `postToolUse`         | `post-tool-use.sh`    | Payload: `timestamp, session_id, tool_name, tool_use_id, tool_response`                            |
| `agentStop`           | `agent-stop.sh`       | Payload: `timestamp, session_id, stop_hook_active`                                                 |
| `subagentStart`       | `subagent-start.sh`   | Payload: `timestamp, session_id`                                                                   |
| `subagentStop`        | `subagent-stop.sh`    | Payload: `timestamp, session_id, agentName(?), result(?), tool_use_id(?)` — schema não documentado |
| `postToolUseFailure`  | `tool-use-failure.sh` | Payload: `timestamp, session_id, tool_name, tool_use_id, error`                                    |
| `preCompact`          | `pre-compact.sh`      | Payload: `timestamp, session_id`                                                                   |
| `sessionEnd`          | `session-end.sh`      | Payload: `timestamp, cwd, reason` — **SEM `session_id`!**                                          |

**Exceção**: ambientes de sandbox para testes isolados, explicitamente marcados.

**Corolário**: Qualquer lógica que dependa de "o usuário chamou manualmente" é uma forma de
contornar este princípio. A única exceção documentada (`source: "manual_recovery"`) deve ser
gradualmente eliminada ou restrita a fluxos de recuperação de desastre.

---

## Seção 1 — Diagnóstico: A Causa Raiz do `session_id_mismatch`

### 1.1 Confirmação da causa raiz (2026-03-11)

**Evidência direta** do `audit.jsonl` atual:

```json
{
  "event": "session_id_mismatch",
  "expected": "9314ba83-863d-41ff-811d-4a165b77dc91",
  "got": "dcf579af-502e-4bf2-9d92-75903f85b0a2",
  "source": "pre-tool-use.sh",
  "tool": "manage_todo_list",
  "timestamp": "2026-03-11T21:39:32.465Z",
  "message": "Payload session_id diferente do contexto ativo — state write bloqueado"
}
```

- **`expected`** (`9314ba83-...`): UUID gerado por **nosso código** (RECONNECT-02 em
  `log-prompt.sh`)
- **`got`** (`dcf579af-...`): session_id **real do VS Code** — o que a plataforma realmente envia

**Conclusão**: estamos bloqueando state writes porque nós mesmos geramos um UUID que o VS Code nunca
conhece. O VS Code continua usando o session_id correto (`dcf579af-...`). Nós é que erramos.

### 1.2 Sequência exata do bug

```
1. Sessão dcf579af-... com authorized_close executado (session-close.sh)
   → ended_at registrado no session-context.json

2. Usuário digita novo prompt na mesma janela do chat
   → VS Code envia: {hook: "userPromptSubmitted", session_id: "dcf579af-..."}
   → VS Code NÃO dispara novo sessionStart (LIM-02: mesmo painel = mesma sessão VS Code)

3. log-prompt.sh executa:
   a. RECONNECT-01 check: SESSION_ID_PAYLOAD = "dcf579af-..." == CTX.session.id = "dcf579af-..." → OK
   b. RECONNECT-02 check: CTX.session.ended_at != null → DISPARA

4. RECONNECT-02 (BUG):
   → Gera _NEW_SID = "9314ba83-..." (UUID aleatório via /proc/sys/kernel/random/uuid)
   → Escreve CTX.session.id = "9314ba83-..." (UUID que VS Code NUNCA vai enviar)
   → Loga sessionStart_inline com o UUID novo
   → SESSION_ID = "9314ba83-..."

5. VS Code continua enviando session_id = "dcf579af-..." em TODAS as chamadas de hook

6. pre-tool-use.sh: expected = "9314ba83-..." (CTX), got = "dcf579af-..." (VS Code) → MISMATCH
7. post-tool-use.sh: idem → MISMATCH
8. agent-stop.sh: idem → MISMATCH (HEAL v2 ativa após 3x)

Resultado: STATE WRITES BLOQUEADOS para todos os tool calls do turno.
Métricas do turno perdidas: tools_count, failures_count, intent, etc.
```

### 1.3 Por que o VS Code não dispara novo sessionStart

Confirmado em GUIA-HOOKS-COPILOT.md Seção 3.1 (LIM-02) e evidenciado na sessão `dcf579af` (24h, 1892
preToolUse events, apenas 1 sessionStart):

> `sessionStart` dispara **no máximo 1x por janela/aba de chat**. Se o usuário continua na mesma
> conversa após nosso `session-close.sh`, o VS Code NÃO abre nova sessão — ele mantém o mesmo
> `session_id` para sempre naquela janela.

Isso é correto e esperado. **Nosso código é que deve se adaptar**, não o VS Code.

### 1.4 Cenários de ciclo de vida do session_id

| Cenário                                                  | O que VS Code faz                                    | O que devemos fazer                                |
| -------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| Usuário abre nova aba de chat                            | Dispara `sessionStart` com novo `session_id`         | `session-start.sh` cria CTX com o novo ID ✅       |
| Usuário continua na mesma aba (turnos normais)           | Dispara `userPromptSubmitted` com mesmo `session_id` | `log-prompt.sh` usa mesmo ID ✅                    |
| VS Code inline compaction (token budget)                 | NÃO dispara `sessionStart`; `session_id` não muda    | RECONNECT-01 não dispara (IDs iguais) ✅           |
| Nosso `session-close.sh` + usuário continua na mesma aba | `userPromptSubmitted` com mesmo `session_id` antigo  | RECONNECT-02 deve usar `SESSION_ID_PAYLOAD` ❌ BUG |
| VS Code reinicia (DevContainer rebuild)                  | Dispara `sessionStart` com novo `session_id`         | `session-start.sh` cria CTX com o novo ID ✅       |

O único cenário com bug é o 4º — e é o mais comum no uso diário.

---

## Seção 2 — Bugs Identificados

### BUG-01 [CRÍTICO] — RECONNECT-02 gera UUID aleatório em vez de usar session_id do VS Code

**Arquivo**: `.github/hooks/scripts/log-prompt.sh` **Linhas**: 173–175 **Status**: ✅ IMPLEMENTADO
(2026-03-11)

**Código atual (bugado)**:

```bash
# ── Post-Close Recovery (RECONNECT-02) ──────────────────────────────────────
# ...
if [ -n "$_ENDED_AT_RC" ] && [ "$_ENDED_AT_RC" != "null" ]; then
    ...
    # Gera novo session_id    ← ESTE BLOCO É O BUG
    if [ -f /proc/sys/kernel/random/uuid ]; then
        _NEW_SID="$(cat /proc/sys/kernel/random/uuid)"
    else
        _NEW_SID="sess_$(date +%s%N 2> /dev/null | sha256sum | head -c 32 || date +%s | head -c 32)"
    fi
```

**Impacto**: Cria UUID que o VS Code nunca enviará → todos os state writes bloqueados enquanto durar
a divergência.

**Código corrigido**:

```bash
# FIX BUG-01: usa session_id real do VS Code (Premissa-1: VS Code é a fonte da verdade)
# SESSION_ID_PAYLOAD = o que o VS Code enviou neste userPromptSubmitted
# O VS Code continuará enviando este mesmo ID em todos os hooks futuros.
# Gerar um UUID aqui causaria mismatch permanente com todos os hooks.
if [ -n "$SESSION_ID_PAYLOAD" ]; then
  _NEW_SID="$SESSION_ID_PAYLOAD"
elif [ -f /proc/sys/kernel/random/uuid ]; then
  # Fallback apenas quando VS Code não enviou session_id (caso improvável)
  _NEW_SID="$(cat /proc/sys/kernel/random/uuid)"
else
  _NEW_SID="sess_$(date +%s%N 2> /dev/null | sha256sum | head -c 32 || date +%s | head -c 32)"
fi
```

**Nota**: Com esta correção, o `session.id` no CTX será o mesmo `dcf579af-...` que a sessão
anterior. Isso é **correto** — do ponto de vista do VS Code, é a mesma sessão. Nós apenas marcamos
semanticamente como "nova sessão lógica" através dos campos `session.source = "inline_restart"`,
`session.started_at` (novo timestamp), `session.prev_session_id` (para rastreabilidade).

---

### BUG-02 [ALTA] — HEAL v2 ausente em `pre-tool-use.sh` e `post-tool-use.sh`

**Arquivos**: `pre-tool-use.sh` (linhas 189-213), `post-tool-use.sh` (linhas 83-130) **Status**: �
Parcialmente coberto — ver BUG-06A e BUG-06B abaixo

> **Nota atualizada**: O HEAL v2 genérico (contador de mismatches) não foi portado para
> pre/post-tool-use.sh. Em vez disso, implementamos um tratamento específico para o caso mais comum
> (inline_restart) via BUG-06. O HEAL v2 genérico permanece como debt para sessões com múltiplos
> reinícios rápidos.

**Contexto**: `agent-stop.sh` possui HEAL v2 — após 3 mismatches consecutivos com o mesmo `got`
session_id, adota aquele ID como o correto. Porém `pre-tool-use.sh` e `post-tool-use.sh` não têm
esse mecanismo.

**Impacto**: Mesmo após o BUG-01 ser corrigido, se ocorrer qualquer mismatch genuíno (ex: nova
sessão real criada pelo VS Code), os primeiros 3 turnos terão state writes bloqueados até
`agent-stop.sh` sanar via HEAL v2.

**Correção**: Adicionar HEAL v2 em `pre-tool-use.sh` e `post-tool-use.sh` espelhando a lógica de
`agent-stop.sh` (arquivo `.mismatch_track.json`). Ou melhor: extrair HEAL v2 para
`hooks-lib/common.sh` como função compartilhada.

---

### BUG-03 [ALTA] — `search_subagent` não detectado como autorização implícita

**Arquivo**: `.github/hooks/scripts/pre-tool-use.sh` **Linha**: 286 **Status**: ✅ IMPLEMENTADO
(2026-03-11)

**Código atual**:

```bash
elif [ "$TOOL_NAME" = "runSubagent" ]; then
    # auth_requested=true, subagent_delegated=true
```

**Problema**: `search_subagent` é categorialmente equivalente a `runSubagent` (ambos são ferramentas
Core), mas não é detectado. Quando o agente usa `search_subagent`, o `agent-stop.sh` pode bloquear o
turno por falta de `auth_requested`.

**Código corrigido**:

```bash
elif [ "$TOOL_NAME" = "runSubagent" ] || [ "$TOOL_NAME" = "search_subagent" ]; then
    # auth_requested=true, subagent_delegated=true
```

---

### BUG-04 [MÉDIA] — `subagent_calls` contado duas vezes

**Arquivos**: `pre-tool-use.sh` (linha 322) E `subagent-start.sh` **Status**: ✅ IMPLEMENTADO
(2026-03-11)

> **Implementação**: Removido o incremento de `subagent_calls` de `pre-tool-use.sh`. Comentário FIX
> BUG-04 indica que `subagent-start.sh` é o local correto.

**Problema**: O contador `session_stats.subagent_calls` é incrementado em `pre-tool-use.sh` quando
detecta `runSubagent`, E TAMBÉM em `subagent-start.sh` quando o subagente realmente inicia.
Resultado: cada subagente conta 2x.

**Correção**: Remover o incremento de `subagent_calls` de `pre-tool-use.sh`. Manter apenas em
`subagent-start.sh` (evento mais semânticamente correto — confirma que o subagente realmente
começou).

---

### BUG-05 [BAIXA] — GUIA Section 3.1 conflação de dois `source` diferentes

**Arquivo**: `DOCUMENTAÇÃO/HOOKS/GUIA-HOOKS-COPILOT.md` **Linha**: ~264 **Status**: 🟡 Documentação
— não quebra código

**Texto atual**:

> "O campo `source` é atualmente sempre `"new"` (a plataforma não distingue outros casos)."

**Problema**: A afirmação é correta para o `source` enviado **pelo VS Code** no input do hook
`sessionStart`. Porém o GUIA não distingue claramente este `source` do `session.source` que **nosso
código** escreve no CTX (que pode ser `"inline_restart"`, `"reconnect_rollover"`,
`"manual_recovery"`, `"healed_from_real_session"`, `"healed_from_consecutive_mismatch"`). Essa
confusão levou à subestimação do bug.

**Correção proposta**: Adicionar à Section 3.1 uma nota explícita distinguindo:

- **`source` do VS Code** (payload de entrada do hook `sessionStart`): sempre `"new"`
- **`session.source` do CTX** (campo escrito pelos nossos scripts): múltiplos valores — ver tabela
  em Seção X.Y

---

### BUG-06 [BAIXA] — `session.source = "manual_recovery"` viola a Premissa-2

**Arquivos**: `pre-tool-use.sh`, `post-tool-use.sh`, `log-prompt.sh` **Status**: 🟡 Design debt —
não urgente

**Problema**: O mecanismo `manual_recovery` pressupõe que o agente pode criar um CTX manualmente
(colocando `source: "manual_recovery"`), e os hooks o detectam e fazem HEAL. Isso viola a
Premissa-2: "scripts auto-iniciados nunca devem ser iniciados manualmente".

**Impacto**: Baixo impacto funcional — é um mecanismo de recuperação de desastre. Mas seu design
conflita com as premissas.

**Proposta a longo prazo**: Substituir o mecanismo de `manual_recovery` por um fluxo formal de
recuperação via `session-start.sh sandbox` (para testar) ou um script dedicado `session-recover.sh`
com validações explícitas.

---

### BUG-06A [CRÍTICO] — `session-start.sh` zereia CTX completo em `inline_restart`

**Arquivo**: `.github/hooks/scripts/session-start.sh` **Status**: ✅ IMPLEMENTADO (2026-03-11)

**Problema**: `session-start.sh` sempre criava um CTX vazio do zero
(`jq -cn ... > session-context.json`), destruindo estatísticas acumuladas (turn_count, tools_total,
section_history) quando o VS Code disparava `sessionStart` com `source = "inline_restart"`.

**Implementação**: Adicionado branch condicional antes do `jq -cn`:

- `inline_restart` + CTX existente → atualização parcial (apenas `session.*` e `last_tool.ts`)
- Outros casosos → reset completo (comportamento original preservado)
- Fallback para reset completo se CTX corrompido no caminho de `inline_restart`

---

### BUG-06B [ALTO] — HEAL `inline_restart` ausente em todos os scripts de hook

**Arquivos**: `pre-tool-use.sh`, `post-tool-use.sh`, `agent-stop.sh` **Status**: ✅ IMPLEMENTADO
(2026-03-11)

**Problema**: Quando payload traz session_id stale (de sessão anterior) e CTX tem novo session_id do
VS Code (`inline_restart`), os scripts bloqueavam em vez de sincronizar. Por PREMISSA-1, CTX (VS
Code) é a fonte da verdade.

**Implementação**: Adicionado ramo `inline_restart` no guard de todos os três scripts:

- Adota `CTX_ACTIVE_SID` como `SESSION_ID` local
- Loga evento `session_id_sync_inline_restart`
- Não bloqueia (não faz `exit 0`)
- Não modifica o CTX (VS Code já está correto)

---

### BUG-06C [ALTO] — `search_subagent` não reforça `auth_requested` em `post-tool-use.sh`

**Arquivo**: `.github/hooks/scripts/post-tool-use.sh` **Status**: ✅ IMPLEMENTADO (2026-03-11)

**Problema**: `post-tool-use.sh` não tratava `runSubagent` nem `search_subagent` — auth_requested
ficava apenas no que pre-tool-use.sh setou, sem reforço pós-execução.

**Implementação**: Adicionado ramo `elif` para `runSubagent || search_subagent` que reforça
`auth_requested=true` e `subagent_delegated=true` (defesa em profundidade).

---

## Seção 3 — Gaps Identificados (Funcionalidade Faltante)

### GAP-01 — session_id não é a primeira verificação em `log-prompt.sh`

**Contexto**: O usuário solicitou explicitamente que em `userPromptSubmitted`, a PRIMEIRA ação deve
ser verificar se há novo `session_id` ou não.

**Situação atual** em `log-prompt.sh`:

1. Lock de arquivo
2. Leitura de INPUT
3. Extração de campos básicos (TIMESTAMP, SESSION_ID_PAYLOAD, etc.)
4. **RECONNECT-01** (verifica session_id — linha ~61)
5. ...processamento intermediário...
6. **RECONNECT-02** (orphan session — linha ~158)

**Proposta**: Após passo 3 (extração de campos), adicionar uma etapa explícita e comentada "PHASE 0
— SESSION_ID RECONCILIATION" que executa RECONNECT-01 e RECONNECT-02 em sequência, antes de qualquer
outro processamento. O código já faz isso aproximadamente, mas a organização visual e a ordem podem
ser melhoradas.

---

### GAP-02 — Ausência de campo `session.vs_code_session_id` explícito

**Contexto**: Hoje `session.id` no CTX pode ser:

- O session_id real enviado pelo VS Code (quando `sessionStart` dispara)
- Um UUID gerado por nós (raro após a correção do BUG-01, mas historicamente frequente)

**Proposta**: Adicionar campo `session.vs_code_session_id` explícito que SEMPRE contém o último
`session_id` enviado pelo VS Code. Isso permite:

1. Auditoria clara de quando nosso `session.id` divergiu do `vs_code_session_id`
2. Scripts poderem verificar rapidamente se há divergência
3. Dashboard mostrar "VS Code session" vs "nossa sessão lógica" separadamente

---

### GAP-03 — Métricas de mismatch não disponíveis no CTX

**Contexto**: `session_id_mismatch` é logado apenas no `audit.jsonl`. Não há contador no CTX.

**Proposta**: Adicionar `session_stats.session_id_mismatches` (contador) no CTX, incrementado por
`pre-tool-use.sh` e `post-tool-use.sh` quando detectam mismatch. Valor visível para dashboards e
session-briefing.

---

### GAP-04 — Lógica de HEAL não compartilhada via `hooks-lib/common.sh`

**Contexto**: A lógica de HEAL (HEAL v1 para `manual_recovery`, HEAL v2 threshold-based) existe
duplicada em `pre-tool-use.sh`, `post-tool-use.sh`, e `agent-stop.sh`.

**Proposta**: Criar função `heal_session_id_if_needed()` em `hooks-lib/common.sh`:

```bash
# heal_session_id_if_needed SESSION_ID_PAYLOAD CTX_FILE
# Returns: 0 se healed/ok, 1 se mismatch → caller deve exit 0
heal_session_id_if_needed() {
  local payload_sid="$1"
  local ctx_file="$2"
  # ... lógica unificada de HEAL v1 + HEAL v2 ...
}
```

Todos os scripts chamam essa única função. Elimina duplicação e garante consistência.

---

## Seção 4 — Upgrades Arquiteturais

### UPG-01 — Separação explícita "identidade VS Code" vs "sessão lógica"

**Motivação**: A confusão entre `session.id` (nosso) e `session_id` do VS Code é a causa raiz do
BUG-01. Precisamos de vocabulário e campos distintos.

**Proposta de campo**:

```json
{
  "session": {
    "id": "dcf579af-502e-4bf2-9d92-75903f85b0a2",       // == vs_code_session_id (Premissa-1)
    "vs_code_session_id": "dcf579af-502e-4bf2-9d92-75903f85b0a2",  // explícito, sempre igual
    "logical_session_number": 2,                          // nosso contador de sessões lógicas
    "logical_restart_at": "2026-03-11T21:38:15Z",        // quando criamos a "nova sessão lógica"
    "source": "inline_restart",                          // nosso marcador semântico
    ...
  }
}
```

Com `session.id` sempre igual a `vs_code_session_id` (por Premissa-1), o campo `vs_code_session_id`
seria redundante mas explícito. A questão é: como distinguir sessões lógicas múltiplas dentro da
mesma janela de chat? Via `logical_session_number` e `logical_restart_at`.

---

### UPG-02 — Inventário formal de variáveis: "dadas pelo VS Code" vs "criadas por nós"

**Motivação**: Premissa-1 exige que saibamos exatamente quais variáveis são do VS Code e quais são
nossas.

**Inventário proposto**:

| Campo                                      | Origem                   | Onde é lido                           | Quem escreve no CTX              |
| ------------------------------------------ | ------------------------ | ------------------------------------- | -------------------------------- |
| `session_id`                               | VS Code (todos os hooks) | `jq -r '.session_id'` do INPUT        | Nossem CTX como `session.id`     |
| `session.source` (no payload sessionStart) | VS Code (`"new"`)        | `session-start.sh` lê de INPUT        | Nossem CTX como `session.source` |
| `transcript_path`                          | VS Code                  | Todos os hooks                        | Não persistido hoje              |
| `tool_use_id`                              | VS Code                  | `pre-tool-use.sh`, `post-tool-use.sh` | `last_tool.tool_use_id`          |
| `stop_hook_active`                         | VS Code                  | `agent-stop.sh`                       | Não persistido                   |
| `close_key`                                | —                        | —                                     | **Criamos (nosso)**              |
| `session.source` (no CTX)                  | —                        | —                                     | **Criamos (nosso)**              |
| `section_id`                               | —                        | —                                     | **Criamos via uuidgen (nosso)**  |
| `turn_id`                                  | —                        | —                                     | **Criamos via uuidgen (nosso)**  |

---

### UPG-03 — Session-briefing.md deve distinguir "sessão VS Code" vs "sessão lógica"

**Motivação**: Quando a sessão lógica é reiniciada (RECONNECT-02), o briefing atualmente apresenta
como se fosse uma sessão completamente nova. Mas o VS Code está na mesma sessão.

**Proposta**: Adicionar ao session-briefing (gerado por `session-start.sh` e RECONNECT-02) uma seção
clara:

```
🔗 SESSÃO VS CODE: dcf579af-... (inalterada desde 09/03/2026)
🔄 SESSÃO LÓGICA: #2 (reiniciada em 11/03/2026 após encerramento autorizado)
```

---

## Seção 5 — Plano de Implementação

### Ordem de prioridade

| ID     | Fix                                                                                                                                                                                                        | Impacto                               | Arquivo                                                           | Complexidade          | Status                                                                                               |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------- |
| BUG-01 | RECONNECT-02 usa SESSION_ID_PAYLOAD                                                                                                                                                                        | CRÍTICO — elimina mismatches          | `log-prompt.sh` L173-175                                          | Baixa (3 linhas)      | ✅ CONCLUÍDO                                                                                         |
| BUG-02 | inline_restart preserva stats                                                                                                                                                                              | ALTA (robustez)                       | `session-start.sh`                                                | Média                 | ✅ CONCLUÍDO                                                                                         |
| BUG-03 | Detectar `search_subagent`                                                                                                                                                                                 | ALTA — evita false positives blocking | `pre-tool-use.sh` L286                                            | Muito baixa (1 linha) | ✅ CONCLUÍDO                                                                                         |
| BUG-04 | Remover double-count subagent_calls                                                                                                                                                                        | MÉDIA                                 | `pre-tool-use.sh` L322                                            | Baixa                 | ✅ CONCLUÍDO                                                                                         |
| BUG-05 | search_subagent auth_requested                                                                                                                                                                             | ALTA                                  | `post-tool-use.sh`                                                | Baixa                 | ✅ CONCLUÍDO                                                                                         |
| BUG-06 | HEAL v1 cobre inline_restart                                                                                                                                                                               | ALTA (robustez)                       | `pre-tool-use.sh`, `post-tool-use.sh`, `agent-stop.sh`            | Baixa                 | ✅ CONCLUÍDO                                                                                         |
| GAP-01 | SESSION_ID como 1ª verificação                                                                                                                                                                             | MÉDIA (clareza)                       | `log-prompt.sh` (header PHASE 0)                                  | Baixa                 | ✅ CONCLUÍDO                                                                                         |
| GAP-02 | Campo `vs_code_session_id`                                                                                                                                                                                 | BAIXA (visibilidade)                  | `session-start.sh`, `log-prompt.sh`                               | Alta                  | ✅ CONCLUÍDO                                                                                         |
| GAP-03 | Contador `session_id_mismatches`                                                                                                                                                                           | BAIXA (observabilidade)               | `session-start.sh`, `pre-tool-use.sh`, `post-tool-use.sh`         | Baixa                 | ✅ CONCLUÍDO                                                                                         |
| GAP-04 | Extrair HEAL para common.sh                                                                                                                                                                                | ALTA (robustez)                       | `hooks-lib/common.sh` (heal_v1/v2)                                | Média                 | ✅ CONCLUÍDO                                                                                         |
| BUG-07 | `subagent-start.sh`: SESSION_ID_PAYLOAD + HEAL + mismatch counter                                                                                                                                          | ALTA                                  | `subagent-start.sh`                                               | Baixa                 | ✅ CONCLUÍDO                                                                                         |
| BUG-08 | `subagent-stop.sh`: HEAL + mismatch counter                                                                                                                                                                | ALTA                                  | `subagent-stop.sh`                                                | Baixa                 | ✅ CONCLUÍDO                                                                                         |
| BUG-09 | `tool-use-failure.sh`: HEAL + mismatch counter                                                                                                                                                             | ALTA                                  | `tool-use-failure.sh`                                             | Baixa                 | ✅ CONCLUÍDO                                                                                         |
| BUG-10 | `pre-compact.sh`: HEAL + mismatch counter + sponge                                                                                                                                                         | ALTA                                  | `pre-compact.sh`                                                  | Baixa                 | ✅ CONCLUÍDO                                                                                         |
| BUG-11 | `session-end.sh`: query ERRORS_COUNT usa nome errado do evento                                                                                                                                             | MÉDIA                                 | `session-end.sh`                                                  | Muito baixa           | ✅ CONCLUÍDO                                                                                         |
| BUG-12 | Assinatura errada de `heal_v1()` nos 4 scripts secundários                                                                                                                                                 | CRÍTICA (heal silencioso)             | `subagent-start/stop.sh`, `tool-use-failure.sh`, `pre-compact.sh` | Baixa                 | ✅ CONCLUÍDO                                                                                         |
| BUG-13 | Double-count `subagent_calls` (start + stop ambos incrementam)                                                                                                                                             | ALTA (métricas 2x infladas)           | `subagent-stop.sh` + novo campo `subagent_completions`            | Baixa                 | ✅ CONCLUÍDO                                                                                         |
| BUG-14 | `subagent_delegated` nunca resetado entre turnos                                                                                                                                                           | ALTA (false auth turnos seguintes)    | `agent-stop.sh` reset de `current_turn`                           | Muito baixa           | ✅ CONCLUÍDO                                                                                         |
| BUG-15 | `increment_mismatch` chamado com arg `$CTX_FILE` desnecessário                                                                                                                                             | BAIXA (confusão semântica)            | 4 scripts secundários                                             | Muito baixa           | ✅ CONCLUÍDO                                                                                         |
| BUG-16 | `tool-use-failure.sh`: guard executava APÓS writes — contamina `audit.jsonl` c/ session_id errado                                                                                                          | ALTA (integridade de log)             | `tool-use-failure.sh`                                             | Baixa                 | ✅ CONCLUÍDO                                                                                         |
| BUG-17 | HEALs inline em `pre/post-tool-use.sh` não atualizavam `vs_code_session_id`                                                                                                                                | MÉDIA (inconsistência de campo)       | `pre-tool-use.sh`, `post-tool-use.sh`                             | Muito baixa           | ✅ CONCLUÍDO                                                                                         |
| GAP-05 | Schema `session_stats` e `current_turn` faltavam campos: `subagent_completions`, `askquestions_api_failures`, `todo_created`, `block_count`, `agentStop_invocations`, `subagent_delegated`, `section_turn` | MÉDIA (campos sem default explícito)  | `session-start.sh`                                                | Muito baixa           | ✅ CONCLUÍDO                                                                                         |
| ROB-B  | `common.sh` sourcing silencioso em 8 scripts — scripts continuavam sem aviso quando lib não carregava                                                                                                      | BAIXA (observabilidade)               | Todos os 8 scripts de hook                                        | Muito baixa           | ✅ CONCLUÍDO                                                                                         |
| GAP-O1 | Log `session_id_sync_inline_restart` gerado sem limite — ruído excessivo no `audit.jsonl` em sessões longas                                                                                                | BAIXA (ruído de log)                  | `pre-tool-use.sh`, `post-tool-use.sh`                             | Muito baixa           | ✅ CONCLUÍDO                                                                                         |
| ROB-C  | `jq` parse errors silenciosos em chamadas críticas — falhas de leitura do CTX propagam valores vazios                                                                                                      | BAIXA (robustez)                      | Vários scripts                                                    | Baixa                 | ✅ Já implementado (padrão `2>/dev/null \|\| echo` uniforme)                                         |
| INC-02 | `section_name` default inconsistente — alguns scripts usam `"início"`, outros `"initial"` ou string vazia                                                                                                  | BAIXA (consistência)                  | `session-start.sh`, `log-prompt.sh`                               | Muito baixa           | ⚪ Falso alarme — `"initial"` não existe no código; `"início"` e `"retomada"` são design intencional |
| INC-03 | Dois padrões distintos para update do CTX: `ctx_update()`, `sponge` direto e `mktemp+mv`                                                                                                                   | BAIXA (debt técnico)                  | Múltiplos scripts                                                 | Baixa                 | ⚪ Falso alarme — 3 padrões são design intencional: flock(crítico), sponge(inline), mktemp(fallback) |
| DOC-01 | Atualizar GUIA-HOOKS-COPILOT.md para refletir correções                                                                                                                                                    | BAIXA (doc)                           | `GUIA-HOOKS-COPILOT.md`                                           | Muito baixa           | ✅ Parcialmente concluído — BUG-05 aplicado; footer v2.0 atualizado                                  |
| UPG-01 | Separação VS Code vs sessão lógica                                                                                                                                                                         | ALTA (arquitetural)                   | Schema v9                                                         | Alta                  | ✅ Parcialmente implementado (2026-03-12)                                                            |
| UPG-02 | Inventário formal de variáveis                                                                                                                                                                             | BAIXA (doc)                           | GUIA + este doc                                                   | Muito baixa           | ✅ Concluído (Seção 7-A)                                                                             |
| UPG-03 | Session-briefing distingue sessões                                                                                                                                                                         | BAIXA                                 | `session-start.sh`                                                | Baixa                 | ✅ CONCLUÍDO (2026-03-12)                                                                            |

---

## Seção 6 — Decisões Tomadas (Registro Histórico)

### DECISÃO-01 (2026-03-11): BUG-01 — usar SESSION_ID_PAYLOAD no RECONNECT-02

**Decisão**: Usar `SESSION_ID_PAYLOAD` como `_NEW_SID` no RECONNECT-02, em vez de gerar UUID
aleatório.

**Raciocínio**:

1. Premissa-1: VS Code é fonte da verdade para `session_id`
2. VS Code continuará enviando o mesmo `session_id` em todos os hooks futuros — não temos como mudar
   isso
3. Nossa "nova sessão lógica" deve usar o mesmo ID que a plataforma usa
4. A distinção "início de nova sessão lógica" é capturada por: `session.source = "inline_restart"`,
   `session.started_at` (novo), `session.prev_session_id`, `session.logical_session_number`

**Alternativa rejeitada**: Criar um `session.vs_code_session_id` separado e manter `session.id` como
nosso UUID. Rejeitada porque: (a) aumenta complexidade, (b) todos os guards de mismatch precisariam
ser reescritos para comparar `vs_code_session_id` em vez de `session.id`, (c) viola Premissa-1 ao
diferenciar nossa identidade da do VS Code.

---

## Seção 7 — Questões em Aberto

---

## Seção 7-A — Inventário Completo de Variáveis VS Code vs Variáveis Internas

> Atualizado em 2026-03-11 (análise exaustiva de todos os 10 scripts auto-chamados)

### 7-A.1 — Variáveis fornecidas pelo VS Code por evento de hook

Toda variável nesta tabela é extraída **diretamente do payload JSON na stdin** enviado pelo VS Code.
O agente **nunca** deve sobrescrever esses valores — são a fonte da verdade da plataforma.

| Campo do Payload   | Tipo            | Hooks que enviam                                                     | Descrição                                                                    | Observação                                                |
| ------------------ | --------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| `timestamp`        | string ISO-8601 | **Todos os 10 hooks**                                                | Momento do evento                                                            | Gerado pelo VS Code                                       |
| `session_id`       | UUID string     | **9 hooks** (exceto `sessionEnd`)                                    | Identificador da sessão Copilot                                              | **Ausente em `sessionEnd`** — ler do CTX                  |
| `cwd`              | string (path)   | `sessionStart`, `preToolUse`                                         | Diretório de trabalho atual                                                  |                                                           |
| `source`           | string          | `sessionStart`                                                       | Origem da sessão (`"new"` para sessões normais)                              | Pode não ser enviado — fallback para `"new"`              |
| `tool_name`        | string          | `preToolUse`, `postToolUse`, `postToolUseFailure`                    | Nome da ferramenta invocada                                                  |                                                           |
| `tool_use_id`      | string          | `preToolUse`, `postToolUse`, `postToolUseFailure`, `subagentStop`(?) | ID único do uso da ferramenta                                                |                                                           |
| `tool_input`       | JSON object     | `preToolUse`                                                         | Parâmetros completos da ferramenta                                           | Pode conter dados sensíveis — usar `redact_credentials`   |
| `tool_response`    | string          | `postToolUse`                                                        | Resposta da ferramenta executada                                             |                                                           |
| `stop_hook_active` | boolean         | `preToolUse`, `agentStop`                                            | Se o stop hook de um preToolUse anterior está ativo                          |                                                           |
| `error`            | string          | `postToolUseFailure`                                                 | Mensagem de erro da ferramenta                                               | Aliases: `.error // .message`                             |
| `reason`           | string          | `sessionEnd`                                                         | Motivo do encerramento (`"complete"`, `"user_exit"`, `"error"`, `"timeout"`) |                                                           |
| `agentName`        | string          | `subagentStop`(?)                                                    | Nome do subagente — **schema não documentado**                               | Aliases tentados: `.agentName // .subagent_name // .name` |
| `result`           | string          | `subagentStop`(?)                                                    | Resultado do subagente — **schema não documentado**                          | Aliases tentados: `.result // .status`                    |

### 7-A.2 — Variáveis criadas exclusivamente pelo nosso sistema

> Essas variáveis são criadas por scripts nossos e **nunca** vêm do VS Code.

| Campo (no CTX ou gerado)                | Quem cria                                        | Quando                            | Observação                                                                            |
| --------------------------------------- | ------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------- |
| `session.close_key`                     | `session-start.sh`, `log-prompt.sh` RECONNECT-02 | Início de sessão / restart inline | `ENCERRAR-XXXXXXXX` — único mecanismo de encerramento autorizado                      |
| `session.vs_code_session_id`            | `session-start.sh`, `log-prompt.sh`              | Ao capturar session_id do VS Code | Cópia explícita do session_id VS Code                                                 |
| `session.source` (no CTX)               | Vários scripts                                   | Cada transição de estado          | Valores: `new`, `inline_restart`, `reconnect_rollover`, `manual_recovery`, `healed_*` |
| `session.prev_session_id`               | `log-prompt.sh` RECONNECT-02                     | Restart inline                    | ID da sessão lógica anterior                                                          |
| `session.logical_session_number`        | Schema v9 (futuro)                               | —                                 | UPG-01: ainda não implementado                                                        |
| `section_id`                            | `start-section.sh`                               | Ao abrir uma seção                | UUID gerado por `uuidgen`                                                             |
| `turn_id`                               | `start-turn.sh`                                  | Ao iniciar um turno               | UUID gerado por `uuidgen`                                                             |
| `CLOSE_KEY`                             | `session-start.sh`                               | sessionStart, inline restart      | Gerado via `/dev/urandom + xxd`                                                       |
| `session_stats.session_id_mismatches`   | `pre-tool-use.sh`, `post-tool-use.sh`            | A cada mismatch                   | Contador acumulado                                                                    |
| `session_stats.session_id_syncs_inline` | `pre-tool-use.sh`, `post-tool-use.sh`            | A cada HEAL bem-sucedido          | Contador acumulado                                                                    |
| `session_stats.compaction_count`        | `pre-compact.sh`                                 | A cada compactação preCompact     | Contador                                                                              |
| `session_stats.subagent_calls`          | `subagent-start.sh`                              | A cada subagentStart              | Contador                                                                              |

### 7-A.3 — Scripts chamados pelo VS Code (automáticos)

| Script                | Hook                  | Pode bloquear agente?       | Emite `decision:block`?         |
| --------------------- | --------------------- | --------------------------- | ------------------------------- |
| `session-start.sh`    | `sessionStart`        | Não (ignorado pelo Copilot) | Não                             |
| `log-prompt.sh`       | `userPromptSubmitted` | Não                         | Não                             |
| `pre-tool-use.sh`     | `preToolUse`          | **Sim**                     | **Sim** — via `decision: block` |
| `post-tool-use.sh`    | `postToolUse`         | Não (ignorado)              | Não                             |
| `agent-stop.sh`       | `agentStop`           | **Sim**                     | **Sim** — via `decision: block` |
| `subagent-start.sh`   | `subagentStart`       | Não                         | Não                             |
| `subagent-stop.sh`    | `subagentStop`        | Não                         | Não                             |
| `tool-use-failure.sh` | `postToolUseFailure`  | Não                         | Não                             |
| `pre-compact.sh`      | `preCompact`          | Não                         | Não                             |
| `session-end.sh`      | `sessionEnd`          | Não                         | Não                             |

### 7-A.4 — Scripts chamados pelo agente ou internamente (não pelo VS Code)

| Script                        | Chamado por                                              | Observação                                 |
| ----------------------------- | -------------------------------------------------------- | ------------------------------------------ |
| `start-turn.sh`               | Agente (manualmente)                                     | Protocolo: primeiro ato de cada turno      |
| `start-section.sh`            | Agente (manualmente)                                     | Ao mudar fase lógica                       |
| `section-end.sh`              | Agente ou `start-section.sh` (auto-close)                | Ao fechar seção                            |
| `continue-section.sh`         | Agente após git push                                     | Confirma continuação de seção              |
| `session-checkpoint.sh`       | `pre-compact.sh`, `session-end.sh`, agente               | Checkpoint periódico                       |
| `session-close.sh`            | `post-tool-use.sh` ao detectar close_key em askQuestions | **Único mecanismo legítimo de sessionEnd** |
| `session-end.sh`              | `session-close.sh` (indireto), VS Code (`sessionEnd`)    | Geração de relatório final                 |
| `session-reminder.sh`         | Agente (quando precisar lembrar protocolo)               | Leitura rápida de estado                   |
| `add-task.sh`                 | Agente                                                   | Backlog de tarefas                         |
| `complete-task.sh`            | Agente                                                   | Conclusão de tarefa                        |
| `save-finding.sh`             | Agente                                                   | Registro de bugs/gaps/melhorias            |
| `resolve-finding.sh`          | Agente                                                   | Resolução de finding                       |
| `watchdog.sh`                 | Agente / health checks                                   | Diagnóstico de saúde                       |
| `on-git-push.sh`              | Git post-push hook                                       | Evento de push registrado                  |
| `install-git-hooks.sh`        | Setup manual                                             | Instala hook git post-push                 |
| `manual-session-init.sh`      | Recuperação de desastre                                  | Sandbox apenas                             |
| `rotate-audit.sh`             | Cron / manutenção                                        | Rotação de logs                            |
| `export-metrics.sh`           | Relatórios                                               | Exportação de métricas                     |
| `generate-daily-report.sh`    | Relatórios                                               | Relatório diário                           |
| `generate-section-summary.sh` | `section-end.sh`                                         | Resumo de seção                            |
| `generate-session-summary.sh` | `session-end.sh`                                         | Resumo de sessão                           |
| `read-transcript.sh`          | Análise                                                  | Leitura de transcript VS Code              |
| `sync-tasks-to-docs.sh`       | Sincronização                                            | Tarefas → DOCUMENTAÇÃO                     |
| `sync-transcript-errors.sh`   | Sincronização                                            | Erros de transcript → CTX                  |
| `analytics.sh`                | Análise                                                  | Métricas e análise de sessão               |
| `smoke-test.sh`               | CI / testes                                              | Testes de sanidade dos hooks               |
| `reset-auth-violation.sh`     | Admin                                                    | Reset manual de violações                  |

---

## Seção 7-B — Novos Bugs, Gaps e Melhorias Identificados (2026-03-11)

### BUG-S01 — `tool-use-failure.sh`: guard de session_id vem DEPOIS da gravação

**Severidade**: MÉDIA

**Descrição**: O script `tool-use-failure.sh` escreve em `audit.jsonl` e `errors.jsonl` ANTES de
verificar o session_id guard. Se houver mismatch, a falha é registrada com o session_id incorreto
(payload), contaminando ambos os logs.

**Comportamento atual**:

```bash
# ATUAL (ORDER ERRADA):
jq -cn ... >> "$LOG_DIR/audit.jsonl"  # escreve ANTES do guard
jq -cn ... >> "$LOG_DIR/errors.jsonl" # escreve ANTES do guard
# ...
if [ "$SESSION_ID" != "$CTX_ACTIVE_SID" ]; then exit 0; fi # guard DEPOIS
```

**Fix proposto**: Mover o guard para logo após a extração de campos, antes de qualquer escrita em
logs.

---

### BUG-S02 — `subagent-start.sh`: usa `SESSION_ID` diretamente em vez de `SESSION_ID_PAYLOAD`

**Severidade**: BAIXA (inconsistência de código, não bug funcional)

**Descrição**: `subagent-start.sh` extrai o session_id do payload como `SESSION_ID` (sem
`_PAYLOAD`), enquanto todos os outros scripts usam `SESSION_ID_PAYLOAD` para o valor do VS Code e
`SESSION_ID` para o valor efetivo (lido do CTX). Isso:

1. Quebra a convenção de nomenclatura estabelecida pelos outros scripts
2. Impossibilita distinguir no código qual origem o valor tem
3. Faz o guard comparar `SESSION_ID != CTX_ACTIVE_SID` usando o payload diretamente (funciona, mas é
   opaco)

**Fix proposto**: Renomear para `SESSION_ID_PAYLOAD` e adicionar
`SESSION_ID=$(jq -r '.session.id' CTX)` separado.

---

### BUG-S03 — Todos os scripts secundários: sem HEAL v1 e sem incremento de `session_id_mismatches`

**Severidade**: ALTA

**Scripts afetados**: `subagent-start.sh`, `subagent-stop.sh`, `tool-use-failure.sh`,
`pre-compact.sh`

**Descrição**: Estes 4 scripts têm guard de session_id que faz `exit 0` silencioso em mismatch, mas:

1. **Não incrementam** `session_stats.session_id_mismatches` (GAP-03 implementado apenas em
   pre/post-tool-use.sh)
2. **Não tentam HEAL v1** quando `CTX.source = manual_recovery` ou `inline_restart`

Resultado: mismatches nesses hooks passam invisíveis. O sistema pode estar em estado de mismatch
persistente sem que os contadores reflitam isso, e o agente não recebe o contexto esperado após
subagentStart ou postToolUseFailure.

**Fix proposto**: Adicionar `source common.sh` + chamar `heal_v1` + `increment_mismatch` em todos os
4 scripts.

---

### BUG-S04 — `sessionEnd` não tem `session_id` no payload

**Severidade**: BAIXA (limitação do VS Code, não bug nosso)

**Descrição**: O hook `sessionEnd` não inclui `session_id` no payload (apenas `timestamp`, `cwd`,
`reason`). O `session-end.sh` lê o `session_id` do CTX. Se o CTX for corrompido ou deletado antes de
`sessionEnd` disparar, todos os eventos são logados com `session_id="unknown"`.

**Situação**: Esta é uma limitação da plataforma Copilot, não um bug nosso. Não temos como controlar
o payload do VS Code.

**Mitigação**: Sempre salvar checkpoint (`session-checkpoint.sh`) antes de qualquer operação de
cleanup, garantindo que CTX sobreviva até `sessionEnd`.

---

### BUG-S05 — `pre-compact.sh`: incremento de `compaction_count` sem flock (race condition)

**Severidade**: BAIXA

**Descrição**: `pre-compact.sh` usa `mktemp + mv` sem `flock` para incrementar
`session_stats.compaction_count`. Se `preCompact` e `preToolUse` dispararem simultaneamente (edge
case), há race condition na escrita do CTX. O `mv` pode sobrescrever resultado do outro script.

**Fix proposto**: Usar `sponge` (como os outros scripts) ou adicionar `flock` no bloco de
incremento.

---

### GAP-05 — Schema do payload `subagentStop` não documentado

**Severidade**: BAIXA (observabilidade)

**Descrição**: `subagent-stop.sh` usa `'.agentName // .subagent_name // .name // ""'` para tentar
ler o nome do subagente — indicando que o schema real do payload `subagentStop` não está documentado
e estamos tentando aliases. Isso:

1. Torna o código frágil a mudanças de schema no VS Code
2. Impossibilita validação definitiva do campo

**Proposta**: Verificar empiricamente qual campo o VS Code envia analisando `audit.jsonl` em sessões
reais.

---

### GAP-06 — `sessionEnd` sem `vs_code_session_id` no relatório

**Severidade**: BAIXA (observabilidade)

**Descrição**: O relatório gerado por `session-end.sh` usa `session_id` lido do CTX, mas não inclui
`vs_code_session_id` explicitamente. Após as correções de GAP-02, o CTX tem ambos os campos, mas o
relatório final não distingue.

**Proposta**: Incluir `vs_code_session_id` nos campos do relatório de sessão.

---

### MELHORIA-01 — Padronizar nomenclatura de variáveis VS Code em todos os scripts

**Prioridade**: MÉDIA

**Proposta**: Estabelecer e enforçar a convenção:

- `SESSION_ID_PAYLOAD` = valor literal recebido do VS Code (nunca modificado)
- `SESSION_ID` = valor efetivo que usamos (lido do CTX, ou SESSION_ID_PAYLOAD quando coincidem)

Aplicar a `subagent-start.sh` (usa apenas `SESSION_ID`) e revisar `post-tool-use.sh` que usa
`SESSION_ID` para o valor do payload.

---

### MELHORIA-02 — Usar `common.sh:heal_v1()` em todos os scripts (incluindo secundários)

**Prioridade**: ALTA

**Proposta**: Após BUG-S03 corrigido, refatorar os guards de todos os scripts (primários e
secundários) para:

```bash
source "$HOOK_DIR/hooks-lib/common.sh"
# ...extração de campos...
if heal_v1 "$SESSION_ID_PAYLOAD" "$TIMESTAMP"; then
  SESSION_ID="$SESSION_ID_PAYLOAD"
elif [ "$SESSION_ID_PAYLOAD" != "$CTX_ACTIVE_SID" ]; then
  increment_mismatch
  exit 0
fi
```

Isso elimina code duplication e garante que HEAL v1 seja consistente em todos os 10 hooks.

---

### MELHORIA-03 — Smoke test para cada hook com payloads reais

**Prioridade**: ALTA

**Proposta**: Criar suite de testes em `smoke-test.sh` que:

1. Para cada hook, cria um payload JSON mínimo válido
2. Chama o script correspondente via stdin
3. Verifica estado do CTX e audit.jsonl após execução

Isso detectaria BUG-S01 (guard depois de log) automaticamente.

---

### MELHORIA-04 — Inventário de scripts no `copilot-hooks.json` vs scripts existentes

**Prioridade**: BAIXA

**Observação**: O `copilot-hooks.json` registra 10 hooks. O diretório `scripts/` tem 37 scripts. 27
scripts não são chamados pelo VS Code. Existem scripts órfãos (ex: `error-occurred.sh`) que podem
ter sido criados para hooks que não existem mais. Convém auditá-los.

---

## Seção 7-C — Achados da Rodada EBH (2026-03-12, exploratory-bug-hunt)

> Rodada proativa com 10 categorias adaptadas para shell scripts. Escopo: 11 hook scripts +
> common.sh.

### EBH-M01 — `pre-tool-use.sh`: escrita não-atômica em CTX_FILE no caminho de auto-recovery ✅ CORRIGIDO

**Severidade**: MÉDIA **Status**: ✅ CORRIGIDO (2026-03-12)

**Problema**: No caminho `auto_recovery` de `pre-tool-use.sh`, `jq -cn ... > "$CTX_FILE"` escrevia
diretamente no arquivo, sem swap atômico via mktemp. O operador `>` trunca o arquivo antes de jq
escrever; se jq falhar, CTX_FILE fica com 0 bytes — piorando o estado já degradado.

**Fix aplicado**: Adicionado `_RECOVERY_CTX_TMP="$(mktemp)"` antes do `jq -cn`; saída vai para tmp;
`mv` promove atomicamente; `rm -f` limpa em caso de falha.

---

### EBH-M02 — `agent-stop.sh`: `$CTX_FILE.tmp` como nome estático de arquivo temporário ✅ CORRIGIDO

**Severidade**: MÉDIA **Status**: ✅ CORRIGIDO (2026-03-12)

**Problema**: Na linha que atualiza `consecutive_unauthorized` após bloqueio, o código usava
`> "$CTX_FILE.tmp"` como temporário. Esse nome é previsível e estático — em caso de execuções
concorrentes (subagentes), pode haver sobrescrita mútua do `.tmp`. Em falha de jq, o `.tmp` fica
orphaned no diretório de estado.

**Fix aplicado**: Substituído por `_BLOCK_CTX_TMP="$(mktemp)"` com padrão `mv || rm -f`.

---

### EBH-M03 — `session-start.sh` UPG-01: `LOGICAL_SESSION_NUMBER = 0` em edge case ✅ CORRIGIDO

**Severidade**: MÉDIA **Status**: ✅ CORRIGIDO (2026-03-12)

**Problema**: Quando `SOURCE = "inline_restart"` e CTX não existe (arquivo apagado antes da
reconexão), `_PREV_LOGICAL_NUM = 0` → `LOGICAL_SESSION_NUMBER = 0`. O briefing exibiria "Sessão
lógica: #0", que é inválido.

**Fix aplicado**: Guard adicionado no branch `inline_restart`: se `_PREV_LOGICAL_NUM` for 0 ou
inválido, `LOGICAL_SESSION_NUMBER = 1` (mínimo semântico).

---

### EBH-L01 — `subagent-start.sh` / `subagent-stop.sh`: sem fallback mktemp para CTX update

**Severidade**: BAIXA **Status**: ✅ Aplicado (2026-03-12)

**Problema**: Ambos os scripts só executam o incremento de `subagent_calls`/`subagent_completions`
se `sponge` estiver disponível. Se `sponge` não estiver instalado, o contador nunca é atualizado
silenciosamente. `sponge` é parte de `moreutils` — instalado no DevContainer (sem risco imediato),
mas frágil em outros ambientes.

**Fix aplicado**: Adicionado `else`-branch com padrão mktemp/mv em ambos os scripts. A condição
`[ -s "$CTX_FILE" ]` (tamanho > 0) também foi adicionada para consistência com as demais guards.

---

### EBH-L02 — `common.sh:ctx_update()`: injeção via `sh -c "jq '${expr}'"` (latente)

**Severidade**: BAIXA (latente — não exploitável atualmente) **Status**: 🟡 Backlog

**Problema**: A função interpola `${expr}` dentro de uma string `sh -c "jq '${expr}' ..."`. Se
`expr` contiver aspas simples, a sintaxe do shell quebraria. Atualmente, `ctx_update` só é chamada
com expressões hardcoded sem aspas simples.

**Fix proposto**: Usar `jq --args` ou escapar `${expr}` com `printf '%q'` antes de interpolar em
`sh -c`.

---

### EBH-L03 — `agent-stop.sh`: 40 chamadas `jq ... "$CTX_FILE"` (performance C9)

**Severidade**: BAIXA (performance) **Status**: 🟡 Backlog

**Problema**: `agent-stop.sh` contém 40 linhas que fazem `jq` no CTX_FILE. Cada chamada spawna um
subshell, lê o arquivo, e processa. Em sessões longas com muitos `agentStop` disparados, essa
sobrecarga é mensurável.

**Fix proposto**: Fazer uma leitura consolidada do CTX no início do script usando
`CTX_JSON="$(cat "$CTX_FILE")"` e passar as leituras via `echo "$CTX_JSON" | jq ...` ou usar
múltiplos `--arg` em uma única chamada. Escritas continuam individualmente (atômicas).

---

| ---------- | ------ |
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
| | 2026-03-11 | BUG-01 | `log-prompt.sh` RECONNECT-02 usa `SESSION_ID_PAYLOAD` em vez de UUID
aleatório | | 2026-03-11 | BUG-02 | `session-start.sh` branch `inline_restart` preserva stats,
atualiza apenas campos de identidade | | 2026-03-11 | BUG-03 | `pre-tool-use.sh` detecta
`search_subagent` equivalente a `runSubagent` | | 2026-03-11 | BUG-04 | `pre-tool-use.sh` remove
double-count de `subagent_calls` | | 2026-03-11 | BUG-05 | `post-tool-use.sh` adiciona bloco
`search_subagent` com `auth_requested=true` | | 2026-03-11 | BUG-06 | HEAL v1 estendido para cobrir
`source=inline_restart` em pre/post-tool-use.sh e agent-stop.sh | | 2026-03-11 | GAP-01 |
`log-prompt.sh` cabeçalho "PHASE 0 — SESSION_ID RECONCILIATION" documenta ponto de reconciliação | |
2026-03-11 | GAP-02 | Campo `session.vs_code_session_id` adicionado a todos os paths de atualização
do CTX | | 2026-03-11 | GAP-03 | Contadores `session_id_mismatches` e `session_id_syncs_inline` no
CTX + incrementadores nos scripts | | 2026-03-11 | GAP-04 | `hooks-lib/common.sh` expandido com
`heal_v1()`, `heal_v2()`, `increment_mismatch()` | | 2026-03-11 | BUG-07 | `subagent-start.sh`:
renomear `SESSION_ID` → `SESSION_ID_PAYLOAD`, source common.sh, HEAL v1, increment_mismatch | |
2026-03-11 | BUG-08 | `subagent-stop.sh`: source common.sh, HEAL v1, increment_mismatch no bloco de
mismatch | | 2026-03-11 | BUG-09 | `tool-use-failure.sh`: source common.sh, HEAL v1,
increment_mismatch no bloco de mismatch | | 2026-03-11 | BUG-10 | `pre-compact.sh`: source
common.sh, HEAL v1, increment_mismatch + sponge para CTX update atômico | | 2026-03-11 | BUG-11 |
`session-end.sh`: corrigir query `ERRORS_COUNT` de `"errorOccurred"` → `"toolUseFailure"` | |
2026-03-11 | BUG-12 | Assinatura errada de `heal_v1()` nos 4 scripts secundários: removidos args
extras, usando `(SID, TIMESTAMP)` | | 2026-03-11 | BUG-13 | Double-count `subagent_calls`: removido
de `subagent-stop.sh`, criado contador separado `subagent_completions` | | 2026-03-11 | BUG-14 |
`current_turn.subagent_delegated` nunca resetado entre turnos: adicionado ao reset em
`agent-stop.sh` | | 2026-03-11 | BUG-15 | `increment_mismatch` chamado com `$CTX_FILE` desnecessário
em 4 scripts: removido (função usa variável global) | | 2026-03-12 | BUG-16 | `tool-use-failure.sh`:
guard movido para ANTES dos writes — evita contaminar `audit.jsonl` com session_id errado; evento de
mismatch renomeado para `session_id_mismatch_failure` c/ campos do tool | | 2026-03-12 | BUG-17 |
HEALs inline de `manual_recovery` em `pre-tool-use.sh` e `post-tool-use.sh` agora atualizam também
`.session.vs_code_session_id` (já correto em `common.sh`/`heal_v1`) | | 2026-03-12 | GAP-05 | Schema
`session-start.sh` completado: `session_stats` recebe `subagent_completions` e
`askquestions_api_failures`; `current_turn` recebe `section_turn`, `todo_created`, `block_count`,
`agentStop_invocations` e `subagent_delegated` | | 2026-03-12 | ROB-B | Padronização do sourcing de
`common.sh` em todos os 8 scripts de hook: padrão `if [ -f ]; then ... else echo "[WARN]" >&2; fi`
ou `source ... \|\| echo "[WARN]" >&2` uniforme | | 2026-03-12 | GAP-O1 | Log
`session_id_sync_inline_restart` limitado a 5 ocorrências em `pre-tool-use.sh` e `post-tool-use.sh`;
6ª ocorrência emite evento `session_id_sync_inline_restart_cap`; contador CTX sempre incrementado |
| 2026-03-12 | ROB-C | Confirmado: padrão `jq -r ... 2>/dev/null \|\| echo 'default'` já uniforme em
todos os 11 scripts — nenhuma alteração necessária (eram 0 casos sem fallback) | | 2026-03-12 |
INC-02 | Falso alarme — `"initial"` não existe no código; `"início"` e `"retomada"` são design
intencional; PLANO atualizado | | 2026-03-12 | INC-03 | Falso alarme — 3 padrões de CTX update
(flock/sponge/mktemp) são design intencional por nível de criticidade; PLANO atualizado | |
2026-03-12 | BUG-05 | GUIA Section 3.1: adicionada tabela explícita distinguindo `source` do VS Code
(sempre `"new"`) vs `session.source` do CTX (múltiplos valores) | | 2026-03-12 | UPG-03 |
`session-start.sh`: tabela "Estado Ativo" do briefing expandida com "Origem da sessão" e
"Estatísticas" (estado de preservação), com descrições por valor de `$SOURCE` | | 2026-03-12 |
UPG-01 | `session-start.sh`: adicionados `session.logical_session_number` e
`session.logical_restart_at` ao CTX; `logical_session_number` incrementa em sessões `source=new`,
preservado em `inline_restart`; briefing exibe nova linha "Sessão lógica" | | 2026-03-12 | G9-11 |
`hooks-lib/common.sh`: função `strip_sensitive_json_keys()` adicionada — redação estrutural por
denylist de chaves JSON sensíveis (password, token, api_key, secret, close_key, etc.); integrada em
`pre-tool-use.sh` como Camada 0 antes de `redact_credentials` | | 2026-03-12 | EBH-M01 |
`pre-tool-use.sh`: escrita de recovery em CTX_FILE trocada para padrão atômico mktemp+mv; eliminado
risco de truncamento em caso de falha do `jq -cn` | | 2026-03-12 | EBH-M02 | `agent-stop.sh`:
`$CTX_FILE.tmp` substituído por `mktemp` no update de `consecutive_unauthorized`; eliminado nome
estático de temporário e possível orphan | | 2026-03-12 | EBH-M03 | `session-start.sh` (UPG-01):
guard adicionado para `LOGICAL_SESSION_NUMBER != 0` em `inline_restart` sem CTX prévio; mínimo
semântico agora é 1 | | 2026-03-12 | EBH-L01 | `subagent-start.sh` + `subagent-stop.sh`: adicionado
`else`-branch com mktemp/mv para garantir atualização do CTX mesmo sem `sponge`; guard
`[ -s "$CTX_FILE" ]` adicionada por consistência | | 2026-03-12 | GUIA v2.1 | Footer do
`GUIA-HOOKS-COPILOT.md` atualizado para v2.1 documentando BUG-05, UPG-01, UPG-03 e G9-11 | |
2026-03-12 | FIX-01 | `log-prompt.sh` RECONNECT-02: adicionado reset de
`session_stats.turns_since_askQuestions = 0` em ambos os branches (sponge e mktemp); eliminada falsa
severidade ALERTA no primeiro turno após inline_restart | | 2026-03-12 | GUIA-CORR-01 | Seção 12.2
do GUIA corrigida: afirmação "geramos um NOVO UUID" era incorreta desde BUG-01; o código usa
`SESSION_ID_PAYLOAD` (VS Code session_id) diretamente em inline_restart | | 2026-03-12 | GAP-ARCH-01
| Documentado que `prev_session_id === session.id` em RECONNECT-02 é comportamento esperado (mesma
sessão VS Code; campo aponta para UUID idêntico) | | 2026-03-12 | GAP-ARCH-02 | Documentado que
`turn_authorized`/`turn_unauthorized` são preservados em RECONNECT-02 (design intencional:
continuidade histórica), enquanto `turn_count` é resetado | | 2026-03-12 | GAP-ARCH-03 | Documentado
que RECONNECT-01 não limpa `ended_at`, podendo RECONNECT-02 disparar logo após no mesmo prompt
(GAP-ARCH-05: duplo-firing); estado final correto | | 2026-03-12 | GUIA v2.2 | Seção 19 adicionada
ao GUIA: taxonomia completa dos 6 cenários de ciclo de vida de prompt vs sessão, análise de gaps,
evidência empírica |

| 2026-03-13 | BUG-S01 | agent-stop.sh: local_turn:0 ausente na secao auto-criada "retomada" pela
invariante SESSION+SECTION+TURN | | 2026-03-13 | BUG-S02 | start-section.sh:
current_turn.section_turn nao resetado a 0 ao abrir nova secao | | 2026-03-13 | BUG-S03 |
log-prompt.sh RECONNECT-02: turn_authorized + turn_no_askQuestions nao resetados — corrigido com
snapshot prev_turn_authorized | | 2026-03-13 | GAP-S01 | Documentado: session_stats.section_count
nao resetado em RECONNECT-02 (design decision) | | 2026-03-13 | GAP-S02 | Documentado: secao
transientemente null entre section-end.sh e start-section.sh (BUG-A.3) | | 2026-03-13 | GUIA v2.3 |
Secao 20 adicionada: hierarquia SESSION/SECTION/TURN analise tecnica completa; BUG-S01/S02/S03
documentados e corrigidos |

---

## Apêndice A — Mapa de Fluxo `session_id` (após correções)

```
VS Code dispara sessionStart (nova aba)
  → session-start.sh: CTX.session.id = session_id do VS Code ✅
  → CTX.session.source = "new"

VS Code dispara userPromptSubmitted (mesmo session_id)
  → log-prompt.sh RECONNECT-01: session_id_payload == CTX.session.id → OK ✅
  → log-prompt.sh RECONNECT-02: CTX.session.ended_at == null → não dispara ✅

Nosso session-close.sh executa (authorized_close)
  → CTX.session.ended_at = now
  → CTX.session.id ainda = session_id do VS Code ✅

VS Code dispara userPromptSubmitted novamente (mesmo session_id)
  → log-prompt.sh RECONNECT-01: session_id_payload ("dcf579af") == CTX.session.id ("dcf579af") → OK
  → log-prompt.sh RECONNECT-02: CTX.session.ended_at != null → DISPARA
    → [APÓS BUG-01 CORRIGIDO] _NEW_SID = SESSION_ID_PAYLOAD = "dcf579af" ✅
    → CTX.session.id = "dcf579af" (mesmo que VS Code) ✅
    → CTX.session.source = "inline_restart"
    → CTX.session.started_at = now (nova sessão lógica)
    → CTX.session.prev_session_id = "dcf579af" (= session.id: MESMO UUID — esperado)
    → CTX.session.logical_session_number = [PRESERVADO — não incrementado; apenas session-start.sh incrementa]
    → CTX.session_stats.turn_count = 0
    → CTX.session_stats.turns_since_askQuestions = 0 [FIX-01: corrigido 2026-03-12]

Próximos preToolUse, postToolUse, agentStop:
  → session_id_payload = "dcf579af" == CTX.session.id = "dcf579af" ✅
  → NENHUM MISMATCH → state writes funcionam normalmente ✅
```

---

## Apêndice B — Tabela de Valores de `session.source` no CTX

> Distingue o `source` do VS Code (sempre `"new"`) do `session.source` que nosso código gerencia.

| Valor                                | Quem define                             | Quando                                                         | Significado                                 |
| ------------------------------------ | --------------------------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| `"new"`                              | `session-start.sh` (copiado do VS Code) | `sessionStart` dispara                                         | Nova janela/aba de chat                     |
| `"inline_restart"`                   | `log-prompt.sh` RECONNECT-02            | `ended_at != null` no prompt                                   | Nova sessão lógica na mesma janela VS Code  |
| `"reconnect_rollover"`               | `log-prompt.sh` RECONNECT-01            | `session_id_payload != CTX.session.id` (sem `manual_recovery`) | VS Code reconectou com session_id diferente |
| `"manual_recovery"`                  | Agente ou setup externo                 | CTX criado manualmente                                         | Recuperação de desastre — não recomendado   |
| `"healed_from_real_session"`         | Qualquer script HEAL v1                 | Após `manual_recovery` adotar session_id real                  | Heal concluído com sucesso                  |
| `"healed_from_consecutive_mismatch"` | `agent-stop.sh` HEAL v2                 | Após 3 mismatches consecutivos                                 | HEAL v2 ativado                             |

---

_Documento criado por investigação exaustiva conduzida em 2026-03-11._ _Scripts analisados:
`session-start.sh` (1027L), `log-prompt.sh` (431L), `pre-tool-use.sh` (443L), `post-tool-use.sh`
(342L), `agent-stop.sh` (780L)._ _GUIA analisado: `GUIA-HOOKS-COPILOT.md` v1.9 (3115L), cobertura
integral._
