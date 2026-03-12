# HEAL v2 — Auto-Repair de Session ID

**Status**: Canônico | **Versão**: 2.0 | **Última atualização**: 2026-03-10

---

## O que é o HEAL v2

**HEAL v2** é o mecanismo de auto-reparo de `session_id` implementado no sistema de hooks do
Copilot. Ele detecta e corrige automaticamente a divergência entre o `session_id` presente no
payload de entrada dos hooks e o `session_id` ativo registrado em `session-context.json`.

### Problema que resolve

Durante operação normal, cada hook recebe o `session_id` atual no campo `$.session_id` do payload.
Em determinadas situações (principalmente ao retomar sessões após falha ou reinicialização do
Copilot), o payload pode chegar com um `session_id` diferente do contexto ativo — criando uma
**divergência (mismatch)** que, sem correção, causaria:

- Eventos de audit escritos com `session_id` errado
- Contexto de sessão contaminado por dados de outra sessão
- Métricas incoerentes no `session-stats`

---

## Arquitetura

### Componentes

| Componente                 | Arquivo                                       | Responsabilidade                                    |
| -------------------------- | --------------------------------------------- | --------------------------------------------------- |
| **HEAL Guard**             | `pre-tool-use.sh`                             | Detecta mismatch, conta consecutivos, aplica heal   |
| **Contador de mismatches** | `state/.mismatch_track.json`                  | Persiste contagem entre chamadas de hooks           |
| **Threshold**              | `hooks-lib/config.sh`: `HOOKS_HEAL_THRESHOLD` | Número de mismatches para auto-heal (padrão: 3)     |
| **Limpeza**                | `session-start.sh`                            | Limpa `.mismatch_track.json` ao iniciar nova sessão |
| **Evento de audit**        | `session_id_healed` em `audit.jsonl`          | Rastreabilidade de heals aplicados                  |

### Fluxo

```
pre-tool-use.sh recebe payload
    │
    ├─ SESSION_ID do payload == "" ?
    │   └─ Fallback: lê session.id do CTX_FILE (REV-06)
    │
    ├─ SESSION_ID (payload) != ACTIVE_ID (contexto) ?
    │   ├─ NÃO → operação normal
    │   └─ SIM → MISMATCH detectado
    │       │
    │       ├─ Incrementa .mismatch_track.json
    │       ├─ Loga aviso em audit.jsonl (evento: session_auto_recovery)
    │       │
    │       └─ CONSECUTIVE_MISMATCHES >= HOOKS_HEAL_THRESHOLD ?
    │           ├─ NÃO → apenas aviso (mismatch transitório, aguarda)
    │           └─ SIM → HEAL ATIVADO
    │               ├─ Atualiza session.id em session-context.json
    │               ├─ Reset .mismatch_track.json → 0
    │               └─ Loga evento: session_id_healed
```

---

## Configuração

Em `hooks-lib/config.sh`:

```bash
# Número de mismatches consecutivos para ativar auto-heal.
# Abaixo desse número, o mismatch é apenas logado como aviso.
readonly HOOKS_HEAL_THRESHOLD="${HOOKS_HEAL_THRESHOLD:-3}"
```

Para aumentar a tolerância (aceitar mais divergências antes de corrigir):

```bash
HOOKS_HEAL_THRESHOLD=5 bash .github/hooks/scripts/pre-tool-use.sh
```

---

## Eventos de Audit

### `session_auto_recovery`

Emitido toda vez que um mismatch de `session_id` é detectado.

```json
{
  "event": "session_auto_recovery",
  "session_id": "<active_id>",
  "timestamp": "...",
  "payload_session_id": "<id_do_payload>",
  "active_session_id": "<id_no_contexto>",
  "consecutive_mismatches": 2,
  "threshold": 3
}
```

### `session_id_healed`

Emitido quando o threshold é atingido e o contexto é reparado.

```json
{
  "event": "session_id_healed",
  "old_session_id": "<id_antigo>",
  "new_session_id": "<id_do_payload>",
  "timestamp": "...",
  "heal_reason": "consecutive_mismatches_threshold_reached"
}
```

---

## Anti-contaminação de sessão

A principal proteção contra contaminação cruzada entre sessões é a **guarda de `session_id`**
presente em `pre-tool-use.sh`, `post-tool-use.sh` e `agent-stop.sh`:

```bash
# Exemplo de guard (ctx_guard_session_id em common.sh)
ACTIVE_ID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
if [ -n "$SESSION_ID" ] && [ -n "$ACTIVE_ID" ] && [ "$SESSION_ID" != "$ACTIVE_ID" ]; then
  # mismatch → não modifica estado; dispara HEAL se threshold atingido
fi
```

O arquivo `state/.mismatch_track.json` é **sempre limpo** por `session-start.sh` ao iniciar uma nova
sessão, garantindo que contagens de mismatches de sessões anteriores não contaminem a nova.

---

## Migração de HEAL v1 → v2

| Aspecto                 | v1 (obsoleto)             | v2 (atual)                                                           |
| ----------------------- | ------------------------- | -------------------------------------------------------------------- |
| **Threshold**           | Hardcoded (2)             | Configurável via `HOOKS_HEAL_THRESHOLD`                              |
| **Persistência**        | Em memória (por execução) | Em arquivo (`state/.mismatch_track.json`)                            |
| **Limpeza**             | Nunca limpa               | `session-start.sh` limpa ao iniciar sessão                           |
| **Eventos**             | Nenhum                    | `session_auto_recovery` + `session_id_healed`                        |
| **Fallback Session_ID** | Não existe                | `pre-tool-use.sh` faz fallback ao CTX_FILE (REV-06)                  |
| **Rastreabilidade**     | Nenhuma                   | Auditável via `jq 'select(.event=="session_id_healed")' audit.jsonl` |

---

## Diagnóstico

Para verificar heals ocorridos em uma sessão:

```bash
# Listar todos os heals da sessão atual
jq -c 'select(.event=="session_id_healed")' \
  .github/hooks/state/audit.jsonl

# Contagem de mismatches detectados
jq 'select(.event=="session_auto_recovery") | .consecutive_mismatches' \
  .github/hooks/state/audit.jsonl

# Estado atual do tracker de mismatches
cat .github/hooks/state/.mismatch_track.json 2> /dev/null || echo '{"consecutive": 0}'
```

---

## Referências

- Implementação: `.github/hooks/scripts/pre-tool-use.sh`
- Configuração: `.github/hooks/hooks-lib/config.sh`
- Schema de eventos: `.github/hooks/contracts/events-contract.md`
- Protocolo de autorização: `DOCUMENTAÇÃO/HOOKS/PROTOCOLO-AUTORIZACAO.md`
