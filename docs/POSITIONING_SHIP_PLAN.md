# Baaton — Positioning ship plan

**Date :** 2026-08-23
**Auteur :** Haroz
**Statut :** shippé, pushé. Positionnement canonique dans `docs/POSITIONING.md`.

Ce fichier trace ce qui a été fait et pourquoi, en deux passes. La v1 corrigeait la
divergence des chiffres. La v2 corrige un problème plus grave trouvé par l'audit produit :
le copy vendait des capacités que le backend n'impose pas.

---

## Passe 1 — le memo sales, et ce que la recherche a changé

### Ce que le memo avait juste
`baaton.dev/llms.txt` disait « Project Management for AI Agents. Humans plan. Agents
execute. » Zéro occurrence de feedback, multi-projets, non-technique, Linear ou GitHub.
Vérifié. Le test proposé par le memo est bon : **si la phrase peut décrire un concurrent,
ce n'est pas du positionnement.**

### Ce que le memo ratait
Il affirmait que la home portait la même thèse, sans citer la home. Or `en.ts` contenait
déjà « One ticket. Three readers », les use cases solo/multi-projets, et une table
comparative nommée avec GitHub Issues. La reco « nommer la comparaison » était **déjà
livrée**, juste enterrée sous le hero et les features.

### Ce que la recherche concurrentielle a invalidé
Recherche sur les `llms.txt` et headlines réels de 14 produits
(`docs/competitive-positioning-2026-08.md`), sources décisives revérifiées au `curl` :

| Acteur | Ce qu'ils disent déjà | Vérifié |
|---|---|---|
| Linear | « The product development system **for teams and agents** » | `curl linear.app` |
| Plane | « for teams and agents » · « AI-native workspace » | `curl plane.so/llms.txt` |
| Shortcut | « software teams **and their AI agents** plan, build, and ship together » | `curl shortcut.com/llms.txt` |
| Jira | « Project Management for the AI Era » · agents Rovo assignables | atlassian.com |

**« teams and agents » est pris trois fois.** Donc :
- « built for agents » n'est pas un positionnement, c'est la table d'à côté ;
- mais « one board readable without being an engineer » range Baaton chez Canny et
  Productboard et lâche le discriminant technique.

Conclusion de la passe 1 : viser l'inversion des rôles (agent écrit, humain approuve).

---

## Passe 2 — l'audit produit, et pourquoi la passe 1 ne pouvait pas être pushée

L'audit a vérifié le code derrière le copy. Verdict : la phrase de la passe 1 promettait
des choses fausses. Chaque point revérifié indépendamment :

| Claim de la passe 1 | Réalité du code |
|---|---|
| « Nothing sensitive ships without a human approving it » | `require_approval` existe dans `agent_configs` et n'apparaît **que** dans `agent_config.rs` — son propre CRUD. Aucune route de transition ne le lit. |
| « 29 permission scopes, exactly what it needs » | `VALID_PERMISSIONS` est vérifié à la création de clé, jamais à l'exécution. `AuthUser` n'a **aucun** champ `permissions`, et `ApiKeyLookup` porte `#[allow(dead_code)]` dessus : le compilateur avait signalé l'inutilité, quelqu'un a fait taire le warning. Toute clé API a de fait `admin:full`. |
| « One thread, three readers » | Commentaires, TLDR et agent runs sont des surfaces séparées. Pas de fil unifié client-visible. |
| « `_hints` on every response » | 23 occurrences pour 198 endpoints. |
| « email intake » comme produit | Endpoint webhook, exige un provider email en amont. |

L'audit proposait A (copy honnête, positionnement moins fort) ou B (construire la
promesse, coût élevé).

### La réponse : ni A ni B
En vérifiant, j'ai trouvé un atout que le memo, l'audit **et** moi avions raté :
`backend/src/receipts.rs` implémente des **receipts Ed25519 réels**.

Vérifications exécutées :
- `ed25519-dalek` v2 dans `Cargo.toml`, `signing_key.sign(&canonical)` ligne 218
- `cargo test --bins receipts` → **4/4** dont `tampered_payload_fails_verification`
- clé persistée par org (table `org_signing_keys`, pas de régénération)
- `curl https://api.baaton.dev/api/v1/public/orgs/<id>/jwks.json` → **HTTP 200 en prod**
  (keyset vide tant que l'org n'a pas publié de run — la keypair est créée à la demande)
- conforme au protocole [agent-receipts](https://agentreceipts.ai)

Ça n'apparaissait nulle part dans le copy : une ligne dans `llms.txt`, un paragraphe de
README. Le hero vendait « agents write it » — que Linear peut dire demain — pendant que la
seule douve non réfutable dormait dans le repo.

**Donc : A pour l'hygiène, D pour le titre.**

> **Your agents did the work. Now prove it.**

| | Le claim | Réfutable ? |
|---|---|---|
| A | « lisible, reviewable » | Oui, subjectif |
| B | « approval gates » | Non, mais coûte des semaines |
| **D** | « signature Ed25519 vérifiable par un tiers » | **Non. C'est de la crypto.** |

En prospection, la preuve ne se démo pas : elle se vérifie. Tu envoies une URL
`r.baaton.dev/<token>` + la commande `curl`. C'est la démo.

### Le caveat trouvé en vérifiant
`receipts.rs:217` fait `serde_json::to_vec(&body)`. La variable s'appelle `canonical` mais
ce n'est **pas** RFC 8785 / JCS : c'est l'ordre de déclaration du struct. Un tiers qui
re-sérialise avant de vérifier verra la signature échouer alors que le receipt est valide.

Donc le copy dit **« verify against the exact bytes served »**, pas « verify anywhere ».
Meilleur en prospection : on donne la commande exacte au lieu d'une promesse d'interop.

---

## Les lots livrés

| # | Lot | Fichiers | Vérification | État |
|---|---|---|---|---|
| 1 | Hero + llms.txt sur la preuve signée, avec section « Verify a receipt yourself » exécutable | `llms.txt`, `llms-full.txt`, `en.ts`, `fr.ts` | `curl` les 3 commandes après deploy | ✅ |
| 2 | Retrait des claims non tenus : approval gates, 29 scopes, thread unifié, `_hints` partout, email intake « produit » | toutes surfaces | 6 tests dédiés | ✅ |
| 3 | Retrait des durées non mesurées : `60ms` ×3, table p50/p99, `Sub-200ms` | `README.md`, `en.ts`, `fr.ts` | test anti-latence | ✅ |
| 4 | Chiffres vrais et harmonisés : 198 partout (README était à 133) | `README.md`, `llms*.txt`, locales | 5 tests de comptage | ✅ |
| 5 | Dogfooding **daté** en snapshot : 17 projets / 541 issues au 2026-08-23 | `llms.txt`, locales | test de datation | ✅ |
| 6 | `docs/POSITIONING.md` v2 : phrase, claims bannis avec justification code, 3 tickets backend | `docs/POSITIONING.md` | — | ✅ |
| 7 | Garde-fou 29 tests dont 6 qui lisent le backend pour refuser un claim non enforcé | `positioning.test.ts` | `npm run test` | ✅ |
| 8 | Job avant mécanique : useCases avant features/compare | `Landing.tsx` | test d'ordre | ✅ |

### Le garde-fou est auto-désarmant
Les tests d'enforcement ne sont pas des interdictions figées. Chacun inspecte le backend :

```ts
it('does not promise approval gates while require_approval is inert', () => {
  if (approvalIsEnforced()) return; // enforcement landed: claim is allowed again
```

Quand un ticket backend est livré, le test se désactive seul et le claim redevient
autorisé. Plus un tripwire qui **casse** quand l'enforcement des permissions arrive, pour
forcer la relecture du copy à ce moment-là.

Décision assumée : **on ne documente pas publiquement que les scopes ne sont pas
enforcés.** Écrire « nos permissions sont ignorées » sur un `llms.txt` public offrirait une
clé `admin:full` à quiconque en vole une read-only. On retire le claim, on ne publie pas la
faille. Fix = ticket #1.

---

## Vérification exécutée (2026-08-23, 17h22 UTC)

- `npm run test` → **192/192** (12 fichiers), dont 29 pour le garde-fou
- `npm run build` → OK. Seuls warnings : taille de chunks, préexistants
- `cargo test --bins receipts` → **4/4**
- `curl` JWKS prod → **200**, keyset vide sur les orgs sans run publié (comportement attendu, cf. ci-dessous)
- Sabotage testé : réintroduction de « 93 total » → 2 tests cassent → restauré → vert
- Le garde-fou a attrapé pendant l'écriture : un `seamlessly` réel dans
  `docs.integrations.github.desc`, `Scopes de permission` oublié dans `fr.ts`, `60ms` ×3
  dans README, `Sub-200ms` dans `en.ts`. Corrigés, assertions **non** assouplies
- Faux positif corrigé proprement : le test scannait tout `fr.ts` et attrapait des strings
  d'UI applicative (approbation d'install GitHub) légitimes. Scope réduit aux clés
  `landing.*` avec commentaire expliquant pourquoi
- Erreurs `tsc` dans `src/components/ai/AIAssistant.tsx` : **préexistantes**, fichier non
  touché (`git diff` vide dessus)

## Comment rmzlb vérifie

```bash
cd ~/workspace/projects/baaton
git show --stat HEAD
cat docs/POSITIONING.md          # §5 claims bannis, §9 les 3 tickets
cd frontend && npm run test && npm run build

# le garde-fou casse-t-il vraiment ?
sed -i 's/198 total/93 total/' public/llms.txt
npx vitest run src/locales/__tests__/positioning.test.ts   # doit échouer
git checkout public/llms.txt
```

## Tickets backend ouverts (ordre de priorité)

1. **Enforcement des permissions** — `permissions` sur `AuthUser` + vérification par
   route. Toute clé API a aujourd'hui `admin:full` de fait. **Faille réelle, prioritaire.**
2. **Approval bloquante** — refuser les transitions terminales si `require_approval = true`.
3. **JCS pour le receipt** — RFC 8785 + doc de vérification tierce (Python, JS).

## Re-audit du 2026-08-23 18h35 UTC (après push)

rmzlb a demandé un re-audit du travail pushé. Tout revérifié à froid, un défaut trouvé.

### Ce qui tient
| Vérification | Résultat |
|---|---|
| Claims bannis sur README / llms.txt / llms-full.txt | 0 résidu |
| Claims bannis dans les clés `landing.*` EN + FR | 0 résidu |
| Claims en dur dans `Landing.tsx` hors i18n | 0 |
| Parité des clés `landing.*` EN ↔ FR | complète, 0 manquante |
| Endpoints : code vs 4 surfaces | 198 partout |
| `cargo test --bins receipts` | 4/4 |
| `npm run test` | 192/192 (12 fichiers) |
| `npm run build` | OK, warnings de chunks préexistants |
| `git status` / local vs `origin/main` | propre, synchro sur `aa0714c` |

Seule occurrence de `30s` restante : `"Users report timeout after 30s"` dans un exemple de
payload d'issue de `llms-full.txt`. C'est une description d'issue fictive, pas un claim de
performance. Conservée volontairement.

### Le défaut trouvé — et c'était le mien
Le JWILS de prod répond bien HTTP 200, mais renvoie `{"keys": []}`. Testé sur 3 orgs de
production : 200 / 0 clé. Cause lue dans le code :

- `get_or_create_org_key` crée la keypair à la demande, et n'est appelée que depuis
  `build_receipt` (`receipts.rs:168`)
- `build_jwks` est **read-only** : `SELECT ... FROM org_signing_keys`, et renvoie
  `keys: []` quand la ligne n'existe pas

Donc une org sans run publié n'a pas encore de clé. Le comportement du code est **correct**
(pas de génération de clé inutile), mais mon rapport précédent disait « JWKS live en prod »
sans cette nuance, ce qui laissait croire qu'un prospect verrait une clé en fetchant
n'importe quel JWKS. Il verrait un keyset vide et conclurait que la crypto est du théâtre.

**Corrigé :** `POSITIONING.md` §5 et §8b documentent la nuance, l'ordre de vérification
**receipt d'abord, JWKS ensuite** est verrouillé par un test, et un test vérifie que le copy
n'invite jamais à fetcher le JWKS en première étape. `llms.txt` et le README respectaient
déjà cet ordre par chance — maintenant c'est garanti.

### Ce que le re-audit ne peut pas certifier
Le rendu visuel de la landing déployée. Le build passe et les clés i18n sont vérifiées par
tests, mais je n'ai pas ouvert `baaton.dev` après deploy : l'IP du VPS est bloquée par
Cloudflare sur plusieurs domaines et le browser tool est contraint par une politique SSRF.
À vérifier à l'œil par rmzlb après le déploiement Dokploy.
