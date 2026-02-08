# CHECKLIST 03: Cobertura Total de `@ts-check` no Backend

Objetivo
- Garantir que TODO o backend/core esteja sob verificacao consistente.
- Eliminar `@ts-nocheck` (exceto casos muito justificados e temporarios).

Checklist
- [ ] Adicionar `// @ts-check` nos arquivos que faltam no backend.
- [ ] Eliminar `// @ts-nocheck` em `src/main.js`.
- [ ] Se `src/main.js` for grande/dinamico demais:
  - [ ] Quebrar em modulos menores.
  - [ ] Manter o arquivo principal como “wiring” minimo.
- [ ] Rodar `npm run typecheck` e corrigir os erros.

Lista de arquivos (backend) que tipicamente faltam `@ts-check` hoje
- [ ] `src/core/forensics.js`
- [ ] `src/core/validators/prerequisite_validator.js`
- [ ] `src/driver/extractors/structured_extractor.js`
- [ ] `src/driver/guards/DriverReadinessGuard.js`
- [ ] `src/driver/modules/biomechanics_engine.js`
- [ ] `src/driver/modules/frame_navigator.js`
- [ ] `src/driver/modules/recovery_system.js`
- [ ] `src/driver/modules/submission_controller.js`
- [ ] `src/driver/modules/triage.js`
- [ ] `src/driver/nerv_adapter/driver_nerv_adapter.js`
- [ ] `src/driver/targets/ChatGPTDriver.js`
- [ ] `src/infra/browser_pool/PageLifecycleMonitor.js`
- [ ] `src/infra/browser_pool/PageValidator.js`
- [ ] `src/infra/browser_pool/pool_manager.js`
- [ ] `src/server/handlers/mcp-handler.js`
- [ ] `src/shared/biomechanics/human.js`
- [ ] `src/shared/page_stability/stabilizer.js`
- [ ] `src/shared/sadi/analyzer.js`

Definição de Pronto (DoD)
- Zero ocorrencias de `@ts-nocheck` no backend.
- Todos os arquivos de `src/` (exceto `src/dashboard-ui`) estao sob `@ts-check` ou sao cobertos pelo gate (`checkJs: true` no tsconfig.typecheck).
- `npm run typecheck` verde.

Riscos comuns
- `@ts-check` revela dependencias implicitas e APIs dinamicas. Solucao preferida: tipar fronteiras com `unknown` e validar.

---
Arquivo gerado automaticamente por solicitação. Não farei commit/push sem sua autorização.
