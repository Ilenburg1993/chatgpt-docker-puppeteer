## Instruções para o Assistente Autônomo — Projeto chatgpt-docker-puppeteer

Objetivo

- Fornecer um documento único e reutilizável que explique como orientar o assistente (este
  repositório) para leituras, escrita de documentação, execuções locais e ações com diferentes
  níveis de autonomia.

Como me orientar (boas práticas)

- Seja explícito e conciso: diga o objetivo, o resultado esperado e o local de saída.
- Indique caminhos/arquivos exatos quando quiser que eu leia ou modifique (ex.: `src/driver/*`).
- Declare o nível de autonomia desejado (ver seção 'Níveis de Autonomia').
- Para mudanças em código ou infra que podem afetar produções, peça confirmação explícita.

Template de pedido (use esse formato)

Objetivo: breve descrição do que precisa ser feito Entradas: arquivos, exemplos, UID, branch
desejada (opcional) Saída esperada: arquivos a criar/alterar, testes a rodar, local de commit
Autonomia: `read-only` | `docs` | `test-run` | `write-draft-branch` | `destructive` (explicitar)
Verificações: (opcionais) lint, testes, build Notas/constraints: limites, valores de timeout,
critérios de aceite

Exemplo de instrução curta

```
Objetivo: Gerar DOCUMENTAÇÃO/INFRA-POOL.md detalhando BrowserPool.
Entradas: ler `src/infra/browser_pool.js`, `.puppeteerrc.cjs`.
Saída: criar DOCUMENTAÇÃO/INFRA-POOL.md com API, runbook e exemplos; abrir branch `docs/infra-pool`.
Autonomia: write-draft-branch
Verificações: rodar `npm run lint` no diretório DOCUMENTAÇÃO
```

Níveis de Autonomia (padrões)

- read-only: só leitura de arquivos e resposta em texto.
- docs: criar/editar apenas arquivos sob `DOCUMENTAÇÃO/` ou `assistant/`.
- test-run: executar scripts de análise e testes (ex.: `npm run test-fast`) — não instala pacotes de
  sistema.
- write-draft-branch: criar branch, commitar mudanças (docs/code), e abrir PR rascunho — NÃO push
  para `main`.
- destructive: alterar código crítico, instalar pacotes ou executar comandos que exigem privilégios
  — REQUER autorização explícita e confirmação do usuário.

Ações permitidas por padrão (sem confirmação)

- Ler qualquer arquivo no repositório.
- Criar/editar arquivos em `DOCUMENTAÇÃO/` e `assistant/`.
- Executar scripts de análise não interativos (ex.: `node scripts/analyze-code-graph.js`).
- Gerar diagramas e artefatos locais (SVG/PNG) e salvar em `analysis/` ou `DOCUMENTAÇÃO/diagrams/`.

Ações que exigem confirmação explícita

- Alterar código de produção fora de docs (src/) — especialmente mudanças que afetam API.
- Instalar pacotes no sistema (apt/sudo) ou alterar containers/infra.
- Push direto para `main` ou merges automáticos.
- Reescrever histórico Git ou deletar backups/dados.

Formatos recomendados para resultados e commits

- Commits: `docs(infra): add browserpool runbook` — seguir estilo `type(scope): summary`.
- Branches: `docs/<subsystem>-<short>` ou `feat/<short>-<ticket>`.
- PRs: título curto + checklist (lint, tests, reviewers).

Checklist de submissão (quando for abrir PR rascunho)

- [ ] Lint passou (`npm run lint`)
- [ ] Testes rápidos passaram (`npm run test-fast`)
- [ ] Arquivos novos em `DOCUMENTAÇÃO/` seguem template
- [ ] Não há segredos acidentalmente adicionados

Como eu vou comunicar ações

- Preambulo curto antes de executar ferramentas (ex.: "Vou rodar o analisador de grafo...").
- Relato de progresso após 3–5 ações ou após criar/editar >3 arquivos.
- Pergunta explícita antes de ações destrutivas.

Criação de políticas persistentes

- Para tornar esta política permanente, posso criar `assistant/auto-policy.md` com regras (autonomia
  por diretório, exceções e lista de aprovadores humanos).

Quer que eu já crie esse arquivo de política (`assistant/auto-policy.md`) com as configurações acima
e um conjunto padrão de permissões (ex.: permitir `docs` e `write-draft-branch`)?

---

Versão: 2026-01-27 Local: `assistant/ASSISTANT_INSTRUCTIONS.md`
