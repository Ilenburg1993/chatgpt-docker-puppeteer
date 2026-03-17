# Briefing de Sessão — 2026-03-17T16:21:48Z

> **Para o agente de IA:** Este arquivo é gerado automaticamente pelo hook `sessionStart`.
> Leia-o como primeiro ato de toda sessão, antes de qualquer ação.
> Após lê-lo, **invoque `vscode_askQuestions`** com o Template E (Session Kickoff)
> para definir com o usuário o rumo desta sessão.

---

## ╔══ PROTOCOLO DE ENCERRAMENTO — LEITURA OBRIGATÓRIA ══╗

> **SESSION ≠ SECTION ≠ TURN — distinção crítica para o agente LLM**

| Conceito    | Encerra como?                           | Autorização    |
|-------------|------------------------------------------|----------------|
| **TURN**    | Com `vscode_askQuestions` como último ato | **OBRIGATÓRIA** |
| **SECTION** | `bash start-section.sh "nome"` (autônomo)| **Nenhuma**    |
| **SESSION** | Template F + KEY digitada + execução automática de `session-close.sh` | **OBRIGATÓRIA**|

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

1. **Invoque `vscode_askQuestions`** com **TEMPLATE F** (Session Close)
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
- **Encerrar SESSION**: `vscode_askQuestions` Template F + KEY + execução automática em `post-tool-use.sh`
- **Avisar sobre token budget**: `vscode_askQuestions` Template D (Checkpoint)
- **Trocar de fase**: `bash start-section.sh "nome-nova-fase"`
- **Terminar TURN**: obrigatório chamar `vscode_askQuestions` como último ato do turno

---


### 🔐 Chave desta SESSION (mostrar no Template F):
```
ENCERRAR-75DCFA00
```

### Fluxo de encerramento de SESSION (3 etapas obrigatórias):
1. Agente chama `vscode_askQuestions` com **Template F** (exibe a chave acima)
2. Usuário digita a chave `ENCERRAR-75DCFA00` no campo livre
3. `post-tool-use.sh` valida a chave e executa `session-close.sh` automaticamente

---


---

## ⛔⛔⛔ VIOLAÇÃO CRÍTICA REITERADA (3x consecutivas) — AÇÃO OBRIGATÓRIA IMEDIATA ⛔⛔⛔

> **A sessão anterior encerrou SEM autorização do usuário.**
> O agente não chamou `vscode_askQuestions` antes de finalizar o turno.
>
> - **Sessão violadora**: `1619b495-1add-4a00-8abe-e19efba38e2f`
> - **Horário da violação**: `desconhecido`
> - **Turno**: `1`
> - **Violações consecutivas**: `3`
>
> **PRIMEIRA AÇÃO DESTA SESSÃO (antes de qualquer outra coisa):**
>
> 1. Informar o usuário sobre esta violação
> 2. Pedir desculpas explicitamente
> 3. Invocar `vscode_askQuestions` para recuperar a autorização
>
> **Esta violação será registrada no audit.jsonl e rastreada.**
> O arquivo `.github/hooks/state/UNAUTHORIZED_CLOSE.flag` SÓ é removido
> quando o agente chama `vscode_askQuestions` corretamente.

---


---

## ⚡ AVISO — ENCERRAMENTO ABRUPTO SEM KEY (`session-close.sh` não executado)

> **A sessão anterior encerrou sem registrar `sessionEnd` nem `sessionCloseAuthorized`.**
> Isso ocorre quando o VS Code / Copilot é fechado abruptamente
> (timeout, crash, reinicialização ou fechamento direto da janela).
>
> - **Sessão afetada**: `05cc4447-6907-4a71-896b-8747c1a6589f`
> - A `close_key` **não foi validada** — encerramento não auditado pelo sistema.
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


---

## 🔐 CHAVE DE ENCERRAMENTO (referência rápida)

```
ENCERRAR-75DCFA00
```

> SESSION fecha com: **Template F** → usuário digita KEY → execução automática de `session-close.sh`.
> TURN fecha com `vscode_askQuestions` (obrigatório) e **não pode ser retomado** após fechamento.
> A SESSION pode ser retomada com novo prompt no mesmo chat.

---


---

## ⚠️ Watchdog — WARNING (0 crítico(s), 1 aviso(s))

> O watchdog detectou anomalias no início desta sessão.
> Veja o relatório completo em `state/watchdog-report.json`.

- **[WARN]** `CONSEC_UNAUTH`: 3 TURN(s) não-autorizado(s) consecutivos detectados na sessão atual.

---


---

## 📍 Estado Ativo — SESSION → SECTION → TURN

| Dimensão | Valor |
|----------|-------|
| **ID da Sessão** | `3a8ff315-6ae8-4949-abfc-5cd4175f1ac0` |
| **Sessão lógica** | #5 |
| **Origem da sessão** | 🆕 `new` — sessão fresca (VS Code abriu nova janela de chat) |
| **Estatísticas** | Estatísticas zeradas (sessão nova) |
| **Turno** | #1 (primeiro turno desta sessão) |
| **Seção ativa** | `"início"` — seção 1 |
| **Seção iniciada em** | 2026-03-17T16:21:48Z |

> **Invariante**: sempre deve haver uma SESSION, uma SECTION e um TURN ativos.
> A seção `"início"` é criada automaticamente em toda nova sessão.
> Use `bash .github/hooks/scripts/start-section.sh "nome"` para abrir uma nova seção
> (a seção anterior será encerrada automaticamente com `sectionEnd`).

---


## Estado do Backlog

| Prioridade      | Tarefas abertas |
|-----------------|-----------------|
| 🔴 Alta          | 0  |
| 🟡 Média         | 0 |
| 🔵 Backlog Livre | 0 |
| **Total**       | **0** |

## Próxima tarefa sugerida (Alta Prioridade)

(nenhuma tarefa de Alta Prioridade — verificar Média Prioridade)

## Findings pendentes

- Total registrado em `logs/findings.jsonl`: **0**
- Findings críticos/high: **0**

> Se `CRITICAL_FINDINGS > 0`, considere priorizar a resolução desses findings
> antes de selecionar uma nova tarefa do backlog.

## Saúde do Sistema

**Status**: ⛔ CRÍTICO — verificação imediata necessária
**Rede**: ⛔ FALHA (sem resposta de 140.82.112.22)
**Reconexões VS Code (histórico)**: 0 ✅ ok


- ⛔ **Sem conectividade de rede** (ping 140.82.112.22 falhou). VS Code pode desconectar. Verifique WSL2/Docker network.


## Tendências históricas

| Métrica | Valor |
|---|---|
| Sessões registradas | 25 |
| Total de chamadas de ferramenta | 2372 |
| Taxa de falha de ferramentas | 0,0% (0/2372) |

### Top ferramentas (todas as sessões)

| Ferramenta | Chamadas |
|---|---|
| \`read_file                          \` |   705 |
| \`apply_patch                        \` |   465 |
| \`manage_todo_list                   \` |   277 |
| \`run_in_terminal                    \` |   225 |
| \`grep_search                        \` |   163 |
| \`get_errors                         \` |   161 |

### Ferramentas com mais falhas

- (nenhuma falha registrada)

## Performance por ferramenta (médias históricas)

| Ferramenta | Média | Amostras |
|---|---|---|
| `runSubagent                        ` | 279126 ms |    5 |
| `run_task                           ` | 128252 ms |   16 |
| `vscode_askQuestions                ` |  63382 ms |  108 |
| `create_file                        ` |  13400 ms |  116 |
| `run_in_terminal                    ` |   9526 ms |  657 |
| `fetch_webpage                      ` |   8760 ms |   24 |
| `apply_patch                        ` |   5259 ms |  854 |
| `grep_search                        ` |   3745 ms |  459 |

## Sessão atual

- **ID**: 3a8ff315-6ae8-4949-abfc-5cd4175f1ac0
- **Início**: 2026-03-17T16:21:48Z
- **Origem**: new
- **Workspace**: /workspaces/chatgpt-docker-puppeteer/.github/hooks

## Continuidade — Sessão Anterior

> **Recovery ativo.** Dados recuperados do último checkpoint da sessão anterior.

- **Sessão anterior**: `05cc4447-6907-4a71-896b-8747c1a6589f`
- **Checkpoint**: `2026-03-17T01:07:55Z`
- **Turnos concluídos**: 0
- **Tarefas abertas**: 0

> Verifique `.github/hooks/state/pending-tasks.md` para retomar de onde parou.

## Ação imediata recomendada

1. **SE** `initialPrompt` está vazio → invocar `vscode_askQuestions` com Template E (Session Kickoff)
2. **SE** há findings críticos → apresentá-los ao usuário antes de prosseguir
3. **SE** a sessão tem prompt explícito → executar o prompt e, ao concluir, invocar Template A
4. **SE** sessão anterior detectada → confirmar com usuário se deseja retomar tarefas abertas

---
*Gerado automaticamente. Não editar manualmente.*
