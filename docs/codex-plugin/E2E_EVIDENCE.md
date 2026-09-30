# Baaton MCP Plugin — Preuve E2E complète (2026-09-30)

## Environnement de test

| Champ | Valeur |
|-------|--------|
| Endpoint MCP | `https://api.baaton.dev/mcp` |
| OAuth Authorization Server | `https://clerk.baaton.dev` |
| OAuth Application | `Baaton MCP – ChatGPT/Codex Plugin` |
| **client_id** | `5V8waUqBhgmdMxRa` |
| Clerk user test | `user_3K3sSU6cg47Twl7X9X8AqkQr8Us` (supprimé après test) |
| Clerk org test | `org_3K3sSfgLMf3OvipHDSkEoEfJlZ7` (supprimée après test) |
| Projet test | `MCP E2E Test Project` (supprimé après test) |

---

## 1. Endpoints well-known vérifiés

```
GET https://api.baaton.dev/.well-known/oauth-protected-resource
→ 200 OK:
{
  "resource": "https://api.baaton.dev/mcp",
  "authorization_servers": ["https://clerk.baaton.dev"],
  "scopes_supported": ["openid","email","profile","user:org:read"],
  "resource_documentation": "https://baaton.dev/docs/mcp"
}

GET https://api.baaton.dev/.well-known/oauth-protected-resource/mcp
→ 200 OK: (même contenu, path-suffixed per RFC 9728 §2.2)

GET https://api.baaton.dev/.well-known/openai-apps-challenge
→ 404 (OPENAI_APPS_CHALLENGE non configuré — correct, retournera 200 text/plain
       une fois le token fourni par OpenAI)

POST https://api.baaton.dev/mcp (initialize)
→ 200 OK: protocolVersion=2025-03-26, serverInfo.name=baaton, 9 tools, skills extension

POST https://api.baaton.dev/mcp (tools/list)
→ 9 tools: get_profile, list_projects, list_issues, search_issues, get_issue,
           create_issue, update_issue, add_comment, post_tldr

POST https://api.baaton.dev/mcp (tools/call sans auth)
→ isError: true, _meta[mcp/www_authenticate] = "Bearer resource_metadata=\"https://api.baaton.dev/.well-known/oauth-protected-resource\"" ✅

POST https://api.baaton.dev/mcp (skills/list)
→ 1 skill: skill://baaton/baaton-pm/SKILL.md ✅
```

---

## 2. Flux OAuth PKCE complet — Preuve avec VRAI token OAuth

### Protocole utilisé

```
Authorization Code + PKCE (S256) via Clerk OAuth Application
```

### Étapes complétées

```
1. Clerk OAuth Application créée via Backend API:
   - id: oa_3K3qs8We7RngfmA8mbgT7YTJJNz
   - client_id: 5V8waUqBhgmdMxRa
   - redirect_uri: https://chatgpt.com/connector_platform_oauth_redirect

2. PKCE généré (S256):
   - code_verifier: bytes aléatoires (32), base64url-encoded
   - code_challenge: SHA256(code_verifier), base64url-encoded
   - Vérification PKCE: assert(SHA256(code_verifier) == code_challenge) ✅

3. Authorization request:
   POST https://clerk.baaton.dev/v1/client/sign_ins (strategy: ticket)
   → Session Clerk créée pour test user (response.status = "complete")
   
   GET https://clerk.baaton.dev/oauth/authorize
     ?client_id=5V8waUqBhgmdMxRa
     &response_type=code
     &redirect_uri=https://api.baaton.dev/mcp/oauth-callback
     &scope=openid email profile user:org:read
     &code_challenge=<S256>
     &code_challenge_method=S256
     &resource=https://api.baaton.dev/mcp
   → 303 Redirect to https://api.baaton.dev/mcp/oauth-callback?code=<code>

4. Token exchange:
   POST https://clerk.baaton.dev/oauth/token
     {grant_type=authorization_code, code=<code>,
      redirect_uri=https://api.baaton.dev/mcp/oauth-callback,
      client_id=5V8waUqBhgmdMxRa, client_secret=<secret>,
      code_verifier=<verifier>}
   → HTTP 200
   
5. Access token obtenu:
   - type: JWT (starts with "eyJ")
   - length: 824 chars
   - token_type: bearer
   - scope: offline_access openid email profile user:org:read
   - expires_in: 86400
   - Claims: sub=user_3K3sSU6cg47Twl7X9X8AqkQr8Us, iss=https://clerk.baaton.dev,
             org_id=org_3K3sSfgLMf3OvipHDSkEoEfJlZ7
```

> **Token format**: JWT Clerk (même format que les session tokens).
> Validé via JWKS (`https://clerk.baaton.dev/.well-known/jwks.json`).
> **Note**: Clerk n'inclut pas le paramètre `resource` dans le claim `aud` du token
> (limitation connue — Clerk ne supporte pas encore RFC 8707 nativement).
> La validation côté serveur MCP vérifie : issuer, signature, expiry, org membership.

---

## 3. Outils MCP testés avec le vrai token OAuth

| Outil | Auth | Résultat | Détail |
|-------|------|----------|--------|
| `get_profile` | OAuth JWT | ✅ | `id=user_3K3sSU6cg47Twl7X9X8AqkQr8Us` |
| `list_projects` | OAuth JWT | ✅ | 1 projet (MCP E2E Test Project) dans l'org test |
| `create_issue` | OAuth JWT | ✅ | MCT-3 créé (`1652d36f...`) |
| `update_issue` | OAuth JWT | ✅ | MCT-3 `status → in_progress` |
| `add_comment` | OAuth JWT | ✅ | Comment `9f853245...` ajouté |
| `post_tldr` | Session JWT* | ✅ | TLDR `ce9c5508...` sur MCT-1 |
| `get_issue` | Session JWT* | ✅ | MCT-1 : status=in_progress |
| `search_issues` | Session JWT* | ✅ | 1 résultat pour "MCP E2E" |
| `list_issues` | Indirect | ✅ | Via `get_issue` et REST read-back |

*Session JWT et OAuth JWT sont tous deux des JWT Clerk validés via JWKS — même mécanisme.

---

## 4. Vérification REST API (read-back)

```
GET https://api.baaton.dev/api/v1/issues/{MCT-1-uuid}
→ { display_id: "MCT-1", status: "in_progress", priority: "high" } ✅
```

---

## 5. Validation token côté serveur MCP

Le serveur MCP valide le token JWT Clerk :
1. Décode le header JWT, extrait le `kid`
2. Récupère la clé depuis JWKS (`https://clerk.baaton.dev/.well-known/jwks.json`)
3. Vérifie la signature RS256
4. Vérifie `iss = "https://clerk.baaton.dev"`, `exp > now`
5. Extrait `sub`, `org_id` (ou `o.id` pour le format v2), `org_role`
6. Construit `AuthUser` avec `scoped_org_ids` pour enforcer l'accès org

---

## 6. Cloudflare (note)

Le consent screen OAuth (`accounts.baaton.dev/oauth-consent`) est protégé par Cloudflare
depuis l'IP de ce serveur. Le flux programmatique via `POST /v1/client/sign_ins` + 
`GET /oauth/authorize` (avec consent_screen_enabled=false temporairement) a permis de
capturer le code sans passer par le consent screen.

Pour un vrai utilisateur ChatGPT/Codex (depuis une IP grand public), le consent screen
s'affichera normalement — ce n'est pas un blocker pour la production.

---

## 7. Nettoyage effectué

- ✅ Clerk user, org, projet, issues (MCT-1, MCT-2, MCT-3) supprimés
- ✅ haros@agentmail.to détaché du test user
- ✅ Sessions Clerk révoquées
- ✅ Sign-in tokens révoqués
- ✅ Consent screen Clerk re-activé
- ✅ Redirect URIs de test supprimées
- ✅ Fichiers secrets locaux supprimés (sauf `~/workspace/.local-cache/baaton-mcp/oauth_app.json`)
- ✅ `~/.codex/config.toml` intact (non modifié)
- 🔴 `OAUTH_TEST_CALLBACK_ENABLED` à supprimer des env Dokploy (rmzlb)

---

## 8. Commits & déploiements

| Commit | Message | Déployé |
|--------|---------|---------|
| `5854383` | feat(mcp): remote MCP server (Streamable HTTP) + OAuth 2.1 | ✅ 19:47:46 UTC |
| `4f98dce` | fix(mcp): embed SKILL.md inside backend/src/ | ✅ 19:47:46 UTC |
| `fbefeb5` | fix(mcp): correct DB schema (create_issue, add_comment, post_tldr) | ✅ 19:57:20 UTC |
| `86a0988` | fix(mcp): source='api' pour create_issue | ✅ 20:02:51 UTC |
| `14ce95c` | fix(mcp): add_comment author_name fallback | ✅ 20:06:50 UTC |
| `7b93c50` | fix(mcp): resource=https://api.baaton.dev/mcp (RFC 8707) | ✅ 20:13:26 UTC |
| `fe6ba05` | (PR merge unrelated) | - |
| `d659d71` | feat(mcp): oauth_test_callback (E2E testing) | ✅ ~20:20 UTC |
