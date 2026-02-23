# Plano de Consolidação do Sistema de Testes

Este documento descreve a estratégia para consolidar o sistema de testes existente, aproveitando o
Node.js 24 ESM nativo e mantendo a porta aberta para ferramentas opcionais como Vitest. O objetivo é
obter cobertura coerente, facilidade de uso, performance e zero dependências extras, sem enfraquecer
a capacidade de evoluir no futuro.

---

## 1. Panorama Atual

- Usa apenas o runner builtin (`node --test`).
- Não há dependências de frameworks de teste no `package.json`.
- Todo o código de teste importa de `'node:test'` e `'node:assert'`.
- Cobertura é gerada por `c8` via scripts npm.
- Organização em pastas: `unit/`, `integration/`, `regression/`, etc.
- VSCode tem extensão Jest instalada por default (configuração do devcontainer).

## 2. Objetivos da Consolidação

1. Formalizar convenções e documentação.
2. Centralizar utilitários e configurações comuns.
3. Definir cobertura mínima e automatizar checagens.
4. Simplificar scripts e comandos usados por desenvolvedores e CI.
5. Ajustar integração com o editor, removendo ruído (Jest) e adicionando suporte opcional para
   Vitest/node-test.
6. Manter compatibilidade total com o estado atual; migração para outro runner deve ser opcional e
   gradual.

## 3. Tarefas e Etapas

### 3.1 Padronizar Convenções

- [ ] **Escolher nomenclatura única para ficheiros de teste**
  - Opções: `*.spec.js` (actual) ou `*.test.js`.
  - Renomear via script/codemod ou `git mv`+`sed` se alterar.
  - Actualizar `Makefile`/scripts para refletir a mudança.
- [ ] **Escrever guidelines no `tests/README.md`**
  - Estrutura de pastas (unit, integration, regression, e2e).
  - Exemplo mínimo de spec, comandos de execução, e como adicionar mocks/fixtures.
- [ ] **Adicionar verificação automática**
  - Configurar ESLint/`grep` no CI para rejeitar ficheiros com nomes fora do padrão.
  - Possível utilização de `npx` script de validação própria (`scripts/check-tests.js`).

### 3.2 Helpers e Setup

- [ ] **Biblioteca comum de utilitários** (`tests/helpers/index.js`)
  - Funções para `loadJson`, `getFixturePath`, `makeTempDir`, etc.
  - Exportar `assert`, `expect` wrappers se houver preferências.
  - Garantir que `helpers` é carregado no `setup.js`.
- [ ] **Arquivo de inicialização global** (`tests/setup.js`)
  - Definir `process.env.NODE_ENV = 'test'` e outras variáveis.
  - Aplicar stubs/globals leves (por ex. `global.fetch = …`).
  - Registrar timeout padrão (`Test.setTimeout(…)` ou `vitest.setTimeout`).
- [ ] **Ajustar scripts npm** para usar o setup:

  ```json
  "test:unit": "env -u NO_COLOR node --test --test-setup ./tests/setup.js 'tests/unit/**/*.spec.js'"
  ```

  - Fazer equivalente para `integration`/`regression`.

### 3.3 Cobertura

- [ ] **Scripts para cobertura**
  - Adicionar no `package.json`:

    ```json
    "coverage": "c8 npm run test:unit",
    "coverage:check": "c8 check-coverage --statements 80 --branches 75 --functions 80"
    ```

  - Criar variantes `coverage:unit`/`coverage:integration` se desejar relatórios separados.

- [ ] **Integrar em Makefile/CI**
  - `make coverage` que invoca `npm run coverage` e abre HTML.
  - Pipeline: executar `npm run coverage:check` e falhar se regressão.
  - Gerar badge via `shields.io` apontando para artefacto de cobertura.
- [ ] **Definir thresholds pragmáticos** (começar conservador, ajustar ao longo do tempo) e
      documentar o processo de exceção.

### 3.4 Scripts e Invocação

- [ ] **Definir scripts npm unificados** (exemplos abaixo):

  ```json
  "scripts": {
    "test:unit": "env -u NO_COLOR node --test --test-setup ./tests/setup.js 'tests/unit/**/*.spec.js'",
    "test:integration": "env -u NO_COLOR node --test --test-setup ./tests/setup.js 'tests/integration/**/*.spec.js'",
    "test:regression": "env -u NO_COLOR node --test --test-setup ./tests/setup.js 'tests/regression/**/*.spec.js'",
    "test": "npm run test:unit && npm run test:integration && npm run test:regression",
    "test:watch": "env -u NO_COLOR node --test --watch 'tests/**/*.spec.js'",
    "test:e2e": "node --test tests/e2e/**/*.spec.js"
  }
  ```

- [ ] **Simplificar opções repetidas** com pequenas funções JS ou scripts shell se necessário (ex.:
      `scripts/run-tests.js <pattern>`).
- [ ] **Documentação dos comandos** em `README.md` + snippet no `CONTRIBUTING.md` indicando "run
      `npm run test:unit` when editing core modules".

### 3.5 Editor e DevContainer

- [ ] **Eliminar ruído de Jest**
  - Remover `jest.autoRun`, `jest.runMode` e qualquer configuração relacionada no
    `.vscode/settings.json` e em `extensions.json`.
  - Substituir por `node-test` ou `vitest` extensions. Exemplo:

    ```jsonc
    "extensions": [
      "hbenl.vscode-test-explorer",
      "matklad.rust-analyzer", // etc
      //\"Orta.vscode-jest\" removed
    ],
    "settings": {
      "testExplorer.nodeTest.command": "node --test",
      "testExplorer.nodeTest.include": "tests/**/*.spec.js"
    }
    ```

- [ ] **Devcontainer customization**
  - Garantir que a extensão escolhida está listada em `customizations.vscode.extensions`.
  - Optionally add `postCreateCommand` to run `npm run test:unit` once to pre‑warm caches.

### 3.6 Opcional: Vitest

- [ ] **Decidir caso de uso inicial** (snapshots? mocks? watch?).
- [ ] Manter dependência `vitest` e `@vitest/coverage-c8` para acesso fácil.
- [ ] Escrever/atualizar `vitest.config.js` para coincidir com os padrões `node --test`.
- [ ] Incluir `test:vitest` + `test:watch` nos scripts npm.
- [ ] Converter alguns testes representativos como prova de conceito e documentar no plano como
      fazê‑lo (utilizar snippet codemod se desejar).
- [ ] Opcionalmente, configurar a extensão Vitest no editor para execução de testes em linha e
      debug.

### 3.7 Documentação e Onboarding

- [ ] **Estender `tests/README.md`** para conter:
  - Como executar cada tipo de teste (`npm run …`).
  - Padrões de escrita (`describe`/`it`, helpers, fixtures).
  - Como adicionar mocks/fixtures e onde colocá‑los.
  - Exemplos de conversão/vitest se aplicável.
- [ ] **Adicionar secção “Testes” em `CONTRIBUTING.md`** com:
  - Comandos pre‑commit.
  - Regras de coverage e como corrigir violações.
  - Processo de revisão (ex.: garantir que novos arquivos exista `describe`).
- [ ] **Badges**:
  - Coverage: `![coverage](https://img.shields.io/…/coverage.svg)`
  - Test status: `![tests](https://img.shields.io/…/tests.svg)`
- [ ] **Checklists** no PR template para garantir que testes foram atualizados.

### 3.8 Guardrails

- [ ] **Script de validação** (`scripts/check-tests.js`):
  - Verifica que nenhum spec importa de frameworks externos (`jest`, `mocha`, etc.).
  - Aplica linting básico no código de teste (ESLint configurado para `node:test`).
- [ ] **Timeout global**
  - No `tests/setup.js` aplicar `Test.setTimeout(10_000);` ou similar.
  - Opcionalmente, usar `ci -k` gate para falhar se qualquer teste ultrapassar Xs.
- [ ] **Monitoração de performance**
  - Registrar duração de cada arquivo via `NODE_TEST_REPORTER=json` e gerar relatório de slowest
    tests (pode ajudar a identificar candidatos a mocks/ficheiros separados).

## 4. Observações Extras

- **Sem dependências**: qualquer alteração que introduza um novo pacote deve ser justificada. O
  sistema atual funciona perfeitamente sem nada.

- **Migração**: se decidir adotar Vitest (ou outro runner) plenamente, a migração pode ser gradual;
  não há corte abrupto.

- **Performance**: `node --test` já roda em paralelo e aceita `--watch`. A simples adição de
  `--test-setup` melhora a repetibilidade.

## 5. Próximos passos imediatos

1. Commit inicial deste plano.
2. Implementar helpers/setup mencionados e ajustar scripts.
3. Remover entradas Jest da configuração de editor.
4. Incluir `coverage:check` no CI e no Makefile.
5. Opcional: manter Vitest instalado para futuras experiências.

---

Cumprindo estas etapas teremos um sistema de testes ESM 24 totalmente consolidado, documentado e
escalável, com a flexibilidade de ativar recursos avançados (Vitest) quando a necessidade surgir.
