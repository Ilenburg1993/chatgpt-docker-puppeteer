# Nível 5: MONITOR + Context Compaction Strategy

**Status**: 🟡 DESIGN (NOT IMPLEMENTED YET) **Data**: 2026-03-15 **Prioridade**: MÉDIA (Bom ter, não
bloqueante)

---

## 1. Nível 5: MONITOR — Dashboard + Real-time Alerting

### Objetivo

Exibir indicadores visuais em tempo real no dashboard sobre status de SESSION CLOSE authorization +
anomalias detectadas na lifecycle.

### Escopo

#### 1.1 Dashboard Indicators (Frontend — Vue/Vite)

**Componente: SessionCloseStatus.vue**

```vue
<!-- Exibe status visual de Session Close (na navbar ou sidebar) -->
<template>
  <div :class="statusClass">
    <span v-if="isAuthorized" class="status-authorized"> 🔓 AUTH (close_key validated) </span>
    <span v-else-if="isRequested" class="status-requested"> ⏳ Aguardando CLOSE KEY... </span>
    <span v-else class="status-active"> 🔒 SESSION ATIVA </span>

    <!-- Botão rápido para Template F se não autorizado -->
    <button v-if="!isAuthorized" @click="promptCloseKey" class="btn-close-session">
      Encerrar Sessão
    </button>
  </div>
</template>

<script>
export default {
  name: 'SessionCloseStatus',
  data() {
    return {
      sessionStatus: {},
    };
  },
  computed: {
    isAuthorized() {
      return this.sessionStatus.close_key_validated === true;
    },
    isRequested() {
      return this.sessionStatus.auth_requested === true;
    },
    statusClass() {
      if (this.isAuthorized) return 'status-authorized';
      if (this.isRequested) return 'status-requested';
      return 'status-active';
    },
  },
  mounted() {
    this.subscribeToSessionStatus();
  },
  methods: {
    subscribeToSessionStatus() {
      // Conecta ao Socket.io para receber atualizações em tempo real
      this.$io.on('session:status_updated', (data) => {
        this.sessionStatus = data;
      });
    },
    promptCloseKey() {
      // Dispara vscode_askQuestions Template F via SDK
      this.$askVscode('template-f', {
        title: 'Encerrar Sessão',
        message: 'Digite a close_key para autorizar encerramento',
      });
    },
  },
};
</script>

<style scoped>
.status-authorized {
  color: green;
  font-weight: bold;
}
.status-requested {
  color: orange;
  font-weight: bold;
}
.status-active {
  color: gray;
}
.btn-close-session {
  background: __main;
  padding: 8px 16px;
}
</style>
```

#### 1.2 Anomaly Alerts Panel (Frontend)

**Componente: SessionAnomalies.vue**

```vue
<template>
  <div v-if="anomalies.length > 0" class="anomalies-panel">
    <h3>🚨 Detected Anomalies</h3>
    <div v-for="anomaly in anomalies" :key="anomaly.id" class="anomaly-item">
      <span class="severity" :class="anomaly.severity">{{ anomaly.severity }}</span>
      <span class="type">{{ anomaly.anomaly_type }}</span>
      <p class="message">{{ anomaly.message }}</p>
      <button class="btn-resolve" @click="toggleRecovery(anomaly)">Acknowledge & Recover</button>
    </div>
  </div>
</template>

<script>
export default {
  name: 'SessionAnomalies',
  data() {
    return {
      anomalies: [],
    };
  },
  mounted() {
    this.$io.on('session:anomalies_detected', (data) => {
      this.anomalies = data.anomalies || [];
    });
  },
  methods: {
    toggleRecovery(anomaly) {
      // Invoca Template E+ (Multi-Decision Checkpoint)
      // para que agente reconheça anomalia + decida próximos passos
      this.$askVscode('template-e-plus', {
        anomaly_id: anomaly.id,
        anomaly_type: anomaly.anomaly_type,
      });
    },
  },
};
</script>
```

#### 1.3 Backend: session-monitor.js (NOVO)

**Localidade**: `src/server/realtime/session-monitor.js`

```javascript
/**
 * @module server/realtime/session-monitor
 * @file Real-time session monitoring + anomaly detection Emite eventos Socket.io para dashboard quando anomalias
 *   detectadas.
 */

import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';

export class SessionMonitor extends EventEmitter {
  /**
   * Inicializa monitor de session lifecycle.
   *
   * @param {Object} options - { io, ctxFile, auditFile }
   */
  constructor(options = {}) {
    super();
    this.io = options.io;
    this.ctxFile = options.ctxFile || './state/session-context.json';
    this.auditFile = options.auditFile || './logs/audit.jsonl';
    this.pollInterval = options.pollInterval || 5000; // 5s
    this.anomalyBuffer = [];
  }

  /**
   * Inicia polling de contexto de sessão e detecção de anomalias.
   */
  start() {
    setInterval(() => this.checkSessionStatus(), this.pollInterval);
  }

  /**
   * Lê CTX e detecta anomalias.
   */
  checkSessionStatus() {
    try {
      const ctx = JSON.parse(fs.readFileSync(this.ctxFile, 'utf-8'));

      // Check 1: close_key_validated status
      if (!ctx.session.close_key_validated && this.isSessionActive(ctx)) {
        // Normal — session aberta, sem close_key
      }

      // Check 2: recovery anomalies
      if (ctx.recovery?.close_mode === 'abrupt_no_key') {
        this.emitAnomaly({
          id: `anomaly-${Date.now()}`,
          severity: 'CRITICAL',
          anomaly_type: 'abrupt_previous_close_no_auth',
          message: 'Previous session ended without authorization. Recovery required.',
          detected_at: new Date().toISOString(),
        });
      }

      // Check 3: timeout risk (session running too long)
      const maxSessionDuration = 8 * 3600 * 1000; // 8 hours
      const sessionAge = Date.now() - new Date(ctx.session.started_at).getTime();
      if (sessionAge > maxSessionDuration) {
        this.emitAnomaly({
          id: `anomaly-${Date.now()}`,
          severity: 'WARNING',
          anomaly_type: 'session_timeout_risk',
          message: 'Session running for too long — approaching timeout boundary.',
          detected_at: new Date().toISOString(),
        });
      }

      // Broadcast anomalies to all connected clients
      if (this.anomalyBuffer.length > 0) {
        this.io.emit('session:anomalies_detected', {
          anomalies: this.anomalyBuffer,
          detected_at: new Date().toISOString(),
        });
        this.anomalyBuffer = []; // Clear buffer after broadcast
      }
    } catch (err) {
      // Silent fail — monitoring shouldn't crash app
      console.warn('[SessionMonitor] Error during check:', err.message);
    }
  }

  /**
   * Verifica se sessão está ativa (not ended_at).
   */
  isSessionActive(ctx) {
    return !ctx.session?.ended_at;
  }

  /**
   * Buffer anomalia para broadcast periódico.
   */
  emitAnomaly(anomaly) {
    if (!this.anomalyBuffer.some((a) => a.id === anomaly.id)) {
      this.anomalyBuffer.push(anomaly);
    }
  }
}
```

#### 1.4 Integration com Server (Express)

```javascript
// src/server/main.js
import { SessionMonitor } from './realtime/session-monitor.js';

// After io setup:
const sessionMonitor = new SessionMonitor({
  io,
  ctxFile: path.join(process.cwd(), '.github/hooks/state/session-context.json'),
  pollInterval: 5000,
});
sessionMonitor.start();
```

---

## 2. Context Compaction Strategy

### Objetivo

Detectar quando token budget está se aproximando do limite (~80% usado) e invocar `/compact`
automaticamente para liberar contexto, sem interromper o fluxo de trabalho.

### Escopo

#### 2.1 Token Budget Monitoring

**Localidade**: Extensão existente de `src/kernel/observation_store.js` ou novo módulo
`src/observability/token-budget-monitor.js`

```javascript
/**
 * Monitora utilização de tokens no contexto LLM. Dispara ação de compaction quando threshold é atingido.
 */
export class TokenBudgetMonitor {
  constructor(options = {}) {
    this.maxBudget = options.maxBudget || 200000;
    this.warningThreshold = options.warningThreshold || 0.8; // 80%
    this.criticalThreshold = options.criticalThreshold || 0.95; // 95%
    this.nerv = options.nerv;
  }

  /**
   * Avalia utilização atual de tokens (estimativa heurística).
   *
   * @returns {Object} { used, total, percent, status }
   */
  getStatus() {
    // Heurística: contar caracteres no audit.jsonl como proxy
    // (cada ~4 chars ≈ 1 token em média)
    const auditSize = this._estimateAuditSize();
    const briefingSize = this._estimateBriefingSize();
    const ctxSize = this._estimateContextSize();

    const totalEstimate = (auditSize + briefingSize + ctxSize) / 4;
    const percent = totalEstimate / this.maxBudget;

    let status = 'ok';
    if (percent >= this.criticalThreshold) status = 'critical';
    else if (percent >= this.warningThreshold) status = 'warning';

    return {
      used: totalEstimate,
      total: this.maxBudget,
      percent: Math.round(percent * 100),
      status,
    };
  }

  /**
   * Se budget > 80%, dispara evento para sinalizar necessidade de compaction. O agente pode responder invocando
   * /compact ou ignorar.
   */
  checkAndAlert() {
    const status = this.getStatus();

    if (status.status === 'warning') {
      this.nerv.emit('context:budget_warning', {
        percent: status.percent,
        message: `Token budget at ${status.percent}% — consider invoking /compact`,
      });
    }

    if (status.status === 'critical') {
      this.nerv.emit('context:budget_critical', {
        percent: status.percent,
        message: `⚠️ CRITICAL: Token budget at ${status.percent}% — /compact RECOMMENDED NOW`,
        auto_compact_available: true,
      });
    }
  }

  _estimateAuditSize() {
    // Lê tamanho do audit.jsonl (bytes)
    try {
      const stats = fs.statSync('.github/hooks/logs/audit.jsonl');
      return stats.size;
    } catch {
      return 0;
    }
  }

  _estimateBriefingSize() {
    // Lê tamanho de session-briefing.md
    try {
      const content = fs.readFileSync('.github/hooks/state/session-briefing.md', 'utf-8');
      return content.length;
    } catch {
      return 0;
    }
  }

  _estimateContextSize() {
    // Lê tamanho de session-context.json
    try {
      const content = fs.readFileSync('.github/hooks/state/session-context.json', 'utf-8');
      return content.length;
    } catch {
      return 0;
    }
  }
}
```

#### 2.2 Auto-Compaction Trigger

**Timing**: Ideal é invocar `/compact` automaticamente quando:

1. Token budget > 80%
2. Agente está entre tarefas (não mid-execution)
3. Não há git push pendente imediatamente

**Implementação**:

```bash
# Adicionar em agent-stop.sh, ANTES do exit final:

# ── Context Compaction Auto-trigger ───────────────────────────────────────
# Verifica se token budget está acima de 80% e se compaction é apropriada
if command -v get_token_budget_status > /dev/null; then
  _TOKEN_STATUS="$(get_token_budget_status)"
  _TOKEN_PERCENT="$(echo "$_TOKEN_STATUS" | jq -r '.percent // 0')"

  if [ "$_TOKEN_PERCENT" -gt 80 ]; then
    echo "[context-compaction] Token budget at ${_TOKEN_PERCENT}% — triggering /compact" >&2

    # Log event
    jq -cn \
      --arg event "context_auto_compact_triggered" \
      --arg sid "$SESSION_ID" \
      --arg percent "$_TOKEN_PERCENT" \
      '{
                event: $event,
                session_id: $sid,
                token_percent: $percent,
                trigger: "agent-stop automated check"
            }' >> "$AUDIT_FILE" 2> /dev/null || true

    # Emite systemMessage pedindo compaction
    jq -cn \
      --arg percent "$_TOKEN_PERCENT" \
      '{
                systemMessage: (
                    "⚠️ CONTEXT COMPACTION NEEDED: Token budget at " + $percent + "%\n" +
                    "Invoke /compact to archive old SECTION + reduce context size.\n" +
                    "This will free up tokens for continued work."
                )
            }'
  fi
fi
```

#### 2.3 Compact Command Implementation

**Localidade**: `src/server/api/routes/compact.js` (já pode existir)

```javascript
import { Router } from 'express';

export const compactRouter = Router();

/**
 * POST /compact
 * Arquiva SECTION atual + compacta contexto (reduz audit.jsonl, resume)
 */
compactRouter.post('/', async (req, res) => {
  try {
    const { section_id, reason } = req.body;

    // 1. Gara checkpoint final da seção atual
    const checkpoint = await generateSectionCheckpoint(section_id);

    // 2. Rotaciona audit.jsonl — move eventos antigos para arquivo
    const rotated = await rotateAudit({
      keepLatest: 2000,
      archivePrefix: `audit-archive-${Date.now()}`,
    });

    // 3. Resume contexto — remove histórico detalhado, mantém estado essencial
    const briefingContent = await generateCompressedBriefing({
      section_id,
      includeToolHistory: false,
      includeTurnHistory: false,
    });
    await updateBriefing(briefingContent);

    // 4. Log da compaction
    jq -cn \
      --arg event "context_compacted" \
      --arg section_id "$section_id" \
      --arg rotated_size "$(rotated.archiveSize)" \
      '{
        event: $event,
        section_id: $section_id,
        archived_bytes: $rotated_size,
        reason: "' + reason + '",
        timestamp: "'$(date -u '+%Y-%m-%dT%H:%M:%S' Z)'"
      }' >> AUDIT_FILE

    res.json({
      success: true,
      message: 'Context compacted',
      archived_size: rotated.archiveSize,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

---

## 3. Template E+ Design (Multi-Decision Checkpoint)

### Objetivo

Proporcionar pontos de decisão ao agente quando anomalias são detectadas ou contexto se aproxima de
limites.

### Escopo

**Template E+ (Multi-Decision)**

```json
{
  "template": "E+",
  "name": "Multi-Decision Checkpoint",
  "trigger": [
    "recovery.alerts_require_kickoff = true",
    "token_budget > 80%",
    "turn_count % 5 == 0 (periodic)"
  ],
  "fields": [
    {
      "name": "action",
      "type": "select",
      "prompt": "O que você quer fazer agora?",
      "options": [
        {
          "label": "Continuar normal",
          "value": "continue",
          "description": "Prosseguir com próximas tarefas (sessão ativa)"
        },
        {
          "label": "Compactar contexto",
          "value": "compact",
          "description": "Invocar /compact para liberar tokens"
        },
        {
          "label": "Encerrar sessão",
          "value": "close_session",
          "description": "Invocar Template F para encerrar SESSION"
        },
        {
          "label": "Revisar anomalia",
          "value": "review_anomaly",
          "description": "Ler detalhes da anomalia detectada"
        }
      ]
    }
  ],
  "post_process": {
    "continue": "update_recovery.recovery_acknowledged=true; continue_turn",
    "compact": "invoke /compact via run_in_terminal",
    "close_session": "invoke vscode_askQuestions Template F",
    "review_anomaly": "emit systemMessage with anomaly details"
  }
}
```

---

## 4. Integração e Timing

### Fluxo Proposto

```
agent-stop.sh triggers
  ├─→ Check token budget (TokenBudgetMonitor.checkAndAlert)
  │   └─→ If > 80%: emit systemMessage com /compact suggestion
  ├─→ Check recovery anomalies
  │   └─→ If recovery.alerts_require_kickoff=true:
  │       emit vscode_askQuestions Template E+ (multi-decision)
  └─→ Exit (allow agent to act on prompts)

User/Agent Response:
  ├─→ `/compact` invoked
  │   └─→ POST /compact → archive + rotate + update briefing
  ├─→ Template E+ answered with "continue"
  │   └─→ Mark recovery.recovery_acknowledged=true
  ├─→ Template E+ answered with "close_session"
  │   └─→ Invoke Template F (Session Close)
  └─→ Template F answered with close_key
      └─→ session-close.sh validates + terminates SESSION
```

### Guardrails

1. **Não invocar compaction enquanto git push está pendente**
   - Verificar CTX.current_turn.pending_git_push antes de compaction suggest

2. **Não invocar Template E+ se último tool foi próprio Template E+**
   - Evitar loop de Templates — user primeiro responde a Template E+

3. **Compaction NÃO é obrigatória**
   - Se agente não responder a compaction suggestion, continua normalmente
   - Apenas quando atingir 95% crítico, forçar bloqueio de novas ferramentas

---

## 5. Status de Implementação

**Nível 5a (MONITOR — Dashboard)**

- [ ] SessionCloseStatus.vue — criar componente
- [ ] SessionAnomalies.vue — criar componente
- [ ] session-monitor.js — criar BackendEventEmitter
- [ ] Socket.io integration — conectar Monitor ao servidor

**Nível 5b (AUTO-COMPACTION)**

- [ ] TokenBudgetMonitor class — criar
- [ ] Auto-trigger em agent-stop.sh — adicionar
- [ ] /compact endpoint — verificar/estender

**Nível 5c (Template E+)**

- [ ] Especificação formal em .github/AGENTS.md
- [ ] Post-process logic em post-tool-use.sh
- [ ] Recovery acknowledgment flag

---

## 6. Próximas Ações

1. **Este Sprint**: Implementar Nível 5a + 5b (MONITOR + Auto-Compaction)
2. **Próximo Sprint**: Formalizar Template E+ + integração total
3. **Release**: v1.2.0 com Session Lifecycle Hardening completa (Níveis 1-5)

---

**Discussão Aberta**:

- Timing ideal para Template E+: début/mid-turn vs end-turn?
- Token estimation: usar audit.jsonl size ou hook para Anthropic token counter?
- Dashboard priority: real-time alerts vs periodic polling?
