# chatgpt-docker-puppeteer — Guia de Estilo para Revisão de Código

Este guia instrui o Gemini Code Assist a priorizar as convenções e padrões específicos deste
projeto ao revisar pull requests. O projeto é um sistema Node.js 24+ (ESM obrigatório) que orquestra
missões de longa duração com LLMs via automação de browser, com arquitetura orientada a eventos.

---

## 1. Runtime e Módulos

- **Node.js 24+ exclusivo.** Nunca aceitar downgrade de versão.
- **ESM obrigatório.** Todo código deve usar `import`/`export`. Nunca aceitar `require()` ou
  `module.exports` sem justificativa explícita e documentada.
- O arquivo `package.json` deve sempre manter `"type": "module"`.
- Flags de Node obrigatórias em produção: `--enable-source-maps --trace-warnings --unhandled-rejections=strict`.

## 2. Formatação e Estilo

- **Indentação**: 4 espaços. Nunca tabs.
- **Comprimento de linha máximo**: 120 caracteres.
- **Aspas**: simples (`'`) para strings. Nunca aspas duplas em código JS/TS.
- **Ponto-e-vírgula**: obrigatório em todo statement.
- **Prettier**: toda formatação deve ser consistente com `.prettierrc`. Qualquer arquivo que não
  passar em `npm run format:check` deve ser corrigido.
- **ESLint**: toda mudança deve passar em `npm run lint`. Warnings permitidos até o limite definido.

## 3. Importações e Aliases

- **Preferir aliases** sobre caminhos relativos profundos:
  - `#core/*` para `src/core/`
  - `#infra/*` para `src/infra/`
  - `#driver/*` para `src/driver/`
- Nunca importar além de 2 níveis `../../` sem usar alias.
- Importações devem ser agrupadas: built-ins do Node → dependências externas → módulos internos.

## 4. JSDoc e Tipagem

- **JSDoc obrigatório em toda exportação pública relevante.** JSDoc sem tipos são incompletos.
- Todo `@param` deve incluir `{type}`, todo `@returns` deve incluir `{type}`, todo `@throws` deve
  incluir `{ErrorType}`.
- Sinalizar como **HIGH** qualquer exportação pública sem JSDoc completo em `src/`.
- Usar `// @ts-check` em módulos JS que lidam com lógica crítica (kernel, driver, infra, core).
- Nunca usar `@param {any}` sem justificativa. Tipos `any` implícitos são bugs de manutenção.

## 5. Arquitetura e Acoplamento

### Barramento de eventos (NERV)
- Componentes dentro da topologia NERV (`src/nerv/`, `src/kernel/`, `src/driver/`, `src/server/`)
  devem comunicar-se **exclusivamente via eventos NERV**, nunca por importação direta cruzada.
- Detectar e sinalizar como **HIGH** qualquer importação de `src/kernel/` dentro de `src/agent/`
  ou vice-versa sem passar pelo barramento.
- Todo evento emitido deve ter um nome constante de `src/core/constants/`. Strings literais de
  evento em `nerv.emit()` são padrões proibidos.

### Domínios
- `src/agent/` → workers internos (fila, watchdog, controle, missão, pós-processamento)
- `src/missions/` → domínio de negócio (não executar loops aqui)
- `agents/` na raiz ≠ `src/agent/` — confusão entre os dois é um bug de nomenclatura
- Detectar importações cross-domain ilegais e sinalizar como **MEDIUM**. Exemplos de violações:
  - `src/agent/` importando diretamente de `src/missions/` (deve usar NERV)
  - `src/kernel/` importando de `src/server/` (deve usar NERV bridge)
  - `src/driver/` importando de `src/infra/` fora do padrão de injeção de dependência

### Browser
- **Nunca usar `puppeteer.launch()`** no processo principal. O browser é controlado via Chrome
  externo por DevTools Protocol. Qualquer uso de `puppeteer.launch()` é uma regressão **CRITICAL**.

## 6. Tratamento de Erros

- Nunca usar `catch(e) {}` vazio — sempre logar ou re-throw com contexto.
- Nunca expor `error.stack` em respostas de API (vazamento de informação sensível — **HIGH**).
- Usar classes de erro específicas do domínio. `new Error('mensagem genérica')` em código de
  domínio deve ser sinalizado como **LOW**.
- Callbacks assíncronas devem sempre ter `try/catch` ou encadeamento de `.catch()`.

## 7. Segurança

- **Nunca commitar secrets, tokens, API keys ou senhas** em qualquer arquivo (incluindo `.env.example`
  com valores reais). Sinalizar como **CRITICAL**.
- Validar todos os inputs de API com Zod ou validação explícita antes de processar.
- Headers de segurança HTTP obrigatórios: `Content-Security-Policy`, `X-Frame-Options`,
  `X-Content-Type-Options`, `Strict-Transport-Security`.
- Nunca usar `res.json(error)` sem sanitizar o stack trace — **HIGH**.
- Autenticação em rotas de API: endpoints sem `authenticate` middleware devem ter justificativa
  explícita ou são falhas de segurança — **HIGH**.

## 8. Performance e Memória

- Detectar listeners de eventos adicionados sem remoção correspondente (`addEventListener` sem
  `removeEventListener`) — padrão de vazamento de memória — **HIGH**.
- Detectar queries N+1 em loops (chamadas de banco de dados ou API dentro de `for`/`forEach` sem
  batching) — **MEDIUM**.
- `setInterval`/`setTimeout` sem referência para `clearInterval`/`clearTimeout` em código de
  módulo são vazamentos — **MEDIUM**.
- Evitar uso de `JSON.parse(JSON.stringify(obj))` para clone profundo — usar `structuredClone()`.

## 9. Testes

- O projeto usa o runner nativo do Node.js (`node --test`). Não usar Jest, Mocha ou outros runners.
- Toda nova funcionalidade em `src/` deve ter testes correspondentes em `tests/unit/` ou
  `tests/integration/`.
- Nunca remover ou comentar testes existentes sem justificativa explícita.
- Mocks devem usar `sinon` (já instalado). Não introduzir outros frameworks de mocking.

## 10. Workflows e CI

- Toda mudança em `.github/workflows/` deve passar em `node scripts/ci/validate-workflows.mjs`.
- Actions devem usar as versões pinadas definidas no validator:
  - `actions/checkout@v6`
  - `actions/setup-node@v6`
  - `actions/upload-artifact@v7`
  - `actions/cache@v5`
  - `reviewdog/action-shellcheck@v1.32.0`
- Todo workflow deve ter top-level `permissions:` e `concurrency:`.
- Pipes com `tee` em steps de workflow devem usar `set -o pipefail`.

## 11. Documentação

- O hub canônico de documentação é `DOCUMENTAÇÃO/`. Mudanças arquiteturais significativas devem
  atualizar `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md`.
- JSDoc de exportações públicas é documentação — ausência é dívida técnica.
- Comentários em código devem explicar o "por quê", não o "o quê" (código auto-explicativo).

## 12. Dependências

- Não introduzir novas dependências sem justificativa clara no PR.
- Dependências de produção (`dependencies`) vs desenvolvimento (`devDependencies`) devem ser
  corretamente categorizadas.
- Rodar `npm audit` após toda mudança em `package.json`.

---

**Comandos de qualidade obrigatórios:**

```bash
npm run lint              # ESLint
npm run format:check      # Prettier
npm run test:unit         # Testes unitários
npm run typecheck:node    # TypeScript via tsserver
node scripts/ci/validate-workflows.mjs  # Validação de workflows
```
