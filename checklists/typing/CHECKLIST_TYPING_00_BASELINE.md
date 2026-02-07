# CHECKLIST 00: Baseline (Antes de Apertar o Rigor)

Objetivo
- Congelar um baseline observavel do estado atual do projeto, para que cada fase tenha um “antes/depois” claro.

Checklist
- [ ] Confirmar que o projeto roda sem mudar comportamento.
- [ ] Confirmar que os diagnósticos TypeScript atuais (setup seletivo) estao verdes.
- [ ] Registrar contagens: arquivos com `@ts-check`, `@ts-nocheck`, e casts `any`.
- [ ] Identificar as “fronteiras” do sistema (HTTP, Socket.io, FS, Puppeteer, PM2, RAG) onde `unknown` e JSON entram.

Comandos (referencia)
```bash
npm test
node diagnostic-full.mjs
npm run lint:quiet
```

O que registrar (copiar para um bloco no seu report interno)
- [ ] Data e branch/commit atual.
- [ ] `node diagnostic-full.mjs` total de erros.
- [ ] Lista de arquivos com `// @ts-nocheck`.
- [ ] Lista de arquivos sem `// @ts-check` no backend.

Definição de Pronto (DoD)
- `npm test` passa.
- `node diagnostic-full.mjs` retorna `Total: 0`.
- Existe um “snapshot” do baseline (pode ser um arquivo md, ou uma anotacao em ticket).

Riscos comuns
- Se o baseline nao estiver verde, tipagem 100% vira caça a fantasma. Corrigir runtime primeiro.

---
Arquivo gerado automaticamente por solicitação. Não farei commit/push sem sua autorização.
