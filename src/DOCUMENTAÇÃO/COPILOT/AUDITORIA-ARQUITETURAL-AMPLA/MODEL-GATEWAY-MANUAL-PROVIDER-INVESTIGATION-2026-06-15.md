# Investigação Manual de Configuração de Provedores Model Gateway

**Data**: 2026-06-15  
**Objetivo**: Investigar configuração manual de provedores para habilitar modelos fora do kilo-code
e zai

## Análise Arquitetural Atual

### Estrutura de Provedores

O sistema usa um padrão de adaptadores de provedores com:

1. **Provider Adapter Registry** - Centraliza resolução de adaptadores
2. **OpenAI Provider Family Adapter** - Para provedores compatíveis com OpenAI
3. **OpenAI Compatible Adapter** - Fallback para provedores desconhecidos

### Provedores Ativos no Sistema

```javascript
// Provedores registrados no registry:
- openRouterAdapter
- ollamaAdapter
- geminiAdapter
- anthropicAdapter
- ...openAIProviderFamilyAdapters (inclu cerebras, chutes, groq, mistral)
- openAICompatibleAdapter (fallback)
```

### Especificações dos Provedores Alvo

Todos os provedores alvo usam o mesmo padrão:

```javascript
// Exemplo: groq.js
export const GROQ_PROVIDER_SPEC = Object.freeze({
    id: 'groq',
    providerIds: Object.freeze(['groq']),
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
});

// Mistral.js, Cerebras.js, Chutes.js seguem o mesmo padrão
```

## Problema de Configuração Atual

### Falta de Probes e Autenticação

A análise do catálogo mostrou que todos os provedores (exceto zai) falharam devido a:

1. **agent_probe_missing** - 1980 modelos sem probe disponível
2. **chat_health_failed** - 19 modelos com falha de saúde
3. **unknown_cost** - Custo bloqueando execução

### Sistema de Segredos

O sistema usa `EnvSecretRegistry` para gerenciar chaves de API:

```javascript
// Em openai-compatible-adapter.js
function resolveProviderAuth(provider, secrets) {
    const auth = provider['auth'] ?? {};
    const bearerRefs = stringArray(auth['bearerTokenRefs']);
    const apiKeyRefs = stringArray(auth['apiKeyRefs']);

    // Busca tokens no registry de segredos
    for (const ref of bearerRefs) {
        const token = secrets.get(ref);
        if (token) return { bearerToken: token };
    }
    for (const ref of apiKeyRefs) {
        const apiKey = secrets.get(ref);
        if (apiKey) return { apiKey };
    }
    return {};
}
```

## Configuração Manual Necessária

### 1. Configuração de Segredos

Para cada provedor, é necessário configurar variáveis de ambiente:

```bash
# Para Groq
export GROQ_KEY="sua_chave_groq"

# Para Mistral
export MISTRAL_KEY="sua_chave_mistral"

# Para Cerebras
export CEREBRAS_KEY="sua_cherebras_key"

# Para Chutes
export CHUTES_AI="sua_chutes_key"
```

### 2. Configuração de Perfis

Os perfis existentes no sistema já estão configurados:

```json
// Existe perfil "groq-free" mas requer GROQ_KEY
{
    "name": "groq-free",
    "providerId": "groq",
    "model": "qwen/qwen3-32b",
    "secretRefs": ["GROQ_KEY"]
}
```

### 3. Problema de Probes

Os probes falham porque:

- Não há endpoint de probe configurado para provedores manualmente adicionados
- O sistema espera probes pré-existentes no catálogo

## Solução Proposta

### Opção 1: Configuração Manual Completa

1. **Configurar segredos via ambiente**
2. **Criar perfil manual no Model Gateway**
3. **Adicionar configuração de probe manual**

```javascript
// Exemplo de configuração manual
const manualProviderConfig = {
    provider: {
        id: 'groq',
        providerType: 'openai',
        baseUrl: 'https://api.groq.com/openai/v1',
        auth: {
            apiKeyRefs: ['GROQ_KEY']
        }
    },
    model: {
        providerModel: 'qwen/qwen3-32b',
        capabilities: {
            vision: false,
            reasoningEffort: false
        }
    }
};
```

### Opção 2: Expansão do Catálogo

1. **Adicionar provedores manualmente ao catálogo**
2. **Configurar probes específicos para cada provedor**
3. **Atualizar registry de adaptadores**

### Opção 3: Fallback OpenAI Genérico

1. **Usar openAICompatibleAdapter para todos os provedores**
2. **Configurar baseUrl e manualmente**
3. **Ignorar sistema de probes**

## Verificação de Viabilidade

### ZAI (Funcionando)

- ✅ Segredos configurados via Z_AI_KEY
- ✅ Probe disponível
- ✅ Modelo glm-4.5-flash funcional

### Outros Provedores (Falhando)

- ❌ Falta de probes no catálogo
- ❌ Falta de configuração manual
- ❌ Sistema de autenticação não testado

## Próximos Passos

1. **Testar configuração manual de segredos**
2. **Verificar se probes podem ser adicionados dinamicamente**
3. **Testar fallback para openAI-compatible-adapter**
4. **Documentar procedimento de configuração manual**

## Conclusão

A arquitetura suporta configuração manual, mas o sistema atual depende fortemente do catálogo
pré-existente. A solução mais viável é:

1. Configurar segredos manualmente
2. Usar openAI-compatible-adapter como fallback
3. Ignorar sistema de probes para configurações manuais
4. Testar conectividade direta com APIs dos provedores
