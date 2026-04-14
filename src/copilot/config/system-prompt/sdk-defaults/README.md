# SDK Defaults — System Prompt Sections

**Status**: referência canônica das seções definidas pelo `@github/copilot-sdk`.
**Última atualização**: 2026-04-14.

## Seções do SDK (`SYSTEM_PROMPT_SECTIONS`)

O SDK exporta 10 seções como metadados. O conteúdo real é injetado pelo runtime do Copilot CLI
durante a sessão — não é exportado estaticamente.

| Seção                 | Descrição SDK                                                      |
| --------------------- | ------------------------------------------------------------------ |
| `identity`            | Agent identity preamble and mode statement                         |
| `tone`                | Response style, conciseness rules, output formatting preferences   |
| `tool_efficiency`     | Tool usage patterns, parallel calling, batching guidelines         |
| `environment_context` | CWD, OS, git root, directory listing, available tools              |
| `code_change_rules`   | Coding rules, linting/testing, ecosystem tools, style              |
| `guidelines`          | Tips, behavioral best practices, behavioral guidelines             |
| `safety`              | Environment limitations, prohibited actions, security policies     |
| `tool_instructions`   | Per-tool usage instructions                                        |
| `custom_instructions` | Repository and organization custom instructions                    |
| `last_instructions`   | End-of-prompt: parallel tool calling, persistence, task completion |

## Captura dos defaults em runtime

O SDK não expõe conteúdo padrão estático — os textos são gerados dinamicamente pelo Copilot CLI
baseado em modelo, versão do SDK e contexto da sessão. Para capturá-los:

### Uso do `capture.js`

```js
import { createCaptureConfig } from './capture.js';

// 1. Cria config que intercepta os defaults
const config = createCaptureConfig();

// 2. Passe como systemMessage em uma sessão descartável
// (o SDK chama as SectionTransformFn com o conteúdo padrão)

// 3. Após processamento, os defaults ficam em:
console.log(config._captured);
// { identity: "...", tone: "...", ... }
```

### Salvando snapshot

Para gerar um snapshot persistido, use o script `snapshot.js`:

```bash
node src/copilot/config/system-prompt/sdk-defaults/snapshot.js
```

O snapshot é salvo em `sdk-defaults/captured-YYYY-MM-DD.json`.

## Arquitetura: por que nosso modo é `replace`

No modo `replace`, substituímos inteiramente o system prompt do SDK com nossas 10 seções modulares
(em `sections/`). Cada seção contém:

- **Conteúdo nosso curado** — baseado na análise dos padrões do SDK (doc 08)
- **Adaptações para o projeto** — pt-BR, hooks protocol, ESM, segurança customizada

O capture.js existe para:
1. **Auditoria periódica** — comparar nossos conteúdos com o que o SDK geraria
2. **Detecção de drift** — se o SDK adicionar/alterar seções em updates
3. **Referência** — documentar o baseline que estamos substituindo

## Notas

- `hasContent: false` nas seções exportadas — o SDK não expõe conteúdo estático
- O conteúdo real varia por: modelo, versão do SDK, contexto da sessão, ferramentas ativas
- Para obter um snapshot real, é necessário rodar em sessão Copilot ativa
