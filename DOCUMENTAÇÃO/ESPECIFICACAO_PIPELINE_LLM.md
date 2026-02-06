# Especificação: Pipeline LLM (interpretação + validação local/global + reparo)

Este documento define **contratos e decisões práticas** para implementar o pipeline “Global
responde; Local interpreta/valida”, mantendo Puppeteer/browser como atuador soberano.

## 1) Vocabulário

- **LLM local**: rodando via Ollama (OpenAI-compatible) ou outro runtime local.
- **LLM global**: cloud provider (Claude/Anthropic, OpenAI, etc.).
- **Interpretação**: converter texto bruto em estrutura operável (JSON + campos normalizados).
- **Validação determinística**: checks sem LLM (Zod, invariantes, regex, limites, consistência).
- **Judge**: LLM avaliando qualidade/aderência e gerando critique estruturada.
- **Reparo**: novo pedido à LLM global para corrigir output com base em falhas/critique.

## 2) Contratos (JSON) — versão mínima

### 2.1 `LLMRequest` (entrada)

```json
{
  "traceId": "task-123",
  "purpose": "interpret",
  "dataClass": "L1",
  "allowCloud": false,
  "providerHint": "ollama",
  "modelHint": "qwen3-coder",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "jsonSchema": { "type": "object" },
  "timeoutMs": 15000,
  "temperature": 0.2,
  "maxTokens": 800
}
```

### 2.2 `InterpretedResponse` (saída da interpretação)

```json
{
  "schemaVersion": "response-v2",
  "confidence": 0.74,
  "content": {
    "text": "Resposta humana final...",
    "sections": [{ "title": "Resumo", "text": "..." }]
  },
  "actions": [{ "type": "NOTE", "message": "Sugestão de próximo passo" }],
  "evidence": {
    "source": "ui-driver",
    "artifacts": [{ "kind": "selector", "value": "..." }]
  }
}
```

### 2.3 `ValidationReport` (saída agregada)

```json
{
  "deterministic": {
    "passed": true,
    "failures": []
  },
  "localJudge": {
    "score": 82,
    "verdict": "PASS",
    "confidence": 0.83,
    "reasons": ["Completo e relevante"],
    "critique": null
  },
  "globalJudge": null,
  "arbitration": {
    "decision": "ACCEPT",
    "overallScore": 82,
    "reasons": ["Determinístico ok", "LocalJudge >= T_accept"],
    "nextAction": null
  },
  "repairPrompt": null
}
```

## 3) Pipeline canônico (passo a passo)

### 3.1 Entrada (UI driver)

O driver UI produz um payload base:

- `promptOriginal` (o que foi pedido)
- `rawText` (texto bruto extraído)
- `uiArtifacts` (selectors usados, snapshot parcial, timings, URL, etc.)

### 3.2 Interpretação (local-first)

Objetivo: transformar `rawText` em `InterpretedResponse`.

Regras:

- **Sempre** impor um schema de saída (Zod/JSON schema).
- **Sempre** retornar `confidence` e `evidence` (o que foi usado).
- Se detectar ambiguidade/contradição, refletir em `confidence` e anotar em `actions`.

Quando usar global para interpretar:

- só se `allowCloud=true` e a local falhar ou ficar muito incerta (`confidence < T_interpret`).

### 3.3 Checks determinísticos

Divida invariantes em:

- **Hard fail** (quebra imediata → `RETRY`):
  - JSON inválido / schema inválido
  - campos obrigatórios ausentes
  - violação de limites (tamanho, tipos, enum)
- **Soft fail** (reduz score / pode virar `MANUAL_REVIEW`):
  - linguagem pouco clara
  - seções esperadas faltando
  - baixa rastreabilidade (pouca evidência)

### 3.4 Judge local (Ollama)

O judge local deve:

- avaliar com rubrica (completeness/relevance/quality)
- produzir JSON curto
- gerar **critique acionável** quando falhar

### 3.5 Judge global (opcional)

Ativar apenas quando:

- local `confidence` baixa
- tarefas críticas (política)
- divergência com checks determinísticos

### 3.6 Arbitragem

Decisão mínima (recomendação):

- Se hard fail determinístico → `RETRY`.
- Senão se `localJudge.score >= T_accept` → `ACCEPT`.
- Senão se `allowCloud` e `globalJudge` disponível:
  - combinar scores com pesos (ex.: local 0.7, global 0.3)
  - se ainda baixo → `RETRY` com `repairPrompt`
- Senão → `MANUAL_REVIEW`.

## 4) Reparo (repair prompt) — como construir

O “repair prompt” é a ponte onde a **local ajuda a global**:

Conteúdo recomendado:

- falhas determinísticas (lista objetiva)
- critique do local judge (curta)
- instruções para retornar no schema
- exemplos mínimos

Exemplo (esqueleto):

```text
Você retornou uma resposta que falhou nos checks abaixo:
1) Campo "sections" ausente.
2) "confidence" deve ser número entre 0 e 1.

Crítica do validador local:
- A resposta está relevante, mas falta um resumo e próximos passos.

Reescreva retornando APENAS JSON no schema:
{ ...schema... }
```

## 5) Política de roteamento (dataClass + allowCloud)

Matriz mínima:

- **L0**: cloud permitido; priorize qualidade/latência.
- **L1**: local primeiro; cloud só com redaction e `allowCloud=true`.
- **L2**: local apenas; se falhar, parar (manual).

Implementação prática:

- `dataClass` vem do `TaskSchema` (futuro) ou inferido por tipo de missão.
- `allowCloud` é “opt-in” por tarefa.

## 6) Artefatos e aprendizado (o que persistir)

Persistir (mínimo):

- `traceId`, `taskId`, domínio, versão do driver, tempos
- `ValidationReport` (sem conteúdo sensível)
- hashes/previews do `rawText` (dependendo de L1/L2)

Não persistir (L2):

- conteúdo integral de prompts/respostas
- cookies/sessões/tokens

## 7) Ponto de encaixe no repo (mapa proposto)

- Interpretação/Judge por API: novo módulo (ex.: `src/llm/*`) com providers.
- `src/validation/llm_judge.js`: passa a usar provider API em vez de driver UI.
- `src/driver/targets/*Driver.js`: continuam sendo atuadores; apenas emitem artefatos e chamam a
  pipeline quando habilitado via config.

## 8) Critérios de pronto (MVP sugerido)

- Local interpreta `rawText` → JSON válido em schema.
- Determinístico falha/recupera corretamente.
- Judge local gera critique e scores estáveis.
- Repair prompt melhora taxa de `ACCEPT` sem aumentar loops infinitos.
