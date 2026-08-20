# Auditoria e Propostas de Upgrade – tsserver / LSP 🛠️

> **Documento histórico, superado em 19 de agosto de 2026.** O estado canônico usa o LSP nativo
> do TypeScript 7 diretamente no editor. O wrapper MCP preservado foi migrado para
> `src/integration/lsp/tsgo-lsp-daemon.mjs` e permanece desligado por padrão.

Este documento revisa a implementação atual do daemon LSP
(`src/integration/lsp/tsserver-daemon.mjs`), avalia sua cobertura funcional e propõe melhorias ou
atualizações.

---

## Estado Atual

- Dependência `typescript` versão `^5.9.3` (última conhecida no `package.json`).
- O serviço exporta classe `TsserverDaemon` que cria um **LanguageService** baseado no `ts` pacote.
- Operações suportadas: `definition`, `references`, `hover`, `document_symbols`,
  `workspace_symbols`, `diagnostics`, `code_actions`, `apply_code_action`.
- O host respeita `tsconfig.json`/`jsconfig.json` e inclui todos os arquivos apontados.
- Responsável por controle de fila, timeouts, abort signals e garantia de escopo de workspace. Não
  roda em processo separado.

**_Observações_**:

1. Não há callbacks para **completion**, **signatureHelp**, **formatting**, **rename**,
   **semanticTokens**, **rename**, **diagnostics watch** etc – recursos comuns em LSP.
2. O `compilerOptions` padrão é um fallback; alguns projetos podem precisar de ajustes manuais.
3. O daemon recarrega apenas nos `execute` e não observa automaticamente alterações de arquivos; a
   versão atual usa snapshots mas não oferece `updateFile`.
4. A API interna do TypeScript evolui rapidamente; pacote travado em `5.9` pode virar defasado.

---

## Áreas de Melhoria / Upgrades Propostos

| Item                        | Descrição                                                                                                                    | Benefício                                                            | Prioridade        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------- |
| **Dependência TS**          | Atualizar para `^5.10` ou superior quando lançado.                                                                           | Correções de bugs, novas flags `strict` etc.                         | 🚩 alta           |
| **Métodos LSP**             | Implementar `completion`, `signatureHelp`, `rename`, `formatDocument`, `semanticTokens`, `implementation`.                   | Editor mais rico (VSCode, Neovim etc.) oferece experiência completa. | 🔧 média          |
| **Atualização incremental** | Expor `updateFile(path, content)` + `refresh` para permitir edições em tempo real.                                           | Permite uso em IDEs que modificam buffer sem salvar.                 | 🔧 média          |
| **Processo separado**       | Considerar rodar `tsserver` em child process via `typescript-language-server` para ganhos de compatibilidade/extensão.       | Menos manutenção própria e suporte à debug/telemetria existente.     | ⚙️ baixo/moderado |
| **Configuração flexível**   | Respeitar variáveis de ambiente (es: `LSP_LOG_LEVEL`), reinicializar automaticamente ao detectar mudança em `tsconfig.json`. | Melhora adaptabilidade em monorepos/CI.                              | 📌 média          |
| **Cache de versão**         | Manter `scriptVersions` e permitir `setFileVersion` ao editar.                                                               | Necessário para edições não salvadas.                                | 🔧 média          |
| **Documentação**            | Migrar partes do README para este documento e mencionar no checklist de migração de tipos.                                   | Ajuda novos contribuidores.                                          | ✅ baixa          |

---

## Auditoria Técnica

1. **Segurança/Scope** – `ensureWorkspacePath()` bloqueia caminhos fora da raiz; bom.
2. **Timeouts** – há timeout global, configurável; comportamento correto.
3. **Aborts** – combinador `AbortSignal.any` usado (Node18+); compatível com Node24.
4. **Manutenção** – muitos métodos longos (>200 linhas) poderiam ser refatorados.
5. **Testes** – nenhum teste específico ao LSP foi encontrado; recomendável adicionar cobertura
   mínima (e2e simulando editor).

---

## Avaliação de Alternativas

Antes de decidir pela migração para um servidor externo, vale comparar os dois caminhos disponíveis:

| Abordagem                                           | Vantagens                                                                                                                                                                               | Desvantagens                                                                                                                                                                          |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Daemon interno** (atual)                          | - Total controle sobre quais métodos expor<br>- Sem overhead de IPC/processos<br>- Código já implementado e integrado ao app                                                            | - Precisamos manter manualmente toda a lógica LSP<br>- Novas features do `tsserver` exigem alterações aqui<br>- Sem fácil suporte a buffers não salvos ou plugins                     |
| **Servidor externo (`typescript-language-server`)** | - Suporta imediatamente todo o protocolo LSP (completion, format, etc.)<br>- Atualizações acompanham release oficial do TS<br>- Aproveita vasta base de testes/integrações já existente | - Maior complexidade de lifecycle e comunicação (<i>n</i> processos)<br>- Diferença de comportamento de inicialização/timeout<br>- Menos flexibilidade para customizações específicas |

### Recomendação para o projeto

Dado o contexto atual (monorepo pequeno, uso interno da LSP para editores próprios e scripts), o
**daemon interno** permanece a melhor alternativa por enquanto. Ele atende às necessidades
existentes e evita a complexidade adicional de gerenciar um processo filho. Entretanto, manter os
pontos de entrada modulados e documentados permitirá uma migração suave caso as demandas cresçam —
por exemplo, se for necessário oferecer completions ou servir diversos clientes simultâneos.

A abordagem de processo separado deve ser vista como um plano de contingência de longo prazo,
ativado somente quando a manutenção do servidor embutido começar a pesar ou quando o número de
operações exigidas se expandir significativamente.

## Plano de Ação Sugerido

1. **Curto prazo**
   - Bump `typescript` para última patch/major sem quebrar (`npm i typescript@latest` + validação de
     build).
   - Adicionar novo bloco no checklist de migração indicando essa tarefa.
   - Introduzir testes unitários simples para as operações atuais.

2. **Médio prazo**
   - Expandir `TsserverDaemon` com mais operações LSP (especialmente `completion`).
   - Expor método para atualizar arquivo e incrementar `scriptVersion` (ver APIs do language
     service).
   - Publicar exemplo de uso no README/dokumentação.

3. **Longo prazo**
   - Avaliar substituição por `typescript-language-server` caso manutenção própria não compense.
     _Esta opção envolve lançar um processo externo_ e comunicar via stdio/JSON-RPC; a vantagem é
     suportar imediatamente todas as operações definidas pelo protocolo LSP (completion,
     signatureHelp, formatting, rename, semanticTokens, etc.) e aproveitar ferramentas já em uso
     (ex.: `vscode-langservers-extracted`). O código do daemon atual poderia ser mantido como
     fallback ou usado para features customizadas não cobertas pela versão externa. Exemplo de uso
     básico:
     ```js
     import { spawn } from 'child_process';
     const proc = spawn('npx', ['typescript-language-server', '--stdio']);
     proc.stdout.on('data', d => /* encaminhar para cliente */);
     proc.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{ /*...*/ }})+"\n");
     ```
     A integração exige gerenciamento de lifecycle, mapping de URIs e tradução de eventos.
   - Monitorar changelog do TS para adaptar host (ex: suporte a `plugin` e `projectReferences`).

---

> 📌 **Nota**: mesmo com `strict: false` no tsconfig, a LSP auxilia nos edições e é valioso para a
> equipe; a proposta não depende da flag de compilação.

Este arquivo deve ser atualizado periodicamente quando novas funcionalidades LSP forem implementadas
ou quando ocorrer upgrade de versão. Mantê‑lo no controle de versão ajuda a justificar futuros
investimen‑tos na ferramenta.

---

_Documento gerado automaticamente pela auditoria do assistente Copilot em 27 fev 2026._
