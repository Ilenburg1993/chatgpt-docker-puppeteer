# Instruções para todos os agentes

**Propósito**: baseline curto e permanente para agentes de IA neste workspace. **Status**: Canônico.
**Última atualização**: 10 de março de 2026.

Este arquivo é lido automaticamente por agentes de IA (Copilot, Claude, ChatGPT, etc.) que interagem
com o workspace. Ele complementa `.github/copilot-instructions.md` e usa
`.github/instructions/project-canon.instructions.md` como baseline estável.

---

## ╔══════════════════════════════════════════════════════════════════════╗

## ║ ⚠️ SESSION PERSISTENTE — PRINCÍPIO FUNDAMENTAL (LEIA PRIMEIRO) ║

## ╚══════════════════════════════════════════════════════════════════════╝

> **O encerramento de uma SESSION, se o sistema estiver funcionando corretamente,** **deve ser um
> evento EXTREMAMENTE RARO.**

**REGRA ABSOLUTA**: O agente NUNCA deve chamar `session-close.sh` diretamente. Nem mesmo com a KEY
correta. O único fluxo legítimo de encerramento é:

1. Agente invoca `vscode_askQuestions` com **Template F** (exibe a `close_key` ao usuário)
2. Usuário digita `ENCERRAR-XXXXXXXX` no campo de resposta
3. `post-tool-use.sh` detecta automaticamente a KEY na resposta → executa `session-close.sh`
   automaticamente

> **Por que nunca chamar session-close.sh diretamente?**
>
> - O hook `pre-tool-use.sh` (v8.0) **NEGA** qualquer chamada a `session-close.sh` via
>   `run_in_terminal` enquanto `close_key_validated=false`.
> - O agente pode halluciná a KEY ou ser manipulado — o fluxo via `vscode_askQuestions` é o único
>   confiável.
> - `post-tool-use.sh` detecta a KEY na resposta do usuário e aciona o encerramento de forma
>   controlada.

**SESSION end = EVENTO EXTREMAMENTE RARO.** Toda SESSION deve ser mantida viva o máximo possível.

---

## ╔══════════════════════════════════════════════════════════════════╗

## ║ 🔐 PROTOCOLO CRÍTICO — ENCERRAMENTO DE SESSION (LEIA PRIMEIRO) ║

## ╚══════════════════════════════════════════════════════════════════╝

> **SESSION ≠ SECTION ≠ TURN** — confundir estes três conceitos é o erro mais frequente.

| Conceito    | O que é                       | Encerra com                           | Autorização        |
| ----------- | ----------------------------- | ------------------------------------- | ------------------ |
| **TURN**    | 1 ciclo prompt→resposta       | Livremente ao terminar a resposta     | ❌ Não precisa     |
| **SECTION** | Fase lógica dentro da SESSION | `bash start-section.sh "nome"`        | ❌ Autônoma        |
| **SESSION** | 1 ativação do Copilot Chat    | Template F + KEY + `session-close.sh` | ✅ **OBRIGATÓRIA** |

### Para encerrar SESSION — 3 passos obrigatórios

1. Invocar `vscode_askQuestions` com **Template F** (exibe a `close_key`)
2. Usuário digita `ENCERRAR-XXXXXXXX` no campo livre
3. **post-tool-use.sh chama `session-close.sh` automaticamente** (o agente não deve chamar)

> **Onde encontrar a `close_key`:**
>
> - `session-briefing.md` → seção `🔐 CHAVE DE ENCERRAMENTO DA SESSÃO`
> - `session-context.json` → campo `session.close_key`
> - Lembrete rápido: `bash .github/hooks/scripts/session-reminder.sh`
>
> **Por que session-close.sh é obrigatório?** O evento `sessionEnd` do VS Code Copilot **não
> dispara** em encerramento abrupto (crash/restart/timeout). Sem o script:
> `SESSION_CLOSE_NO_KEY.flag` → alerta na próxima sessão.
>
> **Verificação automática:** o hook `postToolUse` detecta a close_key na resposta de
> `vscode_askQuestions` e registra `sessionClose_key_validated` no audit.jsonl — confirmando que a
> KEY foi enviada legitimamente via tool call, não por texto plano.

---

## Protocolo de encerramento por nível

> **Modelo v9.0 — Protocolo TODO Obrigatório.** Vigente desde 2026-03-11.

### ╔═══ PROTOCOLO TODO OBRIGATÓRIO (v9.0) ═══╗

> **Todo turno de trabalho significativo DEVE criar TODOs e terminar com vscode_askQuestions.**

**Regras:**

1. Use `manage_todo_list` ao **iniciar** qualquer turno de trabalho (crie a lista de tarefas).
2. O último item da lista DEVE ser:
   `"Chamar vscode_askQuestions [Template A/D/E conforme contexto]"`.
3. Execute todos os TODOs em sequência — o último (vscode_askQuestions) NÃO pode ser pulado.
4. `agent-stop.sh` emite `decision:block` quando `vscode_askQuestions` não foi chamado.

### O que se aplica — por nível

**TURN (turno)** — Protocolo TODO obrigatório:

- TURNs com trabalho realizado DEVEM terminar com `vscode_askQuestions`.
- `vscode_askQuestions` é **obrigatório** ao final de qualquer turno com trabalho realizado.
- Templates por contexto: tarefa concluída → Template A; checkpoint a cada ~5 TURNs → Template D;
  proposta arquitetural → Template C; sessão ociosa → Template E.

**SECTION (seção temática)** — Autônoma, sem autorização do usuário:

- O agente abre e fecha seções com `start-section.sh "nome"` / `section-end.sh "motivo"`
- A mudança de contexto semântico é decisão do agente — sem necessidade de pedir permissão.

**SESSION (sessão)** — Autorização explícita **obrigatória** com close_key + session-close.sh:

1. Invocar `vscode_askQuestions` com Template F (exibe a `close_key` da sessão)
2. Usuário digita a chave `ENCERRAR-XXXXXXXX` no campo livre
3. Agente extrai a KEY da resposta e chama **obrigatoriamente**:
   ```bash
   bash .github/hooks/scripts/session-close.sh "ENCERRAR-XXXXXXXX"
   ```
4. Sem a chamada do script → `SESSION_CLOSE_NO_KEY.flag` → alerta de encerramento não autorizado

> **Por que session-close.sh?** O evento `sessionEnd` da plataforma VS Code Copilot não dispara
> quando a sessão termina abruptamente. O `session-close.sh` é o único mecanismo confiável: valida a
> KEY, loga `sessionCloseAuthorized`, chama `session-end.sh` e gera o relatório final.

**Commit e/ou Push** — Protocolo obrigatório com Template G:

1. Antes de qualquer `git commit` e/ou `git push`, invocar `vscode_askQuestions` com Template G
2. O usuário orienta se deve: commitar+pushar, revisar com subagente, continuar melhorando, etc.
3. Executar apenas a ação autorizada pelo usuário

### Monitoramento automático (enforcement v7.0+)

O sistema registra chamadas de `vscode_askQuestions` para auditoria e enforcement:

- `agent-stop.sh` detecta se `vscode_askQuestions` foi chamado no turno
- Sem chamada: loga `turnEnd_no_askQuestions` + emite `decision:block` + incrementa
  `consecutive_unauthorized`
- Com chamada: loga `turnEnd_authorized` e reseta `consecutive_unauthorized`
- `manage_todo_list` não usado no turno: mencionado no `systemMessage` do block

---

## Regras universais

- Responder em **português brasileiro (pt-BR)** ao interagir com humanos ou ao escrever
  documentação.
- Presumir Node.js 24+ com ESM obrigatório (`import` / `export`).
- Tratar `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md` como a arquitetura oficial.
- Aplicar estas instruções junto com `.github/copilot-instructions.md` e os `*.instructions.md`
  relevantes.

## Mapa estável do repositório

| Diretório           | Papel                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| `src/`              | Runtime do produto — `src/agent/` são workers internos, ≠ `agents/` na raiz |
| `tests/`            | Testes, harness e quarentena em `legacy/`                                   |
| `scripts/`          | Automação operacional, auditoria e tooling interno                          |
| `DOCUMENTAÇÃO/`     | Documentação canônica (arquitetura, bugs, CI/CD, relatórios, operações)     |
| `.github/`          | Instruções permanentes, skills, workflows e agentes                         |
| `agents/`, `tools/` | Tooling auxiliar externo ao runtime                                         |

## Ferramentas CLI disponíveis (DevContainer)

## Code quality — JSDoc e tipagem

**Regra universal**: toda exportação pública relevante deve ter JSDoc robusto e tipagem explícita.

| Task                               | Skill                        | Detalhes                                                               |
| ---------------------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| Criar/revisar JSDoc                | `jsdoc-authoring`            | JSDoc curto, objetivo, com tipos completos (@param, @returns, @throws) |
| Adicionar tipagem TypeScript/JSDoc | `typing-node24-esm-tsserver` | Hardening de tipos para Node.js 24 + ESM (evita ambiguidades runtime)  |
| Verificar tipos                    | `npm run typecheck:node`     | Lint automático de tipos via tsserver                                  |

**Exemplo**:

```javascript
/**
 * Valida um payload de tarefa.
 *
 * @param {Object} payload - Payload a validar
 * @returns {Promise<boolean>} true se válido
 * @throws {ValidationError} se inválido
 */
export async function validateTask(payload) {
  /* ... */
}
```

**Use sempre `rg` em vez de `grep` e `fd` em vez de `find`.**

- `rg "padrão" src/` — busca de texto (ripgrep)
- `fd "\.js$" src/` — localização de arquivos (fd-find)
- `bat arquivo.js` — leitura com syntax highlighting
- `jq` / `yq` — processamento de JSON e YAML
- `gh` — GitHub CLI (PRs, issues, runs, releases)
- `actionlint` / `hadolint` / `shellcheck` — lint de workflows, Dockerfile e shell scripts
- `hyperfine` — benchmark de comandos
- `sqlite3` — banco de estado local

## Scripts npm essenciais

```
npm run lint             # ESLint
npm run format:check     # Prettier (dry-run)
npm run test:unit        # Testes unitários
npm run test:integration # Testes de integração
npm run typecheck:node   # TypeScript via tsserver
npm run audit:quick      # Auditoria rápida
npm run diagnose         # Diagnóstico do ambiente
npm run rag:health       # Saúde do RAG
npm run lsp:health       # Saúde do LSP
```

## Modo Arquiteto — Autonomia Máxima e Persistência de Sessão

O **Modo Arquiteto** é o comportamento padrão de toda sessão — com ou sem prompt explícito do
usuário. O agente é um colaborador ativo e autônomo, não um executor passivo.

---

### REGRA FUNDAMENTAL — Sessões NUNCA terminam por falta de instrução

> **O agente mantém a sessão ativa através do ciclo:**
> `Executar → Refletir → Registrar → Perguntar (via vscode_askQuestions) → Executar → ...`
>
> A única razão válida para parar de trabalhar é o usuário dizer explicitamente "parar", "stop" ou
> "encerrar sessão". **Tarefas concluídas não encerram a sessão — elas disparam perguntas.**
>
> **Lembre-se: "Perguntar" = chamar a ferramenta `vscode_askQuestions`. Texto plano não conta.**

---

### ⛔ Protocolo de encerramento (resumo — ver regra completa no topo deste arquivo)

> Invocar `vscode_askQuestions` ANTES de qualquer encerramento. **TEXTO PLANO NÃO CONTA.** Somente
> tool call real. O sistema monitora violações automaticamente — ver seção ⛔⛔⛔ no início do
> arquivo.

> **ENCERRAMENTO DE SESSION (extra-hardening)**: além do `vscode_askQuestions`, o usuário DEVE
> digitar a chave `ENCERRAR-XXXXXXXX` no campo livre do **Template F**. A chave está no
> `session-briefing.md` → seção `🔐 CHAVE DE ENCERRAMENTO DA SESSÃO`. **Use sempre Template F** (não
> Template A) ao encerrar a sessão.

---

### Protocolo de início de sessão (OBRIGATÓRIO — todo turno que inicia uma sessão)

1. **Ler** `.github/hooks/state/session-briefing.md` — gerado automaticamente pelo hook
   `sessionStart`
2. **Ler** `.github/hooks/state/pending-tasks.md` — backlog canônico de tarefas
3. **Checar** `turn_count` em `.github/hooks/state/session-context.json`
4. **Invocar** `vscode_askQuestions` com **Template E** (Session Kickoff) — ver abaixo

---

### Protocolo vscode_askQuestions — OBRIGATÓRIO nos seguintes gatilhos

O agente DEVE invocar `vscode_askQuestions` (com múltiplas perguntas ricas) em cada um destes
momentos. **Sem exceção.**

| Gatilho                                       | Template                 | Momento                      |
| --------------------------------------------- | ------------------------ | ---------------------------- |
| Sessão iniciada sem prompt explícito          | **E — Session Kickoff**  | Primeiro ato da sessão       |
| Qualquer tarefa concluída                     | **A — Next Step**        | Logo após marcar `- [x]`     |
| ≥ 3 bugs encontrados numa auditoria           | **B — Bug Discovery**    | Antes de corrigir            |
| Proposta de upgrade arquitetural identificada | **C — Upgrade Proposal** | Antes de executar            |
| `turn_count % 3 == 0` e `turn_count > 0`      | **D — Checkpoint**       | No início do turno           |
| Usuário pede para encerrar a sessão           | **F — Session Close**    | Antes de encerrar SESSION    |
| Antes de qualquer commit e/ou push            | **G — Commit/Push**      | Antes de `git commit`/`push` |

> **Nota de protocolo**: como primeiro ato de cada turno de trabalho, o agente deve chamar
> `bash .github/hooks/scripts/start-turn.sh "intenção"` para declarar sua intenção antes de invocar
> qualquer ferramenta. Isso gera o evento `turnStart_enriched` no audit.jsonl.

---

### Schema obrigatório do `vscode_askQuestions` — Referência de uso correto

> ⚠️ **CRÍTICO**: usar campos errados (`id`, `prompt`, `type`) **não gera erro visível** mas pode
> causar falhas silenciosas na API, respostas malformadas e interrupção da sessão. **Use sempre os
> campos canônicos abaixo.**

#### Campos por item de `questions` (array)

| Campo                | Tipo   | Obrigatório | Limite      | Descrição                                                   |
| -------------------- | ------ | ----------- | ----------- | ----------------------------------------------------------- |
| `header`             | string | ✅ sim      | **≤50 ch**  | Chave da pergunta; aparece como título e índice no response |
| `question`           | string | ✅ sim      | **≤200 ch** | Texto exibido ao usuário. Manter conciso — uma frase.       |
| `allowFreeformInput` | bool   | ❌ não      | —           | `true` = habilita campo de texto livre                      |
| `multiSelect`        | bool   | ❌ não      | —           | `true` = permite múltiplas seleções nas opções              |
| `options`            | array  | ❌ não      | —           | Lista de opções clicáveis. Se omitido = só texto livre      |

#### Campos por item de `options`

| Campo         | Tipo   | Obrigatório | Descrição                    |
| ------------- | ------ | ----------- | ---------------------------- |
| `label`       | string | ✅ sim      | Texto clicável da opção      |
| `description` | string | ❌ não      | Texto secundário (subtítulo) |
| `recommended` | bool   | ❌ não      | Marca como opção sugerida    |

#### Anti-padrões proibidos

```json
// ❌ ERRADO — campos antigos que a API não reconhece:
{ "id": "x", "prompt": "...", "type": "selectOne", "options": ["string1"] }

// ✅ CORRETO — schema canônico:
{ "header": "Título curto ≤50", "question": "Pergunta concisa ≤200 chars?",
  "options": [{ "label": "Opção A" }, { "label": "Opção B" }] }
```

#### Regras de hardening (obrigatórias)

1. **`header` ≤50 chars** — violar este limite causa `FAILED: Response contained no choices`
2. **`question` ≤200 chars** — superar este limite causa falha silenciosa da API
3. **`options` = objetos** — nunca `"string"` diretamente; sempre `{ "label": "..." }`
4. **Substituir placeholders** — `[CLOSE_KEY]`, `[N_MOD]`, etc. com valores reais antes de invocar
5. **Verificar tamanho antes de invocar** — ao substituir placeholders, o `question` resultante deve
   ainda caber em 200 chars
6. **`allowFreeformInput`** — usar nos templates que pedem texto livre do usuário (F, G, D, A)

#### Exemplo completo válido

```json
[
  {
    "header": "Próxima ação",
    "question": "✅ Concluí: Hardening do schema askQuestions. Atualizei AGENTS.md e GUIA v1.9. O que fazer agora?",
    "allowFreeformInput": true,
    "options": [
      { "label": "Próxima tarefa do backlog", "recommended": true },
      { "label": "Fazer commit e push" },
      { "label": "Encerrar sessão" }
    ]
  }
]
```

---

```json
[
  {
    "header": "Modo da sessão",
    "question": "Sessão iniciada. [N_ALTA] alta | [N_MEDIA] média | [N_BACKLOG] backlog | [N_FINDINGS] findings pendentes. Como proceder?",
    "options": [
      { "label": "Trabalhar autonomamente — alta → média → backlog" },
      { "label": "Auditoria profunda — escolher módulo e auditar" },
      { "label": "Focar em bugs — corrigir findings críticos primeiro" },
      { "label": "Proposta arquitetural — analisar e propor melhorias" },
      { "label": "Mostrar estado completo e propor plano detalhado" },
      { "label": "Aguardar instrução do usuário" }
    ]
  },
  {
    "header": "Foco em módulo",
    "question": "Há módulo ou área prioritária nesta sessão? (seleção múltipla permitida)",
    "multiSelect": true,
    "options": [
      { "label": "src/kernel/ — motor de execução de tarefas" },
      { "label": "src/driver/ — automação de browser/Chrome" },
      { "label": "src/infra/ — pool, queue, storage, locks" },
      { "label": "src/server/ — API REST e dashboard realtime" },
      { "label": "src/nerv/ — barramento de eventos (IPC/telemetria)" },
      { "label": "src/agent/ — workers internos (missão, watchdog, controle)" },
      { "label": "tests/ — cobertura e testes de regressão" },
      { "label": "DOCUMENTAÇÃO/ — arquitetura, bugs, operações" },
      { "label": "Sem preferência — deixar o agente decidir" }
    ]
  },
  {
    "header": "Autonomia entre checkpoints",
    "question": "Quantos ciclos posso executar antes do próximo checkpoint interativo?",
    "options": [
      { "label": "1 ciclo — perguntar após cada tarefa" },
      { "label": "3 ciclos — checkpoint a cada 3 tarefas" },
      { "label": "5 ciclos — checkpoint a cada 5 tarefas" },
      { "label": "Modo livre — só interromper em casos críticos ou ambíguos" },
      { "label": "Modo máximo — executar indefinidamente" }
    ]
  },
  {
    "header": "Profundidade de análise",
    "question": "Qual profundidade de análise para esta sessão?",
    "options": [
      { "label": "Superficial — lint + typecheck, correções cirúrgicas" },
      { "label": "Normal — lint + typecheck + testes + JSDoc" },
      { "label": "Profunda — tudo + busca de bugs latentes + semântica" },
      { "label": "Máxima — exploratória irrestrita + upgrades + refactoring" }
    ]
  }
]
```

---

### Template A — Next Step (pós-conclusão de tarefa)

> **Schema**: `header` (≤50), `question` (≤200), `options` como objetos `{label, recommended?}`.
> `allowFreeformInput: true` nos campos onde o usuário pode passar instruções livres.

```json
[
  {
    "header": "Próxima ação",
    "question": "✅ Concluí: [TAREFA_CONCLUÍDA]. [RESUMO_1_LINHA]. O que fazer agora?",
    "allowFreeformInput": true,
    "options": [
      { "label": "Próxima tarefa do backlog (automático)", "recommended": true },
      { "label": "Auditoria profunda do módulo tocado" },
      { "label": "Expandir — corrigir TODOS os bugs relacionados" },
      { "label": "Escrever testes para o código modificado" },
      { "label": "Gerar relatório e propor próximos upgrades" },
      { "label": "Propor refactoring arquitetural" },
      { "label": "Pausar — aguardar instrução" }
    ]
  },
  {
    "header": "Findings registrados",
    "question": "Registrei [N] findings durante a tarefa. O que fazer com eles?",
    "multiSelect": true,
    "options": [
      { "label": "Corrigir críticos/high agora antes de prosseguir" },
      { "label": "Adicionar todos ao backlog para sessão dedicada" },
      { "label": "Gerar relatório em DOCUMENTAÇÃO/AUDITORIAS/" },
      { "label": "Ignorar por ora — focar na próxima tarefa" }
    ]
  }
]
```

---

### Template B — Bug Discovery (≥ 3 bugs encontrados)

```json
[
  {
    "header": "Ação sobre bugs",
    "question": "🔍 [N] bugs em [MÓDULO]: [RESUMO_1_LINHA]. Como proceder?",
    "multiSelect": true,
    "options": [
      { "label": "Corrigir TODOS agora, nesta sessão" },
      { "label": "Corrigir apenas críticos/high priority agora" },
      { "label": "Gerar relatório em DOCUMENTAÇÃO/AUDITORIAS/ + backlog" },
      { "label": "Corrigir + testes de regressão para cada bug" },
      { "label": "Corrigir + refactoring preventivo desta classe de bug" },
      { "label": "Documentar apenas — não modificar código agora" }
    ]
  },
  {
    "header": "Relatório de auditoria",
    "question": "Gerar relatório formal de auditoria para este módulo?",
    "options": [
      { "label": "Sim — gerar DOCUMENTAÇÃO/AUDITORIAS/audit-YYYYMMDD-módulo.md" },
      { "label": "Não — registrar apenas em findings.jsonl" },
      { "label": "Sim + adicionar tarefas derivadas ao pending-tasks.md" }
    ]
  }
]
```

---

### Template C — Upgrade Proposal (melhoria arquitetural identificada)

```json
[
  {
    "header": "Executar upgrade",
    "question": "💡 Upgrade em [MÓDULO]: [DESCRIÇÃO_1_LINHA]. [N] arquivos afetados. Executar?",
    "options": [
      { "label": "Sim — executar agora, sem interrupção" },
      { "label": "Sim — em etapas, com checkpoint após cada fase" },
      { "label": "Mostrar plano detalhado antes de decidir" },
      { "label": "Adicionar ao backlog como alta prioridade" },
      { "label": "Adicionar ao backlog como média prioridade" },
      { "label": "Não executar — descartado" }
    ]
  },
  {
    "header": "Nível de testes",
    "question": "Se executar o upgrade, qual nível de testes incluir?",
    "options": [
      { "label": "Mínimo — testes existentes passando" },
      { "label": "Existentes + unitários para o novo código" },
      { "label": "Suite completa: unit + integration + typecheck + lint" },
      { "label": "Suite completa + performance (hyperfine)" }
    ]
  }
]
```

---

### Template D — Checkpoint Periódico (turn_count % 3 == 0)

```json
[
  {
    "header": "Checkpoint de sessão",
    "question": "📍 Checkpoint: executei [TURN_COUNT] turnos. Completei: [RESUMO_1_LINHA]. Continuar?",
    "allowFreeformInput": true,
    "options": [
      { "label": "Continuar — próxima tarefa do backlog", "recommended": true },
      { "label": "Continuar — mas mudar foco de módulo" },
      { "label": "Fazer commit agora e continuar" },
      { "label": "Fazer commit e encerrar a sessão" },
      { "label": "Encerrar sem commit (mudanças preservadas)" }
    ]
  }
]
```

---

### Template F — Session Close (quando usuário pede para encerrar a sessão)

> **USO OBRIGATÓRIO**: Sempre que o usuário mencionar encerrar, fechar, parar ou sair da sessão,
> invocar este template. Uma SESSION é um recurso premium (1 por dia) — o encerramento exige
> confirmação explícita com a chave dinâmica gerada no início da sessão.
>
> A chave está em:
>
> - `session-briefing.md` → seção `🔐 CHAVE DE ENCERRAMENTO DA SESSÃO`
> - `session-context.json` → campo `session.close_key`
>
> **Protocolo obrigatório (3 passos)**:
>
> 1. Invocar este Template F via `vscode_askQuestions` (exibe a close_key ao usuário)
> 2. Usuário digita a KEY no campo livre
> 3. Agente extrai a KEY da resposta e chama **obrigatoriamente**:
>    ```bash
>    bash .github/hooks/scripts/session-close.sh "ENCERRAR-XXXXXXXX"
>    ```
>    **Por que o script é necessário?** O evento `sessionEnd` da plataforma VS Code Copilot não
>    dispara quando a sessão termina abruptamente. Sem chamar `session-close.sh`, o encerramento
>    nunca é registrado no sistema de auditoria e a próxima sessão detecta "encerramento abrupto".
>
> **⚠️ SUBSTITUA `[CLOSE_KEY]` pela chave real antes de invocar.** A question deve ter ≤200 chars —
> não adicione texto extra além do template abaixo.

```json
[
  {
    "header": "🔐 Encerrar SESSION",
    "question": "Close key desta sessão: [CLOSE_KEY]. Digite-a no campo livre para confirmar encerramento. Sem a key o encerramento NÃO é registrado.",
    "allowFreeformInput": true,
    "options": [
      { "label": "Cancelar — quero continuar trabalhando", "recommended": true },
      { "label": "Encerrar sem key (encerramento NÃO será validado)" }
    ]
  }
]
```

**Após receber a KEY do usuário**, o agente DEVE executar imediatamente:

```bash
bash .github/hooks/scripts/session-close.sh "ENCERRAR-XXXXXXXX"
```

Substituindo `ENCERRAR-XXXXXXXX` pela KEY digitada pelo usuário. O script valida, loga
`sessionCloseAuthorized` e chama `session-end.sh` internamente.

---

### Template G — Commit/Push Pre-Authorization (antes de git commit e/ou push)

> **USO OBRIGATÓRIO**: invocar antes de qualquer `git commit` e/ou `git push`. Apresenta o estado
> das mudanças pendentes e oferece 5 rotas diferentes, incluindo revisão por subagente antes de
> commitar. O agente substitui os placeholders `[...]` com dados reais do contexto atual.
>
> **TURN/SECTION não requerem Template G** — apenas operações git (commit e push).
>
> **⚠️ OBRIGATÓRIO: o agente DEVE substituir todos os `[PLACEHOLDER]` com dados reais antes de
> invocar a ferramenta.** Placeholders crus na tela do usuário são considerados violação de
> protocolo. Use `git status --short | wc -l` para N_MOD, `git diff --stat HEAD` para resumo, etc. A
> question deve ter ≤200 chars — use `[RESUMO_CURTO]` com ≤30 chars.

```json
[
  {
    "header": "Pré-autorização commit/push",
    "question": "Modificados: [N_MOD] | Novos: [N_NEW] | Del: [N_DEL] | lint=[L] typecheck=[T] testes=[T2]. [RESUMO_CURTO]. Prosseguir?",
    "allowFreeformInput": true,
    "options": [
      { "label": "✅ Commitar + push agora (git add -A && commit && push)" },
      { "label": "✅ Apenas push (já commitado localmente)" },
      { "label": "🔍 Revisão de subagente → corrigir → commit + push" },
      { "label": "🔍 Revisão de subagente → corrigir → continuar (commit depois)" },
      { "label": "🚀 Mais melhorias antes de commitar" }
    ]
  },
  {
    "header": "Escopo do commit",
    "question": "Qual escopo principal para a mensagem do commit? (campo livre para instrução adicional)",
    "allowFreeformInput": true,
    "options": [
      { "label": "feat: nova funcionalidade" },
      { "label": "fix: correção de bug" },
      { "label": "refactor: sem mudança de comportamento" },
      { "label": "docs: atualização de documentação" },
      { "label": "chore: manutenção, scripts, configuração" },
      { "label": "Deixar o agente decidir com base nas mudanças" }
    ]
  }
]
```

---

### Criação Autônoma de Tarefas

O agente DEVE criar novas tarefas quando identificar qualquer um destes gatilhos:

| Gatilho                                                       | Prioridade sugerida |
| ------------------------------------------------------------- | ------------------- |
| Bug confirmado (não apenas suspeito)                          | `alta`              |
| Vulnerabilidade de segurança                                  | `alta`              |
| Race condition ou deadlock potencial                          | `alta`              |
| Gap de cobertura de testes (< 50% branches em módulo crítico) | `media`             |
| Módulo público sem JSDoc completo                             | `media`             |
| Dependência circular detectada                                | `media`             |
| Performance issue mensurável (> 2x mais lento que esperado)   | `media`             |
| Código legado / deprecated em uso                             | `backlog`           |
| Oportunidade de refactoring não urgente                       | `backlog`           |

**Como criar tarefas** (via `run_in_terminal`):

```bash
# Sintaxe: add-task.sh <prioridade> "<Título>" "<Descrição com gate de aceitação>"
bash .github/hooks/scripts/add-task.sh alta \
  "Corrigir race condition em browser_pool.acquire()" \
  "pool.acquire() pode retornar handle fechado se Chrome reiniciar. Gate: test:integration passa."

bash .github/hooks/scripts/add-task.sh backlog \
  "Refactoring: extrair lógica de retry para módulo compartilhado" \
  "src/kernel/ e src/infra/ duplicam lógica de retry com backoff."
```

**Como marcar tarefas concluídas**:

```bash
bash .github/hooks/scripts/complete-task.sh "race condition em browser_pool"
```

**Como registrar findings**:

```bash
# severity: critical | high | medium | low | info
# type: bug | gap | improvement | vulnerability | performance | debt
bash .github/hooks/scripts/save-finding.sh \
  "src/infra/browser_pool/" "high" "bug" \
  "pool.acquire() retorna handle fechado sob carga alta"
```

---

### Ciclo de Auditoria Profunda

Quando o usuário ou o agente decide auditar um módulo (ex: escolher opção "auditoria profunda"):

**Fase 1 — Análise estática** (5 min):

```bash
npm run lint 2>&1 | rg "<módulo>" | head -20
npm run typecheck:node 2>&1 | rg "<módulo>" | head -30
rg "TODO|FIXME|HACK|XXX|BUG" --stats < módulo > /
```

**Fase 2 — Cobertura de testes** (5 min):

```bash
npm run test:unit -- --coverage 2>&1 | tail -40
```

**Fase 3 — Análise semântica** (10-20 min):

- Ler `<módulo>/index.js` e principais exportações
- Verificar JSDoc de funções públicas (`npm run jsdoc:coverage`)
- Rastrear fluxo de dados crítico (ex: como uma tarefa passa do kernel ao driver)
- Identificar condições de borda, error paths, estado mutável compartilhado

**Fase 4 — Registrar findings**:

```bash
bash .github/hooks/scripts/save-finding.sh "<módulo>" "<severity>" "<type>" "<descrição>"
```

**Fase 5 — Gerar relatório**:

```markdown
# Criar DOCUMENTAÇÃO/AUDITORIAS/audit-YYYYMMDD-<módulo>.md com:

- Resumo executivo (2-3 linhas)
- Findings por severidade (tabela)
- Recomendações ordenadas por impacto
- Tarefas derivadas (já adicionadas ao pending-tasks.md)
```

**Fase 6 — Apresentar e perguntar**: invocar Template B ou C dependendo dos achados.

---

### Quality gates obrigatórios ao final de cada conjunto de mudanças

```bash
npm run lint           # deve passar sem erros novos
npm run typecheck:node # deve manter ou reduzir contagem de erros
npm run test:unit      # deve manter ou reduzir falhas
```

> O hook `agentStop` rastreia `turn_count` automaticamente. O hook `sessionEnd` gera relatório em
> `DOCUMENTAÇÃO/RELATORIOS/SESSIONS/`. Logs e findings ficam em `.github/hooks/logs/` (gitignored).
> O `session-briefing.md` é regenerado a cada nova sessão.

---

### Sistema de hooks ativo

Este repositório tem hooks do Copilot em `.github/hooks/copilot-hooks.json`. Eles **nunca
bloqueiam** o agente — são logging-only por decisão de projeto.

**Schema real do payload (verificado empiricamente — 2026-03-09):**

| Campo             | Tipo     | Descrição                                                   |
| ----------------- | -------- | ----------------------------------------------------------- |
| `tool_name`       | `string` | Nome da ferramenta em snake_case (ex: `run_in_terminal`)    |
| `tool_input`      | `object` | Parâmetros da ferramenta (varia por ferramenta)             |
| `tool_response`   | `string` | Saída da ferramenta (texto plano)                           |
| `session_id`      | `string` | UUID real da sessão Copilot                                 |
| `tool_use_id`     | `string` | UUID único por chamada de ferramenta                        |
| `transcript_path` | `string` | Caminho para o transcript JSONL da conversa                 |
| `timestamp`       | `string` | ISO 8601 (`"2026-03-09T02:19:42.040Z"`) — NÃO epoch integer |
| `hook_event_name` | `string` | `"PreToolUse"` ou `"PostToolUse"` (PascalCase)              |
| `cwd`             | `string` | Diretório de trabalho atual                                 |

> **Nota**: A documentação oficial em `docs.github.com/en/copilot/reference/hooks-configuration` usa
> convenção camelCase (`.toolName`, `.toolResult.resultType`). O payload **real** no VS Code Copilot
> usa snake_case. Sempre consultar os logs empíricos em `.github/hooks/logs/raw-*.jsonl`.

---

### Hardening de persistência de sessão

O sistema de hooks mantém estado incremental entre sessões. O agente DEVE usar esses mecanismos para
garantir continuidade máxima:

**Arquivos de estado (`.github/hooks/state/`):**

| Arquivo                     | Propósito                                                           |
| --------------------------- | ------------------------------------------------------------------- |
| `session-context.json`      | Estado vivo: session_id, tools_used[], turn_count, last_tool_ts     |
| `session-briefing.md`       | Briefing gerado automaticamente no sessionStart — **ler sempre**    |
| `pending-tasks.md`          | Backlog canônico de tarefas — fonte de verdade para próximos passos |
| `UNAUTHORIZED_CLOSE.flag`   | Flag de violação: turno encerrado sem `vscode_askQuestions`         |
| `SESSION_CLOSE_NO_KEY.flag` | Flag: SESSION encerrada sem close_key validada — exige investigação |

**Checkpoints automáticos (`.github/hooks/checkpoints/`):**

O hook `agentStop` chama `session-checkpoint.sh` ao final de cada turno, salvando:

```json
{
  "checkpoint_ts": "2026-03-09T...",
  "session_id": "uuid",
  "turn_count": 5,
  "tasks": { "alta": 3, "media": 7, "backlog": 12, "open_total": 22, "done_total": 4 },
  "findings": { "total": 8, "critical": 0, "high": 2 },
  "metrics": { "tools_total": 87, "tools_success": 86, "avg_duration_ms": 1234 }
}
```

**Forçar um checkpoint manual** (útil antes de qualquer encerramento):

```bash
bash .github/hooks/scripts/session-checkpoint.sh
```

**Recovery automático**: o `session-start.sh` detecta e carrega o último checkpoint disponível e
inclui automaticamente as informações de continuidade no `session-briefing.md`.

**Regras de persistência máxima:**

1. NUNCA encerrar sem antes rodar `bash .github/hooks/scripts/session-checkpoint.sh`
2. AO INICIAR, sempre ler `session-briefing.md` — contém estado e tarefas da sessão anterior
3. Ao completar tarefa, usar `bash .github/hooks/scripts/complete-task.sh "<padrão>"` — atualiza
   `pending-tasks.md` e garante que o progresso é persistido
4. `session_context.json` é atualizado a cada ferramenta via `pre-tool-use.sh` (campo
   `tools_used[]`) — não sobrescreva manualmente
5. Findings em `findings.jsonl` são cumulativos — nunca deletar; usar `resolve-finding.sh` se
   disponível
6. **ENCERRAMENTO DE SESSION**: protocolo obrigatório de 3 passos:
   1. Invocar **Template F** (`vscode_askQuestions`) — exibe a chave `ENCERRAR-XXXXXXXX` ao usuário
   2. Usuário digita a chave
   3. Agente chama **obrigatoriamente**:
      `bash .github/hooks/scripts/session-close.sh "ENCERRAR-XXXXXXXX"` Sem o script →
      `SESSION_CLOSE_NO_KEY.flag` → alerta de encerramento não autorizado no próximo briefing.

---

### Hooks configurados (10 hooks — copilot-hooks.json)

| Hook                  | Script                | Tipo       | Descrição                                                                                                                                                                                                 |
| --------------------- | --------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionStart`        | `session-start.sh`    | Automático | Cria session-context.json e session-briefing.md                                                                                                                                                           |
| `userPromptSubmitted` | `log-prompt.sh`       | Automático | Hash do prompt, início de turno — **dispara apenas quando o usuário digita no chatbox** (raro; comunicação real via `vscode_askQuestions` é rastreada como `askQuestions_response` em `post-tool-use.sh`) |
| `preToolUse`          | `pre-tool-use.sh`     | Automático | Logging, redação de credenciais, auto-recovery                                                                                                                                                            |
| `postToolUse`         | `post-tool-use.sh`    | Automático | Resultado, detecção de close_key, quality gates                                                                                                                                                           |
| `postToolUseFailure`  | `tool-use-failure.sh` | Automático | Loga falhas de ferramentas, incrementa contadores                                                                                                                                                         |
| `agentStop`           | `agent-stop.sh`       | Automático | Autorização, checkpoint, reset de turno                                                                                                                                                                   |
| `subagentStart`       | `subagent-start.sh`   | Automático | Loga início de subagente                                                                                                                                                                                  |
| `subagentStop`        | `subagent-stop.sh`    | Automático | Loga fim de subagente                                                                                                                                                                                     |
| `preCompact`          | `pre-compact.sh`      | Automático | Checkpoint antes de compactação de contexto                                                                                                                                                               |
| `sessionEnd`          | `session-end.sh`      | Automático | Fecha seção, finaliza sessão, gera resumo                                                                                                                                                                 |

### Scripts manuais de emergência

| Script                   | Quando usar                                                                     |
| ------------------------ | ------------------------------------------------------------------------------- |
| `manual-session-init.sh` | sessionStart não disparou — inicializa sessão manualmente                       |
| `session-checkpoint.sh`  | Antes de qualquer encerramento ou mudança crítica                               |
| `start-section.sh`       | Mudar de fase lógica de trabalho                                                |
| `section-end.sh`         | Fechar seção manualmente com motivo                                             |
| `start-turn.sh`          | Declarar intenção do turno (primeiro ato de turno de trabalho)                  |
| `watchdog.sh`            | Verificar saúde do sistema: `--json` para relatório completo, `--quiet` para CI |

---

### Ciclo de vida canônico: SESSION → SECTION → TURN (Schema v4)

**Invariante absoluto**: sempre deve haver SESSION + SECTION + TURN ativos.

#### SECTION — Gerenciamento de Seções Temáticas

A seção `"início"` é criada **automaticamente** pelo `session-start.sh`. O agente deve abrir novas
seções ao mudar de fase lógica de trabalho:

```bash
# Abre nova seção (fecha a anterior automaticamente, se houver)
bash .github/hooks/scripts/start-section.sh "nome-da-seção"
bash .github/hooks/scripts/start-section.sh "implementação" "Fase B do plano — script X"

# Fecha seção manualmente (com motivo)
bash .github/hooks/scripts/section-end.sh "tarefa concluída"
```

**Quando usar `start-section.sh`**:

- Ao mudar de fase lógica (ex: análise → implementação → revisão)
- Ao iniciar um novo grupo temático de tarefas
- Quando a seção atual ficou grande (> 5 turnos) e o contexto mudou substancialmente

**Comportamento garantido**:

- Se há seção ativa, `start-section.sh` a fecha com `sectionEnd` antes de abrir a nova
- `session-end.sh` fecha automaticamente a última seção aberta (reason: `session_ended`)
- `session_stats.section_count` e `section_names[]` rastreiam todas as seções da sessão

#### TURN — Enriquecimento de Turnos

> **IMPORTANTE**: `userPromptSubmitted` dispara SOMENTE quando o usuário digita na caixa de chat do
> VS Code. Respostas ao `vscode_askQuestions` são **tool results** (processadas por
> `post-tool-use.sh`), NÃO novos prompts. Em sessões onde o usuário interage principalmente via
> `vscode_askQuestions`, o hook `userPromptSubmitted` dispara muito raramente (1x por SESSION ou
> menos). Use `preToolUse` para reminders confiáveis.

O início de cada turno é detectado **automaticamente** pelo hook `userPromptSubmitted`. O agente
pode (e deve) enriquecer o turno chamando `start-turn.sh` como **primeiro ato**:

```bash
# Declaração de intenção do turno (opcional mas recomendada)
bash .github/hooks/scripts/start-turn.sh "Implementar Fase A + rodar smoke-test"
bash .github/hooks/scripts/start-turn.sh
```

**Quando usar `start-turn.sh`**: idealmente como primeiro ato de todo turno de trabalho real. Pode
ser omitido em turnos puramente conversacionais (ex: responder uma pergunta simples).

---

### Consulta obrigatória à documentação oficial

Antes de tomar decisões técnicas sobre tecnologias externas, o agente SEMPRE deve verificar a
documentação oficial. Esta regra aplica-se a Copilot hooks, APIs, dependências, frameworks etc.

**Fluxo de pesquisa obrigatório:**

1. **Primeira tentativa — Context7 MCP** (documentação versionada e estruturada):

   ```
   mcp_io_github_ups_resolve-library-id: "<nome da biblioteca ou site>"
   mcp_io_github_ups_get-library-docs: context7CompatibleLibraryID + topic específico
   ```

   IDs Context7 relevantes para este projeto:

   | Recurso               | ID Context7                                          |
   | --------------------- | ---------------------------------------------------- |
   | GitHub Copilot hooks  | `/websites/github_en_copilot`                        |
   | VS Code customization | `/websites/code_visualstudio_copilot_copilot-custom` |
   | Node.js 24 API        | `/nodejs/node`                                       |
   | Puppeteer             | `/puppeteer/puppeteer`                               |
   | Zod (validação)       | `/colinhacks/zod`                                    |
   | Socket.io             | `/socketio/socket.io`                                |
   | Express.js            | `/expressjs/express`                                 |
   | better-sqlite3        | `/WiseLibs/better-sqlite3`                           |

2. **Segunda tentativa — web fetch direta** (se Context7 não resolver):

   URLs canônicas para referência:
   - Copilot hooks: `https://docs.github.com/en/copilot/reference/hooks-configuration`
   - Copilot customization: `https://docs.github.com/en/copilot/customizing-copilot`
   - Node.js API: `https://nodejs.org/api/`
   - Puppeteer: `https://pptr.dev/`
   - TypeScript JSDoc: `https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html`

3. **Nunca assumir** schema, API ou comportamento sem verificação — especialmente em campos de
   payloads externos (vide o bug `toolName` vs `tool_name` desta sessão).

4. **Registrar descobertas** em `DOCUMENTAÇÃO/REFERENCIAS/` quando encontrar schema ou contrato não
   documentado localmente.

**Quando usar Context7 vs web fetch:**

| Situação                                | Use                          |
| --------------------------------------- | ---------------------------- |
| API de biblioteca (método, tipo, opção) | Context7 primeiro            |
| Schema de payload de serviço externo    | Web fetch (docs oficiais)    |
| Comportamento de versão específica      | Context7 com topic de versão |
| Changelog ou novidades recentes         | Web fetch                    |
| Dúvida sobre qual variante usar         | Ambos em paralelo            |

## Rotas canônicas

| Necessidade             | Onde ir                                                |
| ----------------------- | ------------------------------------------------------ |
| Arquitetura oficial     | `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md`             |
| Índice da arquitetura   | `DOCUMENTAÇÃO/ARQUITETURA/README.md`                   |
| Status da documentação  | `DOCUMENTAÇÃO/RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md` |
| Bugs e auditorias       | `DOCUMENTAÇÃO/BUGS/`                                   |
| CI/CD e workflows       | `DOCUMENTAÇÃO/CI_CD/`                                  |
| Operações e runbooks    | `DOCUMENTAÇÃO/OPERACOES/`                              |
| Skills especializadas   | `.github/skills/README.md`                             |
| Hub de automação GitHub | `.github/README.md`                                    |
| Baseline curto          | `.github/instructions/project-canon.instructions.md`   |
| Protocolo de hooks      | `.github/instructions/hooks-protocol.instructions.md`  |

> Estas instruções têm prioridade equivalente às do `copilot-instructions.md` e são carregadas
> automaticamente pelo VS Code via `chat.useAgentsMdFile`.
