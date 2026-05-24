# Plano completo de patches OAuth — WORKSPACE MCP

**Data:** 2026-05-23
**Escopo:** reduzir reautenticação OAuth, ambiguidade de metadata, risco de `401 Reauthentication required`, e criar diagnóstico permanente.
**Modo de aplicação:** manual/local, sem usar as tools MCP de escrita/patch/remove.

> Base de código analisada: arquivo anexado `Código colado.js`, equivalente a `src/copilot/mcp/control-plane/dev-oauth.js`.
> Estado atual importante: o arquivo já tem `DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60`, `DEFAULT_REFRESH_TOKEN_TTL_SECONDS`, `RENEW_GRANT` e `RENEW_PREFIX`, mas os itens de renovação ainda estão parcialmente sem uso, causando `TS6133` até completar a implementação.

---

## 1. Limite real: OAuth reduz reauth, não desliga aprovação de tool-call

A documentação oficial da OpenAI separa as responsabilidades: o MCP server verifica access tokens em cada request; o authorization server emite tokens e publica metadata; ChatGPT é o cliente e suporta CIMD, DCR, clientes predefinidos e PKCE. Ela também lista os requisitos principais: protected resource metadata, OAuth metadata, ecoar `resource`, escolher CIMD/DCR/predefined client e publicar métodos aceitos pelo token endpoint.

A mesma documentação afirma que ChatGPT usa o authorization-code flow com PKCE S256 e que o servidor precisa validar assinatura, issuer, audience, expiração e scopes. Quando a validação falha, o servidor deve responder `401` com `WWW-Authenticate` apontando para a protected-resource metadata.

Logo, estes patches reduzem:

- reauth por expiração curta;
- reauth por metadata ambígua;
- erro por scope/audience/issuer/JWKS sem diagnóstico;
- bloqueio por não conseguir diagnosticar OAuth quando o token quebrou.

Eles **não** podem desligar a caixinha de aprovação de tool-call de escrita/destrutiva no ChatGPT. Para isso, o caminho continua sendo annotations, plan tools, batch, narrower schemas e remembered approvals quando o host oferecer.

---

## 2. Resumo das alterações propostas

1. `dev-oauth.js`
   - Mantém access token em **24h** por default.
   - Adiciona TTL configurável por env:
     - `COPILOT_MCP_DEV_OAUTH_ACCESS_TOKEN_TTL_SECONDS=86400`
     - `COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_TTL_SECONDS=2592000`
   - Implementa `refresh_token` de 30 dias por default.
   - Anuncia `refresh_token` em `grant_types_supported`, DCR e CIMD client metadata.
   - Refatora emissão de token para `issueTokenSet`.
   - Observação: refresh tokens ficam em memória neste patch; restart do MCP invalida refresh tokens. Isso é aceitável para dev/permanent tunnel, mas uma versão production deveria persistir hash do refresh token ou usar IdP externo.

2. `auth.js`
   - Alinha `token_endpoint_auth_methods_supported` da protected resource metadata para `['none']`, igual ao issuer dev.
   - Adiciona classificação granular de falhas JWT:
     - `MCP_AUTH_TOKEN_EXPIRED`
     - `MCP_AUTH_AUDIENCE_INVALID`
     - `MCP_AUTH_ISSUER_INVALID`
     - `MCP_AUTH_JWKS_ERROR`
     - fallback `MCP_AUTH_TOKEN_INVALID`
   - Adiciona uma exceção pública/sanitizada para `mcp_oauth_friction_audit`, permitindo diagnóstico quando o OAuth quebra.

3. Nova tool `mcp_oauth_friction_audit`
   - Read-only.
   - Pode rodar sem OAuth, mas só retorna dados sanitizados.
   - Verifica resource/audience/issuer, metadata, grants, CIMD, PKCE e scopes por tool.
   - Explica que OAuth reduz reauth, não aprovação de tool-call.

4. Registry/meta/tests
   - Registra a nova tool.
   - Atualiza capabilities version.
   - Atualiza testes de registry e tools.
   - Atualiza templates de env para incluir TTLs longos e diagnóstico OAuth público.

---

## 3. Patch A — `dev-oauth.js`

Aplique este patch contra o estado anexado de `src/copilot/mcp/control-plane/dev-oauth.js`.

```diff
--- a/src/copilot/mcp/control-plane/dev-oauth.js
+++ b/src/copilot/mcp/control-plane/dev-oauth.js
@@ -59,6 +59,9 @@
 /** @type {Map<string, DevOAuthClient>} */
 const clientMetadataDocumentCache = new Map();

+/** @type {Map<string, { clientId: string; scope: string; resource: string; expiresAt: number }>} */
+const renewCredentials = new Map();
+
 /**
  * @param {import('./auth.js').McpAuthConfig} config
  * @param {NodeJS.ProcessEnv} [env]
@@ -87,7 +90,7 @@
         registration_endpoint: `${config.resource}/oauth/register`,
         client_id_metadata_document_supported: true,
         response_types_supported: ['code'],
-        grant_types_supported: ['authorization_code'],
+        grant_types_supported: ['authorization_code', RENEW_GRANT],
         token_endpoint_auth_methods_supported: ['none'],
         code_challenge_methods_supported: ['S256'],
         scopes_supported: scopesSupported,
@@ -109,7 +112,7 @@
         client_name: 'Copilot MCP CIMD smoke client',
         client_uri: config.resource,
         redirect_uris: [DEV_CLIENT_REDIRECT_URI],
-        grant_types: ['authorization_code'],
+        grant_types: ['authorization_code', RENEW_GRANT],
         response_types: ['code'],
         token_endpoint_auth_method: 'none',
     };
@@ -163,7 +166,7 @@
             client_name: client.clientName,
             redirect_uris: client.redirectUris,
             token_endpoint_auth_method: 'none',
-            grant_types: ['authorization_code'],
+            grant_types: ['authorization_code', RENEW_GRANT],
             response_types: ['code'],
         });
         return true;
@@ -325,6 +328,24 @@
 async function handleToken(req, res, config) {
     const body = await readRequestBody(req);
     const grantType = String(body['grant_type'] ?? '');
+    if (grantType === 'authorization_code') {
+        await handleAuthorizationCodeToken(body, res, config);
+        return;
+    }
+    if (grantType === RENEW_GRANT) {
+        await handleRenewToken(body, res, config);
+        return;
+    }
+    writeJson(res, 400, { error: 'unsupported_grant_type' });
+}
+
+/**
+ * @param {Record<string, unknown>} body
+ * @param {import('node:http').ServerResponse} res
+ * @param {import('./auth.js').McpAuthConfig} config
+ * @returns {Promise<void>}
+ */
+async function handleAuthorizationCodeToken(body, res, config) {
     const code = String(body['code'] ?? '');
     const clientId = String(body['client_id'] ?? '');
     const redirectUri = String(body['redirect_uri'] ?? '');
@@ -334,7 +355,6 @@
     authorizationCodes.delete(code);

     if (
-        grantType !== 'authorization_code' ||
         !saved ||
         saved.clientId !== clientId ||
         saved.redirectUri !== redirectUri ||
@@ -346,23 +366,78 @@
         return;
     }

+    writeJson(
+        res,
+        200,
+        await issueTokenSet(
+            {
+                clientId,
+                scope: saved.scope,
+                resource,
+                includeIdToken: saved.scope.split(/\s+/u).includes('openid'),
+            },
+            config,
+        ),
+    );
+}
+
+/**
+ * @param {Record<string, unknown>} body
+ * @param {import('node:http').ServerResponse} res
+ * @param {import('./auth.js').McpAuthConfig} config
+ * @returns {Promise<void>}
+ */
+async function handleRenewToken(body, res, config) {
+    const clientId = String(body['client_id'] ?? '');
+    const credential = String(body[RENEW_GRANT] ?? '');
+    const saved = renewCredentials.get(credential);
+    renewCredentials.delete(credential);
+
+    if (!saved || saved.clientId !== clientId || saved.resource !== config.resource || Date.now() > saved.expiresAt) {
+        writeJson(res, 400, { error: 'invalid_grant' });
+        return;
+    }
+
+    writeJson(
+        res,
+        200,
+        await issueTokenSet(
+            {
+                clientId,
+                scope: saved.scope,
+                resource: saved.resource,
+                includeIdToken: saved.scope.split(/\s+/u).includes('openid'),
+            },
+            config,
+        ),
+    );
+}
+
+/**
+ * @param {{ clientId: string; scope: string; resource: string; includeIdToken: boolean }} options
+ * @param {import('./auth.js').McpAuthConfig} config
+ * @returns {Promise<Record<string, unknown>>}
+ */
+async function issueTokenSet(options, config) {
     const { privateKey, kid } = await getKeyMaterial();
     const nowSeconds = Math.floor(Date.now() / 1000);
+    const accessTokenTtlSeconds = readAccessTokenTtlSeconds();
+    const renewTtlSeconds = readRenewTtlSeconds();
     const accessToken = await new SignJWT({
-        scope: saved.scope,
-        client_id: clientId,
-        resource,
+        scope: options.scope,
+        client_id: options.clientId,
+        resource: options.resource,
     })
         .setProtectedHeader({ alg: 'RS256', kid })
         .setIssuer(config.resource)
         .setSubject('chatgpt-dev-connector')
         .setAudience(config.resource)
         .setIssuedAt(nowSeconds)
-        .setExpirationTime(nowSeconds + DEFAULT_ACCESS_TOKEN_TTL_SECONDS)
+        .setExpirationTime(nowSeconds + accessTokenTtlSeconds)
         .setJti(randomUUID())
         .sign(privateKey);

-    const idToken = saved.scope.split(/\s+/u).includes('openid')
+    const idToken = options.includeIdToken
         ? await new SignJWT({
               email: 'chatgpt-dev-connector@mcp.aurelin.org',
               email_verified: true,
@@ -372,20 +447,84 @@
               .setProtectedHeader({ alg: 'RS256', kid })
               .setIssuer(config.resource)
               .setSubject('chatgpt-dev-connector')
-              .setAudience(clientId)
+              .setAudience(options.clientId)
               .setIssuedAt(nowSeconds)
-              .setExpirationTime(nowSeconds + DEFAULT_ACCESS_TOKEN_TTL_SECONDS)
+              .setExpirationTime(nowSeconds + accessTokenTtlSeconds)
               .setJti(randomUUID())
               .sign(privateKey)
         : undefined;

-    writeJson(res, 200, {
+    return {
         access_token: accessToken,
         token_type: 'Bearer',
-        expires_in: DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
-        scope: saved.scope,
+        expires_in: accessTokenTtlSeconds,
+        scope: options.scope,
+        [RENEW_GRANT]: issueRenewCredential(options.clientId, options.scope, options.resource, renewTtlSeconds),
+        refresh_token_expires_in: renewTtlSeconds,
         ...(idToken ? { id_token: idToken } : {}),
+    };
+}
+
+/**
+ * @returns {number}
+ */
+function readAccessTokenTtlSeconds() {
+    return readPositiveIntegerEnv(
+        'COPILOT_MCP_DEV_OAUTH_ACCESS_TOKEN_TTL_SECONDS',
+        DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
+        60 * 60,
+    );
+}
+
+/**
+ * @returns {number}
+ */
+function readRenewTtlSeconds() {
+    return readPositiveIntegerEnv(
+        'COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_TTL_SECONDS',
+        DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
+        24 * 60 * 60,
+    );
+}
+
+/**
+ * @param {string} name
+ * @param {number} fallback
+ * @param {number} minimum
+ * @returns {number}
+ */
+function readPositiveIntegerEnv(name, fallback, minimum) {
+    const parsed = Number(process.env[name] ?? fallback);
+    return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback;
+}
+
+/**
+ * @param {string} clientId
+ * @param {string} scope
+ * @param {string} resource
+ * @param {number} ttlSeconds
+ * @returns {string}
+ */
+function issueRenewCredential(clientId, scope, resource, ttlSeconds) {
+    pruneExpiredRenewCredentials();
+    const credential = `${RENEW_PREFIX}${randomUUID()}`;
+    renewCredentials.set(credential, {
+        clientId,
+        scope,
+        resource,
+        expiresAt: Date.now() + ttlSeconds * 1000,
     });
+    return credential;
+}
+
+/**
+ * @param {number} [nowMs]
+ * @returns {void}
+ */
+function pruneExpiredRenewCredentials(nowMs = Date.now()) {
+    for (const [credential, metadata] of renewCredentials) {
+        if (metadata.expiresAt <= nowMs) renewCredentials.delete(credential);
+    }
 }

 /**

```

---

## 4. Patch B — `auth.js`

```diff
diff --git a/src/copilot/mcp/control-plane/auth.js b/src/copilot/mcp/control-plane/auth.js
--- a/src/copilot/mcp/control-plane/auth.js
+++ b/src/copilot/mcp/control-plane/auth.js
@@
 /** @type {Map<string, ReturnType<typeof createRemoteJWKSet>>} */
 const REMOTE_JWKS_CACHE = new Map();

+const PUBLIC_OAUTH_DIAGNOSTIC_TOOLS = new Set(['mcp_oauth_friction_audit']);
+
+/**
+ * @param {NodeJS.ProcessEnv} [env]
+ * @returns {boolean}
+ */
+function publicOauthDiagnosticsEnabled(env = process.env) {
+    const raw = String(env['COPILOT_MCP_PUBLIC_OAUTH_DIAGNOSTICS'] ?? 'true')
+        .trim()
+        .toLowerCase();
+    return raw !== '0' && raw !== 'false' && raw !== 'no' && raw !== 'off';
+}
+
+/**
+ * @param {import('../registry.js').McpToolDefinition} tool
+ * @param {NodeJS.ProcessEnv} [env]
+ * @returns {boolean}
+ */
+export function isPublicOauthDiagnosticTool(tool, env = process.env) {
+    return publicOauthDiagnosticsEnabled(env) && PUBLIC_OAUTH_DIAGNOSTIC_TOOLS.has(tool.name);
+}
+
@@
 export function securitySchemesForMcpTool(tool, config = readMcpAuthConfig()) {
     const oauth = { type: /** @type {const} */ ('oauth2'), scopes: scopesForMcpTool(tool) };
+    if (config.mode === 'oauth' && isPublicOauthDiagnosticTool(tool)) return [{ type: 'noauth' }, oauth];
     if (config.mode === 'oauth') return [oauth];
     if (config.mode === 'mixed-auth') return [{ type: 'noauth' }, oauth];
     return [{ type: 'noauth' }];
 }
@@
 export function buildProtectedResourceMetadata(config = readMcpAuthConfig()) {
     return {
         resource: config.resource,
         authorization_servers: [...config.authorizationServers],
         scopes_supported: [...config.initialScopes],
         resource_documentation: config.resourceDocumentation,
-        token_endpoint_auth_methods_supported: ['none', 'private_key_jwt', 'client_secret_post', 'client_secret_basic'],
+        token_endpoint_auth_methods_supported: ['none'],
     };
 }
@@
 function normalizeScopeClaim(value) {
     if (typeof value === 'string') return value.split(/\s+/u).map((item) => item.trim()).filter(Boolean);
     if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item.trim()).map(String);
     return [];
 }

+/**
+ * @param {unknown} error
+ * @returns {{ code: string; message: string; hint: string; wwwAuthenticateError: string; errorDescription: string }}
+ */
+function classifyBearerVerificationError(error) {
+    const metadata = error && typeof error === 'object' ? /** @type {Record<string, unknown>} */ (error) : {};
+    const joseCode = typeof metadata['code'] === 'string' ? metadata['code'] : '';
+    const name = error instanceof Error ? error.name : '';
+    const message = error instanceof Error ? error.message : String(error);
+    const normalized = `${joseCode} ${name} ${message}`.toLowerCase();
+    if (normalized.includes('expired')) {
+        return {
+            code: 'MCP_AUTH_TOKEN_EXPIRED',
+            message: 'Bearer token has expired.',
+            hint: message,
+            wwwAuthenticateError: 'invalid_token',
+            errorDescription: 'Bearer token has expired; reauthorize or use a renewed token.',
+        };
+    }
+    if (normalized.includes('aud') || normalized.includes('audience')) {
+        return {
+            code: 'MCP_AUTH_AUDIENCE_INVALID',
+            message: 'Bearer token audience does not match this MCP resource.',
+            hint: message,
+            wwwAuthenticateError: 'invalid_token',
+            errorDescription: 'Bearer token audience does not match this MCP resource.',
+        };
+    }
+    if (normalized.includes('issuer') || normalized.includes('iss')) {
+        return {
+            code: 'MCP_AUTH_ISSUER_INVALID',
+            message: 'Bearer token issuer does not match the configured OAuth issuer.',
+            hint: message,
+            wwwAuthenticateError: 'invalid_token',
+            errorDescription: 'Bearer token issuer does not match the configured OAuth issuer.',
+        };
+    }
+    if (normalized.includes('jwks') || normalized.includes('jwk') || normalized.includes('key')) {
+        return {
+            code: 'MCP_AUTH_JWKS_ERROR',
+            message: 'Bearer token could not be verified with the configured JWKS.',
+            hint: message,
+            wwwAuthenticateError: 'invalid_token',
+            errorDescription: 'Bearer token could not be verified with the configured JWKS.',
+        };
+    }
+    return {
+        code: 'MCP_AUTH_TOKEN_INVALID',
+        message: 'Bearer token could not be verified.',
+        hint: message,
+        wwwAuthenticateError: 'invalid_token',
+        errorDescription: 'Bearer token could not be verified.',
+    };
+}
+
@@
     } catch (error) {
+        const failure = classifyBearerVerificationError(error);
         return {
             allowed: false,
             required: true,
             enforcement: config.enforcement,
             requiredScopes,
-            code: 'MCP_AUTH_TOKEN_INVALID',
-            message: 'Bearer token could not be verified.',
-            hint: error instanceof Error ? error.message : String(error),
+            code: failure.code,
+            message: failure.message,
+            hint: failure.hint,
             challenge: buildWwwAuthenticateChallenge(requiredScopes, config, {
-                error: 'invalid_token',
-                errorDescription: 'Bearer token could not be verified.',
+                error: failure.wwwAuthenticateError,
+                errorDescription: failure.errorDescription,
             }),
         };
     }
 }
@@
 export async function authorizeMcpToolCall(tool, context = { bearerToken: undefined }, config = readMcpAuthConfig(), env = process.env) {
     const requiredScopes = scopesForMcpTool(tool);
     const required = scopesRequireAuth(requiredScopes, config.enforcement);
+    if (!context.bearerToken && isPublicOauthDiagnosticTool(tool, env)) {
+        return {
+            allowed: true,
+            required: false,
+            enforcement: config.enforcement,
+            requiredScopes,
+            method: 'public-oauth-diagnostic',
+        };
+    }
     if (!required) {
         return {
             allowed: true,
             required: false,

```

---

## 5. Patch C — nova tool `mcp_oauth_friction_audit`

```diff
diff --git a/src/copilot/mcp/tools/oauth-friction-audit.js b/src/copilot/mcp/tools/oauth-friction-audit.js
new file mode 100644
--- /dev/null
+++ b/src/copilot/mcp/tools/oauth-friction-audit.js
@@
+// @ts-check
+/**
+ * OAuth friction audit for the ChatGPT MCP connector.
+ *
+ * @module copilot/mcp/tools/oauth-friction-audit
+ */
+
+import { readOnlyAnnotations } from '../control-plane/annotations.js';
+import {
+    buildProtectedResourceMetadata,
+    readMcpAuthConfig,
+    scopesForMcpTool,
+    securitySchemesForMcpTool,
+} from '../control-plane/auth.js';
+import { buildBuiltInDevOAuthMetadata, isBuiltInDevOAuthEnabled } from '../control-plane/dev-oauth.js';
+import { okResult } from '../control-plane/result.js';
+
+/** @type {() => import('../registry.js').McpToolDefinition[]} */
+let toolsProvider = () => [];
+
+/**
+ * @param {() => import('../registry.js').McpToolDefinition[]} provider
+ * @returns {void}
+ */
+export function bindMcpOAuthFrictionAuditProvider(provider) {
+    toolsProvider = provider;
+}
+
+/**
+ * @type {import('../registry.js').McpToolDefinition}
+ */
+export const mcpOAuthFrictionAuditTool = {
+    name: 'mcp_oauth_friction_audit',
+    title: 'MCP OAuth friction audit',
+    description:
+        'Diagnose OAuth reauthentication risk, metadata alignment, token lifetime policy, and host-approval boundaries for this MCP server.',
+    inputSchema: {},
+    annotations: readOnlyAnnotations(),
+    handler: async () => {
+        const config = readMcpAuthConfig();
+        const protectedResource = buildProtectedResourceMetadata(config);
+        const builtInIssuerEnabled = isBuiltInDevOAuthEnabled(config);
+        const issuerMetadata = builtInIssuerEnabled ? buildBuiltInDevOAuthMetadata(config) : null;
+        const tools = toolsProvider();
+        const toolScopes = summarizeToolScopes(tools);
+        const warnings = [];
+        const critical = [];
+        const protectedMethods = asStringArray(protectedResource['token_endpoint_auth_methods_supported']);
+        const issuerMethods = asStringArray(issuerMetadata?.['token_endpoint_auth_methods_supported']);
+        const issuerGrants = asStringArray(issuerMetadata?.['grant_types_supported']);
+        const resourceMatchesAudience = config.resource === config.expectedAudience;
+        const issuerMatchesResource = config.expectedIssuer === config.resource;
+        if (!resourceMatchesAudience) critical.push('Configured OAuth audience differs from protected resource.');
+        if (config.mode === 'oauth' && !config.jwksUri) critical.push('OAuth mode is enabled but JWKS URI is missing.');
+        if (issuerMetadata && protectedMethods.join('|') !== issuerMethods.join('|')) {
+            warnings.push('Protected resource metadata and issuer metadata advertise different token endpoint auth methods.');
+        }
+        if (issuerMetadata && !issuerGrants.includes('authorization_code')) {
+            critical.push('Issuer metadata does not advertise authorization_code.');
+        }
+        if (issuerMetadata && !issuerGrants.includes('refresh_token')) {
+            warnings.push('Issuer metadata does not advertise refresh_token; long access-token TTL is the fallback for lower reauth.');
+        }
+        if (!issuerMatchesResource) {
+            warnings.push('Issuer differs from resource; this is valid for external IdPs but increases audience/issuer configuration risk.');
+        }
+        return okResult({
+            success: true,
+            oauth: {
+                mode: config.mode,
+                enforcement: config.enforcement,
+                resource: config.resource,
+                expectedAudience: config.expectedAudience,
+                expectedIssuer: config.expectedIssuer,
+                protectedResourceMetadataUrl: config.protectedResourceMetadataUrl,
+                authorizationServers: [...config.authorizationServers],
+                jwksUriConfigured: Boolean(config.jwksUri),
+                initialScopes: [...config.initialScopes],
+            },
+            metadataAlignment: {
+                resourceMatchesAudience,
+                issuerMatchesResource,
+                builtInIssuerEnabled,
+                protectedResourceTokenEndpointAuthMethods: protectedMethods,
+                issuerTokenEndpointAuthMethods: issuerMethods,
+                issuerGrantTypes: issuerGrants,
+                cimdSupported: issuerMetadata?.['client_id_metadata_document_supported'] === true,
+                pkceS256Advertised: asStringArray(issuerMetadata?.['code_challenge_methods_supported']).includes('S256'),
+            },
+            tokenLifetimePolicy: {
+                accessTokenTtlSeconds:
+                    Number(process.env['COPILOT_MCP_DEV_OAUTH_ACCESS_TOKEN_TTL_SECONDS'] ?? 24 * 60 * 60) || 24 * 60 * 60,
+                refreshTokenTtlSeconds:
+                    Number(process.env['COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_TTL_SECONDS'] ?? 30 * 24 * 60 * 60) ||
+                    30 * 24 * 60 * 60,
+                note: 'Longer token lifetimes reduce OAuth reauthentication, but do not disable ChatGPT host tool-call approvals.',
+            },
+            toolScopes,
+            reauthRisk: critical.length > 0 ? 'high' : warnings.length > 0 ? 'medium' : 'low',
+            approvalImpact:
+                'OAuth reduces linking/401/reauth friction. Tool-call approvals are controlled by ChatGPT host policy and tool annotations/workflows.',
+            warnings,
+            critical,
+            recommendedFixes: buildRecommendedFixes({ warnings, critical }),
+        });
+    },
+};
+
+/**
+ * @param {import('../registry.js').McpToolDefinition[]} tools
+ * @returns {Record<string, unknown>}
+ */
+function summarizeToolScopes(tools) {
+    const rows = tools
+        .filter((tool) => tool.name !== 'mcp_oauth_friction_audit')
+        .map((tool) => ({
+            name: tool.name,
+            readOnly: tool.annotations.readOnlyHint === true,
+            destructive: tool.annotations.destructiveHint === true,
+            scopes: scopesForMcpTool(tool),
+            securitySchemes: securitySchemesForMcpTool(tool),
+        }));
+    return {
+        count: rows.length,
+        readOnlyCount: rows.filter((row) => row.readOnly).length,
+        destructiveCount: rows.filter((row) => row.destructive).length,
+        adminScopeTools: rows.filter((row) => row.scopes.includes('repo:admin')).map((row) => row.name).sort(),
+        validateScopeTools: rows.filter((row) => row.scopes.includes('repo:validate')).map((row) => row.name).sort(),
+        publicDiagnosticTools: ['mcp_oauth_friction_audit'],
+    };
+}
+
+/**
+ * @param {unknown} value
+ * @returns {string[]}
+ */
+function asStringArray(value) {
+    return Array.isArray(value) ? value.filter((item) => typeof item === 'string').map(String).sort() : [];
+}
+
+/**
+ * @param {{ warnings: string[]; critical: string[] }} input
+ * @returns {string[]}
+ */
+function buildRecommendedFixes(input) {
+    if (input.critical.length === 0 && input.warnings.length === 0) {
+        return ['Keep OAuth metadata stable and prefer read-only/plan tools for tool-call approval reduction.'];
+    }
+    return [
+        'Keep protected resource metadata, issuer metadata, audience and resource values aligned.',
+        'Prefer CIMD with PKCE S256 and a single stable resource URL.',
+        'Use long-lived access tokens and refresh_token only for this dev/permanent-tunnel workflow.',
+        'Remember that OAuth changes reduce reauth, not ChatGPT host approval prompts for write/destructive tools.',
+    ];
+}

```

---

## 6. Patch D — registrar a tool no registry

```diff
diff --git a/src/copilot/mcp/registry.js b/src/copilot/mcp/registry.js
--- a/src/copilot/mcp/registry.js
+++ b/src/copilot/mcp/registry.js
@@
 import { maintenanceTools } from './tools/maintenance.js';
 import { metaTools } from './tools/meta.js';
+import { bindMcpOAuthFrictionAuditProvider, mcpOAuthFrictionAuditTool } from './tools/oauth-friction-audit.js';
 import { projectDoctorTool } from './tools/project-doctor.js';
@@
         mcpGoldenPromptsTool,
         mcpAppsSdkReadinessTool,
         mcpHostBlockDiagnosticsTool,
+        mcpOAuthFrictionAuditTool,
         ...connectionTools,
@@
     ]);
     bindMcpToolsStatusProvider(() => tools);
+    bindMcpOAuthFrictionAuditProvider(() => tools);
     return tools;
 }

```

---

## 7. Patch E — atualizar capabilities/meta

```diff
diff --git a/src/copilot/mcp/tools/meta.js b/src/copilot/mcp/tools/meta.js
--- a/src/copilot/mcp/tools/meta.js
+++ b/src/copilot/mcp/tools/meta.js
@@
-const CAPABILITIES_VERSION = 15;
+const CAPABILITIES_VERSION = 16;
@@
     'mcp_golden_prompts',
     'mcp_apps_sdk_readiness',
     'mcp_host_block_diagnostics',
+    'mcp_oauth_friction_audit',
     'mcp_maintenance_plan',
@@
     'Use mcp_host_block_diagnostics after any ChatGPT host-side block to classify it and select a lower-friction replacement.',
+    'Use mcp_oauth_friction_audit after OAuth or connector changes to detect reauth risk and metadata drift.',
     'Use plan-only tools such as repo_patch_plan, repo_quarantine_file_plan and repo_apply_file_batch_plan before write or destructive apply tools.',

```

---

## 8. Patch F — atualizar template OAuth em `connection.js`

Este patch é opcional, mas recomendado para que `mcp_auth_profile` mostre os envs corretos para o modo 24h/30d.

```diff
diff --git a/src/copilot/mcp/tools/connection.js b/src/copilot/mcp/tools/connection.js
--- a/src/copilot/mcp/tools/connection.js
+++ b/src/copilot/mcp/tools/connection.js
@@
                 COPILOT_MCP_OAUTH_AUDIENCE: 'https://mcp.aurelin.org',
                 COPILOT_MCP_OAUTH_JWKS_URI: 'https://mcp.aurelin.org/oauth/jwks.json',
                 COPILOT_MCP_DEV_OAUTH_ENABLED: 'true',
+                COPILOT_MCP_DEV_OAUTH_ACCESS_TOKEN_TTL_SECONDS: '86400',
+                COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_TTL_SECONDS: '2592000',
+                COPILOT_MCP_PUBLIC_OAUTH_DIAGNOSTICS: 'true',
             },

```

---

## 9. Patch G — testes de registry

```diff
diff --git a/tests/unit/copilot/mcp/test_mcp_registry.spec.js b/tests/unit/copilot/mcp/test_mcp_registry.spec.js
--- a/tests/unit/copilot/mcp/test_mcp_registry.spec.js
+++ b/tests/unit/copilot/mcp/test_mcp_registry.spec.js
@@
             'mcp_maintenance_apply_safe_fixes',
             'mcp_maintenance_plan',
             'mcp_oauth_issuer_diagnostics',
+            'mcp_oauth_friction_audit',
             'mcp_run_safe_validation_suite',

```

---

## 10. Patch H — teste funcional da nova auditoria

```diff
diff --git a/tests/unit/copilot/mcp/test_mcp_tools.spec.js b/tests/unit/copilot/mcp/test_mcp_tools.spec.js
--- a/tests/unit/copilot/mcp/test_mcp_tools.spec.js
+++ b/tests/unit/copilot/mcp/test_mcp_tools.spec.js
@@
     it('mcp_auth_profile exposes OAuth readiness metadata without requiring enforcement', async () => {
         const tool = findTool('mcp_auth_profile');
         const result = await tool.handler({ scopes: ['repo:read'] });
         assert.equal(result.isError, undefined);
         assert.equal(result.structuredContent?.['success'], true);
@@
         assert.equal(typeof result.structuredContent?.['environmentTemplates'], 'object');
     });

+    it('mcp_oauth_friction_audit reports metadata alignment and approval boundaries', async () => {
+        const tool = findTool('mcp_oauth_friction_audit');
+        const result = await tool.handler({});
+        assert.equal(result.isError, undefined);
+        assert.equal(result.structuredContent?.['success'], true);
+        assert.equal(typeof result.structuredContent?.['reauthRisk'], 'string');
+        assert.equal(typeof result.structuredContent?.['approvalImpact'], 'string');
+        const metadataAlignment = /** @type {Record<string, unknown>} */ (result.structuredContent?.['metadataAlignment']);
+        assert.equal(typeof metadataAlignment['resourceMatchesAudience'], 'boolean');
+        const toolScopes = /** @type {Record<string, unknown>} */ (result.structuredContent?.['toolScopes']);
+        assert.ok(Array.isArray(toolScopes['publicDiagnosticTools']));
+    });
+
     it('mcp_oauth_issuer_diagnostics reports missing issuer without network calls', async () => {
         const tool = findTool('mcp_oauth_issuer_diagnostics');

```

---

## 11. Variáveis de ambiente recomendadas

Para o objetivo atual — máxima autonomia dev, menos reauth e menos interrupção — use:

```bash
COPILOT_MCP_AUTH_MODE=oauth
COPILOT_MCP_AUTH_ENFORCEMENT=all
COPILOT_MCP_PUBLIC_URL=https://mcp.aurelin.org/mcp
COPILOT_MCP_CLOUDFLARE_PUBLIC_URL=https://mcp.aurelin.org/mcp
COPILOT_MCP_CLOUDFLARE_MODE=named-permanent
COPILOT_MCP_OAUTH_ISSUER=https://mcp.aurelin.org
COPILOT_MCP_OAUTH_EXPECTED_ISSUER=https://mcp.aurelin.org
COPILOT_MCP_OAUTH_AUDIENCE=https://mcp.aurelin.org
COPILOT_MCP_OAUTH_JWKS_URI=https://mcp.aurelin.org/oauth/jwks.json
COPILOT_MCP_DEV_OAUTH_ENABLED=true

# Reauth reduction:
COPILOT_MCP_DEV_OAUTH_ACCESS_TOKEN_TTL_SECONDS=86400
COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_TTL_SECONDS=2592000

# Permite diagnóstico sanitizado quando o OAuth quebra:
COPILOT_MCP_PUBLIC_OAUTH_DIAGNOSTICS=true
```

---

## Validação recomendada após aplicar

Execute nesta ordem:

```bash
npm run typecheck:strict:src.copilot
npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp
```

Depois reinicie o MCP e teste no ChatGPT:

```text
1. Chame mcp_oauth_friction_audit.
2. Chame mcp_auth_profile.
3. Chame mcp_oauth_issuer_diagnostics.
4. Chame mcp_tools_status.
5. Verifique se mcp_oauth_friction_audit.reauthRisk é low ou, se medium, leia warnings.
```

Se o ChatGPT continuar exigindo aprovação por tool-call de escrita, isso não indica falha OAuth: OAuth reduz reautenticação/401/linking; aprovação de tool-call é a camada de segurança do host. Para essa camada, a redução vem de readOnlyHint, plan tools, batch e ferramentas menos destrutivas.


---

## 12. Observações de segurança

- `refresh_token` longo melhora autonomia, mas amplia janela de risco se um token vazar.
- Como este servidor é dev/permanent tunnel e repo-scoped, 24h/30d é aceitável para seu objetivo atual.
- Em produção, prefira um IdP real, refresh tokens persistidos com hash, rotação e revogação.
- Não exponha tools reais de repo como `noauth`; o patch só propõe `noauth` para `mcp_oauth_friction_audit`, que é sanitizada.
- Mantenha `resource` e `audience` como `https://mcp.aurelin.org`, sem `/mcp`.
- Mantenha o endpoint de conector como `https://mcp.aurelin.org/mcp`.

---

## 13. Resultado esperado após aplicar e reiniciar

`mcp_oauth_friction_audit` deve retornar algo próximo de:

```json
{
  "success": true,
  "metadataAlignment": {
    "resourceMatchesAudience": true,
    "issuerMatchesResource": true,
    "builtInIssuerEnabled": true,
    "cimdSupported": true,
    "pkceS256Advertised": true
  },
  "tokenLifetimePolicy": {
    "accessTokenTtlSeconds": 86400,
    "refreshTokenTtlSeconds": 2592000
  },
  "reauthRisk": "low"
}
```

`mcp_auth_profile` deve continuar mostrando:

```text
resource: https://mcp.aurelin.org
expectedAudience: https://mcp.aurelin.org
protectedResourceMetadataUrl: https://mcp.aurelin.org/.well-known/oauth-protected-resource
challenge: Bearer resource_metadata="..."
```

E o issuer deve passar em:

```text
mcp_oauth_issuer_diagnostics.ready === true
```

---

## 14. Fallback se algum patch não aplicar

1. Aplique primeiro só o Patch A.
2. Rode typecheck.
3. Se falhar por `TS6133`, confira se todos os usos de:
   - `DEFAULT_REFRESH_TOKEN_TTL_SECONDS`
   - `RENEW_GRANT`
   - `RENEW_PREFIX`
   foram adicionados.
4. Depois aplique Patch B.
5. Depois aplique C/D/E/G/H.
6. Só então aplique Patch F se o contexto em `connection.js` bater.

---

## 15. Relatório final de aplicação e revisão Codex

Data de aplicação: 2026-05-23/2026-05-24.

Revisão do plano:

1. O plano estava correto ao separar OAuth de aprovação host-side: OAuth reduz `401`, relinking e reauth; ele não
   desliga as confirmações de write/destructive tool-call do chatgpt.com.
2. A implementação anterior deixou `src/copilot/mcp/tools/oauth-friction-audit.js` inválido na prática: o arquivo
   estava gravado como uma única linha com `\n` literais, fora do padrão `// @ts-check`, sem `okResult()`, sem
   annotations canônicas e com inferências frágeis.
3. O código anterior usava nomes internos `RENEW_*` para o fluxo de refresh token. O valor de wire era
   `refresh_token`, mas a semântica estava opaca e não havia smoke end-to-end provando renovação.
4. As novas variáveis de TTL/diagnóstico estavam parcialmente fora da governança de ambiente.

Correções e upgrades aplicados:

1. `dev-oauth.js` agora usa nomes canônicos `REFRESH_TOKEN_GRANT` e `REFRESH_TOKEN_PREFIX`, anuncia
   `refresh_token` em metadata/DCR/CIMD e emite:
   - `access_token` com TTL default de 86400 segundos;
   - `refresh_token` rotativo em memória;
   - `refresh_token_expires_in` default de 2592000 segundos.
2. O refresh token passou a ser rotacionado somente após validação de `client_id`, resource e expiração, evitando
   invalidar token por tentativa inválida de outro cliente.
3. `readDevOAuthTokenLifetimePolicy()` virou helper exportado e usado pela auditoria OAuth.
4. `mcp_oauth_friction_audit` foi refeito como tool MCP real:
   - `readOnlyAnnotations()`;
   - `okResult()`;
   - leitura de protected resource metadata e issuer metadata;
   - checagem de CIMD, PKCE S256, `authorization_code`, `refresh_token`, escopos max-power, issuer/audience/resource;
   - resumo de tool scopes e fronteira OAuth versus aprovação host-side.
5. O OAuth smoke agora testa também refresh-token real para DCR e CIMD e usa token renovado para chamar
   `mcp_runtime_health`.
6. `.env.example`, `.env.local.example` e `.env.schema.json` documentam:
   - `COPILOT_MCP_DEV_OAUTH_ACCESS_TOKEN_TTL_SECONDS=86400`;
   - `COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_TTL_SECONDS=2592000`;
   - `COPILOT_MCP_PUBLIC_OAUTH_DIAGNOSTICS=true`.
7. Os testes de conexão confirmam que o issuer dev anuncia `refresh_token` e `token_endpoint_auth_methods_supported`
   como `["none"]`.

Estado operacional confirmado:

1. Protected resource metadata publica resource `https://mcp.aurelin.org`, authorization server
   `https://mcp.aurelin.org`, escopos `repo:read`, `repo:write`, `repo:validate`, `repo:admin` e
   `token_endpoint_auth_methods_supported=["none"]`.
2. Issuer metadata publica CIMD, OIDC/userinfo, JWKS, PKCE S256, DCR, `authorization_code` e `refresh_token`.
3. DCR emite token max-power e refresh token 30d.
4. CIMD emite token max-power + `openid profile email`, `id_token`, userinfo e refresh token 30d.
5. O endpoint público `https://mcp.aurelin.org/mcp` expõe 71 tools e bate com o registry local.

Validação executada:

1. `npm run typecheck:strict:src.copilot -- --pretty false`: passou.
2. `npm run lint:copilot -- --quiet`: passou.
3. `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp --reporter=dot`: passou com 91/91.
4. `npm run test:copilot:unit`: passou no rerun limpo com 3090/3090. A primeira execução completa teve um flake de
   timeout em `ConversationHub`; o teste focado passou 9/9 e o rerun completo passou.
5. `node scripts/env/audit-env-surface.mjs`: passou, com 276 envs referenciadas e 417 cobertas.
6. `node scripts/env/validate-env.js`: passou.
7. `node scripts/env/check-env-local.mjs`: passou.
8. `git diff --check`: passou.
9. `make copilot-mcp-restart`: passou, reiniciando `mcp-http` PID 71023 e `cloudflared` PID 71029.
10. `make copilot-mcp-status`: passou com `ready=true` e `authentication="OAuth"`.
11. `make copilot-mcp-smoke`: passou com 71/71 tools remotas e `permanentSmokeUpdated=true`.
12. `make copilot-mcp-oauth-smoke`: passou com DCR/CIMD max-power, refresh token, `id_token` e `/oauth/userinfo`.
13. `curl https://mcp.aurelin.org/health`: confirmou `indexAutoBuild.status="completed"`, 1002 arquivos indexados,
    5815 símbolos e 2405 imports.

Conclusão:

O plano foi aplicado e corrigido na raiz. A autonomia OAuth agora está mais forte por três vias: escopos max-power por
default, access tokens longos e refresh tokens rotativos validados em smoke público. O limite remanescente continua sendo
o mesmo da documentação e da UI do chatgpt.com: confirmações host-side de escrita/destruição não são desligáveis pelo
servidor MCP sem falsificar annotations; a mitigação legítima continua sendo batch, plan-only, suites agregadas e
remember approval quando o host oferecer.
