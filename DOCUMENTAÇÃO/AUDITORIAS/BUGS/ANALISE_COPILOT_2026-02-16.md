# Análise de Código e Varredura de Bugs - Copilot

**Data:** 16 de fevereiro de 2026 **Autor:** GitHub Copilot **Escopo:** Análise estática e
arquitetural do código fonte (`src/`), ignorando relatórios anteriores.

## Resumo Executivo

A análise do código fonte revelou uma base sólida com boas práticas modernas (ESM, JSDoc, Zod), mas
identificou pontos críticos de fragilidade arquitetural, configurações hardcoded e "workarounds" de
tipagem que comprometem a manutenibilidade e resiliência a longo prazo.

---

## 1. Arquitetura e Design

### 🚨 Duplicação de Responsabilidade de Pool

- **Arquivo:** `src/driver/factory.js` vs `src/infra/browser_pool/`
- **Problema:** O `DriverFactory` (v3.0) implementa sua própria lógica de pooling (`MAX_POOL_SIZE`,
  `acquireFromPool`) para instâncias de drivers, enquanto existe um subsistema `browser_pool`
  dedicado a gerenciar instâncias do Chrome.
- **Risco:** Desalinhamento de estado. O factory pode tentar criar um driver (pool de objetos) sem
  que haja um navegador disponível (pool de recursos), ou vice-versa.
- **Correção Proposta:** Unificar a estratégia de pooling. O `DriverFactory` deve solicitar recursos
  diretamente ao `browser_pool` ou delegar o gerenciamento de ciclo de vida inteiramente a ele.

### ⚠️ Patch de Runtime Frágil

- **Arquivo:** `src/main.js` (L58) e `src/infra/browser_pool/puppeteer_guard.js`
- **Problema:** O sistema usa um "guard" importado dinamicamente para impedir chamadas a
  `puppeteer.launch()`. Isso é um "monkey-patch" arquitetural.
- **Risco:** Se o guard falhar ou for carregado tardiamente, violações arquiteturais podem passar
  despercebidas.
- **Correção Proposta:** Garantir que a infraestrutura (Docker/Config) não exponha executáveis do
  Chrome localmente ou usar linters arquiteturais (ex: `eslint-plugin-boundaries`) para proibir
  import de `puppeteer` fora da camada de infra.

### ⚠️ Acoplamento em `src/main.js`

- **Arquivo:** `src/main.js`
- **Problema:** O arquivo de entrada importa massivamente módulos de `#agent/*` e inicializa tudo
  explicitamente.
- **Risco:** `main.js` tende a se tornar um "God Object".
- **Correção Proposta:** Implementar um padrão de injeção de dependência mais robusto ou um
  carregador de módulos dinâmico baseado em configuração.

---

## 2. Segurança e Resiliência

### 🚨 Encerramento Abrupto de Processo em Lib

- **Arquivo:** `src/infra/locks/resilient_lock.js`
- **Problema:** Uso de `process.exit(1)` dentro de handlers de `uncaughtException` e
  `unhandledRejection` na classe de Lock.
- **Risco:** Uma falha na biblioteca de locks derruba toda a aplicação (incluindo servidor HTTP),
  negando oportunidade de graceful shutdown ou resposta de erro 500.
- **Correção Proposta:** Remover `process.exit`. A biblioteca deve apenas liberar locks e lançar
  erros para serem tratados pelo `App` ou `Kernel`.

### 🚨 Configuração CORS Frágil

- **Arquivo:** `src/server/engine/app.js`
- **Problema:** Lista de origens permitidas (`allowedOrigins`) contém IPs hardcoded (`172.17.0.2`)
  típicos de redes Docker internas.
- **Risco:** Se o IP do container mudar (comum em recriação), o dashboard perderá acesso à API.
- **Correção Proposta:** Usar variável de ambiente `ALLOWED_ORIGINS` (lista separada por vírgula) ou
  permitir faixas de IP via regex/CIDR configurável.

### ⚠️ Validação de Configuração "Permissiva"

- **Arquivo:** `src/core/config.js`
- **Problema:** `validateEnvFile` apenas loga erros (`log('ERROR', ...)`) mas não impede o boot.
- **Risco:** A aplicação inicia em estado instável se variáveis críticas (ex: `SERVER_PORT`)
  faltarem, falhando aleatoriamente depois.
- **Correção Proposta:** Fail-fast. Se config crítica falta, o processo deve encerrar imediatamente
  com código de erro claro.

---

## 3. Qualidade de Código e Manutenibilidade

### ⚠️ Abuso de `@type {any}`

- **Arquivos:** `src/core/forensics.js`, `src/core/boot_resilience_manager.js`,
  `src/server/engine/socket.js`, e outros.
- **Problema:** Uso extensivo de `/** @type {any} */` (cast forçado) para silenciar erros de tipagem
  do TypeScript/JSDoc.
- **Risco:** Perda de segurança de tipos. Refatorações futuras podem quebrar o código
  silenciosamente.
- **Correção Proposta:** Sprint técnica para tipar corretamente essas estruturas (ex: definir
  interfaces para `nerv`, `circuitBreaker`, `socket`).

### ⚠️ Configuração Descentralizada

- **Arquivo:** `src/driver/factory.js`
- **Problema:** Acesso direto a `process.env.DRIVER_POOL_MAX_SIZE` (e outras) dentro da classe,
  ignorando o módulo central `src/core/config.js`.
- **Risco:** Dificuldade de rastrear onde configurações são usadas e validar valores centralmente.
- **Correção Proposta:** Mover todas as variáveis de ambiente para o schema Zod em
  `src/core/config.js` e injetar a configuração no Factory.

### ⚠️ Estrutura de Testes

- **Diretório:** `tests/`
- **Problema:** Mistura de arquivos `.js` e `.py` na raiz, sem separação clara entre Unitário,
  Integração e E2E.
- **Correção Proposta:** Reorganizar `tests/` em subpastas (`unit/`, `integration/`, `e2e/`) e
  padronizar stack de testes (Node.js runner).

---

## 4. Plano de Ação Recomendado (Priorizado)

1.  **Imediato (P0)**:
    - Remover `process.exit` de `resilient_lock.js`.
    - Centralizar validação de ENV em `config.js` com throw on error.
    - Externalizar configuração de CORS.

2.  **Curto Prazo (P1)**:
    - Refatorar `DriverFactory` para consumir configuração de `config.js`.
    - Resolver conflito de gestão de Pool (`DriverFactory` vs `browser_pool`).

3.  **Médio Prazo (P2)**:
    - Limpeza de tipagem (remover `any` casts).
    - Reorganização da pasta `tests/`.
    - Remover código legado (`persistServerState`, `puppeteer_guard`).

---

_Fim do Relatório_
