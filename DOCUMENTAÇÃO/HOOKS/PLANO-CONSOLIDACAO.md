# Plano de Consolidação — Sistema de Hooks (Sessão 7)

> **Status**: Em elaboração | **Data**: 2026-03-09
> **Decisões do usuário**: Registradas via vscode_askQuestions em 2026-03-09

---

## 1. Definições Canônicas

### SESSION (Sessão)

| Atributo | Valor |
|---|---|
| **Criação** | Hook `sessionStart` disparado pelo Copilot ao abrir chat |
| **Término** | Hook `sessionEnd` disparado ao fechar chat (qualquer razão) |
| **UUID** | Fornecido pelo Copilot — imutável durante a sessão |
| **Custo** | **Premium requests ocorrem APENAS na inicialização** (carregamento de contexto) |
| **Frequência esperada** | Uma por dia |
| **Scripts** | `session-start.sh`, `session-end.sh` |
| **Duração típica** | Horas — pode cruzar múltiplas Sections e centenas de Turns |

> ⚠️ **Regra**: uma SESSION deve ser iniciada o mínimo possível (idealmente só uma vez por dia).
> Qualquer fechamento acidental desperdiça context loading premium.

---

### SECTION (Seção Temática)

| Atributo | Valor |
|---|---|
| **Criação** | Manual pelo agente via `start-section.sh` |
| **Término** | Manual via `section-end.sh`, ou implícito ao abrir nova Section |
| **Custo** | **Gratuito** — sem consumo de premium |
| **Frequência esperada** | Múltiplas por SESSION (virtualmente infinitas) |
| **Scripts** | `start-section.sh`, `section-end.sh` |
| **Propósito** | Agrupar Turns por tema; registrar duração temática; organizar audit.jsonl |

> Uma Section pode conter virtualmente infinitos Turns.

---

### TURN (Turno)

| Atributo | Valor |
|---|---|
| **Criação** | Hook `userPromptSubmitted` |
| **Término** | Hook `agentStop` |
| **Custo** | **Gratuito** — sem consumo de premium |
| **Frequência esperada** | Múltiplos por Section (virtualmente infinitos) |
| **Scripts** | `pre-tool-use.sh`, `post-tool-use.sh`, `agent-stop.sh` |
| **Regra crítica** | NUNCA encerrar sem chamar `vscode_askQuestions` |

---

### Hierarquia

```
SESSION (1 por dia — premium apenas na inicialização)
   └── SECTION "Planejamento" (gratuita, infinitas por sessão)
   │      └── TURN 1 (gratuito, infinitos por seção)
   │      └── TURN 2
   │      └── TURN N
   └── SECTION "Implementação"
   │      └── TURN N+1
   │      └── ...
   └── SECTION "Revisão e Encerramento"
          └── TURN Final (com SESSION CLOSE KEY obrigatório)
```

---

### `vscode_askQuestions` — Papel Central

- **Custo**: **completamente gratuito, sem qualquer limite**
- **Uso esperado**: chamada em TODO turno, múltiplas vezes por turno
- **Função**: manter o loop ativo; autorizar encerramento de Turns
- **NUNCA reduzir**: aumentar o uso é sempre correto

---

## 2. Hardening: SESSION CLOSE KEY

### Problema

O `sessionEnd` é disparado pelo Copilot quando a janela fecha — **por qualquer razão**:
crash, timeout, fechamento acidental, ou encerramento legítimo. Atualmente, não há
distinção auditável entre esses casos.

### Solução: Chave Dinâmica por Sessão

#### Decisões do usuário (2026-03-09):
- **Formato**: `ENCERRAR-XXXXXXXX` (8 caracteres hex aleatórios, maiúsculos) — dinâmica por sessão
- **Captura**: TODAS as respostas de `vscode_askQuestions` + última resposta no `session-context.json`
- **Sem chave**: `SESSION_CLOSE_NO_KEY.flag` + alerta no próximo briefing
- **Anúncio**: Template E (Session Kickoff) + `session-briefing.md`

---

### Fluxo Completo

```
[SESSION START]
session-start.sh:
  1. Gera CLOSE_KEY = "ENCERRAR-$(openssl rand -hex 4 | tr a-z A-Z)"
  2. Armazena em session.close_key (session-context.json)
  3. Inicializa session.close_key_validated = false
  4. Exibe chave no session-briefing.md (seção destacada)
  5. Verifica SESSION_CLOSE_NO_KEY.flag — alerta se encontrar

[DURANTE A SESSÃO — cada vscode_askQuestions]
post-tool-use.sh (quando tool_name = vscode_askQuestions):
  1. Captura tool_response (resposta do usuário)
  2. Guarda como current_turn.last_askquestions_response no contexto
  3. Appenda evento askQuestions_response no audit.jsonl
  4. Se response contém o close_key:
     → session.close_key_validated = true
     → log sessionClose_key_validated no audit.jsonl

[ENCERRAMENTO LEGÍTIMO]
Agente chama Template F (Session Close) no vscode_askQuestions:
  - Campo livre com instrução: "Digite a chave de encerramento para confirmar"
  - Usuário digita ENCERRAR-XXXXXXXX
  → post-tool-use.sh detecta chave → session.close_key_validated = true

[SESSION END]
session-end.sh:
  1. Lê session.close_key_validated
  2. Se true:
     → log sessionEnd_authorized_with_key
     → remove SESSION_CLOSE_NO_KEY.flag (se existir)
  3. Se false:
     → log sessionEnd_no_key
     → cria SESSION_CLOSE_NO_KEY.flag (com session_id, ts, turn_count)
```

---

## 3. Mudanças no Schema (v3)

### Adições ao session-context.json

```json
{
  "session": {
    "id": "...",
    "started_at": "...",
    "ended_at": null,
    "end_reason": null,
    "close_key": "ENCERRAR-A3F5B891",
    "close_key_validated": false,
    "source": "...",
    "cwd": "..."
  },
  "current_turn": {
    "...",
    "last_askquestions_response": null
  }
}
```

### Novos eventos no audit.jsonl

| Evento | Quando |
|---|---|
| `askQuestions_response` | Toda resposta de `vscode_askQuestions` (post-tool-use.sh) |
| `sessionClose_key_validated` | Quando a close_key é detectada na resposta |
| `sessionEnd_authorized_with_key` | session-end.sh com chave válida |
| `sessionEnd_no_key` | session-end.sh sem chave registrada |

---

## 4. Templates Copilot

### Template E — Session Kickoff (ATUALIZADO)

O Template E já existe no AGENTS.md. Adicionar:
- Anúncio da `session.close_key` lida do `session-context.json`
- Instrução: "Esta chave deve ser digitada ao encerrar a sessão"

### Template F — Session Close (NOVO)

```json
{
  "header": "Encerramento de Sessão",
  "question": "Para confirmar o encerramento, digite a CHAVE DE ENCERRAMENTO informada no início desta sessão.",
  "options": [
    {"label": "Encerrar sem commitar — mudanças preservadas localmente"},
    {"label": "Commitar e encerrar"},
    {"label": "Não encerrar agora — continuar trabalhando"},
    {"allowFreeformInput": true, "label": "Digite a CHAVE: ENCERRAR-XXXXXXXX"}
  ]
}
```

---

## 5. Plano de Implementação

### Fase A — Scripts (sessão atual)

| # | Arquivo | Mudança | Dependência |
|---|---|---|---|
| A1 | `session-start.sh` | Gerar close_key, schema v3, alerta SESSION_CLOSE_NO_KEY, anúncio no briefing | — |
| A2 | `post-tool-use.sh` | Capturar tool_response de vscode_askQuestions, detectar close_key | A1 |
| A3 | `session-end.sh` | Validar close_key_validated, criar/remover SESSION_CLOSE_NO_KEY.flag | A1, A2 |

### Fase B — Documentação (sessão atual)

| # | Arquivo | Mudança |
|---|---|---|
| B1 | `AGENTS.md` | Definições SESSION/SECTION/TURN, Template F (Session Close), atualizar Template E |
| B2 | `PROTOCOLO-AUTORIZACAO.md` | Seção sobre SESSION CLOSE KEY |
| B3 | `README.md` | Schema v3, novos eventos, fluxo atualizado |
| B4 | `AUDIT-SCHEMA.md` | Novos eventos: askQuestions_response, sessionClose_key_validated, etc. |

### Fase C — Validação (sessão atual)

| # | Ação |
|---|---|
| C1 | Atualizar `smoke-test.sh` com checks para close_key e close_key_validated |
| C2 | Rodar smoke-test — 43+ checks devem passar |
| C3 | Simular encerramento com chave correta |
| C4 | Simular encerramento sem chave (verificar flag) |

---

## 6. Arquivos Modificados

### Scripts
- `.github/hooks/scripts/session-start.sh` — geração de close_key + alerta
- `.github/hooks/scripts/post-tool-use.sh` — captura de respostas askQuestions
- `.github/hooks/scripts/session-end.sh` — validação da close_key

### State files (novos/modificados)
- `.github/hooks/state/session-context.json` — schema v3 (close_key, close_key_validated, last_askquestions_response)
- `.github/hooks/state/SESSION_CLOSE_NO_KEY.flag` — novo flag file (gitignored)

### Documentação
- `DOCUMENTAÇÃO/HOOKS/AGENTS.md` — definições + Template F
- `DOCUMENTAÇÃO/HOOKS/PROTOCOLO-AUTORIZACAO.md` — session close key
- `DOCUMENTAÇÃO/HOOKS/README.md` — schema v3 + eventos
- `DOCUMENTAÇÃO/HOOKS/AUDIT-SCHEMA.md` — novos eventos
- `DOCUMENTAÇÃO/HOOKS/MELHORIAS.md` — sessão 7

---

## 7. Gitignore

Adicionar ao `.gitignore`:
```
.github/hooks/state/SESSION_CLOSE_NO_KEY.flag
```

---

*Criado em 2026-03-09 durante sessão de consolidação arquitetural.*
