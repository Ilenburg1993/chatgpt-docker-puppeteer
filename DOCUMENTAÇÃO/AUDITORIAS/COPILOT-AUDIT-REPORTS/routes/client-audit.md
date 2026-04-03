# client.js — Auditoria (routes/)

**Módulo**: `src/copilot/routes/` **Arquivo**: `client.js` **LOC**: 205 | **Score**: 8.5/10

## Responsabilidade

Controle do CopilotClient e utilitários globais: ping, status, auth, models, tools,
`POST /client/start|stop|force-stop`.

## Achados

### C14-CL01 — P5

**`POST /client/start|stop|force-stop` sem autenticação própria**

Endpoints destrutivos do cliente não verificam `SDK_API_TOKEN` independentemente. A proteção depende
do roteador pai (sdk-api.js) aplicar o middleware de auth. Se o roteador pai não tiver auth global,
esses endpoints ficam expostos.

### C14-CL02 — P5

**`GET /tools` acessa `alwaysAliveAgent.toolsRegistry` via cast inseguro**

```js
const registry = /** @type {{ toolsRegistry?: ... }} */ (alwaysAliveAgent).toolsRegistry;
```

Se a propriedade `toolsRegistry` não existir ou mudar de tipo, o TypeScript não captura em runtime —
afeta apenas a resposta da API sem causar crash.

## Destaques Positivos

- `POST /client/force-stop` usa Optional Chaining `?.forceStop()` (BUG-MOD-15 fix) — correto
- `GET /tools` tem fallback para `allTools` estático quando registry não está disponível
- `GET /status` retorna estado sem fazer `getClient()` quando não conectado — evita inicializar
  cliente ao consultar status

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
