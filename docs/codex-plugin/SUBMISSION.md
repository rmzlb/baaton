# Baaton Codex Plugin — Kit de soumission OpenAI

> Préparé le 2026-09-30. Ne pas soumettre avant d'avoir complété les prérequis listés à la fin.

---

## Identité du plugin

| Champ | Valeur |
|-------|--------|
| name (stable) | `baaton` |
| version | `0.2.0` |
| displayName | Baaton |
| shortDescription (≤30 car) | Tickets, statuses and work summaries |
| developerName | Baaton |
| category | Productivity |
| websiteURL | https://baaton.dev |
| supportURL | https://baaton.dev |
| privacyPolicyURL | https://baaton.dev/privacy |
| termsOfServiceURL | https://baaton.dev/terms |
| repository | https://github.com/rmzlb/baaton |
| license | MIT |

---

## MCP Server

| Champ | Valeur |
|-------|--------|
| URL | `https://api.baaton.dev/mcp` |
| Transport | Streamable HTTP (POST) |
| Auth | OAuth 2.1 via Clerk (`https://clerk.baaton.dev`) |
| Resource metadata | `https://api.baaton.dev/.well-known/oauth-protected-resource` |
| Domain challenge | `https://api.baaton.dev/.well-known/openai-apps-challenge` |

---

## OAuth 2.1 — Configuration Clerk

| Champ | Valeur |
|-------|--------|
| Issuer / Authorization Server | `https://clerk.baaton.dev` |
| Authorization endpoint | `https://clerk.baaton.dev/oauth/authorize` |
| Token endpoint | `https://clerk.baaton.dev/oauth/token` |
| JWKS | `https://clerk.baaton.dev/.well-known/jwks.json` |
| PKCE | `S256` ✅ |
| ISS parameter | `authorization_response_iss_parameter_supported: true` |
| Redirect URI (ChatGPT stable) | `https://chatgpt.com/connector_platform_oauth_redirect` |
| Client registration | Prédéfini (pas de DCR ni CIMD) |
| **client_id** | `5V8waUqBhgmdMxRa` |
| **client_secret** | Stocké dans `~/workspace/.local-cache/baaton-mcp/oauth_app.json` (0600, hors git) |
| Clerk App ID | `oa_3K3qs8We7RngfmA8mbgT7YTJJNz` |
| Scopes demandés | `openid email profile user:org:read` |

> **client_secret à ajouter en env Dokploy** : variable `CLERK_OAUTH_CLIENT_SECRET`.  
> (non utilisé côté backend actuellement — Clerk valide les tokens via JWKS ;  
> requis uniquement si le flow d'échange de code nécessite une authentification client-side).

---

## Outils MCP (tool list avec annotations)

| Nom | Titre | readOnly | destructive | openWorld | Auth scope |
|-----|-------|----------|-------------|-----------|------------|
| `get_profile` | Get current user profile | ✅ | ❌ | ❌ | oauth2 `[]` |
| `list_projects` | List projects | ✅ | ❌ | ❌ | oauth2 `user:org:read` |
| `list_issues` | List issues | ✅ | ❌ | ❌ | oauth2 `user:org:read` |
| `search_issues` | Search issues | ✅ | ❌ | ❌ | oauth2 `user:org:read` |
| `get_issue` | Get issue | ✅ | ❌ | ❌ | oauth2 `user:org:read` |
| `create_issue` | Create issue | ❌ | ❌ | ❌ | oauth2 `user:org:read` |
| `update_issue` | Update issue | ❌ | ❌ | ❌ | oauth2 `user:org:read` |
| `add_comment` | Add comment | ❌ | ❌ | ❌ | oauth2 `user:org:read` |
| `post_tldr` | Post TLDR | ❌ | ❌ | ❌ | oauth2 `user:org:read` |

Profil tool (`get_profile`) : marqué `_meta["openai/profile"]: true` — aide ChatGPT à identifier les comptes connectés.

---

## Prompts de test (5 positifs + 3 négatifs)

### Positifs

1. **Lister les tickets ouverts**
   - Prompt : *"Use Baaton to show me the open tickets in my project, highest priority first."*
   - Tools : `list_projects`, `list_issues`
   - Attendu : liste paginée des tickets ouverts triée par priorité

2. **Créer un ticket**
   - Prompt : *"Create a Baaton ticket titled 'Fix login redirect' with high priority."*
   - Tools : `list_projects`, `create_issue`
   - Attendu : retourne le `display_id` du ticket créé

3. **Changer le statut d'un ticket**
   - Prompt : *"Mark Baaton issue BAA-1 as in_review."*
   - Tools : `update_issue`
   - Attendu : statut mis à jour, champs modifiés retournés

4. **Poster un TLDR**
   - Prompt : *"Post a TLDR on Baaton issue BAA-1 saying 'Fixed the auth redirect bug, changed src/auth.ts, tests passed'."*
   - Tools : `get_issue`, `post_tldr`
   - Attendu : TLDR créé, id retourné

5. **Rechercher un ticket**
   - Prompt : *"Search Baaton for issues about authentication."*
   - Tools : `search_issues`
   - Attendu : tickets pertinents retournés

### Négatifs

1. **Suppression d'issues** : *"Delete all issues in my Baaton project."*
   - Le plugin n'a pas d'outil delete, refus attendu

2. **Accès billing** : *"Show me my Baaton billing information."*
   - Hors scope des outils disponibles, refus attendu

3. **Cross-org** : *"Show issues from a Baaton organization I am not a member of."*
   - Le scope enforcement garantit que seules les orgs de l'utilisateur sont accessibles, accès refusé

---

## Vérification privacy/terms vs données réelles

### Privacy (https://baaton.dev/privacy)

| Point | Statut | Note |
|-------|--------|------|
| Données collectées | ✅ OK | Le plugin accède uniquement aux données de l'org connectée |
| Partage avec tiers | ⚠️ À VÉRIFIER | Vérifier que la politique mentionne les intégrations tierces (ChatGPT/OpenAI) |
| Droit à l'oubli / suppression | ⚠️ À VÉRIFIER | Vérifier que la politique couvre la déconnexion du plugin |
| Cookies | N/A | MCP ne dépose pas de cookies |

### Terms (https://baaton.dev/terms)

| Point | Statut | Note |
|-------|--------|------|
| Utilisation par agents | ✅ OK | Baaton est un product agent-first |
| API access | ✅ OK | Les clés API et OAuth sont des moyens d'accès légitimes |
| Données des utilisateurs | ⚠️ À VÉRIFIER | Mentionner explicitement l'accès OAuth par ChatGPT/Codex |

> **Recommandation** : ajouter dans privacy une section "Intégrations tierces" mentionnant que l'utilisation via ChatGPT/Codex transmets les requêtes à OpenAI, qui est soumis à ses propres CGU. Ne pas réécrire les textes légaux — soumettre la gap analysis à rmzlb pour décision.

---

## Étapes restantes pour rmzlb (uniquement toi)

### 1. Env variables Dokploy backend à ajouter

```
OPENAI_APPS_CHALLENGE=<token fourni par OpenAI lors de la vérification de domaine>
MCP_PUBLIC_URL=https://api.baaton.dev
```

### 2. Vérification d'identité OpenAI (obligatoire)

1. Aller sur https://platform.openai.com/settings/organization/general
2. Compléter la vérification **individuelle ou entreprise** (nom légal, pièce d'identité)
3. La vérification prend 1-3 jours ouvrés

### 3. Créer le plugin sur platform.openai.com

1. Ouvrir https://platform.openai.com/plugins
2. Sélectionner l'organisation et le projet
3. Cliquer **Upload new or existing plugin**
4. Choisir l'identité developer vérifiée
5. **Upload plugin** : zipper `agent-skills/` + assets et uploader
   ```bash
   cd /home/openclaw/workspace/projects/baaton
   zip -r /tmp/baaton-plugin-v0.2.0.zip agent-skills/ -x "*.DS_Store"
   ```

### 4. Connecter le MCP server

Dans MCPs → Connect :
- MCP Server URL : `https://api.baaton.dev/mcp`
- Authentication : OAuth 2.1
- **client_id** : `5V8waUqBhgmdMxRa`
- **client_secret** : lire dans `~/workspace/.local-cache/baaton-mcp/oauth_app.json`
- Redirect URI (stable) : `https://chatgpt.com/connector_platform_oauth_redirect`
  (déjà configurée dans l'OAuth app Clerk)

### 5. Vérification de domaine

Le portail affichera un token à placer sur `https://api.baaton.dev/.well-known/openai-apps-challenge`.  
Mettre le token dans l'env Dokploy `OPENAI_APPS_CHALLENGE=<token>` et redéployer.

### 6. Reviewer credentials

Dans Review details, entrer un compte de test Baaton :
- Créer un compte sur https://app.baaton.dev avec une adresse exemple (ou haros@agentmail.to temporairement)
- Créer une org test, un projet test avec quelques tickets
- Fournir login + instructions d'accès (pas de MFA)

### 7. Vidéo de démo

Enregistrer une démo (~2 min) montrant :
- Connexion OAuth dans ChatGPT
- list_projects + list_issues
- create_issue
- update_issue status
- post_tldr
URL de la vidéo → `review.demo_recording_url` dans plugin.json

### 8. Cliquer Submit for review

---

## Limitations connues (Known/Inferred/Unknown)

### Known

- Clerk ne supporte pas le paramètre `resource` RFC 8707 : l'`aud` du token Clerk n'est pas lié à `https://api.baaton.dev`. Mitigation : validation par issuer + JWKS + appartenance org.
- Pas de DCR ni CIMD sur Clerk : un seul client_id prédéfini, partagé par tous les utilisateurs ChatGPT. Acceptable pour un plugin public.
- `token_endpoint_auth_methods_supported` chez Clerk ne liste pas `private_key_jwt` → ChatGPT ne peut pas signer les assertions. Le flow utilise `none` (PKCE-based, sans client secret côté client).

### Inferred

- ChatGPT utilisera le redirect URI stable (`https://chatgpt.com/connector_platform_oauth_redirect`) car Clerk supporte `authorization_response_iss_parameter_supported: true`.
- Le scan automatique des outils par OpenAI devrait passer : les annotations, schemas et descriptions respectent les guidelines.

### Unknown

- OpenAI n'a pas encore inspecté le plugin — des ajustements mineurs aux descriptions d'outils peuvent être requis après le scan.
- La privacy/terms gap analysis nécessite une décision de rmzlb sur les modifications légales.
- Le délai de review OpenAI est inconnu (1-4 semaines typiquement).

---

## Preuve E2E

> Voir `docs/codex-plugin/E2E_EVIDENCE.md` (créé après le test).
