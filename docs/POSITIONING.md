# POSITIONING.md — source unique de vérité

**Statut : autoritatif.** Toute surface publique de Baaton dérive de ce fichier.
Si tu changes le positionnement, tu le changes **ici d'abord**, puis tu propages.
Dernière révision : 2026-08-23 (v2 — après audit produit).

> Ce fichier existe parce que le positionnement a divergé sur 4 surfaces sans que
> personne ne le remarque : `llms.txt` annonçait 93 endpoints, la home 130+, le README 133,
> le router en contenait 198. Puis un second audit a montré que la v1 de ce fichier vendait
> trois capacités que le produit n'impose pas. Un test automatisé garde maintenant les
> chiffres et les claims alignés (`frontend/src/locales/__tests__/positioning.test.ts`).

---

## 1. La phrase

> **Your agents did the work. Now prove it.**

FR : *Vos agents ont fait le travail. Maintenant, prouvez-le.*

Sous-titre : *Every agent run can be published as a receipt signed with Ed25519 — anyone
can verify it against your org's public keys, without trusting you or us.*

### Pourquoi celle-là
Le paradigme dominant du marché est « humains = scripteurs, agents = coéquipiers en plus ».
Vérifié le 23/08/2026 sur les sources publiques :

| Acteur | Ce qu'ils disent | Source |
|---|---|---|
| Linear | « The product development system for teams and agents » | `linear.app`, meta description |
| Plane | « for teams and agents » · « AI-native workspace » | `plane.so/llms.txt` |
| Shortcut | « software teams **and their AI agents** plan, build, and ship together » | `shortcut.com/llms.txt` |
| Jira | « Project Management for the AI Era » · agents Rovo assignables | atlassian.com |

**« teams and agents » est pris trois fois.** Donc « built for agents » n'est pas un
positionnement, c'est la table d'à côté.

**Ce que personne ne fait :** émettre un artefact cryptographiquement vérifiable à la fin
d'un run d'agent. C'est la seule chose que Baaton a et que les majors n'ont pas — et c'est
la seule qui soit **non réfutable**, parce que c'est de la crypto, pas du marketing.

### Le job réel en 2026
Le problème n'est plus « comment faire travailler mes agents » — Linear, Jira et Plane l'ont
couvert. C'est **« comment je prouve que ce travail a été fait »** quand tu le factures, le
reportes, ou en réponds. Un freelance qui facture du dev produit par Claude Code n'a
aujourd'hui aucun artefact vérifiable. Baaton en produit un, signé.

### Le test à appliquer à toute nouvelle formulation
Deux conditions cumulatives :
1. Si la phrase peut décrire Linear, Jira, Plane ou Shortcut → **ce n'est pas du positionnement**.
2. Si un prospect sceptique ne peut pas la **vérifier lui-même** → ce n'est pas une preuve, c'est un claim.

Recherche complète : `docs/competitive-positioning-2026-08.md`.

---

## 2. Pour qui
- Tu fais tourner plus d'un produit et plusieurs coding agents (Cursor, Claude Code, Codex, OpenClaw).
- Tu factures, reportes ou réponds d'un travail produit par tes agents.
- Ton cofondateur, client ou coéquipier n'est pas ingénieur et doit quand même lire ce qui s'est passé.

## 3. Contre qui, et pourquoi
Linear, Jira et GitHub sont construits pour une équipe d'humains qui **vit** dans l'outil,
avec des agents ajoutés par-dessus. Baaton part du principe que l'agent écrit via l'API,
et **termine chaque run par un artefact qu'un tiers peut vérifier**. Aucun d'eux ne fait ça.

Formulation autorisée du flux : *« a customer starts the ticket; the team and the agent
continue it internally »*. **Interdit** : « same thread, three readers » — l'app sépare
commentaires, TLDR et agent runs, il n'y a pas de fil unifié client-visible.

## 4. L'ordre des arguments (non négociable)
1. **La preuve** — receipt signé, vérifiable par un tiers
2. **Pour qui** — multi-projets, multi-agents, quelqu'un à qui rendre des comptes
3. **Contre qui** — personne d'autre n'émet d'artefact signé
4. **La mécanique** — API, 198 endpoints, contexte projet, TLDR → **en preuve, jamais en titre**

Ordre appliqué sur la home : hero → demo → use cases → features → compare → workflow → stats → pricing.

## 5. Preuves autorisées
Uniquement ce qui est mesurable dans le code, testé, ou vérifiable par un tiers.

| Preuve | Valeur | Où la vérifier |
|---|---|---|
| Endpoints HTTP | **198** | `grep -rhoE '\b(get\|post\|patch\|put\|delete)\(' backend/src/routes/mod.rs backend/src/main.rs \| wc -l` |
| Signature des receipts | **Ed25519 / EdDSA** | `backend/src/receipts.rs`, `cargo test --bins receipts` (4 tests) |
| JWKS public | **live, HTTP 200** | `curl https://api.baaton.dev/api/v1/public/orgs/<org_id>/jwks.json` |
| Projets sur le board de prod | **17** (snapshot 2026-08-23) | `GET /projects` |
| Issues sur le board de prod | **541** (snapshot 2026-08-23) | somme de `GET /projects/{id}/issues` |

Les chiffres de prod sont datés en tant que **snapshot**, jamais présentés comme permanents.

### Claims INTERDITS (audit du 23/08/2026)
Chacun a été vérifié dans le code et jugé faux ou non tenu :

| Claim banni | Pourquoi |
|---|---|
| « human approval gates », « nothing ships without approval » | `require_approval` est stocké dans `agent_configs` et **n'est lu par aucune route**. Les transitions restent permissives. |
| « 29 permission scopes », « give an agent exactly what it needs » | Les scopes sont validés à la création de clé puis **jamais vérifiés à l'exécution**. `AuthUser` n'a même pas de champ `permissions`, et le middleware porte `#[allow(dead_code)]` dessus. Promettre du least privilege serait faux **et** dangereux. |
| « same thread, three readers » | Pas de fil unifié client-visible ; commentaires / TLDR / agent runs sont séparés. |
| « `_hints` on every response » | 23 occurrences sur 198 endpoints. Dire « core agent endpoints » à la place. |
| « email intake » présenté comme produit fini | C'est un **endpoint webhook** qui exige un provider email en amont. |
| Toute durée (30s, 47s, p50, « sub-200ms ») | Non mesurée de façon reproductible et publiable. |
| Portail client, vote sur les demandes, changelog public | Aucune route. N'existe pas. |
| Témoignage client, logo, métrique d'usage tierce | On n'en a pas. Le dogfooding daté les remplace. |

**Note de sécurité :** ne jamais documenter publiquement que les scopes ne sont pas
enforcés. On retire le claim de least privilege, on ne publie pas la faille. Le fix est
le ticket backend #1.

## 6. Bans d'écriture
Jamais : *revolutionary*, *seamlessly*, *cutting-edge*, *holistic*, *leverage*,
*game-changer*, *delve*, *unlock the power of*. Pas d'em dash décoratif dans le copy court.

## 7. Surfaces à propager (dans cet ordre)
1. `frontend/public/llms.txt` — le blockquote est le seul texte qu'un LLM lit de façon garantie
2. `frontend/public/llms-full.txt` — même blockquote + la ligne `Scale:`
3. `frontend/src/locales/en.ts` + `fr.ts` — `landing.hero*`, `landing.compare.*`, `landing.stats.*`, `landing.demo.*`
4. `frontend/src/pages/Landing.tsx` — l'ordre des sections
5. `README.md` — le sous-titre et le compte d'endpoints
6. Content Kit Baaton dans Clozup — brand narrative, strengths, offers

**Règle de propagation :** llms.txt et le Content Kit Clozup doivent être alignés le
même jour. Une divergence de plus de 24 h est un bug, pas une dette.

## 8. Le caveat honnête sur la vérification
`receipts.rs:217` fait `serde_json::to_vec(&body)`. La variable s'appelle `canonical`
mais ce **n'est pas** de la canonicalisation JSON (RFC 8785 / JCS) : c'est l'ordre de
déclaration du struct Rust. Conséquence : un tiers qui parse le receipt puis le
re-sérialise (`json.dumps`, `JSON.stringify`) avant de vérifier verra la signature
échouer, alors que le receipt est valide.

Donc le copy dit **« verify against the exact bytes served »**, pas « verify anywhere ».
C'est vrai, c'est vérifiable, et ça évite une promesse d'interop qu'on ne tient pas encore.
Fix = ticket backend #3.

## 9. Tickets backend ouverts par cet audit (ordre de priorité)
1. **Enforcement des permissions** — ajouter `permissions` à `AuthUser` + vérification par
   route/méthode. Aujourd'hui toute clé API a de fait `admin:full`. **Faille de least
   privilege réelle, prioritaire sur le reste.**
2. **Approval bloquante** — refuser les transitions terminales quand `require_approval = true`.
   Tant que ce n'est pas fait, aucun copy ne parle d'approbation.
3. **JCS pour le receipt** — canonicalisation RFC 8785 + doc de vérification tierce
   (exemples Python et JS). Débloque « verify anywhere ».
