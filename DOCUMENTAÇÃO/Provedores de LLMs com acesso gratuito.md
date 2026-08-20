# Provedores de LLMs com acesso gratuito, API key e uso análogo ao Kilo Code

**Versão canônica:** 2026-05-21 **Autor:** ChatGPT para Yuri Ilenburg **Escopo:** provedores,
roteadores e plataformas que oferecem acesso a LLMs por API key com algum modo gratuito, cota
gratuita, trial sem cartão, créditos iniciais ou integração compatível com ferramentas de
desenvolvimento. **Foco:** uso com Kilo Code, Roo Code, Cline, Continue, OpenCode, VS Code, GitHub
Actions, scripts Node.js 24+ ESM e automações agentic.

> **Aviso crítico:** limites, modelos disponíveis, planos gratuitos e políticas de retenção mudam
> com frequência. Antes de usar em fluxo real, confirme nos links oficiais de cada provedor. Para
> código proprietário, segredos, dados pessoais, credenciais, repositórios privados ou material
> regulado, não presuma que um free tier seja seguro.

---

## 1. Definição operacional de “análogo ao Kilo Code”

Neste documento, “análogo ao Kilo Code free” não significa apenas “ter um chat gratuito”. O critério
é mais técnico:

1. **API key ou token de autenticação** disponível ao usuário.
2. **Endpoint HTTP utilizável por ferramentas externas**, preferencialmente compatível com OpenAI
   Chat Completions/Responses.
3. **Acesso gratuito real**, seja por cota recorrente, plano experimental gratuito, roteador de
   modelos grátis, free credits ou camada trial.
4. **Modelos úteis para código**, raciocínio, automação ou agentes.
5. **Documentação oficial pública**.
6. **Limites claros ou pelo menos verificáveis**.
7. **Viabilidade em ferramentas de coding agent** como Kilo, Roo, Cline, Continue, Cursor-like
   clients ou scripts próprios.

### Importante: Kilo Code como baseline

Kilo Code não é apenas um “provedor de modelos”. Ele é uma ferramenta/agente que pode usar modelos
por diferentes caminhos: o Kilo Gateway, provedores configurados pelo usuário e modelos gratuitos
como `kilo-auto/free`. A própria documentação do Kilo afirma que existem modelos gratuitos para
interações agentic, autocomplete e tarefas de background, mas também alerta que modelos gratuitos
podem ser limitados por rate limits upstream e que o Auto Free pode rotear para provedores que logam
prompts e respostas. Portanto, o Kilo é usado aqui como **referência funcional**, não como definição
estrita de provedor.

**Documentação oficial:**

- Kilo — Using Kilo for Free: https://kilo.ai/docs/getting-started/using-kilo-for-free
- Kilo — Privacy: https://kilo.ai/docs/reference/privacy

---

## 2. Taxonomia dos modelos de gratuidade

Nem todo “free” é equivalente. Para evitar confusão, esta investigação usa as seguintes categorias:

| Categoria                       | O que significa                                          |        Robustez típica | Risco principal                              |
| ------------------------------- | -------------------------------------------------------- | ---------------------: | -------------------------------------------- |
| **Free router**                 | Um roteador escolhe modelos gratuitos disponíveis        | Alta para prototipagem | Política de dados varia por provedor roteado |
| **Free tier recorrente**        | Cota gratuita contínua com limites por dia/minuto/tokens |                   Alta | Limites podem mudar                          |
| **Plano experimental gratuito** | Uso gratuito para avaliação/prototipagem                 |             Média/alta | Normalmente não é produção                   |
| **Créditos iniciais**           | Valor gratuito ao criar conta                            |            Média/baixa | Expira ou acaba rápido                       |
| **Trial key**                   | Chave gratuita limitada                                  |                  Média | Uso comercial/produção geralmente proibido   |
| **Subscription/points**         | API ligada a assinatura ou pontos                        |      Baixa como “free” | Não é equivalente a cota gratuita aberta     |
| **Local/self-hosted**           | Rodar modelos localmente                                 |       Alta privacidade | Não é API key cloud gratuita                 |

---

## 3. Ranking executivo

### Tier S — melhores análogos práticos

| Provedor                          | Tipo                         | Por que é forte                                                               |
| --------------------------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| **OpenRouter**                    | Free router / multiprovedor  | API unificada, modelos `:free`, roteador `openrouter/free`, OpenAI-compatible |
| **Groq**                          | Free tier rate-limited       | Muito rápido, OpenAI-compatible, bom para agentes leves                       |
| **Google Gemini API / AI Studio** | Free tier oficial            | Cotas gratuitas, multimodal, contexto grande, OpenAI-compatible               |
| **GitHub Models**                 | Free tier para contas GitHub | Ideal para devs, Actions, prototipagem e ecossistema GitHub                   |
| **Mistral / Codestral**           | Plano Experiment             | Bom para código, autocomplete e modelos Mistral                               |
| **Cerebras Inference**            | Free API access              | Inferência muito rápida, modelos abertos, OpenAI-compatible                   |
| **Chutes AI**                     | Free API / OpenAI-compatible | Citado pelo Kilo como opção free com API; útil, mas menos maduro que os acima |

### Tier A — bons, mas mais especializados ou com ressalvas

| Provedor                             | Melhor uso                                      | Ressalva                                                                             |
| ------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Hugging Face Inference Providers** | Catálogo amplo, modelos open-source, embeddings | Créditos gratuitos pequenos; custo/limites variam por provider                       |
| **Cloudflare Workers AI**            | Edge AI, apps serverless, bots                  | Modelo de cobrança por Neurons; integração nem sempre plug-and-play em coding agents |
| **Cohere**                           | RAG, embeddings, reranking, classificação       | Trial keys não são para produção/comercial                                           |
| **NVIDIA NIM**                       | Prototipagem com modelos NVIDIA e open models   | Produção exige licença/plano; limites do trial podem ser menos transparentes         |
| **Scaleway Generative APIs**         | Alternativa europeia, OpenAI-compatible         | Gratuidade/conta/billing variam; verificar no painel                                 |
| **SambaNova Cloud**                  | Créditos iniciais e modelos rápidos             | Créditos expiram; free tier limitado                                                 |

### Tier B/C — não são equivalentes robustos ao Kilo free

| Provedor                     | Motivo                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| **Together AI**              | Documentação atual indica ausência de free trial e compra mínima de créditos           |
| **Fireworks AI**             | Normalmente créditos iniciais pequenos, não free tier robusto                          |
| **Poe API**                  | API ligada a assinatura/pontos                                                         |
| **Venice API**               | Foco em créditos/DIEM/pay-as-you-go; não é free robusto clássico                       |
| **DeepSeek API**             | Muito barato e OpenAI-compatible, mas não confirmado como free tier recorrente robusto |
| **OpenAI / Anthropic / xAI** | Fortes tecnicamente, mas não são análogos diretos a “free robusto com API key”         |
| **Ollama local**             | Excelente e gratuito localmente, mas não é cloud provider com API key gratuita         |

---

## 4. Matriz comparativa canônica

| Provedor              | Categoria                   |              API key |                            OpenAI-compatible | Base URL típica                                            | Free/cota                                                  | Melhor uso                       | Cautela                                               |
| --------------------- | --------------------------- | -------------------: | -------------------------------------------: | ---------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------- | ----------------------------------------------------- |
| OpenRouter            | Free router                 |                  Sim |                                          Sim | `https://openrouter.ai/api/v1`                             | Modelos `:free`, `openrouter/free`, limites por minuto/dia | Gateway universal para agentes   | Provider routing e retenção variam                    |
| Groq                  | Free tier                   |                  Sim |                                          Sim | `https://api.groq.com/openai/v1`                           | Rate limits por modelo                                     | Baixa latência, coding curto     | Limites diários/tokens                                |
| Gemini API            | Free tier                   |                  Sim |                                          Sim | `https://generativelanguage.googleapis.com/v1beta/openai/` | Free tier por projeto/modelo                               | Multimodal, contexto, agentes    | Conteúdo do free tier pode ser usado para melhoria    |
| GitHub Models         | Free tier                   | Sim/PAT/GITHUB_TOKEN |                                          Sim | Endpoint GitHub Models                                     | Cotas por tipo de modelo/conta                             | GitHub Actions, protótipos dev   | Limites diários baixos para uso intenso               |
| Mistral               | Plano Experiment            |                  Sim | Parcial/SDK próprio e compatível em clientes | `https://api.mistral.ai/v1`                                | Free Experiment                                            | Código, Codestral, agentes leves | Plano experimental e política de dados exigem revisão |
| Cerebras              | Free API access             |                  Sim |                                          Sim | `https://api.cerebras.ai/v1`                               | Free tier/rate limits                                      | Inferência rápida                | Limites variam por modelo                             |
| Chutes AI             | Free API                    |                  Sim |                                          Sim | `https://llm.chutes.ai/v1`                                 | Free API citada pelo Kilo                                  | Modelos variados, testes         | Plataforma menos estabelecida                         |
| Hugging Face          | Créditos mensais/free       |         Sim/HF token |                  Via SDK/Inference Providers | Varia por provider                                         | Créditos mensais pequenos                                  | Modelos open-source, embeddings  | Custos variam por provider                            |
| Cloudflare Workers AI | Free allocation             |        Sim/API token |                             API própria/REST | Endpoint Cloudflare                                        | 10k Neurons/dia no Free                                    | Edge/serverless AI               | Não é padrão OpenAI puro em todos os casos            |
| Cohere                | Trial key                   |                  Sim |                                  API própria | `https://api.cohere.com`                                   | Trial calls/mês                                            | RAG, rerank, embed               | Trial não é produção/comercial                        |
| NVIDIA NIM            | Trial/prototyping           |                  Sim |                      Muitas APIs compatíveis | Catálogo NIM                                               | Free prototyping                                           | Modelos NVIDIA/open              | Produção requer licença/plano                         |
| Scaleway              | Free/credits + paid         |                  Sim |                                          Sim | `https://api.scaleway.ai/v1`                               | Verificar free tier no painel                              | EU cloud, serverless endpoints   | Pode exigir conta/billing                             |
| SambaNova             | Créditos iniciais/free tier |                  Sim |                                          Sim | API SambaNova Cloud                                        | Créditos iniciais e free tier limitado                     | Testes com modelos rápidos       | Créditos expiram; limites baixos                      |
| Fireworks             | Créditos iniciais           |                  Sim |                                          Sim | API Fireworks                                              | Créditos pequenos                                          | Avaliação rápida                 | Não é free robusto                                    |
| Together              | Pago/prepaid                |                  Sim |                                          Sim | API Together                                               | Sem free trial atual                                       | Produção open models             | Compra mínima de créditos                             |
| Poe                   | Assinatura/pontos           |                  Sim |                                          Sim | `https://api.poe.com/v1`                                   | Não é free robusto                                         | Acesso via pontos                | Dependente de assinatura                              |
| Venice                | Créditos/DIEM               |                  Sim |                                          Sim | `https://api.venice.ai/api/v1`                             | Não robusto como free                                      | Privacidade, modelos variados    | Crédito/pay-as-you-go                                 |
| Ollama local          | Local/self-hosted           |       Não necessário |                               Sim localmente | `http://localhost:11434/v1`                                | Gratuito local                                             | Privacidade e offline            | Precisa hardware; não é cloud API key                 |

---

# 5. Perfis detalhados por provedor

## 5.1 OpenRouter

**Classificação:** Tier S **Tipo:** roteador multiprovedor com modelos gratuitos. **Endpoint:**
`https://openrouter.ai/api/v1` **Autenticação:** Bearer token / OpenRouter API key.
**Compatibilidade:** OpenAI-compatible.

### Por que é análogo ao Kilo free

OpenRouter é provavelmente o análogo mais próximo do espírito “gateway de modelos”. Ele permite usar
muitos modelos por uma API unificada e oferece modelos gratuitos, incluindo modelos com sufixo
`:free` e o roteador `openrouter/free`.

### Pontos fortes

- Uma API para muitos modelos.
- Fallback e roteamento entre provedores.
- Compatível com SDK OpenAI.
- Útil em Kilo, Roo, Cline, Continue e scripts próprios.
- Permite escolher provedores com políticas específicas, como Zero Data Retention.

### Limitações e riscos

- Modelos gratuitos têm limites.
- Free variants podem ter limite baixo de requests por minuto/dia.
- A política de retenção depende do provedor efetivamente usado, salvo quando você configura filtros
  adequados.
- Para dados sensíveis, use provedores com ZDR ou plano pago/privado.

### Exemplo `.env`

```bash
LLM_BASE_URL="https://openrouter.ai/api/v1"
LLM_API_KEY="sk-or-..."
LLM_MODEL="openrouter/free"
```

### Documentação oficial

- Quickstart: https://openrouter.ai/docs/quickstart
- API keys/auth: https://openrouter.ai/docs/api-reference/authentication
- Free Models Router: https://openrouter.ai/openrouter/free
- Free model collection: https://openrouter.ai/collections/free-models
- Rate limits / free usage: https://openrouter.ai/docs/api-reference/limits
- Privacy / provider routing / ZDR: https://openrouter.ai/docs/features/privacy-and-logging
- Provider routing: https://openrouter.ai/docs/features/provider-routing

---

## 5.2 Groq

**Classificação:** Tier S **Tipo:** free tier rate-limited para inferência rápida. **Endpoint:**
`https://api.groq.com/openai/v1` **Autenticação:** Groq API key. **Compatibilidade:**
OpenAI-compatible.

### Por que é análogo ao Kilo free

Groq fornece API key, endpoint compatível com OpenAI e limites gratuitos por modelo. É uma das
opções mais úteis para coding agents quando a prioridade é velocidade.

### Pontos fortes

- Latência muito baixa.
- Compatível com SDK OpenAI.
- Modelos abertos relevantes, como Llama, Qwen e gpt-oss, conforme disponibilidade atual.
- Bom para tarefas curtas de código, revisão, explicação, geração de comandos e agentes leves.

### Limitações e riscos

- Rate limits são por modelo e podem ser apertados para fluxos agentic longos.
- Free tier não deve ser tratado como produção ilimitada.
- Verifique política de retenção e disponibilidade de Zero Data Retention antes de enviar dados
  sensíveis.

### Exemplo `.env`

```bash
LLM_BASE_URL="https://api.groq.com/openai/v1"
LLM_API_KEY="gsk_..."
LLM_MODEL="qwen/qwen3-32b"
```

### Documentação oficial

- OpenAI compatibility: https://console.groq.com/docs/openai
- Quickstart: https://console.groq.com/docs/quickstart
- Rate limits: https://console.groq.com/docs/rate-limits
- Models: https://console.groq.com/docs/models
- Security / data handling: https://groq.com/security/

---

## 5.3 Google Gemini API / Google AI Studio

**Classificação:** Tier S **Tipo:** free tier oficial por projeto/modelo. **Endpoint
OpenAI-compatible:** `https://generativelanguage.googleapis.com/v1beta/openai/` **Autenticação:**
Gemini API key. **Compatibilidade:** OpenAI-compatible e SDKs próprios.

### Por que é análogo ao Kilo free

Gemini API fornece API key, modelos com free tier e endpoint compatível com OpenAI. É uma das
melhores opções para contexto grande, multimodalidade e agentes com análise de arquivos.

### Pontos fortes

- Free tier oficial em modelos selecionados.
- Multimodal.
- Bom contexto.
- OpenAI-compatible.
- Boa documentação e ecossistema estável.

### Limitações e riscos

- No free tier, o conteúdo pode ser usado para melhorar produtos do Google, conforme documentação de
  pricing.
- Rate limits são por projeto e modelo.
- Para código proprietário, use plano pago ou configurações adequadas.

### Exemplo `.env`

```bash
LLM_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai/"
LLM_API_KEY="AIza..."
LLM_MODEL="gemini-3.5-flash"
```

### Documentação oficial

- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- OpenAI compatibility: https://ai.google.dev/gemini-api/docs/openai
- API key setup: https://ai.google.dev/gemini-api/docs/api-key
- Models: https://ai.google.dev/gemini-api/docs/models

---

## 5.4 GitHub Models

**Classificação:** Tier S **Tipo:** free tier para contas GitHub, com limites. **Autenticação:**
GitHub PAT ou `GITHUB_TOKEN`, dependendo do contexto. **Compatibilidade:** API de inferência
OpenAI-compatible.

### Por que é análogo ao Kilo free

GitHub Models dá a usuários GitHub acesso rate-limited a modelos para prototipagem. É especialmente
interessante para workflows dev, GitHub Actions, bots de repositório e automações ligadas a
PRs/issues.

### Pontos fortes

- Integrado ao GitHub.
- Disponível para contas GitHub com limites.
- Pode usar `GITHUB_TOKEN` em Actions.
- Bom para prototipar sem sair do ecossistema GitHub.
- Útil para comparar modelos.

### Limitações e riscos

- Cotas gratuitas podem ser baixas para agentes longos.
- O uso além da cota exige paid usage/BYOK, quando disponível.
- Verifique os termos do GitHub Models para dados de repositórios privados.

### Documentação oficial

- About billing for GitHub Models:
  https://docs.github.com/billing/managing-billing-for-your-products/about-billing-for-github-models
- Prototyping with AI models: https://docs.github.com/github-models/prototyping-with-ai-models
- GitHub Models docs: https://docs.github.com/github-models
- GitHub blog — inference for open source projects:
  https://github.blog/ai-and-ml/llms/solving-the-inference-problem-for-open-source-ai-projects-with-github-models/

---

## 5.5 Mistral / Codestral

**Classificação:** Tier S **Tipo:** plano Experiment gratuito. **Endpoint:**
`https://api.mistral.ai/v1` **Autenticação:** Mistral API key. **Compatibilidade:** SDK próprio e
integrações compatíveis em vários clientes.

### Por que é análogo ao Kilo free

Mistral oferece plano Experiment gratuito para avaliação e prototipagem. O Kilo também menciona
Codestral como opção para autocomplete gratuito via BYOK.

### Pontos fortes

- Bom para código, especialmente Codestral.
- Plano Experiment gratuito.
- Não exige cartão em alguns fluxos de setup, mas pode exigir verificação.
- Modelos Mistral são amplamente suportados em ferramentas dev.

### Limitações e riscos

- Plano Experiment é voltado a avaliação/prototipagem.
- A documentação de setup do plano experimental pode conter avisos sobre uso de requisições para
  melhoria de modelos; já a documentação geral de privacidade da API pode trazer nuances diferentes.
  Revise os termos atuais antes de enviar dados sensíveis.
- Limites são por workspace/organização e incluem RPS, TPM e tokens mensais.

### Exemplo `.env`

```bash
LLM_BASE_URL="https://api.mistral.ai/v1"
LLM_API_KEY="..."
LLM_MODEL="codestral-latest"
```

### Documentação oficial

- Rate limits / tiers: https://docs.mistral.ai/admin/user-management-finops/tier
- La Plateforme setup: https://docs.mistral.ai/getting-started/quickstart
- API keys: https://docs.mistral.ai/deployment/laplateforme/api-keys/
- Models: https://docs.mistral.ai/getting-started/models/
- Privacy / data: https://docs.mistral.ai/getting-started/privacy/

---

## 5.6 Cerebras Inference

**Classificação:** Tier S **Tipo:** free API access para modelos Cerebras-powered. **Endpoint:**
`https://api.cerebras.ai/v1` **Autenticação:** Cerebras API key. **Compatibilidade:**
OpenAI-compatible.

### Por que é análogo ao Kilo free

Cerebras oferece uma API de inferência com acesso gratuito e compatibilidade com SDK OpenAI. É
especialmente interessante para baixa latência e modelos abertos.

### Pontos fortes

- Muito rápido.
- OpenAI-compatible.
- Free API key.
- Bom para código, sumarização e agentes leves.
- Developer tier aumenta limites, se necessário.

### Limitações e riscos

- Rate limits variam por modelo e tier.
- Free tier pode não ser suficiente para agentes longos.
- Verifique disponibilidade dos modelos no momento do uso.

### Exemplo `.env`

```bash
LLM_BASE_URL="https://api.cerebras.ai/v1"
LLM_API_KEY="csk-..."
LLM_MODEL="gpt-oss-120b"
```

### Documentação oficial

- Pricing / Free access: https://www.cerebras.ai/pricing
- OpenAI compatibility: https://inference-docs.cerebras.ai/resources/openai
- Rate limits: https://inference-docs.cerebras.ai/support/rate-limits
- Models overview: https://inference-docs.cerebras.ai/models/overview
- Quickstart / API key: https://inference-docs.cerebras.ai/quickstart

---

## 5.7 Chutes AI

**Classificação:** Tier S/A **Tipo:** free API access, OpenAI-compatible. **Endpoint
compartilhado:** `https://llm.chutes.ai/v1` **Autenticação:** Chutes API key. **Compatibilidade:**
OpenAI-compatible.

### Por que é análogo ao Kilo free

A própria documentação do Kilo lista Chutes AI como opção que fornece acesso gratuito via API, com
variedade de modelos e rate limits. A documentação da Chutes mostra endpoint OpenAI-compatible para
chat completions.

### Pontos fortes

- OpenAI-compatible.
- API key.
- Variedade de modelos.
- Pode ser usado diretamente por clientes compatíveis com OpenAI.
- Bom para experimentar alternativas.

### Limitações e riscos

- Menos estabelecido que OpenRouter/Groq/Gemini/GitHub/Mistral.
- Verifique rate limits, disponibilidade e política de dados antes de uso sério.
- Recomendado para experimentação, não como única dependência crítica.

### Exemplo `.env`

```bash
LLM_BASE_URL="https://llm.chutes.ai/v1"
LLM_API_KEY="cpk_..."
LLM_MODEL="..."
```

### Documentação oficial

- Chutes AI: https://chutes.ai
- Chutes LLM API: https://chutes.ai/docs/llm-api
- Kilo free providers / tips: https://kilo.ai/docs/getting-started/using-kilo-for-free

---

## 5.8 Hugging Face Inference Providers

**Classificação:** Tier A **Tipo:** roteamento para múltiplos inference providers com créditos
gratuitos. **Autenticação:** Hugging Face token ou provider key customizada. **Compatibilidade:**
SDKs Hugging Face; compatibilidade varia por provider/modelo.

### Por que é útil

Hugging Face oferece acesso a centenas de modelos por Inference Providers. É excelente para testar
modelos open-source, embeddings, rerankers e modelos especializados.

### Pontos fortes

- Catálogo enorme.
- Integração com ecossistema Hugging Face.
- Possibilidade de usar HF token ou chave do provider.
- Útil para modelos que não aparecem nos roteadores comuns.

### Limitações e riscos

- Créditos gratuitos são pequenos.
- Preço e disponibilidade variam por provider.
- Para uso pesado, endpoints dedicados ou billing são necessários.

### Documentação oficial

- Inference Providers: https://huggingface.co/docs/inference-providers/index
- Billing / credits: https://huggingface.co/docs/inference-providers/pricing
- JS client: https://huggingface.co/docs/huggingface.js/inference/README
- Python client: https://huggingface.co/docs/huggingface_hub/package_reference/inference_client

---

## 5.9 Cloudflare Workers AI

**Classificação:** Tier A **Tipo:** free allocation diária no ecossistema Cloudflare.
**Autenticação:** Cloudflare API token + Account ID. **Compatibilidade:** API própria/REST; pode ser
integrado por wrappers.

### Por que é útil

Workers AI é forte para aplicações edge, bots serverless e automações próximas do usuário. O plano
Free inclui alocação diária de Neurons.

### Pontos fortes

- Edge/serverless.
- Integração com Workers, R2, D1, Queues e AI Gateway.
- Free allocation diária.
- Bom para apps pequenos e protótipos deployados.

### Limitações e riscos

- Nem sempre é drop-in OpenAI-compatible para coding agents.
- A unidade de cobrança “Neuron” precisa ser entendida.
- Modelo e disponibilidade dependem da plataforma.

### Documentação oficial

- Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Workers AI REST API:
  https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/
- Get started: https://developers.cloudflare.com/workers-ai/get-started/
- Models: https://developers.cloudflare.com/workers-ai/models/

---

## 5.10 Cohere

**Classificação:** Tier A **Tipo:** trial key gratuita limitada. **Autenticação:** Cohere API key.
**Compatibilidade:** API própria; alguns clientes possuem adaptadores.

### Por que é útil

Cohere é especialmente forte para RAG: embeddings, reranking, classificação e search semântico. Para
coding agents puros, é menos central que OpenRouter/Groq/Gemini, mas pode complementar muito bem
pipelines com retrieval.

### Pontos fortes

- Rerank forte.
- Embeddings.
- Classificação.
- Trial keys gratuitas.
- Boa documentação.

### Limitações e riscos

- Trial keys não são para produção/comercial.
- Limites mensais e por endpoint.
- Menos voltado a “coding agent LLM principal”.

### Documentação oficial

- Pricing: https://cohere.com/pricing
- Rate limits: https://docs.cohere.com/docs/rate-limits
- Trial keys vs production keys: https://docs.cohere.com/docs/rate-limits
- API docs: https://docs.cohere.com/reference/about

---

## 5.11 NVIDIA NIM

**Classificação:** Tier A **Tipo:** free prototyping / NIM API endpoints. **Autenticação:** NVIDIA
API key. **Compatibilidade:** muitos endpoints seguem padrões compatíveis com clientes conhecidos;
verificar por modelo.

### Por que é útil

NVIDIA NIM permite testar modelos serverless pelo catálogo NVIDIA, com foco em prototipagem e
desenvolvimento. É relevante para quem quer experimentar modelos Nemotron, Llama e outros em
infraestrutura NVIDIA.

### Pontos fortes

- Catálogo de modelos otimizado.
- Free prototyping.
- Bom para testes técnicos.
- Pode migrar para NIM self-hosted/enterprise.

### Limitações e riscos

- Produção exige licença/plano adequado.
- Limites do trial podem não ser tão claros quanto em Groq/Gemini/OpenRouter.
- Mais voltado a ambiente NVIDIA Enterprise/Developer.

### Documentação oficial

- NVIDIA NIM / build: https://build.nvidia.com/
- API keys: https://build.nvidia.com/settings/api-keys
- NIM docs: https://docs.nvidia.com/nim/
- Developer program: https://developer.nvidia.com/

---

## 5.12 Scaleway Generative APIs

**Classificação:** Tier A/B **Tipo:** serverless AI APIs, OpenAI-compatible. **Endpoint:**
`https://api.scaleway.ai/v1` **Autenticação:** Scaleway API key. **Compatibilidade:**
OpenAI-compatible.

### Por que é útil

Scaleway é uma alternativa europeia com endpoints serverless para modelos de texto/código. Pode ser
atrativa quando região, soberania de dados e infraestrutura EU importam.

### Pontos fortes

- OpenAI-compatible.
- Data centers europeus.
- Serverless endpoints.
- Boa para protótipos e alternativas regionais.

### Limitações e riscos

- Gratuidade/cotas podem depender da conta, billing e verificação.
- Verifique FAQ e painel antes de assumir free tier.
- Menos popular em tooling agentic que OpenRouter/Groq/Gemini.

### Exemplo `.env`

```bash
LLM_BASE_URL="https://api.scaleway.ai/v1"
LLM_API_KEY="..."
LLM_MODEL="..."
```

### Documentação oficial

- Generative APIs overview: https://www.scaleway.com/en/docs/generative-apis/
- Quickstart: https://www.scaleway.com/en/docs/generative-apis/quickstart/
- OpenAI compatibility / API usage: https://www.scaleway.com/en/docs/generative-apis/api-cli/
- FAQ: https://www.scaleway.com/en/docs/generative-apis/faq/
- Pricing: https://www.scaleway.com/en/generative-apis/

---

## 5.13 SambaNova Cloud

**Classificação:** Tier A/B **Tipo:** free credits + free tier limitado. **Autenticação:** SambaNova
API key. **Compatibilidade:** OpenAI-compatible.

### Por que é útil

SambaNova Cloud oferece créditos iniciais e API compatível com OpenAI. Pode ser útil para
benchmarks, protótipos e comparação de modelos.

### Pontos fortes

- OpenAI-compatible.
- Créditos iniciais.
- Modelos rápidos.
- Documentação clara de rate limits.

### Limitações e riscos

- Créditos podem expirar.
- Free tier tende a ser limitado.
- Não é substituto robusto para uso contínuo pesado.

### Documentação oficial

- SambaNova Cloud docs: https://docs.sambanova.ai/cloud/
- Pricing / free credits: https://docs.sambanova.ai/cloud/docs/pricing
- Rate limits: https://docs.sambanova.ai/cloud/docs/rate-limits
- OpenAI-compatible usage: https://docs.sambanova.ai/cloud/docs/get-started

---

# 6. Provedores úteis, mas não análogos robustos ao Kilo free

## 6.1 Together AI

Together é forte para modelos open-source em produção, mas a documentação de billing atual indica
que não há free trial no momento e que é necessário comprar créditos.

**Documentação oficial:**

- Billing / credits: https://docs.together.ai/docs/billing-credits
- API docs: https://docs.together.ai/docs/introduction

## 6.2 Fireworks AI

Fireworks costuma oferecer créditos iniciais pequenos. Isso é útil para teste, mas não equivale a um
free tier robusto e recorrente.

**Documentação oficial:**

- Pricing: https://fireworks.ai/pricing
- Docs: https://docs.fireworks.ai/

## 6.3 Poe API

Poe API é compatível com ferramentas como Cline/Roo/Continue, mas normalmente funciona via
assinatura/pontos. Portanto, não é equivalente a um provedor free robusto.

**Documentação oficial:**

- Poe API: https://creator.poe.com/docs/api
- OpenAI compatibility: https://creator.poe.com/docs/openai

## 6.4 Venice API

Venice API é OpenAI-compatible e interessante para privacidade, mas seu modelo tende a envolver
créditos, DIEM ou pagamento. Não entra como free robusto principal.

**Documentação oficial:**

- API docs: https://docs.venice.ai/
- OpenAI compatibility: https://docs.venice.ai/compatibility/openai

## 6.5 DeepSeek API

DeepSeek API é relevante por custo baixo e compatibilidade OpenAI/Anthropic-like, mas não deve ser
classificada como free tier robusto recorrente sem confirmação oficial atual.

**Documentação oficial:**

- API docs: https://api-docs.deepseek.com/
- Pricing: https://api-docs.deepseek.com/quick_start/pricing

## 6.6 Ollama local e Ollama cloud

Ollama local é gratuito e excelente para privacidade, inclusive com endpoint OpenAI-compatible
local. Porém, não é um provedor cloud free com API key no mesmo sentido dos demais.

**Documentação oficial:**

- Ollama: https://ollama.com/
- OpenAI compatibility: https://github.com/ollama/ollama/blob/main/docs/openai.md
- Ollama API: https://github.com/ollama/ollama/blob/main/docs/api.md

---

# 7. Recomendações por caso de uso

## 7.1 Melhor setup gratuito geral para coding agents

```text
1. OpenRouter
   Papel: fallback universal e acesso a vários modelos free.

2. Groq
   Papel: baixa latência para tarefas curtas.

3. Gemini API
   Papel: contexto grande, multimodalidade e análise geral.

4. Cerebras
   Papel: inferência rápida com modelos abertos.

5. Mistral / Codestral
   Papel: código e autocomplete.

6. GitHub Models
   Papel: GitHub Actions, bots de repositório e protótipos no ecossistema GitHub.
```

## 7.2 Melhor para baixa latência

1. Groq
2. Cerebras
3. SambaNova
4. OpenRouter com provedores rápidos selecionados

## 7.3 Melhor para contexto grande e multimodal

1. Gemini API
2. OpenRouter, dependendo dos modelos free disponíveis
3. GitHub Models, dependendo do modelo
4. Hugging Face, dependendo do provider/modelo

## 7.4 Melhor para repositórios e automações GitHub

1. GitHub Models
2. Gemini API
3. OpenRouter
4. Groq
5. Mistral

## 7.5 Melhor para privacidade

A resposta honesta é: **free tier raramente é a melhor opção para privacidade**.

Para material sensível, prefira:

1. Modelo local via Ollama/llama.cpp/vLLM.
2. Provedor pago com Zero Data Retention explícito.
3. OpenRouter com filtro ZDR e provedor selecionado conscientemente.
4. Groq/Mistral/Gemini em plano pago com política adequada.
5. Ambiente self-hosted/enterprise.

---

# 8. Estratégia de fallback para ferramentas agentic

Uma configuração robusta pode separar provedores por função:

```text
Router principal:
- OpenRouter openrouter/free

Rápido/barato:
- Groq
- Cerebras

Contexto/multimodal:
- Gemini

Código/autocomplete:
- Mistral Codestral

GitHub/CI:
- GitHub Models

RAG:
- Cohere Rerank/Embed
- Hugging Face embeddings
```

## Não abuse de free tiers

Não use múltiplas contas/chaves para burlar limites. Isso pode violar termos de uso e degradar a
disponibilidade para todos. A estratégia correta é fallback funcional, não evasão de rate limits.

---

# 9. Exemplo Node.js 24+ ESM com SDK OpenAI

Este exemplo funciona com qualquer provedor OpenAI-compatible que aceite `baseURL`.

```js
import OpenAI from "openai";

const {
  LLM_API_KEY,
  LLM_BASE_URL,
  LLM_MODEL = "openrouter/free",
} = process.env;

if (!LLM_API_KEY) {
  throw new Error("Missing LLM_API_KEY");
}

if (!LLM_BASE_URL) {
  throw new Error("Missing LLM_BASE_URL");
}

const client = new OpenAI({
  apiKey: LLM_API_KEY,
  baseURL: LLM_BASE_URL,
});

const response = await client.chat.completions.create({
  model: LLM_MODEL,
  messages: [
    {
      role: "system",
      content: "Você é um assistente técnico conciso e preciso.",
    },
    {
      role: "user",
      content: "Explique em uma frase por que este provedor é útil para coding agents.",
    },
  ],
});

console.log(response.choices[0]?.message?.content ?? "");
```

## Exemplos de `.env`

```bash
# OpenRouter
LLM_BASE_URL="https://openrouter.ai/api/v1"
LLM_MODEL="openrouter/free"

# Groq
LLM_BASE_URL="https://api.groq.com/openai/v1"
LLM_MODEL="qwen/qwen3-32b"

# Gemini OpenAI-compatible
LLM_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai/"
LLM_MODEL="gemini-3.5-flash"

# Cerebras
LLM_BASE_URL="https://api.cerebras.ai/v1"
LLM_MODEL="gpt-oss-120b"

# Chutes
LLM_BASE_URL="https://llm.chutes.ai/v1"
LLM_MODEL="<modelo-disponivel>"

# Scaleway
LLM_BASE_URL="https://api.scaleway.ai/v1"
LLM_MODEL="<modelo-disponivel>"

# SambaNova
LLM_BASE_URL="<base-url-atual-da-sambanova>"
LLM_MODEL="<modelo-disponivel>"
```

---

# 10. Checklist para avaliar um novo provedor free

Use este checklist antes de adicionar um provedor a Kilo/Roo/Cline/Continue:

- [ ] Existe API key individual?
- [ ] Há documentação oficial de autenticação?
- [ ] O endpoint é OpenAI-compatible?
- [ ] A cota gratuita é recorrente ou apenas crédito inicial?
- [ ] Os rate limits estão documentados?
- [ ] O provedor permite uso comercial?
- [ ] O free tier permite uso em automações/agents?
- [ ] Há política clara de logging, retenção e treinamento?
- [ ] Há opção Zero Data Retention?
- [ ] Os modelos disponíveis são úteis para código?
- [ ] Há suporte a tool calling/function calling?
- [ ] Há suporte a streaming?
- [ ] Há suporte a JSON mode/structured outputs?
- [ ] O provedor tem histórico de estabilidade?
- [ ] A ferramenta que você usa aceita `baseURL` customizado?

---

# 11. Critérios de decisão rápida

## Escolha OpenRouter se…

- Você quer muitos modelos por uma chave.
- Quer fallback e experimentação.
- Não quer manter várias integrações.
- Aceita gerenciar política de privacidade por provider.

## Escolha Groq se…

- Você quer velocidade.
- As tarefas são curtas.
- Você usa modelos abertos.
- Limites gratuitos bastam.

## Escolha Gemini se…

- Você quer contexto grande.
- Você precisa de multimodalidade.
- Quer documentação forte.
- Aceita as condições do free tier ou vai usar plano pago.

## Escolha GitHub Models se…

- O fluxo vive dentro do GitHub.
- Você quer usar Actions.
- Quer prototipar sem conta cloud separada.
- Os limites diários bastam.

## Escolha Mistral/Codestral se…

- O foco é código.
- Você quer autocomplete ou coding models.
- Você aceita o caráter experimental do plano gratuito.

## Escolha Cerebras se…

- Você quer velocidade com modelos abertos.
- Quer OpenAI-compatible simples.
- Seu uso cabe nos rate limits.

## Escolha Hugging Face se…

- Você quer variedade de modelos open-source.
- Precisa de embeddings/rerankers/modelos especializados.
- Aceita créditos pequenos ou billing por provider.

## Escolha Cloudflare Workers AI se…

- Você está construindo em Workers.
- Quer edge AI.
- O modelo de Neurons faz sentido.

---

# 12. Política de dados e segurança

## Princípio geral

Em provedores gratuitos, assuma o seguinte até prova contrária:

1. Prompts podem ser processados por terceiros.
2. Dados podem ser retidos por período limitado.
3. Conteúdo pode ser usado para melhoria de produto/modelo em alguns tiers.
4. Logs técnicos/metadata quase sempre existem.
5. Zero Data Retention, quando existe, precisa ser explicitamente ativado ou selecionado.

## Dados que você não deve enviar a free tiers sem revisão formal

- Chaves privadas.
- Tokens GitHub, AWS, GCP, Azure, Cloudflare etc.
- `.env`.
- Código proprietário sensível.
- Contratos.
- Dados pessoais.
- Dados de clientes.
- Vulnerabilidades não divulgadas.
- Informações reguladas por LGPD, HIPAA, PCI ou equivalentes.
- Materiais internos confidenciais.

## Estratégia segura

- Use modelos locais para segredos.
- Use free tiers apenas com dados públicos, sintéticos ou sanitizados.
- Remova credenciais antes de enviar código.
- Configure provider routing e ZDR quando disponível.
- Crie perfis separados: `free-experimental`, `paid-private`, `local-secure`.

---

# 13. Referências oficiais consolidadas

## Kilo Code

- https://kilo.ai/docs/getting-started/using-kilo-for-free
- https://kilo.ai/docs/reference/privacy

## OpenRouter

- https://openrouter.ai/docs/quickstart
- https://openrouter.ai/docs/api-reference/authentication
- https://openrouter.ai/openrouter/free
- https://openrouter.ai/collections/free-models
- https://openrouter.ai/docs/api-reference/limits
- https://openrouter.ai/docs/features/privacy-and-logging
- https://openrouter.ai/docs/features/provider-routing

## Groq

- https://console.groq.com/docs/quickstart
- https://console.groq.com/docs/openai
- https://console.groq.com/docs/rate-limits
- https://console.groq.com/docs/models
- https://groq.com/security/

## Google Gemini API

- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/rate-limits
- https://ai.google.dev/gemini-api/docs/openai
- https://ai.google.dev/gemini-api/docs/api-key
- https://ai.google.dev/gemini-api/docs/models

## GitHub Models

- https://docs.github.com/github-models
- https://docs.github.com/github-models/prototyping-with-ai-models
- https://docs.github.com/billing/managing-billing-for-your-products/about-billing-for-github-models
- https://github.blog/ai-and-ml/llms/solving-the-inference-problem-for-open-source-ai-projects-with-github-models/

## Mistral

- https://docs.mistral.ai/admin/user-management-finops/tier
- https://docs.mistral.ai/getting-started/quickstart
- https://docs.mistral.ai/deployment/laplateforme/api-keys/
- https://docs.mistral.ai/getting-started/models/
- https://docs.mistral.ai/getting-started/privacy/

## Cerebras

- https://www.cerebras.ai/pricing
- https://inference-docs.cerebras.ai/resources/openai
- https://inference-docs.cerebras.ai/support/rate-limits
- https://inference-docs.cerebras.ai/models/overview
- https://inference-docs.cerebras.ai/quickstart

## Chutes AI

- https://chutes.ai
- https://chutes.ai/docs/llm-api
- https://kilo.ai/docs/getting-started/using-kilo-for-free

## Hugging Face

- https://huggingface.co/docs/inference-providers/index
- https://huggingface.co/docs/inference-providers/pricing
- https://huggingface.co/docs/huggingface.js/inference/README
- https://huggingface.co/docs/huggingface_hub/package_reference/inference_client

## Cloudflare Workers AI

- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/get-started/
- https://developers.cloudflare.com/workers-ai/models/
- https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/

## Cohere

- https://cohere.com/pricing
- https://docs.cohere.com/docs/rate-limits
- https://docs.cohere.com/reference/about

## NVIDIA NIM

- https://build.nvidia.com/
- https://build.nvidia.com/settings/api-keys
- https://docs.nvidia.com/nim/
- https://developer.nvidia.com/

## Scaleway

- https://www.scaleway.com/en/docs/generative-apis/
- https://www.scaleway.com/en/docs/generative-apis/quickstart/
- https://www.scaleway.com/en/docs/generative-apis/api-cli/
- https://www.scaleway.com/en/docs/generative-apis/faq/
- https://www.scaleway.com/en/generative-apis/

## SambaNova

- https://docs.sambanova.ai/cloud/
- https://docs.sambanova.ai/cloud/docs/pricing
- https://docs.sambanova.ai/cloud/docs/rate-limits
- https://docs.sambanova.ai/cloud/docs/get-started

## Together AI

- https://docs.together.ai/docs/billing-credits
- https://docs.together.ai/docs/introduction

## Fireworks AI

- https://fireworks.ai/pricing
- https://docs.fireworks.ai/

## Poe

- https://creator.poe.com/docs/api
- https://creator.poe.com/docs/openai

## Venice

- https://docs.venice.ai/
- https://docs.venice.ai/compatibility/openai

## DeepSeek

- https://api-docs.deepseek.com/
- https://api-docs.deepseek.com/quick_start/pricing

## Ollama

- https://ollama.com/
- https://github.com/ollama/ollama/blob/main/docs/openai.md
- https://github.com/ollama/ollama/blob/main/docs/api.md

---

# 14. Conclusão canônica

Para um fluxo “Kilo-like” gratuito e tecnicamente robusto, a stack recomendada é:

```text
OpenRouter + Groq + Gemini + Cerebras + Mistral/Codestral + GitHub Models
```

O uso ideal é por função:

- **OpenRouter:** roteador/fallback geral.
- **Groq:** velocidade.
- **Gemini:** contexto e multimodalidade.
- **Cerebras:** velocidade com modelos abertos.
- **Mistral/Codestral:** código/autocomplete.
- **GitHub Models:** GitHub Actions e protótipos dev.

Para dados sensíveis, a recomendação muda:

```text
Local/self-hosted ou plano pago com Zero Data Retention explícito.
```

Free tiers são excelentes para pesquisa, aprendizado, prototipagem e automação leve. Eles não devem
ser confundidos com infraestrutura privada, estável e ilimitada de produção.
