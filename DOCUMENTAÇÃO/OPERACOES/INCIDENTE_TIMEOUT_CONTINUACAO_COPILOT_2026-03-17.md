# Incidente — Timeout na continuação de turnos do Copilot Chat (2026-03-17)

**Status**: Aberto com mitigação aplicada (monitoramento ativo) **Severidade**: Alta (interrupção
recorrente de fluxo de trabalho) **Escopo**: VS Code + Copilot Chat (não relacionado ao sistema de
hooks do repositório) **Data**: 2026-03-17

## 1) Resumo executivo

Foi investigada uma falha recorrente na continuação de turnos do Copilot Chat, com sintomas
compatíveis com `request timeout` (incluindo cenário de `408 user_request_timeout`).

Ponto crítico confirmado durante a investigação: **os hooks locais estão desativados no caminho
ativo**, então a causa não deve ser atribuída ao pipeline de hooks do projeto.

Como mitigação imediata, foi criado um diagnóstico operacional de rede dedicado:

- `scripts/ops/copilot-network-diagnose.sh`

Esse script valida os endpoints principais do Copilot, mede latências por etapa
(DNS/TCP/TLS/TTFB/total) e gera saída acionável para triagem.

---

## 2) Evidências coletadas nesta sessão

### 2.1 Diagnóstico local de conectividade (container Linux)

Resultados reais observados:

- `https://copilot-proxy.githubusercontent.com/_ping` → **HTTP 200**
- `https://api.githubcopilot.com/_ping` → **HTTP 200**

Latências observadas (amostra):

- Endpoint 1: total ~`0.160s`
- Endpoint 2: total ~`0.713s`

DNS também resolveu corretamente para ambos os hosts.

### 2.2 Status público do GitHub

Consulta da API pública de status retornou componentes em estado operacional no momento da coleta.

### 2.3 Contexto estrutural do workspace

No diretório ativo de hooks (`.github/hooks`) há apenas `logs/`. A implementação antiga existe em
`.github/hooks.old/`, reforçando que o incidente atual de timeout não depende do fluxo legado de
hooks.

---

## 3) Hipóteses de causa raiz (priorizadas)

1. **Intermitência transitória do serviço de chat/modelo** (mais provável)
   - Mesmo com `_ping` saudável, chamadas de geração podem sofrer timeout sob carga.
2. **Proxy/firewall/certificado corporativo com comportamento intermitente**
   - Especialmente em inspeção TLS, rotação de certificados e políticas variáveis.
3. **Sessão de autenticação degradada no VS Code/Copilot**
   - Token/sessão expirada ou inconsistência após atualização.
4. **Versão de VS Code / extensão incompatível com versão atual de Chat**
   - A documentação aponta dependência forte da versão mais recente para Chat.
5. **Problema local do processo Electron/extensão**
   - Erros não propagados só visíveis em Developer Tools / logs TRACE.

---

## 4) Mitigações aplicadas (agora)

### 4.1 Hardening operacional leve

- Criado `scripts/ops/copilot-network-diagnose.sh` para validação rápida e repetível.
- Atualizado `scripts/ops/README.md` para indexar o novo utilitário.
- Ajustado `.vscode/settings.json` para perfil mais estável em ambiente doméstico:
  - `chat.agent.maxRequests`: `1000` → `25`
  - `chat.requestQueuing.defaultAction`: `"queue"` (explicitado)
  - `github.copilot.chat.responsesApiReasoningEffort`: `"high"` → `"medium"`

### 4.2 Playbook de resposta rápida

Quando ocorrer timeout novamente:

1. Executar `copilot-network-diagnose.sh` (com e sem proxy explícito, se aplicável).
2. Abrir `Developer: Chat Diagnostics` e capturar seção **Reachability**.
3. Ativar log em `Trace` para extensões GitHub/Copilot temporariamente.
4. Coletar logs de extensão e console Electron (`Developer: Toggle Developer Tools`).
5. Correlacionar com status público GitHub no mesmo intervalo.

---

## 5) Medidas preventivas recomendadas

1. **Padronizar checklist de rede para incidente Copilot** (já iniciado com script).
2. **Eliminar proxy herdado desnecessário** no ambiente local (variáveis `HTTP_PROXY`/`HTTPS_PROXY`
   só quando realmente necessário).
3. **Manter trust store padrão íntegro** no Linux (`/etc/ssl/certs`), sem relaxar SSL como
   configuração permanente.
4. **Manter VS Code + Copilot Chat atualizados** para evitar incompatibilidade de protocolo/UI.
5. **Reduzir risco de timeout por payload excessivo** em prompts longos (dividir solicitações quando
   necessário).

### 5.0 Perfil recomendado para este caso (usuário doméstico)

- **Sem proxy manual** como padrão (usar rede direta).
- **SSL estrito mantido** (`http.proxyStrictSSL = true`, quando aplicável).
- **Fila de requests habilitada** (`chat.requestQueuing.defaultAction = "queue"`).
- **Menor fan-out de agente** (`chat.agent.maxRequests = 25`).
- **Esforço de raciocínio balanceado**
  (`github.copilot.chat.responsesApiReasoningEffort = "medium"`).

Esses ajustes já foram aplicados no workspace atual.

### 5.1 Alternativas de configuração (com avaliação)

| Alternativa                                        | Configuração                                                               | Ganho esperado                                        | Risco    | Quando usar                               |
| -------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- | -------- | ----------------------------------------- |
| A. Proxy explícito no VS Code                      | `http.proxy`                                                               | Remove ambiguidade de descoberta de proxy             | Baixo    | Ambiente corporativo com proxy fixo       |
| B. Proxy via ENV (prioridade Copilot)              | `HTTPS_PROXY` / `https_proxy` / `HTTP_PROXY` / `http_proxy`                | Padroniza uso em shell + extensões                    | Baixo    | Ambientes containerizados e CI local      |
| C. Kerberos SPN custom                             | `http.proxyKerberosServicePrincipal` ou `AGENT_KERBEROS_SERVICE_PRINCIPAL` | Corrige falhas de autenticação Kerberos intermitentes | Médio    | Proxy corporativo com SPN não padrão      |
| D. Certificado extra explícito                     | `NODE_EXTRA_CA_CERTS=/caminho/ca.pem`                                      | Elimina erro de cadeia SSL incompleta                 | Médio    | Inspeção TLS corporativa/Zscaler          |
| E. Trust store Linux completo                      | instalar CA no sistema + NSS                                               | Reduz falha TLS intermitente no Electron/Chromium     | Médio    | Linux com proxy TLS interceptando tráfego |
| F. Troca temporária de fila no chat                | `chat.requestQueuing.defaultAction = "queue"`                              | Menos colisão de requisições durante picos            | Baixo    | Uso intenso com múltiplos envios seguidos |
| G. Reautenticar sessão Copilot                     | Sign out/in + `Developer: Reload Window`                                   | Resolve token/sessão degradada                        | Baixo    | Falhas sem sintoma claro de rede          |
| H. Desabilitar validação SSL do proxy (temporário) | `http.proxyStrictSSL = false`                                              | Pode desbloquear diagnóstico em ambiente quebrado     | **Alto** | Somente teste controlado, nunca padrão    |

> Observação oficial: proxy `https://` para Copilot não é suportado; use proxy `http://` e TLS
> tratado pelo túnel/proxy conforme política corporativa.

### 5.2 Ordem recomendada de aplicação (menor risco → maior impacto)

1. Reautenticação + reload do VS Code (G).
2. Atualizar VS Code/Copilot e repetir diagnóstico.
3. Fixar proxy explícito (A) ou ENV padronizada (B).
4. Ajustar Kerberos SPN se aplicável (C).
5. Corrigir cadeia de certificados (D/E).
6. Ajustar comportamento de fila do chat (F).
7. `http.proxyStrictSSL = false` somente como experimento curto para confirmar hipótese de
   certificado (H).

### 5.3 Exemplo de baseline de configuração (VS Code + ambiente)

`settings.json` (exemplo conservador):

```json
{
  "http.proxy": "http://proxy.example.com:3128",
  "http.proxyStrictSSL": true,
  "chat.requestQueuing.defaultAction": "queue",
  "http.proxyKerberosServicePrincipal": "HTTP/proxy.example.com"
}
```

Ambiente (quando aplicável):

```bash
export HTTPS_PROXY="http://proxy.example.com:3128"
export HTTP_PROXY="http://proxy.example.com:3128"
export NODE_EXTRA_CA_CERTS="/etc/ssl/certs/corporate-root-ca.pem"
```

> Em produção corporativa, validar esses valores com a equipe de rede/segurança antes de aplicar.

---

## 6) Referências oficiais usadas

- VS Code troubleshooting (Copilot / Chat Debug / Diagnostics)
- VS Code network configuration (`Network Connections in Visual Studio Code`)
- GitHub Docs:
  - `Troubleshooting network errors for GitHub Copilot`
  - `Troubleshooting firewall settings for GitHub Copilot`
  - `Viewing logs for GitHub Copilot in your environment`
  - `Troubleshooting common issues with GitHub Copilot`
  - `Configuring network settings for GitHub Copilot`
  - `Copilot allowlist reference`
- GitHub Status (`githubstatus.com`)

---

## 7) Próximo passo recomendado

Se o erro reaparecer apesar de rede `_ping` saudável e status global operacional, abrir incidente
com pacote de evidências (Chat Diagnostics + logs TRACE + timestamps + output do script), para
escalonamento técnico com maior precisão.
