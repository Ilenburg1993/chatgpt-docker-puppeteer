# Copilot Instructions - chatgpt-docker-puppeteer

**Propósito**: detalhar o contexto operacional e arquitetural mínimo para agentes neste repositório.  
**Status documental**: Canônico.  
**Público**: GitHub Copilot, agentes compatíveis e mantenedores.  
**Última atualização**: 28 de fevereiro de 2026.

> **OBS:** responder sempre em português brasileiro (pt-BR) ao interagir com humanos ou ao escrever
> documentação e instruções.

## Resumo canônico

Para o baseline curto e estável do projeto, consulte
`.github/instructions/project-canon.instructions.md`.

A arquitetura oficial começa em:

- `DOCUMENTAÇÃO/ARQUITETURA/README.md`
- `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md`

## Projeto em uma frase

Sistema Node.js 24+ (ESM obrigatório) que orquestra missões de longa duração com LLMs através de
browser automation, com arquitetura orientada a eventos, forte separação de domínios e foco em
confiabilidade operacional.

## Visão geral da arquitetura

1. **Bootstrap**
   - `src/main.js` é o ponto de entrada canônico do runtime.
   - `src/core/` concentra contratos, contexto, schemas e validadores centrais.
2. **Barramento de eventos**
   - `src/nerv/` é o barramento principal entre kernel, drivers, server e serviços auxiliares.
   - Quando o módulo já estiver nessa topologia, prefira desacoplamento por eventos.
3. **Decisão e execução**
   - `src/kernel/` coordena loop, runtime, observação, políticas e telemetria.
   - `src/orchestrator/` define estratégias de execução (`SINGLE_SHOT`, `ITERATIVE`, `MULTI_STEP`).
   - `src/agent/` executa os loops operacionais contínuos: fila, watchdog, controle, missão e
     pós-processamento.
   - `src/driver/` executa ações browser e mantém o atuador principal do sistema.
4. **Infra e superfícies externas**
   - `src/infra/` sustenta pool, DB, FS, queue, locks, proxy, storage e transporte.
   - `src/server/` expõe API, realtime, handlers, middleware e supervisão.
   - `src/dashboard-ui/` é o frontend do dashboard e não substitui o backend.
5. **Domínios de apoio**
   - `src/missions/`, `src/integration/`, `src/inference_gateway/`, `src/audit_agent/`,
     `src/shared/`, `src/state/`, `src/types/`, `src/logic/` e `src/validation/` completam a
     topologia atual.

## Mapa de diretórios do repositório

### Top-level estáveis

- `src/`: runtime oficial do produto.
- `tests/`: testes, suporte, fixtures, mocks, regressão e quarentena em `legacy/`.
- `scripts/`: automação interna e operacional por famílias (`audit/`, `ci/`, `ops/`, `setup/`,
  `health/`, `build/`, `codemods/`, `legacy/`).
- `DOCUMENTAÇÃO/`: hub canônico de documentação.
- `.github/`: instruções permanentes, skills, agentes e workflows.
- `assistant/`, `agents/`, `tools/`: áreas auxiliares e de tooling, não núcleo do runtime.

### Domínios principais de `src/`

- `src/nerv/`: barramento de envelopes e eventos.
- `src/kernel/`: núcleo soberano de decisão.
- `src/orchestrator/`: coordenação estratégica da execução.
- `src/agent/`: workers operacionais do runtime; não confundir com `agents/` na raiz.
- `src/driver/`: execução browser por alvo.
- `src/infra/`: recursos compartilhados e infraestrutura.
- `src/server/`: API, realtime e supervisão.
- `src/missions/`: missões e workflows.
- `src/integration/`: integrações externas.
- `src/inference_gateway/`: gateway de inferência complementar.
- `src/audit_agent/`: auditoria em background.

## Convenções e restrições obrigatórias

- Use Node.js 24+ e ESM (`import`/`export`) em novos arquivos JS.
- Evite caminhos relativos profundos quando houver alias (`#core/*`, `#infra/*`, `#driver/*`).
- Não introduza `puppeteer.launch()` como novo padrão neste processo.
- Não adicione gerenciamento local de browser como fonte de verdade.
- A integração browser deve usar o Chrome externo e a infraestrutura DevTools já existente.
- Não introduza novas dependências sem justificativa clara.
- Toda exportação pública relevante deve ter JSDoc curto e objetivo.

## Qualidade mínima por alteração

1. Rodar `npm run lint`.
2. Rodar `npm run format:check`.
3. Rodar os testes impactados; no mínimo `npm run test:unit`.
4. Se a alteração tocar `driver`, `kernel` ou `server`, preferir também `npm run test:integration`.
5. Atualizar `DOCUMENTAÇÃO/` e `.github/` quando um conceito estrutural mudar.

## Ecossistema de agentes e skills

- `.github/skills/`: procedimentos especializados e reutilizáveis.
- `.github/instructions/`: baseline persistente e curto.
- `.github/agents/`: agentes especializados do workspace.
- `.github/workflows/`: automações GitHub e CI/CD.
- Documentos históricos ficam em `DOCUMENTAÇÃO/ARQUIVO_MORTO/` e não devem competir com o baseline.
