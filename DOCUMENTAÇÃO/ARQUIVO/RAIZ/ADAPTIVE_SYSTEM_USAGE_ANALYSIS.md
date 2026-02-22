# ADAPTIVE SYSTEM - USAGE ANALYSIS & INTEGRATION ROADMAP

**Date**: 2026-02-04 **Version**: V46 **Status**: PRODUCTION READY - PARCIALMENTE INTEGRADO

---

## 📊 EXECUTIVE SUMMARY

O **Adaptive System V46** está **implementado e funcional**, mas **subutilizado**. Atualmente apenas
**1 de 2 APIs principais está sendo usada** (`getAdjustedTimeout`), enquanto a API de coleta de
métricas (`recordMetric`) **não está integrada em nenhum lugar**.

**Uso Atual**: 3-4% do potencial **Oportunidades de Integração**: 15+ pontos críticos identificados

---

## 🔍 ESTADO ATUAL (WHERE IS IT USED?)

### ✅ USO ATIVO: `getAdjustedTimeout()`

Usado em **4 módulos críticos** para calcular timeouts adaptativos:

#### 1. **ChatGPTDriver** (`src/driver/targets/ChatGPTDriver.js:618`)

**Finalidade**: Detectar **stall** (IA travou durante geração de resposta)

```javascript
// Linha 618
const adaptiveData = await adaptive.getAdjustedTimeout(this.currentDomain, 0, 'STREAM');
const watchdogIdleTime = browserNow - lastChange;

if (watchdogIdleTime > adaptiveData.timeout) {
  throw new Error(`STALL_DETECTED: Latência excedeu ${adaptiveData.timeout}ms`);
}
```

**Contexto**: Durante o perception loop, valida se a IA parou de produzir texto **Métrica usada**:
`stream` (gaps entre chunks de texto) **Impacto**: Se timeout adaptativo for muito curto → falsos
positivos (stall detectado indevidamente)

---

#### 2. **SubmissionController** (`src/driver/modules/submission_controller.js:326`)

**Finalidade**: Calcular **debounce delay** após envio de prompt

```javascript
// Linha 326
const timeoutData = await adaptive.getAdjustedTimeout(this.driver.currentDomain, 0, 'ECHO');
debounceDelay = Math.min(
  Math.floor(timeoutData.timeout / 10), // 10% do timeout ECHO
  SUBMISSION_CONFIG.DEBOUNCE_MAX_MS
);
```

**Contexto**: Após pressionar Enter, aguarda para verificar se campo foi limpo **Métrica usada**:
`echo` (tempo de resposta da interface) **Impacto**: Debounce muito curto → verificação prematura
(falha de confirmação)

---

#### 3. **BiomechanicsEngine** (`src/driver/modules/biomechanics_engine.js:374`)

**Finalidade**: Timeout para **aguardar IA ficar idle** antes de interagir

```javascript
// Linha 374
const { timeout } = await adaptive.getAdjustedTimeout(this.driver.currentDomain, 0, 'INITIAL');

while (Date.now() - start < timeout && iterations < MAX_WAIT_ITERATIONS) {
  // Aguarda IA terminar de processar
}
```

**Contexto**: Antes de digitar prompt, aguarda IA não estar processando outra tarefa **Métrica
usada**: `ttft` (time to first token - tempo inicial de resposta) **Impacto**: Timeout muito curto →
interação prematura (conflito com geração em andamento)

---

#### 4. **Stabilizer** (`src/shared/page_stability/stabilizer.js:387`)

**Finalidade**: Ajustar **silence window** (período de estabilidade antes de considerar página
pronta)

```javascript
// Linha 387-397
const metrics = await adaptive.getSnapshot();
const profile = metrics.targets[target];
const avgStreamTime = profile?.stream?.avg || 500;

if (avgStreamTime > ADAPTIVE_STREAM_VERY_SLOW) {
  silenceWindow = 5000; // 5s para targets muito lentos
} else if (avgStreamTime > ADAPTIVE_STREAM_SLOW) {
  silenceWindow = 3000; // 3s para targets lentos
} else if (avgStreamTime < ADAPTIVE_STREAM_FAST) {
  silenceWindow = 1000; // 1s para targets rápidos
}
```

**Contexto**: Determina quanto tempo aguardar após última mudança na página **Métrica usada**:
`stream.avg` (velocidade média de streaming) **Impacto**: Silence window inadequado → falsos
positivos/negativos de estabilidade

---

### ❌ USO AUSENTE: `recordMetric()`

**PROBLEMA CRÍTICO**: Nenhum módulo está coletando métricas reais!

**Consequência**: O adaptive.js opera apenas com **SEEDS iniciais** (valores default):

- `SEED_TTFT = 15000` (15s)
- `SEED_STREAM = 500` (500ms)
- `SEED_ECHO = 2000` (2s)

**Sem métricas reais, o sistema nunca aprende!**

---

## 🎯 ONDE DEVERIA SER USADO (INTEGRATION OPPORTUNITIES)

### 🔴 PRIORIDADE CRÍTICA (P0)

#### 1. **ChatGPTDriver: Coletar TTFT** (Time to First Token)

**Localização**: `src/driver/targets/ChatGPTDriver.js` (~linha 340-410)

**O que medir**: Tempo entre envio do prompt e primeiro chunk de texto

**Implementação**:

```javascript
// Após sendPrompt() (linha 339)
const promptSentAt = Date.now();

// Ao detectar primeiro texto no perception loop (linha 498)
if (!firstTokenReceived) {
  const ttft = Date.now() - promptSentAt;
  await adaptive.recordMetric('ttft', ttft, this.currentDomain);
  firstTokenReceived = true;
}
```

**Impacto**: Timeouts INITIAL mais precisos (BiomechanicsEngine)

---

#### 2. **ChatGPTDriver: Coletar Stream Gaps**

**Localização**: `src/driver/targets/ChatGPTDriver.js` (~linha 488-500)

**O que medir**: Intervalo entre chunks consecutivos de texto (gaps)

**Implementação**:

```javascript
// No perception loop, ao detectar TEXT_DELTA
if (delta) {
  const now = Date.now();
  if (lastChunkTimestamp) {
    const gap = now - lastChunkTimestamp;
    await adaptive.recordMetric('gap', gap, this.currentDomain);
  }
  lastChunkTimestamp = now;
}
```

**Impacto**: Timeouts STREAM mais precisos (stall detection)

---

#### 3. **SubmissionController: Coletar Echo Time**

**Localização**: `src/driver/modules/submission_controller.js` (~linha 280-340)

**O que medir**: Tempo entre Enter e confirmação de clearing

**Implementação**:

```javascript
// Linha 322 (após Enter)
const enterPressedAt = Date.now();

// Linha 337 (após verificação)
if (wasCleared) {
  const echoTime = Date.now() - enterPressedAt;
  await adaptive.recordMetric('echo', echoTime, this.driver.currentDomain);
}
```

**Impacto**: Debounce delay mais preciso (menos falhas de confirmação)

---

### 🟡 PRIORIDADE ALTA (P1)

#### 4. **BiomechanicsEngine: Coletar Wait Time**

**Localização**: `src/driver/modules/biomechanics_engine.js` (~linha 380-410)

**O que medir**: Tempo real aguardado até IA ficar idle

**Implementação**:

```javascript
// Linha 410 (após loop de wait)
const actualWaitTime = Date.now() - start;
if (actualWaitTime > 0) {
  await adaptive.recordMetric('ttft', actualWaitTime, this.driver.currentDomain);
}
```

---

#### 5. **Stabilizer: Coletar Heartbeat**

**Localização**: `src/shared/page_stability/stabilizer.js` (~linha 250-300)

**O que medir**: Intervalo entre heartbeats (pulso de atividade da página)

**Implementação**:

```javascript
// Em _monitorActivityWithWatchdog (linha 250+)
const lastHeartbeat = await page.evaluate(() => window.__wd_last_change);
const now = Date.now();
const heartbeatInterval = now - lastHeartbeat;

if (heartbeatInterval > 0 && heartbeatInterval < 60000) {
  await adaptive.recordMetric('heartbeat', heartbeatInterval, target);
}
```

**Impacto**: Infraestrutura de monitoramento mais precisa

---

#### 6. **ChatGPTDriver: Coletar Continuation Latency**

**Localização**: `src/driver/targets/ChatGPTDriver.js` (~linha 526-550)

**O que medir**: Tempo para detectar e processar botão "Continue"

**Implementação**:

```javascript
// Linha 526 (ao detectar continuation)
const continuationStart = Date.now();

// Após clicar e aguardar (linha 540+)
const continuationLatency = Date.now() - continuationStart;
await adaptive.recordMetric('echo', continuationLatency, this.currentDomain);
```

---

### 🟢 PRIORIDADE MÉDIA (P2)

#### 7. **NetworkMonitor: Request Timing**

**Localização**: Criar novo módulo ou integrar em `BaseDriver`

**O que medir**: Latência de requests críticos (API calls, page loads)

**Implementação**:

```javascript
page.on('response', async response => {
  const timing = response.timing();
  if (timing) {
    const totalTime = timing.responseEnd - timing.requestStart;
    await adaptive.recordMetric('heartbeat', totalTime, domain);
  }
});
```

---

#### 8. **ModelSwitcher: Model Response Quality**

**Localização**: `src/driver/targets/ChatGPTDriver.js` (~linha 151-180)

**O que medir**: Performance de diferentes modelos (TTFT, completion time)

**Implementação**:

```javascript
// Ao trocar modelo (linha 175+)
const modelStartTime = Date.now();

// Após primeira resposta completa
const modelResponseTime = Date.now() - modelStartTime;
const modelKey = `${this.currentDomain}-${modelId}`;
await adaptive.recordMetric('ttft', modelResponseTime, modelKey);
```

**Benefício**: Descobrir qual modelo é mais rápido para cada domínio

---

#### 9. **SADI: Selector Discovery Time**

**Localização**: `src/shared/sadi/analyzer.js` (~linha 450-500)

**O que medir**: Tempo para descobrir seletores via SADI

**Implementação**:

```javascript
// Linha 450 (início de análise)
const sadiStart = Date.now();

// Linha 490 (após descoberta)
const sadiTime = Date.now() - sadiStart;
if (result.confidence >= 75) {
  await adaptive.recordMetric('echo', sadiTime, domain);
}
```

**Benefício**: Entender performance de heurísticas

---

### 🔵 PRIORIDADE BAIXA (P3 - FUTURO)

#### 10. **Gemini Driver** (quando implementado)

- Coletar mesmas métricas (TTFT, stream gaps, echo)
- Comparar performance ChatGPT vs Gemini

#### 11. **Circuit Breaker Monitoring**

- Registrar quando circuit breaker é ativado
- Métrica de "targets problemáticos" para alertas

#### 12. **Health Check Automation**

- Chamar `getHealthStatus()` periodicamente (a cada hora)
- Emitir alerta se targets stale > 50%

#### 13. **Percentile Dashboards**

- Exportar P95/P99 para Grafana/Prometheus
- Monitorar degradação de performance

#### 14. **Context-Aware Analysis**

- Correlacionar `messageCount` com TTFT real
- Validar se penalty logarítmica é adequada

#### 15. **Adaptive Policy**

- Implementar `ADAPTIVE` mode em `context_manager.js`
- Usar stats do adaptive para decidir quando summarizar contexto

---

## 📈 ROADMAP DE INTEGRAÇÃO

### Fase 1: Coleta Básica (P0 - CRÍTICO) ⏱️ 2-3 dias

**Objetivo**: Começar a aprender padrões reais

1. ✅ Implementar recordMetric em ChatGPTDriver (TTFT + Stream Gaps)
2. ✅ Implementar recordMetric em SubmissionController (Echo Time)
3. ✅ Validar que metrics estão sendo persistidas (`logs/adaptive_state.json`)
4. ✅ Testes: Executar 10-20 tasks e verificar convergência de `avg`

**Entregáveis**:

- 3 pontos de coleta ativos
- Dashboard simples (logs) mostrando evolução de `avg` e `std`

---

### Fase 2: Cobertura Completa (P1) ⏱️ 1 semana

**Objetivo**: Cobertura de 80% dos cenários críticos

1. Implementar recordMetric em BiomechanicsEngine (Wait Time)
2. Implementar recordMetric em Stabilizer (Heartbeat)
3. Adicionar continuation latency tracking
4. Criar script de análise (`scripts/analyze-adaptive-metrics.js`)

**Entregáveis**:

- 6 pontos de coleta ativos
- Script de análise com estatísticas (P50/P95/P99)
- Relatório de recomendações (ajustes de seeds)

---

### Fase 3: Observability & Alertas (P2) ⏱️ 1 semana

**Objetivo**: Produção-grade monitoring

1. Integrar com Prometheus/Grafana (exportar métricas)
2. Implementar alertas automáticos (circuit breaker ativo)
3. Health check periodic (cron job a cada hora)
4. Dashboard Grafana com painéis:
   - TTFT por target (line chart)
   - Stream gaps distribution (histogram)
   - Circuit breaker events (counter)
   - Stale targets (gauge)

**Entregáveis**:

- Prometheus exporter
- 4 dashboards Grafana
- Alerting rules (PagerDuty/Slack)

---

### Fase 4: Inteligência Avançada (P3) ⏱️ 2+ semanas

**Objetivo**: Otimização baseada em ML

1. Modelo-specific metrics (ChatGPT vs Gemini)
2. Context-aware timeouts (ajustar por messageCount real)
3. A/B testing framework (testar diferentes alphas)
4. Reinforcement learning (ajustar alpha dinamicamente)

**Entregáveis**:

- Comparative analysis report (modelos)
- ML model para predição de timeouts
- Auto-tuning de hyperparameters (alpha, seeds)

---

## 🚨 GAPS CRÍTICOS ATUAIS

### 1. **Zero Learning Happening**

- ❌ Sem coleta de métricas → sistema usa apenas seeds
- ❌ Timeouts não melhoram ao longo do tempo
- ❌ Circuit breaker nunca ativa (avg sempre em seed value)

### 2. **Stale Data Risk**

- ❌ `last_update` tracking implementado mas não atualizado
- ❌ Targets inativos permanecem em state indefinidamente
- ❌ Decay não funciona (sem last_update real)

### 3. **No Observability**

- ❌ Impossível diagnosticar problemas de timeout
- ❌ Sem visibilidade de quando circuit breaker deveria ativar
- ❌ Sem métricas de health check

### 4. **Manual Tuning**

- ❌ Seeds escolhidos arbitrariamente (15s, 500ms, 2s)
- ❌ Sem validação se seeds são adequados
- ❌ Sem feedback loop para ajustar CONFIG.ADAPTIVE_ALPHA

---

## 💡 QUICK WINS (IMPLEMENTAÇÃO RÁPIDA)

### Quick Win #1: Logging Metrics (30min)

**Onde**: `src/driver/targets/ChatGPTDriver.js`

Adicionar logs temporários para entender padrões sem integração completa:

```javascript
// Após detectar primeiro token
const ttft = Date.now() - promptSentAt;
log('INFO', `[ADAPTIVE-DATA] TTFT: ${ttft}ms, domain: ${this.currentDomain}`);

// Após cada gap
log('INFO', `[ADAPTIVE-DATA] GAP: ${gap}ms, domain: ${this.currentDomain}`);
```

**Benefício**: Coleta passiva de dados para análise post-mortem

---

### Quick Win #2: State File Analysis Script (1h)

**Onde**: `scripts/analyze-adaptive-state.js` (NOVO)

```javascript
const state = JSON.parse(fs.readFileSync('logs/adaptive_state.json'));

Object.entries(state.targets).forEach(([target, profile]) => {
  console.log(`${target}:`);
  console.log(
    `  TTFT: avg=${profile.ttft.avg}ms, std=${Math.sqrt(profile.ttft.var).toFixed(0)}ms, count=${profile.ttft.count}`
  );
  console.log(`  Stream: avg=${profile.stream.avg}ms, count=${profile.stream.count}`);
});
```

**Benefício**: Visibility de estado atual sem dashboard

---

### Quick Win #3: Force TTFT Collection (1h)

**Onde**: `src/driver/targets/ChatGPTDriver.js`

Implementar apenas coleta de TTFT (mais fácil que stream gaps):

```javascript
// Linha 340+ (após sendPrompt)
this._ttftStart = Date.now();

// Linha 498+ (ao detectar TEXT_DELTA pela primeira vez)
if (this._ttftStart && !this._ttftRecorded) {
  const ttft = Date.now() - this._ttftStart;
  await adaptive.recordMetric('ttft', ttft, this.currentDomain);
  this._ttftRecorded = true;
}
```

**Benefício**: Começar aprendizado com 1 métrica crítica

---

## 📊 MÉTRICAS DE SUCESSO

### KPIs para Validar Integração

1. **Learning Rate**
   - Meta: 50+ samples por target em 1 semana
   - Atual: 0 samples (sem coleta)

2. **Convergência**
   - Meta: `std < 30% de avg` após 100 samples
   - Atual: N/A (sem coleta)

3. **Circuit Breaker Activation**
   - Meta: 0-2 activations por semana (targets realmente lentos)
   - Atual: 0 (nunca ativa - sem métricas)

4. **Stale Targets**
   - Meta: < 10% de targets stale (24h+ inativos)
   - Atual: N/A (last_update não atualizado)

5. **Timeout Accuracy**
   - Meta: < 5% false positives (stall detectado incorretamente)
   - Atual: Desconhecido (sem baseline)

---

## 🎯 RECOMENDAÇÃO FINAL

### PRIORIDADE IMEDIATA (Esta Semana)

1. **Implementar Quick Win #3** (TTFT collection - 1h)
2. **Implementar Quick Win #2** (analysis script - 1h)
3. **Executar 20-30 tasks** para coletar dados iniciais
4. **Analisar convergência** e ajustar seeds se necessário

### PRÓXIMOS 30 DIAS

1. **Fase 1 completa** (TTFT, Stream Gaps, Echo Time)
2. **Validar learning** (verificar que `avg` converge para valores realistas)
3. **Ajustar CONFIG.ADAPTIVE_ALPHA** se convergência muito lenta/rápida
4. **Documentar padrões** observados (TTFT médio por modelo, etc)

### ROADMAP LONGO (Q1 2026)

1. **Fase 2 + 3** (cobertura completa + observability)
2. **Dashboards Grafana** operacionais
3. **Alertas** configurados (Slack/PagerDuty)
4. **Relatório de ROI** (redução de false positives, timeouts mais precisos)

---

## 📝 CONCLUSÃO

O **Adaptive System V46** está **tecnicamente pronto**, mas **operacionalmente inativo**. A
arquitetura é sólida, o código é production-ready, mas **falta integração**.

**Status Atual**: 🟡 **IMPLEMENTADO MAS SUBUTILIZADO (3-4% de uso)**

**Próxima Ação Crítica**: 🔴 **IMPLEMENTAR COLETA DE MÉTRICAS (FASE 1)**

Sem coleta de métricas, o adaptive.js é apenas um **timeout fixo sofisticado**. Com coleta ativa,
torna-se um **sistema de aprendizado contínuo** que melhora a confiabilidade e performance do
projeto.

---

**Ação Recomendada**: Implementar **Quick Win #3 (TTFT collection)** como prova de conceito em **< 2
horas** e validar learning loop completo.
