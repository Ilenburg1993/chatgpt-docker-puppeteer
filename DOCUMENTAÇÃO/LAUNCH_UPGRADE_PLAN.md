# Plano de Recriação do `launch.json`

Este documento descreve o plano completo para substituir o atual `\.vscode/launch.json` por uma
versão moderna, mais enxuta e fácil de manter. O arquivo existente contém dezenas de configurações
herdadas e comentários redundantes; nossa meta é reconstruí-lo do zero seguindo as práticas
recomendadas pela documentação oficial do Visual Studio Code.

---

## 1. Objetivos

1. **Compatibilidade** com o novo depurador `pwa-node`/`pwa-chrome` (JavaScript Debugger).
2. **Redução de duplicação**: extrair variáveis de ambiente comuns, `runtimeArgs`, etc.
3. **Configurações reutilizáveis** através de `compounds` e `envFile`.
4. **Clareza**: incluir apenas os targets que realmente são usados pela equipe hoje.
5. **Base para expansão futura**: permitir a adição de novos perfis (ex.: testes específicos,
   subsistemas) sem inflar o arquivo.

## 2. Escopo

- Eliminaremos perfis legados, como "Debug Agente (Production Mode)" e variantes de subsistemas,
  mantendo apenas a estrutura base necessária à depuração diária.
- Manteremos attaches úteis (PM2, Docker) mas transformaremos em configurações simples e genéricas.
- Perfis de testes específicos (P1‑P5, browser, integração) serão representados por um launch
  genérico "Test current file" e compounds demonstrativos.
- A configuração para Vite e Chrome em `src/dashboard-ui` será mantida, mas simplificada.

## 3. Etapas do upgrade

1. **Levantamento de usos atuais**: revisar o histórico de branches/computes para identificar quais
   perfis são realmente invocados.
2. **Criar nova base** com o `pwa-node` e variáveis compartilhadas (`.env` ou `envFile`).
3. **Migrar configurações essenciais** (agente, dashboard, testes, attaches PM2/Docker).
4. **Adicionar compounds** para cenários transversais (Full system, subsistemas, integração).
5. **Validação**: abrir o novo launch e executar alguns compounds; verificar se a depuração
   funciona, incluindo envs e `autoAttachChildProcesses`.
6. **Documentação e comunicação**: atualizar `README.md` ou `DOCUMENTAÇÃO/QUICK_START.md` com
   instruções sobre o novo arquivo; notificar a equipe.

## 4. Implementação técnica

- Utilizar `type: "pwa-node"` em vez de `node`; onde necessário usar `pwa-chrome` para o perfil do
  navegador.
- Definir `envFile` apontando para ` ${workspaceFolder}/.env` (arquivo opcional que pode conter
  segredos, variáveis locais).
- Colocar `runtimeArgs` e `skipFiles` comuns em uma configuração base que será copiada, ou usar
  `"compounds"` para evitar repetição.
- Os perfis de attaches devem especificar `localRoot` e `remoteRoot` de maneira genérica, sem
  comentários escritos.

## 5. Cronograma sugerido

| Fase                 | Responsável  | Duração estimada |
| -------------------- | ------------ | ---------------- |
| Levantamento de uso  | Dev lead     | 1 dia            |
| Escrita do novo JSON | Qualquer dev | 1/2 dia          |
| Testes e ajustes     | QA/dev       | 1 dia            |
| Revisão de PR        | Todos        | 1 dia            |
| Documentação final   | Tech writer  | 2 horas          |

## 6. Critérios de aceitação

- `launch.json` não contém duplicação evidente e usa `pwa-node`/`pwa-chrome`.
- Compounds básicos funcionam (o agente inicia com `npm start` em modo debug, dashboard conecta
  etc.).
- Perfis de teste permitem depurar um arquivo isolado sem alterar manualmente variáveis.
- Attach a PM2 e Docker funcionam conforme descrito e não incluem warnings.

## 7. Riscos e mitigação

- _Risco_: desenvolvedores não atualizarão seus VS Code e perderão suporte ao `pwa-node`.
  _Mitigação_: adicionar nota no README: "Requer VS Code >= 1.80".
- _Risco_: alguma configuração específica herdada não seja migrada. _Mitigação_: manter o arquivo
  antigo como `launch.legacy.json` por algumas semanas.

## 8. Pós-migração

1. Remover o antigo `launch.json` após um período de coexistência.
2. Verificar se o novo arquivo está no `.gitignore` se necessário (parece que já está sob controle).
3. Integrar verificação de formatação/validade via um script `npm run validate-launch` usando `jq`
   ou VS Code CLI, se desejado.

---

### Referências

- [Debugging in Visual Studio Code](https://code.visualstudio.com/docs/editor/debugging)
- [Node.js debugging](https://code.visualstudio.com/docs/nodejs/nodejs-debugging)
- [Launch configurations](https://code.visualstudio.com/docs/editor/debugging#_launchjson-attributes)
- [Compound configurations](https://code.visualstudio.com/docs/editor/debugging#_compound-launch-configurations)

---

Com este plano em mãos, o próximo passo é aplicar o patch e validar em um ambiente real. Posso
proceder com a implementação sempre que você autorizar.
