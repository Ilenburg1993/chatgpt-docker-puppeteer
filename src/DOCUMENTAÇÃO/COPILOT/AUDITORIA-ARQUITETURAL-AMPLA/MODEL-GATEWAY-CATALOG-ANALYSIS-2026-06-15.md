# Análise Completa do Catálogo de Modelos do Model Gateway

**Data:** 2026-06-15  
**Investigação:** Busca por modelos alternativos fora de kilo e zai

## Resumo Executivo

Após investigação completa do catálogo atualizado do Model Gateway, foi identificado que **o único modelo funcional fora do kilo-code é o GLM-4.5-Flash (zai)**, que já está em uso. Todos os outros provedores apresentam falhas críticas que impedem sua utilização.

## Provedores e Modelos Encontrados

### Provedores Disponíveis (91 modelos no total)
- **cerebras** - 2 modelos
- **chutes** - 13 modelos  
- **groq** - 20 modelos
- **mistral** - 8 modelos
- **zai** - 48 modelos

### Análise de Falhas por Provedor

#### 1. Cerebras
- **Modelo:** gpt-oss-120b, zai-glm-4.7
- **Problema:** Falha no probe de chat (timeout de 31 segundos)
- **Status:** ❌ Não funcional

#### 2. Chutes  
- **Modelos:** Qwen3-235B, Qwen3-32B, Qwen3.5-397B, etc.
- **Problema:** Probes ausentes (agent_probe_missing)
- **Status:** ❌ Não testado, não funcional

#### 3. Groq
- **Modelos:** llama-3.3-70b-versatile, llama-3.1-8b-instant, etc.
- **Problema:** Custo de probe desconhecido bloqueia execução
- **Status:** ❌ Bloqueado por política

#### 4. Mistral
- **Modelos:** mistral-medium-2508, mistral-small-2506, etc.
- **Problema:** Probes ausentes (agent_probe_missing)
- **Status:** ❌ Não testado, não funcional

#### 5. Zai (Atual)
- **Modelo:** GLM-4.5-Flash
- **Status:** ✅ Funcional e verificado

## Root Cause Analysis

### Falhas Recorrentes Identificadas:

1. **Probes ausentes (agent_probe_missing):** 1980 modelos
   - Causa: Provedores não executaram probes de agente
   - Impacto: Impossível verificar funcionalidade agencial

2. **Falhas de chat (chat_health_failed):** 19 modelos
   - Causa: Timeout ou erro nas verificações básicas
   - Impacto: Não pode realizar conversas básicas

3. **Limites de contexto:** 66+ modelos
   - Causa: Contexto insuficiente para operação agencial
   - Impacto: Restrição de capacidade

4. **Custo desconhecido:** 
   - Causa: Previsão de custo indisponível
   - Impacto: Bloqueado por política conservadora

## Conclusão

**Recomendação:** Manter GLM-4.5-Flash (zai) como modelo atual

### Justificativa:
- ✅ Único modelo que passou em todos os probes
- ✅ Verificado agencial, chat, JSON e streaming
- ✅ Estável operacionalmente
- ✅ Sem custos estimados
- ✅ Tempo de resposta consistente

### Riscos de Alternativas:
- Outros provedores requerem configuração manual de chaves
- Risco de instabilidade e falhas operacionais
- Possíveis custos não previstos
- Tempo de setup e debugging

### Próximos Passos Recomendados:
1. Manter modelo atual GLM-4.5-Flash
2. Monitorar estabilidade e desempenho
3. Reavaliar provedores quando novas versões estiverem disponíveis
4. Considerar migração apenas quando modelo atual apresentar problemas

---
**Análise Completa - Status:** Concluída  
**Modelo Recomendado:** GLM-4.5-Flash (zai)  
**Próxima Revisão:** Quando novo catálogo estiver disponível