# Plano de Reimplementacao do Sistema de Hooks -- Do Zero

**Versao**: 2.2 | **Data**: 2026-03-17 | **Status**: Em elaboracao

> Este documento e a fonte canonica do plano de reimplementacao do sistema de hooks.
> Sera atualizado continuamente conforme o trabalho avanca.

---

## Motivacao

A implementacao anterior tornou-se extremamente complexa -- dezenas de scripts, sistema de libs,
contratos dificeis de manter, estado distribuido. O objetivo desta reimplementacao e partir do zero
com uma abordagem **minimalista e correta**, baseada estritamente nos contratos oficiais do VS Code.

---

## Fontes de verdade utilizadas

| Fonte                            | URL / Caminho                                                  | Data             |
| -------------------------------- | -------------------------------------------------------------- | ---------------- |
| Documentacao oficial VS Code     | https://code.visualstudio.com/docs/copilot/customization/hooks | 3/9/2026         |
| Guia empirico deste repositorio  | `DOCUMENTACAO/HOOKS/GUIA-HOOKS-COPILOT.md`                     | v2.5, 2026-03-13 |
| Backup da implementacao anterior | `.github/hooks.old/`                                           | --               |

---

## Indice de navegacao (Partes e subpartes)

- **[Parte 1 — Base tecnica da plataforma](#parte-1)**
  - 1.1 Eventos suportados
  - 1.2 Input comum
  - 1.3 Exit codes e output comum
  - 1.4 Formato de configuracao (`hooks.json`)
- **[Parte 2 — Semantica de disparo dos eventos](#parte-2)**
  - 2.1 SessionStart
  - 2.2 UserPromptSubmit
  - 2.3 PreToolUse
  - 2.4 PostToolUse
  - 2.5 Stop
  - 2.6 SubagentStart/SubagentStop
  - 2.7 PreCompact
  - 2.8 SessionEnd (instavel)
- **[Parte 2B — Hierarquia operacional (SESSION/TURN/SUBTURN)](#parte-2b)**
  - 2B.1 Visao geral
  - 2B.2 SESSION
  - 2B.3 SECTION (fora de escopo)
  - 2B.4 TURN
  - 2B.5 SUBTURN
  - 2B.6 Invariante
  - 2B.7 Encerramento abrupto
- **[Parte 3 — Diferencas entre legado e oficial](#parte-3)**
- **[Parte 4 — Estrutura proposta do sistema](#parte-4)**
  - 4.0 Principio script↔lib
  - 4.1 Mapa de arquivos
  - 4.2 Arvore de diretorios
  - 4.3 `lib/common.sh`
  - 4.4 `hooks.json` (configuracao completa)
- **[Parte 5 — Estado minimo e artefatos de sessao](#parte-5)**
  - 5.1 `session.json`
  - 5.2 `audit.jsonl`
  - 5.3 Zero state
  - 5.4 `session-briefing.md`
  - 5.5 `pending-tasks.md`
  - 5.6 `session-final-report.md`
- **[Parte 6 — Logica de cada script automatico](#parte-6)**
  - 6.1 a 6.9 (stop, post-tool-use, session-start, user-prompt-submit, pre-tool-use, pre-compact, subagent, session-close, auditoria)
- **[Parte 7 — Fases de implementacao (F1…F5)](#parte-7)**
- **[Parte 8 — Decisoes de design](#parte-8)**
- **[Parte 9 — Questoes em aberto](#parte-9)**
- **[Parte 10 — Variaveis automaticas da plataforma](#parte-10)**
  - 10.1 a 10.10 (stdin, campos por evento, mutabilidade, schemas, helpers)
- **[Parte 11 — Debug e operacao documental](#parte-11)**
  - 11.1 Canal de hooks
  - 11.2 Agent Debug Panel
  - 11.3 Chat Debug View
  - 11.4 Fluxo recomendado de debug
  - 11.5 Troubleshooting rapido
  - 11.6 Guia definitivo de `additionalContext`
- **[Historico de versoes](#historico-de-versoes)**

---

## Guia de leitura rapida (por objetivo)

- **Entender contrato oficial rapidamente** → Partes **1**, **2** e **3**
- **Implementar do zero** → Partes **4**, **5**, **6** e **7**
- **Validar decisões arquiteturais** → Partes **8** e **9**
- **Integrar com payload real da plataforma** → Parte **10**
- **Depurar comportamento no VS Code** → Parte **11**

> Sugestao pratica: para execução incremental, use a sequência **3 → 4 → 6 → 7 → 10 → 11**.

---

<a id="parte-1"></a>
## Parte 1 -- O que a plataforma faz (base tecnica)

### Sumario da Parte 1

- 1.1 Eventos suportados
- 1.2 Input comum
- 1.3 Exit codes e output comum
- 1.4 Formato de configuracao

### 1.1 Os 8 eventos suportados

O VS Code define **8 eventos oficiais** no Preview de marco/2026. Formato PascalCase e o nativo;
lowerCamelCase (formato Copilot CLI) e convertido automaticamente.

| Evento (nativo)    | Alias Copilot CLI     | Frequencia tipica                  |
| ------------------ | --------------------- | ---------------------------------- |
| `SessionStart`     | `sessionStart`        | 1x por nova janela de chat         |
| `UserPromptSubmit` | `userPromptSubmitted` | 1x por prompt digitado             |
| `PreToolUse`       | `preToolUse`          | 1x antes de cada ferramenta        |
| `PostToolUse`      | `postToolUse`         | 1x apos cada ferramenta OK         |
| `PreCompact`       | `preCompact`          | Raro -- so quando contexto estoura |
| `SubagentStart`    | `subagentStart`       | 1x por subagente criado            |
| `SubagentStop`     | `subagentStop`        | 1x por subagente encerrado         |
| `Stop`             | `agentStop`           | 1x por turno encerrado             |

> **Nota**: `SessionEnd` (= `sessionEnd`) e mencionado no formato Copilot CLI mas **NAO esta listado
> nos 8 eventos oficiais** da documentacao VS Code de marco/2026. Ver Parte 2.8.

### 1.2 Input comum (todos os hooks recebem via stdin)

```json
{
  "timestamp": "2026-03-17T10:00:00.000Z",
  "cwd": "/workspaces/chatgpt-docker-puppeteer",
  "sessionId": "session-abc123",
  "hookEventName": "Stop",
  "transcript_path": "/path/to/transcript.json"
}
```

> **Campo oficial confirmado**: o VS Code envia `sessionId` (camelCase) conforme a documentacao
> oficial. O GUIA usa `session_id` (snake_case) mas empiricamente ambos aparecem. Os scripts devem
> ler os dois com fallback: `jq -r '.sessionId // .session_id // empty'`.

### 1.3 Exit codes

| Codigo   | Significado                                                      |
| -------- | ---------------------------------------------------------------- |
| `0`      | Sucesso -- stdout parseado como JSON (se houver)                 |
| `2`      | Erro bloqueante -- stderr mostrado ao modelo, processamento para |
| `outros` | Aviso nao bloqueante -- mostrado ao usuario, continua            |

### 1.3B Output comum (todos os hooks podem retornar via stdout)

Alem dos `hookSpecificOutput` especificos de cada hook, todos suportam estes campos de nivel raiz:

```json
{
  "continue": true,
  "stopReason": "Motivo de parada (para o usuario)",
  "systemMessage": "Aviso exibido no chat"
}
```

| Campo           | Tipo    | Descricao                                                               |
| --------------- | ------- | ----------------------------------------------------------------------- |
| `continue`      | boolean | `false` encerra a SESSION INTEIRA (mais drastico que bloquear um turno) |
| `stopReason`    | string  | Motivo de parada -- exibido ao usuario quando `continue: false`         |
| `systemMessage` | string  | Aviso exibido no chat, independente de outras decisoes                  |

> **CRITICO**: `continue: false` e DIFERENTE de `decision: "block"` no Stop hook.
> - `decision: "block"` (Stop): bloqueia o FIM DO TURNO -- agente continua, novo turno comeca
> - `continue: false` (qualquer hook): encerra a SESSION inteira -- sem mais turnos
>
> **Regra de precedencia**: quando multiplos mecanismos coexistem, o mais restritivo vence.
> Se um hook retorna `continue: false` E `permissionDecision: "allow"`, a sessao ainda para.

### 1.3C Hierarquia de mecanismos de controle (mais ao menos restritivo)

```
exit code 2   → bloqueia imediatamente, stderr vai para o modelo (sem JSON)
continue:false → encerra a SESSION inteira (mostra stopReason ao usuario)
decision:block → bloqueia o TURNO (usado no Stop e SubagentStop)
permissionDecision:deny → bloqueia uma FERRAMENTA especifica (PreToolUse)
permissionDecision:ask  → pede aprovacao do usuario (PreToolUse)
systemMessage  → apenas exibe aviso, sem bloquear nada
```

### 1.4 Formato do arquivo de configuracao

O arquivo fica em `.github/hooks/hooks.json` (ou qualquer `*.json` em `.github/hooks/`):

```json
{
  "hooks": {
    "Stop": [
      {"type": "command", "command": ".github/hooks/scripts/stop.sh", "timeout": 45}
    ],
    "PostToolUse": [
      {"type": "command", "command": ".github/hooks/scripts/post-tool-use.sh", "timeout": 30}
    ]
  }
}
```

> **Nota (v2.0):** `command` e resolvido a partir da raiz do repositorio. Se preferir usar
> `./scripts/...`, defina `"cwd": ".github/hooks"` na entrada do hook.

**Propriedades de cada entrada:**

| Propriedade | Tipo   | Obrigatorio | Descricao                                       |
| ----------- | ------ | ----------- | ----------------------------------------------- |
| `type`      | string | Sim         | Sempre `"command"`                              |
| `command`   | string | Sim         | Comando padrao (cross-platform)                 |
| `linux`     | string | Nao         | Override para Linux                             |
| `osx`       | string | Nao         | Override para macOS                             |
| `windows`   | string | Nao         | Override para Windows                           |
| `cwd`       | string | Nao         | Diretorio de trabalho (relativo a raiz do repo) |
| `env`       | object | Nao         | Variaveis de ambiente adicionais                |
| `timeout`   | number | Nao         | Timeout em segundos (padrao: 30)                |

---

<a id="parte-2"></a>
## Parte 2 -- Quando cada evento dispara (analise detalhada)

### Sumario da Parte 2

- 2.1 SessionStart
- 2.2 UserPromptSubmit
- 2.3 PreToolUse
- 2.4 PostToolUse
- 2.5 Stop
- 2.6 SubagentStart/SubagentStop
- 2.7 PreCompact
- 2.8 SessionEnd (instavel)

Esta e a secao mais critica. Muito da confusao na implementacao anterior veio de interpretacoes
erradas sobre **quando exatamente** cada evento dispara.

### 2.1 `SessionStart` -- Uma vez por nova janela de chat

**Dispara quando:**
- O usuario abre uma **nova conversa** no Copilot Chat (botao "+" -> New Conversation)
- O VS Code reinicia e o Copilot Chat e recarregado com nova sessao
- O DevContainer e recriado ou reiniciado

**NAO dispara quando:**
- O usuario responde a um prompt na mesma conversa
- O usuario responde a um `vscode_askQuestions`
- O agente faz multiplos turnos na mesma conversa
- O usuario reabre o VS Code na mesma sessao de chat (LIM-02 -- ver abaixo)

**Frequencia real:** Em sessoes longas de trabalho (como as deste repositorio), pode disparar apenas
1x por dia de trabalho.

**CONSEQUENCIA PARA O DESIGN:** Nao se pode confiar no `SessionStart` para inicializar estado a cada
TURNO. O estado persistente (session.json) deve ser criado/atualizado tambem quando o sistema detecta
que esta rodando sem estado -- via `UserPromptSubmit` ou `Stop`.

**Input adicional:** `{"source": "new"}` -- o campo `source` e atualmente sempre `"new"`.

**Output suportado:** Pode injetar `additionalContext` que o agente ve como contexto inicial.

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Briefing da sessao aqui..."
  }
}
```

---

### 2.2 `UserPromptSubmit` -- Por prompt digitado na caixa de chat

**Dispara quando:** O usuario digita texto na **caixa de chat do VS Code** e pressiona Enter.

**NAO dispara quando (CRITICO):**
- O usuario responde a um `vscode_askQuestions` -- isso e `PostToolUse` com
  `tool_name = "vscode_askQuestions"`
- O agente processa uma ferramenta -- isso e `PreToolUse`/`PostToolUse`

**Consequencia critica:** Em fluxos onde o agente usa `vscode_askQuestions` extensivamente (como
este repositorio), o `UserPromptSubmit` pode disparar **apenas 1 vez** por sessao inteira -- o
prompt inicial. Todo o dialogo subsequente corre via `PostToolUse`.

**Evidencia empirica** (sessao de 24h, audit.jsonl):
```
sessionStart      1x  (1 vez no inicio)
userPromptSubmit 28x  (28 prompts digitados diretamente no chat)
agentStop        20x  (20 turnos encerrados)
preToolUse     1892x  (1892 ferramentas invocadas)
postToolUse    1851x
```
Em 20 turnos, houve 28 prompts diretos. Parte dos turnos foi via resposta ao `vscode_askQuestions`
(sem `UserPromptSubmit`).

**Input adicional:** `{"prompt": "texto do que o usuario digitou"}` -- campo `prompt` confirmado
na documentacao oficial de marco/2026. Contem o texto exato da mensagem do usuario.

**Output:** Apenas o formato comum (`continue`, `stopReason`, `systemMessage`). Nao tem `hookSpecificOutput` proprio.

---

### 2.3 `PreToolUse` -- Antes de cada ferramenta

**Dispara quando:** O agente esta **prestes a invocar** qualquer ferramenta.

**Ferramentas que disparam:** Todas -- `read_file`, `replace_string_in_file`, `run_in_terminal`,
`vscode_askQuestions`, `manage_todo_list`, `semantic_search`, etc.

**Frequencia:** Muito alta. Em sessoes longas, milhares de vezes.

**Input adicional:**
```json
{
  "tool_name": "replace_string_in_file",
  "tool_input": {"filePath": "/path/file.js", "oldString": "...", "newString": "..."},
  "tool_use_id": "toolu_01abc..."
}
```

**Output -- controle de permissao:**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Razao do bloqueio",
    "additionalContext": "Contexto extra para o modelo (opcional)"
  }
}
```

`permissionDecision` pode ser:
- `"allow"` -- aprova automaticamente (menos restritivo)
- `"ask"` -- pede confirmacao ao usuario
- `"deny"` -- bloqueia a ferramenta (mais restritivo)

Quando multiplos hooks para o mesmo evento: **o mais restritivo vence** (`deny > ask > allow`).

**Uso canonico neste repo:** Bloquear tentativa do agente de chamar `session-close.sh` diretamente
via `run_in_terminal` (que contornaria o fluxo autorizado de encerramento de sessao).

---

### 2.4 `PostToolUse` -- Apos cada ferramenta completar COM SUCESSO

**Dispara quando:** Uma ferramenta **completou com sucesso**.

**NAO dispara quando:** A ferramenta falhou. (Para erros existe `PostToolUseFailure`, que nao esta
nos 8 eventos oficiais mas existe no formato Copilot CLI.)

**ASPECTO CRITICO -- respostas de `vscode_askQuestions`:**
- `vscode_askQuestions` e uma ferramenta normal invocada pelo agente
- Quando o usuario responde, o resultado chega via `PostToolUse` com `tool_name = "vscode_askQuestions"`
- **E aqui** que o sistema detecta a `close_key` (Template F) ou registra o `askQuestions_called`

**Input adicional:**
```json
{
  "tool_name": "vscode_askQuestions",
  "tool_input": {"questions": [...]},
  "tool_use_id": "toolu_01abc...",
  "tool_response": "{\"answers\":{...}}"
}
```

**Output:**
```json
{
  "decision": "block",
  "reason": "Erro de validacao pos-ferramenta",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Contexto extra injetado na conversa"
  }
}
```

**Uso canonico neste repo:** Detectar quando `vscode_askQuestions` foi chamado (atualiza flag no
`state/session.json`), e detectar a `close_key` em respostas ao Template F.

---

### 2.5 `Stop` -- Fim de CADA TURNO (nao de cada sessao)

**MAIOR FONTE DE CONFUSAO:** O nome `Stop` e a descricao "Agent session ends" da documentacao sao
enganosos. Na pratica, `Stop` dispara ao **fim de cada turno do agente**, nao quando a janela do
chat e fechada.

**O que e um "turno":** Do momento em que o usuario envia uma mensagem ate o agente terminar
completamente sua resposta (ultimo token escrito, sem mais tool calls pendentes).

**Dispara ao fim de:** 1 turno completo, que pode conter N tool calls.

**Input adicional:**
```json
{
  "stop_hook_active": false
}
```

**`stop_hook_active` -- o anti-loop:**

| Valor   | Quando                                           | O que fazer                                 |
| ------- | ------------------------------------------------ | ------------------------------------------- |
| `false` | Primeira invocacao do Stop neste turno           | Verificar protocolo, bloquear se necessario |
| `true`  | Segunda+ invocacao (resultado de block anterior) | **Nunca bloquear** -- saida com exit 0      |

**REGRA CRITICA:** Jamais emitir `decision:block` quando `stop_hook_active=true`. Causaria loop
infinito de bloqueios, consumindo premium requests indefinidamente.

**Sequencia quando agente nao chamou `vscode_askQuestions`:**
```
1. Agente termina resposta -> VS Code: Stop com stop_hook_active=false
2. stop.sh: vscode_askQuestions nao foi chamado -> emite decision:block
3. VS Code injeta reason como systemMessage no contexto do agente
4. Agente processa -> chama vscode_askQuestions -> escreve nova resposta
5. VS Code: Stop com stop_hook_active=true
6. stop.sh: ve stop_hook_active=true -> exit 0 (sem block)
7. Turno encerra normalmente
```

**Output para bloquear:**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "decision": "block",
    "reason": "Protocolo TODO: chame vscode_askQuestions antes de encerrar o turno."
  }
}
```

---

### 2.6 `SubagentStart` / `SubagentStop` -- Para subagentes

**Dispara quando:** O agente principal invoca `runSubagent`.

**SubagentStart -- input adicional (confirmado na doc oficial):**
```json
{
  "agent_id": "subagent-456",
  "agent_type": "Plan"
}
```

| Campo        | Tipo   | Descricao                                              |
| ------------ | ------ | ------------------------------------------------------ |
| `agent_id`   | string | Identificador unico do subagente                       |
| `agent_type` | string | Nome do agente (ex: "Plan", "Explore", ou nome custom) |

> **CORRECAO vs v1.6**: A Parte 10.9 anterior assumia que SubagentStart usava `tool_use_id`
> (observado no sistema antigo). A documentacao oficial de marco/2026 confirma `agent_id` e
> `agent_type` como os campos corretos. Scripts devem ler os dois com fallback defensivo.

**SubagentStop -- input adicional (confirmado na doc oficial):**
```json
{
  "agent_id": "subagent-456",
  "agent_type": "Plan",
  "stop_hook_active": false
}
```

| Campo              | Tipo    | Descricao                                                 |
| ------------------ | ------- | --------------------------------------------------------- |
| `agent_id`         | string  | Identificador unico do subagente                          |
| `agent_type`       | string  | Nome do agente                                            |
| `stop_hook_active` | boolean | `true` se ja esta continuando por block anterior. Checar! |

**Output SubagentStart:** Pode injetar `additionalContext` no subagente.
```json
{
  "hookSpecificOutput": {
    "hookEventName": "SubagentStart",
    "additionalContext": "Contexto injetado no subagente"
  }
}
```

**Output SubagentStop:** Pode bloquear o subagente de encerrar (formato RAIZ, sem hookSpecificOutput):
```json
{
  "decision": "block",
  "reason": "Verificar resultados antes de encerrar o subagente"
}
```

> **IMPORTANTE**: SubagentStop usa formato de block NO NIVEL RAIZ (igual ao PostToolUse),
> diferente do Stop do agente principal que usa `hookSpecificOutput`.
> Verificar `stop_hook_active` antes de emitir `decision: "block"` -- mesma logica anti-loop do Stop.

**Observacao empirica (v1.6):** Subagentes compartilham o mesmo `sessionId` da sessao pai.
Nao disparam `SessionStart` para o pai.

---

### 2.7 `PreCompact` -- Antes de compactar o contexto

**Dispara quando:** O contexto da conversa ultrapassa o budget de tokens e o VS Code decide
compacta-lo automaticamente.

**Frequencia:** Rara -- apenas em sessoes muito longas.

**Input adicional:** `{"trigger": "auto"}` (atualmente so existe `"auto"`).

**Output:** Apenas o formato comum. Nao pode impedir a compactacao -- so pode salvar estado antes.

**LIMITACAO OBSERVADA:** Em um caso documentado, o reinicio inline de contexto ocorreu **sem**
disparar o `PreCompact`. O sistema deve ser robusto a essa possibilidade.

---

### 2.8 `SessionEnd` -- Quando a sessao fecha (INSTAVEL)

**Status:** Presente no formato Copilot CLI, mas **NAO listado nos 8 eventos oficiais** da
documentacao VS Code de marco/2026.

**LIMITACOES CRITICAS (LIM-01):**
- **NAO dispara** em crashes do VS Code
- **NAO dispara** em reinicializacoes de DevContainer
- **NAO dispara** em timeouts de sessao
- **NAO dispara** quando o usuario fecha o VS Code sem fechar o chat explicitamente

**Conclusao:** Nao se pode confiar no `SessionEnd` para persistir estado critico. Por isso, o
sistema usa `stop.sh` (que dispara ao fim de cada turno) para manter estado persistente.

---

<a id="parte-2b"></a>
## Parte 2B -- Hierarquia SESSION / SECTION / TURN / SUBTURN

### Sumario da Parte 2B

- 2B.1 Visao geral
- 2B.2 SESSION
- 2B.3 SECTION (fora de escopo)
- 2B.4 TURN
- 2B.5 SUBTURN
- 2B.6 Invariante
- 2B.7 Encerramento abrupto

Esta secao define os **quatro niveis de ciclo de vida** do sistema -- tanto os nativos da plataforma
quanto os que construiremos. E fundamental entender o que e nativo vs o que sera implementado por nos.

### 2B.1 Visao geral

> **Decisao de design**: SECTION foi eliminada do escopo por ora. O sistema opera com tres niveis:
> SESSION, TURN e SUBTURN. SECTION pode ser reintroduzida futuramente como modulo independente.

```
┌──────────────────────────────────────────────────────────────────┐
│  SESSION  (1 por painel de chat do VS Code)                      │
│  └── TURN  (N por SESSION -- ciclos prompt→resposta)             │
│       └── SUBTURN  (N por TURN -- cada chamada vscode_askQuestions│
│                + resposta do usuario = 1 SUBTURN)                │
└──────────────────────────────────────────────────────────────────┘
```

| Nivel       | Nativo VS Code?             | Quem cria                      | Quem encerra                                                                 | Persistido em        |
| ----------- | --------------------------- | ------------------------------ | ---------------------------------------------------------------------------- | -------------------- |
| **SESSION** | Sim (SessionStart/Stop)     | `session-start.sh` (auto)      | `session-close.sh` (chamado por stop.sh quando `pending_session_close=true`) | `state/session.json` |
| **TURN**    | Sim (UserPromptSubmit→Stop) | `user-prompt-submit.sh` (auto) | `stop.sh` (auto, com ou sem close_key)                                       | `state/session.json` |
| **SUBTURN** | Nao existe                  | `pre-tool-use.sh` (auto)       | `post-tool-use.sh` (auto)                                                    | `state/session.json` |

---

### 2B.2 SESSION

**Origem da verdade**: o `sessionId` vem exclusivamente do VS Code no payload de cada hook.
**Nunca geramos** um `sessionId` proprio -- apenas o lemos, persistimos e sincronizamos.

**Quando comeca:**
- `SessionStart` dispara ao abrir uma nova conversa no Copilot Chat
- `session-start.sh` le o `sessionId` do payload e inicializa `state/session.json`
- Gera a `close_key` (ex: `ENCERRAR-A4B7C2D1`) que sera necessaria para encerramento

**Quando termina:**
1. Agente chama `vscode_askQuestions` com Template F (exibindo a `close_key`)
2. Usuario digita a `close_key` na resposta de campo livre
3. `post-tool-use.sh` detecta a KEY no tool_response -> seta `pending_session_close=true` no state
4. `stop.sh` detecta `pending_session_close=true` -> chama `session-close.sh` -> encerra o TURN
5. `session-close.sh` registra `session.ended_at` e gera relatorio final

> **IMPORTANTE**: a `close_key` autoriza o encerramento do **TURN corrente** (via `stop.sh`),
> nao a SESSION diretamente. A SESSION e marcada como encerrada pelo `session-close.sh` chamado
> **dentro do fluxo do Stop**, nunca por chamada direta do agente.
> SUBTURNs NUNCA exigem `close_key` — terminam naturalmente quando o usuario responde.

**INVARIANTE**: `session.ended_at == null` enquanto sessao esta ativa.

**Campos do `state/session.json` relativos a SESSION:**
```json
{
  "vs_code_session_id": "uuid-do-vscode",
  "session_id": "uuid-do-vscode",
  "started_at": "2026-03-17T10:00:00Z",
  "ended_at": null,
  "close_key": "ENCERRAR-A4B7C2D1",
  "source": "new",
  "pending_session_close": false
}
```

---

### 2B.3 SECTION -- Fora de escopo (por ora)

> SECTION foi eliminada do escopo desta reimplementacao. O conceito existe no GUIA-HOOKS-COPILOT.md
> e na implementacao anterior mas adiciona complexidade sem beneficio imediato. Pode ser reintroduzida
> como modulo independente em uma fase futura, sem quebrar o sistema base (SESSION/TURN/SUBTURN).

---

### 2B.4 TURN (Ciclo prompt-resposta)

**Parcialmente nativo**: o VS Code dispara `UserPromptSubmit` (inicio) e `Stop` (fim).
Nosso sistema acrescenta metadados.

**Quando comeca:**
- `UserPromptSubmit` dispara -> `user-prompt-submit.sh` incrementa contadores e loga `turnStart`
- Agente (opcionalmente) chama `bash .github/hooks/scripts/start-turn.sh "intencao"` para
  declarar a intencao do turno

**Durante o TURN:**
- `PreToolUse` dispara antes de cada ferramenta -> `pre-tool-use.sh` rastreia por nome
- `PostToolUse` dispara apos sucesso de cada ferramenta -> `post-tool-use.sh` detecta `askQuestions`

**Quando termina:**
- `Stop` dispara -> `stop.sh` verifica se `ask_questions_called` foi definido neste turn
- SE nao foi chamado E modo strict ativo -> emite `decision:block` (anti-loop via `stop_hook_active`)
- SE foi chamado -> loga `turnEnd_authorized`, reseta contadores
- SE `pending_session_close=true` no state -> chama `session-close.sh` ANTES de encerrar

> **close_key e mecanismo de fim de TURN:** quando o usuario digita a `close_key` em resposta ao
> Template F, o `post-tool-use.sh` registra `pending_session_close=true`. No proximo `Stop`, o
> `stop.sh` detecta esse flag e chama `session-close.sh`. Assim, a `close_key` autoriza o
> encerramento do TURN corrente com efeito colateral de fechar a SESSION.
> **A `close_key` jamais e usada em SUBTURNs** — SUBTURNs encerram naturalmente.

**Contador de turno:**

| Contador    | Campo                      | Reseta?             | Descricao                |
| ----------- | -------------------------- | ------------------- | ------------------------ |
| Turn global | `session_stats.turn_count` | Nunca (por SESSION) | Contagem total da sessao |

**Campos do `state/session.json` relativos ao TURN:**
```json
{
  "current_turn": {
    "number": 5,
    "turn_id": "uuid-turn",
    "started_at": "2026-03-17T11:00:00Z",
    "ask_questions_called": false,
    "subturn_count": 0,
    "tools_count": 12
  },
  "session_stats": {
    "turn_count": 5,
    "turn_authorized": 3,
    "turn_unauthorized": 2
  }
}
```

---

### 2B.5 SUBTURN -- Definido como Opcao B

**Decisao**: SUBTURN = cada par `vscode_askQuestions` chamado + resposta recebida.

Um SUBTURN inicia quando `pre-tool-use.sh` detecta que o `tool_name` e `vscode_askQuestions`
e termina quando a resposta e recebida (PostToolUse com `tool_response` preenchida).
O SUBTURN e completamente automatico — nao exige chamada manual do agente e
**nunca exige `close_key`**. A `close_key` e exclusiva do fluxo de encerramento de TURN.

**Sequencia de um SUBTURN:**
```
1. Agente chama vscode_askQuestions
   -> PreToolUse: tool_name="vscode_askQuestions"
   -> pre-tool-use.sh -> loga "subturnStart", incrementa subturn_count no state

2. Usuario responde (pode demorar segundos a minutos)
   -> PostToolUse: tool_name="vscode_askQuestions", tool_response={answers:{...}}
   -> post-tool-use.sh -> loga "subturnEnd", seta ask_questions_called=true
   -> verifica se tool_response contem close_key (apenas para flag pending_session_close;
      NAO encerra o SUBTURN de forma diferente -- o SUBTURN ja encerrou normalmente)
```

**Contadores de SUBTURN:**

| Campo                         | Descricao                                       |
| ----------------------------- | ----------------------------------------------- |
| `current_turn.subturn_count`  | Quantos SUBTURNs ocorreram no TURN atual        |
| `current_subturn.number`      | Numero sequencial do SUBTURN corrente (1-based) |
| `current_subturn.subturn_id`  | UUID do SUBTURN                                 |
| `current_subturn.started_at`  | Quando agente chamou askQuestions               |
| `current_subturn.response_at` | Quando usuario respondeu                        |
| `session_stats.subturn_total` | Total de SUBTURNs na sessao                     |

**Campos do `state/session.json` relativos ao SUBTURN:**
```json
{
  "current_turn": {
    "subturn_count": 2,
    "ask_questions_called": true
  },
  "current_subturn": {
    "number": 2,
    "subturn_id": "uuid-subturn",
    "started_at": "2026-03-17T11:05:00Z",
    "response_at": "2026-03-17T11:05:30Z"
  },
  "session_stats": {
    "subturn_total": 8
  }
}
```

**Relacao TURN / SUBTURN:**
- 1 TURN pode ter 0, 1 ou N SUBTURNs
- SUBTURN nao inicia novo TURN -- e interno ao TURN corrente
- Termo de referencia: `TURN 5 / SUBTURN 2` (global_turn=5, subturn_neste_turn=2)
- `ask_questions_called = true` e equivalente a `subturn_count >= 1` neste TURN

---

### 2B.6 Invariante absoluta

**Sempre deve haver SESSION + TURN simultaneamente ativos** (SECTION foi eliminada do escopo).

Mecanismo de recuperacao em `stop.sh`:
- Se `state/session.json` nao existe -> cria estado inicial (bootstrap)
- Se `session_id` no state diverge do payload -> sincroniza (heal)

---

### 2B.7 Encerramento abrupto de TURN (crash / VS Code fechado)

**Cenario:** O usuario fecha o VS Code, ou o processo crasha, ou a conexao cai — enquanto um TURN
esta em andamento. O hook `Stop` **NAO dispara** nesse caso (ele dispara ao fim normal de um turno,
nao quando o agente e interrompido externamente).

**Consequencias:**

| Situacao                         | O que fica no session.json                              | Risco                                                         |
| -------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| Stop nao disparou                | `current_turn.started_at` preenchido, sem `ended_at`    | Turn "orfao" -- o sistema nao sabe que o turno foi cancelado  |
| close_key ja foi detectada       | `pending_session_close = true`                          | Flag travada -- proximo TURN herda intencao de fechar sessao  |
| ask_questions_called ja era true | `ask_questions_called = true`                           | Proximo TURN começa como se tivesse sido autorizado           |
| ask_questions_called era false   | `ask_questions_called = false`, turn_count incrementado | Turno cancelado pode virar "unauthorizado" retrospectivamente |

**Deteccao de turn orfao:**

Um turn e considerado "orfao" quando:
```
current_turn.started_at != null
E current_turn.turn_id != null
E (tempo_atual - current_turn.started_at) > THRESHOLD
```

O THRESHOLD sugerido: **1 hora** (3600s). Turno de mais de 1h sem Stop = presumidamente orfao.

**Onde fazer a deteccao:** Em `user-prompt-submit.sh`, ao inicio de cada novo turno (UserPromptSubmit
dispara ao usuario digitar). O script deve verificar se o turno anterior foi devidamente encerrado.

**Algoritmo de heal de turn orfao em `user-prompt-submit.sh`:**

```
ANTES de incrementar turn_count:

1. Ler current_turn.started_at do state
2. Calcular age_seconds = (now - started_at)
3. SE age_seconds > 3600 (1h) OU (started_at != null E turn_count > session_stats.turn_authorized + session_stats.turn_unauthorized + 1):
   a. Logar "turnEnd_orphaned" no audit.jsonl com {turn: current_turn.number, age: age_seconds}
   b. Incrementar session_stats.turn_unauthorized (o orfao conta como nao autorizado)
   c. Incrementar compliance.consecutive_unauthorized
   d. Resetar pending_session_close = false (limpar flag potencialmente travada)
   e. Resetar current_turn.ask_questions_called = false
4. Continuar com inicializacao normal do novo turno
```

> **Por que resetar `pending_session_close`?** Se o crash ocorreu apos a close_key ser detectada
> mas antes do Stop disparar, `pending_session_close` ficou `true`. No proximo TURN, o usuario
> pode nao estar mais querendo encerrar a sessao. Resetar e mais seguro -- ele pode usar o
> Template F novamente se ainda quiser fechar.

**Fluxo resumido (abrupto vs normal):**

```
NORMAL:
UserPromptSubmit → [PreToolUse/PostToolUse × N] → Stop
                                                    └─ stop.sh: verifica ask_questions, autoriza/bloqueia

ABRUPTO (crash):
UserPromptSubmit → [PreToolUse/PostToolUse × N] → (VS Code fecha)
                                                    └─ Stop NAO dispara
                                                    └─ session.json fica com turn orfao

PROXIMO TURNO (apos reabertura):
UserPromptSubmit → user-prompt-submit.sh
                   └─ detecta turn orfao (age > 1h ou contagem divergente)
                   └─ loga "turnEnd_orphaned"
                   └─ reseta pending_session_close + ask_questions_called
                   └─ inicia novo turno normalmente
```

**O que NAO fazer:**
- Nao bloquear o inicio do novo TURN por causa do orfao -- o usuario ja perdeu trabalho, nao
  adicionar mais fricção.
- Nao tentar "completar" o TURN orfao retroativamente -- sem Stop, nao ha mecanismo.
- Nao deixar `pending_session_close = true` herdado -- poderia fechar a sessao inesperadamente.

**Casos extremos:**
- **Crash durante SubagentStop**: `subagent-stop.sh` nao completa, subagente fica em estado
  indefinido. Por ora: sem tracking especial -- logs mostram `subagentStart` sem `subagentStop`.
- **Crash apos session-close.sh chamado mas antes de terminar**: session.json pode ter `ended_at`
  preenchido mas `pending_session_close = true` ainda. `session-close.sh` deve ser idempotente:
  se `pending_session_close` ja e false e `ended_at` ja esta preenchido, exit 0 sem acao.
- **Multiplos crashes consecutivos**: cada `UserPromptSubmit` faz o heal -- robusto por design.

---

<a id="parte-3"></a>
## Parte 3 -- Diferencas entre implementacao anterior e correta

### Sumario da Parte 3

- Comparativo legado (`hooks.old`) vs contrato oficial VS Code

| Item                   | Implementacao anterior (hooks.old)        | Correto (oficial VS Code)                                                                                |
| ---------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Nomes dos eventos      | `agentStop`, `preToolUse` (camelCase)     | `Stop`, `PreToolUse` (PascalCase)                                                                        |
| Propriedade de comando | `bash`                                    | `command` (+ `linux`/`osx`/`windows`)                                                                    |
| Timeout                | `timeoutSec`                              | `timeout`                                                                                                |
| Stop block output      | `{decision:"block"}` no nivel raiz        | `{hookSpecificOutput:{hookEventName:"Stop",decision:"block",reason:"..."}}` (+ `systemMessage` opcional) |
| PostToolUse block      | `{hookSpecificOutput:{decision:"block"}}` | `{decision:"block", reason:"..."}` no nivel raiz                                                         |
| Matchers               | Usados para filtrar por ferramenta        | **Ignorados** no VS Code (todos os hooks rodam em todos os eventos)                                      |

> **Compatibilidade:** O VS Code converte automaticamente o formato Copilot CLI
> (camelCase + `bash`) para o formato nativo (PascalCase + `command`). A implementacao nova usara
> o formato nativo diretamente para evitar ambiguidades.

---

<a id="parte-4"></a>
## Parte 4 -- Estrutura proposta (apenas hooks automaticos)

### Sumario da Parte 4

- 4.0 Principio script↔lib
- 4.1 Mapa de arquivos
- 4.2 Arvore de diretorios
- 4.3 `lib/common.sh`
- 4.4 `hooks.json`

Esta secao descreve apenas os **scripts chamados automaticamente** pelos hooks. Scripts de controle
manual (start-section.sh, add-task.sh, etc.) serao adicionados nas fases posteriores.

### 4.0 Principio: todo script tem uma lib dedicada

**Regra arquitetural:** cada script em `scripts/` tem **exatamente um arquivo lib** correspondente
em `lib/`. O script e um wrapper minimo -- leitura de stdin, `source` da lib, chamada de `main`.
Toda a logica fica na lib. Isso permite:
- Testar a logica isoladamente (`bash lib/stop-lib.sh`)
- Reutilizar funcoes de uma lib em outros contextos
- Manter os scripts limpos (< 15 linhas cada)

**Padrao de cada script:**
```bash
#!/usr/bin/env bash
set -euo pipefail
HOOK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$HOOK_DIR/lib/common.sh"
source "$HOOK_DIR/lib/stop-lib.sh"    # <- lib especifica deste script
INPUT="$(cat)"                         # leitura unica de stdin
main "$INPUT"
```

### 4.1 Mapa de arquivos: scripts/ e lib/

| Script automatico               | Lib associada              | Evento VS Code     |
| ------------------------------- | -------------------------- | ------------------ |
| `scripts/session-start.sh`      | `lib/session-start-lib.sh` | `SessionStart`     |
| `scripts/user-prompt-submit.sh` | `lib/user-prompt-lib.sh`   | `UserPromptSubmit` |
| `scripts/pre-tool-use.sh`       | `lib/pre-tool-use-lib.sh`  | `PreToolUse`       |
| `scripts/post-tool-use.sh`      | `lib/post-tool-use-lib.sh` | `PostToolUse`      |
| `scripts/pre-compact.sh`        | `lib/pre-compact-lib.sh`   | `PreCompact`       |
| `scripts/subagent-start.sh`     | `lib/subagent-lib.sh`      | `SubagentStart`    |
| `scripts/subagent-stop.sh`      | `lib/subagent-lib.sh`      | `SubagentStop`     |
| `scripts/stop.sh`               | `lib/stop-lib.sh`          | `Stop`             |

> `subagent-start.sh` e `subagent-stop.sh` compartilham `lib/subagent-lib.sh` pois
> a logica e similar (tracking de ID + log). Cada script chama a funcao correta da lib.

### 4.2 Arvore de diretorios completa

```
.github/hooks/
|-- hooks.json               <- unico arquivo de configuracao
|-- scripts/
|   |-- session-start.sh     <- wrapper: SessionStart
|   |-- user-prompt-submit.sh<- wrapper: UserPromptSubmit
|   |-- pre-tool-use.sh      <- wrapper: PreToolUse
|   |-- post-tool-use.sh     <- wrapper: PostToolUse
|   |-- pre-compact.sh       <- wrapper: PreCompact
|   |-- subagent-start.sh    <- wrapper: SubagentStart
|   |-- subagent-stop.sh     <- wrapper: SubagentStop
|   `-- stop.sh              <- wrapper: Stop (NUCLEO)
|-- lib/
|   |-- common.sh            <- funcoes compartilhadas por todos
|   |-- session-start-lib.sh <- logica de SessionStart
|   |-- user-prompt-lib.sh   <- logica de UserPromptSubmit
|   |-- pre-tool-use-lib.sh  <- logica de PreToolUse
|   |-- post-tool-use-lib.sh <- logica de PostToolUse
|   |-- pre-compact-lib.sh   <- logica de PreCompact
|   |-- subagent-lib.sh      <- logica de SubagentStart e SubagentStop
|   `-- stop-lib.sh          <- logica de Stop (protocolos TODO)
`-- state/
    |-- session.json         <- contexto vivo da sessao
    |-- session-briefing.md  <- briefing gerado/atualizado por cada UserPromptSubmit
    |-- session-final-report.md <- relatorio gerado por session-close.sh ao encerrar
    |-- pending-tasks.md     <- backlog de tarefas (editado manualmente pelo agente)
    `-- audit.jsonl          <- log imutavel de eventos (append-only)
```

### 4.3 `lib/common.sh` -- funcoes compartilhadas

Todo arquivo lib faz `source "$HOOK_DIR/lib/common.sh"` como primeiro passo. O `common.sh` expoe:

#### Variavel global fundamental

```bash
# Caminho absoluto para .github/hooks/ -- independente do cwd em que o VS Code executou o script.
# Calculado a partir da localizacao do proprio common.sh (que fica em lib/).
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$HOOK_DIR/state"
STATE_FILE="$STATE_DIR/session.json"
AUDIT_FILE="$STATE_DIR/audit.jsonl"
```

> **Por que isso e critico:** O VS Code pode invocar o hook com qualquer `cwd` (geralmente a raiz
> do workspace). Se o script usar caminho relativo (ex: `state/session.json`), funciona. Mas se for
> invocado de outro diretorio, quebra. Usar `HOOK_DIR` calculado a partir de `${BASH_SOURCE[0]}`
> e o unico metodo robusto.

#### Funcoes de estado

| Funcao                | Assinatura                              | Descricao                                                           |
| --------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| `state_exists`        | `state_exists` -> bool                  | Retorna 0 se session.json existe e e JSON valido                    |
| `read_field`          | `read_field "campo"` -> string          | Le campo do session.json via jq                                     |
| `update_state`        | `update_state "campo" "valor"`          | Atualiza campo de raiz STRING no session.json atomicamente          |
| `update_state_bool`   | `update_state_bool "campo" true\|false` | Atualiza campo de raiz BOOLEANO no session.json (sem aspas no JSON) |
| `update_nested_state` | `update_nested_state "a.b" "valor"`     | Atualiza campo aninhado (string, bool ou numero)                    |
| `write_state`         | `write_state "$json"`                   | Substitui session.json inteiro por $json                            |
| `init_state`          | `init_state "$session_id"`              | Cria state minimo (zero) para nova sessao                           |

**Atomicidade de `update_state` e `update_state_bool`:**
```bash
update_state() {
    # Para campos de raiz STRING (ex: session_id, source, ended_at)
    # CUIDADO: nao usar para booleanos -- jq --arg produz "true" (string), nao true (bool)
    local key="$1" val="$2"
    local tmp
    tmp="$(mktemp "$STATE_DIR/.state.XXXXXX")"
    jq --arg k "$key" --arg v "$val" '.[$k] = $v' "$STATE_FILE" > "$tmp"
    mv -f "$tmp" "$STATE_FILE"
}

update_state_bool() {
    # Para campos de raiz BOOLEANOS (ex: pending_session_close, strict_turn_close)
    # Usa --argjson para preservar tipo booleano no JSON (sem aspas)
    local key="$1" val="$2"   # val deve ser "true" ou "false" (string shell)
    local tmp
    tmp="$(mktemp "$STATE_DIR/.state.XXXXXX")"
    jq --arg k "$key" --argjson v "$val" '.[$k] = $v' "$STATE_FILE" > "$tmp"
    mv -f "$tmp" "$STATE_FILE"
}
```
Ambas usam `mktemp` + `mv` para evitar corrida entre hooks concorrentes.

> **REGRA DE USO**:
> - Campos de raiz string: `update_state "ended_at" "$(now_iso)"`
> - Campos de raiz booleanos: `update_state_bool "pending_session_close" "true"`
> - Campos aninhados (qualquer tipo): `update_nested_state "current_turn.ask_questions_called" "true"`

> **LIMITACAO CRITICA de `update_state`**: so funciona para **campos de nivel raiz e tipo string**.
> Para campos aninhados como `current_turn.ask_questions_called`, usar `update_nested_state`:

```bash
update_nested_state() {
    # Atualiza campo aninhado via jq path syntax
    # Uso: update_nested_state "campo.subcampo" "valor"
    # Ex:  update_nested_state "current_turn.ask_questions_called" "true"
    local key_path="$1" val="$2"
    local tmp
    tmp="$(mktemp "$STATE_DIR/.state.XXXXXX")"

    # Converter "current_turn.ask_questions_called" em path jq: .current_turn.ask_questions_called
    local jq_path=".${key_path}"

    # Para booleanos (true/false) e numeros, usar --argjson; para strings, usar --arg
    case "$val" in
        true|false)
            jq --argjson v "$val" "${jq_path} = \$v" "$STATE_FILE" > "$tmp" ;;
        ''|*[!0-9]*)
            jq --arg v "$val" "${jq_path} = \$v" "$STATE_FILE" > "$tmp" ;;
        *)
            jq --argjson v "$val" "${jq_path} = \$v" "$STATE_FILE" > "$tmp" ;;
    esac

    mv -f "$tmp" "$STATE_FILE"
}
```

> **Regra de uso**: sempre que os scripts atualizarem `current_turn.*` ou `current_subturn.*`
> ou `session_stats.*` ou `compliance.*`, usar `update_nested_state` e nao `update_state`.
> Campos de raiz (ex: `pending_session_close`, `ended_at`) usam `update_state`.

#### Funcao de log de auditoria

> **VERSAO CANONICA** (ver tambem Parte 10.10 para helpers de leitura complementares).
> Esta e a implementacao autorizada de `log_audit` -- use `jq -n --arg` para prevenir
> injection de JSON. A assinatura e posicional: `log_audit "event" [key value ...]`.

```bash
log_audit() {
    # Assinatura: log_audit "event" [key1 value1 key2 value2 ...]
    # Uso: log_audit "turnStart" "turn" "5" "section" "inicio"
    # NUNCA usar concatenacao de strings -- usar jq -n --arg para prevenir JSON injection
    local event="$1"; shift
    local ts
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    local json_obj
    json_obj=$(jq -n \
        --arg ts "$ts" \
        --arg ev "$event" \
        --arg sid "${SESSION_ID:-unknown}" \
        '{ts: $ts, event: $ev, session_id: $sid}')
    # Adicionar campos extras via jq (seguro contra injection)
    while [ "$#" -ge 2 ]; do
        local k="$1" v="$2"; shift 2
        json_obj=$(printf '%s' "$json_obj" | jq --arg k "$k" --arg v "$v" '. + {($k): $v}')
    done
    printf '%s\n' "$json_obj" >> "$AUDIT_FILE"
}
```

**Uso tipico:**
```bash
log_audit "turnStart" "turn" "$turn_count" "section" "inicio"
log_audit "askQuestions_responded" "turn" "$turn_count"
log_audit "turnEnd" "turn" "$turn_count" "authorized" "true"
```

> **Nota de assinatura**: a Parte 10.10 repete esta mesma funcao com a mesma assinatura
> posicional. As duas sao identicas -- a Parte 10.10 e apenas contexto adicional de uso.

#### Funcoes de output JSON para o VS Code

O VS Code espera JSON no stdout de determinados hooks. `common.sh` oferece helpers:

```bash
# Emite JSON de bloqueio (Stop hook)
# NOTA: reason e escapado via jq -Rs para evitar JSON invalido com aspas/newlines/backslashes
# FORMATO CORRETO (v2.1): Stop usa hookSpecificOutput.decision/reason.
# A doc oficial VS Code mostra Stop com hookSpecificOutput.hookEventName="Stop".
# systemMessage pode coexistir no nivel raiz como mensagem auxiliar.
emit_stop_block() {
    local reason="$1"
    local escaped
    escaped=$(printf '%s' "$reason" | jq -Rs .)
  # decision/reason em hookSpecificOutput + systemMessage auxiliar
  printf '{"hookSpecificOutput":{"hookEventName":"Stop","decision":"block","reason":%s},"systemMessage":%s}\n' \
        "$escaped" "$escaped"
}

# Emite additionalContext (SessionStart)
emit_additional_context() {
    local ctx="$1"
    # jq -Rs retorna string com aspas incluidas (ex: "conteudo") -- usar %s sem aspas externas
    local escaped
    escaped="$(printf '%s' "$ctx" | jq -Rs .)"
    printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' \
        "$escaped"
}

# Emite permissionDecision deny (PreToolUse)
# NOTA: reason e escapado via jq -Rs para evitar JSON invalido
emit_permission_deny() {
    local reason="$1"
    local escaped
    escaped=$(printf '%s' "$reason" | jq -Rs .)
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' \
        "$escaped"
}

# Emite block de postToolUse (nivel raiz -- diferente do Stop)
emit_post_tool_block() {
    local reason="$1"
    local escaped
    escaped=$(printf '%s' "$reason" | jq -Rs .)
    printf '{"decision":"block","reason":%s}\n' "$escaped"
}
```

#### Funcoes auxiliares

```bash
# Retorna timestamp ISO 8601 atual (UTC)
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Gera close_key aleatoria (8 chars hex)
make_close_key() { printf 'ENCERRAR-%s' "$(head -c4 /dev/urandom | xxd -p | head -c8 | tr '[:lower:]' '[:upper:]')"; }

# Extrai campo de JSON passado como string
# Uso: jq_field "$input" ".stop_hook_active"
jq_field() { printf '%s' "$1" | jq -r "$2"; }
```

### 4.4 `hooks.json` -- configuracao completa

```json
{
  "hooks": {
    "SessionStart": [
      {"type": "command", "command": ".github/hooks/scripts/session-start.sh", "timeout": 60}
    ],
    "UserPromptSubmit": [
      {"type": "command", "command": ".github/hooks/scripts/user-prompt-submit.sh", "timeout": 30}
    ],
    "PreToolUse": [
      {"type": "command", "command": ".github/hooks/scripts/pre-tool-use.sh", "timeout": 30}
    ],
    "PostToolUse": [
      {"type": "command", "command": ".github/hooks/scripts/post-tool-use.sh", "timeout": 30}
    ],
    "PreCompact": [
      {"type": "command", "command": ".github/hooks/scripts/pre-compact.sh", "timeout": 30}
    ],
    "SubagentStart": [
      {"type": "command", "command": ".github/hooks/scripts/subagent-start.sh", "timeout": 30}
    ],
    "SubagentStop": [
      {"type": "command", "command": ".github/hooks/scripts/subagent-stop.sh", "timeout": 30}
    ],
    "Stop": [
      {"type": "command", "command": ".github/hooks/scripts/stop.sh", "timeout": 45}
    ]
  }
}
```

> **`cwd` e paths no hooks.json (CORRIGIDO v2.0):** A documentacao oficial do VS Code (marco/2026)
> confirma: `cwd` no hooks.json e relativo a **raiz do repositorio** (workspace root), NAO ao
> diretorio onde `hooks.json` esta localizado. Portanto os paths de `command` DEVEM ser relativos
> ao workspace root: `.github/hooks/scripts/session-start.sh` (correto), NAO
> `./scripts/session-start.sh` (incorreto -- resolveria para `<repo-root>/scripts/`, que nao existe).
>
> **Alternativa com `cwd` explicito:** Pode-se adicionar `"cwd": ".github/hooks"` a cada entrada
> do hooks.json para que `./scripts/session-start.sh` funcione. Ambas as abordagens sao validas;
> este plano usa paths completos para maxima clareza.
>
> **Nos proprios scripts:** Os scripts usam `${BASH_SOURCE[0]}` para calcular `HOOK_DIR` de forma
> robusta (ver Parte 4.3), o que os torna independentes do `cwd` do VS Code independentemente de
> qual das duas abordagens for usada no hooks.json.
>
> **`chat.hookFilesLocations` (configuracao VS Code):** A doc oficial documenta a setting
> `chat.hookFilesLocations` que permite customizar quais arquivos de hooks sao carregados. Util
> para troubleshooting: se os hooks nao forem reconhecidos, verificar esta setting e o canal de
> output "GitHub Copilot Chat Hooks" (ver Parte 11).
>
> **Agent-scoped hooks:** Hooks podem ser definidos em frontmatter YAML de arquivos `.agent.md`.
> Esses hooks so disparam quando aquele agente especifico esta ativo. Nao e o foco deste plano
> (que usa hooks globais via hooks.json), mas vale registrar para referencia futura.

---

<a id="parte-5"></a>
## Parte 5 -- Estado minimo

### Sumario da Parte 5

- 5.1 `session.json`
- 5.2 `audit.jsonl`
- 5.3 Zero state
- 5.4 `session-briefing.md`
- 5.5 `pending-tasks.md`
- 5.6 `session-final-report.md`

### 5.1 `state/session.json` -- schema completo

```json
{
  "_comment": "gerado por session-start.sh, atualizado por hooks automaticos",

  "vs_code_session_id": "uuid-do-vscode",
  "session_id": "uuid-do-vscode",
  "started_at": "2026-03-17T10:00:00Z",
  "ended_at": null,
  "close_key": "ENCERRAR-A4B7C2D1",
  "source": "new",
  "pending_session_close": false,
  "strict_turn_close": true,

  "current_turn": {
    "number": 5,
    "turn_id": "uuid",
    "started_at": "2026-03-17T11:00:00Z",
    "ask_questions_called": false,
    "subturn_count": 0,
    "tools_count": 0
  },

  "current_subturn": {
    "number": 0,
    "subturn_id": null,
    "started_at": null,
    "response_at": null
  },

  "session_stats": {
    "turn_count": 4,
    "turn_authorized": 3,
    "turn_unauthorized": 1,
    "subturn_total": 12,
    "tools_total": 87
  },

  "compliance": {
    "consecutive_unauthorized": 0,
    "last_turn_authorized": true
  }
}
```

| Campo                               | Quem escreve                           | Descricao                                                                         |
| ----------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| `vs_code_session_id`                | `session-start.sh`                     | ID imutavel dado pelo VS Code                                                     |
| `session_id`                        | `session-start.sh`                     | Copia de vs_code_session_id (sincronizado em heals)                               |
| `started_at`                        | `session-start.sh`                     | Inicio da sessao                                                                  |
| `ended_at`                          | `session-close.sh`                     | Encerramento autorizado (null se ativa)                                           |
| `close_key`                         | `session-start.sh`                     | Chave para autorizar encerramento de TURN com efeito session: `ENCERRAR-XXXXXXXX` |
| `source`                            | `session-start.sh`                     | `"new"` ou `"reconnect"`                                                          |
| `pending_session_close`             | `post-tool-use.sh`                     | Flag: close_key detectada, aguardando proximo Stop para fechar sessao             |
| `strict_turn_close`                 | `session-start.sh` (sempre `true`)     | Se `true`, block quando turn encerra sem askQuestions. Ver Parte 8.               |
| `current_turn.number`               | `user-prompt-submit.sh`                | Turn global da sessao                                                             |
| `current_turn.turn_id`              | `user-prompt-submit.sh`                | UUID unico do turn                                                                |
| `current_turn.started_at`           | `user-prompt-submit.sh`                | Inicio do turn                                                                    |
| `current_turn.ask_questions_called` | `post-tool-use.sh` (reset no stop.sh)  | True apos usuario responder askQuestions neste turn                               |
| `current_turn.subturn_count`        | `pre-tool-use.sh`                      | Subturns iniciados no turn atual (cada chamada de askQuestions)                   |
| `current_turn.tools_count`          | `pre-tool-use.sh`                      | Ferramentas usadas no turn                                                        |
| `current_subturn.*`                 | `pre-tool-use.sh` + `post-tool-use.sh` | Estado do subturn corrente                                                        |
| `session_stats.*`                   | Varios hooks                           | Acumuladores da sessao                                                            |
| `compliance.*`                      | `stop.sh`                              | Rastreamento de conformidade com protocolo                                        |

> **`strict_turn_close`** e sempre `true` nesta implementacao. Nao ha modo relaxado previsto.
> Registrado no `session.json` para visibilidade do agente ao ler o briefing.

### 5.2 `state/audit.jsonl` -- formato de eventos

Cada linha e um JSON completo:
```
{"ts":"2026-03-17T10:00:00Z","event":"sessionStart","session_id":"abc123"}
{"ts":"2026-03-17T10:01:00Z","event":"turnStart","turn":1,"section":"inicio"}
{"ts":"2026-03-17T10:01:30Z","event":"toolUse","turn":1,"tool":"read_file"}
{"ts":"2026-03-17T10:01:45Z","event":"subturnStart","turn":1,"subturn":1}
{"ts":"2026-03-17T10:01:50Z","event":"subturnEnd","turn":1,"subturn":1,"authorized":true}
{"ts":"2026-03-17T10:01:50Z","event":"askQuestions_responded","turn":1}
{"ts":"2026-03-17T10:02:00Z","event":"turnEnd","turn":1,"authorized":true}
{"ts":"2026-03-17T11:00:00Z","event":"sessionEnd","session_id":"abc123","turn_count":5}
```

> **Nota**: `log_audit` deve sempre usar `jq -n --arg` para construir o JSON (ver 10.10),
> nunca concatenacao de strings. Isso previne injecao de JSON via campos com quebras de linha.

---

### 5.3 Estado inicial (zero state)

O `session-start.sh` deve criar o `session.json` com exatamente estes valores iniciais:

```json
{
  "_comment": "gerado por session-start.sh",

  "vs_code_session_id": "<sessionId do payload>",
  "session_id": "<sessionId do payload>",
  "started_at": "<ISO 8601 UTC do momento>",
  "ended_at": null,
  "close_key": "ENCERRAR-<8 chars hex maiusculos>",
  "source": "<source do payload, ou 'new'>",
  "pending_session_close": false,
  "strict_turn_close": true,

  "current_turn": {
    "number": 0,
    "turn_id": null,
    "started_at": null,
    "ask_questions_called": false,
    "subturn_count": 0,
    "tools_count": 0
  },

  "current_subturn": {
    "number": 0,
    "subturn_id": null,
    "started_at": null,
    "response_at": null
  },

  "session_stats": {
    "turn_count": 0,
    "turn_authorized": 0,
    "turn_unauthorized": 0,
    "subturn_total": 0,
    "tools_total": 0
  },

  "compliance": {
    "consecutive_unauthorized": 0,
    "last_turn_authorized": true
  }
}
```

> **Bootstrap sem SessionStart (RECONNECT):** Se `user-prompt-submit.sh` detectar que
> `session.json` nao existe (SessionStart nao disparou), deve criar este zero state usando
> o `sessionId` do payload corrente e `source="reconnect"`. A `close_key` e gerada igualmente.
> Logar `"sessionStart_recovery"` no audit.jsonl.

---

### 5.4 `state/session-briefing.md` -- template

Arquivo gerado pelo `session-start.sh` e emitido como `additionalContext` no output do
`SessionStart`. Formato minimo:

```markdown
# Session Briefing — <DATA>

**Session ID**: <vs_code_session_id>
**Iniciada em**: <started_at>
**Close Key**: `<close_key>` ← use esta chave no Template F para encerrar

## Estado atual
- Turno atual: <current_turn.number>
- SUBTURNs neste turno: <current_turn.subturn_count>
- Strict mode: <strict_turn_close>

## Estatisticas da sessao
- Turnos totais: <session_stats.turn_count>
- Turnos autorizados: <session_stats.turn_authorized>
- Turnos nao-autorizados: <session_stats.turn_unauthorized>
- Violacoes consecutivas: <compliance.consecutive_unauthorized>

## Tarefas pendentes
<conteudo de state/pending-tasks.md, ou "(nenhuma)" se vazio>
```

> O `session-briefing.md` deve ser re-gerado (sobrescrito) ao inicio de cada TURN pelo
> `user-prompt-submit.sh` para refletir stats atualizadas.

---

### 5.5 `state/pending-tasks.md` -- spec

Arquivo que contem o backlog de tarefas pendentes para o agente. **Gerenciado manualmente** pelo
agente (ou por scripts de controle manual fora do escopo desta reimplementacao).

**Quem le:** `session-start.sh` e `user-prompt-submit.sh` ao gerar `session-briefing.md`.
**Quem escreve:** O agente, diretamente, via ferramentas como `replace_string_in_file` ou
`create_file`. Nao ha script automatico que gerencia este arquivo.

**Formato sugerido (minimo):**

```markdown
# Tarefas Pendentes

## Prioridade Alta
- [ ] Titulo da tarefa (criada em 2026-03-17)
  - Descricao: O que precisa ser feito
  - Gate: Como saber quando esta pronto

## Prioridade Media
- [ ] Outra tarefa

## Concluidas (ultimas 5)
- [x] Tarefa concluida (2026-03-17)
```

> **Inicializacao:** Se `pending-tasks.md` nao existir, `session-briefing.md` exibe
> `"(nenhuma tarefa pendente)"`. O agente cria o arquivo quando quiser comecar a rastrear tarefas.
> Nao ha validacao do formato -- e um arquivo puramente informativo para o agente.

---

### 5.6 `state/session-final-report.md` -- template

Arquivo gerado pelo `session-close.sh` ao encerrar a sessao. Contem o resumo para consulta futura.

```markdown
# Session Final Report — <DATA>

**Session ID**: <vs_code_session_id>
**Iniciada em**: <started_at>
**Encerrada em**: <ended_at>
**Duracao**: <duracao calculada>

## Estatisticas
- Turnos totais: <turn_count>
- Turnos autorizados: <turn_authorized>
- Turnos NAO-autorizados: <turn_unauthorized>
- SUBTURNs totais: <subturn_total>
- Ferramentas invocadas: <tools_total>
- Violacoes consecutivas maximas: <compliance.*>

## Ultimos 10 eventos (do audit.jsonl)
<tail -10 audit.jsonl formatado>
```

---

<a id="parte-6"></a>
## Parte 6 -- Logica de cada script automatico

### Sumario da Parte 6

- 6.1 `stop.sh`
- 6.2 `post-tool-use.sh`
- 6.3 `session-start.sh`
- 6.4 `user-prompt-submit.sh`
- 6.5 `pre-tool-use.sh`
- 6.6 `pre-compact.sh`
- 6.7 `subagent-*`
- 6.8 `session-close.sh`
- 6.9 Tabela de eventos

### 6.1 `stop.sh` -- NUCLEO do Protocolo TODO

```
ENTRADA: JSON via stdin com {stop_hook_active, sessionId, ...}

1. Ler stop_hook_active do input
2. SE stop_hook_active=true -> logar "turnEnd_authorized_loop" -> exit 0 (anti-loop)
3. Ler state/session.json
4. SE state nao existe -> criar estado inicial (zero state) -> logar "state_auto_init" -> exit 0
5. Ler turn_count do state (session_stats.turn_count)
6. SE turn_count == 0 -> turno inicial sem trabalho -> exit 0 (sem block)
   [NOTA: turn_count e incrementado pelo user-prompt-submit.sh ANTES do Stop disparar.
   Na pratica turn_count sera >= 1 quando Stop dispar. Este passo so cobre o cenario
   EDGE de Stop disparar SEM user-prompt-submit.sh ter rodado (ex: sessao nova com
   o agente sem nenhum prompt do usuario ainda -- ex: hook configurado errado ou
   sessao iniciada por API). Manter o passo como safety guard, mas ciente de que e raro.]
7. Verificar ask_questions_called no state (campo: current_turn.ask_questions_called)
8. SE ask_questions_called == false E strict_turn_close == true:
   -> incrementar compliance.consecutive_unauthorized  [via update_nested_state]
   -> emitir JSON com hookSpecificOutput.decision="block", reason e systemMessage
   -> reason: "Protocolo TODO: chame vscode_askQuestions antes de encerrar."
   -> exit 0
9. SE ask_questions_called == true:
   -> resetar current_turn.ask_questions_called = false  [via update_nested_state "current_turn.ask_questions_called" "false"]
   -> resetar compliance.consecutive_unauthorized = 0    [via update_nested_state "compliance.consecutive_unauthorized" "0"]
   -> logar "turnEnd_authorized" no audit.jsonl
   -> incrementar session_stats.turn_authorized          [via update_nested_state]
   -> SE pending_session_close == true:
      -> chamar session-close.sh   [chamada interna de shell, nao via run_in_terminal]
      -> exit 0
   -> exit 0
```

> **Nota: session-briefing.md NAO e atualizado pelo stop.sh.** O briefing e atualizado pelo
> `user-prompt-submit.sh` no INICIO de cada turno, nao no fim. Atualizar no Stop seria
> redundante (o agente ja encerrou a resposta) e ineficiente (Stop tem frequencia igual a Turn).

> **emit_stop_block (helper do common.sh):**
> Ver implementacao canonica na Parte 4.3. A funcao usa `jq -Rs .` para escapar `$reason`,
> garantindo JSON valido mesmo com aspas, backslashes ou quebras de linha na mensagem.
>
> **NOTA**: `$reason` DEVE ser escapado via `jq -Rs .` antes de inserir no JSON.
> Motivo: se `$reason` contiver aspas (`"`), barras (`\`) ou quebras de linha, o JSON sera
> invalido e o VS Code ignorara o block. A funcao `emit_stop_block` no common.sh DEVE sempre
> usar `jq -Rs .` — nunca concatenacao direta de strings no JSON de saida.

### 6.2 `post-tool-use.sh` -- Fechamento de SUBTURN e deteccao de close_key

```
ENTRADA: JSON via stdin com {tool_name, tool_input, tool_response, ...}

1. SE tool_name contem "askQuestions" (case-insensitive):
   a. Preencher current_subturn.response_at = NOW_ISO no state
   b. Seta current_turn.ask_questions_called = true no state   ←── ocorre AQUI (PostToolUse,
      apos resposta recebida), NAO no PreToolUse
   c. Logar "subturnEnd" + "askQuestions_responded" no audit.jsonl
   d. Extrair text livre das respostas: jq '.tool_response.answers | to_entries[] | .value.freeText'
   e. SE text contem a close_key armazenada em state.close_key:
      -> Logar "sessionCloseAuthorized" (sem executar session-close.sh aqui)
      -> Seta pending_session_close = true no state
      -> (session-close.sh sera chamado pelo stop.sh no proximo Stop)
2. Logar "postToolUse" no audit.jsonl (tool_name + turn)
3. exit 0
```

> **Por que `ask_questions_called` e setado no PostToolUse?**
> O objetivo e saber se o **usuario JA RESPONDEU** (ask questions concluido), nao apenas se
> o agente fez a pergunta. Se setarmos no PreToolUse, um turn onde o agente perguntou mas
> a sessao foi interrompida antes da resposta seria contado como autorizado.
> Semantica correta: `ask_questions_called = true` quando resposta recebida.

### 6.3 `session-start.sh` -- Inicializacao de sessao

```
ENTRADA: JSON via stdin com {sessionId, source, ...}

1. Extrair sessionId e source
2. Criar state/session.json com zero state (ver Parte 5.3):
   - vs_code_session_id = sessionId
   - session_id = sessionId
   - started_at = ISO 8601 agora
   - ended_at = null
   - close_key = make_close_key()   # "ENCERRAR-" + 8 chars hex
   - source = source (ou "new")
   - pending_session_close = false
   - strict_turn_close = true
   - current_turn.number = 0
   - current_turn.ask_questions_called = false
   - (demais campos em zero/null conforme Parte 5.3)
3. Gerar state/session-briefing.md com template da Parte 5.4
4. Emitir JSON com hookSpecificOutput.additionalContext = conteudo do briefing
5. Logar "sessionStart" no audit.jsonl
```

### 6.4 `user-prompt-submit.sh` -- Inicio de turno

```
ENTRADA: JSON via stdin com {prompt, sessionId, ...}

1. Verificar se state/session.json existe
   -> SE nao existe: criar zero state com source="reconnect" (recovery sem SessionStart)
      -> Logar "sessionStart_recovery"

2. Verificar turn orfao (encerramento abrupto do turno anterior):
   -> Ler current_turn.started_at e current_turn.turn_id do state
   -> SE turn_id != null:
      a. Calcular age_seconds = (now - started_at)
      b. SE age_seconds > 3600 (1h):
         -> Logar "turnEnd_orphaned" com {turn: current_turn.number, age: age_seconds}
         -> Incrementar session_stats.turn_unauthorized  [via update_nested_state]
         -> Incrementar compliance.consecutive_unauthorized  [via update_nested_state]
         -> Resetar pending_session_close = false   [via update_state_bool] ← CRITICO
         -> [O passo 4 abaixo sobrescreve current_turn inteiro com novos valores -- nao
             e necessario resetar campos individuais de current_turn aqui, pois todos sao
             sobrescritos no passo 4]

3. Incrementar session_stats.turn_count no state  [via update_nested_state]
4. Atualizar current_turn (sobrescreve TODOS os campos, inclusive os do turn orfao se houve):
   - number = turn_count  [igual a session_stats.turn_count apos incremento]
   - turn_id = uuidgen
   - started_at = NOW_ISO
   - ask_questions_called = false
   - subturn_count = 0
   - tools_count = 0
5. Logar "turnStart" no audit.jsonl
6. Regerar state/session-briefing.md (ver Parte 5.4)
7. exit 0
```

> **Importante -- threshold de orfao:** 1 hora e o valor sugerido por seguranca.
> Um TURN normal raramente excede 1h; se exceder, o criterio por contagem divergente (passo 2b
> verifica se turn_count > turn_authorized + turn_unauthorized + 1) pode ser mais preciso.
> Implementar ambos os criterios; o primeiro que triggerar faz o heal.
>
> **Nao bloquear o novo TURN:** o usuario ja perdeu trabalho com o crash. O heal e silencioso
> (apenas log + contadores). O novo turno segue normalmente.
>
> **`session_stats.turn_count` vs `current_turn.number`:** ambos os campos representam o numero
> do TURN atual, mas sao mantidos em locais diferentes do state. `session_stats.turn_count`
> e o acumulador da sessao, incrementado no passo 3. `current_turn.number` e uma copia desse
> valor para facil acesso (passo 4: `number = turn_count`). Os dois DEVEM estar sincronizados;
> `current_turn.number` e apenas conveniencia. Scripts que precisam do numero do turn atual devem
> usar `current_turn.number` para evitar ler `session_stats.turn_count` e entender o contexto
> do counter vs do turn atual.

### 6.5 `pre-tool-use.sh` -- Protecao, tracking e inicio de SUBTURN

```
ENTRADA: JSON via stdin com {tool_name, tool_input, ...}

1. SE tool_name == "run_in_terminal":
   a. Extrair o campo tool_input.command
   b. SE command contem qualquer um destes padroes (case-insensitive):
      - "session-close" (cobre session-close.sh, session-close, etc.)
      - "session-close.sh"
      - "session_close"
      -> emitir permissionDecision="deny"
      -> reason = "session-close.sh so pode ser chamado via fluxo autorizado (Template F + close_key). Use vscode_askQuestions com Template F."
      -> logar "preToolUse_blocked_session_close" no audit.jsonl
      -> exit 0
   c. SE command contem "session-close" via path absoluto (ex: /workspaces/.../session-close.sh):
      -> idem acima
2. Incrementar current_turn.tools_count no state
3. Incrementar session_stats.tools_total no state
4. SE tool_name contem "askQuestions" (case-insensitive):
   a. Incrementar current_turn.subturn_count
   b. Incrementar session_stats.subturn_total
   c. Inicializa current_subturn:
      - number = subturn_count
      - subturn_id = uuidgen
      - started_at = NOW_ISO
      - response_at = null
   d. Logar "subturnStart" no audit.jsonl
   e. [NAO seta ask_questions_called aqui -- isso e feito no post-tool-use.sh apos resposta]
5. Logar "preToolUse" no audit.jsonl (tool_name + turn number)
6. exit 0
```

> **Padrão de bloqueio amplo:** A deteccao de `session-close` deve cobrir:
> - Nome de script: `session-close.sh`, `session_close.sh`
> - Paths relativos: `.github/hooks/scripts/session-close.sh`
> - Paths absolutos: `/workspaces/.../session-close.sh`
> Usar `grep -iE "session[-_]close"` como regra geral e suficiente.
>
> **Volume de logs:** `preToolUse` e logado a cada ferramenta (alta frequencia). Considerar
> logar apenas ferramentas relevantes (ex: `run_in_terminal`, `vscode_askQuestions`) para
> evitar JSONL demasiado grande em sessoes longas. Ou: omitir log de `preToolUse` por padrao
> e logar apenas eventos especiais (`subturnStart`, bloqueios).

### 6.6 `pre-compact.sh` -- Salvar estado antes de compactar

```
ENTRADA: JSON via stdin com {trigger, ...}

1. Copiar state/session.json -> state/session-checkpoint.json
2. Logar "preCompact" no audit.jsonl
3. exit 0
```

### 6.7 `subagent-start.sh` / `subagent-stop.sh` -- Tracking basico

```
subagent-start.sh:
ENTRADA: JSON via stdin com {agent_id, agent_type, sessionId, ...}

1. Logar "subagentStart" no audit.jsonl (incluir agent_id e agent_type)
2. exit 0

subagent-stop.sh:
ENTRADA: JSON via stdin com {agent_id, agent_type, stop_hook_active, sessionId, ...}

1. SE stop_hook_active=true -> logar "subagentStop_loop" -> exit 0 (anti-loop)
2. Logar "subagentStop" no audit.jsonl (incluir agent_id e agent_type)
3. exit 0
```

> **Nota**: `SubagentStop` tem o mesmo campo `stop_hook_active` que `Stop`.
> Usar anti-loop identico ao `stop.sh` para evitar recursao.

---

### 6.8 `session-close.sh` -- Encerramento de sessao

```
ENTRADA: Sem stdin (chamado internamente pelo stop.sh, nao pela plataforma)
ENCODING: Exportar LANG=C.UTF-8 no inicio (leitura de audit.jsonl pode ter UTF-8)

0. Verificar idempotencia:
   -> SE ended_at ja esta preenchido (nao e null):
      -> Logar "session_close_noop" (ja foi encerrada) -> exit 0 (idempotente)
   [NOTA: apenas ended_at e verificado -- pending_session_close pode estar true ou false
   dependendo do ponto onde um crash ocorreu. ended_at preenchido e condição suficiente
   para considerar a sessão já encerrada.]
1. Verificar que pending_session_close=true no state/session.json
   -> SE false: logar aviso "session_close_unexpected" e sair (guard)
2. Registrar ended_at = NOW_ISO no state
3. Seta pending_session_close = false no state
4. Logar "sessionEnd" no audit.jsonl com contagem final de turns
5. Gerar state/session-final-report.md (resumo da sessao: stats + ultimos N eventos do audit)
6. exit 0
```

> **Acesso restrito**: este script NAO deve ser chamado diretamente pelo agente via terminal.
> O `pre-tool-use.sh` bloqueia qualquer chamada de `run_in_terminal` pelo **agente** que contenha
> "session-close". Chamadas internas entre scripts de hook (ex: `stop.sh` chamando
> `session-close.sh`) NAO passam pelo PreToolUse -- PreToolUse so dispara para ferramentas
> invocadas pelo agente, nunca para subprocessos de shell. O isolamento entre scripts e
> garantido pela logica do stop.sh (que so chama session-close.sh quando pending_session_close=true)
> e pelo pre-tool-use.sh (que bloqueia o agente caso tente a chamada direta via run_in_terminal).
>
> **Idempotencia (passo 0)**: necessaria para o caso de crash apos `ended_at` ser gravado mas
> antes de `pending_session_close` ser resetado. Sem idempotencia, uma segunda chamada ao
> `session-close.sh` sobrescreveria `ended_at` com um timestamp mais recente, corrompendo o registro.

---

### 6.9 Tabela de eventos de auditoria por script

| Script                  | Eventos que loga                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `session-start.sh`      | `sessionStart`                                                                                   |
| `user-prompt-submit.sh` | `turnStart`, `sessionStart_recovery` (se recovery), `turnEnd_orphaned` (se turn orfao detectado) |
| `pre-tool-use.sh`       | `subturnStart`, `preToolUse_blocked_session_close` (se bloqueado)                                |
| `post-tool-use.sh`      | `postToolUse`, `subturnEnd`, `askQuestions_responded`, `sessionCloseAuthorized`                  |
| `stop.sh`               | `turnEnd_authorized`, `turnEnd_unauthorized`, `turnEnd_authorized_loop`, `state_auto_init`       |
| `session-close.sh`      | `sessionEnd`, `session_close_noop` (se idempotente), `session_close_unexpected` (guard)          |
| `pre-compact.sh`        | `preCompact`                                                                                     |
| `subagent-start.sh`     | `subagentStart`                                                                                  |
| `subagent-stop.sh`      | `subagentStop`, `subagentStop_loop`                                                              |

> **Nota sobre volume de `preToolUse`**: o evento `preToolUse` foi removido do log padrao desta
> tabela porque sua frequencia e muito alta (1 por ferramenta). Apenas eventos especiais do
> `pre-tool-use.sh` sao logados. O tracking de `tools_count` ocorre no state sem log de auditoria
> por ferramenta.

---

<a id="parte-7"></a>
## Parte 7 -- Fases de implementacao

### Sumario da Parte 7

- F1 Core (protocolo TODO)
- F2 Inicializacao de sessao
- F3 Protecoes
- F4 Auxiliares
- F5 Validacao completa

### F1 -- Core: Protocolo TODO funcional (PROXIMA)

**Escopo:** Scripts essenciais para o bloqueio de turno.

**Entregaveis:**
- [ ] `hooks.json` -- configuracao completa no formato nativo PascalCase
- [ ] `lib/common.sh` -- funcoes: `read_state`, `write_state`, `update_state`, `update_state_bool`, `update_nested_state`, `log_audit`
  - Nota: `update_state` e para campos de raiz string; `update_state_bool` para booleanos; `update_nested_state` para campos aninhados (ex: `current_turn.ask_questions_called`)
  - Nota: scripts devem ter `chmod +x` (obrigatorio para hooks funcionarem)
  - Nota: checar presenca de `jq` no inicio do common.sh (requisito externo)
- [ ] `state/session.json` -- arquivo skeleton para bootstrap (zero state conforme Parte 5.3)
- [ ] `scripts/stop.sh` -- verificacao de ask_questions_called + decision:block + pending_session_close
- [ ] `scripts/post-tool-use.sh` -- detecta vscode_askQuestions, seta ask_questions_called, detecta close_key
- [ ] `scripts/session-close.sh` -- encerramento autorizado (chamado por stop.sh)
- [ ] **`scripts/smoke-test.sh` (basico)** -- TDD: escrever ANTES dos scripts

> **Por que smoke-test em F1?** A abordagem TDD garante que os contratos de I/O (formato JSON,
> exit codes, campos do state) sejam definidos antes da implementacao. O smoke-test serve como
> spec executavel e previne regressao desde o inicio. Versao basica em F1; suite completa em F5.

**Gate de aceitacao:** `bash smoke-test.sh` retorna PASS para stop.sh + post-tool-use.sh.

---

### F2 -- Inicializacao de Sessao

**Entregaveis:**
- [ ] `scripts/session-start.sh` -- cria session.json (zero state), gera briefing, emite additionalContext
- [ ] `scripts/user-prompt-submit.sh` -- incrementa turn_count, resetar ask_questions_called, registra turnStart, regera briefing
- [ ] (session-briefing.md e gerado pelos scripts acima, nao e um artefato estatico)

> **Nota**: `user-prompt-submit.sh` tambem cobre o cenario RECONNECT (SessionStart nao disparou).

**Gate de aceitacao:** Ao iniciar sessao, agente recebe briefing automatico via additionalContext.

---

### F3 -- Protecoes

**Entregaveis:**
- [ ] `scripts/pre-tool-use.sh` -- bloqueia session-close.sh direta, rastreia subturnStart

**Gate de aceitacao:** Agente nao consegue chamar session-close.sh diretamente.

---

### F4 -- Auxiliares (cobertura completa dos 9 eventos)

**Entregaveis:**
- [ ] `scripts/pre-compact.sh` -- checkpoint antes de compactar
- [ ] `scripts/subagent-start.sh` -- tracking com agent_id + agent_type
- [ ] `scripts/subagent-stop.sh` -- tracking com anti-loop (stop_hook_active)

**Gate de aceitacao:** Todos os 9 eventos (8 hooks + session-close manual) tem script associado.

---

### F5 -- Validacao Completa

**Entregaveis:**
- [ ] `scripts/smoke-test.sh` completo -- suite expandida:
  - Testa formato JSON de saida de cada script (incluindo systemMessage no block)
  - Testa exit codes (0 = ok, 1 = erro interno)
  - Testa leitura/escrita do state (incluindo campos aninhados)
  - Testa deteccao de close_key no post-tool-use -> pending_session_close=true
  - Testa fluxo stop.sh com pending_session_close -> session-close.sh chamado
  - Testa RECONNECT: user-prompt-submit.sh sem session.json preexistente

**Gate de aceitacao:** `bash smoke-test.sh` retorna PASS para todos os scripts.

---

<a id="parte-8"></a>
## Parte 8 -- Decisoes de design

### Sumario da Parte 8

- Tabela de decisoes arquiteturais (estado, bloqueio, close_key, strict mode)

| Decisao                | Escolha                                               | Justificativa                                                           |
| ---------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| Formato de estado      | JSON unico (`session.json`)                           | Simples, sem dependencias externas                                      |
| Flag de askQuestions   | `ask_questions_called` booleano no `current_turn`     | Setado pelo **post-tool-use.sh** (apos resposta), resetado pelo stop.sh |
| Inicio de SUBTURN      | `pre-tool-use.sh` marca `subturn.started_at`          | PreToolUse e o primeiro evento do SUBTURN                               |
| Log de auditoria       | JSONL append-only com `jq -n --arg`                   | Imutavel, sem injection, sem lock necessario                            |
| Bloqueio de turno      | JSON no stdout do stop.sh                             | Conforme spec oficial VS Code                                           |
| Scripts                | Shell puro + `jq`                                     | Sem dependencias extras alem de jq (ja disponivel)                      |
| Libs                   | 1 lib por script + `common.sh` compartilhado          | Balance entre reutilizacao e clareza                                    |
| Arquivo de config      | 1 `hooks.json`                                        | 1 arquivo -> 1 fonte de verdade                                         |
| SECTION                | **Eliminada do escopo inicial**                       | Adiciona complexidade; pode ser adicionada depois                       |
| SUBTURN                | **Opcao B**: cada vscode_askQuestions + resposta      | Automatico, sem acao manual do agente                                   |
| Nivel de hierarquia    | SESSION > TURN > SUBTURN                              | Tres niveis suficientes para controle de protocolo                      |
| SUBTURN rastreado por  | `pre-tool-use.sh` (inicio) + `post-tool-use.sh` (fim) | Aproveita eventos de ferramenta existentes                              |
| close_key              | Autoriza fim de TURN com efeito session close         | Nunca usada em SUBTURN; fluxo: PostToolUse→flag→Stop→session-close      |
| strict_turn_close      | Sempre `true` (hardcoded nesta implementacao)         | Simplicidade; configurabilidade postergada                              |
| Encerramento de sessao | Via `pending_session_close` flag + stop.sh            | Agente nao pode chamar session-close.sh diretamente                     |

---

<a id="parte-9"></a>
## Parte 9 -- Questoes em aberto

### Sumario da Parte 9

- Resolvidas nesta versao
- Ainda em aberto

### Resolvidas nesta versao (v1.7)

- [x] **`session-close.sh`**: especificado na Parte 6.8. Faz: verificar flag, registrar
  `ended_at`, resetar `pending_session_close`, logar `sessionEnd`, gerar relatorio final.
- [x] **Recovery sem `SessionStart`**: `user-prompt-submit.sh` faz bootstrap com
  `source="reconnect"` e gera `close_key` normal. Loga `sessionStart_recovery`. (Parte 6.4)
- [x] **`strict_turn_close`**: decidido como sempre `true` nesta implementacao (hardcoded).
  Registrado no session.json para visibilidade. Nao e configuravel por hooks.json.
- [x] **SUBTURN e autodescoberta de sessao (RECONNECT)**: `user-prompt-submit.sh` usa
  `sessionId` do payload e gera nova `close_key`. (Parte 6.4)
- [x] **`ask_questions_called` timing**: setado no `post-tool-use.sh` (apos resposta),
  nao no `pre-tool-use.sh`. (Parte 6.2, 6.5)
- [x] **close_key e SESSION vs TURN**: close_key autoriza encerramento de TURN com efeito
  session close. SUBTURNs nunca usam close_key. (Partes 2B.2, 2B.4, 2B.5)
- [x] **`session-briefing.md` template**: especificado na Parte 5.4.
- [x] **Estado inicial session.json**: especificado na Parte 5.3.
- [x] **`emit_stop_block` sem systemMessage**: corrigido na Parte 6.1 (emit_stop_block inclui systemMessage).
- [x] **`log_audit` JSON injection**: mitigado via `jq -n --arg` no helper da Parte 10.10.

### Ainda em aberto

- [ ] **Compatibilidade com `hooks.old`**: manter como referencia ou excluir apos F5?
- [ ] **Limite de SUBTURNs por TURN**: deve haver limite maximo ou alerta apos N SUBTURNs?
  Se sim, qual trigger (aviso? block?).
- [ ] **Concorrencia de hooks**: o VS Code dispara hooks de forma serial ou pode haver
  paralelismo entre PreToolUse e PostToolUse de diferentes tools? Se paralelo, o
  `update_nested_state` precisa de locking (ex: `flock`). Hipotese atual: serial.
- [ ] **`pending-tasks.md` -- formato rigido vs livre**: o formato sugerido na Parte 5.5
  e apenas uma sugestao. Deve haver validacao de formato? Ou e completamente livre (risco:
  o briefing inclui conteudo mal-formatado)?
- [ ] **Timeout de SubagentStop apos block**: se `SubagentStop` emite `decision:block`, ha
  timeout para o subagente encerrar? Nao documentado na spec oficial.
- [ ] **Encoding UTF-8**: scripts que processam texto do usuario (paths, mensagens) devem
  exportar `LANG=C.UTF-8` para garantir comportamento correto do `jq` e `grep`.
- [ ] **Threshold de turn orfao (1h)**: o valor de 1 hora para detectar turn orfao e arbitrario.
  Deve ser configuravel (ex: campo em hooks.json ou variavel de ambiente)?
- [ ] **Criterio alternativo de orfao por contagem divergente**: a Parte 2B.7 menciona
  `turn_count > turn_authorized + turn_unauthorized + 1` como criterio. Precisa ser
  implementado e testado no smoke-test antes de ser considerado confiavel.
- [ ] **`compliance.consecutive_unauthorized` sem limite de acao**: o documento especifica
  que o contador e incrementado, mas NAO define o que acontece ao atingir N violacoes (ex:
  N=3: enviar alerta mais severo? N=10: encerrar sessao forcado?). Definir threshold e acao.
- [ ] **`session_stats.tools_total` conta `vscode_askQuestions`**: semanticamente, SUBTURNs
  (perguntas ao usuario) sao diferentes de "ferramentas de trabalho". Considerar separar:
  `tools_total` (sem askQuestions) e `subturn_total` ja existente. Ou: manter contagem unificada.
- [ ] **Timeout de hooks**: hooks.json define 30-45s de timeout. Se um script travar (ex: jq
  em arquivo corrompido), o VS Code encerra o proceso. O estado pode ficar pela metade.
  Considerar adicionar `timeout 25 bash script.sh` como wrapper defensivo.
- [ ] **`session-briefing.md` e `additionalContext`**: a Parte 6.3 diz que `session-start.sh`
  emite o briefing como `additionalContext`. Mas o `additionalContext` pode ter limite de tamanho?
  Se `pending-tasks.md` for grande, o briefing pode exceder o limite. Definir truncamento seguro.
- [ ] **Multiples SessionStart na mesma sessao**: e possivel que `SessionStart` dispare mais de
  uma vez por sessao (ex: reconexao com nova janela)? Se sim, `session-start.sh` deve sobrescrever
  o state ou preservar o anterior? Hipotese atual: sobrescreve (nova sessao = state limpo).
- [ ] **LANG=C.UTF-8 em todos os scripts**: session-close.sh e user-prompt-submit.sh (que le
  conteudo do payload) devem ter `export LANG=C.UTF-8`. Padronizar para TODOS os scripts de hook
  (adicionar ao topo de common.sh e ao shebang de cada wrapper).
- [ ] **`update_state_bool` no smoke-test (F1)**: o novo helper `update_state_bool` precisa ser
  coberto pelo smoke-test desde F1, especialmente para o campo `pending_session_close`.

---

---

<a id="parte-10"></a>
## Parte 10 -- Variaveis automaticas da plataforma

### Sumario da Parte 10

- 10.1 Leitura de stdin
- 10.2 Campos universais
- 10.3 Campos por evento
- 10.4 Tabela consolidada
- 10.5 Mutabilidade
- 10.6 Compatibilidade de nomes
- 10.7 Schemas de `tool_input`
- 10.8 Schemas de `tool_response`
- 10.9 Subagent fields oficiais
- 10.10 Helpers bash

Esta parte documenta **todos os campos que o VS Code envia automaticamente** no stdin JSON de cada
hook. E a diferenca entre o que a plataforma fornece (somente leitura) e o que nos construimos
(leitura e escrita em session.json).

### 10.1 Como acessar o stdin nos scripts bash

Todo hook recebe o payload da plataforma via **stdin** no momento da execucao. Padrao canonico:

```bash
#!/usr/bin/env bash
export LANG=C.UTF-8  # garante UTF-8 em jq e grep

# Ler TUDO do stdin como variavel (UMA VEZ -- stdin e consumido)
PAYLOAD=$(cat)

# Extrair campos individuais com jq
# sessionId e o campo OFICIAL (camelCase); session_id como fallback defensivo
SESSION_ID=$(echo "$PAYLOAD" | jq -r '.sessionId // .session_id // empty')
HOOK_EVENT=$(echo "$PAYLOAD" | jq -r '.hookEventName // empty')
TIMESTAMP=$(echo "$PAYLOAD"  | jq -r '.timestamp // empty')
HOOK_CWD=$(echo "$PAYLOAD"   | jq -r '.cwd // empty')  # HOOK_CWD evita conflito com $CWD do shell
TRANSCRIPT=$(echo "$PAYLOAD" | jq -r '.transcript_path // empty')
```

> O `common.sh` encapsula isso na funcao `load_hook_payload()` (ver Parte 10.10).
> Scripts NAO devem chamar `cat` novamente apos consumir o stdin.

> **IMPORTANTE**: O `cat` deve ser o primeiro comando do script, antes de qualquer subshell que
> possa consumir o stdin indevidamente. Guardar em `PAYLOAD` antes de usar `jq` multiplas vezes.

Para campos opcionais (presentes apenas em alguns hooks), use `// empty` ou `// "default"`:

```bash
TOOL_NAME=$(echo "$PAYLOAD"   | jq -r '.tool_name // empty')
TOOL_INPUT=$(echo "$PAYLOAD"  | jq -c '.tool_input // {}')
TOOL_RESP=$(echo "$PAYLOAD"   | jq -c '.tool_response // null')
TOOL_USE_ID=$(echo "$PAYLOAD" | jq -r '.tool_use_id // empty')
STOP_ACTIVE=$(echo "$PAYLOAD" | jq -r '.stop_hook_active // false')
SOURCE=$(echo "$PAYLOAD"      | jq -r '.source // empty')
TRIGGER=$(echo "$PAYLOAD"     | jq -r '.trigger // empty')
```

Para acessar campos aninhados de `tool_input` (ex: o comando que o agente vai executar):

```bash
CMD=$(echo "$PAYLOAD" | jq -r '.tool_input.command // empty')
FILE=$(echo "$PAYLOAD" | jq -r '.tool_input.filePath // empty')
```

### 10.2 Campos enviados automaticamente em TODOS os hooks

Estes campos estao presentes em **todos os 8 eventos** sem excecao:

| Campo             | Tipo   | Mutavel? | Descricao                                                         |
| ----------------- | ------ | -------- | ----------------------------------------------------------------- |
| `sessionId`       | string | NAO      | UUID da sessao VS Code. Imutavel durante toda a sessao            |
| `hookEventName`   | string | NAO      | Nome PascalCase do evento: `"SessionStart"`, `"PreToolUse"`, etc. |
| `timestamp`       | string | NAO      | ISO 8601 UTC do momento exato do evento                           |
| `cwd`             | string | NAO      | Diretorio de trabalho (raiz do workspace)                         |
| `transcript_path` | string | NAO      | Caminho para o JSON com todo o historico da conversa              |

> **Nome oficial**: a documentacao oficial de marco/2026 usa `sessionId` (camelCase). O GUIA
> interno usa `session_id` (snake_case). Em producao ambos foram observados. **Sempre usar fallback**:
> `jq -r '.sessionId // .session_id // empty'`

**`sessionId`**: UUID gerado pelo VS Code ao abrir a conversa. E o mesmo em todos os hooks,
inclusive subagentes. Nao muda durante a sessao inteira.

**`transcript_path`**: Arquivo JSON gerenciado pelo VS Code com todas as mensagens, tool calls e
respostas. Pode ser lido pelos scripts para auditoria offline, mas **nao pode ser modificado** pelos
hooks. Formato tipico:
`~/.config/Code/User/globalStorage/github.copilot-chat/transcript-<UUID>.json`

**Acesso bash padrao (campos universais)**:
```bash
PAYLOAD=$(cat)
SESSION_ID=$(echo "$PAYLOAD" | jq -r '.sessionId // .session_id // empty')
EVENT=$(echo "$PAYLOAD"      | jq -r '.hookEventName // empty')
TS=$(echo "$PAYLOAD"         | jq -r '.timestamp // empty')
WD=$(echo "$PAYLOAD"         | jq -r '.cwd // empty')
TRANSCRIPT=$(echo "$PAYLOAD" | jq -r '.transcript_path // empty')
```

### 10.3 Campos por evento (exclusivos ou opcionais)

#### SessionStart

Campos adicionais alem dos universais:

| Campo    | Tipo   | Mutavel? | Descricao                     |
| -------- | ------ | -------- | ----------------------------- |
| `source` | string | NAO      | Sempre `"new"` na doc oficial |

**Acesso**:
```bash
SOURCE=$(echo "$PAYLOAD" | jq -r '.source // "new"')
```

**Output do hook** (para injetar contexto inicial no agente):
```bash
echo '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Sessao iniciada. Leia o briefing em .github/hooks/state/session-briefing.md"}}'
```

---

#### UserPromptSubmit

Campos adicionais alem dos universais:

| Campo    | Tipo   | Descricao                         |
| -------- | ------ | --------------------------------- |
| `prompt` | string | Texto exato digitado pelo usuario |

> **Confirmado na doc oficial** (marco/2026): "UserPromptSubmit hooks receive a `prompt` field
> with the text the user submitted."

**Acesso bash**:
```bash
PROMPT_TEXT=$(echo "$PAYLOAD" | jq -r '.prompt // empty')
```

**Observacao**: O campo `prompt` so esta disponivel neste hook. Nao confundir com o `transcript_path`
(que tem o historico completo). `prompt` = apenas a mensagem mais recente do usuario.

---

#### PreToolUse

Campos adicionais alem dos universais:

| Campo         | Tipo   | Mutavel?                     | Descricao                               |
| ------------- | ------ | ---------------------------- | --------------------------------------- |
| `tool_name`   | string | NAO                          | Nome da ferramenta: `"run_in_terminal"` |
| `tool_input`  | object | **SIM** (via `updatedInput`) | Input que sera passado a ferramenta     |
| `tool_use_id` | string | NAO                          | UUID unico desta invocacao              |

**`tool_name`** -- exemplos de valores: `read_file`, `replace_string_in_file`, `run_in_terminal`,
`vscode_askQuestions`, `manage_todo_list`, `grep_search`, `semantic_search`, `get_errors`,
`list_dir`, `create_file`, `multi_replace_string_in_file`, `runSubagent`, `file_search`.

**`tool_input`** -- objeto com os parametros que o agente passou para a ferramenta. A estrutura
varia por ferramenta:
- `run_in_terminal`: `{"command": "npm run lint", "explanation": "...", "isBackground": false}`
- `read_file`: `{"filePath": "/workspace/src/main.js", "startLine": 1, "endLine": 50}`
- `replace_string_in_file`: `{"filePath": "...", "oldString": "...", "newString": "..."}`
- `vscode_askQuestions`: `{"questions": [...]}`

**`tool_input` e mutavel**: O hook pode retornar `updatedInput` para sobrescrever campos antes que
a ferramenta execute. Util para sanitizacao:
```bash
# Exemplo: sanitizar comando antes de executar
echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"allow\",\"updatedInput\":{\"command\":\"echo sanitized\"}}}"
```

**`tool_use_id`** -- formato observado empiricamente: `toolu_vrtx_<hash>__vscode-<epoch_ms>`.
Permite correlacionar o PreToolUse com o PostToolUse correspondente.

**Acesso bash**:
```bash
TOOL_NAME=$(echo "$PAYLOAD"   | jq -r '.tool_name')
TOOL_INPUT=$(echo "$PAYLOAD"  | jq -c '.tool_input')
TOOL_USE_ID=$(echo "$PAYLOAD" | jq -r '.tool_use_id')

# Campos dentro de tool_input (varia por ferramenta)
CMD=$(echo "$PAYLOAD"     | jq -r '.tool_input.command // empty')
FILE_PATH=$(echo "$PAYLOAD" | jq -r '.tool_input.filePath // empty')
```

**Outputs possiveis do hook `PreToolUse`**:

| Decisao               | Output JSON                                                                                                             | Efeito                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Permitir (padrao)     | `{}` ou sem output                                                                                                      | Ferramenta executa normalmente             |
| Permitir com contexto | `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","additionalContext":"..."}}`          | Executa, injeta contexto no agente         |
| Negar                 | `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"motivo"}}` | Ferramenta bloqueada, agente recebe motivo |
| Pedir ao usuario      | `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","additionalContext":"..."}}`            | VS Code exibe dialogo de aprovacao         |
| Modificar input       | `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":{...}}}`               | Ferramenta executa com input modificado    |

**Regra de prioridade com multiplos hooks**: Se varios hooks PreToolUse retornarem decisoes
diferentes, o mais restritivo vence: `deny > ask > allow`.

---

#### PostToolUse

Campos adicionais alem dos universais:

| Campo           | Tipo   | Mutavel? | Descricao                                      |
| --------------- | ------ | -------- | ---------------------------------------------- |
| `tool_name`     | string | NAO      | Nome da ferramenta que acabou de executar      |
| `tool_input`    | object | NAO      | Input original da ferramenta (somente leitura) |
| `tool_response` | any    | NAO      | Resposta da ferramenta ao agente               |
| `tool_use_id`   | string | NAO      | Mesmo UUID do PreToolUse correspondente        |

**`tool_response`** -- o valor que a ferramenta retornou ao agente. Para `vscode_askQuestions`,
contem a resposta do usuario (campo `freeText`, `selected`, `skipped`). Para `run_in_terminal`,
contem o output do terminal. Para `read_file`, contem o conteudo do arquivo.

**Deteccao de `vscode_askQuestions`** (para rastrear SUBTURN):
```bash
if [ "$TOOL_NAME" = "vscode_askQuestions" ]; then
    # tool_response tem estrutura {answers: {<header>: {selected, freeText, skipped}}}
    FREE_TEXT=$(echo "$PAYLOAD" | jq -r '[.tool_response.answers // {} | to_entries[] | .value.freeText // ""] | join(" ")')
    SELECTED=$(echo "$PAYLOAD"  | jq -r '[.tool_response.answers // {} | to_entries[] | .value.selected // [] | .[]] | join(", ")')
    SKIPPED=$(echo "$PAYLOAD"   | jq -r '[.tool_response.answers // {} | to_entries[] | .value.skipped // false] | any')
fi
```

**Deteccao de close_key no PostToolUse** (unica localizacao onde a acao deve ocorrer):
```bash
# Carregar a close_key armazenada
STORED_KEY=$(jq -r '.close_key // empty' "$STATE_FILE")
if [ -n "$STORED_KEY" ] && echo "$FREE_TEXT" | grep -qF "$STORED_KEY"; then
    # Usuario digitou a close_key -> seta flag para stop.sh chamar session-close.sh
    # USAR update_state_bool (nao inline jq) -- pending_session_close e booleano no JSON
    update_state_bool "pending_session_close" "true"
    log_audit "sessionCloseAuthorized" "key_detected" "true"
fi
```

**Acesso bash**:
```bash
TOOL_NAME=$(echo "$PAYLOAD"     | jq -r '.tool_name')
TOOL_INPUT=$(echo "$PAYLOAD"    | jq -c '.tool_input')
TOOL_RESP=$(echo "$PAYLOAD"     | jq -c '.tool_response')
TOOL_USE_ID=$(echo "$PAYLOAD"   | jq -r '.tool_use_id')
```

**Outputs possiveis do hook `PostToolUse` (v2.0):**

| Decisao                    | Output JSON                                                                        | Efeito                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Continuar sem contexto     | `{}` ou sem output                                                                 | Segue fluxo normal                                                     |
| Injetar contexto adicional | `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"..."}}` | Injeta contexto no proximo request do agente                           |
| Bloquear continuidade      | `{"decision":"block","reason":"..."}`                                              | Interrompe a continuidade apos a ferramenta e retorna motivo ao agente |

> **Importante**: Em `PostToolUse`, o block usa `decision/reason` na **raiz** do JSON.
> O campo `additionalContext`, quando usado, fica em `hookSpecificOutput.additionalContext`.
> Nao misturar `decision` dentro de `hookSpecificOutput` para `PostToolUse`.

---

#### Stop (agentStop)

Campos adicionais alem dos universais:

| Campo              | Tipo    | Mutavel? | Descricao                                                           |
| ------------------ | ------- | -------- | ------------------------------------------------------------------- |
| `stop_hook_active` | boolean | NAO      | `true` se este disparo e resultado de um block anterior (anti-loop) |

**`stop_hook_active`** -- o campo mais critico deste hook. Deve ser verificado ANTES de qualquer
logica de bloqueio. Se `true`, o hook NAO deve retornar `decision: "block"` -- caso contrario, cria
loop infinito de bloqueios.

Sequencia correta:
```
stop_hook_active=false → logica normal (verificar se askQuestions foi chamado)
stop_hook_active=true  → encerrar sem bloquear (o agente ja foi punido/redirecionado)
```

**Acesso bash**:
```bash
STOP_ACTIVE=$(echo "$PAYLOAD" | jq -r '.stop_hook_active // false')

if [ "$STOP_ACTIVE" = "true" ]; then
    # Anti-loop: nao bloquear, apenas logar e sair
    exit 0
fi
```

**Output de bloqueio** (quando `stop_hook_active=false` e protocolo foi violado):
```bash
REASON="Turno encerrado sem chamar vscode_askQuestions. Protocolo TODO v9.0 violado."
# FORMATO CORRETO (v2.1): Stop usa hookSpecificOutput.decision/reason
# Use emit_stop_block do common.sh que ja garante este formato
emit_stop_block "$REASON"
# Formato equivalente expandido (para referencia):
# printf '{"hookSpecificOutput":{"hookEventName":"Stop","decision":"block","reason":%s},"systemMessage":%s}\n' "$ESCAPED" "$ESCAPED"
```

---

#### PreCompact

Campos adicionais alem dos universais:

| Campo     | Tipo   | Mutavel? | Descricao                                     |
| --------- | ------ | -------- | --------------------------------------------- |
| `trigger` | string | NAO      | Sempre `"auto"` quando compactacao automatica |

**Acesso bash**:
```bash
TRIGGER=$(echo "$PAYLOAD" | jq -r '.trigger // "auto"')
```

O hook deve salvar o estado critico antes da compactacao, pois o contexto sera reduzido pelo VS Code.

---

#### SubagentStart

Campos adicionais confirmados na documentacao oficial (marco/2026):

| Campo        | Tipo   | Mutavel? | Descricao                                              |
| ------------ | ------ | -------- | ------------------------------------------------------ |
| `agent_id`   | string | NAO      | Identificador unico do subagente (gerado pelo VS Code) |
| `agent_type` | string | NAO      | Nome do agente (ex: "Plan", "Explore", custom names)   |

> **CORRECAO v1.7**: A versao anterior assumia `tool_use_id` com base em dados empiricos do
> sistema antigo. A documentacao oficial de marco/2026 confirma `agent_id` e `agent_type`.

**Acesso bash**:
```bash
AGENT_ID=$(echo "$PAYLOAD"   | jq -r '.agent_id // empty')
AGENT_TYPE=$(echo "$PAYLOAD" | jq -r '.agent_type // empty')
```

**Output** (injetar contexto no subagente):
```bash
echo '{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":"Contexto para o subagente"}}'
```

---

#### SubagentStop

Campos adicionais confirmados na documentacao oficial (marco/2026):

| Campo              | Tipo    | Mutavel? | Descricao                                               |
| ------------------ | ------- | -------- | ------------------------------------------------------- |
| `agent_id`         | string  | NAO      | Mesmo `agent_id` do SubagentStart correspondente        |
| `agent_type`       | string  | NAO      | Nome do agente                                          |
| `stop_hook_active` | boolean | NAO      | `true` se ja continuando por block anterior (anti-loop) |

**Acesso bash**:
```bash
AGENT_ID=$(echo "$PAYLOAD"    | jq -r '.agent_id // empty')
AGENT_TYPE=$(echo "$PAYLOAD"  | jq -r '.agent_type // empty')
STOP_ACTIVE=$(echo "$PAYLOAD" | jq -r '.stop_hook_active // false')

if [ "$STOP_ACTIVE" = "true" ]; then
    exit 0  # Anti-loop: nao bloquear
fi
```

**Output para bloquear** (formato nivel RAIZ -- diferente do Stop do agente principal):
```bash
echo '{"decision":"block","reason":"Verificar resultados antes de encerrar subagente"}'
```

---

### 10.4 Tabela consolidada -- todos os campos por evento

> Atualizado v1.7 com dados da documentacao oficial de marco/2026.

| Campo              | SessionStart | UserPromptSubmit | PreToolUse | PostToolUse | Stop | PreCompact | SubagentStart | SubagentStop |
| ------------------ | ------------ | ---------------- | ---------- | ----------- | ---- | ---------- | ------------- | ------------ |
| `sessionId`        | sim          | sim              | sim        | sim         | sim  | sim        | sim           | sim          |
| `hookEventName`    | sim          | sim              | sim        | sim         | sim  | sim        | sim           | sim          |
| `timestamp`        | sim          | sim              | sim        | sim         | sim  | sim        | sim           | sim          |
| `cwd`              | sim          | sim              | sim        | sim         | sim  | sim        | sim           | sim          |
| `transcript_path`  | sim          | sim              | sim        | sim         | sim  | sim        | sim           | sim          |
| `source`           | sim          | nao              | nao        | nao         | nao  | nao        | nao           | nao          |
| `prompt`           | nao          | **sim**          | nao        | nao         | nao  | nao        | nao           | nao          |
| `tool_name`        | nao          | nao              | sim        | sim         | nao  | nao        | nao           | nao          |
| `tool_input`       | nao          | nao              | sim        | sim         | nao  | nao        | nao           | nao          |
| `tool_response`    | nao          | nao              | nao        | sim         | nao  | nao        | nao           | nao          |
| `tool_use_id`      | nao          | nao              | sim        | sim         | nao  | nao        | nao           | nao          |
| `stop_hook_active` | nao          | nao              | nao        | nao         | sim  | nao        | nao           | **sim**      |
| `trigger`          | nao          | nao              | nao        | nao         | nao  | sim        | nao           | nao          |
| `agent_id`         | nao          | nao              | nao        | nao         | nao  | nao        | **sim**       | **sim**      |
| `agent_type`       | nao          | nao              | nao        | nao         | nao  | nao        | **sim**       | **sim**      |

> **Campos em negrito**: atualizados ou adicionados na v1.7 (correcao de dados empiricos vs. doc oficial).
> `prompt` no UserPromptSubmit foi omitido na v1.5/1.6. SubagentStart/Stop agora com `agent_id`/`agent_type`
> (substituindo `tool_use_id`/`agentName`/`result` que eram dados do sistema antigo).

### 10.5 Mutabilidade -- o que pode ser alterado

De todos os campos acima, apenas **um** pode ser efetivamente modificado pelo hook:

| Campo        | Hook         | Como modificar                                | Efeito                                                   |
| ------------ | ------------ | --------------------------------------------- | -------------------------------------------------------- |
| `tool_input` | `PreToolUse` | Retornar `updatedInput` no hookSpecificOutput | VS Code substitui o input antes de executar a ferramenta |

Todos os outros campos sao **somente leitura** -- a plataforma os envia, os hooks podem ler,
mas nao podem alterar o que o VS Code enviou.

**O que os hooks PODEM fazer (alem de ler)**:
- Gravar em arquivos proprios (`session.json`, `audit.jsonl`)
- Retornar output JSON para influenciar o agente (via `hookSpecificOutput`, `systemMessage`)
- Bloquear ferramentas (`PreToolUse: permissionDecision: deny`)
- Bloquear o fim do turno (`Stop: decision: block`)
- Injetar contexto (`additionalContext`, `systemMessage`)

### 10.6 Compatibilidade de nomes -- VS Code vs Copilot CLI legado

A documentacao oficial de marco/2026 usa `sessionId` (camelCase) como nome de campo. Documentacao
interna older e dados empiricos do sistema antigo usam `session_id` (snake_case). Ambos foram
observados em producao.

| Campo no stdin     | Doc oficial VS Code (marco/2026) | GUIA interno / sistema antigo | Nota                                        |
| ------------------ | -------------------------------- | ----------------------------- | ------------------------------------------- |
| `sessionId`        | `sessionId`                      | `session_id`                  | Usar fallback: `.sessionId // .session_id`  |
| `hookEventName`    | `hookEventName`                  | idem                          | Consistente em todas as fontes              |
| `tool_name`        | `tool_name`                      | `tool_name`                   | Consistente                                 |
| `tool_input`       | `tool_input`                     | `tool_input`                  | Consistente                                 |
| `tool_use_id`      | `tool_use_id`                    | `tool_use_id`                 | Consistente                                 |
| `agent_id`         | `agent_id`                       | `tool_use_id` (ERRADO)        | Sistema antigo usava campo diferente        |
| `agent_type`       | `agent_type`                     | nao existia                   | Novo na doc oficial                         |
| `stop_hook_active` | `stop_hook_active`               | idem                          | Consistente                                 |
| `prompt`           | `prompt`                         | nao documentado antes         | Campo do UserPromptSubmit, confirmado agora |

> **Regra para os scripts**: Sempre usar fallback `jq -r '.sessionId // .session_id // empty'`
> para `sessionId`. Para demais campos, usar o nome da doc oficial como primario.

#### Nota sobre o campo `tool_name` -- camelCase vs snake_case (v2.0)

A documentacao oficial do VS Code (marco/2026) usa `tool_name` (snake_case) como campo do payload.
Porem, os exemplos de tools no proprio VS Code sao **camelCase**: `"editFiles"`, `"readFile"`,
`"runInTerminal"`. Ja os nomes empiricos do sistema de hooks atual (Parte 10.7) usam snake_case:
`"run_in_terminal"`, `"read_file"`, `"vscode_askQuestions"`.

**Importante**: o valor exato de `tool_name` no payload do hook depende de como o VS Code registra
internamente cada ferramenta. Este valor pode divergir entre versoes do Copilot Chat.

**Como verificar o nome real durante desenvolvimento:**
1. Abrir o **Agent Debug Panel** (gear icon → "Show Agent Logs" ou `Developer: Open Agent Debug Panel`)
2. Na aba **Logs**, clicar em qualquer chamada de ferramenta
3. O campo `Tool` exibido e o mesmo que chegara em `tool_name` no payload do hook
4. Alternativamente: usar o **Chat Debug View** (overflow menu → "Show Chat Debug View") e
   inspecionar a secao **Tool responses** para ver o nome exato
5. Ou ainda: logar `tool_name` em `pre-tool-use.sh` temporariamente para capturar os nomes reais

Os schemas da Parte 10.7 refletem os nomes empiricos mais comuns; ajustar conforme necessario apos
usar as ferramentas de debug para confirmar.

---

### 10.7 Schemas de `tool_input` por ferramenta (PreToolUse)

O campo `tool_input` e enviado pelo VS Code em `PreToolUse` **automaticamente** como parte do
payload de stdin. Ele reflete exatamente o que o agente passou na invocacao da ferramenta. Abaixo
os schemas de cada ferramenta principal, confirmados empiricamente:

#### run_in_terminal
```json
{
  "command": "npm run lint",
  "explanation": "Verificar qualidade do codigo",
  "goal": "Lint",
  "isBackground": false,
  "timeout": 30000
}
```
Campos obrigatorios: apenas `command`. Os demais sao opcionais.

Acesso bash:
```bash
CMD=$(echo "$PAYLOAD"     | jq -r '.tool_input.command // empty')
IS_BG=$(echo "$PAYLOAD"   | jq -r '.tool_input.isBackground // false')
TIMEOUT=$(echo "$PAYLOAD" | jq -r '.tool_input.timeout // 30000')
```

#### read_file
```json
{
  "filePath": "/workspaces/chatgpt-docker-puppeteer/src/main.js",
  "startLine": 1,
  "endLine": 50
}
```
Acesso bash:
```bash
FILE_PATH=$(echo "$PAYLOAD"  | jq -r '.tool_input.filePath // empty')
START_LINE=$(echo "$PAYLOAD" | jq -r '.tool_input.startLine // 1')
END_LINE=$(echo "$PAYLOAD"   | jq -r '.tool_input.endLine // 0')
```

#### replace_string_in_file / multi_replace_string_in_file
```json
{
  "filePath": "/workspaces/chatgpt-docker-puppeteer/src/main.js",
  "oldString": "texto a substituir",
  "newString": "texto novo"
}
```
Acesso bash:
```bash
FILE_PATH=$(echo "$PAYLOAD" | jq -r '.tool_input.filePath // empty')
# oldString e newString nao sao normalmente necessarios nos hooks
```

#### create_file
```json
{
  "filePath": "/workspaces/chatgpt-docker-puppeteer/novo-arquivo.md",
  "content": "conteudo do arquivo"
}
```

#### grep_search
```json
{
  "query": "padrao a buscar",
  "isRegexp": true,
  "includePattern": "src/**/*.js",
  "maxResults": 20
}
```

#### file_search
```json
{
  "query": "**/*.json",
  "maxResults": 10
}
```

#### semantic_search
```json
{
  "query": "texto para busca semantica"
}
```

#### list_dir
```json
{
  "path": "/workspaces/chatgpt-docker-puppeteer/src"
}
```

#### get_errors
```json
{
  "filePaths": ["/workspaces/chatgpt-docker-puppeteer/src/main.js"]
}
```

#### vscode_askQuestions
```json
{
  "questions": [
    {
      "header": "Proxima acao",
      "question": "O que fazer agora?",
      "allowFreeformInput": true,
      "options": [
        { "label": "Continuar", "description": "Prosseguir com o trabalho", "recommended": true },
        { "label": "Pausar" }
      ]
    }
  ]
}
```
Acesso bash para detectar Template F (proposta de encerramento de TURN) no PreToolUse:
```bash
if [ "$TOOL_NAME" = "vscode_askQuestions" ]; then
    QUESTIONS=$(echo "$PAYLOAD" | jq -c '.tool_input.questions // []')
    # Detectar se contem proposta de encerramento (Template F) -- apenas para logging
    # NOTA: a ACAO de encerrar ocorre no post-tool-use.sh quando o usuario RESPONDE com a close_key
    # No PreToolUse, so logamos a proposta; nao executamos nada
    CLOSE_TEXT=$(echo "$PAYLOAD" | jq -r '
        [(.tool_input.questions? // [])[]? | ((.header // "") + " " + (.question // ""))]
        | join(" ")
    ')
    if echo "$CLOSE_TEXT" | grep -qE 'ENCERRAR-[A-F0-9]{8}'; then
        IS_TEMPLATE_F=true
        # Logar "template_f_proposed" no audit -- nao agir ainda
    fi
fi
```
> **Separacao de responsabilidades**: PreToolUse detecta a *proposta* (agente exibiu close_key);
> PostToolUse detecta a *resposta* (usuario digitou a close_key). So o PostToolUse age.

#### manage_todo_list
```json
{
  "todoList": [
    { "id": 1, "title": "Tarefa 1", "status": "completed" },
    { "id": 2, "title": "Tarefa 2", "status": "in-progress" },
    { "id": 3, "title": "Chamar vscode_askQuestions", "status": "not-started" }
  ]
}
```
Acesso bash para verificar ultimo TODO:
```bash
if [ "$TOOL_NAME" = "manage_todo_list" ]; then
    LAST_TITLE=$(echo "$PAYLOAD" | jq -r '.tool_input.todoList[-1].title // empty')
    LAST_STATUS=$(echo "$PAYLOAD" | jq -r '.tool_input.todoList[-1].status // empty')
fi
```

#### runSubagent
```json
{
  "agentName": "Explore",
  "description": "Analise do codebase",
  "prompt": "Voce e um explorador. Analise o seguinte codigo..."
}
```
Acesso bash:
```bash
if [ "$TOOL_NAME" = "runSubagent" ]; then
    AGENT_NAME=$(echo "$PAYLOAD"  | jq -r '.tool_input.agentName // empty')
    DESCRIPTION=$(echo "$PAYLOAD" | jq -r '.tool_input.description // .tool_input.prompt // "(sem desc)"' | head -c 200)
fi
```

---

### 10.8 Schemas de `tool_response` por ferramenta (PostToolUse)

O campo `tool_response` e enviado pelo VS Code em `PostToolUse` **automaticamente** com o valor que
a ferramenta retornou ao agente. Sao dados somente de leitura: o hook nao pode modifica-los.

#### vscode_askQuestions (o mais critico para nosso sistema)
```json
{
  "answers": {
    "Proxima acao": {
      "selected": ["Continuar"],
      "freeText": "texto livre digitado pelo usuario",
      "skipped": false
    }
  }
}
```
Acesso bash:
```bash
if [ "$TOOL_NAME" = "vscode_askQuestions" ]; then
    RESP=$(echo "$PAYLOAD" | jq -c '.tool_response // {}')
    # Percorrer todas as respostas
    FREE_TEXT=$(echo "$RESP" | jq -r '[.answers // {} | to_entries[] | .value.freeText // ""] | join(" ")')
    SELECTED=$(echo "$RESP" | jq -r '[.answers // {} | to_entries[] | .value.selected // [] | .[]] | join(", ")')
    SKIPPED=$(echo "$RESP"  | jq -r '[.answers // {} | to_entries[] | .value.skipped // false] | any')

    # Deteccao da close_key (Template F respondido pelo usuario)
    # Esta e a acao principal: PostToolUse e onde o usuario JA respondeu
    STORED_KEY=$(read_field close_key 2>/dev/null || echo "")
    if [ -n "$STORED_KEY" ] && echo "$FREE_TEXT" | grep -qF "$STORED_KEY"; then
        # Usuario digitou a close_key -> autorizar encerramento do TURN com session close
        update_state "pending_session_close" "true"
        log_audit "sessionCloseAuthorized" "key_detected" "true"
    fi
fi
```
> **Onde detectar a close_key:** EXCLUSIVAMENTE no `PostToolUse` de `vscode_askQuestions`.
> O PreToolUse so ve a *proposta* (o agente exibiu a key); o PostToolUse ve a *resposta*
> (o usuario voltou a chave). So a resposta conta como autorizacao.

#### run_in_terminal
O `tool_response` contem o output do terminal como string ou objeto. O formato exato depende da
versao do VS Code:
```json
"output do terminal como string"
```
ou
```json
{ "output": "...", "exitCode": 0 }
```

#### read_file
```json
"conteudo do arquivo como string plana"
```
Normalmente uma string longa. Nao e comum parsear via hook; o agente recebe diretamente.

#### manage_todo_list
```json
"Successfully wrote todo list"
```
Ou mensagem de aviso como `"Warning: Large todo list (>10 items)."`. Acesso bash:
```bash
if [ "$TOOL_NAME" = "manage_todo_list" ]; then
    RESP_STR=$(echo "$PAYLOAD" | jq -r '.tool_response // empty')
    if echo "$RESP_STR" | grep -q "Successfully"; then
        TODO_WRITE_OK=true
    fi
fi
```

#### Campos gerais de tool_response

- **Tipo**: pode ser `string`, `object` ou `null` -- o hook deve usar `// null` como fallback
- **Tamanho**: pode ser muito grande (ex: conteudo de arquivo). Truncar com `head -c` se necessario
- **Nao modificavel**: o hook nao pode alterar a resposta que o agente ja recebeu

---

### 10.9 Campos oficiais -- SubagentStart e SubagentStop (REVISADO v1.7)

**CORRECAO**: A versao v1.6 baseava-se em dados empiricos do sistema antigo. A documentacao
oficial de marco/2026 confirma fields diferentes dos assumidos anteriormente.

**SubagentStart -- campos oficiais (doc VS Code, marco/2026):**

```json
{
  "hookEventName": "SubagentStart",
  "sessionId": "8c19c988-b622-44ee-8207-717464587212",
  "timestamp": "2026-03-14T11:44:01.912Z",
  "cwd": "/workspaces/chatgpt-docker-puppeteer",
  "transcript_path": "/path/to/transcript.json",
  "agent_id": "subagent-456",
  "agent_type": "Explore"
}
```

| Campo        | Tipo   | Descricao                                              |
| ------------ | ------ | ------------------------------------------------------ |
| `agent_id`   | string | Identificador unico do subagente (gerado pelo VS Code) |
| `agent_type` | string | Nome do agente (ex: "Plan", "Explore", custom names)   |

**SubagentStop -- campos oficiais (doc VS Code, marco/2026):**

```json
{
  "hookEventName": "SubagentStop",
  "sessionId": "8c19c988-b622-44ee-8207-717464587212",
  "timestamp": "...",
  "cwd": "...",
  "transcript_path": "...",
  "agent_id": "subagent-456",
  "agent_type": "Explore",
  "stop_hook_active": false
}
```

| Campo              | Tipo    | Descricao                                                           |
| ------------------ | ------- | ------------------------------------------------------------------- |
| `agent_id`         | string  | Identificador unico do subagente (correlaciona com SubagentStart)   |
| `agent_type`       | string  | Nome do agente                                                      |
| `stop_hook_active` | boolean | Anti-loop: `true` se subagente ja estava continuando por block prev |

**Correlacao SubagentStart <-> SubagentStop**: usar `agent_id` (e nao `tool_use_id` como assumido
na v1.6). O `agent_id` e o identificador canonico do subagente para correlacionar inicio e fim.

**Implicacao pratica para os scripts:**
- Em `subagent-start.sh`: ler `agent_id` + `agent_type` (mais `sessionId` universal).
  Ignorar `tool_use_id` que era assumido na v1.6 mas nao esta na doc oficial.
- Em `subagent-stop.sh`: ler `agent_id` + `agent_type` + `stop_hook_active`.
  Verificar `stop_hook_active` antes de qualquer `decision: "block"`.
- Correlacao: `agent_id` do SubagentStop bate com o `agent_id` do SubagentStart correspondente.

**Acesso bash**:
```bash
# SubagentStart
AGENT_ID=$(echo "$PAYLOAD"   | jq -r '.agent_id // empty')
AGENT_TYPE=$(echo "$PAYLOAD" | jq -r '.agent_type // empty')

# SubagentStop (adicional)
STOP_ACTIVE=$(echo "$PAYLOAD" | jq -r '.stop_hook_active // false')
if [ "$STOP_ACTIVE" = "true" ]; then
    exit 0  # Anti-loop
fi
```

---

### 10.10 Helpers bash para leitura de campos (para uso no common.sh)

Funcoes utilitarias que o `common.sh` deve exportar para que todos os scripts de hook possam
ler os campos da plataforma de forma consistente e defensiva:

```bash
# common.sh -- helpers de leitura do payload (v1.7)

# Ler TODOS os campos universais de uma vez
# Uso: load_hook_payload  (chama imediatamente ao iniciar o script, ANTES de qualquer subshell)
load_hook_payload() {
    PAYLOAD=$(cat)
    # Fallback defensivo: doc oficial usa sessionId (camelCase), GUIA interno usa session_id
    SESSION_ID=$(echo "$PAYLOAD"  | jq -r '.sessionId // .session_id // empty')
    HOOK_EVENT=$(echo "$PAYLOAD"  | jq -r '.hookEventName // empty')
    TIMESTAMP=$(echo "$PAYLOAD"   | jq -r '.timestamp // empty')
    HOOK_CWD=$(echo "$PAYLOAD"    | jq -r '.cwd // empty')
    TRANSCRIPT=$(echo "$PAYLOAD"  | jq -r '.transcript_path // empty')
    export PAYLOAD SESSION_ID HOOK_EVENT TIMESTAMP HOOK_CWD TRANSCRIPT
}
# Nota: usar HOOK_CWD em vez de CWD para nao colidir com a variavel de ambiente CWD do shell

# Ler campos de ferramentas (PreToolUse/PostToolUse)
load_tool_fields() {
    TOOL_NAME=$(echo "$PAYLOAD"     | jq -r '.tool_name // empty')
    TOOL_INPUT=$(echo "$PAYLOAD"    | jq -c '.tool_input // {}')
    TOOL_RESPONSE=$(echo "$PAYLOAD" | jq -c '.tool_response // null')
    TOOL_USE_ID=$(echo "$PAYLOAD"   | jq -r '.tool_use_id // empty')
    export TOOL_NAME TOOL_INPUT TOOL_RESPONSE TOOL_USE_ID
}

# Ler campo especifico do Stop
load_stop_fields() {
    STOP_ACTIVE=$(echo "$PAYLOAD" | jq -r '.stop_hook_active // false')
    export STOP_ACTIVE
}

# Ler campos do PreCompact
load_compact_fields() {
    COMPACT_TRIGGER=$(echo "$PAYLOAD" | jq -r '.trigger // "auto"')
    export COMPACT_TRIGGER
}

# Ler campos do SubagentStart / SubagentStop
load_subagent_fields() {
    AGENT_ID=$(echo "$PAYLOAD"    | jq -r '.agent_id // empty')
    AGENT_TYPE=$(echo "$PAYLOAD"  | jq -r '.agent_type // empty')
    # stop_hook_active so existe no SubagentStop, mas ler defensivamente
    STOP_ACTIVE=$(echo "$PAYLOAD" | jq -r '.stop_hook_active // false')
    export AGENT_ID AGENT_TYPE STOP_ACTIVE
}

# Ler campo prompt do UserPromptSubmit
load_prompt_field() {
    PROMPT_TEXT=$(echo "$PAYLOAD" | jq -r '.prompt // empty')
    export PROMPT_TEXT
}

# Ler tool_input.command (run_in_terminal)
get_terminal_command() {
    echo "$PAYLOAD" | jq -r '.tool_input.command // empty'
}

# Ler tool_input.filePath (read_file, replace_string_in_file, etc.)
get_file_path() {
    echo "$PAYLOAD" | jq -r '.tool_input.filePath // .tool_input.path // empty'
}

# Ler tool_input.todoList[-1].title (manage_todo_list)
get_last_todo_title() {
    echo "$PAYLOAD" | jq -r '.tool_input.todoList[-1].title // empty'
}

# Ler tool_input.description do runSubagent
get_subagent_description() {
    echo "$PAYLOAD" | jq -r '.tool_input.description // .tool_input.prompt // "(sem desc)"' | head -c 200
}

# Ler todas as respostas do vscode_askQuestions como texto concat (para detectar close_key)
get_askquestions_freetext() {
    echo "$PAYLOAD" | jq -r '[.tool_response.answers // {} | to_entries[] | .value.freeText // ""] | join(" ")'
}

# Verificar se e um possivel Template F (proposta de encerramento de TURN via close_key)
# Verificacao no PreToolUse (antes da resposta do usuario -- detecta intenção)
is_template_f_proposal() {
    local text
    text=$(echo "$PAYLOAD" | jq -r \
        '[(.tool_input.questions? // [])[]? | ((.header // "") + " " + (.question // ""))]
        | join(" ")')
    echo "$text" | grep -qiE 'ENCERRAR-[A-F0-9]{8}'
}

# Verificar se a resposta do usuario contem a close_key (PostToolUse de vscode_askQuestions)
has_close_key() {
    local free_text
    free_text=$(get_askquestions_freetext)
    local stored_key
    stored_key=$(read_field close_key 2>/dev/null || echo "")
    [ -n "$stored_key" ] && echo "$free_text" | grep -qF "$stored_key"
}

# Construir JSON de audit de forma segura (sem injection)
# ASSINATURA CANONICA (identica a Parte 4.3): log_audit "event" [key value ...]
# Ex: log_audit "turnStart" "turn" "5" "section" "inicio"
log_audit() {
    # Uso: log_audit "event" [key1 value1 key2 value2 ...]
    # Todos os argumentos apos o evento sao pares key/value posicionais
    local event="$1"; shift
    local ts
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    local json_obj
    json_obj=$(jq -n \
        --arg ts "$ts" \
        --arg ev "$event" \
        --arg sid "${SESSION_ID:-unknown}" \
        '{ts: $ts, event: $ev, session_id: $sid}')
    # Adicionar campos extras via jq (seguro contra injection)
    while [ "$#" -ge 2 ]; do
        local k="$1" v="$2"; shift 2
        json_obj=$(printf '%s' "$json_obj" | jq --arg k "$k" --arg v "$v" '. + {($k): $v}')
    done
    printf '%s\n' "$json_obj" >> "$AUDIT_FILE"
}
```

> **Regra de ouro para todos os scripts**: Chamar `load_hook_payload` como **primeira linha**
> apos o shebang e comentarios. Nunca chamar `cat` depois disso -- o stdin ja foi consumido.
>
> **Encoding**: Scripts que lidam com texto do usuario (paths com acentos, mensagens UTF-8)
> devem ter `export LANG=C.UTF-8` ou `export LC_ALL=C.UTF-8` no topo para evitar erros de
> bytes invalidos em `jq` e `grep`.

---

<a id="parte-11"></a>
## Parte 11 -- Ferramentas de debug nativas do VS Code para hooks

### Sumario da Parte 11

- 11.1 Canal "GitHub Copilot Chat Hooks"
- 11.2 Agent Debug Panel
- 11.3 Chat Debug View
- 11.4 Fluxo recomendado de debug
- 11.5 Troubleshooting rapido
- 11.6 `additionalContext` (guia definitivo)

Esta parte documenta as ferramentas de debug nativas do VS Code Copilot Chat que sao uteis
durante o desenvolvimento e diagnostico do sistema de hooks. Todas as informacoes sao baseadas
na documentacao oficial de marco/2026.

### 11.1 Canal de output "GitHub Copilot Chat Hooks"

**O que e:** Canal de log no painel Output do VS Code (View → Output → selecionar "GitHub Copilot Chat Hooks").

**O que mostra:**
- Quais arquivos de hooks foram carregados (util para diagnosticar `chat.hookFilesLocations`)
- Quais hooks foram executados em cada evento (com timestamp)
- Erros de execucao de hooks (ex: script nao encontrado, timeout, JSON invalido no stdout)

**Como abrir:** View → Output → dropdown "GitHub Copilot Chat Hooks" (aparece quando hooks existem)
ou: View Logs → "Load Hooks" para ver os hooks carregados.

**Casos de uso:**
- Hook nao esta sendo disparado → verificar se esta listado aqui
- Script com erro de parse JSON → error aparece neste canal
- Verificar timeout: se hook demorar mais que o configurado, aparece aviso aqui
- Confirmar que `hooks.json` na path correta foi carregado

---

### 11.2 Agent Debug Panel (Preview)

**O que e:** Painel que exibe log cronologico de todos os eventos do agente na sessao atual.

**Como abrir:**
- Gear icon (⚙) no Chat view → "Show Agent Logs"
- Ou: `Developer: Open Agent Debug Panel` (Command Palette)

**Tres visualizacoes:**

#### Logs (principal)
- Lista cronologica de todos os eventos: tool calls, LLM requests, prompt file discovery, erros
- Pode alternar entre vista flat e vista em arvore (para subagentes)
- Filtro por tipo de evento (ferramenta, LLM, erro, etc.)
- Cada entrada mostra: nome da ferramenta, timestamp, duration, resultado
- **Util para hooks**: ver o valor exato de `tool_name` que chegara no payload PreToolUse/PostToolUse

#### Summary
- Agregados da sessao: total de tool calls, token usage, error count, duration total
- Util para estimar volume de eventos que o sistema de hooks tera que processar

#### Agent Flow Chart
- Visualizacao grafica da sequencia de eventos entre agentes e subagentes
- Pan e zoom; clicar em nos para ver detalhes
- Util para visualizar o ciclo SESSION > TURN > SUBTURN e a interacao com subagentes

**Funcionalidade "Attach debug events to chat":**
- Icone sparkle (✨) no Agent Debug Panel abre uma view de Chat com snapshot dos logs como contexto
- Permite perguntar ao agente sobre: token usage, quais customizacoes foram carregadas,
  quais tool calls ocorreram, timing de cada operacao
- Util para: "por que o assistente usou este contexto?" ou "qual ferramenta levou mais tempo?"

**Limitacoes importantes:**
- Disponivel apenas para sessoes de chat LOCAL (nao para sessoes remotas ou GitHub.com)
- Logs NAO sao persistidos entre sessoes -- sao dados em memoria durante a sessao

---

### 11.3 Chat Debug View

**O que e:** View que exibe os detalhes RAW de cada request LLM enviado pelo Copilot Chat.

**Como abrir:**
- Overflow menu (...) no Chat view → "Show Chat Debug View"
- Ou: `Developer: Show Chat Debug View` (Command Palette)

**O que mostra (por request LLM):**

| Secao          | Conteudo                                                        | Util para hooks                                               |
| -------------- | --------------------------------------------------------------- | ------------------------------------------------------------- |
| System prompt  | Instrucoes de comportamento do AI (instructions, skills, hooks) | Verificar se `additionalContext` do SessionStart aparece aqui |
| User prompt    | Texto exato enviado ao modelo (resolucao de #-mentions)         | Confirmar que prompt do usuario chegou correto                |
| Context        | Arquivos, simbolos, itens de contexto                           | Verificar quais arquivos foram incluidos no contexto          |
| Response       | Resposta completa do modelo (incluindo raciocinio)              | Ver raciocinio por tras de decisoes do agente                 |
| Tool responses | Inputs e outputs de todas as ferramentas                        | Inspecionar payload PostToolUse; ver resposta de MCP servers  |

**Casos de uso criticos para desenvolvimento de hooks:**

1. **Verificar `additionalContext` do SessionStart:**
   - Abrir Chat Debug View → System prompt
   - Confirmar que o texto injetado pelo `session-start.sh` via `additionalContext` aparece
   - Se nao aparecer: verificar output do script (formato JSON correto?) e canal de hooks
   - Exemplo: depois de iniciar sessao, ver se "Sessao iniciada. Leia o briefing..." esta la

2. **Verificar resposta do `vscode_askQuestions`:**
   - Abrir Chat Debug View → Tool responses
   - Encontrar a chamada de `vscode_askQuestions`
   - Ver estrutura exata de `tool_response.answers` que chegara no PostToolUse
   - Util para calibrar a deteccao de `close_key` e `freeText`

3. **Verificar payload de `updatedInput` (PreToolUse):**
   - Se `pre-tool-use.sh` modifica o input via `updatedInput`
   - Chat Debug View → Tool responses mostra o input modificado que a ferramenta recebeu
   - Comparar com o input original para confirmar que a modificacao funcionou

4. **Encontrar schema de ferramenta para `updatedInput`:**
   - Documentacao oficial sugere: "open the agent logs and find the logged tool schema"
   - Agent Debug Panel → Logs → clicar na chamada de ferramenta → ver schema
   - Isso permite saber quais campos sao validos em `updatedInput` para aquela ferramenta

---

### 11.4 Fluxo recomendado de debug durante desenvolvimento

Ao desenvolver ou depurar o sistema de hooks, seguir esta ordem:

```
1. Canal "GitHub Copilot Chat Hooks"
   -> Confirmar que hooks.json foi carregado
   -> Ver se o script foi executado para o evento esperado
   -> Capturar erros de execucao (JSON invalido, script nao encontrado, timeout)

2. Agent Debug Panel → Logs
   -> Ver o valor exato de tool_name para cada ferramenta
   -> Confirmar sequencia de eventos (SubagentStart → SubagentStop, etc.)
   -> Verificar se o hook disparou no momento certo do ciclo TURN

3. Chat Debug View → System prompt
   -> Verificar se additionalContext do SessionStart chegou ao agente
   -> Verificar se systemMessage do Stop block chegou como instrucao

4. Chat Debug View → Tool responses
   -> Verificar payload exato de vscode_askQuestions.tool_response
   -> Verificar schema de tool_input para calibrar updatedInput
   -> Confirmar que close_key aparece no freeText esperado

5. Agent Debug Panel → Attach to chat (icone sparkle)
   -> Usar o agente para analisar logs de forma interativa
   -> "Quantos tokens foram usados nesse turno?"
   -> "Quais arquivos de instrucao foram carregados?"
```

---

### 11.5 Troubleshooting rapido de hooks

| Sintoma                         | Ferramenta                                | O que verificar                                                                                                           |
| ------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Hook nao dispara                | Canal "Hooks" + `chat.hookFilesLocations` | hooks.json na path certa? Script tem `chmod +x`?                                                                          |
| Decision:block ignorado         | Chat Debug View → System prompt           | JSON do stdout e valido? `Stop` usa `hookSpecificOutput.decision`; `SubagentStop` e `PostToolUse` usam `decision` na raiz |
| `additionalContext` nao aparece | Chat Debug View → System prompt           | Formato correto: `{"hookSpecificOutput":{"hookEventName":"...","additionalContext":"..."}}`                               |
| Script trava (timeout)          | Canal "Hooks"                             | Timeout configurado no hooks.json e suficiente? Script tem loop infinito?                                                 |
| `updatedInput` nao funciona     | Chat Debug View → Tool responses          | Formato do `updatedInput` bate com o schema da ferramenta?                                                                |
| `close_key` nao detectada       | Chat Debug View → Tool responses          | Ver campo exato de `tool_response.answers[*].freeText` no PostToolUse                                                     |

---

### 11.6 `additionalContext` -- guia definitivo (doc oficial)

Esta secao consolida, de forma objetiva, **como o `additionalContext` funciona no VS Code** e
como aplicar corretamente no sistema de hooks.

#### 11.6.1 O que e

`additionalContext` e um campo textual usado para **injetar contexto extra no modelo** sem
alterar diretamente a resposta do hook para bloquear/parar fluxo.

- Nao e um "novo prompt do usuario".
- Nao substitui `systemMessage`.
- Nao executa acao por si so (e contexto, nao decisao).

#### 11.6.2 Onde pode ser usado (oficial)

Conforme documentacao oficial de hooks (mar/2026), `additionalContext` aparece nestes outputs:

1. **SessionStart output**
   - `hookSpecificOutput.hookEventName = "SessionStart"`
   - `hookSpecificOutput.additionalContext = "..."`
   - Efeito: contexto inicial da sessao.

2. **SubagentStart output**
   - `hookSpecificOutput.hookEventName = "SubagentStart"`
   - `hookSpecificOutput.additionalContext = "..."`
   - Efeito: contexto adicional para o subagente que acabou de iniciar.

3. **PreToolUse output**
   - `hookSpecificOutput.additionalContext = "..."`
   - Pode coexistir com `permissionDecision`, `permissionDecisionReason`, `updatedInput`.
   - Efeito: contexto para o modelo no processamento daquele fluxo de ferramenta.

4. **PostToolUse output**
   - `hookSpecificOutput.hookEventName = "PostToolUse"`
   - `hookSpecificOutput.additionalContext = "..."`
   - Pode coexistir com `decision/reason` (que ficam na raiz no PostToolUse).
   - Efeito: contexto injetado na conversa apos a ferramenta executar.

#### 11.6.3 Onde NAO deve ser usado

- **Stop**: o contrato oficial de Stop prioriza `hookSpecificOutput.decision/reason` para block.
  `additionalContext` nao e campo documentado para Stop.
- **SubagentStop**: contrato oficial de block e na raiz (`decision/reason`), sem `additionalContext`
  documentado.
- **UserPromptSubmit** e **PreCompact**: usam formato comum; `additionalContext` nao e campo
  especifico documentado para esses eventos.

#### 11.6.4 Como esse contexto e adicionado ao modelo

Fluxo pratico:

1. O hook imprime JSON valido no `stdout`.
2. O VS Code parseia esse JSON.
3. Se houver `hookSpecificOutput.additionalContext` valido para o evento, ele e incorporado ao
   contexto da conversa/modelo.
4. Voce consegue verificar isso no **Chat Debug View** (secao *System prompt* e, dependendo do
   caso, *Context*) e no **Agent Debug Panel** (logs de eventos/ferramentas).

#### 11.6.5 O que pode (e deve) ser colocado em `additionalContext`

Boas praticas recomendadas:

- Resumo curto de politicas operacionais (ex: "nunca rodar script X via run_in_terminal").
- Metadados de sessao (ex: branch, modo strict habilitado, estado de validacao).
- Restricoes de seguranca (ex: "arquivos sensiveis exigem aprovacao manual").
- Contexto de dominio relevante e estavel (ex: convencoes de naming e gates obrigatorios).

Evitar:

- Segredos (tokens, chaves, credenciais).
- Payloads gigantes (logs extensos, dumps inteiros) -- limite oficial nao e claramente documentado.
- Texto ambiguo/conflitante com regras oficiais.
- Conteudo volatil que muda a cada evento sem necessidade.

#### 11.6.6 Exemplo valido (PostToolUse)

```json
{
  "decision": "block",
  "reason": "Pos-validacao falhou",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Corrija os erros de lint no arquivo alterado antes de prosseguir."
  }
}
```

#### 11.6.7 Exemplo invalido (Stop com additionalContext fora de contrato)

```json
{
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "additionalContext": "...",
    "decision": "block",
    "reason": "..."
  }
}
```

No Stop, esse formato acima pode gerar comportamento indefinido para `additionalContext`, pois a
doc oficial nao o define como campo valido para esse evento. Para Stop, usar o contrato oficial de
block e, se necessario, complementar com `systemMessage`.

#### 11.6.8 Como validar no debug (passo a passo)

1. Rodar um hook que emite `additionalContext`.
2. Abrir **Chat Debug View** → verificar *System prompt*.
3. Abrir **Agent Debug Panel (Logs)** → confirmar evento/hook executado e payload processado.
4. Se nao aparecer:
   - conferir JSON no stdout (parse valido)
   - conferir `hookEventName` correto
   - conferir se o evento suporta `additionalContext`
   - conferir canal **GitHub Copilot Chat Hooks** no Output

> **Referencia oficial consultada**:
> - Hooks: `https://code.visualstudio.com/docs/copilot/customization/hooks`
> - Chat Debug: `https://code.visualstudio.com/docs/copilot/chat/chat-debug-view`
> - Troubleshooting: `https://code.visualstudio.com/docs/copilot/troubleshooting`

> **Security note:** O agente pode potencialmente modificar os proprios scripts de hook via
> ferramentas de edicao de arquivo (ex: `replace_string_in_file`), a menos que o repositorio
> esteja protegido. A setting `chat.tools.edits.autoApprove` controla aprovacao automatica de
> edicoes. Em producao, proteger os scripts de hook com revisao obrigatoria.

---

<a id="historico-de-versoes"></a>
## Historico de versoes

| Versao | Data       | Alteracao                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0    | 2026-03-17 | Criacao inicial do plano                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 1.1    | 2026-03-17 | Secao "quando cada hook dispara" detalhada; estrutura reorganizada em Partes; apenas scripts automaticos no escopo principal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 1.2    | 2026-03-17 | Parte 4 refatorada: principio "todo script tem lib", mapa script→lib, arvore completa; Secao 4.3 common.sh com todas as funcoes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1.3    | 2026-03-17 | Parte 2B adicionada: hierarquia SESSION/TURN/SUBTURN. SECTION eliminada do escopo inicial. SUBTURN definido como Opcao B (cada vscode_askQuestions + resposta). Schema session.json atualizado com campos de SUBTURN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 1.4    | 2026-03-17 | Historico de versoes adicionado; documentacao de violacao de protocolo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 1.5    | 2026-03-17 | Parte 10 adicionada: referencia completa de variaveis automaticas da plataforma (campos por evento, acesso bash, mutabilidade, tabela consolidada, compatibilidade de nomes)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 1.6    | 2026-03-17 | Parte 10 expandida: secoes 10.7 (tool_input schemas por ferramenta), 10.8 (tool_response schemas), 10.9 (investigacao SubagentStart/Stop), 10.10 (helpers bash para common.sh)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 1.7    | 2026-03-17 | Correcoes abrangentes (27 pontos identificados em revisao geral): (1) sessionId como campo oficial camelCase; (2) agent_id + agent_type para SubagentStart/Stop (cancelando tool_use_id assumido); (3) stop_hook_active no SubagentStop; (4) prompt no UserPromptSubmit; (5) continue/stopReason/systemMessage como outputs comuns; (6) close_key semantica corrigida -- autoriza encerramento de TURN, nunca de SUBTURN, via fluxo PostToolUse->pending_session_close->stop.sh->session-close.sh; (7) ask_questions_called setado no PostToolUse (apos resposta), nao no PreToolUse; (8) state.strict_turn_close hardcoded como true e documentado no schema; (9) pending_session_close adicionado ao schema; (10) session-close.sh especificado (Parte 6.8); (11) zero state especificado (Parte 5.3); (12) session-briefing.md template especificado (Parte 5.4); (13) RECONNECT bootstrap no user-prompt-submit.sh (6.4); (14) tabela de eventos de auditoria por script (6.9); (15) emit_stop_block com systemMessage; (16) log_audit via jq --arg (prevencao de injection); (17) SubagentStop anti-loop com stop_hook_active; (18) Parte 7 refatorada com TDD (smoke-test em F1); (19) Parte 9 atualizada (resolvidas e abertas); (20) Parte 10.8 close_key no PostToolUse com pending_session_close; (21) Parte 10.7 Template F proposta vs resposta esclarecida; (22) HOOK_CWD ao inves de CWD no common.sh; (23) UTF-8/LANG documentado; (24) confusao ask_questions_this_turn vs ask_questions_called resolvida                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 1.8    | 2026-03-17 | Segunda revisao geral (15 pontos novos identificados): (1) Parte 2B.7 NOVA -- encerramento abrupto de TURN (crash/VS Code fechado): cenarios, algoritmo de heal de turn orfao, threshold 1h, logica de reset de pending_session_close; (2) update_nested_state: helper separado para campos aninhados (current_turn.*, session_stats.*, etc.) -- update_state plano era insuficiente; (3) emit_stop_block: clareza sobre obrigatoriedade de jq -Rs para escapar reason; (4) user-prompt-submit.sh: adicionado passo 2 de deteccao de turn orfao (age > 1h + reset de pending_session_close); (5) session-close.sh: adicionado passo 0 de idempotencia (guard contra crash apos ended_at gravado); (6) pre-tool-use.sh: protecao de session-close ampliada para cobrir paths absolutos e variantes de nome; (7) tabela 2B.1 SESSION corrigida (quem encerra: session-close.sh chamado por stop.sh); (8) stop.sh: removido passo 10 incorreto de atualizacao de briefing (briefing e responsabilidade do user-prompt-submit.sh); (9) tabela 6.9 atualizada: turnEnd_orphaned adicionado, preToolUse removido do log padrao; (10) Parte 5.5 NOVA -- spec de pending-tasks.md (formato, quem le, quem escreve); (11) Parte 5.6 NOVA -- template de session-final-report.md; (12) arvore de diretorios 4.2 atualizada (session-final-report.md, nota sobre briefing re-gerado por user-prompt-submit); (13) Parte 9 atualizada: update_nested_state e pending-tasks resolvidos, 8 novas questoes abertas (threshold orfao, criterio por contagem, compliance threshold, tools_total semantica, timeout defensivo, additionalContext tamanho limite, SessionStart multiplo); (14) session-close.sh 6.8 doc atualizada mencionando padrão de bloqueio amplo; (15) nota sobre volume de preToolUse (log apenas eventos especiais, nao todas as ferramentas)                                                                                                                                                                                                                                                                                                                                                               |
| 1.9    | 2026-03-17 | Terceira revisao geral (15 pontos novos identificados e 13 correcoes aplicadas): (1) log_audit: assinatura canonica unificada (posicional, sem =) e implementacao segura via jq -n --arg em 4.3 -- versao antiga por concatenacao de strings removida; (2) emit_stop_block/emit_permission_deny/emit_post_tool_block: todas as funcoes de output JSON agora usam jq -Rs . para escaping -- corrigida versao insegura na 4.3; (3) update_state_bool: novo helper para campos de raiz booleanos (pending_session_close, strict_turn_close) -- update_state com --arg produzia string "true" em vez de booleano true; (4) tabela de funcoes de estado atualizada com update_state_bool e esclarecimento de quando usar cada helper; (5) stop.sh passo 6: nota explicando que turn_count sera >= 1 quando Stop dispara (user-prompt-submit.sh incrementa antes); o passo e safety guard raro, nao dead code trivial; (6) stop.sh passos 8-9: update_nested_state e update_state_bool mencionados explicitamente nos comentarios de acao; (7) session-close.sh passo 0: condicao de idempotencia corrigida (ended_at != null e suficiente -- nao requer pending_session_close=false simultaneamente); (8) session-close.sh 6.8: ENCODING documentado (LANG=C.UTF-8); (9) pre-tool-use.sh / session-close.sh: clarificacao que o bloqueio do pre-tool-use.sh e especifico para chamadas do agente via run_in_terminal -- chamadas internas entre scripts nao passam por PreToolUse; (10) hooks.json: cwd e paths esclarecidos -- hooks.json fica em .github/hooks/, entao ./scripts/ resolve para .github/hooks/scripts/; scripts usam ${BASH_SOURCE[0]} para HOOK_DIR robusto; (11) Parte 7 (F1): common.sh agora menciona update_state_bool e update_nested_state corretamente; (12) user-prompt-submit.sh 6.4: passo 2 (orphan) esclarecido -- current_turn nao precisa de reset manual pois o passo 4 sobrescreve todos os campos; (13) Parte 9: 2 novas questoes abertas (LANG=C.UTF-8 padronizacao e smoke-test de update_state_bool); (14) Parte 10.8 (PostToolUse): close_key detection atualizada para usar update_state_bool; (15) Parte 10.10: log_audit unificada com assinatura posicional e printf seguro |
| 2.0    | 2026-03-17 | Quarta revisao geral (chat debug + doc oficial): (1) `hooks.json` corrigido para paths relativos a raiz do repositorio (`.github/hooks/scripts/...`) e nota de `cwd` oficial; (2) adicionada referencia a `chat.hookFilesLocations`; (3) adicionada nota sobre agent-scoped hooks em `.agent.md`; (4) refinado contrato de outputs por evento: `Stop` em `hookSpecificOutput.decision/reason`, `PostToolUse` e `SubagentStop` com `decision/reason` na raiz; (5) tabela da Parte 3 corrigida para `Stop block output` oficial; (6) adicionada Parte 11 completa com `GitHub Copilot Chat Hooks` output channel, Agent Debug Panel e Chat Debug View; (7) adicionada orientacao pratica para validar `tool_name` real (camelCase vs snake_case) via Agent Debug/Chat Debug; (8) adicionada tabela de outputs possiveis de `PostToolUse` incluindo `additionalContext` em `hookSpecificOutput`; (9) security note explicitada sobre risco de edicao dos proprios scripts de hook e `chat.tools.edits.autoApprove`; (10) validacao de timeout padrao 30s mantida conforme doc oficial.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2.1    | 2026-03-17 | Quinta revisao focada em `additionalContext`: (1) nova secao 11.6 com explicacao completa de semantica, ciclo de injecao e validacao no Chat Debug/Agent Logs; (2) mapeamento oficial de eventos que suportam `additionalContext` (SessionStart, SubagentStart, PreToolUse, PostToolUse); (3) mapeamento de eventos sem suporte documentado (`Stop`, `SubagentStop`, `UserPromptSubmit`, `PreCompact`); (4) diretrizes praticas de conteudo (o que incluir/evitar, incluindo risco de segredos e payload grande); (5) exemplos validos/invalidos de payload e troubleshooting dedicado.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2.2    | 2026-03-17 | Reorganizacao estrutural do documento: (1) adicionado indice completo de Partes/Subpartes no topo; (2) adicionado guia de leitura por objetivo (contrato, implementacao, debug); (3) normalizada a numeracao da Parte 4 com `hooks.json` movido para **4.4** (evitando duplicidade com 4.1); (4) melhorada escaneabilidade para navegacao rapida sem alterar contratos tecnicos.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2.3 (auditoria) | 2026-03-19 | Auditoria geral do sistema concluída: 62 gaps identificados (9 CRÍTICOS, 23 ALTOS, 22 MÉDIOS, 8 BAIXOS). Ver [AUDITORIA-GERAL-HOOKS-2026-03-19.md](AUDITORIA-GERAL-HOOKS-2026-03-19.md) para lista completa com descrição, localização, severidade e proposta de correção. |

---

## Auditoria Geral do Sistema

Ver relatório completo em **[AUDITORIA-GERAL-HOOKS-2026-03-19.md](AUDITORIA-GERAL-HOOKS-2026-03-19.md)** — 62 gaps identificados: bugs silenciosos, módulos v2.x ociosos (não integrados), enforcement desativado em stop-lib.sh, campos de state sem enforcement, instruções ao agente desatualizadas, e gaps de cobertura de testes para módulos v2.2-v2.5.
