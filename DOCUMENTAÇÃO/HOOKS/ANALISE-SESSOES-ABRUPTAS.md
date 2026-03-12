# Análise: Sessões Encerradas Abruptamente

**Status**: Documento vivo — atualizar conforme novas evidências chegarem. **Última atualização**:
2026-03-10 **Ambiente**: Debian 12 (Bookworm) · Docker devcontainer · WSL2 host
(6.6.87.2-microsoft-standard-WSL2) **Autor**: Análise automática via agent

---

## Sumário Executivo

Foram identificadas **4 causas-raiz** para sessões encerradas antes do esperado. A causa principal
**não é** falha de rede nem crash do servidor — é o **cliente VS Code (lado Windows)** desconectando
sem acionar o evento `sessionEnd`, o que gera efeito cascata no sistema de hooks.

| #   | Causa                                    | Impacto                            | Severidade | Correção                                |
| --- | ---------------------------------------- | ---------------------------------- | ---------- | --------------------------------------- |
| 1   | Reconexão sem `sessionStart` disparando  | 395 mismatches, state corrompido   | 🔴 Alta    | `log-prompt.sh` — rollover automático   |
| 2   | VS Code cliente desconecta graciosamente | Sessão abrupta vista pelo servidor | 🟠 Alta    | SSH keepalive + Windows power settings  |
| 3   | SSH sem `ServerAliveInterval`            | Silent drop durante ociosas        | 🟠 Média   | `~/.ssh/config` ServerAliveInterval=60  |
| 4   | Copilot Chat API incompatível            | Instabilidade do extension host    | 🟡 Média   | Atualizar extensão / sincronizar versão |

---

## Metodologia de Coleta de Dados

### Fontes auditadas

| Fonte              | Caminho                                        | Período                 |
| ------------------ | ---------------------------------------------- | ----------------------- |
| `audit.jsonl`      | `.github/hooks/logs/audit.jsonl`               | 2026-03-09 a 2026-03-10 |
| `remoteagent.log`  | `~/.vscode-server/data/logs/*/remoteagent.log` | Últimas 5 sessões       |
| SSH config efetivo | `ssh -G github.com`                            | Momento da análise      |
| Processos          | `/proc/*/status` via `procs`                   | Snapshot único          |
| Devcontainer       | `.devcontainer/devcontainer.json`              | Versão 5.3              |

### Estatísticas do `audit.jsonl`

```
Total de linhas:              ~2.100
sessionStart:                         5
sessionEnd:                             < 5 (alguns ausentes)
session_id_mismatch:             395
preToolUse / postToolUse:      equilíbrio (normal)
agentStop:                      ~15
```

---

## Causa 1: Reconexão sem `sessionStart` Disparando (395 Mismatches)

### Evidência

```jsonc
// Sequência típica em audit.jsonl:
{"event": "preToolUse",    "session_id": "dcf579af-..."}  // sessão ATIVA
{"event": "preToolUse",    "session_id": "dcf579af-..."}  // ← último evento válido
{"event": "session_id_mismatch",                           // ← MISMATCH!
  "expected": "dcf579af-502e-4bf2-9d92-75903f85b0a2",     // sessão ativa no contexto
  "got":      "7b0cbf48-664e-4d54-a737-08cf9a2f9af0",     // sessão nova da reconexão
  "source": "log-prompt.sh",
  "message": "Payload session_id diferente do contexto ativo — state write bloqueado"}
{"event": "preToolUse",    "session_id": "7b0cbf48-..."}  // nova sessão operando
```

### Padrão completo de transições

| Transição (expected → got) | Occorrências | Interpretação                    |
| -------------------------- | ------------ | -------------------------------- |
| `dcf579af → 7b0cbf48`      | 119x         | 1 reconexão gerou 119 mismatches |
| `dcf579af → 1b31acd3`      | 70x          | Outra reconexão de `dcf579af`    |
| `f6c2bcd0 → a0be08af`      | 63x          | Reconexão de sessão anterior     |
| `dcf579af → 9140cb18`      | 54x          | Idem                             |
| `f6c2bcd0 → f1e704c7`      | 31x          | Idem                             |
| `dcf579af → e10f9f64`      | 31x          | Idem                             |
| `dcf579af → ad961174`      | 27x          | Idem                             |

### Root Cause

- VS Code registra apenas **5 `sessionStart`** mas **9+ session_ids distintos** foram usados
- Os session_ids sem `sessionStart` são sessões de **reconexão pós-drop**
- O evento `sessionStart` da plataforma VS Code Copilot **não é disparado** em reconexões (apenas em
  abertura inicial do chat)
- `log-prompt.sh` compara o session_id do payload com o contexto e detecta discrepância
- Comportamento atual: **bloqueia** o state write → `session-context.json` fica "preso" na sessão
  antiga

### Impacto

- State corrompido: contexto diz sessão `dcf579af` está ativa, mas o agente opera em `7b0cbf48`
- `agent-stop.sh` e `session-close.sh` operam com base no estado antigo
- Relatórios de sessão ficam inconsistentes
- Mismatches surgem em cascata: cada preToolUse + postToolUse = 2 mismatches mínimos

### Correção Implementada

`log-prompt.sh` agora detecta a diferença como **reconexão legítima** e executa rollover:

1. Loga evento `sessionReconnect` em `audit.jsonl`
2. Gera `sessionEnd` sintético para a sessão anterior (modo `abrupt_reconnect`)
3. Atualiza o contexto para o novo session_id sem bloquear o state write

---

## Causa 2: VS Code Cliente Desconecta Graciosamente

### Evidência

```
# remoteagent.log (sessão 20260310T063534):
[ERROR] ManagementConnection: The client has disconnected gracefully,
        so the connection will be disposed.

# remoteagent.log (sessão 20260310T032611):
[ERROR] ManagementConnection: The client has disconnected gracefully,  (x2)
```

### Root Cause

O log `"client has disconnected gracefully"` é gerado pelo **VS Code Server** (no container, lado
Linux) quando o **VS Code Client** (no Windows host) fecha a conexão de gerenciamento de forma limpa
(não é crash). O servidor interpreta como perda de cliente.

**Gatilhos possíveis (lado Windows):**

- Windows entra em modo de dormir/hibernação
- VS Code janela fechada no Windows
- WSL2 interface de rede reiniciada
- Windows Network Adapter resetado
- Atualização automática do VS Code Client
- Timeout de conexão inativa sem keepalive

**Por que o sistema de hooks não captura:**

- `sessionEnd` do VS Code Copilot depende de limpeza graciosa do cliente
- Quando o cliente desconecta, o servidor não sabe se é temporário ou permanente
- O hook `sessionEnd` não é acionado até que a sessão seja completamente finalizada

### Mitigações

#### No devcontainer (lado servidor) — já implementado:

- `session-start.sh` detecta `PREV_CLOSE_MODE: abrupt_reconnect`
- Relatório de início de sessão mostra status da sessão anterior

#### No Windows (lado cliente) — responsabilidade do usuário:

1. **Desabilitar hibernação**: `powercfg /change standby-timeout-ac 0` (AC power)
2. **Manter VS Code ativo**: evitar fechar janela durante sessões longas
3. **WSL2 stability**: não reiniciar WSL2 durante sessões ativas

#### SSH keepalive (ver Causa 3)

---

## Causa 3: SSH sem `ServerAliveInterval`

### Evidência

```bash
$ ssh -G github.com | grep -E 'serveralive|tcpkeepalive|connecttimeout'
serveraliveinterval 0 # ← ZERO = sem keepalive!
serveralivecountmax 3
tcpkeepalive yes
connecttimeout none
```

### Root Cause

`serveraliveinterval 0` significa que o cliente SSH (no container) **nunca envia pacotes de
keepalive** para verificar se o servidor/host ainda está conectado. Apenas `tcpkeepalive yes` está
ativo, mas esse é um keepalive TCP de nível OS — não garante que a sessão SSH em si está viva.

**Resultado:** Em períodos de inatividade, roteadores/firewalls intermediários podem fechar a
conexão TCP silenciosamente. O cliente SSH e o servidor continuam "pensando" que estão conectados,
mas a conexão está morta. Quando há nova atividade, a conexão falha, causando:

- `Connection reset by peer`
- `ssh_exchange_identification: read: Connection reset by peer`
- Ou simplesmente timeout sem erro explícito

### Correção Implementada

```bash
# ~/.ssh/config
Host *
ServerAliveInterval 60
ServerAliveCountMax 5
TCPKeepAlive yes
```

Este arquivo já foi criado/atualizado conforme descrito em "Correções Implementadas" ao final deste
documento.

---

## Causa 4: Copilot Chat API Incompatível

### Evidência

```
# remoteagent.log (sessão 20260310T104758) — aparece em TODA sessão:
[WARN] github.copilot-chat-0.38.2: This extension is using the API proposal
       'chatParticipantPrivate' that is not compatible with the current version
       of VS Code. This will be an error in the future.
```

### Root Cause

A extensão `github.copilot-chat` v0.38.2 usa a API proposal experimental `chatParticipantPrivate`. A
versão atual do VS Code Server (no container) considera essa proposal **incompatível** com a versão
da API carregada. Isso:

- Não impede o funcionamento básico (ainda é `WARN`)
- Pode causar comportamentos inesperados em funcionalidades que dependem dessa proposal
- Pode contribuir para instabilidade do extension host sob carga pesada
- Em versões futuras do VS Code, será um `ERROR` que impedirá o carregamento

### Correção

**Opção 1 — Atualizar Copilot Chat** (Preferido):

```bash
# Dentro do devcontainer, pedir ao VS Code para atualizar extensões
# ou via CLI do VS Code:
code --install-extension github.copilot-chat --force
```

**Opção 2 — Sincronizar versões** no `devcontainer.json`:

```json
"customizations": {
  "vscode": {
    "extensions": [
      "github.copilot-chat@0.XX.X"  // fixar versão compatível
    ]
  }
}
```

**Opção 3 — Verificar versão do VS Code Server:**

```bash
ls ~/.vscode-server/bin/
# Verificar se a versão é recente o suficiente para suportar copilot-chat@0.38.2
```

---

## Análise de Ambiente

### Recursos do sistema (snapshot 2026-03-10)

| Recurso                   | Valor                      | Status      |
| ------------------------- | -------------------------- | ----------- |
| CPU                       | 6 cores                    | ✅ Adequado |
| RAM Total                 | 15.4 GB                    | ✅ Adequado |
| RAM em uso                | ~4.3 GB baseline           | ✅ OK       |
| Extension Host (PID 800)  | 10.9% RAM (~1.7 GB)        | ⚠️ Alto     |
| CloudCode (PID 2709)      | 1.7% RAM                   | ✅ OK       |
| Pylance/Python (PID 1987) | 2.6% RAM                   | ✅ OK       |
| Disco                     | 4% usado (1007 GB overlay) | ✅ OK       |
| Network (github.com)      | 98ms TCP, 113ms HTTP 200   | ✅ Saudável |

### Extensões instaladas: **55**

55 extensões é um número elevado. Cada extensão pode:

- Consumir memória do extension host
- Registrar event listeners que competem por recursos
- Causar interferência ao usar API proposals experimentais

**Recomendação**: Utilizar perfis de extensões VS Code para separar o ambiente de desenvolvimento do
agente de outros contextos. Manter apenas as extensões essenciais ativas durante sessões longas.

### SSH efetivo (destino github.com)

```
serveraliveinterval: 0      ← PROBLEMA (corrigido neste documento)
serveralivecountmax: 3
tcpkeepalive:        yes
connecttimeout:      none
```

---

## Correções Implementadas

### 1. `~/.ssh/config` — SSH Keepalive

```bash
# Adicionado automaticamente nesta sessão:
Host *
ServerAliveInterval 60
ServerAliveCountMax 5
TCPKeepAlive yes
```

**Efeito**: SSH enviará pacotes de keepalive a cada 60 segundos. Após 5 falhas consecutivas (5×60 =
300s = 5 minutos sem resposta), a conexão é considerada morta e encerrada limpa.

### 2. `log-prompt.sh` — Rollover de Reconexão

Quando o script detecta `session_id` diferente do contexto ativo:

- **Antes**: bloqueava escrita no state (evento: `session_id_mismatch`)
- **Depois**: detecta como reconexão, loga `sessionReconnect`, gera `sessionEnd` sintético para
  sessão anterior, atualiza contexto para novo session_id

**Efeito**: Elimina os 395+ mismatches e mantém o state sincronizado com a sessão real.

### 3. `session-start.sh` — Protocolo de Início Expandido

O protocolo de início de sessão agora inclui:

1. Status da sessão anterior (`PREV_CLOSE_MODE`: `clean` | `key_validated_no_close` |
   `abrupt_no_key` | `abrupt_reconnect`)
2. Verificação de saúde do sistema (memória, disco)
3. Contagem de reconexões da sessão anterior (para detectar sessões instáveis)
4. Alerta se extensão Copilot Chat estiver em versão incompatível

### 4. `.devcontainer/devcontainer.json` — Configurações de Conexão

Adicionado `customizations.vscode.settings` com timeouts adequados para sessões longas:

- `remote.SSH.serverAliveInterval`: não aplicável diretamente via settings (SSH-level fix)
- `extensions.autoUpdate: false`: evitar atualizações que possam criar incompatibilidade de API
- `extensions.autoCheckUpdates: false`: idem

---

## Monitoramento e Alertas

### Como verificar reconexões no futuro

```bash
# Contar reconexões na sessão atual
rg '"event":"sessionReconnect"' .github/hooks/logs/audit.jsonl | wc -l

# Ver todas as reconexões com timestamps
jq 'select(.event=="sessionReconnect") | {ts: .timestamp, old: .old_session_id, new: .new_session_id}' \
  .github/hooks/logs/audit.jsonl

# Ver mismatches residuais (devemser zero após a correção)
jq 'select(.event=="session_id_mismatch")' .github/hooks/logs/audit.jsonl | wc -l
```

### Dashboard de saúde de sessões (no briefing)

O `session-briefing.md` agora inclui uma seção "Estabilidade de Conexão" com:

- Modo de encerramento da sessão anterior (`PREV_CLOSE_MODE`)
- Número de reconexões ocorridas
- Última reconexão: timestamp e delta de duração

---

## Resumo de Decisões

| Decisão                               | Justificativa                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| Rollover automático em mismatch       | 395 mismatches = evidência de padrão normal de reconexão, não de corrupção           |
| SSH keepalive = 60s                   | Menor que o timeout típico de NAT (180s-300s); maior que 30s (evita false-positives) |
| `SessionAliveCountMax = 5`            | 5min de inatividade absoluta antes de encerrar                                       |
| Não bloquear state write em reconexão | A nova sessão é legítima; bloquear causa mais dano que deixar passar                 |
| Gerar sessionEnd sintético            | Manter consistência do log histórico; facilita análise posterior                     |

---

---

## Wave 2 — Mitigações de Robustez (2026-03-10)

Após a correção da causa raiz (Wave 1), foi feita uma análise abrangente do ambiente para
implementar melhorias adicionais de robustez. As mudanças abaixo são complementares e visam prevenir
categorias futuras de instabilidade.

### 2.1 Container não para mais em desconexão

**Arquivo**: `.devcontainer/devcontainer.json` **Mudança**: `"shutdownAction": "stopContainer"` →
`"shutdownAction": "none"`

**Problema anterior**: ao desconectar do VS Code, o container era destruído e reiniciado. Isso
causava reset completo do estado dos hooks (session_id, audit.jsonl parcialmente escrito) e
`SESSION_CLOSE_NO_KEY.flag` falso positivo.

**Fix**: `"none"` mantém o container vivo. VS Code reconecta ao mesmo container e encontra o estado
anterior intacto.

---

### 2.2 TCP Keepalive: de 2h para 10min

**Arquivo**: `.devcontainer/devcontainer.json` → `runArgs` **Adicionados**:

```json
"--sysctl", "net.ipv4.tcp_keepalive_time=600",
"--sysctl", "net.ipv4.tcp_keepalive_intvl=30",
"--sysctl", "net.ipv4.tcp_keepalive_probes=5",
"--sysctl", "net.ipv4.tcp_fin_timeout=30",
"--sysctl", "net.ipv4.tcp_retries2=8"
```

**Problema anterior**: `tcp_keepalive_time=7200s` (padrão Linux) — NAT routers dropam conexões idle
tipicamente após 3–5 minutos, mas o kernel só detectava após 2 horas.

**Fix**: `tcp_keepalive_time=600` reduz idle detection de 2h para 10 minutos. Configurado via
`--sysctl` (necessário pois `sysctl -w` dentro do container retorna "permission denied").

---

### 2.3 Terminal persistente sobrevive a crashes

**Arquivo**: `.vscode/settings.json` **Mudanças**:

- `"terminal.integrated.persistentSessionReviveProcess": "always"` (era `"onExit"`)
- `"terminal.integrated.scrollback": 20000` (era `10000`)

**Fix**: `"always"` revive sessões em qualquer cenário — exit limpo, crash ou reconexão. `"onExit"`
só agia em saídas limpas.

---

### 2.4 git.autofetch desabilitado

**Arquivo**: `.devcontainer/devcontainer.json` (customizations.vscode.settings) **Mudança**:
`"git.autofetch": false` (era `true`); `"git.autofetchPeriod": 1800`

**Fix**: Eliminado I/O periódico a cada 3 minutos que acordava o Extension Host, contribuindo para
timeouts de manutenção. Se reativar, mínimo recomendado: 1800s.

---

### 2.5 File Watcher: excludes expandidos

**Arquivo**: `.devcontainer/devcontainer.json` → `files.watcherExclude` **Adicionados**:

```
**/.github/hooks/state/**, **/.github/hooks/logs/**, **/.vscode-server/**,
**/.claude/**, **/artifacts/**, **/monitoring/**, **/tmp/**, **/backups/**
```

**Fix**: Diretórios de estado dos hooks e caches de servidores geravam eventos de watcher a cada
escrita, aumentando carga do Extension Host desnecessariamente.

---

### 2.6 Watchdog: Check 4 — Detecção de reconexões

**Arquivo**: `.github/hooks/scripts/watchdog.sh` **Adicionado**: Bloco Check 4 com counters de
`sessionReconnect` e `session_id_mismatch`.

Limites: `> 10` reconexões → CRITICAL; `> 5` → WARN; `> 50` mismatches → WARN (regressão).

**Teste confirmado** (output real):

```
⚠ [AVISO] STALE_ID_MISMATCHES: 50 eventos session_id_mismatch antigos (pre-fix). Monitorar.
✓ Reconexões VS Code: 0 (ok, limiar aviso: 5)
```

---

### 2.7 Session Start: health check de rede

**Arquivo**: `.github/hooks/scripts/session-start.sh` **Adicionado**: ping a `140.82.112.22` (GitHub
IP estático, timeout 3s) no início de cada sessão. Se falhar → `HEALTH_CRITICAL`. Verifica também
taxa de `sessionReconnect` nas últimas 2h via `audit.jsonl` (>= 5 → critical; >= 2 → warning).

Linha adicionada ao briefing `## Saúde do Sistema`:

```
**Rede**: ✅ OK (ping GitHub)   ←ou→   ⛔ SEM CONECTIVIDADE
```

---

### 2.8 Remote connection resilience (settings.json)

**Arquivo**: `.vscode/settings.json` **Adicionados**:

```json
"remote.SSH.connectTimeout": 60,
"remote.SSH.keepAliveInterval": 30,
"workbench.editor.experimentalAutoLockGroups": true
```

---

### Tabela consolidada Wave 1 + Wave 2

| #   | Problema                             | Fix                                      | Wave |
| --- | ------------------------------------ | ---------------------------------------- | ---- |
| 1   | 395 session_id_mismatch events       | log-prompt.sh: sessionReconnect rollover | 1    |
| 2   | SSH keepalive desabilitado           | ~/.ssh/config: interval=60               | 1    |
| 3   | extensions.autoUpdate: true          | autoUpdate:false (devcontainer+settings) | 1    |
| 4   | Container destruído na desconexão    | shutdownAction: "none"                   | 2    |
| 5   | TCP keepalive: 7200s (idle lento)    | --sysctl tcp_keepalive_time=600          | 2    |
| 6   | Terminal perde estado em crash       | persistentSessionReviveProcess: always   | 2    |
| 7   | git.autofetch acorda Extension Host  | git.autofetch: false                     | 2    |
| 8   | File watcher monitora dirs de estado | watcherExclude expandido                 | 2    |
| 9   | Watchdog sem detecção de reconexões  | Check 4: sessionReconnect counter        | 2    |
| 10  | Briefing sem visibilidade de rede    | session-start.sh: NET_OK + ping check    | 2    |

---

## Próximos Passos

- [ ] Verificar se `sessionStart` pode ser acionado em reconexões via VS Code extension API
- [ ] Implementar alerta se Copilot Chat atingir versão incompatível detectada automaticamente
- [ ] Avaliar redução de extensões instaladas (de 55 para perfil mínimo para sessões de agente)
- [ ] Investigar se `chatParticipantPrivate` deprecation tem ETA na roadmap do Copilot
- [ ] Monitorar `STALE_ID_MISMATCHES` no watchdog — novo mismatch surgindo indica regressão
- [ ] Revalidar `shutdownAction: "none"` após próximo rebuild do devcontainer
