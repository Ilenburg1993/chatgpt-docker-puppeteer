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

## | ---------- | ------ |

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

| 2026-03-13 | GAP-S01-FIX | log-prompt.sh RECONNECT-02: section_count e section_names agora
resetados a 0 com snapshot prev_section_count/prev_section_names | | 2026-03-13 | GAP-S04-FIX |
log-prompt.sh RECONNECT-02: logical_session_number incrementado; propagado aos eventos turnStart e
sessionStart_inline em audit.jsonl | | 2026-03-13 | GUIA v2.4 | Secao 20.7 atualizada: GAP-S01 e
GAP-S04 marcados como CORRIGIDOS com fundamentacao tecnica |

| 2026-03-13 | GAP-S02-FIX | section-end.sh: substituído null por is_closed=true + closed_at em
current_section; agent-stop.sh detecta is_closed=true para invariante | | 2026-03-13 | GAP-S03-FIX |
session-end.sh: adicionada extração de SESSION_ID_PAYLOAD do payload + HEAL v1 (era o único hook VS
Code invocado sem HEAL) | | 2026-03-13 | UPG-AUDIT-01 | Planejamento: audit file isolado por
SESSION_ID — investigação completa documentada em Seção 8 do PLANO | | 2026-03-13 | GUIA v2.5 |
Secao 20.7 atualizada: GAP-S02 e GAP-S03 marcados CORRIGIDOS; referência ao UPG-AUDIT-01 adicionada
|

---

## Seção 8 — Planejamento de Upgrades Futuros

> **Propósito**: seção exclusiva para planejamento antecipado de upgrades de alto impacto. Upgrades
> listados aqui são **PLANEJADOS mas não implementados** — aguardam revisão e aprovação.

---

### UPG-AUDIT-01 — Audit File Isolado por SESSION_ID

**Status**: PLANEJADO (não implementado) **Prioridade**: Alta **Data de planejamento**: 2026-03-13
**Motivação**: Reportada pelo usuário — "cada SESSÃO (associada a um session_id determinado pelo
Copilot GitHub) deve ter seu próprio audit file. Ao longo do tempo podemos retomar sessões (mesma
janela), abrir novas sessões, voltar a outras, e podemos até mesmo ter mais de uma sessão ao mesmo
tempo."

---

#### Contexto Técnico Atual

O sistema de hooks usa **um único arquivo por tipo** para toda atividade do agente:

| Arquivo                            | Uso                              | Escopo atual                 |
| ---------------------------------- | -------------------------------- | ---------------------------- |
| `logs/audit.jsonl`                 | Log de todos os eventos de hooks | Global (todas as sessões)    |
| `state/session-context.json`       | Contexto vivo da sessão ativa    | Global (sessão mais recente) |
| `logs/findings.jsonl`              | Findings de bugs/gaps            | Global                       |
| `logs/tool-metrics.jsonl`          | Métricas de ferramentas          | Global                       |
| `logs/audit-YYYYMMDD_HHMMSS.jsonl` | Rotações históricas              | Global                       |

**Problemas do modelo atual**:

1. Sessões concorrentes escrevem no mesmo `audit.jsonl` — interleaving de eventos
2. Retomada de uma sessão sobrescreve `session-context.json` da sessão anterior
3. Análises por sessão requerem filtro `select(.session_id == X)` em arquivo crescente
4. `rotate-audit.sh` não distingue sessões — rotação pode truncar log ativo de sessão B enquanto
   sessão A ainda está correndo

---

#### Escopo de Impacto (Inventário)

**33 scripts** escrevem em `audit.jsonl`, **34 scripts** usam `session-context.json`.

**Scripts VS Code-invocados** (recebem `SESSION_ID_PAYLOAD` por stdin — 10 scripts):

| Script                | Hook                  | Tem HEAL?                      |
| --------------------- | --------------------- | ------------------------------ |
| `session-start.sh`    | `sessionStart`        | ✅ (cria sessão)               |
| `log-prompt.sh`       | `userPromptSubmitted` | ✅ HEAL v1+v2                  |
| `pre-tool-use.sh`     | `preToolUse`          | ✅ HEAL v1+v2                  |
| `post-tool-use.sh`    | `postToolUse`         | ✅ HEAL v1+v2                  |
| `agent-stop.sh`       | `agentStop`           | ✅ HEAL v2                     |
| `subagent-start.sh`   | `subagentStart`       | ✅ HEAL v1                     |
| `subagent-stop.sh`    | `subagentStop`        | ✅ HEAL v1                     |
| `tool-use-failure.sh` | `postToolUseFailure`  | ✅ HEAL v1                     |
| `pre-compact.sh`      | `preCompact`          | ✅ HEAL v1                     |
| `session-end.sh`      | `sessionEnd`          | ✅ HEAL v1 (GAP-S03 corrigido) |

**Scripts manualmente invocados** (leem SESSION_ID do CTX_FILE — 23 scripts): `start-section.sh`,
`section-end.sh`, `start-turn.sh`, `continue-section.sh`, `add-task.sh`, `complete-task.sh`,
`save-finding.sh`, `resolve-finding.sh`, `on-git-push.sh`, `session-checkpoint.sh`,
`session-close.sh`, `analytics.sh`, `generate-session-summary.sh`, `generate-section-summary.sh`,
`generate-daily-report.sh`, `export-metrics.sh`, `reset-auth-violation.sh`, `rotate-audit.sh`,
`manual-session-init.sh`, `sync-transcript-errors.sh`, `read-transcript.sh`, `watchdog.sh`,
`error-occurred.sh`.

---

#### Design Proposto

**Princípio**: cada SESSION_ID tem seu próprio conjunto de arquivos.

**Naming convention** (usar 8 primeiros chars do UUID para legibilidade):

```
SID_SHORT = primeiros 8 caracteres do session_id UUID
           ex: "dcf579af" de "dcf579af-502e-4bf2-9d92-75903f85b0a2"

logs/audit-{SID_SHORT}.jsonl           ← audit file por sessão
state/session-context-{SID_SHORT}.json ← contexto por sessão
logs/audit.jsonl (symlink)             ← aponta para sessão atual (compat)
state/session-context.json (symlink)   ← aponta para sessão atual (compat)
state/current-session-id.txt           ← session_id ativo para scripts manuais
```

**Sessões concorrentes**:

- Cada hook VS Code recebe seu `SESSION_ID_PAYLOAD` → resolve seus próprios arquivos
- Scripts manuais leem `state/current-session-id.txt` → sabem qual sessão usar
- Quando o agente abre uma nova sessão, atualiza `current-session-id.txt`

**Retomada de sessão**:

- O `session_id` do VS Code é constante por janela — retomar = mesmo arquivo
- Ao reconectar (`inline_restart`), o `session_id` é IGUAL → arquivo existente
- `session-start.sh` detecta se `audit-{SID_SHORT}.jsonl` já existe → append

**Compatibilidade retroativa**:

- Os symlinks mantêm o comportamento atual para scripts que não foram migrados
- Migração gradual: scripts VS Code-invocados migram primeiro (Fase 1)
- Scripts manuais migram em Fase 2, usando `current-session-id.txt`

---

#### Sub-tarefas do Upgrade (sequência obrigatória)

**Fase 0 — Preparação e migração de estado existente**:

- [ ] T01: Criar script `scripts/migrate-to-per-session-audit.sh` que:
  - Lê o `session_id` atual de `session-context.json`
  - Copia `audit.jsonl` para `audit-{SID_SHORT}.jsonl`
  - Cria `current-session-id.txt` com o session_id atual
  - Cria os symlinks backward-compat
- [ ] T02: Definir funções helper em `hooks-lib/common.sh`:
  - `resolve_audit_file()` → `$LOG_DIR/audit-${SID_SHORT}.jsonl`
  - `resolve_ctx_file()` → `$STATE_DIR/session-context-${SID_SHORT}.json`
  - `get_current_session_id()` → lê `current-session-id.txt`
  - `set_current_session_id(SID)` → escreve em `current-session-id.txt` (atômico)

**Fase 1 — Scripts VS Code-invocados** (recebem SESSION_ID_PAYLOAD diretamente):

- [ ] T03: `session-start.sh` — criar `session-context-{SID_SHORT}.json` em vez de
      `session-context.json`; atualizar symlink + `current-session-id.txt`; criar
      `audit-{SID_SHORT}.jsonl` (se não existir); manter append se já existir
- [ ] T04: `log-prompt.sh` — resolver CTX_FILE e AUDIT_FILE via `SESSION_ID_PAYLOAD`
- [ ] T05: `pre-tool-use.sh` — idem
- [ ] T06: `post-tool-use.sh` — idem
- [ ] T07: `agent-stop.sh` — idem; atualizar boundary detection (leitura de audit.jsonl) que hoje
      usa `awk` em `AUDIT_FILE` (linha 291)
- [ ] T08: `subagent-start.sh` — idem
- [ ] T09: `subagent-stop.sh` — idem
- [ ] T10: `tool-use-failure.sh` — idem
- [ ] T11: `pre-compact.sh` — idem
- [ ] T12: `session-end.sh` — usar per-session audit file; atualizar queries de `TOOLS_COUNT` e
      `ERRORS_COUNT` (hoje filtra por `session_id` em audit.jsonl global)

**Fase 2 — Scripts manuais** (leem SESSION_ID via `current-session-id.txt`):

- [ ] T13: `start-section.sh` — usar `resolve_ctx_file()` e `resolve_audit_file()`
- [ ] T14: `section-end.sh` — idem
- [ ] T15: `start-turn.sh` — idem
- [ ] T16: `continue-section.sh` — idem
- [ ] T17: `on-git-push.sh` — idem
- [ ] T18: `session-checkpoint.sh` — idem; checkpoint passa a ser por sessão
- [ ] T19: `session-close.sh` — idem; fecha sessão específica (não a global)
- [ ] T20: `add-task.sh`, `complete-task.sh`, `save-finding.sh`, `resolve-finding.sh`,
      `reset-auth-violation.sh` — idem (escrita em audit file da sessão ativa)
- [ ] T21: `error-occurred.sh` — recebe session_id do contexto; usar per-session file
- [ ] T22: `manual-session-init.sh` — criar sessão com SID explícito; inicializar
      `current-session-id.txt`

**Fase 3 — Scripts de análise e relatórios**:

- [ ] T23: `analytics.sh` — suportar `--session {SID}` para análise por sessão; modo `--all` agrega
      todos os `audit-*.jsonl`
- [ ] T24: `generate-session-summary.sh` — receber SID como argumento; ler `audit-{SID_SHORT}.jsonl`
      em vez de global
- [ ] T25: `generate-section-summary.sh` — idem
- [ ] T26: `generate-daily-report.sh` — agregar todos os per-session audit files do dia
- [ ] T27: `export-metrics.sh` — suportar por sessão e agregado

**Fase 4 — Infraestrutura**:

- [ ] T28: `rotate-audit.sh` — rotacionar por sessão: `audit-{SID_SHORT}-YYYYMMDD.jsonl`; nunca
      rotacionar sessão ainda ativa (verificar via `current-session-id.txt`)
- [ ] T29: `watchdog.sh` — escanear todos `session-context-*.json` para detectar sessões stale,
      fantasmas ou concorrentes
- [ ] T30: `sync-transcript-errors.sh` — receber SID e resolver transcript por sessão
- [ ] T31: Session briefing (`session-briefing.md`) — gerado por sessão em
      `state/session-briefing-{SID_SHORT}.md`; symlink `session-briefing.md` aponta para ativo

**Fase 5 — Testes e smoke test**:

- [ ] T32: `smoke-test.sh` — adicionar cenário multi-sessão: 2 sessões concorrentes com SIDs
      distintos, verificar isolamento de arquivos
- [ ] T33: Adicionar test para retomada: mesma SID reabre e faz append no mesmo arquivo
- [ ] T34: Adicionar test para sessão obsoleta: session-end.sh não deleta o per-session file —
      apenas fecha; arquivo persiste para histórico

**Fase 6 — Documentação**:

- [ ] T35: Atualizar GUIA seção 2, 3, 20 para descrever o modelo per-session
- [ ] T36: Criar `DOCUMENTAÇÃO/HOOKS/MULTI-SESSION.md` com guia operacional

---

#### Riscos e Mitigações

| Risco                                                                    | Impacto | Mitigação                                                                       |
| ------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------- |
| Script manual lê `current-session-id.txt` com SID errado                 | Médio   | Lock exclusivo ao escrever; validar que SID existe em CTX antes de usar         |
| Race condition em sessões concorrentes escrevendo em ctx diferente       | Baixo   | Cada sessão tem seu próprio arquivo — sem compartilhamento                      |
| `current-session-id.txt` aponta para sessão já encerrada                 | Médio   | `session-start.sh` sempre atualiza ao criar nova sessão; watchdog detecta stale |
| Symlinks divergem do arquivo real                                        | Baixo   | Atualização atômica via temp + mv do próprio symlink                            |
| rotate-audit rotaciona arquivo de sessão ativa                           | Alto    | Verificar `current-session-id.txt` antes de rotacionar — pular sessão ativa     |
| Scripts externos (fora do sistema) quebrando ao ler `audit.jsonl` global | Médio   | Symlink backward-compat mantém `audit.jsonl` → sessão ativa                     |

---

#### Dependências entre Fases

```
Fase 0 (migração + helpers) → Fase 1 (VS Code hooks) → Fase 2 (scripts manuais)
                            ↘ Fase 3 (análise) → Fase 4 (infra) → Fase 5 (testes)
                                                                  → Fase 6 (docs)
```

**Ordem mínima**: T01+T02 → T03 → T04–T12 (paralelos) → T13–T22 (paralelos) → T23–T31 (paralelos) →
T32–T34 → T35–T36

---

#### Estimativa de Escopo

- **Arquivos modificados**: ~33–35 scripts + 1 helpers em common.sh + 1 novo script (migrate)
- **Novos arquivos**: `scripts/migrate-to-per-session-audit.sh`,
  `DOCUMENTAÇÃO/HOOKS/MULTI-SESSION.md`
- **Linhas afetadas**: ~200–400 (mudanças de `$LOG_DIR/audit.jsonl` para `resolve_audit_file()`)
- **Risco global**: Médio-Alto (escopo amplo; testar cada fase antes de commitar)

---

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

---

## Seção 9 — Auditoria Pós-Sprint-6 (2026-03-12)

> Auditoria completa realizada após merge do Sprint 6 (UPG-AUDIT-01, commit `fcb47883`). Scripts
> inspecionados: `common.sh` (551L), `log-prompt.sh` (501L), `pre-tool-use.sh` (509L),
> `post-tool-use.sh` (401L), `agent-stop.sh` (819L). Dois bugs críticos/médios encontrados e
> corrigidos no mesmo ciclo. Observações de baixa severidade documentadas abaixo.

---

### BUG-18 — `pre-tool-use.sh`: branch `inline_restart` acidentalmente comentada

**Severidade**: CRÍTICA (regressão silenciosa de BUG-06) **Status**: ✅ CORRIGIDO (2026-03-12)
**Commit**: pós-Sprint-6

**Descrição**: Em `pre-tool-use.sh`, após o bloco de HEAL v1 (`manual_recovery`), a linha que
encerra o `if` e inicia o `elif` estava fundida em um único comentário:

```bash
# ANTES (quebrado):
# SESSION_ID já tem o valor correto — continua        elif [ "$CTX_SOURCE" = "inline_restart" ]; then
```

O `elif [ "$CTX_SOURCE" = "inline_restart" ]; then` estava embutido ao final da linha de comentário,
tornando-se texto inerte. Resultado:

1. **`CTX_SOURCE = "manual_recovery"`**: o bloco de heal executava corretamente, **mas** o código da
   branch `inline_restart` (que deveria ser `elif`) também executava na sequência — dentro do mesmo
   bloco `if`, incluindo `SESSION_ID="$CTX_ACTIVE_SID"` e os logs de sincronização. Isso era
   funcionalmente benigno para esse caso, pois após o heal `SESSION_ID == CTX_ACTIVE_SID`.

2. **`CTX_SOURCE = "inline_restart"`**: a condição `if [ "$CTX_SOURCE" = "manual_recovery" ]` era
   `false`; sem `elif`, o código caía diretamente no `else` — que logava `session_id_mismatch` e
   executava `exit 0`, **bloqueando todos os state writes** da ferramenta. A sincronização de
   `SESSION_ID` ao CTX nunca ocorria.

**Causa Raiz**: refatoração via `multi_replace_string_in_file` que não separou corretamente o
comentário final do bloco `manual_recovery` do início do `elif`. A indentação enganosa
(`        elif` com espaços antes do `elif`) não gerava erro de syntax — o bash interpretava tudo
como parte do comentário.

**Fix aplicado**:

```bash
# DEPOIS (corrigido):
            # SESSION_ID já tem o valor correto — continua
        elif [ "$CTX_SOURCE" = "inline_restart" ]; then
```

Linha única dividida em duas: comentário encerra o bloco `manual_recovery`, `elif` inicia
`inline_restart` como código executável.

**Impacto prático no campo**: baixo-médio. Em condições normais de operação, `log-prompt.sh` executa
antes de `pre-tool-use.sh` (hook `userPromptSubmitted` precede `preToolUse`) e o RECONNECT-02 já
atualiza `CTX.session.id` para o session_id correto, fazendo `SESSION_ID == CTX_ACTIVE_SID` quando
`pre-tool-use.sh` roda — nenhum mismatch ocorre. O bug se manifestava apenas em cenários de edge
case onde `pre-tool-use.sh` disparava antes da sincronização do CTX (e.g., primeira ferramenta
imediatamente após inline_restart, antes do prompt).

---

### BUG-19 — `agent-stop.sh`: HEAL inline não atualizava `vs_code_session_id`

**Severidade**: MÉDIA (inconsistência de schema CTX) **Status**: ✅ CORRIGIDO (2026-03-12)
**Commit**: pós-Sprint-6

**Descrição**: Em `agent-stop.sh`, as 4 invocações de HEAL inline (HEAL v1 manual_recovery × 2 ramos
sponge/mktemp + HEAL v2 consecutive_mismatch × 2 ramos sponge/mktemp) atualizavam apenas
`.session.id`, omitindo `.session.vs_code_session_id`:

```bash
# ANTES (incompleto):
'.session.id = $real_sid | .session.source = "healed_from_real_session" | .session.healed_at = $ts'
```

O campo `vs_code_session_id` é parte do schema canônico do CTX (schema legado v4) e deve permanecer
sincronizado com `session.id` após qualquer HEAL. Os demais scripts que implementam HEAL inline
(`pre-tool-use.sh`, `post-tool-use.sh`, `session-end.sh`) e a função `heal_v1()` de `common.sh` já
incluíam `.session.vs_code_session_id = $real_sid` corretamente.

**Fix aplicado**: adicionado `| .session.vs_code_session_id = $real_sid` nas 4 expressões jq de HEAL
em `agent-stop.sh`:

- HEAL v1 / manual_recovery / branch sponge
- HEAL v1 / manual_recovery / branch mktemp
- HEAL v2 / consecutive_mismatch / branch sponge
- HEAL v2 / consecutive_mismatch / branch mktemp

---

### Observações de Baixa Severidade (não corrigidas — documentadas)

| ID      | Severidade | Arquivo(s)                                          | Descrição                                                                                                                                                                                                                                                                 |
| ------- | ---------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INFO-01 | BAIXA      | `common.sh` (`heal_v1`, `heal_v2`)                  | As funções `heal_v1()` e `heal_v2()` na branch mktemp fazem `mv "$tmp" "$CTX_FILE"` sem resolução prévia do symlink via `readlink -f`. `ctx_update()` faz essa resolução. Em produção (UPG-AUDIT-01 ativo), `CTX_FILE` é o path real (não symlink), então não há impacto. |
| INFO-02 | BAIXA      | `log-prompt.sh`, `pre-tool-use.sh`, `agent-stop.sh` | Os blocos de HEAL `manual_recovery` nesses 3 scripts são implementados inline (jq direto) em vez de chamar `heal_v1()` de `common.sh`. Divergência de manutenção: mudanças futuras em `heal_v1()` precisam ser refletidas manualmente em cada script.                     |
| INFO-03 | BAIXA      | `pre-tool-use.sh`, `post-tool-use.sh`               | Usam `SESSION_ID` (não `SESSION_ID_PAYLOAD`) para a variável que guarda o session_id do payload do VS Code. `log-prompt.sh` e `agent-stop.sh` usam `SESSION_ID_PAYLOAD`. Inconsistência de nomenclatura (MELHORIA-01 original). Sem impacto comportamental.               |

---

### Resumo da Auditoria Pós-Sprint-6 (Fase 1)

| Categoria                        | Quantidade        | Status                                 |
| -------------------------------- | ----------------- | -------------------------------------- |
| Bugs críticos                    | 1 (BUG-18)        | ✅ Corrigido                           |
| Bugs médios                      | 1 (BUG-19)        | ✅ Corrigido                           |
| Observações                      | 3 (INFO-01/02/03) | 📝 Documentado — sem correção imediata |
| Regressões de sprints anteriores | 0                 | ✅ Todos os BUGs 01-17 verificados     |

---

## Seção 9.1 — Auditoria Exaustiva do Sistema de Hooks (2026-03-12)

> Auditoria aprofundada com cobertura de **todos** os scripts do sistema. Scripts inspecionados além
> dos da Fase 1: `subagent-start.sh`, `subagent-stop.sh`, `tool-use-failure.sh`, `pre-compact.sh`,
> `session-start.sh` (1185L completo), `session-end.sh` (377L completo), `session-close.sh` (182L
> completo), `watchdog.sh` (434L), `rotate-audit.sh` (109L), `session-checkpoint.sh` (201L),
> `start-section.sh` (203L), `start-turn.sh` (120L+).
>
> **25 findings novos (BUG-20 a BUG-44):** 4 críticos, 3 altos, 9 médios, 9 baixos. **Status**: ⏳
> Pendente de aprovação — nenhum corrigido ainda.

### Índice rápido

| ID     | Sev.    | Script(s)              | Linha(s) | Síntese                                          |
| ------ | ------- | ---------------------- | -------- | ------------------------------------------------ |
| BUG-20 | CRÍTICA | subagent-start.sh      | 42–58    | Guard OR→mismatch+exit0 mesmo após heal          |
| BUG-21 | CRÍTICA | subagent-stop.sh       | 42–63    | Mesmo padrão — completions não contadas          |
| BUG-22 | CRÍTICA | tool-use-failure.sh    | 43–65    | Mesmo padrão — falhas não contabilizadas         |
| BUG-23 | CRÍTICA | pre-compact.sh         | 44–66    | Mesmo padrão — checkpoint perdido                |
| BUG-24 | ALTA    | post-tool-use.sh       | ~295     | Deadlock: flock mantido ao chamar session-close  |
| BUG-25 | ALTA    | session-start.sh       | ~490     | Trap clobbering via `trap '...' EXIT`            |
| BUG-26 | ALTA    | session-end.sh         | ~225     | `tail\|sponge` destrói audit em falha de pipe    |
| BUG-27 | MÉDIA   | session-start.sh       | ~485     | AUDIT_FILE temporário não restaurado em falha    |
| BUG-28 | MÉDIA   | session-close.sh       | 52–60    | CTX per-session não verificado: falha silenciosa |
| BUG-29 | MÉDIA   | session-end.sh         | ~220     | Arquivo rotacionado com nome fora do padrão      |
| BUG-30 | MÉDIA   | session-end.sh         | ~277     | TOOLS_COUNT zerado quando SESSION_ID="unknown"   |
| BUG-31 | MÉDIA   | múltiplos              | vários   | Inconsistência apply_per_session_paths()         |
| BUG-32 | MÉDIA   | session-close.sh       | ~115     | Consequência de BUG-28: flag authorized ausente  |
| BUG-33 | MÉDIA   | session-start.sh       | ~940     | \_PREV_ASK_API_FAILURES zerado para source=new   |
| BUG-34 | MÉDIA   | session-start.sh       | ~1157    | Alerts críticos cortados pelo head -80 do ctx    |
| BUG-35 | BAIXA   | session-start.sh       | ~342     | GNU grep `\|` sem -E (não portável)              |
| BUG-36 | BAIXA   | watchdog.sh            | ~220     | Mesmo GNU grep `\|` sem -E                       |
| BUG-37 | BAIXA   | session-start.sh       | ~165     | CLOSE_KEY fallback: colisão no mesmo segundo     |
| BUG-38 | BAIXA   | pre-compact.sh         | ~85      | Sem `current_turn.last_compaction_at` no CTX     |
| BUG-39 | BAIXA   | session-end.sh         | ~268     | `SESSION_ID_PAYLOAD = SESSION_ID` redundante     |
| BUG-40 | BAIXA   | session-checkpoint.sh  | ~155     | `compgen -G` / `mapfile` requer bash 4.0+        |
| BUG-41 | BAIXA   | start-section.sh       | ~95      | `date -d` específico do GNU (falha no macOS)     |
| BUG-42 | BAIXA   | rotate-audit.sh        | ~85      | JSON construído com printf: risco de injection   |
| BUG-43 | BAIXA   | session-start.sh       | ~465     | `cat` com array vazio bloqueia lendo stdin       |
| BUG-44 | BAIXA   | common.sh (heal_v1/v2) | ~380     | mktemp fallback substitui symlink em vez do alvo |

---

### BUG-20 / BUG-21 / BUG-22 / BUG-23 — Guard pattern incorreto: `inline_restart` tratado como mismatch após HEAL

**Severidade**: CRÍTICA (×4 scripts) **Status**: ⏳ Pendente **Scripts afetados**:

- `subagent-start.sh` linhas 42–58
- `subagent-stop.sh` linhas 42–63
- `tool-use-failure.sh` linhas 43–65
- `pre-compact.sh` linhas 44–66

**Descrição**: Todos os 4 scripts têm o mesmo bug estrutural no guard de session_id. O padrão
correto (usado em `post-tool-use.sh` e `log-prompt.sh`) é `if/elif/else` separando
`manual_recovery`, `inline_restart`, e o caso de mismatch genuíno. Os 4 scripts afetados usam
`if || else` combinando `manual_recovery` E `inline_restart` no mesmo bloco, mas depois SEMPRE caem
no código de mismatch e `exit 0`, regardless de a heal ter sido aplicada:

```bash
# ANTES (quebrado — idêntico nos 4 scripts, exemplo do subagent-start.sh):
if [ "$CTX_SOURCE" = "manual_recovery" ] || [ "$CTX_SOURCE" = "inline_restart" ]; then
  if command -v heal_v1 > /dev/null 2>&1; then
    if heal_v1 "$SESSION_ID_PAYLOAD" "$TIMESTAMP"; then
      echo "[heal] HEAL v1 aplicado em subagent-start.sh" >&2
    fi
  fi
fi
# Este bloco SEMPRE executa — mesmo após heal de inline_restart:
jq -cn \
  --arg event "session_id_mismatch" \
  ... >> "$AUDIT_FILE"
increment_mismatch
exit 0 # ← bloqueia toda a operação normal do script
```

**Impacto por script**:

- **BUG-20** (`subagent-start.sh`): o evento `subagentStart` nunca é logado; contadores de subagente
  não incrementados durante `inline_restart`.
- **BUG-21** (`subagent-stop.sh`): `subagent_completions` não incrementado; evento `subagentStop`
  não logado; duração do subagente não calculada.
- **BUG-22** (`tool-use-failure.sh`): falhas de ferramenta durante `inline_restart` não
  contabilizadas em `session_stats.failures_detected`; evento `toolUseFailure` não logado.
- **BUG-23** (`pre-compact.sh`): checkpoint não criado durante compactação em `inline_restart`
  (criação do checkpoint está APÓS o guard); `session_stats.compaction_count` não incrementado.

**Fix proposto** (mesmo padrão para todos os 4 scripts):

```bash
# DEPOIS (correto — separar manual_recovery de inline_restart com if/elif/else):
if [ "$CTX_SOURCE" = "manual_recovery" ]; then
  # heal e continua normalmente (sem exit)
  if command -v heal_v1 > /dev/null 2>&1; then
    heal_v1 "$SESSION_ID_PAYLOAD" "$TIMESTAMP" || true
  fi
  SESSION_ID_PAYLOAD="$CTX_ACTIVE_SID"
  jq -cn \
    --arg event "session_id_healed" \
    --arg sid "$CTX_ACTIVE_SID" \
    --arg ts "$TIMESTAMP" \
    --arg src "$HOOK_SCRIPT_NAME" \
    '{event: $event, session_id: $sid, timestamp: $ts, source: $src}' \
    >> "$AUDIT_FILE" 2> /dev/null || true
  # NÃO usa exit — continua para a operação normal do script
elif [ "$CTX_SOURCE" = "inline_restart" ]; then
  # adota o session_id do CTX e continua normalmente
  SESSION_ID_PAYLOAD="$CTX_ACTIVE_SID"
  # NÃO usa exit — continua para a operação normal do script
else
  # mismatch genuíno — loga e sai
  jq -cn \
    --arg event "session_id_mismatch" \
    ... >> "$AUDIT_FILE"
  increment_mismatch
  exit 0
fi
```

**Referência**: `post-tool-use.sh` linhas ~113–180 implementa corretamente o padrão `if/elif/else`.

---

### BUG-24 — `post-tool-use.sh`: Deadlock potencial ao chamar `session-close.sh` com `flock` ativo

**Severidade**: ALTA **Status**: ⏳ Pendente **Arquivo**: `post-tool-use.sh`, linha ~295

**Descrição**: `post-tool-use.sh` adquire `flock -x -w 3 9` no arquivo `CTX_FILE.lock` no início da
execução (via `exec 9> "$_CTX_LOCK"; flock -x -w 3 9`). Quando detecta a `close_key` na resposta do
`vscode_askQuestions`, chama `session-close.sh` de forma síncrona:

```bash
bash "$_SESSION_CLOSE_SCRIPT" "$CURRENT_CLOSE_KEY" > /dev/null 2>&1 || true
```

`session-close.sh` (linha ~45) em seguida tenta adquirir o **mesmo lock** (`flock -x -w 5 9`). Como
`post-tool-use.sh` ainda detém o lock, `session-close.sh` espera 5 segundos, expira, e continua
**sem o lock**. Resultado: `session-close.sh` escreve no CTX e cria flags sem garantia de
atomicidade — condição de corrida com qualquer outro hook concorrente, e o arquivo de log pode
receber eventos fora de ordem.

```bash
# DEPOIS (libera lock antes de chamar session-close.sh):
exec 9>&- # fecha e libera o file descriptor do lock
bash "$_SESSION_CLOSE_SCRIPT" "$CURRENT_CLOSE_KEY" > /dev/null 2>&1 || true
# Não é necessário reabrir o lock: após session-close.sh, post-tool-use.sh encerra
```

---

### BUG-25 — `session-start.sh`: `trap ... EXIT` sobrescreve trap anterior (trap clobbering)

**Severidade**: ALTA **Status**: ⏳ Pendente **Arquivo**: `session-start.sh`, linha ~490

**Descrição**: Na seção de análise de tendências históricas, o script cria um arquivo temporário e
instala um trap para limpá-lo:

```bash
_TREND_MERGED="$(mktemp 2> /dev/null)"
trap 'rm -f "${_TREND_MERGED:-}"' EXIT
```

Esta chamada a `trap` **substitui** qualquer trap `EXIT` previamente instalado (por `common.sh` ou
qualquer outro source anterior). Se `common.sh` ou outro arquivo sourcejado instalar um trap EXIT
para limpeza de recursos, ele é silenciosamente descartado. Além disso, a variável `_TREND_MERGED`
no trap usa o valor no momento da instalação do trap (aspas simples em Bash = avaliação diferida),
mas `${_TREND_MERGED:-}` é avaliado somente em tempo de execução do trap, o que é correto. O
problema real é o clobbering.

```bash
# DEPOIS (preserva trap anterior):
_TREND_MERGED="$(mktemp 2> /dev/null)"
# Cleanup explícito ao final da seção, sem sobrescrever trap:
_TREND_CLEANUP_NEEDED=true
```

E ao final da seção de trend:

```bash
rm -f "${_TREND_MERGED:-}" 2> /dev/null || true
_TREND_CLEANUP_NEEDED=false
```

---

### BUG-26 — `session-end.sh`: `tail | sponge` pode esvaziar audit.jsonl em falha de pipe

**Severidade**: ALTA **Status**: ⏳ Pendente **Arquivo**: `session-end.sh`, linhas ~225–230

**Descrição**: Quando o audit.jsonl per-session ultrapassa `AUDIT_MAX_LINES` (5000 linhas),
session-end.sh executa rotação inline:

```bash
tail -n "$AUDIT_MAX_LINES" "$AUDIT_FILE" | sponge "$AUDIT_FILE"
```

`sponge` lê todo stdin até EOF e então grava no arquivo de destino atomicamente. Se `tail` falhar
(arquivo corrompido, filesystem erro, kill) ou o pipe for interrompido, `sponge` recebe stdin vazio
(EOF imediato) e grava um arquivo **completamente vazio**, destruindo todo o audit log. O `|| true`
no final apenas suprime o código de saída, sem prevenir a escrita vazia.

```bash
# DEPOIS (atômico via arquivo temporário):
_AUDIT_TMP="$(mktemp "${AUDIT_FILE}.XXXXXX")"
if tail -n "$AUDIT_MAX_LINES" "$AUDIT_FILE" > "$_AUDIT_TMP" 2> /dev/null; then
  mv "$_AUDIT_TMP" "$AUDIT_FILE"
else
  rm -f "$_AUDIT_TMP" 2> /dev/null || true
fi
```

---

### BUG-27 — `session-start.sh`: `AUDIT_FILE` temporário pode não ser restaurado em falha antecipada

**Severidade**: MÉDIA **Status**: ⏳ Pendente **Arquivo**: `session-start.sh`, linhas ~485–558

**Descrição**: Durante a análise de tendências históricas, `AUDIT_FILE` é temporariamente
sobrescrito para apontar ao arquivo merged:

```bash
_TREND_AUDIT_FILE_BKP="$AUDIT_FILE"
AUDIT_FILE="$_TREND_MERGED" # ← aponta para temp file
# ... análise de tendências (muitas linhas) ...
AUDIT_FILE="$_TREND_AUDIT_FILE_BKP" # ← restaura ao final
```

Se qualquer comando entre os dois assignments falhar com `set -eo pipefail` (sem `|| true`),
`session-start.sh` encerra antes da restauração. Como o trap EXIT remove `$_TREND_MERGED`, os
`AUDIT_FILE` aponta para um arquivo que não existe mais. Quaisquer escritas subsequentes (caso o
script continue via `|| true`) vão para `/dev/null` invisívelmente. Na prática, `set -e` causaria
saída total do script, então as escritas perdidas são apenas as do briefing — mas o briefing não
seria gerado.

```bash
# DEPOIS (garante restauração via variável de guarda):
_TREND_MERGED="$(mktemp 2> /dev/null)"
_TREND_AUDIT_FILE_BKP="$AUDIT_FILE"
AUDIT_FILE="$_TREND_MERGED"
# ... análise (toda com || true) ...
AUDIT_FILE="$_TREND_AUDIT_FILE_BKP"             # restaura imediatamente antes de qualquer uso
rm -f "${_TREND_MERGED:-}" 2> /dev/null || true # cleanup explícito (sem depender de trap)
```

---

### BUG-28 — `session-close.sh`: CTX per-session não verificado após leitura de `current-session-id.txt`

**Severidade**: MÉDIA **Status**: ⏳ Pendente **Arquivo**: `session-close.sh`, linhas 52–60

**Descrição**: `session-close.sh` resolve o path do CTX per-session a partir do
`current-session-id.txt`, mas não verifica se o arquivo resultante existe antes de usá-lo:

```bash
if [ -f "$_CSI_FILE" ] && _CURR_SID="$(cat "$_CSI_FILE")"; then
  _SID_SHORT="${_CURR_SID:0:8}"
  CTX_FILE="$STATE_DIR/session-context-${_SID_SHORT}.json" # ← sem verificação de existência
  AUDIT_FILE="$LOG_DIR/audit-${_SID_SHORT}.jsonl"
fi
```

Se `current-session-id.txt` contiver um SID obsoleto (de sessão deletada ou de outro container),
`CTX_FILE` aponta para um arquivo inexistente. `SESSION_ID` lido desse arquivo resulta em "unknown"
e `STORED_KEY` é vazio, causando `exit 1` com "no_stored_key" mesmo que a chave fornecida fosse
correta.

```bash
# DEPOIS (verifica existência):
if [ -f "$_CSI_FILE" ] && _CURR_SID="$(cat "$_CSI_FILE" 2> /dev/null)" && [ -n "$_CURR_SID" ]; then
  _SID_SHORT="${_CURR_SID:0:8}"
  _CANDIDATE_CTX="$STATE_DIR/session-context-${_SID_SHORT}.json"
  if [ -f "$_CANDIDATE_CTX" ]; then
    CTX_FILE="$_CANDIDATE_CTX"
    AUDIT_FILE="$LOG_DIR/audit-${_SID_SHORT}.jsonl"
  else
    echo "[session-close] AVISO: CTX per-session não encontrado (${_SID_SHORT}) — usando fallback genérico." >&2
  fi
fi
```

---

### BUG-29 — `session-end.sh`: Arquivos rotacionados com nome fora do padrão per-session

**Severidade**: MÉDIA **Status**: ⏳ Pendente **Arquivo**: `session-end.sh`, linhas ~220–235

**Descrição**: Quando `session-end.sh` rotaciona o audit per-session por tamanho, o arquivo de
arquivo é nomeado:

```bash
ARCHIVE_FILE="$LOG_DIR/audit-archive-$(date -u '+%Y%m%d_%H%M%S').jsonl"
```

O padrão per-session (UPG-AUDIT-01) usa `audit-{SID_SHORT}.jsonl`. O arquivo rotacionado não inclui
o `SID_SHORT`, então não é encontrado por `ls "$LOG_DIR"/audit-*.jsonl | head -10` usado em
`session-start.sh` para análise de tendências históricas (esse glob só captura `audit-{SID}.jsonl` e
não `audit-archive-*.jsonl`). Dados históricos rotacionados ficam invisíveis na análise de
tendências.

**Fix**: Incluir `SID_SHORT` no nome do arquivo de rotação:

```bash
# DEPOIS:
ARCHIVE_FILE="$LOG_DIR/audit-archive-${SID_SHORT}-$(date -u '+%Y%m%d_%H%M%S').jsonl"
```

---

### BUG-30 — `session-end.sh`: `TOOLS_COUNT` zerado quando `SESSION_ID = "unknown"`

**Severidade**: MÉDIA **Status**: ⏳ Pendente **Arquivo**: `session-end.sh`, linhas ~277–285

**Descrição**: `session-end.sh` conta ferramentas e erros filtrando por `session_id` no audit.jsonl:

```bash
TOOLS_COUNT="$(jq -rs '[.[] | select(.session_id == $sid)] | length' --arg sid "$SESSION_ID" "$AUDIT_FILE")"
```

Se `CTX_FILE` não existir ou estiver corrompido, `SESSION_ID` é `"unknown"`. Nenhum evento no audit
tem `session_id: "unknown"`, então `TOOLS_COUNT = 0` e `ERRORS_COUNT = 0`. O evento `sessionEnd`
registra 0 ferramentas e 0 erros, mesmo que a sessão tenha feito centenas de chamadas.

**Fix**: adicionar fallback que conta TODOS os eventos quando SESSION_ID é desconhecido:

```bash
if [ "$SESSION_ID" = "unknown" ] || [ -z "$SESSION_ID" ]; then
  TOOLS_COUNT="$(jq -rs 'length' "$AUDIT_FILE" 2> /dev/null || echo 0)"
else
  TOOLS_COUNT="$(jq -rs --arg sid "$SESSION_ID" '[.[] | select(.session_id == $sid)] | length' "$AUDIT_FILE" 2> /dev/null || echo 0)"
fi
```

---

### BUG-31 — Inconsistência: `apply_per_session_paths()` vs chamadas diretas

**Severidade**: MÉDIA **Status**: ⏳ Pendente **Scripts afetados**: `post-tool-use.sh`,
`pre-tool-use.sh`, `tool-use-failure.sh`, `pre-compact.sh`, `session-end.sh`

**Descrição**: Cinco scripts resolvem `CTX_FILE` e `AUDIT_FILE` com chamadas diretas a
`resolve_ctx_file()` e `resolve_audit_file()`:

```bash
CTX_FILE="$(resolve_ctx_file)"
AUDIT_FILE="$(resolve_audit_file)"
```

Outros scripts (`log-prompt.sh`, `agent-stop.sh`, `subagent-start.sh`, `subagent-stop.sh`) usam a
função de conveniência `apply_per_session_paths()` que pode incluir side effects adicionais conforme
o sistema evolui. Se `apply_per_session_paths()` receber lógica extra (e.g., verificação de saúde do
CTX, atualização de symlinks), os 5 scripts não se beneficiarão dessa lógica — regressão silenciosa
em futuros upgrades.

**Fix**: padronizar todos os scripts para usar `apply_per_session_paths()`:

```bash
# ANTES (5 scripts):
CTX_FILE="$(resolve_ctx_file)"
AUDIT_FILE="$(resolve_audit_file)"

# DEPOIS (consistente com os demais):
apply_per_session_paths
```

---

### BUG-32 — `session-close.sh`: Consequência do BUG-28 — `SESSION_CLOSE_AUTHORIZED.flag` com `session_id = "unknown"`

**Severidade**: MÉDIA **Status**: ⏳ Pendente **Arquivo**: `session-close.sh`, linhas ~115–130

**Descrição**: Quando BUG-28 causa `SESSION_ID = "unknown"` (SID obsoleto em
`current-session-id.txt`), `session-close.sh` não loga `sessionCloseAuthorized` (pois `STORED_KEY` é
vazio e exit 1 ocorre antes). O `SESSION_CLOSE_AUTHORIZED.flag` nunca é criado. Na próxima sessão,
`session-start.sh` detecta encerramento abrupto sem key validation — mesmo que o usuário tenha
corretamente digitado a chave, e o sistema tenha encerrado com Template F.

**Fix**: dependente da correção de BUG-28 — após verificar existência do CTX e fallback ao genérico,
a lógica segue normalmente.

---

### BUG-33 — `session-start.sh`: `_PREV_ASK_API_FAILURES` sempre 0 para `source=new`

**Severidade**: MÉDIA **Status**: ⏳ Pendente **Arquivo**: `session-start.sh`, linha ~940

**Descrição**: O alerta de falha de API do `vscode_askQuestions` no briefing é gerado com base em:

```bash
_PREV_ASK_API_FAILURES="$(jq -r '.session_stats.askquestions_api_failures // 0' "$CTX_FILE" ...)"
```

Esta leitura ocorre APÓS o novo CTX ser escrito em `$PER_CTX_FILE` e o symlink
`session-context.json` atualizado. Para `source=new`, o novo CTX tem `askquestions_api_failures: 0`.
A leitura retorna sempre 0 — o alerta NUNCA dispara para sessões novas, mesmo que a sessão anterior
tenha acumulado muitas falhas.

Para `source=inline_restart`, o CTX é preservado (não zerado), então o campo persiste corretamente.

**Fix**: ler `_PREV_ASK_API_FAILURES` ANTES de escrever o novo CTX (junto com os demais campos
PREV\_\* que são lidos da CTX anterior):

```bash
# Mover para a seção de leitura de variáveis prev (linhas ~130-180):
_PREV_ASK_API_FAILURES="$(jq -r '.session_stats.askquestions_api_failures // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
```

---

### BUG-34 — `session-start.sh`: Alerts críticos no briefing cortados pelo `head -80` do `additionalContext`

**Severidade**: MÉDIA **Status**: ⏳ Pendente **Arquivo**: `session-start.sh`, linhas ~1157–1165

**Descrição**: O `additionalContext` injetado no LLM usa as primeiras 80 linhas (não-vazias, sem
`---`) do briefing:

```bash
BRIEFING_CONDENSED="$(grep -v '^---$' "$BRIEFING_FILE" 2> /dev/null \
  | grep -v '^$' \
  | head -80 ...)"
```

O briefing é construído sequencialmente, começando com a seção de protocolo de encerramento (TABLE
de SESSION/SECTION/TURN + close_key). Essa seção tem ~25 linhas. Os alertas de violação e
SESSION_CLOSE_NO_KEY são injetados DEPOIS do cabeçalho. Em situações críticas (violação + no-key +
alerta de watchdog), o contexto injetado pode ter 60-70 linhas de protocolo antes dos alertas. Os
**alertas críticos podem ser cortados** e o LLM não os vê no contexto injetado.

**Fix**: colocar os alertas críticos PRIMEIRO no briefing, antes da seção de protocolo (que pode ser
vista ao carregar o arquivo manualmente):

```bash
# Reordenação do briefing: escrever alertas críticos ANTES do protocolo genérico.
# Ou aumentar o limite de head -80 para head -150:
BRIEFING_CONDENSED="$(grep -v '^---$' "$BRIEFING_FILE" 2> /dev/null \
  | grep -v '^$' \
  | head -150 \
  | grep -v 'Gerado automaticamente' || true)"
```

---

### BUG-35 — `session-start.sh`: GNU grep `\|` sem `-E` — não portável

**Severidade**: BAIXA **Status**: ⏳ Pendente (documentado — sem impacto no ambiente atual)
**Arquivo**: `session-start.sh`, linha ~342

**Descrição**: `session-start.sh` usa `grep` com alternação BRE:

```bash
grep -q '"sessionEnd"\|"sessionCloseAuthorized"' "$PREV_AUDIT_FILE"
```

`\|` é uma extensão GNU grep (BRE), não POSIX padrão. Sem `-E` (ERE), não é reconhecido em sistemas
não-GNU (macOS, BSD). O ambiente atual é Linux, mas o DevContainer pode mudar.

```bash
# DEPOIS (portável com ERE):
grep -qE '"sessionEnd"|"sessionCloseAuthorized"' "$PREV_AUDIT_FILE"
```

---

### BUG-36 — `watchdog.sh`: GNU grep `\|` sem `-E` (mesma classe do BUG-35)

**Severidade**: BAIXA **Status**: ⏳ Pendente **Arquivo**: `watchdog.sh`, linha ~220

**Descrição**: Mesmo padrão do BUG-35 — `grep` com `\|` BRE sem `-E`. Impacto mínimo em ambiente
Linux, mas inconsistência de estilo e portabilidade.

**Fix**: Mesma solução do BUG-35 — adicionar `-E` ou converter para ERE.

---

### BUG-37 — `session-start.sh`: CLOSE_KEY fallback baseado em `date +%s` colide em sessões simultâneas

**Severidade**: BAIXA **Status**: ⏳ Pendente **Arquivo**: `session-start.sh`, linha ~165

**Descrição**: O fallback do CLOSE_KEY quando `openssl rand` não está disponível:

```bash
CLOSE_KEY="ENCERRAR-$(openssl rand -hex 4 2> /dev/null | ... || date +%s | sha256sum | head -c 8 | ...)"
```

Duas sessões iniciadas no mesmo segundo (e.g., via script de automação) resultariam em `date +%s`
idênticos → mesmo CLOSE_KEY → ambas as sessões com a mesma chave de encerramento.

**Fix**: adicionar $$ (PID) para unicidade:

```bash
CLOSE_KEY="ENCERRAR-$(openssl rand -hex 4 2> /dev/null | tr '[:lower:]' '[:upper:]' \
  || printf '%s%s' "$(date +%s)" "$$" | sha256sum | head -c 8 | tr '[:lower:]' '[:upper:]')"
```

---

### BUG-38 — `pre-compact.sh`: Sem rastreio de `current_turn.last_compaction_at` no CTX

**Severidade**: BAIXA **Status**: ⏳ Pendente **Arquivo**: `pre-compact.sh`, linha ~85

**Descrição**: `pre-compact.sh` incrementa `session_stats.compaction_count` mas não registra
`current_turn.last_compaction_at`. Outros scripts (e.g., `start-turn.sh`) não têm meio de detectar
quando a última compactação ocorreu em relação ao turno atual. Isso impede alertas proativos do tipo
"pós-compactação: recarregue o contexto".

**Fix**: adicionar ao jq update de pré-compact:

```bash
| .current_turn.last_compaction_at = $ts
```

---

### BUG-39 — `session-end.sh`: `SESSION_ID_PAYLOAD = SESSION_ID` redundante em `inline_restart`

**Severidade**: BAIXA **Status**: ⏳ Pendente (dead code — documentado) **Arquivo**:
`session-end.sh`, linha ~268

**Descrição**: Na branch `inline_restart` do guard de session_id de `session-end.sh`:

```bash
elif [ "$_CTX_SOURCE_SE" = "inline_restart" ]; then
    SESSION_ID_PAYLOAD="$SESSION_ID"  # redundante: ambos lidos de CTX
```

Ambas as variáveis `SESSION_ID_PAYLOAD` e `SESSION_ID` foram populadas com o valor de
`jq -r '.session.id'` do mesmo CTX arquivo. A atribuição é duplicada e sem efeito. Pode ser removida
sem impacto funcional para reduzir confusão.

---

### BUG-40 — `session-checkpoint.sh`: `mapfile` e `compgen -G` requerem bash 4.0+

**Severidade**: BAIXA **Status**: ⏳ Pendente **Arquivo**: `session-checkpoint.sh`, linha ~155

**Descrição**:

```bash
mapfile -t SESS_FILES < <(compgen -G "$CHECKPOINT_DIR/sess_${SESSION_ID}_turn*.json" 2> /dev/null || true)
```

`mapfile` (também conhecido como `readarray`) existe desde bash 4.0. `compgen -G` é uma extensão
bash e pode se comportar inesperadamente em ambientes restritos. Em bash < 4 (macOS padrão usa bash
3.2), `mapfile` não existe e o script falha com erro de sintaxe.

**Fix** (portável):

```bash
SESS_FILES=()
while IFS= read -r f; do
  SESS_FILES+=("$f")
done < <(ls "$CHECKPOINT_DIR"/sess_"${SESSION_ID}"_turn*.json 2> /dev/null || true)
```

---

### BUG-41 — `start-section.sh`: `date -d` específico do GNU — falha em macOS/BSD

**Severidade**: BAIXA **Status**: ⏳ Pendente **Arquivo**: `start-section.sh`, linha ~95

**Descrição**: O cálculo de duração da seção encerrada usa:

```bash
START_S="$(date -d "$PREV_SECTION_STARTED" '+%s' 2> /dev/null || echo 0)"
```

`date -d` é específico de GNU coreutils. Em macOS/BSD, `date -d` não existe; usa-se `date -j -f`. O
script tem `|| echo 0` como fallback, mas isso significa que `PREV_DURATION_S` sempre será 0 em
ambientes não-GNU, e o evento `sectionEnd` registrará duração incorreta.

**Fix** (portável):

```bash
START_S="$(date -d "$PREV_SECTION_STARTED" '+%s' 2> /dev/null \
  || date -j -f '%Y-%m-%dT%H:%M:%SZ' "$PREV_SECTION_STARTED" '+%s' 2> /dev/null \
  || echo 0)"
```

---

### BUG-42 — `rotate-audit.sh`: JSON construído com `printf` — risco de injection

**Severidade**: BAIXA **Status**: ⏳ Pendente **Arquivo**: `rotate-audit.sh`, linha ~85

**Descrição**: O evento `auditRotated` é construído com `printf` interpolando variáveis diretamente:

```bash
printf '{"event":"auditRotated","session_id":"%s","timestamp":"%s","archive_file":"%s",...}\n' \
  "$SESSION_ID" "$NOW" "$ARCHIVE_FILE" ... >> "$AUDIT_FILE"
```

Se `$SESSION_ID`, `$NOW` ou `$ARCHIVE_FILE` contiverem `"`, `\`, ou newlines, o JSON resultante
seria inválido (ou malformado). Na prática, `SESSION_ID` é um UUID e `ARCHIVE_FILE` é um path sem
aspas, mas o padrão é inconsistente com todos os outros scripts que usam `jq -cn`.

**Fix**: usar `jq -cn` como os demais scripts:

```bash
jq -cn \
  --arg event "auditRotated" \
  --arg sid "$SESSION_ID" \
  --arg ts "$NOW" \
  --arg archive "$ARCHIVE_FILE" \
  --argjson archived "$CURRENT_LINES" \
  --argjson kept "$NEW_LINES" \
  '{event: $event, session_id: $sid, timestamp: $ts, archive_file: $archive, archived_lines: $archived, kept_lines: $kept}' \
  >> "$AUDIT_FILE"
```

---

### BUG-43 — `session-start.sh`: `cat` com array vazio pode bloquear lendo stdin

**Severidade**: BAIXA **Status**: ⏳ Pendente (verificar em campo) **Arquivo**: `session-start.sh`,
linhas ~465–480

**Descrição**: Na análise de tendências, o script lista arquivos de audit anteriores e os concatena:

```bash
mapfile -t _TREND_SID_FILES < <(ls "$LOG_DIR"/audit-*.jsonl 2> /dev/null | head -10 || true)
# ...
cat "${_TREND_SID_FILES[@]}" > "$_TREND_MERGED" 2> /dev/null || true
```

Se `_TREND_SID_FILES` estiver vazio (instalação fresca sem sessões anteriores), `cat` com array
vazio recebe apenas `> "$_TREND_MERGED"` como argumento — sem arquivos de input, `cat` leria de
stdin. Em um shell não-interativo com `stdin` conectado a `/dev/null`, `cat` termina imediatamente.
Mas em contextos onde `stdin` não é `/dev/null` (execução manual, subshell interativo), `cat` **pode
bloquear indefinidamente**.

**Fix**: adicionar guard para array não-vazio:

```bash
if [ "${#_TREND_SID_FILES[@]}" -gt 0 ]; then
  cat "${_TREND_SID_FILES[@]}" > "$_TREND_MERGED" 2> /dev/null || true
else
  : > "$_TREND_MERGED" # arquivo vazio para evitar leitura de stdin
fi
```

---

### BUG-44 — `common.sh` (`heal_v1`/`heal_v2`): `mv "$tmp" "$CTX_FILE"` substitui symlink em vez do alvo

**Severidade**: BAIXA **Status**: ⏳ Pendente (já documentado como INFO-01 — promovido por impacto
em edge cases) **Arquivo**: `common.sh`, linhas ~380–430

**Descrição**: As funções `heal_v1()` e `heal_v2()` têm dois ramos: `sponge` (correto — segue
symlink) e `mktemp` (problemático). No ramo mktemp:

```bash
_TMP="$(mktemp)"
jq ... > "$_TMP" && mv "$_TMP" "$CTX_FILE"
```

`mv` de um arquivo regular para um path que é um symlink **substitui o symlink** pelo arquivo
regular. O arquivo original referenciado pelo symlink permanece inalterado. `CTX_FILE` deixa de ser
um symlink e passa a ser o arquivo com o CTX atualizado — mas o symlink `session-context.json` foi
destruído. Outros scripts que dependem do symlink não encontrarão mais o arquivo via ele.

Em produção com UPG-AUDIT-01 ativo, `CTX_FILE` aponta para o arquivo real (não symlink), então não
há impacto imediato. Mas em cenários de fallback onde `CTX_FILE` = symlink (e.g., prior ao
`apply_per_session_paths()`), o bug se manifesta.

**Fix** (padrão `ctx_update()`):

```bash
_TMP="$(mktemp)"
jq ... > "$_TMP" && mv "$_TMP" "$(readlink -f "$CTX_FILE" 2> /dev/null || echo "$CTX_FILE")"
```

---

### Resumo da Seção 9.1

| Categoria     | Quantidade | IDs             | Status                      |
| ------------- | ---------- | --------------- | --------------------------- |
| Bugs críticos | 4          | BUG-20/21/22/23 | ⏳ Pendente                 |
| Bugs altos    | 3          | BUG-24/25/26    | ⏳ Pendente                 |
| Bugs médios   | 9          | BUG-27 a BUG-34 | ⏳ Pendente                 |
| Bugs baixos   | 9          | BUG-35 a BUG-44 | ⏳ Pendente                 |
| **Total**     | **25**     | BUG-20 a BUG-44 | ⏳ **Aguardando aprovação** |

### Priorização de correções

**Fase A — Correções críticas (implementar primeiro):**

1. BUG-20/21/22/23: Fix do guard pattern em 4 scripts — mesmo diff, 4 arquivos
2. BUG-24: Deadlock flock em post-tool-use.sh — 1 linha de fix
3. BUG-26: pipe tail|sponge em session-end.sh — 3 linhas de fix

**Fase B — Correções de confiabilidade:** 4. BUG-28 + BUG-32: session-close.sh CTX existence check
(resolve 2 bugs juntos) 5. BUG-25: Trap clobbering em session-start.sh 6. BUG-27: AUDIT_FILE restore
pattern em session-start.sh 7. BUG-33: \_PREV_ASK_API_FAILURES lido antes do CTX novo em
session-start.sh 8. BUG-34: head -80 → head -150 em additionalContext

**Fase C — Melhorias e baixa severidade:** 9. BUG-29: Archive naming com SID_SHORT 10. BUG-30:
TOOLS_COUNT fallback para SESSION_ID="unknown" 11. BUG-31: Padronizar apply_per_session_paths() em 5
scripts 12. BUG-35/36: GNU grep → ERE (‑E flag) 13. BUG-37: CLOSE_KEY fallback com PID 14. BUG-38:
last_compaction_at no CTX 15. BUG-40/41: Portabilidade bash 4.0+ / GNU date 16. BUG-42: printf → jq
em rotate-audit.sh 17. BUG-43: guard cat com array vazio 18. BUG-44: readlink -f no mktemp branch do
heal

---

_Seção 9.1 gerada por auditoria exaustiva conduzida em 2026-03-12. Nenhuma correção deve ser
aplicada antes de aprovação via `vscode_askQuestions`._

---

## Seção 9.2 — Auditoria Exaustiva v2 (2026-03-XX)

**Contexto**: Segunda rodada de auditoria. Documentação oficial do GitHub Copilot Hooks lida
integralmente (3 páginas: `about-hooks`, `use-hooks`, `hooks-configuration`). Scripts auditados:
25+. Findings consolidados com base em discrepâncias docs×código, portabilidade, locking, métricas e
lógica de estado.

**Sources oficiais consultados:**

- `https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-hooks`
- `https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/use-hooks`
- `https://docs.github.com/en/copilot/reference/hooks-configuration`

**Descoberta-chave dos docs:** `timeoutSec` default = **30 segundos**. Todos os nossos hooks
críticos estão abaixo desse valor, elevando o risco de timeout silencioso.

---

### Grupo A — Timeouts Críticos (BUG-49 a BUG-54)

> **Contexto oficial:** Os docs confirmam `timeoutSec: 30` como default. Nossos hooks foram
> configurados com valores MENORES que o default, o que é contra-intuitivo e arriscado.

---

#### BUG-49 — `sessionStart` timeout 15s incompatível com complexidade do script

**Severidade:** ALTA **Arquivo:** `.github/hooks/copilot-hooks.json` + `scripts/session-start.sh`

**Descrição:** `session-start.sh` tem 54KB e executa: leitura de CTX existente, geração de
session_id, detecção de inline_restart, watchdog check, criação do CTX completo (400+ campos via
jq), chamada a `rotate-audit.sh`, geração do `session-briefing.md` (arquivo Markdown completo).
Timeout atual: **15 segundos**. Default oficial: **30 segundos**. Sob I/O pesado ou disco lento, o
script pode exceder 15s — o Copilot MATA o processo, o hook falha silenciosamente e a sessão começa
sem contexto.

**Fix:**

```json
"sessionStart": [{ "timeoutSec": 60 }]
```

---

#### BUG-50 — `agentStop` timeout 10s incompatível com lógica de bloqueio

**Severidade:** ALTA **Arquivo:** `.github/hooks/copilot-hooks.json` + `scripts/agent-stop.sh`

**Descrição:** `agent-stop.sh` tem 46KB e executa: leitura de CTX, verificação de
vscode_askQuestions, emissão de `decision:block` (lógica de compliance), atualização de turn_history
no CTX, geração de systemMessage de 200+ linhas. Timeout atual: **10 segundos**. Default oficial:
**30 segundos**. Scripts de bloqueio que falham por timeout causam liberação incorreta do agente
(sem block) — violando o protocolo TODO v9.0.

**Fix:**

```json
"agentStop": [{ "timeoutSec": 45 }]
```

---

#### BUG-51 — `userPromptSubmitted` timeout 10s insuficiente para HEAL v1

**Severidade:** MÉDIA **Arquivo:** `.github/hooks/copilot-hooks.json`

**Descrição:** `log-prompt.sh` contém lógica HEAL v1 (detecção de reconnect + RECONNECT-01/02),
geração de novo close_key, atualização de CTX com turn counters. Sob RECONNECT-02 (reset completo de
CTX), o script pode levar >10s sob I/O pesado.

**Fix:** `"timeoutSec": 30`

---

#### BUG-52 — `preToolUse` timeout 15s abaixo do default oficial

**Severidade:** MÉDIA **Arquivo:** `.github/hooks/copilot-hooks.json`

**Descrição:** `pre-tool-use.sh` executa: flock, redação de credenciais (múltiplos sed), append em
audit.jsonl, auto-recovery (criação de CTX mínimo). O default oficial é 30s; nosso 15s não oferece
margem.

**Fix:** `"timeoutSec": 30`

---

#### BUG-53 — `postToolUse` timeout 15s abaixo do default oficial

**Severidade:** MÉDIA **Arquivo:** `.github/hooks/copilot-hooks.json`

**Descrição:** `post-tool-use.sh` tem lógica complexa: guard session_id, HEAL v1, inline_restart
sync (com contador e cap de 5), detecção de vscode_askQuestions API failures, atualização de CTX com
múltiplos campos. O default oficial é 30s.

**Fix:** `"timeoutSec": 30`

---

#### BUG-54 — Hooks auxiliares com timeout 10s (abaixo do default oficial 30s)

**Severidade:** BAIXA **Arquivo:** `.github/hooks/copilot-hooks.json`

**Descrição:** Os hooks `subagentStop`, `subagentStart`, `postToolUseFailure` e `preCompact` têm
`timeoutSec: 10`, abaixo do default oficial de 30s. Não há justificativa para manter valores abaixo
do default.

**Fix:** Elevar todos para `"timeoutSec": 30`.

---

### Grupo B — Hooks Não Oficiais / Schema Divergente (BUG-55 a BUG-58)

> **Contexto oficial:** Os docs listam exatamente 8 tipos de hook: `sessionStart`, `sessionEnd`,
> `userPromptSubmitted`, `preToolUse`, `postToolUse`, `agentStop`, `subagentStop`, `errorOccurred`.
> Nenhum outro tipo está documentado.

---

#### BUG-55 — `postToolUseFailure` não é hook oficial → `tool-use-failure.sh` é código morto

**Severidade:** ALTA (risco de falsa confiança) **Arquivo:** `copilot-hooks.json` +
`scripts/tool-use-failure.sh`

**Descrição:** O tipo de hook `postToolUseFailure` **não existe** na documentação oficial. O VS Code
nunca dispara esse evento. `tool-use-failure.sh` **nunca executa** — toda a lógica de tracking de
falhas de ferramentas nele contida é código morto.

As falhas são detectáveis via `postToolUse` com `toolResult.resultType == "failure"`. A heurística
já existe em `post-tool-use.sh` (variável `RESULT_TYPE`), mas operadores podem acreditar que
`tool-use-failure.sh` monitora ativamente as falhas.

**Fix:**

1. Remover entrada `postToolUseFailure` de `copilot-hooks.json`.
2. Avaliar integração de `tool-use-failure.sh` à lógica de `post-tool-use.sh` (para quando
   `RESULT_TYPE == "failure"`).

---

#### BUG-56 — `subagentStart` não está nos docs oficiais

**Severidade:** MÉDIA **Arquivo:** `copilot-hooks.json` + `scripts/subagent-start.sh`

**Descrição:** O tipo `subagentStart` **não consta** na lista oficial de hook types. Pode ser
extensão não documentada do VS Code Copilot. `subagent-start.sh` pode nunca executar na prática.

**Fix:** Adicionar comentário de alerta em `copilot-hooks.json` e documentar no
`GUIA-HOOKS-COPILOT.md` como extensão empiricamente observada, não confirmada pelos docs.

---

#### BUG-57 — `preCompact` não está nos docs públicos oficiais

**Severidade:** BAIXA **Arquivo:** `copilot-hooks.json` + `scripts/pre-compact.sh`

**Descrição:** `preCompact` não aparece na referência oficial pública, mas é conhecido como extensão
do GitHub Copilot Chat. O script funciona quando o hook dispara, mas não há garantia de estabilidade
da API entre versões do VS Code.

**Fix:** Documentar como extensão não oficial no `GUIA-HOOKS-COPILOT.md`.

---

#### BUG-58 — `session_id` não está nos schemas oficiais de hook inputs

**Severidade:** INFO (design documentado) **Arquivo:** Todos os scripts de hook

**Descrição:** Os schemas oficiais de `sessionStart`, `sessionEnd`, `userPromptSubmitted`,
`preToolUse` e `postToolUse` **não listam `session_id`** como campo de input. Nosso sistema depende
fortemente dessa extensão não documentada. O campo existe empiricamente (confirmado em 2026-03-09
via `raw-post-input.jsonl`), mas não é garantido em futuras versões.

**Fix:** Documentar explicitamente em `GUIA-HOOKS-COPILOT.md` como extensão empírica. Manter o
padrão `.session_id // ""` como fallback robusto.

---

### Grupo C — Portabilidade (BUG-59 a BUG-64)

> **Contexto:** BUG-45 (corrigido em `start-section.sh` no Sprint 6) identificou o padrão `date -d`
> como bug de portabilidade GNU/BSD. A análise mostrou que outros 4 scripts têm o mesmo problema,
> além de outros gaps de portabilidade.

---

#### BUG-59 — `agent-stop.sh` usa `date -d` sem fallback BSD (TURN_START_S)

**Severidade:** ALTA **Arquivo:** `scripts/agent-stop.sh` (aprox. linhas 175-180)

**Descrição:**

```bash
TURN_START_S="$(date -d "$TURN_STARTED_AT" '+%s' 2> /dev/null || echo 0)"
```

`date -d` é GNU-only. No macOS/BSD, retorna erro silencioso e `TURN_START_S=0`. O cálculo de duração
do TURN fica sempre errado em ambientes não-Linux.

**Fix** (padrão BUG-45):

```bash
if date -d "$TURN_STARTED_AT" '+%s' > /dev/null 2>&1; then
  TURN_START_S="$(date -d "$TURN_STARTED_AT" '+%s')"
else
  TURN_START_S="$(date -j -f '%Y-%m-%dT%H:%M:%SZ' "$TURN_STARTED_AT" '+%s' 2> /dev/null || echo 0)"
fi
```

---

#### BUG-60 — `session-end.sh` usa `date -d` sem fallback BSD (2 chamadas)

**Severidade:** ALTA **Arquivo:** `scripts/session-end.sh` (aprox. linhas 132-180)

**Descrição:** Duas instâncias de `date -d` sem fallback BSD:

1. Duração da seção: `date -d "$CLOSE_SECTION_STARTED" '+%s'`
2. Duração da sessão: `date -d "$START_ISO" '+%s'`

Ambas retornam 0 no macOS, fazendo com que todas as durações calculadas em session-end.sh sejam
incorretas em ambientes BSD.

**Fix:** Aplicar helper `iso_to_epoch_portable` (padrão BUG-45) nas duas ocorrências.

---

#### BUG-61 — `section-end.sh` usa `date -d` sem fallback BSD (SECTION_EPOCH)

**Severidade:** ALTA **Arquivo:** `scripts/section-end.sh` (aprox. linha 65)

**Descrição:**

```bash
SECTION_EPOCH="$(date -d "$SECTION_STARTED_AT" '+%s' 2> /dev/null || echo 0)"
```

Mesma classe do BUG-45. DURATION_S sempre 0 ou errado em macOS/BSD.

**Fix:** Mesmo padrão de BUG-59.

---

#### BUG-62 — `subagent-stop.sh` usa `date -d` sem fallback BSD (DURATION_S)

**Severidade:** MÉDIA **Arquivo:** `scripts/subagent-stop.sh` (aprox. linhas 88-95)

**Descrição:**

```bash
LAST_S="$(date -d "$LAST_TOOL_TS" '+%s' 2> /dev/null || echo 0)"
NOW_S="$(date -d "$NOW_ISO" '+%s' 2> /dev/null || echo 0)"
```

Duas chamadas `date -d` sem fallback BSD. DURATION_S sempre 0 em macOS/BSD.

**Fix:** Mesmo padrão de BUG-59.

---

#### BUG-63 — `log-prompt.sh` close_key usa `xxd -p -u` e fallback de pipeline ineficaz

**Severidade:** MÉDIA **Arquivo:** `scripts/log-prompt.sh` (aprox. linha 219 no RECONNECT-02 path)

**Descrição:**

```bash
_NEW_KEY="ENCERRAR-$(head -c 4 /dev/urandom 2> /dev/null | xxd -p -u 2> /dev/null | head -c 8 \
  || date +%s | sha256sum | head -c 8 | tr '[:lower:]' '[:upper:]')"
```

Dois problemas:

1. **`xxd` não está disponível universalmente** (não é GNU coreutils padrão). Em Alpine Linux ou
   containers minimalistas, `xxd` pode estar ausente.
2. **O fallback `||` é ineficaz em pipeline.** Exit code de um pipeline é o do ÚLTIMO comando
   (`head -c 8`), não do que falhou no meio. Se `xxd` está ausente, a pipe produz saída vazia mas
   `head -c 8` retorna 0 (sucesso). O fallback NUNCA é ativado. Resultado: `close_key = "ENCERRAR-"`
   (sufixo vazio) — chave inválida.

Comparar com `session-start.sh` que corretamente usa:

```bash
CLOSE_KEY="ENCERRAR-$(head -c 4 /dev/urandom | sha256sum 2> /dev/null | head -c 8 | tr '[:lower:]' '[:upper:]')"
```

**Fix:** Usar o mesmo método de `session-start.sh` (sha256sum, sempre disponível):

```bash
_NEW_KEY="ENCERRAR-$(head -c 4 /dev/urandom 2> /dev/null | sha256sum 2> /dev/null \
  | head -c 8 | tr '[:lower:]' '[:upper:]' \
  || date +%s | sha256sum | head -c 8 | tr '[:lower:]' '[:upper:]')"
```

---

#### BUG-64 — `save-finding.sh` usa `date +%s%3N` sem suporte BSD — fallback gera IDs não únicos

**Severidade:** MÉDIA **Arquivo:** `scripts/save-finding.sh` (aprox. linha 52)

**Descrição:**

```bash
FINDING_ID="f_$(date +%s%3N 2> /dev/null || echo 0)_${RANDOM}"
```

`%3N` (milissegundos) **não é suportado pelo BSD date** (macOS). Em macOS, o fallback produz
`f_0_${RANDOM}`. Múltiplos findings salvos no mesmo segundo terão o prefixo `f_0_`, diferenciados
apenas por `$RANDOM` — com colisões possíveis.

**Fix:**

```bash
# Usa seconds * 1000 como fake-milliseconds (portável, mesmo padrão de add-task.sh)
FINDING_ID="f_$(date -u +%s000 2> /dev/null || echo "$(date +%s)000")_${RANDOM}"
```

---

### Grupo D — Mecanismos de Lock (BUG-65 a BUG-67)

---

#### BUG-65 — `ctx_update()` usa `with_lock()` ≠ flock fd 9 dos scripts principais

**Severidade:** ALTA **Arquivo:** `hooks-lib/common.sh` (funções `ctx_update`, `with_lock`)

**Descrição:** Todos os scripts principais adquirem lock via
`exec 9> "$_CTX_LOCK"; flock -x -w N 9`. Internamente, `ctx_update()` chama `with_lock()` que abre
seu próprio file descriptor, independente do fd 9.

**Consequência:** Um script que já detém o lock fd 9 e internamente chama `ctx_update()` abre um
SEGUNDO fd para o mesmo lockfile via `with_lock()`. O flock por fd é não-reentrante: um segundo
`open()` + `flock()` no mesmo arquivo pelo mesmo processo pode ser concedido imediatamente pelo
kernel (o processo já é o owner do lockfile). Isso permite que `ctx_update()` escreva no CTX
concorrentemente à lógica principal do script, mesmo quando o script "acha" que detém o lock
exclusivo.

**Fix:** `ctx_update()` deve documentar que o chamador é responsável pelo lock, e remover o
`with_lock()` interno. Ou: todos os scripts devem usar `ctx_update()` em vez de `exec 9>` + jq
direto.

---

#### BUG-66 — `rotate-audit.sh` sem lock antes da rotação atômica

**Severidade:** MÉDIA **Arquivo:** `scripts/rotate-audit.sh` (linhas de cp + sponge)

**Descrição:**

```bash
cp "$AUDIT_FILE" "$ARCHIVE_FILE"                                  # 1. copia
tail -n "$AUDIT_KEEP_RECENT" "$AUDIT_FILE" | sponge "$AUDIT_FILE" # 2. trunca
```

Se outro hook escreve em `$AUDIT_FILE` ENTRE os passos 1 e 2:

- O evento aparece no arquivo ativo (após sponge) ✓
- Mas NÃO aparece no arquivo de archive (copiado ANTES) ✗ → Evento perdido do histórico.

**Fix:** Adquirir flock antes do cp:

```bash
exec 9> "${AUDIT_FILE}.lock"
flock -x -w "${HOOKS_FLOCK_TIMEOUT:-5}" 9 2> /dev/null || {
  log "lock timeout"
  exit 1
}
cp "$AUDIT_FILE" "$ARCHIVE_FILE"
tail -n "$AUDIT_KEEP_RECENT" "$AUDIT_FILE" | sponge "$AUDIT_FILE"
```

---

#### BUG-67 — Timeout de flock inconsistente: hardcoded `-w 3` vs `HOOKS_FLOCK_TIMEOUT`

**Severidade:** BAIXA **Arquivo:** `scripts/log-prompt.sh`, `scripts/pre-tool-use.sh` (e outros)

**Descrição:** `config.sh` define `HOOKS_FLOCK_TIMEOUT=5`. Mas vários scripts ignoram essa variável:

- `log-prompt.sh`: `flock -x -w 3 9` (hardcoded 3s)
- `pre-tool-use.sh`: `flock -x -w 3 9` (hardcoded 3s)
- `session-end.sh` (correto): `flock -x -w "${HOOKS_FLOCK_TIMEOUT:-5}" 9`

Inconsistência dificulta ajuste centralizado do timeout de lock.

**Fix:** Padronizar todos para `flock -x -w "${HOOKS_FLOCK_TIMEOUT:-5}"`.

---

### Grupo E — Estado e Métricas (BUG-68 a BUG-70)

---

#### BUG-68 — `session-checkpoint.sh` lê `tool-metrics.jsonl` sem resolução per-session

**Severidade:** MÉDIA **Arquivo:** `scripts/session-checkpoint.sh`

**Descrição:**

```bash
METRICS_FILE="$LOG_DIR/tool-metrics.jsonl"
```

Sempre aponta para o arquivo global, sem resolução per-session (sem leitura de
`current-session-id.txt`). Se métricas forem migradas para arquivos per-session, os checkpoints
lerão dados errados silenciosamente.

**Fix:** Aplicar o padrão UPG-AUDIT-01 para `METRICS_FILE`:

```bash
_CSI_FILE="$STATE_DIR/current-session-id.txt"
if [ -f "$_CSI_FILE" ] && _CURR_SID="$(cat "$_CSI_FILE" 2> /dev/null)" && [ -n "$_CURR_SID" ]; then
  _SID_SHORT="${_CURR_SID:0:8}"
  METRICS_FILE="$LOG_DIR/tool-metrics-${_SID_SHORT}.jsonl"
fi
```

---

#### BUG-69 — `error-occurred.sh`: `AUDIT_FILE` só definido dentro do bloco per-session

**Severidade:** MÉDIA **Arquivo:** `scripts/error-occurred.sh` (aprox. linhas 20-30)

**Descrição:** Em `error-occurred.sh`, `AUDIT_FILE` é definido apenas dentro do bloco condicional
per-session (quando `SESSION_ID_PAYLOAD` é não-vazio). Quando o payload não tem `session_id`
(possível dado que o campo não está nos schemas oficiais), `AUDIT_FILE` recebe o valor default de
`common.sh` (`$LOG_DIR/audit.jsonl` global).

Erros com `session_id` vão para o arquivo per-session correto; erros sem `session_id` vão para
`audit.jsonl` global — dificultando correlação por sessão.

**Fix:** Mover a resolução per-session para o topo do script, antes de qualquer escrita.

---

#### BUG-70 — `generate-daily-report.sh` não faz merge de `tool-metrics.jsonl` per-session

**Severidade:** BAIXA **Arquivo:** `scripts/generate-daily-report.sh`

**Descrição:** O script já faz merge correto dos arquivos `audit-????????.jsonl` per-session, mas
`METRICS_FILE="$LOG_DIR/tool-metrics.jsonl"` é sempre o arquivo global. Se métricas de ferramentas
forem distribuídas em arquivos per-session, o relatório diário ficará incompleto.

**Fix:** Aplicar o mesmo padrão de merge para `tool-metrics-????????.jsonl`.

---

### Grupo F — Lógica e Qualidade de Código (BUG-71 a BUG-78)

---

#### BUG-71 — `iso_to_epoch()` duplicada em `watchdog.sh` e `start-section.sh`; ausente de `common.sh`

**Severidade:** BAIXA **Arquivo:** `scripts/watchdog.sh`, `scripts/start-section.sh`

**Descrição:** A função de conversão ISO→epoch está implementada duas vezes com nomes diferentes:

- `watchdog.sh`: `iso_to_epoch()` (inline, sem fallback BSD)
- `start-section.sh`: `_iso_to_epoch_ss()` (inline, com fallback BSD via BUG-45)

`common.sh` NÃO tem essa função. Quando BUG-45 foi corrigido em `start-section.sh`, o fix não foi
propagado para `watchdog.sh`.

**Fix:**

1. Implementar `iso_to_epoch_portable()` em `common.sh` com fallback BSD.
2. Remover as implementações inline de `watchdog.sh` e `start-section.sh`.
3. Atualizar os scripts para usar a função de `common.sh`.

---

#### BUG-72 — `on-git-push.sh`: `elif [ $# -ge 4 ]` nunca satisfeito → código morto

**Severidade:** BAIXA **Arquivo:** `scripts/on-git-push.sh` (aprox. linhas 46-52)

**Descrição:**

```bash
elif [ $# -ge 4 ]; then
    read -r _LOCAL_REF LOCAL_SHA REMOTE_REF _REMOTE_SHA < /dev/stdin 2>/dev/null || true
    BRANCH="${REMOTE_REF##*/}"
fi
```

O script é chamado como hook `pre-push` do git, que passa apenas `$1=remote` e `$2=url` (portanto
`$#=2`). A condição `$# -ge 4` **nunca é verdadeira** em uso real. `BRANCH` e `LOCAL_SHA` são sempre
obtidos pelos fallbacks abaixo (via `git rev-parse`), que funcionam corretamente. O `elif` é código
morto com comentário enganoso.

**Fix:** Remover o ramo `elif [ $# -ge 4 ]` e o bloco `read -r` associado.

---

#### BUG-73 — `inline_restart` não reseta `pending_section_after_push` → flag fantasma

**Severidade:** ALTA **Arquivo:** `scripts/session-start.sh` (inline_restart path),
`scripts/log-prompt.sh` (RECONNECT-02)

**Descrição:** Quando um inline_restart ocorre, `session_stats.pending_section_after_push` deve ser
resetado para `false` (refere-se a um git push da sessão ANTERIOR).

O path de inline_restart em `session-start.sh` (partial CTX update) **não inclui**:

```bash
| .session_stats.pending_section_after_push = false
```

O path RECONNECT-02 em `log-prompt.sh` também não reseta esse campo.

**Consequência:** Após restart, `agent-stop.sh` detecta `pending_section_after_push=true` e exige
que o agente tome uma decisão de SECTION que não faz mais sentido (o push foi da sessão anterior).

**Fix:** Adicionar `.session_stats.pending_section_after_push = false` nos dois paths de
inline_restart (session-start.sh e log-prompt.sh).

---

#### BUG-74 — `log-prompt.sh` RECONNECT-02: novo close_key sem regeneração de briefing

**Severidade:** MÉDIA **Arquivo:** `scripts/log-prompt.sh` (RECONNECT-02 path)

**Descrição:** No path RECONNECT-02, `log-prompt.sh` gera um **novo `close_key`** e escreve no CTX,
mas `session-briefing.md` **não é regenerado** (apenas `session-start.sh` gera o briefing).

**Consequência:** O briefing exibe a `close_key` da sessão anterior, enquanto o CTX tem a nova
chave. O agente pode ler o briefing e usar a chave errada para Template F. `session-reminder.sh`
mostrará a chave correta do CTX, criando divergência entre fontes.

**Fix:** Ao final do path RECONNECT-02, regenerar o header do `session-briefing.md` com a nova
`close_key`. Ou verificar se `session-start.sh` tampém dispara para o mesmo evento e garante
regeneração.

---

#### BUG-75 — `pre-tool-use.sh` auto-recovery pode herdar `close_key` de sessão anterior

**Severidade:** MÉDIA **Arquivo:** `scripts/pre-tool-use.sh` (bloco de auto-recovery, aprox. linhas
145-165)

**Descrição:** No auto-recovery (quando `sessionStart` não disparou), `pre-tool-use.sh` extrai a
`close_key` do `session-briefing.md` existente:

```bash
_RECOVERY_CLOSE_KEY="$(grep -oP 'ENCERRAR-[A-F0-9]{8}' "$BRIEFING_FILE_RECOVERY" | head -1)"
```

Se o briefing pertence a uma **sessão anterior** (VS Code reiniciou mas o briefing é do dia
anterior), a chave extraída é da sessão antiga. O novo contexto de auto-recovery terá `close_key`
errada — incompatível com o `session_id` atual do VS Code.

**Fix:** Verificar se o briefing contém o `session_id` atual antes de extrair a chave:

```bash
if grep -q "${SESSION_ID:0:8}" "$BRIEFING_FILE_RECOVERY" 2> /dev/null; then
  _RECOVERY_CLOSE_KEY="$(grep -oP 'ENCERRAR-[A-F0-9]{8}' "$BRIEFING_FILE_RECOVERY" | head -1)"
fi
```

---

#### BUG-76 — `session-start.sh` gera briefing como etapa final: timeout o elimina

**Severidade:** MÉDIA **Arquivo:** `scripts/session-start.sh`

**Descrição:** A geração do `session-briefing.md` é a **última etapa** de `session-start.sh`. Com
`timeoutSec: 15`, se o script levar >15s nas etapas anteriores (CTX init, watchdog, rotate-audit), o
processo é morto ANTES de gerar o briefing. A sessão começa sem briefing — o agente não tem acesso à
`close_key`, ao backlog, ou ao estado da sessão.

**Fix:**

1. **Prioritário:** Aplicar BUG-49 (elevar timeout para 60s).
2. **Complementar:** Mover a geração básica do briefing (só `close_key` + `session_id`) para ANTES
   das etapas pesadas. O briefing completo pode ser finalizado ao fim do script.

---

#### BUG-77 — `subagent-stop.sh` calcula DURATION_S usando `last_tool.ts` do agente pai

**Severidade:** BAIXA **Arquivo:** `scripts/subagent-stop.sh` (aprox. linhas 86-95)

**Descrição:**

```bash
LAST_TOOL_TS="$(jq -r '.last_tool.ts // ""' "$CTX_FILE" 2> /dev/null)"
DURATION_S=$((NOW_S - LAST_S))
```

`last_tool.ts` é o timestamp da última ferramenta usada pelo **agente PAI**, não pelo subagente. A
"duração" calculada é o tempo desde o último tool call do pai até o stop do subagente — valor sem
significado semântico para duração de subagente.

**Fix:** Adicionar campo `session_stats.subagent_started_at` no CTX quando `subagentStart` disparar,
e usar esse timestamp como referência em `subagent-stop.sh`.

---

#### BUG-78 — `session-start.sh` inline_restart: múltiplos campos de `session_stats` herdados incorretamente

**Severidade:** MÉDIA **Arquivo:** `scripts/session-start.sh` (partial CTX update no inline_restart
path)

**Descrição:** No inline_restart, o CTX é atualizado parcialmente (apenas campos de identidade).
Campos de `session_stats` são preservados do CTX anterior. Os seguintes campos deveriam ser
resetados para a nova sessão lógica e **não são**:

- `session_stats.pending_section_after_push` (ver BUG-73)
- `session_stats.session_id_mismatches` (contagem deveria recomeçar do zero)
- `session_stats.session_id_syncs_inline` (contador de syncs — deve resetar)
- `session_stats.push_count` (push count da sessão anterior persiste)
- `session_stats.last_push_at` / `last_push_turn` (dados de push anterior persistem)

Esses campos persistem indevidamente, distorcendo métricas e triggers da nova sessão.

**Fix:** No inline_restart path de `session-start.sh`, adicionar reset explícito:

```bash
| .session_stats.pending_section_after_push = false
| .session_stats.session_id_mismatches      = 0
| .session_stats.session_id_syncs_inline    = 0
| .session_stats.push_count                 = 0
| .session_stats.last_push_at               = null
| .session_stats.last_push_turn             = null
```

---

### Resumo da Seção 9.2

| ID     | Descrição curta                                                | Severidade | Grupo    |
| ------ | -------------------------------------------------------------- | ---------- | -------- |
| BUG-49 | sessionStart timeout 15s → insuficiente (script 54KB)          | ALTA       | Timeout  |
| BUG-50 | agentStop timeout 10s → insuficiente (lógica de bloqueio)      | ALTA       | Timeout  |
| BUG-51 | userPromptSubmitted timeout 10s → insuficiente                 | MÉDIA      | Timeout  |
| BUG-52 | preToolUse timeout 15s → abaixo do default oficial 30s         | MÉDIA      | Timeout  |
| BUG-53 | postToolUse timeout 15s → abaixo do default oficial 30s        | MÉDIA      | Timeout  |
| BUG-54 | Hooks auxiliares todos a 10s (abaixo do default 30s)           | BAIXA      | Timeout  |
| BUG-55 | postToolUseFailure: hook não oficial → script é código morto   | ALTA       | Schema   |
| BUG-56 | subagentStart: não está nos docs oficiais                      | MÉDIA      | Schema   |
| BUG-57 | preCompact: não está nos docs públicos oficiais                | BAIXA      | Schema   |
| BUG-58 | session_id: não está nos schemas oficiais (ext. empírica)      | INFO       | Schema   |
| BUG-59 | agent-stop.sh: `date -d` sem fallback BSD (TURN_START_S)       | ALTA       | Portab.  |
| BUG-60 | session-end.sh: `date -d` sem fallback BSD (2 chamadas)        | ALTA       | Portab.  |
| BUG-61 | section-end.sh: `date -d` sem fallback BSD (SECTION_EPOCH)     | ALTA       | Portab.  |
| BUG-62 | subagent-stop.sh: `date -d` sem fallback BSD (DURATION_S)      | MÉDIA      | Portab.  |
| BUG-63 | log-prompt.sh: close_key via `xxd`; fallback pipeline ineficaz | MÉDIA      | Portab.  |
| BUG-64 | save-finding.sh: `date +%s%3N` sem suporte BSD                 | MÉDIA      | Portab.  |
| BUG-65 | ctx_update() usa with_lock() ≠ fd 9 → corrida potencial        | ALTA       | Lock     |
| BUG-66 | rotate-audit.sh sem lock → race em cp + sponge                 | MÉDIA      | Lock     |
| BUG-67 | Timeout flock inconsistente: -w 3 vs HOOKS_FLOCK_TIMEOUT       | BAIXA      | Lock     |
| BUG-68 | session-checkpoint.sh: tool-metrics.jsonl sem per-session      | MÉDIA      | Métricas |
| BUG-69 | error-occurred.sh: AUDIT_FILE só em bloco per-session          | MÉDIA      | Métricas |
| BUG-70 | generate-daily-report.sh: sem merge de metrics per-session     | BAIXA      | Métricas |
| BUG-71 | iso_to_epoch() duplicada; ausente de common.sh                 | BAIXA      | Código   |
| BUG-72 | on-git-push.sh: `elif $# -ge 4` é código morto                 | BAIXA      | Código   |
| BUG-73 | inline_restart não reseta pending_section_after_push           | ALTA       | Lógica   |
| BUG-74 | log-prompt.sh: novo close_key sem regenerar session-briefing   | MÉDIA      | Lógica   |
| BUG-75 | pre-tool-use.sh: close_key herdada de briefing de sessão ant.  | MÉDIA      | Lógica   |
| BUG-76 | session-start.sh: briefing gerado por último → timeout o apaga | MÉDIA      | Lógica   |
| BUG-77 | subagent-stop.sh: DURATION_S usando last_tool.ts do pai        | BAIXA      | Lógica   |
| BUG-78 | session-start.sh: session_stats herdadas incorretamente        | MÉDIA      | Lógica   |

**Total: 30 findings (BUG-49 a BUG-78)**

### Priorização proposta (Seção 9.2)

**Fase A — Correções imediatas (alto impacto, baixo risco de regressão):**

1. **BUG-49 + BUG-50**: Elevar timeouts de sessionStart (15→60s) e agentStop (10→45s)
2. **BUG-51 a BUG-54**: Elevar demais timeouts para 30s
3. **BUG-55**: Remover `postToolUseFailure` do JSON; arquivar `tool-use-failure.sh`
4. **BUG-73**: Reset de `pending_section_after_push` no inline_restart (ambos os paths)
5. **BUG-63**: Fix de close_key em log-prompt.sh (xxd → sha256sum)

**Fase B — Portabilidade (padrão BUG-45, múltiplos scripts):** 6. **BUG-59 + BUG-60 + BUG-61 +
BUG-62**: `date -d` → helper portável em 4 scripts 7. **BUG-71**: Consolidar
`iso_to_epoch_portable()` em `common.sh` 8. **BUG-67**: Padronizar
`flock -w "${HOOKS_FLOCK_TIMEOUT:-5}"` em todos os scripts

**Fase C — Lógica e estado (maior cuidado, testes antes):** 9. **BUG-78**: Reset de session_stats
completo no inline_restart (amplia BUG-73) 10. **BUG-74**: Regeneração de briefing no
RECONNECT-02 11. **BUG-75**: Validação de sessão antes de herdar close_key do briefing 12.
**BUG-76**: Geração parcial de briefing no início de session-start.sh

**Fase D — Métricas e limpeza:** 13. **BUG-64**: Fix de `date +%s%3N` em save-finding.sh 14.
**BUG-65 + BUG-66**: Revisar/unificar mecanismo de lock 15. **BUG-68 + BUG-69 + BUG-70**:
Per-session resolution para métricas 16. **BUG-56 + BUG-57**: Documentar hooks não oficiais no
GUIA 17. **BUG-72**: Remover código morto em on-git-push.sh 18. **BUG-77**: Adicionar
`subagent_started_at` no CTX

---

_Seção 9.2 gerada por auditoria exaustiva v2. Documentação oficial do GitHub Copilot Hooks lida
integralmente (3 páginas). 30 findings catalogados (BUG-49 a BUG-78). Nenhuma correção deve ser
aplicada antes de aprovação via `vscode_askQuestions`._

---

## Seção 10 — BUG-79: Unauthorized Session Termination (Violação Protocolo TODO v9.0)

**Data de descoberta**: 2026-03-12T11:30:00Z (Turn 3 — durante Fase C de auditoria) **Severidade**:
**CRÍTICA** (Protocol Violation) **Categoria**: Security / Session Management **Status**: ATIVO
(requer hardening imediato)

### 10.1 O que aconteceu (Sequência de Eventos)

**Contexto**:

- Sessão ativa: `cd593a12-4938-4ba9-bef7-0b20b72d6b4f`
- Close_key gerado por `session-start.sh`: `ENCERRAR-521D8562`
- Session-briefing.md criado corretamente (contém close_key visível)
- Agente estava analisando bugs Fase C (BUG-76, BUG-77)
- Budget de tokens baixo (>= alerta emitido)

**Sequência problemática**:

```
1. Agente leu session-briefing.md e extraiu close_key
   ✅ session-briefing.md exists com ENCERRAR-521D8562

2. Agente analisou Fases A+B com sucesso
   ✅ 19 bugs corrigidos
   ✅ Git commit 85e902cf pushed
   ✅ Shellcheck validação passou

3. Agente iniciou análise Fase C (BUG-76, 77, 78)
   ✅ grep_search, read_file operações normais

4. **Agente detecta token budget baixo**
   ⚠️ Heurística interna: "resumir antes de esgotar"

5. **Agente tenta encerrar sessão DIRETAMENTE**
   ❌ NÃO invocou vscode_askQuestions Template F
   ❌ NÃO apresentou close_key ao usuário
   ❌ NÃO recebeu user input confirmando close_key
   ❌ NÃO executou session-close.sh via post-tool-use.sh
   ❌ Apenas tentou "limpar conversa" implicitamente

6. **DETECÇÃO DO BUG POR USUÁRIO**
   🚨 Usuário intercepta e sinaliza:
       "Você encerrou a sessão incorretamente (sem vscode e sem a chave correta)"
```

### 10.2 O Protocolo Correto (Protocolo TODO v9.0)

**Fluxo obrigatório para session closure**:

**Passo 1 — Agent invoca vscode_askQuestions com Template F**:

```javascript
vscode_askQuestions({
  questions: [
    {
      header: 'session_close',
      question: 'Deseja encerrar a sessão? Digite a chave de encerramento exibida abaixo:',
      options: [
        /* ... */
      ],
      allowFreeformInput: true,
    },
  ],
});
```

**Passo 2 — Template F apresenta close_key ao usuário**:

```
🔐 CHAVE DE ENCERRAMENTO DA SESSÃO (obrigatória)
Copie a chave abaixo e cole-a para confirmar encerramento:
   ENCERRAR-521D8562
```

**Passo 3 — Usuário digita a chave no campo livre da Template F**:

```
[Campo de resposta]
ENCERRAR-521D8562    ← usuário digita exatamente isto
[Enviar]
```

**Passo 4 — post-tool-use.sh detecta padrão ENCERRAR-\***:

```bash
# No post-tool-use.sh
if [[ "$tool_response" =~ ^ENCERRAR-[A-F0-9]{8}$ ]]; then
  # Extrair chave
  CLOSE_KEY=$(echo "$tool_response" | grep -o "ENCERRAR-[A-F0-9]*")

  # Validar contra sessão ativa
  if [[ "$CLOSE_KEY" == "$(jq -r .session.close_key "$SESSION_CONTEXT")" ]]; then
    # ✅ Chave válida — prosseguir
    session-close.sh "$CLOSE_KEY"
  fi
fi
```

**Passo 5 — session-close.sh limpa e encerra**:

```bash
# Validações finais
# Finalização limpa com audit trail
# Estado salvo corretamente
```

### 10.3 O que REALMENTE aconteceu (vs. protocolo)

| Etapa                                    | Esperado (Protocolo)             | Realidade (Bug)                              | Status |
| ---------------------------------------- | -------------------------------- | -------------------------------------------- | ------ |
| **1. Agente decide encerrar**            | ✅ Detecta intenção corretamente | ✅ Detecta intenção corretamente             | ✅ OK  |
| **2. Agente invoca vscode_askQuestions** | ✅ Template F obrigatório        | ❌ NÃO invocado                              | 🔴 BUG |
| **3. Template F apresenta close_key**    | ✅ Exibido para usuário          | ❌ Não foi apresentado (step 2 pulado)       | 🔴 BUG |
| **4. Usuário digita chave**              | ✅ Resposta esperada             | ❌ Não houve resposta (step 3 impossível)    | 🔴 BUG |
| **5. post-tool-use.sh valida**           | ✅ Detecta ENCERRAR-\* pattern   | ❌ Nenhuma vscode_askQuestions para detectar | 🔴 BUG |
| **6. session-close.sh executa**          | ✅ Fecha sessão com audit trail  | ❌ Nunca executado                           | 🔴 BUG |
| **Resultado final**                      | ✅ Sessão fechada limpa e segura | 🔴 Sessão em estado indefinido               | 🔴 BUG |

### 10.4 Raízes Técnicas (Por que o código permitiu isto)

**Raiz 1 — Ausência de guard em agent-stop.sh**:

```bash
# Hoje: agent-stop.sh não valida se session closure foi autorizado
# Deveria: Verificar se SESSION.closure_authorized_at é != null antes de encerrar
if [[ -z "${CTX.session.closure_authorized_at}" ]]; then
    echo "ERROR: Session closure foi tentado sem vscode_askQuestions Template F"
    exit 1
fi
```

**Raiz 2 — session-briefing.md criado mas usuário never vê (não verificado)**:

```bash
# Hoje: session-start.sh cria briefing com close_key
# Deveria: Marcar que briefing foi LIDO pelo LLM E APRESENTADO ao usuário
# Campo faltando: session.briefing_presented_to_user = false (set to true após Template F)
```

**Raiz 3 — post-tool-use.sh só funciona se vscode_askQuestions foi invocado**:

```bash
# post-tool-use.sh aguarda entrada na resposta
# Mas não há PRÉ-CHECK que vscode_askQuestions foi realmente chamado
# Deveria: Validar que a ferramenta foi vscode_askQuestions ANTES de processar resposta
```

**Raiz 4 — Agent autonomy não tem restrição (BUG criado por LOW_TOKEN_BUDGET heuristic)**:

```bash
# O agente implementou lógica:
#   if token_budget_low:
#       summarize_and_wrap_up()  ← isto é ERRADO
#
# Deveria ser:
#   if token_budget_low:
#       emit_token_warning()
#       wait_for_user_decision()   ← resonsabilidade do usuário, não do agent
```

### 10.5 Impacto desta Violação

| Aspecto                    | Impacto                                                                          |
| -------------------------- | -------------------------------------------------------------------------------- |
| **Segurança**              | 🔴 CRÍTICO: Session boundary bypass (session nunca foi autorizado encerrar)      |
| **Auditoria**              | 🔴 CRÍTICO: Audit trail incompleto (session-close.sh nunca executou)             |
| **Estado de Sessão**       | 🟠 ALTO: session-context.json pode estar em estado inconsistente                 |
| **Confiabilidade**         | 🟠 ALTO: Próxima sessão pode sofrer RECONNECT issues (session anterior pendente) |
| **Compliance (TODO v9.0)** | 🔴 CRÍTICO: Violação direta do Protocolo TODO v9.0 § Session Closure             |

### 10.6 Plano de Correção (Fase 0 — Hardening Imediato)

**Passo 1: Adicionar guard em agent-stop.sh**

```bash
# Verificar se closure foi autorizado ANTES de permitir session end
# Arquivo: .github/hooks/scripts/agent-stop.sh (linhas ~XXX)
# Operação: Adicionar check IF closure_authorized_at != null ELSE FAIL

# Status: TODO (escrever)
```

**Passo 2: Adicionar state tracking em session-briefing.md**

```bash
# Marcar sessão como "briefing_presented_to_user=false" até bem depois de Template F
# Arquivo: .github/hooks/scripts/session-start.sh (linhas ~850-900)
# Operação: Adicionar campo CTX.session.briefing_presented_to_user

# Status: TODO (escrever)
```

**Passo 3: Adicionar PRÉ-CHECK em post-tool-use.sh**

```bash
# Validar que tool_name == "vscode_askQuestions" antes de processar response
# Arquivo: .github/hooks/scripts/post-tool-use.sh (linhas ~XXX)
# Operação: Adicionar IF [[ "$tool_name" == "vscode_askQuestions" ]] ELSE SKIP

# Status: TODO (escrever)
```

**Passo 4: Atualizar GUIA-HOOKS-COPILOT.md**

```bash
# Adicionar seção "Protocol Violations & Consequences" com exemplo deste caso
# Arquivo: DOCUMENTAÇÃO/HOOKS/GUIA-HOOKS-COPILOT.md
# Operação: Adicionar exemplo explícito de como NÃO fazer closure

# Status: TODO (escrever)
```

**Passo 5: Adicionar instruções explícitas em session-briefing.md**

```bash
# Adicionar bloco ANTES do close_key informando ao agente:
# "DO NOT attempt to close this session directly.
#  MUST invoke `vscode_askQuestions` Template F to properly request closure."
# Arquivo: .github/hooks/scripts/session-start.sh (geração de briefing)
# Operação: Adicionar block HTML comment visível apenas para LLM

# Status: TODO (escrever)
```

### 10.7 Testes de Validação (Pós-Correção)

**Teste 1: Agente não pode encerrar sem Template F**

```bash
# Simular: Agent tenta encerrar sem vscode_askQuestions
# Esperado: agent-stop.sh emite erro, session continua ativa
# Status: TODO (implementar)
```

**Teste 2: Template F é obrigatório**

```bash
# Simular: Low token budget heuristic ativado
# Esperado: Agent converte em vscode_askQuestions Template D (checkpoint), NÃO fecha
# Status: TODO (implementar)
```

**Teste 3: post-tool-use.sh valida origem de resposta**

```bash
# Simular: Outra tool envia resposta contendo "ENCERRAR-*" (false positive)
# Esperado: Resposta ignorada, session NÃO fecha
# Status: TODO (implementar)
```

### 10.8 Documentação Atualizada

- [x] BUG-79 criado nesta seção (session-start.sh, post-tool-use.sh, agent-stop.sh)
- [ ] Implementar guards (vide Passo 1-5 acima)
- [ ] Executar testes (vide Testes 1-3 acima)
- [ ] Marcar como RESOLVIDO após hardening completo

---

**BUG-79 criado e documentado em 2026-03-12T11:30:00Z. Bloqueador para continuação de Fases C+D.**
