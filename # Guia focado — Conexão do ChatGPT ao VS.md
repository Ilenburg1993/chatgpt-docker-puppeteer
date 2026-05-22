# Guia focado — Conexão do ChatGPT ao VS Code em WSL2 Docker Dev Container via MCP

**Versão:** 2.0 — guia focado de conexão
**Ambiente-alvo:** Windows + WSL2 + Docker Desktop + VS Code Dev Containers + Node 24 + GitHub Copilot SDK 0.3.0
**Objetivo:** permitir que o ChatGPT em `https://chatgpt.com/`, e também outras LLMs compatíveis, conectem-se ao repositório real aberto no VS Code dentro de um Dev Container, por meio de um MCP server local controlado, rápido, auditável e com ampla capacidade operacional.
https://developers.openai.com/apps-sdk/quickstart

---

## Índice

1. Propósito do documento
2. A ideia central em uma página
3. Vocabulário mínimo
4. O que significa “conectar o ChatGPT ao VS Code”
5. Topologia recomendada
6. Papel do WSL2
7. Papel do Docker Dev Container
8. Papel do Node 24
9. Papel do MCP server
10. Transportes: stdio, Streamable HTTP e SSE
11. Por que o ChatGPT precisa de `/mcp` via HTTPS ou túnel
12. Secure MCP Tunnel
13. O formulário do ChatGPT mostrado na imagem
14. Autenticação e confiança
15. Como o MCP server deve enxergar o repositório
16. Tools essenciais do MCP server
17. Tools intermediárias
18. Tools avançadas
19. VS Code usando o mesmo MCP server
20. GitHub Copilot SDK 0.3.0 no desenho
21. Copilot CLI headless + `cliUrl`
22. Como outras LLMs entram no sistema
23. Memória operacional compartilhada
24. Segurança sem amputar liberdade
25. Fluxo de implementação recomendado
26. Smoke tests
27. Diagnóstico de falhas comuns
28. Decisões canônicas
29. Fontes oficiais
30. Conclusão

---

## 1. Propósito do documento

Este documento concentra-se em uma única pergunta prática:

> Como fazer o ChatGPT, pela interface `chatgpt.com`, conectar-se ao nosso repositório real aberto no VS Code, dentro de WSL2 + Docker Dev Container, e operar esse projeto por meio de um MCP server escrito para Node 24?

O foco aqui não é explicar toda a plataforma de agentes, nem fornecer código completo. O foco é a conexão: o caminho físico, lógico e protocolar entre a conversa no ChatGPT e o ambiente real de desenvolvimento.

O documento também considera o GitHub Copilot SDK 0.3.0, não como substituto do MCP, mas como uma camada local adicional para orquestração, execução assistida e possível delegação a um agente Copilot rodando dentro do mesmo ambiente do projeto.

---

## 2. A ideia central em uma página

O ChatGPT não acessa diretamente o seu VS Code, seu terminal, seu `localhost` do Windows ou seu filesystem. O ChatGPT acessa **um servidor MCP**.

Esse MCP server, por sua vez, roda no mesmo ambiente onde o projeto realmente vive: o Dev Container do VS Code, dentro do WSL2/Docker.

A topologia ideal é:

```text
ChatGPT em chatgpt.com
  ↓ conector MCP
Endpoint HTTPS /mcp ou Secure MCP Tunnel
  ↓
MCP server Node 24 dentro do Dev Container
  ↓
Project Control Plane
  ↓
/workspaces/<repo> — o repositório real do VS Code
```

Para uso local, o VS Code e outros clientes dentro do container podem usar `stdio`. Para o ChatGPT remoto, o transporte correto é Streamable HTTP em `/mcp`, exposto por HTTPS ou por Secure MCP Tunnel.

A documentação oficial do ChatGPT Apps SDK indica que o conector deve receber a URL pública do endpoint `/mcp` do servidor. Para desenvolvimento local, essa URL precisa ser alcançável por HTTPS, normalmente via túnel.
Fonte oficial: https://developers.openai.com/apps-sdk/deploy/connect-chatgpt

---

## 3. Vocabulário mínimo

### ChatGPT

A interface em `https://chatgpt.com/`. Neste documento, “ChatGPT” significa esta superfície remota da OpenAI, capaz de chamar tools por meio de um app/conector MCP.

### VS Code

O editor usado pelo humano. Ele está conectado ao ambiente WSL2 e reabre o projeto dentro de um Dev Container.

### WSL2

O ambiente Linux real dentro do Windows. Deve conter o clone do projeto para evitar a lentidão do filesystem `C:\` quando usado por Docker e ferramentas Linux.

### Docker Dev Container

O container de desenvolvimento aberto pelo VS Code. É o ambiente onde o Node 24, Git, dependências, scripts e o MCP server rodam.

### MCP

Model Context Protocol. É o protocolo que permite que aplicações de IA descubram e chamem tools, leiam resources e usem prompts expostos por um servidor externo.

### MCP server

O processo que publicará as capacidades do projeto. Ele deve ser escrito de modo a acessar o repo real e executar operações controladas.

### Tool

Uma função publicada pelo MCP server. Exemplos: ler arquivo, buscar no repo, retornar `git diff`, rodar teste, aplicar patch, criar branch.

### Transport

O meio pelo qual o cliente MCP e o servidor MCP trocam mensagens. Neste projeto, os transportes relevantes são `stdio` e Streamable HTTP. SSE fica apenas como fallback legado.

### Project Control Plane

A camada local que organiza operações sobre o projeto: filesystem, Git, jobs, logs, auditoria, locks, permissões, memória operacional e integração com Copilot.

---

## 4. O que significa “conectar o ChatGPT ao VS Code”

A expressão pode ser enganosa. O ChatGPT não “entra” no VS Code. O que fazemos é:

1. Rodar um MCP server dentro do mesmo Dev Container do VS Code.
2. Dar a esse servidor acesso ao repositório real.
3. Expor o servidor ao ChatGPT por um endpoint `/mcp` seguro.
4. Cadastrar esse endpoint no formulário de “Novo app” ou “Conector” do ChatGPT.
5. Permitir que o ChatGPT chame as tools do MCP server durante a conversa.

Portanto, a conexão real é:

```text
ChatGPT → MCP endpoint → MCP server → repo no Dev Container
```

O VS Code aparece porque é o ambiente humano de edição e porque o Dev Container aberto no VS Code é o lugar onde tudo deve rodar.

---

## 5. Topologia recomendada

### Topologia lógica

```text
Humano
  ↓
ChatGPT em chatgpt.com
  ↓
Custom App / Connector MCP
  ↓
Secure MCP Tunnel ou HTTPS público
  ↓
MCP server Node 24
  ↓
Project Control Plane
  ↓
Repo real + Git + scripts + logs
```

### Topologia física

```text
Windows
  ↓
WSL2
  ↓
Docker Desktop com backend WSL2
  ↓
VS Code Dev Container
  ↓
Node 24 + MCP server + Copilot SDK + repo
```

### Regra fundamental

O MCP server deve rodar onde o repo é real. Se o projeto está em `/workspaces/meu-repo` dentro do Dev Container, o MCP server deve rodar nesse mesmo container ou em um container com o mesmo mount, os mesmos caminhos e o mesmo contexto Git.

---

## 6. Papel do WSL2

O WSL2 é a base Linux dentro do Windows. Para projetos com Docker e Dev Containers, o local do filesystem importa muito.

A Microsoft recomenda que projetos usados com Dev Containers no Windows fiquem no filesystem do WSL2, por exemplo:

```text
/home/<usuario>/projects/<repo>
```

Evite manter o projeto em:

```text
C:\Users\<usuario>\projects\<repo>
```

Motivo: quando o Docker acessa arquivos no filesystem Windows a partir de um container Linux, há uma ponte cross-OS mais lenta. Com o repo no filesystem WSL2, o I/O fica mais próximo de Linux nativo.

Fonte oficial: https://learn.microsoft.com/en-us/windows/dev-environment/docker/dev-containers

---

## 7. Papel do Docker Dev Container

O Dev Container torna o ambiente reprodutível. Em vez de depender do Node, Git, scripts e ferramentas instaladas no Windows, o projeto define seu ambiente em container.

O Dev Container deve conter:

- Node 24.
- Git.
- Ferramentas de build/test/lint do projeto.
- Dependências necessárias ao MCP server.
- Dependências necessárias ao GitHub Copilot SDK 0.3.0, quando aplicável.
- Acesso ao repo em `/workspaces/<repo>`.
- Local persistente para `.ai/`, logs, histórico de jobs e estado operacional.

O VS Code permite configurar MCP servers dentro de Dev Containers por meio da seção `customizations.vscode.mcp` no `devcontainer.json`.

Fonte oficial: https://code.visualstudio.com/docs/copilot/customization/mcp-servers

---

## 8. Papel do Node 24

Node 24 é o runtime principal do nosso MCP server e do Project Control Plane.

Ele é apropriado porque permite:

- Servidor HTTP para Streamable HTTP `/mcp`.
- CLI local para ferramentas auxiliares.
- Integração com Git, shells e processos do projeto.
- Uso de ESM moderno.
- Controle de subprocessos e jobs.
- Integração com o GitHub Copilot SDK 0.3.0.

A recomendação arquitetural é usar Node 24 com ESM puro, separando:

```text
core do projeto
  tools determinísticas
  git/filesystem/jobs
  auditoria/memória

adaptadores MCP
  stdio local
  Streamable HTTP /mcp remoto

integrações
  Copilot SDK
  terminal broker
  repo-ai CLI
```

O Node Permission Model pode ser usado como mitigação operacional, mas não deve ser tratado como sandbox absoluto. Para liberdade ampla com segurança, a camada mais importante é o próprio desenho do MCP server: paths restritos ao workspace, logs, grants, locks e auditoria.

Fonte oficial: https://nodejs.org/docs/latest-v24.x/api/permissions.html

---

## 9. Papel do MCP server

O MCP server é a peça que transforma o repositório em uma superfície controlável por LLMs.

Ele deve:

- Declarar tools de forma clara.
- Validar argumentos.
- Executar operações no repo real.
- Retornar resultados estruturados.
- Controlar permissões.
- Registrar auditoria.
- Impedir fuga acidental para fora do workspace.
- Ser rápido para leituras comuns.
- Ser previsível para escrita e execução.

A documentação da OpenAI descreve que o MCP server define tools, aplica autenticação e retorna dados; o modelo decide quando chamar as tools com base na descrição e metadados.
Fonte oficial: https://developers.openai.com/apps-sdk/build/mcp-server

---

## 10. Transportes: stdio, Streamable HTTP e SSE

### `stdio`

`stdio` é o transporte local. O cliente inicia o processo do MCP server e fala com ele por stdin/stdout.

Use para:

- VS Code local.
- Copilot SDK local.
- Testes dentro do Dev Container.
- Ferramentas que rodam no mesmo namespace do projeto.

Não use como conexão direta do ChatGPT remoto, porque o ChatGPT não consegue iniciar um processo dentro do seu WSL2/Dev Container.

### Streamable HTTP

Streamable HTTP é o transporte remoto moderno do MCP. O servidor expõe um endpoint único, normalmente:

```text
/mcp
```

A especificação MCP define que esse transporte usa HTTP `POST` e `GET`, e pode usar SSE internamente para streaming. O servidor deve oferecer um único endpoint MCP que suporte esses métodos.

Use para:

- ChatGPT em `chatgpt.com`.
- Secure MCP Tunnel.
- API Playground.
- Outras LLMs remotas.
- Clientes que precisam de conexão de rede.

Fonte oficial: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports

### SSE legado

SSE legado é o transporte antigo HTTP+SSE. Ele costuma envolver endpoints separados, como `/sse` e `/messages`.

Use apenas se um cliente antigo exigir. Não deve ser a fundação nova do projeto.

### Regra simples

```text
Dentro do Dev Container: stdio.
Fora do Dev Container, incluindo ChatGPT: Streamable HTTP /mcp.
SSE legado: apenas fallback.
```

---

## 11. Por que o ChatGPT precisa de `/mcp` via HTTPS ou túnel

O ChatGPT em `chatgpt.com` roda fora da sua máquina. Ele não conhece o `localhost` do seu Windows, nem o `localhost` do WSL2, nem o `localhost` do container.

Por isso, quando você preenche o formulário de conector no ChatGPT, o campo “URL do servidor MCP” precisa apontar para uma URL que o ChatGPT consiga alcançar.

A documentação oficial de conexão do ChatGPT diz para fornecer a URL pública do endpoint `/mcp`, como no padrão:

```text
https://<host-publico-ou-tunel>/mcp
```

Fonte oficial: https://developers.openai.com/apps-sdk/deploy/connect-chatgpt

No nosso caso, como o MCP server é privado e local, a opção mais alinhada é usar Secure MCP Tunnel.

---

## 12. Secure MCP Tunnel

O Secure MCP Tunnel permite conectar servidores MCP privados a produtos OpenAI sem expor o servidor diretamente à internet.

A lógica é:

```text
ChatGPT
  ↓
endpoint OpenAI do túnel
  ↓
tunnel-client rodando no nosso ambiente
  ↓
MCP server local em 127.0.0.1:<porta>/mcp
```

O `tunnel-client` deve rodar dentro da rede que já alcança o MCP server. Em nosso caso, isso significa:

- preferencialmente dentro do Dev Container; ou
- em um container companheiro na mesma rede Docker; ou
- no WSL2 host, se ele conseguir alcançar o endpoint interno do MCP server.

O MCP server não precisa ter listener público. Ele pode escutar apenas em localhost, e o túnel faz a ponte outbound para a OpenAI.

Fonte oficial: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels

---

## 13. O formulário do ChatGPT mostrado na imagem

A imagem mostra a criação de um “Novo app” ou conector MCP em `chatgpt.com`.

### Ícone

Opcional. Não afeta a conexão.

### Nome

Use um nome humano e específico. Exemplo:

```text
Repo DevContainer MCP
```

ou:

```text
MCP Server para Repo VS Code
```

### Descrição

A descrição é importante porque ajuda o modelo a entender quando usar o conector. Ela deve dizer o que o servidor faz e em que contexto deve ser usado.

Exemplo conceitual:

```text
Conecta ao repositório aberto no VS Code dentro do WSL2 Docker Dev Container. Permite ler arquivos, buscar no código, inspecionar Git, rodar diagnósticos, executar jobs controlados e coordenar integrações locais do projeto.
```

### URL do servidor MCP

Este é o campo crítico.

Não use:

```text
http://localhost:3333/mcp
```

Use uma URL acessível pelo ChatGPT:

```text
https://<endpoint-do-tunel-ou-host>/mcp
```

Se for Secure MCP Tunnel, use o endpoint fornecido pela configuração do túnel OpenAI.

### Autenticação

Para desenvolvimento, pode haver modo sem autenticação dependendo do cenário e da configuração disponível. Para uso real, prefira OAuth ou uma combinação com túnel, grants locais e auditoria.

A documentação de autenticação da OpenAI observa que o ChatGPT não apresenta API keys customizadas nem grants machine-to-machine como client credentials; para identificação de cliente, há suporte a mecanismos como mTLS gerenciado pela OpenAI em servidores MCP que validam certificados de cliente.

Fonte oficial: https://developers.openai.com/apps-sdk/build/auth

### Aviso de risco

O aviso existe porque um MCP server pode executar ações reais. No nosso caso, isso é intencional: queremos controle amplo do repo. A resposta correta não é desativar poder; é desenhar poder com auditoria, grants, locks e reversibilidade via Git.

---

## 14. Autenticação e confiança

A conexão tem três camadas de confiança:

### Camada 1 — Transporte

O endpoint deve ser HTTPS quando acessado pelo ChatGPT. Com Secure MCP Tunnel, a conexão externa fica mediada pela infraestrutura da OpenAI e o tráfego do ambiente local sai por conexão outbound.

### Camada 2 — Identidade do cliente

Em produção, use OAuth, mTLS validado, allowlist ou controles equivalentes conforme o tipo de publicação. Evite depender de segredo fixo em header se o cliente não puder apresentá-lo oficialmente.

### Camada 3 — Permissões internas do projeto

Mesmo que o ChatGPT consiga chamar o MCP, o servidor deve decidir o que cada tool pode fazer.

Perfis recomendados:

```text
observe — leitura, busca, status, logs.
edit — escrita controlada, patches e arquivos no workspace.
build — execução de testes, lint, build e diagnósticos.
ops — instalação, scripts mais amplos, processos e tarefas.
admin — comandos livres temporários com grant explícito e auditoria.
```

---

## 15. Como o MCP server deve enxergar o repositório

O MCP server deve ter um `REPO_ROOT` explícito, por exemplo:

```text
/workspaces/<repo>
```

Todas as operações de arquivo devem resolver caminhos relativos a esse root. O servidor deve recusar:

- paths absolutos fora do workspace;
- `..` que escapem do root;
- leitura acidental de `.ssh`, tokens e secrets;
- escrita fora do repo;
- uso não auditado do Docker socket.

O objetivo é ter liberdade ampla dentro do projeto, não liberdade acidental sobre a máquina inteira.

---

## 16. Tools essenciais do MCP server

O primeiro MCP server deve expor poucas tools, mas sólidas.

### Tools de descoberta

```text
repo_status
repo_tree
repo_find
repo_read_file
repo_search_text
```

Essas tools permitem que o ChatGPT entenda o projeto sem alterar nada.

### Tools de Git

```text
git_status
git_diff
git_log
git_show
git_branch_info
```

Essas tools tornam o estado verificável.

### Tools de diagnóstico

```text
project_doctor
list_scripts
read_package_metadata
```

Essas tools ajudam o modelo a entender como trabalhar no projeto.

---

## 17. Tools intermediárias

Depois da leitura segura, entram escrita e execução controlada.

### Escrita

```text
write_file
apply_patch
create_file
move_file
remove_file
```

Toda escrita deve gerar auditoria e preferencialmente passar por patch/diff.

### Execução

```text
run_script
run_test
run_lint
run_build
spawn_job
get_job_output
cancel_job
```

Operações longas devem virar jobs assíncronos, não chamadas bloqueantes sem rastreio.

### Contexto

```text
context_pack_create
context_pack_read
event_log_append
memory_note_write
```

Essas tools permitem continuidade entre ChatGPT, terminal, VS Code e outras LLMs.

---

## 18. Tools avançadas

Com a base estável, o MCP server pode expor capacidades mais fortes.

```text
create_worktree
switch_task_branch
run_admin_command
copilot_session_create
copilot_send_and_wait
copilot_steer
copilot_get_events
```

`run_admin_command` não deve ser a primeira tool do sistema. Ela é útil, mas deve vir com token local temporário, auditoria e kill switch.

---

## 19. VS Code usando o mesmo MCP server

O VS Code pode usar MCP servers diretamente. Para uso local no Dev Container, prefira `stdio`.

Conceito:

```text
VS Code Chat/Copilot
  ↓ stdio
MCP server Node 24
  ↓
repo local
```

Para HTTP, o VS Code pode conectar a servidores MCP por `type: "http"`; a documentação informa que ele tenta HTTP Stream e faz fallback para SSE quando necessário. Também há suporte a HTTP via Unix socket ou named pipe em cenários específicos.

Fonte oficial: https://code.visualstudio.com/docs/copilot/reference/mcp-configuration

---

## 20. GitHub Copilot SDK 0.3.0 no desenho

O GitHub Copilot SDK 0.3.0 é independente do ChatGPT, mas pode ser integrado ao mesmo ambiente.

Ele pode atuar de duas maneiras:

1. Como consumidor do nosso MCP server local.
2. Como runtime local de agente por meio de Copilot CLI headless.

A documentação do GitHub diz que o Copilot SDK pode integrar MCP servers que rodam como processos separados e expõem tools. Ela também distingue servidores locais/stdio e HTTP/SSE.

Fonte oficial: https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/mcp-servers

As release notes do SDK 0.3.0 indicam mudanças importantes: a terminologia de configuração MCP foi alinhada para `stdio` e `http`, e o vocabulário de permissões foi refinado para resultados como `approve-once`, `approve-for-session` e `approve-for-location`.

Fonte oficial: https://github.com/github/copilot-sdk/releases

---

## 21. Copilot CLI headless + `cliUrl`

O modo mais robusto para integrar Copilot local é rodar o Copilot CLI em modo headless dentro do Dev Container ou em container companheiro.

A ideia:

```text
Copilot CLI headless
  ↑ TCP / cliUrl
Copilot SDK Node 24
  ↑ MCP tool
ChatGPT ou outro orquestrador
```

Segundo a documentação do GitHub, nesse modo a CLI roda como servidor persistente; o backend se conecta por TCP usando `cliUrl`; múltiplos clientes SDK podem compartilhar o mesmo servidor.

Fonte oficial: https://docs.github.com/en/copilot/how-tos/copilot-sdk/set-up-copilot-sdk/backend-services

Isso não substitui o MCP server. Ele complementa:

```text
ChatGPT
  ↓
MCP server
  ↓
Copilot Bridge
  ↓
Copilot SDK
  ↓
Copilot CLI headless
  ↓
repo
```

O ChatGPT continua chamando tools MCP. O Copilot local pode ser acionado como executor especializado.

---

## 22. Como outras LLMs entram no sistema

Outras LLMs ou agentes podem usar o mesmo projeto se suportarem MCP ou se forem conectadas por uma ponte própria.

Modelos de conexão:

```text
LLM local → stdio → MCP server
LLM remota → HTTPS /mcp → MCP server
LLM remota → túnel → MCP server
Copilot SDK → stdio/http → MCP server
```

A vantagem do MCP é evitar criar uma integração diferente para cada LLM. O repositório expõe um contrato comum; cada cliente usa o transporte compatível.

---

## 23. Memória operacional compartilhada

A conversa do ChatGPT pode ser efêmera. O projeto não deve ser.

Crie uma pasta de estado operacional:

```text
.ai/
  context-pack.md
  tasks/
  logs/
  jobs/
  audit/
  decisions/
```

Essa pasta serve para:

- registrar decisões;
- guardar estado de tarefas;
- permitir retomada por outra LLM;
- tornar operações auditáveis;
- reduzir dependência da memória da conversa;
- permitir que terminal, ChatGPT, VS Code e Copilot compartilhem contexto.

Para humanos e LLMs, o arquivo mais importante é o `context-pack.md`, que deve explicar o estado atual do projeto, próximos passos, comandos recentes, diffs relevantes e decisões tomadas.

---

## 24. Segurança sem amputar liberdade

O objetivo não é limitar o sistema a leitura. O objetivo é permitir controle amplo de maneira rastreável.

Princípios:

1. O repo é o limite operacional padrão.
2. Escritas devem gerar diff.
3. Comandos devem gerar job log.
4. Operações destrutivas exigem grant explícito.
5. Secrets devem ser protegidos por denylist e detecção.
6. Docker socket não deve ser exposto por padrão.
7. Ações devem ser reversíveis por Git quando possível.
8. Tool descriptions devem ser claras para evitar uso incorreto pelo modelo.
9. Prompt injection em arquivos do repo deve ser tratado como dado não confiável.
10. Liberdade máxima deve ser temporária, auditada e revogável.

---

## 25. Fluxo de implementação recomendado

### Fase 1 — Ambiente

- Repo no filesystem WSL2.
- VS Code aberto em WSL2.
- Dev Container funcional.
- Node 24 dentro do container.
- Scripts básicos do projeto funcionando.

### Fase 2 — MCP local de leitura

- Criar MCP server Node 24.
- Rodar via `stdio` dentro do Dev Container.
- Expor tools de leitura e Git.
- Testar no VS Code ou MCP Inspector.

### Fase 3 — Project Control Plane

- Criar camada de paths, auditoria e logs.
- Criar `.ai/`.
- Criar `project_doctor`.
- Criar tools de diagnóstico.

### Fase 4 — Streamable HTTP `/mcp`

- Adicionar adaptador HTTP.
- Bind local em `127.0.0.1` para desenvolvimento.
- Validar `Origin` quando aplicável.
- Preparar autenticação ou proteção por túnel.

### Fase 5 — Secure MCP Tunnel

- Rodar o `tunnel-client` onde ele alcança o MCP server.
- Apontar o túnel para o endpoint local `/mcp`.
- Usar a URL do túnel no formulário do ChatGPT.

### Fase 6 — ChatGPT

- Criar o conector no ChatGPT.
- Preencher nome, descrição, URL `/mcp` e autenticação.
- Confirmar que as tools aparecem.
- Testar leitura do repo.
- Depois testar escrita controlada.

### Fase 7 — Copilot SDK 0.3.0

- Integrar Copilot SDK como consumidor local.
- Opcionalmente iniciar Copilot CLI headless.
- Conectar via `cliUrl`.
- Expor tools MCP de delegação ao Copilot local.

### Fase 8 — Operação avançada

- Jobs assíncronos.
- Worktrees.
- Locks.
- Event bus.
- Grants temporários.
- Admin command auditado.

---

## 26. Smoke tests

Antes de conectar o ChatGPT, valide localmente:

```text
1. O MCP server sobe no Dev Container.
2. Ele enxerga /workspaces/<repo>.
3. repo_status retorna o branch correto.
4. repo_read_file lê um arquivo conhecido.
5. git_diff retorna o diff atual.
6. project_doctor identifica Node 24, Git e scripts.
7. O endpoint /mcp responde localmente.
8. O túnel consegue alcançar /mcp.
9. O ChatGPT lista as tools após criar o conector.
10. Uma chamada simples de leitura funciona na conversa.
```

Depois:

```text
11. apply_patch cria um diff esperado.
12. run_test cria job log.
13. get_job_output retorna logs.
14. cancel_job interrompe processo longo.
15. audit log registra cada ação.
```

---

## 27. Diagnóstico de falhas comuns

### ChatGPT não conecta

Prováveis causas:

- URL não é HTTPS.
- URL aponta para localhost.
- `/mcp` não está exposto corretamente.
- Tunnel client não está rodando.
- MCP server caiu.
- Autenticação não está compatível.

### Tools não aparecem

Prováveis causas:

- O servidor não respondeu ao handshake MCP.
- Tool schema inválido.
- Descrição ou metadados quebrados.
- Endpoint errado.
- Servidor responde HTML/erro em vez de JSON-RPC/MCP.

### VS Code funciona, ChatGPT não

Provável causa:

- VS Code está usando `stdio`, mas ChatGPT precisa de HTTP/túnel.

### ChatGPT funciona, mas não vê arquivos certos

Prováveis causas:

- MCP server rodando fora do Dev Container.
- `REPO_ROOT` aponta para caminho errado.
- Repo está no Windows filesystem e não no WSL2.
- Container companheiro não montou o mesmo workspace.

### Performance ruim

Prováveis causas:

- Repo em `C:\`.
- `node_modules` em bind mount lento.
- Busca textual sem índice.
- Tools retornando contexto excessivo.
- Jobs longos sendo executados de modo síncrono.

A documentação do VS Code recomenda volumes nomeados para diretórios de alta escrita, como `node_modules`, caches e build outputs, quando performance de bind mount é um problema.

Fonte oficial: https://code.visualstudio.com/remote/advancedcontainers/improve-performance

---

## 28. Decisões canônicas

1. O repo deve ficar no filesystem WSL2.
2. O VS Code deve abrir o repo em Dev Container.
3. O MCP server deve rodar no mesmo ambiente do repo.
4. Node 24 é o runtime padrão.
5. `stdio` é o transporte local principal.
6. Streamable HTTP `/mcp` é o transporte remoto principal.
7. SSE legado é apenas compatibilidade.
8. ChatGPT não usa `localhost`; usa HTTPS ou Secure MCP Tunnel.
9. O formulário do ChatGPT recebe a URL pública/tunelada `/mcp`.
10. O MCP server deve começar por leitura e Git antes de escrita e execução.
11. Escrita e execução devem ser auditadas.
12. GitHub Copilot SDK 0.3.0 entra como camada local complementar.
13. Copilot CLI headless + `cliUrl` é o attach robusto para backend local.
14. `.ai/` é a memória operacional compartilhada.
15. Liberdade ampla exige logs, grants, locks e reversibilidade.

---

## 29. Fontes oficiais

### OpenAI / ChatGPT / MCP

- Connect from ChatGPT — Apps SDK:
  https://developers.openai.com/apps-sdk/deploy/connect-chatgpt

- Build your MCP server — Apps SDK:
  https://developers.openai.com/apps-sdk/build/mcp-server

- Secure MCP Tunnel — OpenAI API:
  https://developers.openai.com/api/docs/guides/secure-mcp-tunnels

- MCP and Connectors — OpenAI API:
  https://developers.openai.com/api/docs/guides/tools-connectors-mcp

- Authentication — Apps SDK:
  https://developers.openai.com/apps-sdk/build/auth

### Model Context Protocol

- MCP specification — transports:
  https://modelcontextprotocol.io/specification/2025-03-26/basic/transports

- MCP specification index:
  https://modelcontextprotocol.io/specification

### VS Code / Dev Containers / WSL2

- Add and manage MCP servers in VS Code:
  https://code.visualstudio.com/docs/copilot/customization/mcp-servers

- MCP configuration reference — VS Code:
  https://code.visualstudio.com/docs/copilot/reference/mcp-configuration

- Developing inside a Container — VS Code:
  https://code.visualstudio.com/docs/devcontainers/containers

- Improve Dev Container performance — VS Code:
  https://code.visualstudio.com/remote/advancedcontainers/improve-performance

- Dev Containers on Windows with WSL2 — Microsoft Learn:
  https://learn.microsoft.com/en-us/windows/dev-environment/docker/dev-containers

### GitHub Copilot SDK / CLI

- Copilot SDK backend services:
  https://docs.github.com/en/copilot/how-tos/copilot-sdk/set-up-copilot-sdk/backend-services

- Copilot SDK with MCP servers:
  https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/mcp-servers

- Copilot SDK releases:
  https://github.com/github/copilot-sdk/releases

- About GitHub Copilot CLI:
  https://docs.github.com/copilot/concepts/agents/about-copilot-cli

### Node.js

- Node.js documentation:
  https://nodejs.org/docs/latest-v24.x/api/

- Node.js Permission Model:
  https://nodejs.org/docs/latest-v24.x/api/permissions.html

---

## 30. Conclusão

A conexão correta entre ChatGPT e o nosso VS Code em WSL2 Docker Dev Container não é uma conexão visual com o editor, nem uma tentativa de controlar a tela do terminal. É uma conexão protocolar.

O ChatGPT se conecta a um endpoint MCP. Esse endpoint chega a um MCP server Node 24 rodando dentro do Dev Container. Esse servidor opera o repositório real, com tools bem definidas, logs, grants, Git, jobs e memória compartilhada.

O desenho final é simples na superfície e forte internamente:

```text
ChatGPT
  ↓
Connector MCP em /mcp
  ↓
Secure MCP Tunnel ou HTTPS
  ↓
MCP server Node 24 no Dev Container
  ↓
Project Control Plane
  ↓
Repo real do VS Code
```

Para o humano, isso significa poder pedir ao ChatGPT para investigar, editar, testar, revisar e coordenar o projeto. Para outras LLMs, significa uma interface padronizada. Para o sistema, significa que o projeto deixa de depender de uma conversa específica e passa a ter uma superfície operacional própria.

A implementação deve começar pequena: leitura, Git e diagnóstico. Em seguida, escrita controlada. Depois, jobs. Por fim, Copilot SDK 0.3.0, Copilot CLI headless, worktrees, event bus e multiagente.

O resultado esperado é um ambiente no qual o ChatGPT e outros agentes não apenas “comentam” sobre o projeto, mas conseguem operar o projeto dentro do mesmo ambiente real em que ele é desenvolvido.
