# Architecture Map

- `scripts/audit/*`: pipeline determinístico e coletores
- `src/audit_agent/*`: orquestração LLM e contexto
- `src/inference_gateway/*`: políticas, budget e fallback
- `src/server/*`: control plane e APIs
