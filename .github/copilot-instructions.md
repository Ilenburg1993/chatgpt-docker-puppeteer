# Copilot Instructions — chatgpt-docker-puppeteer

> **OBS:** responder sempre em português brasileiro (pt‑BR) ao interagir com humanos ou ao escrever
> documentação/instruções.

## Resumo canônico

Para o baseline curto e estável do projeto, consulte
`.github/instructions/project-canon.instructions.md`. Este arquivo continua sendo o guia detalhado de
arquitetura, padrões e fluxos operacionais.

### Agentes personalizados

- Este workspace suporta _custom agents_; um exemplo foi criado em
  `.github/agents/audit-agent.json`.
- Agentes são descritos em JSON (usando o schema Copilot Agent) e podem incluir instruções
  específicas, ferramentas e comportamentos diferentes do padrão.
- Para que o VS Code descubra os arquivos JSON basta manter `chat.useAgentsMdFile` habilitado (já
  está na configuração). Coloque-os em `.github/agents` ou em subpastas quando usar o recurso
  experimental de `chat.useNestedAgentsMdFiles`.

## Projeto em uma frase

Sistema Node.js 24+ (ESM obrigatório) que orquestra missões de longa duração com LLMs através de
automação de browser (Puppeteer). A arquitetura é fortemente orientada a eventos, com foco em
confiabilidade operacional, observabilidade e evolução contínua.

## Visão geral da arquitetura

1. **Boot sequence (6 fases)**
   - `config.json` → identidade → NERV bus → _browser pool_ → kernel 20 Hz → drivers/adapters →
     Express+Socket.io.
   - Arquivo `src/main.js` contém o bootstrap; funções em `src/core/` ajudam.
2. **NERV** (`src/nerv/`): barramento de eventos híbrido (local + Socket.io).
   - Componentes nunca se importam diretamente, apenas emitem/ouvem eventos.
   - Use `nerv.emit('event:name', data)` e `nerv.on('event:name', handler)`.
3. **Kernel & Orchestrator** (`src/kernel/`, `src/orchestrator/`): motor de decisão com policy
   engine, observações e runtime de tarefas.
   - Tarefas são JSON em `fila/`; fluxo: _read → policy → dispatch → result_.
4. **Drivers** (`src/driver/`): adaptadores específicos por alvo (ChatGPT, Gemini, etc.) e módulos
   comuns (`analyzer`, `stabilizer`, `human.js`).
   - `factory.js` fabrica instâncias; novos drivers devem estender a classe base e registrar-se.
5. **Infra** (`src/infra/`): gerenciamento de recursos (pool de browsers, locks, storage, queue).
   Testes frequentemente usam `infra/` mocks.
6. **Server & Dashboard** (`src/server/`, `src/dashboard-ui/`): API Express, gerador de tarefas,
   adaptador NERV↔Socket.io e controlador de PM2.

## Convenções e padrões específicos

- **Alias de caminho**: `#core/*`, `#infra/*`, `#driver/*`, etc. Evite `../../../`.
- **Estilo**: 4 espaços, 120 colunas, aspas simples, ponto-e-vírgula.
- **JSDoc obrigatório** para todas as exportações públicas; use `// @ts-check`.
- **Erros**: criar classes de domínio e emitir logs com contexto; use `logger.*`.
- **Eventos NERV**: nomes em maiúsculas com `:` separando domínios, p.ex. `DRIVER_EXECUTE_TASK`,
  `TASK_COMPLETED`.
- **Sem `try/catch` em imports**; apenas onde realmente necessário.
- **Sem novas dependências** sem aprovação explícita.

## Chaves de fluxo e ferramentas

- **Testes**: `npm run test` executa tudo; `npm run test:unit` para maioria.
  - Use `tests/unit/**` e `tests/integration/**`; replicam estrutura do `src/`.
  - O script `npm run test:unit` frequentemente arranca o migrator e DB em memória; simplesmente
    `<path>` pode limitar à suíte desejada.
- **Lint & formato**: `npm run lint` e `npm run format:check` são obrigatórios antes de commits.
  Premissas do CI aparecem em `Makefile` e workflows GitHub.
- **Dev container / Docker**:
  - Ver `Makefile` alvos como `make build`, `make up`, `make logs`.
  - Há scripts para checar portas, devcontainer health e ajustes específicos.
- **Debug**: `npm run dev` (nodemon). Logs em `logs/`; use `npm run diagnose`.
- **Queue**: `npm run queue:status`, `npm run queue:add` etc. para manipular.
- **PM2**: `npm run daemon:start/stop/restart` gerencia o agente em prod.

## Audit‑skills system (novo)

- Skills são markdown com metadados (`SKILL.md`) e agora residem em `.github/skills/`. Cada
  subdiretório sob `.github/skills` corresponde a um skill. O gerador está em
  `scripts/audit/make-skill.js`; rode `node scripts/audit/make-skill.js nome` e ele criará a pasta
  apropriada e adicionará um `npm run audit:…` alias.
- Prompts compartilhados estão em `.github/prompts/prompts.js`.
- Há testes de unidade em `tests/unit/audit_skills/` e um workflow escrito em
  `AUDIT_SKILLS_WORKFLOW.md`.
- O plano global de auditoria está em `AUDIT_SKILLS_PLAN.md`.

## Regras obrigatórias (manter)

- Use **Node.js 24+** e **ESM** (`import`/`export`) em novos arquivos JS.
- Evite caminhos relativos profundos quando houver alias (`#core/*`, `#infra/*`).
- Não introduza novas dependências sem justificar claramente no PR.
- Toda função nova relevante deve ter JSDoc curto e objetivo.
- Não use `try/catch` em imports.

## Qualidade mínima por alteração (atualizada)

1. Rodar lint (`npm run lint`).
2. Rodar formatação de verificação (`npm run format:check`).
3. Rodar testes impactados; no mínimo unidade (`npm run test:unit`).
4. Se alterar fluxo crítico (driver/kernel/server), preferir também integração
   (`npm run test:integration`).
5. Atualize `DOCUMENTAÇÃO/` ou `README.md` se novo conceito ou fluxo for introduzido.

## Diretrizes para mudanças grandes (atualizadas)

- Priorize mudanças incrementais e reversíveis.
- Mantenha compatibilidade Linux/Windows para scripts operacionais.
- Verifique dependências de navegador remoto (Chrome pool constants).
- Atualize documentação em `README.md`, `DOCUMENTAÇÃO/` e nos novos planos (`AUDIT_SKILLS_PLAN.md`,
  etc.) quando necessário.

## Mensagens de commit (levemente ampliadas)

Prefira convenções claras, ex.:

- `feat: add new driver for Gemini`
- `fix: correct memory leak in stabilizer.js`
- `docs: refresh copilot and contribution instructions`
- `chore: remove deprecated github automation files`

---

**Nota**: Este arquivo é o ponto de partida que qualquer agente deve ler antes de começar a
codificar. Adicione mais instruções sempre que surgir um padrão novo ou um fluxo não trivial (por
exemplo, o uso de `make-skill`, `nerv.emit`, outros scripts em `scripts/`).
