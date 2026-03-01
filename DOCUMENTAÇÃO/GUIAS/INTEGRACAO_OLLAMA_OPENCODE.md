# Integração: Ollama + OpenCode (no projeto chatgpt-docker-puppeteer)

## 1) Onde Ollama + OpenCode “encaixam” neste repo

Este repositório tem dois eixos claros:

1. **Runtime do agente (produção/dev)**
   - Controla páginas (ChatGPT/Gemini/etc) via **automação de browser**.
   - Arquitetura “connect-only”: o container **conecta** a um Chrome externo (ver
     `src/infra/ConnectionOrchestrator.js` e `src/main.js`).

2. **Ferramentas de engenharia (dev workflow)**
   - Scripts, validações, análise de grafo, manutenção, etc.

**Ollama + OpenCode** se integra muito bem no eixo (2) (baixo risco, alto ganho).  
No eixo (1), ele pode entrar **como componente auxiliar** (ex.: validação / LLM-as-judge), mas _não
substitui_ o “driver via UI” sem uma evolução arquitetural.

---

## 2) Integração recomendada (baixo risco): OpenCode como “copiloto” do repo

### O que ganhamos

- Assistente no terminal com contexto do repo, comandos e memória do projeto.
- Possibilidade de rodar com **Ollama local** (sem enviar código para fora) ou com Ollama Cloud.

### O que já foi preparado no repo

- `OpenCode.md`: memória/protocolo rápido do projeto.
- `.opencode/commands/*`: comandos customizados (ex.: `/validate`, `/triage-chrome`).
- Templates de configuração: `tools/opencode/*.example.jsonc`.

### Como ligar OpenCode ao Ollama

- Siga `tools/opencode/README.md`.
- (Opcional) Use `ollama launch opencode` (setup rápido do Ollama) para criar/atualizar o config do
  OpenCode.

---

## 3) Integração “média”: usar Ollama para qualidade/validação (LLM-as-Judge)

Há um módulo pronto para **LLM-as-Judge** em `src/validation/llm_judge.js`, mas ele depende de um
“driver” com `sendPrompt()` que retorne texto (JSON).

Hoje, os drivers de UI (ex.: `src/driver/targets/ChatGPTDriver.js`) implementam `sendPrompt()` como
ação de UI (retorna `void`) e a validação acaba ficando “desacoplada” (driver do judge não é
configurado).

### Caminho de integração sugerido

- Criar um “JudgeClient” separado (HTTP) que implemente `sendPrompt(prompt, opts)` e use a API
  OpenAI-compatible do Ollama (`/v1/chat/completions`).
- Injetar esse client no `LLMJudge` via config (ex.: `LLM_JUDGE_PROVIDER=ollama`,
  `LLM_JUDGE_BASE_URL=...`, `LLM_JUDGE_MODEL=...`).
- Benefícios: validação local, custo previsível, menos dependência da UI.

---

## 4) Integração “alta”: executar tasks diretamente via Ollama (sem browser)

Para substituir “Puppeteer → UI” por “API local (Ollama)”, seria necessário:

- Um novo tipo de driver (ex.: `ApiTargetDriver`) que não dependa de `page`/Puppeteer.
- Um modo novo no Kernel/Orchestrator para selecionar “driver UI” vs “driver API”.
- Revisão dos módulos que assumem existência de page/DOM (SADI, stabilizer, extractors).

Isso é viável, mas é uma iniciativa de arquitetura (não apenas “trocar modelo”).

---

## 5) Próximos passos (decisão rápida)

Escolha uma trilha (pode ser incremental):

1. **Dev-only (recomendado)**: padronizar OpenCode + Ollama (local ou cloud) para o time.
2. **Dev + Judge**: provar o “LLM-as-Judge via Ollama” para validação barata e offline.
3. **Runtime via API**: roadmap de drivers API e modo de execução dual (UI/API).

Para uma proposta mais completa (multi-assistente + governança + roteamento de providers), ver:

- `DOCUMENTAÇÃO/ARQUITETURA_ASSISTENTES_E_LLM_SERVICES.md`
