# Baaton Codex Plugin — Plan de développement

## Statut global : 🟡 Déploiement en cours

---

## Étape 1 : Package plugin de base ✅ DONE (commit 74541e8)
- `agent-skills/plugin.json` avec `extensions.com.openai.interface`
- Skill `agent-skills/skills/baaton-pm/`
- `.agents/plugins/marketplace.json` mis à jour
- Validé avec codex-cli 0.159.2

---

## Étape 2 : MCP remote + OAuth 2.1 🟡 EN COURS

### 2.1 Recherche Clerk OAuth ✅
- Clerk OIDC discovery : `https://clerk.baaton.dev/.well-known/openid-configuration`
- `code_challenge_methods_supported: ["S256"]` ✅ PKCE
- `authorization_response_iss_parameter_supported: true` ✅ ISS param → redirect URI stable ChatGPT
- `client_id_metadata_document_supported: null` → pas de CIMD
- `registration_endpoint: null` → pas de DCR
- **Décision : client OAuth prédéfini** (Clerk OAuth Application via Backend API)

### 2.2 Clerk OAuth Application ✅
- App id : `oa_3K3qs8We7RngfmA8mbgT7YTJJNz`
- client_id : `5V8waUqBhgmdMxRa`
- Redirect URI : `https://chatgpt.com/connector_platform_oauth_redirect`
- Scopes : `openid email profile user:org:read`
- client_secret stocké dans `~/workspace/.local-cache/baaton-mcp/oauth_app.json` (0600, hors git)

### 2.3 Serveur MCP Rust ✅ (code écrit)
- Fichier : `backend/src/routes/mcp.rs`
- Route : `POST /mcp` — montée hors auth_middleware
- Outils : `get_profile`, `list_projects`, `list_issues`, `search_issues`, `get_issue`,
  `create_issue`, `update_issue`, `add_comment`, `post_tldr`
- Auth : Clerk JWT OU baa_ API key (validé inline)
- Sans auth → `_meta["mcp/www_authenticate"]` sur les tool calls
- Skills extension : `skills/list`, `skills/get`, `resources/read` avec SKILL.md embarqué

### 2.4 Endpoints well-known ✅ (code écrit)
- `GET /.well-known/oauth-protected-resource` → JSON resource server metadata
- `GET /.well-known/openai-apps-challenge` → token plain-text depuis env `OPENAI_APPS_CHALLENGE`

### 2.5 Package plugin mis à jour ✅
- `agent-skills/mcp.json` — streamable-http url `https://api.baaton.dev/mcp`
- `agent-skills/plugin.json` — version 0.2.0, supportURL ajouté, test cases
- Skill mise à jour pour mentionner MCP

### 2.6 Tests locaux 🟡 EN COURS
- `cargo test --bins`

### 2.7 Déploiement 🔴 À FAIRE
- Push sur main → Dokploy auto-déploie (~4-10 min)
- Vérifier avec `GET https://api.baaton.dev/mcp` (doit retourner 405 — POST only)
- Vérifier `GET https://api.baaton.dev/.well-known/oauth-protected-resource`

### 2.8 E2E OAuth + outils 🔴 À FAIRE
- Créer tenant de test Clerk
- Tester le flux OAuth avec MCP Inspector ou codex mcp add
- Appeler chaque outil : list_projects, create_issue, update_issue, add_comment, post_tldr
- Nettoyer tenant, données de test, fichiers secrets

---

## Limitations connues

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| Clerk ne supporte pas le paramètre `resource` (RFC 8707) — `aud` ne contient pas l'URL MCP | Le token Clerk peut techniquement servir d'autres ressources Clerk | Validation par issuer + signature + membership org ; tokens short-lived (1h) |
| Pas de DCR ni CIMD → client_id prédéfini | Un seul client_id pour tous les utilisateurs ChatGPT | Acceptable pour un plugin public ; client_secret sécurisé côté Clerk |
| Clerk `token_endpoint_auth_methods_supported` ne liste pas `private_key_jwt` → ChatGPT ne peut pas utiliser CIMD | Doit utiliser client prédéfini avec `client_secret_post` ou `none` | Documenté dans SUBMISSION.md |

---

## Ce qui reste pour rmzlb

1. **Ajouter `OPENAI_APPS_CHALLENGE` dans les env Dokploy** du backend (valeur fournie par OpenAI lors de la soumission)
2. **Ajouter `CLERK_OAUTH_CLIENT_SECRET` dans les env Dokploy** (client_secret de l'OAuth app, en sécurité dans `~/workspace/.local-cache/baaton-mcp/oauth_app.json`)
3. **Vérification d'identité OpenAI** (individuelle ou entreprise) sur platform.openai.com
4. **Upload du plugin ZIP** sur platform.openai.com/plugins
5. **Compléter les détails de review** (credentials de test, vidéo de démo)
6. **Soumettre pour review**
