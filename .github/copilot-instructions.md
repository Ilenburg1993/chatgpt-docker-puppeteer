# Copilot Instructions — chatgpt-docker-puppeteer

## Projeto em uma frase
Sistema Node.js 24 ESM para orquestrar missões de longa duração com LLMs via automação de browser (Puppeteer), com foco em confiabilidade operacional, observabilidade e evolução contínua.

## Regras obrigatórias
- Use **Node.js 24+** e **ESM** (`import`/`export`) em novos arquivos JS.
- Evite caminhos relativos profundos quando houver alias (`#core/*`, `#infra/*`, etc.).
- Não introduza novas dependências sem justificar claramente no PR.
- Toda função nova relevante deve ter JSDoc curto e objetivo.
- Não use `try/catch` em imports.

## Qualidade mínima por alteração
1. Rodar lint (`npm run lint`).
2. Rodar formatação de verificação (`npm run format:check`).
3. Rodar testes impactados; no mínimo unidade (`npm run test:unit`).
4. Se alterar fluxo crítico (driver/kernel/server), preferir também integração (`npm run test:integration`).

## Áreas do código
- `src/driver/`: automação de provedores LLM.
- `src/kernel/` e `src/orchestrator/`: execução, políticas e coordenação.
- `src/server/` e `src/dashboard-ui/`: API, dashboard e interface.
- `src/nerv/`: backbone de eventos.
- `scripts/`: automações de desenvolvimento e CI.

## Diretrizes para mudanças grandes
- Priorize mudanças incrementais e reversíveis.
- Mantenha compatibilidade Linux/Windows para scripts operacionais.
- Atualize documentação em `README.md` e `DOCUMENTAÇÃO/` quando necessário.

## Mensagens de commit
Prefira convenções claras, ex.:
- `ci: rebuild github workflows for node 24 esm`
- `docs: refresh copilot and contribution instructions`
- `chore: remove deprecated github automation files`
