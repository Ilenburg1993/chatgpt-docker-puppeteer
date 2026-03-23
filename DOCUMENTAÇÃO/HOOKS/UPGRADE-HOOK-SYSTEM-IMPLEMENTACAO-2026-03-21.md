# Upgrade do Hook System — Implementação Técnica (2026-03-21)

## Escopo

Este documento registra a implementação prática do upgrade do sistema de hooks, com foco em:

- robustez de estado (`session.json`);
- consistência de lifecycle de TURN/SUBTURN;
- conformidade de output dos hooks;
- hardening de parsing e portabilidade;
- redução de drift operacional.

## Base de trabalho

A implementação foi guiada por leitura direta de código (scripts + libs + API modular de hooks) e pela documentação oficial de hooks do VS Code/GitHub, sem depender apenas de documentação interna.

## Mudanças aplicadas

### 1) Escrita JSON real em estado aninhado

**Arquivo:** `.github/hooks/lib/common.sh`

- Adicionada função `update_nested_state_json()` para persistir objetos/arrays com `argjson`.
- Evita serialização incorreta de objetos como string literal durante migrações.

### 2) Correção da migração de schema (objetos)

**Arquivo:** `.github/hooks/lib/api/13-state-version.sh`

- Migração passou a usar `update_nested_state_json` para:
  - `session_stats.tools_by_type`;
  - `compliance.template_usage`.
- `template_usage` agora é inicializado com shape canônico `{A..G}`.

### 3) Stop: decisão antes de mutação persistente

**Arquivo:** `.github/hooks/lib/stop-lib.sh`

- Fluxo não-autorizado foi reordenado:
  - se `strict_turn_close=true`, o hook bloqueia antes de encerrar/mutar o turno;
  - só muta estado de turno não-autorizado quando `strict_turn_close=false`.
- Adicionado evento de auditoria: `turnEnd_blocked_unauthorized`.

### 4) Portabilidade de tempo no Stop

**Arquivo:** `.github/hooks/lib/stop-lib.sh`

- `_record_turn_duration()` deixou de usar `date -d` diretamente.
- Conversão passou a usar helper portável `_iso_to_epoch`.

### 5) UserPromptSubmit com saída única

**Arquivo:** `.github/hooks/lib/user-prompt-submit-lib.sh`

- Introduzido buffer `_ups_system_message` + helper `_ups_append_msg()`.
- Múltiplos lembretes passaram a ser agregados e emitidos em um único `hook_out_system_message` por execução.

### 6) Parse de `fetch_webpage` compatível com `urls[]`

**Arquivo:** `.github/hooks/lib/api/02-parse.sh`

- `HOOK_FETCH_URL` agora resolve `url` ou `urls[0]`.
- Novo campo exportado: `HOOK_FETCH_URLS_JSON`.

### 7) Reset/export do novo campo de parse

**Arquivo:** `.github/hooks/lib/api/01-vars.sh`

- Adicionado reset de `HOOK_FETCH_URLS_JSON="[]"`.
- Adicionado export da variável para evitar contaminação cross-call.

### 8) Remoção de early-exit em reminders permissivos

**Arquivos:**
- `.github/hooks/lib/pre-tool-use-lib.sh`
- `.github/hooks/lib/post-tool-use-lib.sh`

**PreToolUse**
- Reminders `allow` (soft/protocol) deixaram de encerrar prematuramente.
- Contexto passa a ser agregado em `_pre_allow_context` e emitido no fim da execução.

**PostToolUse**
- Reminder de `git push/commit` não faz mais `exit` antecipado.
- Contexto extra é emitido ao final via `_post_additional_context`.

### 9) Fallback canônico para Session ID no report final

**Arquivo:** `.github/hooks/lib/session-close-lib.sh`

- Relatório final agora usa:
  - `.session_id` (preferencial);
  - fallback para `.vs_code_session_id`.

### 10) PreCompact com retenção configurável

**Arquivo:** `.github/hooks/lib/pre-compact-lib.sh`

- `MAX_CHECKPOINTS` passou a usar `HOOKS_CHECKPOINT_MAX` (default 10).

### 11) Limpeza adicional de inconsistência em `init_state`

**Arquivo:** `.github/hooks/lib/common.sh`

- Removida duplicação redundante de chaves `template_usage`/`last_template` no objeto `compliance`.

### 12) Redução de drift documental mínimo (paths canônicos)

**Arquivos:**
- `.github/instructions/hooks-protocol.instructions.md`
- `.github/copilot-instructions.md`
- `DOCUMENTAÇÃO/HOOKS/README.md`

- Atualizado path canônico de biblioteca para `.github/hooks/lib/*` nas instruções principais.
- Inserida nota de compatibilidade no README de hooks para distinguir nomes legados (`agent-stop.sh`,
  `hooks-lib`) do runtime atual (`stop.sh`, `lib/`).

## Arquivos alterados

- `.github/hooks/lib/common.sh`
- `.github/hooks/lib/api/13-state-version.sh`
- `.github/hooks/lib/stop-lib.sh`
- `.github/hooks/lib/user-prompt-submit-lib.sh`
- `.github/hooks/lib/api/02-parse.sh`
- `.github/hooks/lib/api/01-vars.sh`
- `.github/hooks/lib/post-tool-use-lib.sh`
- `.github/hooks/lib/session-close-lib.sh`
- `.github/hooks/lib/pre-compact-lib.sh`
- `.github/instructions/hooks-protocol.instructions.md`
- `.github/copilot-instructions.md`
- `DOCUMENTAÇÃO/HOOKS/README.md`

## Impacto esperado

- Menor risco de corrupção de lifecycle ao bloquear encerramento de turno.
- Migrações de schema mais confiáveis em estados legados.
- Menor chance de output inválido por múltiplas emissões no mesmo hook.
- Melhor rastreabilidade de ferramentas após `askQuestions` em cenários longos.
- Melhor compatibilidade com payloads de `fetch_webpage`.

## Itens pendentes (não bloqueantes)

1. Atualização ampla de documentação histórica com nomes legados (`agent-stop.sh`, `hooks-lib`) para refletir runtime atual (`stop.sh`, `lib/`).
2. Revalidação completa da suíte de smoke/integration dos hooks após merge das mudanças.
3. Fortalecer testes de contrato para “single output” em `UserPromptSubmit` e para parse de `fetch_webpage` com múltiplas URLs.

## Nota operacional sobre memória do agente

Foi solicitado registrar de forma persistente a regra de **não encerrar turn/session sem autorização/pedido expresso via fluxo de pergunta interativa**. O ambiente desta execução não expôs caminho gravável de memória persistente (`/memories/*`) via filesystem.

A diretriz foi mantida operacionalmente nesta implementação e documentada neste artefato para rastreabilidade.
