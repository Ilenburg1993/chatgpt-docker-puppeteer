# 08 — System Prompt Modular: Controle Total via Replace-First

**Data**: 2026-03-21
**Status**: Versão Definitiva
**Referências**: 02-GAPS-FUNCIONAIS-SDK.md, 05-ARQUITETURA-IDEAL.md, 07-ROADMAP-MASTER.md

---

## 1. Objetivo

Ter o system prompt **totalmente sob nosso controle**, com:

1. **Modo `replace` como padrão** — substitui inteiramente o system prompt SDK
2. **Estrutura modular** — 1 arquivo por seção na pasta `src/copilot/config/system-prompt/`
3. **Conteúdo base SDK preservado** — cada seção começa com cópia literal do padrão SDK, depois
   adiciona nossas customizações
4. **Troca fácil de modo** — flag de configuração permite alternar `replace` ↔ `customize` sem
   refatoração

---

## 2. As 10 Seções do SDK

O SDK define 10 seções via `SYSTEM_PROMPT_SECTIONS`:

| Seção                 | Descrição SDK                                                      | Arquivo proposto         |
| --------------------- | ------------------------------------------------------------------ | ------------------------ |
| `identity`            | Agent identity preamble and mode statement                         | `identity.js`            |
| `tone`                | Response style, conciseness rules, output formatting preferences   | `tone.js`                |
| `tool_efficiency`     | Tool usage patterns, parallel calling, batching guidelines         | `tool-efficiency.js`     |
| `environment_context` | CWD, OS, git root, directory listing, available tools              | `environment-context.js` |
| `code_change_rules`   | Coding rules, linting/testing, ecosystem tools, style              | `code-change-rules.js`   |
| `guidelines`          | Tips, behavioral best practices, behavioral guidelines             | `guidelines.js`          |
| `safety`              | Environment limitations, prohibited actions, security policies     | `safety.js`              |
| `tool_instructions`   | Per-tool usage instructions                                        | `tool-instructions.js`   |
| `custom_instructions` | Repository and organization custom instructions                    | `custom-instructions.js` |
| `last_instructions`   | End-of-prompt: parallel tool calling, persistence, task completion | `last-instructions.js`   |

---

## 3. Estado Atual vs Projetado

### 3.1 Estado Atual

- **Arquivo único**: `src/copilot/config/system-prompt.js` (~250 linhas)
- **Constantes separadas** mas no mesmo arquivo: `AGENT_IDENTITY`, `AGENT_TONE`, `TOOL_EFFICIENCY`,
  `ENVIRONMENT_CONTEXT`, `CODE_CHANGE_RULES`, `AGENT_GUIDELINES`, `LAST_INSTRUCTIONS`
- **Faltam 3 seções**: `safety`, `tool_instructions`, `custom_instructions`
- **Sem conteúdo base SDK**: As constantes são 100% nossas; o conteúdo original do SDK (que vem do
  CLI) não é preservado
- **Mode mixing**: Usa `replace` em `buildAlwaysAliveSystemMessage()` mas `customize` em
  `buildGuidelinesAppendMessage()`
- **lifecycle.js desconectado**: `buildSystemMessageConfig()` em `lifecycle.js` constrói
  `{ mode: 'customize', content }` manualmente sem usar o builder centralizado

### 3.2 Estado Projetado

```
src/copilot/config/system-prompt/
├── index.js                   ← Loader centralizado + assembler
├── mode.js                    ← Flag de modo (replace/customize) + assembler por modo
├── sections/
│   ├── identity.js            ← Seção: identidade do agente
│   ├── tone.js                ← Seção: estilo e tom
│   ├── tool-efficiency.js     ← Seção: padrões de uso de tools
│   ├── environment-context.js ← Seção: contexto do ambiente
│   ├── code-change-rules.js   ← Seção: regras de código
│   ├── guidelines.js          ← Seção: diretrizes comportamentais
│   ├── safety.js              ← Seção: segurança e limitações
│   ├── tool-instructions.js   ← Seção: instruções per-tool
│   ├── custom-instructions.js ← Seção: instruções do repositório
│   └── last-instructions.js   ← Seção: instruções finais do turno
└── sdk-defaults/
    └── capture.js             ← Utilitário para capturar defaults do SDK
```

---

## 4. Design Detalhado

### 4.1 Cada Arquivo de Seção

Cada arquivo em `sections/` exporta:

```js
// sections/identity.js
// @ts-check

/**
 * Seção: identity — Agent identity preamble and mode statement
 * @module copilot/config/system-prompt/sections/identity
 */

/** @type {string} Conteúdo base (padrão SDK) */
export const SDK_DEFAULT = `\
You are GitHub Copilot, an AI programming assistant...
[Cópia literal do conteúdo padrão do SDK para esta seção]`;

/** @type {string} Nossas adições/substituições */
export const CUSTOM = `\
Você é LLM-B (Always-Alive Agent), um agente autônomo de desenvolvimento de software operando no
repositório chatgpt-docker-puppeteer. Você executa missões de longa duração com automação de browser,
arquitetura orientada a eventos e foco em confiabilidade operacional.

Tecnologias principais: Node.js 24+ ESM, Puppeteer, NERV event bus, Express/Socket.io, PM2, TypeScript via JSDoc.`;

/**
 * Conteúdo final da seção: SDK_DEFAULT + CUSTOM (ou CUSTOM replace completo).
 * Em mode 'replace', SDK_DEFAULT é ignorado (nosso CUSTOM substitui completamente).
 * Em mode 'customize', usamos action:'replace' com CUSTOM (substitui apenas esta seção).
 *
 * @type {string}
 */
export const CONTENT = CUSTOM;

/**
 * Override action para mode 'customize'.
 * @type {import('@github/copilot-sdk').SectionOverrideAction}
 */
export const ACTION = 'replace';
```

### 4.2 Loader/Assembler (`index.js`)

```js
// index.js — Loader centralizado
import { getMode } from './mode.js';
import * as identity from './sections/identity.js';
import * as tone from './sections/tone.js';
// ... todas as 10 seções

const SECTIONS = {
    identity, tone, tool_efficiency, environment_context,
    code_change_rules, guidelines, safety, tool_instructions,
    custom_instructions, last_instructions,
};

/**
 * Monta o SystemMessageConfig completo.
 * @param {{ extraContext?: string }} [opts]
 * @returns {SystemMessageConfig}
 */
export function buildSystemMessage(opts = {}) {
    const mode = getMode(); // 'replace' | 'customize'

    if (mode === 'replace') {
        return buildReplaceMode(opts);
    }
    return buildCustomizeMode(opts);
}

function buildReplaceMode({ extraContext } = {}) {
    const parts = Object.entries(SECTIONS).map(
        ([key, section]) => `# ${key}\n\n${section.CONTENT}`
    );
    if (extraContext) parts.push(`# operational_context\n\n${extraContext}`);
    return { mode: 'replace', content: parts.join('\n\n---\n\n') };
}

function buildCustomizeMode({ extraContext } = {}) {
    const sections = {};
    for (const [key, section] of Object.entries(SECTIONS)) {
        sections[key] = { action: section.ACTION, content: section.CONTENT };
    }
    return {
        mode: 'customize',
        sections,
        ...(extraContext ? { content: extraContext } : {}),
    };
}
```

### 4.3 Flag de Modo (`mode.js`)

```js
// mode.js
/** @type {'replace' | 'customize'} */
let _mode = 'replace'; // DEFAULT: replace para controle total

export function getMode() { return _mode; }
export function setMode(mode) { _mode = mode; }
```

**Troca de modo em runtime**: Basta chamar `setMode('customize')` — sem refatoração.

### 4.4 Captura de Defaults do SDK (`sdk-defaults/capture.js`)

Para obter o conteúdo padrão de cada seção do SDK (que é gerenciado internamente pelo Copilot CLI),
usamos `SectionTransformFn`:

```js
// sdk-defaults/capture.js
import { SYSTEM_PROMPT_SECTIONS } from '@github/copilot-sdk';

/**
 * Cria um SystemMessageConfig que captura o conteúdo padrão de todas as seções
 * via SectionTransformFn. Use em uma sessão descartável para extrair os defaults.
 *
 * @returns {import('@github/copilot-sdk').SystemMessageCustomizeConfig}
 */
export function createCaptureConfig() {
    const captured = {};
    const sections = {};

    for (const key of Object.keys(SYSTEM_PROMPT_SECTIONS)) {
        sections[key] = {
            action: (currentContent) => {
                captured[key] = currentContent;
                return currentContent; // não altera
            },
        };
    }

    return {
        mode: 'customize',
        sections,
        _captured: captured, // acessar após a sessão para salvar
    };
}
```

> **Nota**: O conteúdo real de cada seção é gerado pelo Copilot CLI no server-side e pode variar
> por modelo, versão e contexto. A captura é uma fotografia do momento.

---

## 5. Migração do Código Existente

### 5.1 Mapeamento Atual → Novo

| Constante atual       | Seção SDK target      | Arquivo novo                                 |
| --------------------- | --------------------- | -------------------------------------------- |
| `AGENT_IDENTITY`      | `identity`            | `sections/identity.js`                       |
| `AGENT_TONE`          | `tone`                | `sections/tone.js`                           |
| `TOOL_EFFICIENCY`     | `tool_efficiency`     | `sections/tool-efficiency.js`                |
| `ENVIRONMENT_CONTEXT` | `environment_context` | `sections/environment-context.js`            |
| `CODE_CHANGE_RULES`   | `code_change_rules`   | `sections/code-change-rules.js`              |
| `AGENT_GUIDELINES`    | `guidelines`          | `sections/guidelines.js`                     |
| `LAST_INSTRUCTIONS`   | `last_instructions`   | `sections/last-instructions.js`              |
| *(não existe)*        | `safety`              | `sections/safety.js` ← **NOVO**              |
| *(não existe)*        | `tool_instructions`   | `sections/tool-instructions.js` ← **NOVO**   |
| *(não existe)*        | `custom_instructions` | `sections/custom-instructions.js` ← **NOVO** |

### 5.2 Plano de Migração

1. **Criar pasta** `src/copilot/config/system-prompt/` com todos os arquivos
2. **Mover constantes** de `system-prompt.js` para arquivos individuais
3. **Criar 3 seções novas** (`safety`, `tool_instructions`, `custom_instructions`)
   - Iniciar com conteúdo base SDK (capturado via `SectionTransformFn`) + adições mínimas nossas
4. **Criar `index.js`** com assembler dual-mode
5. **Criar `mode.js`** com flag de modo
6. **Atualizar `lifecycle.js`** para usar o assembler centralizado
7. **Deprecar** `config/system-prompt.js` antigo (backward compat por 1 sprint)
8. **Atualizar `session-setup.js`** para usar o novo assembler

### 5.3 Backward Compatibility

O `config/system-prompt.js` antigo será mantido como facade que re-exporta do novo módulo:

```js
// config/system-prompt.js (deprecated — facade)
export { buildSystemMessage as buildAlwaysAliveSystemMessage } from './system-prompt/index.js';
export { buildAppendSystemMessage, buildReplaceSystemMessage } from './system-prompt/mode.js';
// ... re-exports para compatibilidade
```

---

## 6. Benefícios

1. **Controle total**: Modo `replace` garante que sabemos exatamente o que está no system prompt
2. **Modularidade**: Cada seção é editável independentemente sem afetar as outras
3. **Troca fácil**: `setMode('customize')` para voltar ao modo SDK-gerenciado com overrides
4. **3 seções novas**: `safety`, `tool_instructions`, `custom_instructions` completam a cobertura
5. **Transparência**: Conteúdo base SDK documentado ao lado das customizações
6. **Testabilidade**: Cada seção pode ser testada isoladamente

---

## 7. Estimativas

| Tarefa                                    | Esforço |
| ----------------------------------------- | ------- |
| Criar estrutura de pastas e arquivos base | 2h      |
| Migrar 7 constantes existentes            | 1h      |
| Criar 3 seções novas (conteúdo)           | 3h      |
| Implementar assembler dual-mode           | 2h      |
| Capturar defaults do SDK                  | 1h      |
| Atualizar lifecycle.js e session-setup.js | 2h      |
| Backward compat facade                    | 1h      |
| Testes unitários                          | 2h      |
| **Total**                                 | **14h** |

---

## 8. Posição no Roadmap

Esta feature deve ser executada **antes da Faixa B (Event Handlers)** e **após a Faixa A (Bug Fixes)**,
pois resolve:
- BUG-02 (lifecycle.js system message mode confusion)
- GAP-E02 (system message mode duplication)
- Completa a cobertura das 10 seções SDK

**Posição recomendada**: **Faixa A.5** (entre Faixa A e Faixa B) ou como subfaixa de **Faixa C
(SessionConfig)**.
