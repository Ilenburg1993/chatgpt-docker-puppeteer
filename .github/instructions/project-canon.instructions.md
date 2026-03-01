---
name: 'Project Canon'
description: 'Núcleo canônico do repositório para agentes de IA'
applyTo: '**/*'
---

# Project Canon

**Propósito**: servir como baseline curto e estável para tarefas gerais de código neste repositório.  
**Status documental**: Canônico.  
**Público**: agentes de IA e mantenedores.  
**Última atualização**: 28 de fevereiro de 2026.

Este arquivo é o resumo canônico para tarefas gerais de código neste repositório. Aplique-o como
baseline curto e estável; use `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md` quando a tarefa exigir a
visão oficial completa da arquitetura.

## Linguagem e comunicação

- Responda em pt-BR ao interagir com humanos.
- Escreva documentação e instruções em pt-BR, salvo exigência contrária explícita.

## Runtime e módulos

- Presuma Node.js >=24.
- Este projeto usa ESM como padrão obrigatório.
- Preserve `"type": "module"` em `package.json`.
- Em código novo JavaScript, use `import` e `export`.
- Evite `require` e `module.exports`, salvo necessidade excepcional e justificada.

## Estrutura e arquitetura

- `index.js` é apenas a entrada delegada.
- `src/main.js` é o bootstrap canônico.
- `src/nerv/`, `src/kernel/`, `src/orchestrator/`, `src/agent/`, `src/driver/`, `src/infra/` e
  `src/server/` formam a espinha dorsal do runtime.
- `src/agent/` é a camada de workers internos (fila, watchdog, controle, missão e
  pós-processamento).
- `src/missions/` modela o domínio de missão; `src/agent/` executa os loops que mantêm esse
  domínio progredindo.
- `agents/` na raiz não é equivalente a `src/agent/`.
- A arquitetura oficial vive em `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md`.
- O índice canônico da arquitetura vive em `DOCUMENTAÇÃO/ARQUITETURA/README.md`.
- Quando o módulo já estiver na topologia NERV, prefira desacoplamento via eventos.

## Restrição arquitetural crítica

- Não introduza `puppeteer.launch()` neste processo.
- Não adicione gerenciamento local de browser neste processo.
- A integração com browser deve usar o Chrome externo e a infraestrutura de DevTools já existente.

## Convenções de código

- Prefira aliases existentes como `#core/*`, `#infra/*`, `#driver/*` e equivalentes.
- Mantenha 4 espacos, 120 colunas, aspas simples e ponto-e-virgula.
- Adicione JSDoc curto em exports públicas relevantes.
- Evite novas dependências sem justificativa clara.

## Mapa estável de diretórios

- `tests/`: testes, suporte e quarentena controlada.
- `scripts/`: automação operacional, auditoria e manutenção.
- `DOCUMENTAÇÃO/`: documentação canônica do projeto.
- `.github/`: instruções permanentes, skills, agentes e workflows.

## Quality gates mínimos

- Rode `npm run lint` após mudanças relevantes.
- Rode `npm run format:check` após mudanças relevantes.
- Rode `npm run test:unit` como baseline.
- Se a mudança tocar `driver`, `kernel` ou `server`, rode também `npm run test:integration`.

## Roteamento de contexto

- Consulte `DOCUMENTAÇÃO/ARQUITETURA/README.md` para navegar pela arquitetura.
- Consulte `DOCUMENTAÇÃO/RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md` quando a tarefa envolver
  governança, status ou backlog da documentação.
- A origem canônica das skills neste repositório é `.github/skills`.
- Para tipagem ou JSDoc, use as skills apropriadas apenas quando a tarefa pedir isso.
- Documentos históricos ficam em `DOCUMENTAÇÃO/ARQUIVO_MORTO/` e não formam baseline automático.

## O que não vira baseline automático

- `dist`, `node_modules`, `tmp`, caches e artefatos gerados não devem ser tratados como estrutura
  estável.
- Prompts e agentes especializados em `.github/prompts/` e `.github/agents/` são referência sob
  demanda, não baseline universal.
