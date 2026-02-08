# RAG v4.0 - Exemplos de Conversas Naturais

Este documento mostra **conversas reais** de como LLMs usam o sistema RAG naturalmente.

---

## 💬 Exemplo 1: Busca Simples de Código

### Conversa:

**Usuário:**
> Onde está definida a variável CHROME_PROXY_PORT?

**Claude (internamente):**
```
[Pensamento] Usuário quer encontrar uma variável no código.
Tenho a ferramenta rag_search que pode buscar no codebase.
Vou usá-la!

[Ação] Chamando rag_search com query="CHROME_PROXY_PORT definition"
```

**Claude (responde ao usuário):**
> Encontrei CHROME_PROXY_PORT definida em 3 locais principais:
>
> **1. `.devcontainer/devcontainer.json` (linhas 87-106)**
> ```json
> "CHROME_PROXY_PORT": "${localEnv:CHROME_PROXY_PORT:9224}",
> "CHROME_PORT": "${localEnv:CHROME_PORT:9225}",
> ```
> Este é o arquivo de configuração do DevContainer que define a porta 9224.
>
> **2. `.env.development` (linha 39)**
> ```bash
> CHROME_PROXY_PORT=9224
> ```
>
> **3. `ecosystem.config.cjs` (chrome-proxy process)**
>
> A porta 9224 é usada para o proxy do Chrome no container, que redireciona para a porta 9225 no host Windows.

**🎯 O que aconteceu:**
- Usuário fez uma pergunta natural
- Claude automaticamente decidiu usar `rag_search`
- Buscou no código com semantic search
- Formatou a resposta de forma clara e útil
- **Usuário nem percebeu que uma ferramenta foi usada!**

---

## 💬 Exemplo 2: Entendendo Implementação

### Conversa:

**Usuário:**
> Como funciona o kernel loop? Me explique a implementação

**Claude:**
```
[Pensamento] Preciso encontrar o código do kernel loop primeiro.
Vou usar rag_search para achar a implementação.

[Ação] Chamando rag_search com query="kernel loop implementation"
```

**Claude (após receber resultados):**
> O kernel loop está implementado em `src/kernel/kernel_loop/kernel_loop.js`. Vou te explicar:
>
> **Estrutura Principal:**
> ```javascript
> async function kernelLoop() {
>   while (!shouldStop) {
>     // 1. Verifica se há tarefas pendentes
>     const task = await taskQueue.next();
>
>     // 2. Executa a tarefa
>     await executeTask(task);
>
>     // 3. Aguarda próximo ciclo (KERNEL_CYCLE_INTERVAL)
>     await sleep(cycleInterval);
>   }
> }
> ```
>
> **Como funciona:**
> 1. Loop infinito que processa tarefas sequencialmente
> 2. Interval configurável via `KERNEL_CYCLE_INTERVAL` (default: 50ms)
> 3. Graceful shutdown quando `shouldStop` é true
> 4. Integrado com NERV para comunicação IPC
>
> **Arquivos relacionados:**
> - `kernel_loop.js` - Loop principal
> - `task_runtime.js` - Execução de tarefas
> - `execution_engine.js` - Engine de execução

**🎯 O que aconteceu:**
- Claude usou RAG para encontrar o código
- Analisou o código encontrado
- Explicou com exemplos e contexto
- Adicionou informações sobre arquivos relacionados

---

## 💬 Exemplo 3: Geração de Código Assistida

### Conversa:

**Usuário:**
> Preciso criar uma função que valida CPF. Pode gerar o código com docstring completa?

**Claude:**
```
[Pensamento] Usuário quer gerar código novo.
Tenho a ferramenta ollama_generate que pode usar o modelo local.
Vou usar qwen2.5-coder:7b que é bom para código.

[Ação] Chamando ollama_generate com prompt adequado
```

**Claude (responde):**
> Claro! Vou gerar usando o modelo local qwen2.5-coder:
>
> ```javascript
> /**
>  * Valida um número de CPF (Cadastro de Pessoas Físicas) brasileiro
>  *
>  * @param {string} cpf - O CPF a ser validado (com ou sem formatação)
>  * @returns {boolean} true se o CPF é válido, false caso contrário
>  *
>  * @example
>  * validateCPF('123.456.789-09') // true ou false
>  * validateCPF('12345678909')     // true ou false
>  *
>  * @description
>  * Esta função valida o CPF verificando:
>  * 1. Se contém 11 dígitos numéricos
>  * 2. Se não é uma sequência repetida (111.111.111-11, etc.)
>  * 3. Se os dígitos verificadores estão corretos
>  */
> function validateCPF(cpf) {
>   // Remove caracteres não numéricos
>   cpf = cpf.replace(/[^\d]/g, '');
>
>   // Valida tamanho
>   if (cpf.length !== 11) return false;
>
>   // Valida sequências repetidas
>   if (/^(\d)\1{10}$/.test(cpf)) return false;
>
>   // Calcula primeiro dígito verificador
>   let sum = 0;
>   for (let i = 0; i < 9; i++) {
>     sum += parseInt(cpf[i]) * (10 - i);
>   }
>   let digit1 = (sum * 10) % 11;
>   if (digit1 === 10) digit1 = 0;
>
>   // Valida primeiro dígito
>   if (digit1 !== parseInt(cpf[9])) return false;
>
>   // Calcula segundo dígito verificador
>   sum = 0;
>   for (let i = 0; i < 10; i++) {
>     sum += parseInt(cpf[i]) * (11 - i);
>   }
>   let digit2 = (sum * 10) % 11;
>   if (digit2 === 10) digit2 = 0;
>
>   // Valida segundo dígito
>   return digit2 === parseInt(cpf[10]);
> }
> ```
>
> Esta função foi gerada localmente usando **qwen2.5-coder:7b**. Ela inclui:
> - ✅ Docstring JSDoc completa
> - ✅ Validação de formato
> - ✅ Verificação de sequências repetidas
> - ✅ Cálculo correto dos dígitos verificadores
> - ✅ Exemplos de uso

**🎯 O que aconteceu:**
- Claude usou Ollama local (privacidade total!)
- Gerou código de qualidade com documentação
- Explicou o que a função faz
- **Nenhum código foi enviado para internet!**

---

## 💬 Exemplo 4: Múltiplas Ferramentas em Sequência

### Conversa:

**Usuário:**
> Quais modelos Ollama eu tenho? E depois use o melhor para gerar um comentário explicando o que é MMR no RAG

**Claude:**
```
[Pensamento] Usuário fez duas perguntas:
1. Listar modelos - vou usar ollama_models
2. Gerar comentário - vou usar ollama_generate com o melhor modelo

[Ação 1] Chamando ollama_models
```

**Claude (primeira resposta):**
> Você tem 4 modelos Ollama instalados:
>
> **Para Geração de Código:**
> - qwen2.5-coder:7b (4.68 GB) - **Melhor qualidade**
> - qwen2.5-coder:3b (1.93 GB) - Balanceado
>
> **Para Chat Geral:**
> - qwen2.5:3b-instruct (1.93 GB)
>
> **Para Embeddings:**
> - nomic-embed-text (0.27 GB)
>
> Vou usar o **qwen2.5-coder:7b** para gerar o comentário sobre MMR...

```
[Ação 2] Chamando ollama_generate com modelo="qwen2.5-coder:7b"
```

**Claude (segunda resposta):**
>
> ```javascript
> /**
>  * MMR (Maximal Marginal Relevance) - Algoritmo de Diversificação
>  *
>  * MMR é usado no RAG para balancear relevância e diversidade nos resultados.
>  *
>  * PROBLEMA SEM MMR:
>  * - Resultados muito similares (redundantes)
>  * - Top-K pode retornar o "mesmo" código 5 vezes
>  *
>  * SOLUÇÃO COM MMR:
>  * - Lambda (λ) controla o trade-off:
>  *   λ = 1.0 → apenas relevância (pode haver duplicatas)
>  *   λ = 0.0 → apenas diversidade (pode perder relevância)
>  *   λ = 0.7 → balanceado (recomendado)
>  *
>  * FÓRMULA:
>  * MMR = λ * relevance(doc) - (1-λ) * max_similarity(doc, selected_docs)
>  *
>  * EXEMPLO:
>  * Query: "error handling"
>  * - Sem MMR: 5 funções diferentes mas todas fazem try-catch
>  * - Com MMR: try-catch, custom errors, logging, retry logic, fallback
>  *
>  * @see https://en.wikipedia.org/wiki/Maximal_marginal_relevance
>  */
> ```

**🎯 O que aconteceu:**
- Claude usou 2 ferramentas em sequência
- Escolheu o modelo apropriado automaticamente
- Gerou comentário educativo e completo
- Workflow natural sem intervenção do usuário

---

## 💬 Exemplo 5: Conversação Contextual

### Conversa Contínua:

**Usuário:**
> Me mostre onde está o adaptive throttling

**Claude:**
```
[Ação] rag_search("adaptive throttling implementation")
```

**Claude:**
> O adaptive throttling está em `src/logic/adaptive.js`. O sistema ajusta dinamicamente o delay entre operações baseado na carga da CPU...

**Usuário (continua):**
> E como eu uso isso no meu código?

**Claude:**
```
[Pensamento] Já sei onde está o código (da busca anterior).
Agora vou buscar exemplos de uso.

[Ação] rag_search("adaptive throttling usage example")
```

**Claude:**
> Para usar o adaptive throttling no seu código:
>
> ```javascript
> import { adaptive } from '#logic/adaptive';
>
> // O adaptive já está inicializado globalmente
> const delay = adaptive.getDelay(); // Retorna delay em ms
>
> // Exemplo em um loop:
> for (const item of items) {
>   await processItem(item);
>   await sleep(adaptive.getDelay()); // Pausa adaptativa
> }
> ```
>
> O delay varia automaticamente de 50ms a 5000ms baseado na CPU.

**Usuário (continua):**
> Legal! Pode gerar uma docstring melhor para essa função getDelay?

**Claude:**
```
[Ação] ollama_generate("Generate improved JSDoc for adaptive.getDelay() method")
```

**Claude:**
> ```javascript
> /**
>  * Obtém o delay adaptativo atual baseado na carga do sistema
>  *
>  * @returns {number} Delay em milissegundos (range: 50-5000ms)
>  *
>  * @description
>  * Este método retorna um delay calculado dinamicamente que se ajusta
>  * à carga atual da CPU do sistema:
>  *
>  * - CPU < 50%: delay mínimo (50ms) - Sistema ocioso
>  * - CPU 50-80%: delay moderado (100-500ms) - Carga normal
>  * - CPU > 80%: delay máximo (5000ms) - Sistema sobrecarregado
>  *
>  * O delay é recalculado a cada 30 segundos baseado em métricas
>  * coletadas pelo módulo hardware.
>  *
>  * @example
>  * // Em um processamento batch
>  * for (const task of tasks) {
>  *   await executeTask(task);
>  *   await sleep(adaptive.getDelay());
>  * }
>  *
>  * @see src/core/hardware.js - Coleta de métricas de CPU
>  */
> ```

**🎯 O que aconteceu:**
- Conversa natural de 3 turnos
- Claude manteve contexto entre perguntas
- Usou 3 ferramentas diferentes apropriadamente
- Cada resposta construiu em cima da anterior

---

## 🎨 Como as LLMs Decidem Qual Ferramenta Usar?

### Lógica de Decisão (automática):

```
SE usuário pergunta ONDE/QUANDO algo está no código
  → Usar rag_search

SE usuário pergunta COMO algo funciona
  → Usar rag_search primeiro para achar código
  → Depois explicar

SE usuário pede para GERAR código novo
  → Usar ollama_generate

SE usuário pergunta sobre MODELOS disponíveis
  → Usar ollama_models

SE usuário pergunta se SISTEMA está OK
  → Usar rag_health

SE usuário quer COMPARAR similaridade de textos
  → Usar ollama_embed
```

### Exemplos de Triggers:

| Pergunta do Usuário | Ferramenta Usada | Por quê |
|---------------------|------------------|---------|
| "Onde está X?" | `rag_search` | Busca no código |
| "Como funciona Y?" | `rag_search` | Encontra implementação |
| "Gere código para Z" | `ollama_generate` | Geração de código |
| "Quais modelos tenho?" | `ollama_models` | Lista modelos |
| "RAG está funcionando?" | `rag_health` | Verifica saúde |
| "Estes textos são similares?" | `ollama_embed` | Calcula embeddings |

---

## 🌟 Características do Uso Natural

### ✅ **Transparente**
- Usuário não precisa saber que ferramentas existem
- LLM decide automaticamente
- Fluxo natural de conversa

### ✅ **Contextual**
- LLM mantém contexto entre perguntas
- Pode usar múltiplas ferramentas em sequência
- Respostas constroem em cima de queries anteriores

### ✅ **Privado**
- Ollama roda localmente (nenhum código sai do container)
- RAG busca apenas no codebase local
- Zero dados enviados para cloud

### ✅ **Rápido**
- Cache de embeddings (40-60% hit rate)
- Resultados em <2 segundos
- Ollama local (sem latência de rede)

---

## 🚀 Como Configurar para Uso Natural

### Claude Desktop:

```bash
# 1. Copiar config
cp docs/integration/examples/claude_desktop_config.json \
   ~/Library/Application\ Support/Claude/claude_desktop_config.json

# 2. Reiniciar Claude Desktop

# 3. Testar - apenas pergunte naturalmente:
"Onde está CHROME_PROXY_PORT?"
"Como funciona o kernel loop?"
"Gere uma função que valida email"
```

### GitHub Copilot (VS Code):

```
1. Abrir Copilot Chat (Ctrl/Cmd + Shift + I)
2. Clicar no ícone de ferramentas (🔧)
3. "Add MCP Server" → "HTTP"
4. URL: http://localhost:3008/api/mcp
5. Testar no chat:
   "Quais modelos Ollama estão disponíveis?"
```

### OpenCode CLI:

```bash
# 1. Configurar
cp docs/integration/examples/opencode_config.json ~/.config/opencode/config.json

# 2. Iniciar
opencode

# 3. Perguntar naturalmente
> Encontre onde está definido CHROME_PORT
> Use qwen2.5-coder para gerar uma docstring
```

---

## 🎯 Resumo: Por Que é Natural?

1. **LLM tem contexto completo** das ferramentas disponíveis
2. **Descrições claras** de cada ferramenta (inputSchema)
3. **LLM decide automaticamente** quando usar cada uma
4. **Usuário só conversa normalmente** sem pensar em ferramentas
5. **Respostas são formatadas** pela LLM de forma útil

**É como ter um assistente especialista no seu codebase que:**
- Conhece todo o código (via RAG)
- Pode gerar código novo (via Ollama)
- Responde em linguagem natural
- Usa ferramentas automaticamente quando precisa

**O usuário só precisa perguntar!** 🎉
