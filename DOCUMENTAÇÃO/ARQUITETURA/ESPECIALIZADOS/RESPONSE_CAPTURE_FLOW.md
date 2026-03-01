> **Status**: Especializado
> **Não é baseline principal**: use [ARCHITECTURE.md](../ARCHITECTURE.md) como fonte oficial.
> **Quando consultar**: apenas para aprofundamento deste recorte.

# 🔄 Fluxo de Captura de Resposta da LLM

> **Data**: 4 de Fevereiro de 2026 **Versão**: Sistema Atual (ChatGPTDriver v2.0 + SADI v4.0)
> **Status**: ✅ PRODUÇÃO (Streaming Incremental + Thought Pruning)

---

## 📋 Visão Geral

O sistema captura respostas da LLM (ChatGPT/Gemini) através de **browser automation** (Puppeteer),
utilizando um loop de percepção incremental que:

1. **Detecta** a área de resposta via SADI (growth detection)
2. **Extrai** o texto via `innerText` (execução no browser)
3. **Filtra** blocos de raciocínio (o1/o3 thought blocks)
4. **Monitora** crescimento do texto (streaming detection)
5. **Valida** estabilidade (3 ciclos sem mudança = completo)

---

## 🎯 Componentes Envolvidos

```
┌─────────────────────────────────────────────────────┐
│ ChatGPTDriver.waitForCompletion()                   │
│ (src/driver/targets/ChatGPTDriver.js)               │
│                                                     │
│ Loop de Percepção (800ms/ciclo):                   │
│   1. Triage de bloqueios (rate limit, captcha)     │
│   2. SADI: Encontra área de resposta               │
│   3. Extração de texto (innerText + pruning)       │
│   4. Detecção de auto-continuação                  │
│   5. Validação de estabilidade                     │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ SADI Analyzer.findResponseArea()                    │
│ (src/shared/sadi/analyzer.js)                       │
│                                                     │
│ Growth Detection:                                   │
│   1. Snapshot inicial de containers                │
│   2. Aguarda 400ms (growth delay)                  │
│   3. Compara tamanhos (innerText.length)           │
│   4. Retorna container com maior crescimento       │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ Browser Execution (page.evaluate)                   │
│                                                     │
│ Extraction + Pruning:                               │
│   1. Seleciona última mensagem (querySelector)     │
│   2. Clona elemento (preserva original)            │
│   3. Remove thought blocks (o1/o3 reasoning)       │
│   4. Extrai texto limpo (clone.innerText.trim())   │
└─────────────────────────────────────────────────────┘
```

---

## 🔍 Fluxo Detalhado (ChatGPTDriver)

### Fase 1: Inicialização (waitForCompletion)

```javascript
// src/driver/targets/ChatGPTDriver.js - linha 336
async waitForCompletion(startSnapshot, signal) {
    const MAX_WAIT_TIME_MS = 600000; // 10min timeout
    const startTime = Date.now();

    let lastText = '';
    let stableCycles = 0;
    let continuationCount = 0;
    let loopIteration = 0;

    this.setState('WAITING');

    // Watchdog de Mutação (detecção de stall no browser)
    await this.page.evaluate(() => {
        window.__wd_last_change = Date.now();
        window.__wd_obs = new MutationObserver(() => {
            window.__wd_last_change = Date.now()
        });
        window.__wd_obs.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    });
```

**Objetivo**: Preparar watchdog de mutação DOM para detectar quando LLM para de gerar texto (stall
detection).

---

### Fase 2: Loop de Percepção (800ms/ciclo)

```javascript
while (true) {
    loopIteration++;

    // 1. Checkpoint: Cancelamento externo
    if (signal?.aborted || this.signal?.aborted) {
        throw new Error('OPERATION_ABORTED');
    }

    // 2. Timeout máximo (10min)
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_WAIT_TIME_MS) {
        throw new Error(`WAIT_TIMEOUT: Elapsed ${elapsed}ms`);
    }

    this._assertPageAlive();

    // 3. Diagnóstico de Bloqueios (Triage)
    const lang = await this.page.evaluate(() =>
        document.documentElement.lang || 'pt'
    );
    const diagnosis = await triage.diagnoseStall(this.page, lang);

    if (['LIMIT_REACHED', 'CAPTCHA_CHALLENGE', 'LOGIN_REQUIRED']
        .includes(diagnosis.type)) {
        this._emitVital('TRIAGE_ALERT', diagnosis);
        throw new Error(diagnosis.type);
    }
```

**Objetivo**: Validar que sistema pode continuar (não foi cancelado, não atingiu timeout, não há
bloqueios).

---

### Fase 3: Detecção de Área de Resposta (SADI)

```javascript
    // 4. Extração via SADI V19
    const responseArea = await analyzer.findResponseArea(this.page);
    let currentText = '';

    if (responseArea && responseArea.protocol) {
        const { ctx } = await this.frameNavigator
            .getExecutionContext(responseArea.protocol);
```

**O que é `responseArea`?**

```javascript
{
    protocol: {
        selector: 'article[data-testid*="conversation-turn"]',
        frameId: 'root',
        xpath: null
    },
    isBusy: false,                    // LLM está gerando?
    growth_delta: 245,                // Crescimento detectado (chars)
    detection_time_ms: 412,           // Tempo de detecção
    content_length: 1523              // Tamanho atual
}
```

**Como SADI encontra a área?**

1. **Snapshot inicial**: Captura todos os containers (`div, article, section, pre`) com texto > 5
   chars
2. **Aguarda 400ms**: Delay para permitir crescimento
3. **Compara tamanhos**: `currentLen - snapshotLen` para cada container
4. **Retorna maior crescimento**: Container que mais cresceu = área de resposta

---

### Fase 4: Extração de Texto + Thought Pruning

```javascript
// Extração com Poda de Pensamento (NASA Standard Pruning)
const extractionResult = await ctx.evaluate(proto => {
  const msgs = Array.from(document.querySelectorAll(proto.selector));
  const targetMsg = msgs[msgs.length - 1]; // Última mensagem

  if (!targetMsg) {
    return { text: '', pruned: 0, textLengthBefore: 0 };
  }

  const textLengthBefore = targetMsg.innerText.length;
  const clone = targetMsg.cloneNode(true); // Preserva original

  // Remove elementos de raciocínio interno (o1/o3)
  const thoughts = clone.querySelectorAll(
    // o1/o3 reasoning blocks
    '[data-testid*="thought"]', // Oficial
    '.thought-block', // CSS genérica
    '[class*="thought"]', // Qualquer classe
    '[data-message-role="thought"]', // Role attribute

    // UI metadata
    'details', // Collapsible sections
    '.sr-only' // Screen reader only
  );

  const count = thoughts.length;
  thoughts.forEach(t => t.remove());

  return {
    text: clone.innerText.trim(),
    pruned: count,
    textLengthBefore,
  };
}, responseArea.protocol);

currentText = extractionResult.text || '';
```

**Thought Pruning** (o1/o3 Models):

- **Problema**: Modelos o1/o3 exibem raciocínio interno (thought blocks) na UI
- **Solução**: Remove elementos `[data-testid*="thought"]`, `.thought-block`, `details`, etc.
- **Resultado**: Texto limpo (apenas resposta final, sem raciocínio)

**Telemetria**:

```javascript
if (extractionResult.pruned > 0) {
  const textLengthAfter = currentText.length;
  const ratio = ((textLengthAfter / extractionResult.textLengthBefore) * 100).toFixed(2);

  this._emitVital('THOUGHT_PRUNING', {
    count: extractionResult.pruned,
    textLengthBefore: extractionResult.textLengthBefore,
    textLengthAfter,
    retentionRatio: ratio,
    model: this.defaultModel,
    selector: responseArea.protocol.selector,
  });
}
```

---

### Fase 5: Detecção de Crescimento (Streaming)

```javascript
// Telemetria de Progresso
const textDelta = currentText.length - lastText.length;

this._emitVital('PERCEPTION_CYCLE', {
  cycle: loopIteration,
  textLength: currentText.length,
  delta: textDelta,
  stableCycles,
  elapsedMs: Date.now() - startTime,
  isBusy: responseArea?.isBusy || false,
});

if (textDelta > 0) {
  // Texto cresceu - LLM ainda está gerando
  this._emitVital('TEXT_DELTA', {
    length: currentText.length,
    delta: textDelta,
    status: 'STREAMING',
  });
  stableCycles = 0;
  lastText = currentText;
} else if (currentText.length > 0 && currentText === lastText) {
  // Texto parou de crescer
  stableCycles++;
}
```

**Lógica de Streaming**:

- **textDelta > 0**: Texto cresceu → LLM ainda gerando → reset `stableCycles`
- **textDelta === 0**: Texto estável → incrementa `stableCycles`
- **stableCycles >= 3**: 3 ciclos sem mudança (2.4s) → resposta completa

---

### Fase 6: Auto-Continuação (Respostas Longas)

```javascript
        // Auto-Continuação (botão "Continue generating")
        const didContinue = await this.page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const btn = buttons.find(b => {
                const txt = (b.innerText || '').toLowerCase();
                return b.offsetParent !== null &&
                       (txt.includes('continue') || txt.includes('regenerate'));
            });

            if (btn) {
                btn.click();
                return true;
            }
            return false;
        });

        if (didContinue) {
            continuationCount++;

            this._emitVital('AUTO_CONTINUATION', {
                count: continuationCount,
                textLengthCurrent: currentText.length,
                elapsedMs: Date.now() - startTime
            });

            log('INFO',
                `Acionando botão de continuação (${continuationCount}x).`
            );

            await new Promise(r => setTimeout(r, 2000)); // 2s delay
            stableCycles = 0; // Reset stability check
            continue;
        }
```

**Cenário**: ChatGPT interrompe resposta longa (token limit) e exibe botão "Continue generating".

**Comportamento**:

1. Detecta botão via `innerText.includes('continue')`
2. Clica automaticamente
3. Aguarda 2s (LLM reiniciar geração)
4. Reset `stableCycles` (aguarda nova estabilização)
5. Continua loop de percepção

---

### Fase 7: Critério de Conclusão

```javascript
        // Critério de Conclusão
        if (stableCycles >= this.stableCyclesTarget &&
            currentText.length > 0) {

            // Validação: Empty response
            if (currentText.trim().length === 0) {
                throw new Error('EMPTY_RESPONSE');
            }

            // Validação: Response too short
            const MIN_RESPONSE_LENGTH = 10;
            if (currentText.length < MIN_RESPONSE_LENGTH) {
                throw new Error('RESPONSE_TOO_SHORT');
            }

            this._emitVital('GENERATION_COMPLETE', {
                textLength: currentText.length,
                stableCycles,
                continuations: continuationCount,
                elapsedMs: Date.now() - startTime
            });

            this.setState(STATUS_VALUES.IDLE);
            return currentText; // ✅ Retorna resposta completa
        }

        // Continua aguardando...
        await new Promise(r => setTimeout(r,
            CHATGPT_CONFIG.PERCEPTION_INTERVAL_MS // 800ms
        ));
    }
}
```

**Condições de Conclusão**:

1. ✅ `stableCycles >= 3` (2.4s sem mudança)
2. ✅ `currentText.length > 0` (não vazio)
3. ✅ `currentText.length >= 10` (mínimo 10 chars)
4. ✅ `currentText.trim().length > 0` (não apenas espaços)

---

## 🧩 SADI: Growth Detection (Detalhes)

### Como Funciona `findResponseArea()`

```javascript
// src/shared/sadi/analyzer.js - linha 622
async function findResponseArea(page) {
  const result = await page.evaluate(
    (sadiLogicFn, config, startTs) => {
      const SADI = sadiLogicFn([], []);

      // 1. Busca todos os containers
      const containers = SADI.query('div, article, section, pre').filter(
        c => c.innerText.length > 5
      );

      // 2. Snapshot inicial (tamanho de cada container)
      const snapshot = containers.map(c => ({
        el: c,
        len: c.innerText.length,
      }));

      // 3. Aguarda crescimento (400ms)
      return new Promise(resolve => {
        setTimeout(() => {
          let best = null,
            maxDelta = 0;

          // 4. Compara tamanhos (crescimento)
          snapshot.forEach(snap => {
            if (!snap.el.isConnected) return;

            const currentLen = snap.el.innerText.length;
            const delta = currentLen - snap.len;

            if (delta > maxDelta) {
              maxDelta = delta;
              best = snap.el;
            }
          });

          // 5. Fallback: maior container (se nenhum cresceu)
          const final =
            best ||
            containers
              .filter(c => c.isConnected)
              .sort((a, b) => b.innerText.length - a.innerText.length)[0];

          resolve(
            final
              ? {
                  protocol: SADI.generateProtocol(final),
                  isBusy: SADI.checkSystemStatus(),
                  growth_delta: maxDelta,
                  detection_time_ms: Date.now() - startTs,
                  content_length: final.innerText.length,
                }
              : null
          );
        }, config.RESPONSE_GROWTH_DELAY); // 400ms
      });
    },
    sadiLogic,
    SADI_CONFIG,
    Date.now()
  );

  return result;
}
```

**Por que Growth Detection?**

- **Problema**: ChatGPT UI muda frequentemente (seletores quebram)
- **Solução**: Detectar comportamento (crescimento de texto) em vez de estrutura (seletores fixos)
- **Vantagem**: Resiliente a mudanças de UI (não depende de classes CSS específicas)

---

## 📊 Telemetria Emitida (NERV Events)

### Durante Loop de Percepção

```javascript
// Ciclo de percepção (a cada 800ms)
PERCEPTION_CYCLE: {
    cycle: 12,                  // Número do ciclo
    textLength: 1523,          // Tamanho atual
    delta: 42,                 // Crescimento desde último ciclo
    stableCycles: 0,           // Ciclos sem mudança
    elapsedMs: 9600,           // Tempo total
    isBusy: false              // LLM ainda gerando?
}

// Crescimento detectado
TEXT_DELTA: {
    length: 1523,
    delta: 42,
    status: 'STREAMING'
}

// Thought pruning (o1/o3)
THOUGHT_PRUNING: {
    count: 3,                   // Blocos removidos
    textLengthBefore: 2145,
    textLengthAfter: 1523,
    retentionRatio: '71.00',    // 71% do texto retido
    model: 'gpt-4-turbo',
    selector: 'article[data-testid*="conversation-turn"]'
}

// Auto-continuação
AUTO_CONTINUATION: {
    count: 1,
    textLengthCurrent: 1523,
    elapsedMs: 9600
}

// Conclusão
GENERATION_COMPLETE: {
    textLength: 1523,
    stableCycles: 3,
    continuations: 0,
    elapsedMs: 9600
}
```

---

## ⚙️ Configuração (CHATGPT_CONFIG)

```javascript
const CHATGPT_CONFIG = Object.freeze({
  // Perception Loop
  STABLE_CYCLES_TARGET: 3, // 3 ciclos sem mudança = completo
  PERCEPTION_INTERVAL_MS: 800, // 800ms entre ciclos
  MIN_RESPONSE_LENGTH: 10, // Mínimo 10 chars

  // Timeouts
  MAX_WAIT_TIME_MS: 600000, // 10min max
  STALL_WARNING_MS: 30000, // 30s warning
  NAVIGATION_TIMEOUT_MS: 30000, // 30s navigation

  // Auto-continuation
  CONTINUATION_DELAY_MS: 2000, // 2s após clicar "Continue"

  // Thought pruning
  ENABLE_THOUGHT_PRUNING: true, // Remove o1/o3 reasoning
});
```

---

## 🔄 Exemplo de Execução Completa

### Cenário: Prompt "Explain quantum computing"

```
T=0ms: waitForCompletion() iniciado
  └─> setState('WAITING')
  └─> Instalar watchdog de mutação DOM

T=400ms: Ciclo 1
  ├─> Triage: NONE (sem bloqueios)
  ├─> SADI: Encontra área (growth_delta=0, primeira detecção)
  ├─> Extração: "" (vazio, LLM não começou)
  ├─> stableCycles=0
  └─> Aguarda 800ms

T=1200ms: Ciclo 2
  ├─> SADI: Encontra área (growth_delta=152 chars)
  ├─> Extração: "Quantum computing is..." (152 chars)
  ├─> TEXT_DELTA: +152
  ├─> stableCycles=0 (resetado por crescimento)
  └─> Aguarda 800ms

T=2000ms: Ciclo 3
  ├─> SADI: growth_delta=245
  ├─> Extração: "Quantum computing is a revolutionary..." (397 chars)
  ├─> TEXT_DELTA: +245
  ├─> stableCycles=0
  └─> Aguarda 800ms

T=2800ms: Ciclo 4
  ├─> SADI: growth_delta=318
  ├─> Extração: "...leverages principles of quantum mechanics..." (715 chars)
  ├─> TEXT_DELTA: +318
  ├─> stableCycles=0
  └─> Aguarda 800ms

T=3600ms: Ciclo 5
  ├─> SADI: growth_delta=0 (LLM parou)
  ├─> Extração: "...enabling unprecedented computational power." (715 chars)
  ├─> TEXT_DELTA: 0
  ├─> stableCycles=1 (primeira estabilização)
  └─> Aguarda 800ms

T=4400ms: Ciclo 6
  ├─> SADI: growth_delta=0
  ├─> Extração: "...enabling unprecedented computational power." (715 chars)
  ├─> TEXT_DELTA: 0
  ├─> stableCycles=2
  └─> Aguarda 800ms

T=5200ms: Ciclo 7
  ├─> SADI: growth_delta=0
  ├─> Extração: "...enabling unprecedented computational power." (715 chars)
  ├─> TEXT_DELTA: 0
  ├─> stableCycles=3 ✅
  └─> Validação: length=715 (>10) ✅
  └─> GENERATION_COMPLETE
  └─> return "Quantum computing is a revolutionary..."
```

**Tempo Total**: 5.2s (7 ciclos × 800ms - delays) **Resposta**: 715 chars **Thought blocks
removidos**: 0 (GPT-4 não usa thought blocks)

---

## 🎯 Pontos Fortes

1. **Resiliente a Mudanças de UI**: Growth detection não depende de seletores fixos
2. **Streaming Detection**: Detecta crescimento incremental (não aguarda conclusão total)
3. **Thought Pruning**: Remove raciocínio interno (o1/o3) automaticamente
4. **Auto-Continuation**: Clica "Continue" automaticamente em respostas longas
5. **Telemetria Completa**: 18+ eventos NERV emitidos durante execução
6. **Cancelamento Externo**: Respeita `signal.aborted` (6+ checkpoints)

---

## ⚠️ Limitações Conhecidas

### 1. Dependência de `innerText`

**Problema**: `innerText` não captura:

- Formatação (markdown, code blocks)
- Links (apenas texto)
- Imagens (apenas alt text)

**Impacto**: Resposta retornada é texto plano (sem estrutura).

**Solução Futura**: Extrair HTML estruturado em vez de `innerText`.

### 2. Growth Detection Delay (400ms)

**Problema**: SADI aguarda 400ms para detectar crescimento, adicionando latência.

**Impacto**: Primeira detecção pode ser lenta (400ms + 800ms = 1.2s).

**Solução Futura**: Cache de seletores (se UI não mudou, reusar selector).

### 3. Stable Cycles Hardcoded (3 ciclos)

**Problema**: `STABLE_CYCLES_TARGET=3` é fixo (2.4s de espera após LLM parar).

**Impacto**: Respostas curtas aguardam desnecessariamente 2.4s.

**Solução Futura**: Adaptive stable cycles (ajustar por tamanho de resposta).

### 4. Thought Pruning Específico para o1/o3

**Problema**: Seletores de thought pruning são específicos para modelos o1/o3.

**Impacto**: Se OpenAI mudar UI, thought blocks podem não ser removidos.

**Solução Futura**: Heurística baseada em comportamento (ex: `<details>` colapsado).

---

## 🚀 Melhorias Futuras

### 1. Extração Estruturada (HTML + Markdown)

Retornar não apenas texto, mas estrutura completa:

````javascript
{
    text: "Quantum computing is...",
    html: "<div><p>Quantum computing is...</p><code>...</code></div>",
    markdown: "# Quantum Computing\n\n...\n\n```python\n...\n```",
    codeBlocks: [{lang: 'python', code: '...'}],
    images: [{src: '...', alt: '...'}]
}
````

### 2. LLM-as-Judge Validation

Validar resposta antes de retornar:

- Coherência (resposta está relacionada ao prompt?)
- Completude (resposta está completa ou cortada?)
- Qualidade (resposta faz sentido?)

### 3. Adaptive Perception Interval

Ajustar `PERCEPTION_INTERVAL_MS` dinamicamente:

- Início (texto crescendo rápido): 400ms
- Meio (texto crescendo devagar): 800ms
- Final (texto estável): 1200ms

### 4. Cache de Response Area

Reusar selector se UI não mudou:

```javascript
// Primeira detecção: SADI growth detection (400ms)
// Detecções subsequentes: Reusar selector (0ms)
if (lastResponseSelector && isValidSelector(lastResponseSelector)) {
  responseArea = { protocol: lastResponseSelector };
} else {
  responseArea = await analyzer.findResponseArea(this.page);
  lastResponseSelector = responseArea.protocol;
}
```

**Ganho**: 90% faster (30ms vs 400ms), como cache já implementado em SADI.

---

## 📚 Referências

1. **[ChatGPTDriver.js](../../../src/driver/targets/ChatGPTDriver.js)** - Implementação completa (linhas
   336-560)
2. **[SADI Analyzer](../../../src/shared/sadi/analyzer.js)** - Growth detection (linhas 622-700)
3. **[Triage Module](../../../src/driver/modules/triage.js)** - Diagnóstico de bloqueios
4. **[BaseDriver](../../../src/driver/core/BaseDriver.js)** - Orquestração de execução
5. **[CONCEPTUAL_ARCHITECTURE.md](../CONCEPTUAL_ARCHITECTURE.md)** - Arquitetura geral

---

**Conclusão**: Sistema atual captura respostas via **loop de percepção incremental** (800ms/ciclo)
com **growth detection** (SADI), **thought pruning** (o1/o3), e **auto-continuation** (respostas
longas). Telemetria completa via NERV events. Resiliente a mudanças de UI, mas depende de
`innerText` (texto plano).

---

**Versão**: 1.0 **Última Atualização**: 4 de Fevereiro de 2026 **Autor**: Análise do código fonte
(ChatGPTDriver v2.0 + SADI v4.0)
