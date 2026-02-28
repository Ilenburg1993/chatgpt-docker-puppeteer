---
name: 'Project Canon'
description: 'Nucleo canonico do repositorio para agentes de IA'
applyTo: '**/*'
---

# Project Canon

Este arquivo e o resumo canonico para tarefas gerais de codigo neste repositorio. Aplique-o como
baseline curto e estavel; consulte as instrucoes detalhadas e as skills apenas quando a tarefa
exigir aprofundamento.

## Linguagem e comunicacao

- Responda em pt-BR ao interagir com humanos.
- Escreva documentacao e instrucoes em pt-BR, salvo exigencia contraria explicita.

## Runtime e modulos

- Presuma Node.js >=24.
- Este projeto usa ESM como padrao obrigatorio.
- Preserve `"type": "module"` em [`package.json`](/workspaces/chatgpt-docker-puppeteer/package.json).
- Em codigo novo JavaScript, use `import` e `export`.
- Evite `require` e `module.exports`, salvo necessidade excepcional e justificada.

## Estrutura e arquitetura

- [`index.js`](/workspaces/chatgpt-docker-puppeteer/index.js) e apenas a entrada delegada.
- [`src/main.js`](/workspaces/chatgpt-docker-puppeteer/src/main.js) e o bootstrap canonico.
- A arquitetura e orientada a eventos, com NERV como barramento principal.
- Quando o modulo ja estiver nessa topologia, prefira desacoplamento via eventos em vez de acoplamento
  direto.

## Restricao arquitetural critica

- Nao introduza `puppeteer.launch()` neste processo.
- Nao adicione gerenciamento local de browser neste processo.
- A integracao com browser deve usar o Chrome externo e a infraestrutura de DevTools ja existente.

## Convencoes de codigo

- Prefira aliases existentes como `#core/*`, `#infra/*`, `#driver/*` e equivalentes.
- Mantenha 4 espacos, 120 colunas, aspas simples e ponto-e-virgula.
- Adicione JSDoc curto em exports publicas relevantes.
- Evite novas dependencias sem justificativa clara.

## Quality gates minimos

- Rode `npm run lint` apos mudancas relevantes.
- Rode `npm run format:check` apos mudancas relevantes.
- Rode `npm run test:unit` como baseline.
- Se a mudanca tocar `driver`, `kernel` ou `server`, rode tambem `npm run test:integration`.

## Roteamento de contexto

- Consulte skills quando a tarefa casar claramente com uma skill.
- A origem canonica das skills neste repositorio e [`.github/skills`](/workspaces/chatgpt-docker-puppeteer/.github/skills).
- Para documentacao externa, use `context7-docs-ops`.
- Para navegacao ou diagnostico semantico, use `lsp-ops` ou `rag-mcp-lsp-ops`.
- Para tipagem ou JSDoc, use `jsdoc-authoring`, `typescript-typing` ou
  `typing-node24-esm-tsserver`.
- Use skills de auditoria apenas em tarefas de auditoria, triagem ou runbook.

## O que nao vira baseline automatico

- [`.github/prompts/prompts.js`](/workspaces/chatgpt-docker-puppeteer/.github/prompts/prompts.js)
  e referencia sob demanda, nao leitura obrigatoria em toda tarefa.
- [`.github/agents/audit-agent.json`](/workspaces/chatgpt-docker-puppeteer/.github/agents/audit-agent.json)
  e um agente especializado, nao baseline universal.
- Ignore `AGENTS.md` de dependencias vendorizadas, salvo quando a tarefa tocar diretamente esse
  subtree.
