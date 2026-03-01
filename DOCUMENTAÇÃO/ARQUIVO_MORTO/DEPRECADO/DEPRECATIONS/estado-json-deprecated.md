# Depreciação: `estado.json`

**Status**: DEPRECATED

Resumo rápido

- O arquivo local `estado.json` era usado como mecanismo simples de descoberta/estado.
- A partir desta versão, a descoberta deve usar o evento canônico do NERV: `SERVER_READY`.
- O fallback baseado em arquivo permanece disponível apenas como opção LEGADO (opt‑in).

Por que está sendo deprecado

- Arquivos de estado introduzem acoplamento implícito, falsos-positivos de sincronização e tornam a
  orquestração difícil em ambientes distribuídos.
- O sistema agora usa NERV (IPC canônico) que fornece correlação, entrega confiável e
  observabilidade.

Como migrar

1. Para publicar que um serviço está pronto, use `src/nerv/discovery.js` ou o adaptador NERV de alto
   nível
   - Exemplo: `publishServerReady(nerv, { port, authority })` (veja `src/nerv/discovery.js`).
2. Para escutar readiness, use `waitForServerReady(nerv, { timeoutMs })` ou
   `listenForServerReady(nerv, handler)`.

Fallback legado (apenas para workflows locais/dev)

- Se você precisar temporariamente do comportamento antigo, exporte a variável de ambiente
  `ENABLE_STATE_FILE=true` no ambiente de execução.
- Observação: isto ativa somente o comportamento de fallback — recomendamos remover dependências
  desse arquivo o mais rápido possível.

Documentação e auditoria

- Todos os documentos e scripts devem ser atualizados para apontar para NERV `SERVER_READY`.
- Este repositório inclui uma checagem automática (`npm run check:forbidden`) que detecta usos de
  `estado.json` e outras práticas proibidas.

Próximos passos sugeridos

- Atualizar scripts que lêem/escrevem `estado.json` para usar as funções em `src/nerv/discovery.js`.
- Remover `estado.json` da configuração de produção (por exemplo `ecosystem.config.js`) quando todos
  os consumidores estiverem migrados.

Referências

- `src/nerv/discovery.js` — implementa publicação/remoção/espera para `SERVER_READY`.
- `scripts/check_forbidden_patterns.js` — detector automático de padrões proibidos.
