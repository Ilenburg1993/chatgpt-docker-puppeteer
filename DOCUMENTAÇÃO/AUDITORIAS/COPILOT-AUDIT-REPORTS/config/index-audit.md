# index.js — Auditoria

**Módulo**: `src/copilot/config/` **Arquivo**: `index.js` **LOC**: 45 | **Score**: 10.0/10

## Responsabilidade

Barrel de re-exportação centralizado para todo o módulo `config/`. Expõe:

- `session-config.js`: `buildAlwaysAliveConfig`, `buildDiagnosticConfig`, `buildFullAccessConfig`,
  `buildReadOnlyConfig`
- `mcp-servers.js`: `MCP_SERVERS`, `buildMcpConfig`, `listAvailableMcpServers`
- `system-prompt.js`: 10 constantes e builders de system message
- `custom-agents.js`: `buildCustomAgentsConfig`, `getCustomAgent`, `listAvailableSdkAgents`,
  `listCustomAgents`, `registerCustomAgent`, `removeCustomAgent`
- `pinned-files-loader.js`: `PinnedFilesLoader`
- `tools/index.js`: reexporta registry e state

## Achados

Nenhum.

## Destaques Positivos

- Cobertura completa da API pública: tudo acessível via import único
- `export * from './tools/index.js'` — subdirectório integrado via barrel filho

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
