# SADI - Sensory Analysis Deep Intelligence

**Localização**: `src/shared/sadi/` **Status**: CONSOLIDATED (Protocol 11) **Versão**: 3.0 (Moved
from driver/modules - Feb 2026)

---

## O Que É SADI?

**SADI** (Sensory Analysis Deep Intelligence) é o sistema de percepção visual profunda usado para
detectar e interagir com interfaces LLM (ChatGPT, Gemini, Claude, etc).

### Características

- ✅ **LLM-Agnostic**: Detecta interfaces de qualquer LLM sem hardcoding
- ✅ **Shadow DOM Traversal**: Penetra estruturas complexas (Shadow DOM, IFrames)
- ✅ **Heurística Inteligente**: Scoring por posição, placeholder, tamanho
- ✅ **i18n Support**: Suporta 15+ idiomas automaticamente
- ✅ **Occlusion Detection**: Detecta elementos cobertos ou ocultos
- ✅ **SVG Signatures**: Identifica botões por geometria vetorial

---

## Módulos

### `analyzer.js` (411 linhas)

Biblioteca principal com funções standalone de percepção.

**Exports**:

```javascript
module.exports = {
  findChatInputSelector, // (page) → protocol
  findSendButtonSelector, // (page) → protocol
  findResponseArea, // (page) → protocol
  validateCandidateInteractivity, // (page, protocol) → boolean
  findFrameByPath, // (page, path) → frame
};
```

**Dependências**:

- `@core/i18n` - Termos multilíngues para detecção

**Requer**:

- `page` (Puppeteer Page instance)

**NÃO requer**:

- Driver instanciado
- Task em execução
- DriverLifecycleManager

---

## Uso

### Exemplo 1: Validação de Interface (sem driver)

```javascript
const analyzer = require('@shared/sadi/analyzer');
const puppeteer = require('puppeteer');

// Health check standalone
const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://...' });
const page = await browser.newPage();
await page.goto('https://chatgpt.com');

// Detecta interface sem instanciar driver
const inputProtocol = await analyzer.findChatInputSelector(page);

if (inputProtocol && inputProtocol.selector) {
  console.log('✅ Interface ChatGPT detectada');
  console.log(`   Selector: ${inputProtocol.selector}`);
  console.log(`   Confidence: ${inputProtocol.confidence}`);
} else {
  console.log('❌ Interface ChatGPT não encontrada');
}
```

### Exemplo 2: Validação de Interatividade

```javascript
const analyzer = require('@shared/sadi/analyzer');

const inputProtocol = await analyzer.findChatInputSelector(page);
const isInteractive = await analyzer.validateCandidateInteractivity(page, inputProtocol);

if (!isInteractive) {
  console.error('Campo de entrada não é interativo (oculto/coberto/desabilitado)');
}
```

### Exemplo 3: Uso em Driver

```javascript
// ChatGPTDriver.js
const analyzer = require('@shared/sadi/analyzer');

class ChatGPTDriver extends BaseDriver {
  async validatePage() {
    const inputProtocol = await analyzer.findChatInputSelector(this.page);
    if (!inputProtocol) {
      throw new Error('Interface ChatGPT não detectada');
    }

    const isInteractive = await analyzer.validateCandidateInteractivity(this.page, inputProtocol);

    if (!isInteractive) {
      throw new Error('Campo de entrada não interativo');
    }

    return true;
  }
}
```

---

## Arquitetura

### Por Que Camada Compartilhada?

**Antes** (❌ Inversão de hierarquia):

```
src/core/validators/ → depende de → src/driver/modules/
```

**Depois** (✅ Hierarquia correta):

```
src/shared/sadi/ ← usado por → src/core/validators/
                 ← usado por → src/driver/modules/
                 ← usado por → src/driver/targets/
```

### Hierarquia de Camadas

```
SHARED (utilitários standalone)
   ↓ usado por
CORE (validações e fundações)
   ↓ usado por
DRIVER (execução e orquestração)
```

---

## Uso Interno

**Usado por**:

- `src/core/validators/prerequisite_validator.js` - Validação de interface antes de execução
- `src/driver/modules/input_resolver.js` - Resolução de campos de input
- `src/driver/modules/biomechanics_engine.js` - Engine de digitação humanizada
- `src/driver/targets/ChatGPTDriver.js` - Driver específico ChatGPT

---

## Lógica SADI

### findChatInputSelector(page)

**Heurística de scoring**:

1. **Posição**: Elementos no bottom half da página (score +50)
2. **Placeholder**: Matching com termos i18n (score +30)
3. **Tamanho**: Área mínima 10,000px² (score +20)
4. **Shadow DOM**: Penetra shadow roots e iframes

**Retorna**:

```javascript
{
    selector: 'textarea#prompt-textarea',
    confidence: 100,
    position: { x: 100, y: 800 },
    dimensions: { width: 600, height: 100 }
}
```

### validateCandidateInteractivity(page, protocol)

**Testes**:

1. Tenta `element.focus()`
2. Verifica se `document.activeElement === element`
3. Retorna `true` se elemento pode receber foco

**Caso de uso**: Detecta se elemento está:

- ❌ Oculto (display: none)
- ❌ Coberto por overlay
- ❌ Desabilitado (disabled)
- ❌ Fora da viewport

---

## Migration (v2.0 → v3.0)

**Mudanças** (Fev 2026):

1. ✅ Moved `src/driver/modules/analyzer.js` → `src/shared/sadi/analyzer.js`
2. ✅ Atualizado header com nova localização
3. ✅ 4 imports atualizados:
   - `prerequisite_validator.js`: `@driver/modules/analyzer` → `@shared/sadi/analyzer`
   - `biomechanics_engine.js`: `./analyzer` → `@shared/sadi/analyzer`
   - `input_resolver.js`: `./analyzer` → `@shared/sadi/analyzer`
   - `ChatGPTDriver.js`: `../modules/analyzer` → `@shared/sadi/analyzer`
4. ✅ `jsconfig.json` já tinha `@shared/*` configurado

**Breaking Changes**: Nenhum (apenas mudança de localização)

---

## Testes

**Cobertura**: 411 linhas, usado em 4 componentes críticos

**Testar manualmente**:

```bash
node -e "
const analyzer = require('./src/shared/sadi/analyzer');
console.log('✅ SADI module loads successfully');
console.log('Exports:', Object.keys(analyzer));
"
```

**Testar com Puppeteer**:

```bash
# Criar script test_sadi.js:
const puppeteer = require('puppeteer');
const analyzer = require('./src/shared/sadi/analyzer');

(async () => {
    const browser = await puppeteer.connect({
        browserWSEndpoint: 'ws://localhost:9224'
    });
    const page = await browser.newPage();
    await page.goto('https://chatgpt.com');

    const result = await analyzer.findChatInputSelector(page);
    console.log('SADI Result:', result);

    await browser.disconnect();
})();
```

---

## Roadmap

### v3.1 (Planejado)

- [ ] Cache de resultados (input selector não muda frequentemente)
- [ ] Telemetria de performance (tempo de detecção)
- [ ] Support para novos LLMs (Perplexity, etc)

### v4.0 (Futuro)

- [ ] Machine Learning para adaptação automática
- [ ] Computer Vision para OCR de interfaces
- [ ] A/B testing de heurísticas

---

**Maintained by**: chatgpt-docker-puppeteer core team **Last Updated**: 2026-02-01 **License**: MIT
