# Competitive Positioning Research — Baaton
**Date**: 2026-08-23  
**Scope**: llms.txt analysis, homepage headlines, AI-agent angle, spec, impact  
**Status**: sources vérifiées sauf mentions contraires

---

## Tableau récapitulatif — llms.txt

| Produit | llms.txt existe | Blockquote présent | Angle du titre | Citation (15 premières lignes) |
|---------|----------------|-------------------|---------------|-------------------------------|
| Linear | ✅ 200 | ✅ | Feature-first + product positioning | Voir §1 |
| Plane | ✅ 200 | ✅ | Feature-list + audience-defined | Voir §1 |
| Height | ❌ fetch failed | — | — | Produit shutdown |
| Canny | ✅ 200 | ✅ | Feature-first + job outcome | Voir §1 |
| Productboard | ✅ 200 | ✅ | **Job-first** | Voir §1 |
| Huly | ❌ 404 | — | — | Non trouvé |
| Shortcut | ✅ 200 | ✅ | Audience + action (agents explicitement cités) | Voir §1 |
| tldraw | ❌ 404 | — | — | Non trouvé |
| Stripe | ✅ 200 | ❌ (prose) | Tool-first/agent-instructions | Voir §1 |
| Vercel | ✅ 200 | ✅ | What-it-does (concis) | Voir §1 |
| Cursor | ✅ 200 | ❌ (index pur) | Navigation/index | Voir §1 |
| Resend | ✅ 200 | ✅ | **Audience-first + action** | Voir §1 |
| Clerk | ✅ 200 | ✅ | **Action-first (CTA)** | Voir §1 |
| Anthropic | ✅ 200 (redirect) | ❌ (prose) | Documentation index | Voir §1 |

---

## Tâche 1 — llms.txt verbatim (15 premières lignes)

Source pour chacun : résultat direct `web_fetch`, status 200. Contenu copié verbatim.

### Linear — https://linear.app/llms.txt ✅
**Vérifié**
```
# Linear

> Linear is a purpose-built tool for planning and building products. Meet the system
> for modern software development. Streamline issues, projects, and product roadmaps.

## Documentation

Get an overview of Linear's features, integrations, and how to use them.

### Getting started

- [Start Guide](https://linear.app/docs/start-guide.md)
- [Concepts](https://linear.app/docs/conceptual-model.md)
- [Download Linear](https://linear.app/docs/get-the-app.md)

### Account
```
**Angle** : feature-first. Le blockquote décrit "quoi c'est" (outil + système), pas "pour qui/pourquoi". Présence notable d'une section `### AI` listant Linear Agent, Loops, AI Agents, MCP server.

---

### Plane — https://plane.so/llms.txt ✅
**Vérifié**
```
# Plane

> Plane is a modern project management system for fast-growing teams and enterprises.
> It combines issue tracking, planning, knowledge management, approvals, intake, and
> analytics into a single AI-native workspace.
> Available on cloud, self-hosted, and fully air-gapped environments.
> - Editions: Cloud, Self-hosted, and fully Air-gapped.
> - Audience: Mid-size and enterprise teams (20–500+ users) across regulated industries,
>   SaaS companies, and agencies.
> - Key Value: Control over deployment, simplicity in workflows, extensibility for scaling.

## Official Links
```
**Angle** : feature-list + audience explicitement nommée dans le blockquote. Assez verbeux. Mentionne "AI-native workspace" dans la définition.

---

### Height — https://height.app/llms.txt ❌
**Inféré** : fetch failed (erreur réseau). Confirmé via recherche : Height.app a annoncé sa fermeture en mars 2025, service arrêté le 24 septembre 2025. L'URL n'existe probablement plus.

---

### Canny — https://canny.io/llms.txt ✅
**Vérifié**
```
# Canny

> Canny is an AI-powered feedback management platform. With Autopilot, Canny
> automatically captures feedback from customer conversations across integrations
> like Intercom, Zendesk, app store reviews, and sales call transcripts (Zoom,
> tldv, etc.), then deduplicates and categorizes it using AI. Enrich customer
> data with metrics like monthly spend to answer questions like "which feature
> requests are associated with the most ARR?"

## Autopilot

- [Autopilot](https://canny.io/features/autopilot): AI-powered feedback management...
```
**Angle** : feature-first mais le blockquote se termine sur un outcome très concret (une question business précise). Canny n'est pas un issue tracker au sens strict — feedback management.

---

### Productboard — https://www.productboard.com/llms.txt ✅
**Vérifié**
```
# Productboard

> Productboard is the product management platform that helps product teams understand
> what customers need, prioritize the right work, and align everyone around a clear
> product strategy. Productboard Spark is an AI agent built specifically for product
> managers to accelerate discovery, spec writing, and strategic planning.

Productboard is used by product managers, product operations teams, and product
leaders at companies of all sizes to centralize customer feedback, build roadmaps,
and drive alignment across engineering, design, and go-to-market teams.

## Product

- [Productboard Platform Overview](https://www.productboard.com/product/): ...
```
**Angle** : **job-first** — "helps product teams understand what customers need, prioritize the right work". C'est la formulation la plus propre du corpus : audience + 3 jobs nommés dans l'ordre de valeur décroissante. Modèle à étudier.

---

### Huly — https://huly.io/llms.txt ❌
**Vérifié** : 404 (page retournée par le serveur : "Oops! Page not found").

---

### Shortcut — https://shortcut.com/llms.txt ✅
**Vérifié**
```
# Shortcut

> Shortcut is a fast, lightweight project management platform where software teams
> and their AI agents plan, build, and ship together — issue tracking, sprints, docs,
> and roadmaps built in. Formerly known as Clubhouse (renamed 2021).

## Product

- [Shortcut Homepage](https://www.shortcut.com/): Overview of the platform...
- [Boards](https://www.shortcut.com/product/boards/): Kanban boards...
...

## AI Agents

- [Korey](https://www.shortcut.com/korey/): Shortcut's AI agent for product
  engineering workflows — writes stories, breaks down work, and updates status
  (launched 2025).
- [Shortcut for Agents](https://www.shortcut.com/agents/): How AI agents work
  alongside human teammates inside Shortcut, including the Shortcut MCP server.
```
**Angle** : le blockquote cite explicitement "their AI agents" — c'est actuellement le seul acteur du corpus à intégrer les agents dans la définition de base du produit. Présence d'une section `## AI Agents` dédiée avec Korey + MCP server.

---

### tldraw — https://www.tldraw.com/llms.txt ❌
**Vérifié** : 404.

---

### Stripe — https://docs.stripe.com/llms.txt ✅
**Vérifié**
```
# Stripe Documentation

When installing Stripe packages, always check the npm registry for the latest version
rather than relying on memorized version numbers. Run `npm view stripe version` or
check https://www.npmjs.com/package/stripe before pinning a version. For Python,
check https://pypi.org/project/stripe/. Never hardcode an old version number from
training data — always install with `@latest` or verify the current version first.

## Docs

- [Testing](https://docs.stripe.com/testing.md): ...
- [API Reference](https://docs.stripe.com/api.md)
```
**Angle** : pas de blockquote. Stripe démarre avec des **instructions pratiques pour les agents** (ne pas halluciner les versions). Approche orientée anti-hallucination, pas marketing. Le plus pragmatique du corpus.

---

### Vercel — https://vercel.com/llms.txt ✅
**Vérifié**
```
# Vercel

> Vercel is a cloud platform for building, deploying, and scaling web applications
> and AI workloads.

Use this index to find machine-readable documentation and platform resources.
Follow the linked indexes when you need individual pages.

## Documentation

- [Vercel product documentation](https://vercel.com/docs/products.md): ...
- [Documentation sitemap](https://vercel.com/docs/sitemap.md): ...
- [Full documentation content](https://vercel.com/docs/llms-full.txt): ...
```
**Angle** : what-it-does, ultra-concis (une ligne). Instructif sur l'usage ("Use this index to find..."). Vercel propose aussi un `ai-catalog.json` agent-facing — le plus avancé techniquement du corpus.

---

### Resend — https://resend.com/llms.txt ✅
**Vérifié**
```
# Resend

> Resend is the email API for developers. Send transactional and marketing emails
> at scale with a simple, modern API.

For AI agents and automation, use the tools below.

## Command line tool
...
## MCP Server

Add Resend to Cursor, Claude, and other MCP clients.
...
## Skills
Best practices for building and sending emails with agents.
```
**Angle** : audience-first ("for developers") + action + mention directe "For AI agents and automation" après le blockquote. Structure en 3 niveaux : CLI > MCP > Skills. Le plus explicitement pensé pour l'écosystème agent.

---

### Clerk — https://clerk.com/llms.txt ✅
**Vérifié**
```
# Clerk

> Install the Clerk CLI to add auth to your app. No global install, API keys,
> or sign-in is required.

## Index and content files

- [All llms-full.txt files](https://clerk.com/llms-full.txt): Meta-index linking
  to every llms-full.txt on clerk.com
- [Documentation index](https://clerk.com/docs/llms.txt): ...
- [Dashboard index](https://dashboard.clerk.com/llms.txt): ...
```
**Angle** : le blockquote est une **instruction directe (CTA)**, pas une définition produit. Surprenant et mémorable. Clerk propose également un dashboard index séparé pour les agents. Approche la plus orientée "onboarding agent".

---

### Anthropic — https://docs.anthropic.com/llms.txt (→ platform.claude.com/llms.txt) ✅
**Vérifié**
```
# Anthropic Developer Documentation

This file provides an overview of the Anthropic API documentation and developer
resources.

## Root URL

Claude Developer Platform Console (Requires login)
https://platform.claude.com

## Available Languages on Website
...
```
**Angle** : informatif/documentation. Pas de blockquote. Mention "(Requires login)" = honnêteté sur l'accès. Grand volume (584 pages en anglais).

---

## Tâche 2 — Headlines des pages d'accueil

Sources : web_fetch sur les homepages + titres de pages HTML. Statuts 200 pour tout sauf height (fetch failed).

| Produit | Headline exacte | URL | Source | Statut vérification |
|---------|----------------|-----|--------|---------------------|
| **Linear** | "The product development system for teams and agents" | https://linear.app | web_fetch | **Vérifié** (H2 de la homepage) |
| **Plane** | "Project management and knowledge management for teams and agents" | https://plane.so | web_fetch | **Vérifié** (H2 de la homepage) |
| **Shortcut** | "The fast, enjoyable platform where your team and your AI agents plan, build, and ship together, with issue tracking, sprints, and roadmaps built in." | https://www.shortcut.com | web_fetch | **Vérifié** |
| **Canny** | "Build the features that close deals" | https://canny.io | web_fetch | **Vérifié** |
| **Productboard** | "Where 100x product makers do their best work" (titre page : "The Agentic Product Management System") | https://www.productboard.com | web_fetch | **Vérifié** |
| **Huly** | "Everything App for your teams" | https://huly.io | web_fetch | **Vérifié** |
| **Height** | Shutdown septembre 2025 | — | web_search | **Vérifié via recherche** |
| **Jira** | "Jira \| Project Management for the AI Era \| Atlassian" | https://www.atlassian.com/software/jira | web_fetch | **Vérifié** (titre HTML, page JS-only) |

**Observations :**
- "teams and agents" est une formulation déjà utilisée par **Linear** ET **Plane** dans leur headline principale (août 2026). Ce n'est plus différenciant.
- "for teams" / "for software teams" revient dans Shortcut, Jira, Huly.
- Seul Canny sort du paradigme "project management" avec une headline orientée outcome pur ("close deals").
- Productboard joue sur "100x product makers" — hyperbole aspirationnelle, pas positionnement fonctionnel.

---

## Tâche 3 — Concurrents revendiquant "agents IA écrivent dans le tracker"

### Linear — MCP server + Linear Agent
**Status : Shipped**  
- MCP server officiel lancé mai 2025 (https://mcp.linear.app/mcp). Étendu en février 2026 (initiatives, milestones, project updates).  
- Homepage : "Powered by agents — Designed for workflows shared by humans and agents. From drafting PRDs to pushing PRs."  
- Section dédiée dans le llms.txt : Linear Agent, Loops, AI Agents, MCP server, Coding sessions, Triage Intelligence.  
- Phrase clé : "The product development system for teams and agents"  
Sources : web_fetch linear.app, search usecarly.com/blog/linear-mcp, reddit.com/r/mcp/comments/1ra1zht

### Jira / Atlassian Rovo
**Status : Shipped (GA mai 2026)**  
- "Agents in Jira" GA sur tous les plans Jira Cloud Standard/Premium/Enterprise depuis mai 2026.  
- Les équipes peuvent assigner des issues directement à des agents Rovo, comme à des humains.  
- Chaque action d'agent est loguée contre l'item de travail (auditabilité).  
- Slogan Team26 : "Intelligence is the engine; context is the fuel"  
- Titre Jira : "Project Management for the AI Era"  
Sources : community.atlassian.com/forums/Jira-articles/Introducing-Agents-in-Jira, atlassian.com/software/jira

### Shortcut + Korey
**Status : Shipped (2025)**  
- Korey : AI agent pour product engineering, "writes stories, breaks down work, and updates status"  
- Page dédiée https://www.shortcut.com/agents/ sur la façon dont les agents IA travaillent aux côtés des humains dans Shortcut.  
- MCP server Shortcut disponible.  
- Phrase clé llms.txt : "software teams and their AI agents plan, build, and ship together"  
Source : web_fetch shortcut.com/llms.txt, shortcut.com homepage

### Plane AI
**Status : Shipped (avec caveats)**  
- "Agents take real assignments and do real work." (homepage)  
- MCP server natif, framework d'agents.  
- **Caveat** : critiqué publiquement pour avoir 100+ outils MCP et coût en tokens élevé.  
  Source : reddit.com/r/mcp/comments/1seo5xi/planes_issue_tracking_mcp_had_100_tools
- Phrase homepage : "AI that works because it knows your context — Plane was not retrofitted for AI, it was built around it."  
Source : web_fetch plane.so

### Height.app
**Status : Mort**  
- S'était positionné comme "autonomous project collaboration tool" avec Height 2.0.  
- Shutdown annoncé mars 2025, fin de service 24 septembre 2025.  
- Ce positionnement "autonomous" n'a pas suffi à sauver le produit.  
Source : creativerly.com/height-app-is-shutting-down, shortcut.com/blog/alternatives-to-height-app

### Nouveaux entrants purement agent-natifs (niche, non VC-backed à grande échelle)
**Status : Niche/nouveau**  
- **Graph** : "MCP server built for agents instead of humans" — persistent task graph, multi-agent handoff, evidence + audit trail. Positionné explicitement comme "issue tracker built for agents" vs "issue tracker adapté aux agents".  
- **Swimlanes** : "agent-native persistent task graph" — lancé juillet 2026, bypass des contraintes human-centric de Jira/Linear.  
- **Lific** : "MCP native issue tracker" — schéma MCP réduit, focus sur essentiels agents.  
Sources : reddit.com/r/mcp/comments/1ra1zht, lobehub.com/mcp/andburman-swimlanes, search web

### GitHub Issues + Copilot agents
**Inféré** (non vérifié directement depuis la page GitHub) : Le GitHub MCP server officiel inclut des outils de gestion d'issues. Copilot agents peuvent interagir avec les issues via MCP. Pas de slogan dédié "issue tracker for agents" trouvé — reste dans l'angle "code + agents" plutôt que "project management + agents".

### Devin + Linear
**Inféré** : Des posts de blog et d'utilisateurs documentent l'usage de Devin avec Linear via MCP (source: reddit.com/r/mcp, aq.dev). C'est une intégration tierce, pas un positionnement produit de Devin ou Linear.

### Verdict tâche 3 : "built for agents" encombré ou libre ?

**Encombré à mi-encombré.**

Le territoire "teams + agents" est **déjà occupé** par Linear, Plane, Shortcut — tous avec des pages produit, MCP servers actifs, et headlines principales. En revanche :

1. Aucun des majors ne revendique **"les agents comme client primaire"** — ils positionnent tous les agents comme *membres additionnels* de l'équipe humaine.
2. Les purs "agent-native" (Graph, Swimlanes, Lific) sont très petits, sans distribution, sans SEO.
3. L'angle **"readable without being an engineer"** (lisible par un humain non-ingénieur) n'est revendiqué par personne — ni les majors ni les agent-natifs.
4. L'angle **"API-first project board"** avec des humains comme *auditeurs* plutôt que *utilisateurs primaires* est libre.

---

## Tâche 4 — Spécification llms.txt (llmstxt.org)

**Source vérifiée** : https://llmstxt.org (web_fetch, status 200, 2026-08-23)

### Structure recommandée (v2, 2026)

1. **H1** — Nom du site/produit (`# Nom`)
2. **Blockquote `>`** — Description courte : contexte, audience, valeur clé. Doit être suffisant pour contextualiser sans lire la suite.
3. **Sections `##`** — Catégories de contenu (Documentation, API, Use Cases, etc.)
4. **Liens markdown** — Chaque lien pointe vers une page `.md` ou `.html.md` (version markdown de la page, pas le HTML)
5. **Optionnel** : `rel="alternate" type="text/markdown"` dans les `<link>` HTML pour que les agents trouvent les .md, `rel="describedby"` pour pointer vers le llms.txt couvrant cette page.

### Rôle du blockquote
Le blockquote est le **seul contexte garanti lu** si l'agent ne lit que la tête du fichier. Il doit répondre à : "qu'est-ce que c'est, pour qui, pourquoi c'est utile." C'est l'équivalent d'un résumé de 3 lignes pour un LLM qui indexe le produit.

### Ce qui doit y être
- Définition fonctionnelle du produit
- Audience principale
- Valeur différenciante ou contrainte clé (ex: air-gapped, open-source, API-first)

### Ce qui ne doit PAS y être
- Contenu marketing creux ("revolutionary", "seamlessly")
- Détails d'implémentation (ça va dans les sections liées)
- Listes d'intégrations (trop volatile, à mettre dans des sous-pages)

### Adoption (2026)
- Des milliers de sites publient un llms.txt (source llmstxt.org)
- Mintlify génère automatiquement un llms.txt pour les docs
- Chrome Lighthouse audite la présence du llms.txt dans ses checks "agentic browsing"
- OpenAI, Anthropic, Google (Gemini) publient tous leur llms.txt sur leurs docs développeurs

---

## Tâche 5 — Impact réel du llms.txt sur les descriptions produit par ChatGPT/Perplexity

**Honnêteté : peu de données solides.**

### Ce qui est connu (Vérifié)
- Des milliers de sites publient un llms.txt — adoption côté producteurs confirmée (source: llmstxt.org)
- Chrome Lighthouse inclut un audit pour llms.txt dans ses "agentic browsing checks" — signal que Google considère le signal (source: llmstxt.org citant developer.chrome.com/docs/lighthouse/agentic-browsing/llms-txt)
- Perplexity opère un crawler ("PerplexityBot") qui crawle les pages web en temps réel (source: recherche Gemini via frugaltesting.com, brightdata.com)

### Ce qui est inféré mais non prouvé
- Que Perplexity ou ChatGPT lisent spécifiquement les llms.txt pour modifier leurs descriptions de produits
- Qu'il existe un lien causal mesuré entre "publier un llms.txt" et "être mieux décrit dans les réponses AI"

### Ce qui est inconnu / absent de la littérature
- Aucune étude A/B ou corrélation publiée documentant l'impact avant/après du llms.txt sur la façon dont un produit est décrit par un LLM de recherche (ChatGPT Browsing, Perplexity, Claude avec search).
- La recherche effectuée a retourné des résultats sur "LLMs impactant le SEO et le crawl" en général, pas sur le protocole llms.txt spécifiquement.
- Pas de publication officielle d'Anthropic, OpenAI ou Google indiquant qu'ils indexent systématiquement les llms.txt de tiers lors de leurs réponses.

### Conclusion honnête
L'adoption est réelle (signal d'intention des producteurs). L'impact sur les outputs d'AI search est plausible mais **non documenté de façon rigoureuse** à ce jour. Le meilleur argument pour publier un llms.txt reste : (1) Lighthouse le vérifie, (2) les coding agents (Cursor, Claude Code, Copilot) qui crawlent des docs l'utilisent effectivement pour naviguer, (3) l'écosystème MCP / agent-skills référence ce pattern.

---

## Verdict (10 lignes max)

**L'angle "One board across your projects, readable without being an engineer" est partiellement différenciant, mais fragile.**

Ce qui est libre : la lisibilité par des non-ingénieurs, et l'idée d'un board qui sert autant de source de vérité humaine que d'interface pour agents. Aucun acteur majeur ne revendique explicitement "readable by non-engineers" ou "humans as auditors, agents as writers."

Ce qui est pris : "teams and agents" (Linear, Plane, Shortcut — tous les trois sur leurs homepages). "AI-native" (Plane). "Built for agents" émerge chez des niche-players (Graph, Swimlanes).

**Formulation moins copiable au vu de ce corpus** :

> *"The project board your agents write in and your team actually reads."*

Ou plus court :

> *"Issue tracking built for agents. Readable for everyone else."*

Rationale : l'inversion (agents = scripteurs, humains = lecteurs) est l'exact inverse du paradigme dominant (humains = scripteurs, agents = assistants). Aucun acteur du corpus ne l'a formulé ainsi. C'est précis, testable, et incopyable sans changer de positionnement fondamental.

---

*Sources primaires : web_fetch direct sur chaque URL listée, web_search Gemini pour les données contextuelles. Toutes les citations de headlines et llms.txt proviennent de pages lues directement. Les assertions sur les niche-players (Graph, Swimlanes, Lific) proviennent de résultats de recherche, non de pages directement fetchées — statut : Inféré.*
