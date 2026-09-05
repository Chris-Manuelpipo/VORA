# VORA — 48 h de hackathon : périmètre, plan horaire et prompts Claude Code

**Début** samedi 5 septembre 2026, **10 h 00** (le manuel officiel dit 10 h, l'e-mail de lancement disait 9 h — vérifiez auprès des organisateurs et alignez-vous sur le plus tôt) · **Fin** lundi 7 septembre, 10 h 00.

Ce document ne remplace pas le dossier technique : il en extrait ce qui tient en 48 h et le traduit en prompts pour Claude Code. Tout ce qui est coupé ici reste dans le dossier et devient votre réponse quand le jury demande « et après ? ».

---

## 0. Conformité au manuel officiel NuxCine

Trois exigences du manuel ne sont pas couvertes par notre travail actuel. Elles sont traitées dans ce document.

| Exigence du manuel | Où on en est | Ce qu'on fait |
|---|---|---|
| **Figma obligatoire** (§ 12 et livrable § 24.5) | Nos 90 écrans sont en HTML, pas en Figma. Un livrable obligatoire manque. | Piste Figma dédiée dès H+1, voir § 3 bis |
| **Manuel de démarrage** en livrable séparé (§ 18, § 24.4) | Prévu dans le README seulement | Fichier `MANUEL_DEMARRAGE.md` distinct, prompt P10 |
| **README à 20 sections imposées** (§ 19) | Notre README était libre | Structure imposée reprise dans le prompt P10 |

Deux exigences demandent une vigilance particulière :

- **Contributions GitHub évaluées par membre** (§ 16, critère « Travail d'équipe »). Une seule personne qui pousse tout le code depuis Claude Code est un signal négatif. Voir § 3 ter.
- **Sécurité comme critère à part entière** (§ 10 et § 25). Mots de passe hachés, rôles séparés, validation des entrées, aucun secret dans le dépôt, gestion des erreurs. Le prompt P9 a été étendu.

Ce que le manuel **n'exige pas** et qu'on garde coupé sans remords : le dashboard admin complet (« recommandé », pas obligatoire — on livre une page unique), le paiement réel (« un paiement simulé est parfaitement acceptable »), tous les écrans listés au § 12.2 (« vous n'êtes pas obligés de développer tous les écrans »).

---

## 1. Tri de périmètre : ce qu'on construit, ce qu'on simule, ce qu'on coupe

La règle : **rien ne rentre dans le code s'il n'apparaît pas dans la démo de 5 minutes**.

| On construit pour de vrai (ça passe à l'écran) | Pourquoi |
|---|---|
| Inscription téléphone ou e-mail + code (code affiché en console/écran en mode démo) | Exigence du défi |
| Recherche par **repères** (« carrefour », « en face de la pharmacie ») | Innovation + réalité camerounaise, votre meilleur argument |
| Carte interactive, position, point de rendez-vous déplaçable | Exigence |
| Itinéraire calculé + **prix ferme décomposé** avant commande | Exigence + différenciation |
| Commande, dispatch vers un chauffeur, suivi temps réel | Exigence, cœur de la démo |
| **Géorepérage moto** : offre Moto refusée si l'itinéraire touche le centre urbain | Innovation + légalité, personne d'autre n'y pensera |
| Code de montée à 4 chiffres | Sécurité, très visuel |
| SOS + partage de trajet (lien web qui suit la course en direct) | Sécurité, effet démo garanti |
| Appli chauffeur : en ligne, demande 15 s avec **net affiché**, approche, code, course, fin | La moitié du sujet, souvent oubliée par les autres équipes |
| Paiement espèces confirmé + MoMo **simulé** avec écran d'attente | Réalité locale, sans dépendre d'une API |
| Assistance vocale de l'annonce d'arrivée (TTS local) | Innovation « annonces vocales », coût quasi nul |

| On simule (assumé, expliqué au jury) | Comment |
|---|---|
| Mobile Money | Écran de demande de paiement + confirmation simulée, adaptateur prêt pour la vraie API |
| Vérification des pièces chauffeur | Un écran d'upload + statut, validation par un bouton ops |
| Flotte de chauffeurs | **Simulateur de chauffeurs virtuels** qui roulent sur la carte (indispensable : sans lui, la carte est vide devant le jury) |

| On coupe | À dire au jury si on le demande |
|---|---|
| Appels VORA (WebRTC), messagerie libre | « Conçu, chiffré, planifié en v1 ; en 48 h on a gardé les messages prédéfinis » |
| Ledger en double entrée, retraits MoMo | « Modélisé dans le dossier technique, hors périmètre démo » |
| Back-office complet | Une seule page ops : carte live + validation de dossier + bouton pluie |
| Dossier KYC en 5 étapes, litiges, gains détaillés, mode nuit | Maquettes à l'appui, pas de code |
| Offline complet, tests de charge, i18n EN | Le FR suffit ; l'EN est dans les maquettes |

---

## 2. Plan horaire

| Heure | Qui | Quoi |
|---|---|---|
| **H+0 → H+1** | Toute l'équipe | Lire ce document ensemble, valider le périmètre, distribuer les rôles, créer le dépôt et les branches, coller le prompt **P0** |
| **H+1 → H+5** | Back | P1 (socle + auth), P2 (géo, repères, zones) |
| **H+1 → H+5** | Mobile | P4 (thème + navigation depuis la charte) |
| **H+1 → H+10** | **Design** | **Piste Figma** (§ 3 bis) : import, design system, 14 écrans, prototype cliquable, user flow |
| **H+5 → H+11** | Back | P3 (prix, courses, dispatch, temps réel) |
| **H+5 → H+12** | Mobile | P5 (boucle passager) |
| **H+12 → H+16** | Tous | **Première course de bout en bout** entre deux téléphones. Objectif non négociable de la fin du samedi. |
| **H+16 → H+22** | — | Repos par roulement (au moins 4 h chacun ; une équipe qui ne dort pas rate sa démo) |
| **H+22 → H+30** | Mobile | P6 (appli chauffeur complète) |
| **H+22 → H+30** | Back | P7 (simulateur de chauffeurs + données de démo) |
| **H+30 → H+34** | Back / web | **P6b** (page d'administration unique) |
| **H+30 → H+36** | Tous | P8 (les quatre briques d'innovation) |
| **H+36 → H+40** | Tous | P9 (durcissement démo : mode démo, écrans d'erreur, pas de plantage) |
| **H+40 → H+44** | Tous | **Gel du code.** Répétition de la démo 3 fois, chronométrée. P10 (README 20 sections, manuel de démarrage, pitch, captures). Vérification de la checklist § 6 |
| **H+44 → H+48** | Tous | Corrections cosmétiques uniquement, sommeil, présentation |

**Règle du gel** : à H+40, plus une seule fonctionnalité. Les équipes qui perdent un hackathon sont celles qui codent encore à H+47.

---

## 3. Avant de coller le premier prompt

1. Créez le dépôt et copiez-y vos documents :
   ```
   vora/
   └─ docs/
      ├─ VORA_brief_produit_MVP.md
      ├─ VORA_vision_UX_parcours_ecrans.md
      ├─ VORA_cahier_des_charges_technique.md
      ├─ VORA_document_de_conception.md
      ├─ VORA_charte_graphique.html
      ├─ vora_theme.dart
      ├─ VORA_maquettes_lot1_passager.html
      ├─ VORA_maquettes_lot2_chauffeur.html
      ├─ VORA_maquettes_lot3_onboarding.html
      └─ VORA_cycle_de_vie_course.mermaid
   ```
2. Lancez `claude` **à la racine de `vora/`**, pas ailleurs.
3. Une règle d'équipe : **personne ne fusionne du code qu'il ne sait pas expliquer**. Le règlement l'exige, et le jury posera la question. Après chaque prompt, demandez à Claude Code : « explique-moi en 10 lignes ce que tu viens d'écrire et les 3 décisions que tu as prises ».

---

## 3 bis. La piste Figma (livrable obligatoire)

Le manuel exige un fichier Figma qui montre l'identité visuelle, les couleurs, la typographie, les composants, les écrans, le parcours et les interactions. Nous avons déjà tout ce contenu, mais dans le mauvais format. Le travail est donc une **transposition**, pas une création : c'est jouable en une journée par une personne.

**Voie rapide (recommandée)** — plugin `html.to.design` dans Figma :
1. Ouvrez `docs/VORA_charte_graphique.html` et les fichiers de maquettes dans un navigateur, ou déposez-les sur un hébergement statique temporaire (GitHub Pages en deux minutes depuis votre dépôt).
2. Dans Figma, plugin **html.to.design** → importez l'URL → vous obtenez des calques éditables.
3. Nettoyez : c'est l'étape qui compte, un import brut n'impressionne personne.

**Ce que le fichier Figma doit contenir, dans cet ordre de pages :**

| Page Figma | Contenu | Temps |
|---|---|---|
| `01 · Identité` | Logo V-repère et ses déclinaisons, zone de protection, ce qu'on ne fait pas | 30 min |
| `02 · Design system` | **Styles de couleur** (Bleu VORA, Bleu nuit, Jaune taxi, neutres, sémantiques) et **styles de texte** (Sora / IBM Plex Sans, l'échelle de la charte) créés comme vrais styles Figma, pas comme des rectangles. **Composants** avec variantes : bouton (5 variantes × 3 états), champ, puce d'offre, badge, carte chauffeur, code de montée, feuille | 2 h |
| `03 · Passager` | 10 écrans : accueil, recherche, point de rendez-vous, prix, recherche chauffeur, approche, en course, paiement, notation, SOS | 2 h |
| `04 · Chauffeur` | 5 écrans : en ligne, demande de course, approche, code, net gagné | 1 h |
| `05 · Admin` | 1 écran : tableau de bord ops | 20 min |
| `06 · User Flow` | Le parcours en blocs reliés (reprenez le schéma du manuel § 13, enrichi de nos états : aucun chauffeur, annulation, moto hors zone) | 40 min |
| `07 · Prototype` | Liens cliquables sur le parcours passager complet, mode présentation | 40 min |

**Réglage de partage** : « Toute personne disposant du lien peut consulter ». Le lien va dans le README, section 19. Un fichier Figma privé équivaut à un livrable manquant.

**Si le plugin ne fonctionne pas** : ouvrez les maquettes HTML en plein écran, capturez chaque écran, importez les images dans Figma et redessinez par-dessus les 15 écrans clés. C'est 5 h de travail au lieu de 8, et le rendu reste propre car les proportions sont justes.

**Attention à la cohérence** : le jury comparera le Figma et l'application. Si l'appli affiche « Commander · 1 625 F » et le Figma « Réserver », vous perdez sur le critère UI/UX. Le Figma est la référence, l'appli doit s'y conformer, et inversement pour toute correction faite en cours de route.

---

## 3 ter. Git : rendre visible le travail de chacun

Le manuel dit explicitement que les commits et les contributions serviront à apprécier le travail réel de l'équipe. Une seule personne qui pousse 200 commits générés par Claude Code se verra poser des questions désagréables.

**Organisation :**
```
main                    ← seulement des fusions, protégée
develop                 ← intégration continue de l'équipe
feature/auth            ← membre back
feature/geo-reperes     ← membre back
feature/booking         ← membre mobile
feature/driver-app      ← membre mobile
feature/admin           ← membre web
feature/innovation      ← membre innovation
docs/figma              ← designer
```

**La règle honnête et défendable** : celui qui **relit, teste et intègre** un morceau de code est celui qui le commite, sous son propre compte, avec un message clair. C'est légitime, parce que le manuel exige que chaque membre comprenne ce qu'il livre. Ne fabriquez pas de faux commits, mais ne laissez pas non plus une seule personne signer tout le projet.

**Rythme** : chacun pousse au moins toutes les 2 heures, même un travail incomplet, sur sa branche. Intégration sur `develop` toutes les 4 heures, jamais tout à la fin — le manuel liste d'ailleurs « attendre les dernières heures pour intégrer » parmi les erreurs à éviter (§ 23).

**Messages de commit** au format du manuel : `feat: add repere search`, `fix: correct fare rounding`, `docs: add startup manual`.

---

## 4. Les prompts

Collez-les dans l'ordre. Attendez la fin de chacun, relisez, testez, puis passez au suivant.

---

### P0 · Amorçage et mémoire du projet

```
Tu es l'ingénieur principal d'une équipe de 3 personnes sur un hackathon de 48 h.
Le projet s'appelle VORA : application de VTC et de motos-taxis pour Yaoundé, Cameroun.

Commence par lire, dans cet ordre, ces fichiers du dossier docs/ :
1. VORA_brief_produit_MVP.md (le produit et les règles métier chiffrées)
2. VORA_vision_UX_parcours_ecrans.md (parcours et inventaire d'écrans)
3. VORA_document_de_conception.md (architecture cible, sections 3 à 8)
4. VORA_charte_graphique.html (jetons de design) et vora_theme.dart

Puis écris un fichier CLAUDE.md à la racine qui servira de mémoire au projet, contenant :
- le pitch en 3 lignes et les 3 moments de vérité du produit ;
- la stack RETENUE POUR LE HACKATHON (justifie chaque écart avec le document de conception,
  qui vise la production ; ici on optimise le temps de développement et la fiabilité de la démo) :
  * backend : Node 20 + TypeScript + Fastify + Socket.IO + PostgreSQL 16 avec PostGIS (Docker Compose)
  * ORM : Drizzle, migrations versionnées
  * positions des chauffeurs : en mémoire dans le processus (une Map), PAS de Redis
  * routage et distances : OSRM public (router.project-osrm.org), repli haversine × 1,35 si indisponible
  * cartes : flutter_map + tuiles OSM
  * mobile : Flutter, deux applis (passager, chauffeur) dans un monorepo avec un package partagé
  * paiement Mobile Money : adaptateur simulé derrière une interface, aucune API réelle
- les règles métier NON NÉGOCIABLES à respecter partout, reprises du brief :
  prix ferme figé à la commande ; commission 15 % voiture / 50 F fixe moto ; retenue DGI 1 % ;
  annulation gratuite 2 min ou < 300 m puis 300 F (100 F moto) reversés au chauffeur ;
  offre 15 s par chauffeur, 3 vagues maximum ; code de montée à 4 chiffres obligatoire ;
  aucune course moto dont le départ, l'arrivée ou l'itinéraire touche une zone interdite ;
  numéros de téléphone jamais exposés à l'autre partie, identification par ID VORA à 8 chiffres ;
- les couleurs et la typographie de la charte (valeurs exactes) ;
- l'arborescence du monorepo ;
- une section « périmètre hackathon » listant ce qui est simulé et ce qui est coupé.

Ensuite, crée le squelette du monorepo (dossiers, package.json, docker-compose.yml, .env.example,
README court) SANS écrire encore de logique métier. Termine en me montrant l'arborescence
et en m'expliquant en 10 lignes tes choix.
```

---

### P1 · Socle backend et authentification

```
Implémente le socle de services/api.

1. Docker Compose : postgres:16 avec postgis, volume persistant, port 5432.
2. Fastify + TypeScript, structure par modules (identity, geo, pricing, rides, dispatch, payments),
   chaque module avec routes / service / repository. Validation par zod. Erreurs au format
   { code, message, details } avec un code métier stable (ex. MOTO_ZONE_FORBIDDEN).
3. Drizzle : schéma et migration initiale pour users, devices, landmarks, zones, tariffs,
   quotes, rides, ride_events, dispatch_offers, driver_profiles, vehicles.
   Utilise le type geography(Point,4326) et geography(Polygon,4326) de PostGIS.
   Reprends les colonnes du document de conception § 5.2 en les simplifiant : pas de chiffrement
   par colonne (hors périmètre hackathon), mais téléphone et e-mail ne doivent JAMAIS sortir
   dans une réponse destinée à un autre utilisateur — écris des DTO de sortie explicites.
4. Module identity :
   POST /v1/auth/otp/request  { channel: 'phone'|'email', value }  -> crée un code à 6 chiffres
   POST /v1/auth/otp/verify   { value, code, role }                -> crée le compte au besoin,
        génère un ID VORA à 8 chiffres unique, renvoie access token (JWT 24 h) + profil
   GET  /v1/me  et PATCH /v1/me
   MODE DÉMO : si DEMO_MODE=true, le code est toujours 123456 et il est aussi renvoyé dans la
   réponse ; affiche-le en clair dans les logs. On ne branchera pas de SMS.
5. Un script npm run seed qui crée : 1 passager (Aïcha), 3 chauffeurs voiture, 2 chauffeurs moto,
   avec véhicules et plaques camerounaises réalistes.

Écris des tests unitaires sur la génération d'ID VORA (unicité) et sur la vérification du code.
Termine par la commande exacte pour lancer l'API et un exemple curl de bout en bout.
```

---

### P2 · Géo : repères, zones, routage

```
Implémente le module geo. C'est notre principal argument d'innovation : à Yaoundé on ne
donne pas une adresse, on donne un repère.

1. Table landmarks (nom, aliases text[], catégorie, quartier, geom, popularité).
   Écris un fichier de données seed avec AU MOINS 60 repères réels de Yaoundé, avec des
   coordonnées plausibles : carrefours (Ngoa-Ekellé, Bastos, Warda, Elig-Essono, Nlongkak,
   Mvan, Emana, Etoudi, Acacias...), marchés (Mokolo, Mfoundi, Biyem-Assi, Essos),
   universités et écoles (Université de Yaoundé I, ENSP, ENSET), hôpitaux, stades, ministères,
   quartiers (Bastos, Melen, Obili, Mvog-Ada, Nkolbisson, Odza, Nsam, Mimboman).
   Sois honnête : mets un commentaire indiquant que les coordonnées sont approximatives et
   devront être corrigées sur le terrain.
2. GET /v1/geo/search?q= : recherche tolérante aux fautes et aux accents (trigrammes pg_trgm
   sur nom + aliases), triée par similarité puis distance puis popularité, réponse < 300 ms.
   Elle doit répondre correctement à : "acacia", "ngoa", "mokolo", "carrefour bastos",
   "en face de la pharmacie de melen".
3. Table zones (kind: moto_allowed | moto_forbidden | car_corridor | bonus, geom, active).
   Seed : un polygone "centre urbain interdit aux motos" couvrant le centre-ville, et trois
   zones moto autorisées (Emana, Etoudi, Nkolbisson).
   GET /v1/geo/zones renvoie les zones actives en GeoJSON pour l'affichage sur la carte.
4. Service de routage : appel OSRM public (profil driving), renvoie distance_m, duration_s et
   la géométrie encodée. Repli automatique en haversine × 1,35 à 22 km/h si OSRM échoue ou
   dépasse 2 s, avec un champ "routing: 'osrm' | 'fallback'" dans la réponse.
5. Service isMotoAllowed(pickup, dropoff, routeGeometry) : ST_Intersects entre l'itinéraire et
   les zones moto_forbidden. Écris un test avec 6 trajets : 3 autorisés, 3 refusés.

Termine en me montrant les requêtes SQL PostGIS utilisées et en m'expliquant pourquoi
le géorepérage est fait côté serveur et pas côté application.
```

---

### P3 · Prix, courses, dispatch, temps réel

```
Implémente le cœur métier. Respecte au franc près les règles du brief.

1. Module pricing, fonction PURE et testée :
   prix = max(minimum, base + tarif_km × km + tarif_min × min)
   Éco 500 + 150/km + 25/min, minimum 1000 · Confort = Éco × 1,4 · Moto 200 + 60/km, minimum 300
   Majoration nuit +25 % entre 22 h et 5 h, majoration pluie activable, plafond global × 1,5.
   Commission 15 % voiture / 50 F fixe moto, retenue DGI 1 % du brut, net chauffeur calculé.
   POST /v1/quotes renvoie les 3 offres avec le détail ligne par ligne, l'ETA, et une signature
   HMAC des entrées ; le devis expire en 2 min. L'offre Moto est absente ou marquée indisponible
   avec la raison si le géorepérage la refuse.
   Écris une table de vérité en test : 5 km / 15 min Éco jour = 1625 F, net 1365 F ;
   nuit = 2031 F ; Moto 3 km = 380 F, net 326 F.

2. Module rides : machine à états STRICTE côté serveur, conforme à
   docs/VORA_cycle_de_vie_course.mermaid. Toute transition écrit une ligne dans ride_events.
   Une transition invalide renvoie INVALID_TRANSITION sans rien écrire.
   POST /v1/rides (devis + idempotency-key) · /cancel · /arrived · /start (code de montée)
   · /complete · /payments/cash-confirm · /payments/mobile-money (simulé, 3 s puis succès).
   Code de montée : 4 chiffres aléatoires, stocké haché, visible du passager seulement.
   Annulation : gratuite dans les 2 min ou tant que le chauffeur a parcouru moins de 300 m,
   sinon 300 F (100 F moto) crédités au chauffeur.

3. Module dispatch :
   positions des chauffeurs en mémoire (Map<driverId, {lat,lng,heading,ts,status}>), TTL 60 s.
   Sélection : chauffeurs en ligne, offre compatible, zone autorisée pour la moto ; rayons
   1 → 3 → 5 km ; score = 0,55 × eta + 0,20 × acceptation + 0,15 × (1 − annulation) + 0,10 × note.
   Offre SÉQUENTIELLE : un seul chauffeur à la fois, 15 s, 3 vagues, puis statut expired.
   Un chauffeur qui refuse ou laisse expirer passe au suivant en moins d'une seconde.

4. Socket.IO : salles par course et par chauffeur.
   chauffeur → serveur : driver.position (toutes les 5 s)
   serveur → chauffeur : ride.offer, ride.cancelled
   serveur → passager : ride.status, ride.driver_position, ride.eta
   Rejeu des événements manqués à la reconnexion (tampon 10 min en mémoire).

Écris les tests de la machine à états (toutes les transitions valides et 5 invalides) et un test
d'intégration : commande → offre → acceptation → code → course → paiement espèces.
Explique-moi ensuite pourquoi les positions sont en mémoire ici et ce qu'il faudrait faire en production.
```

---

### P4 · Applications Flutter : thème et navigation

```
Crée les deux applications Flutter du monorepo :
apps/passager, apps/chauffeur, et packages/vora_ui + packages/vora_core.

1. packages/vora_ui : reprends EXACTEMENT docs/vora_theme.dart (couleurs, typographie, rayons,
   espacements, thème clair et thème nuit) et ajoute les composants réutilisables visibles dans
   docs/VORA_maquettes_lot1_passager.html et lot2 :
   VoraButton (primaire, secondaire, tertiaire, danger, désactivé, chargement, hauteur 52,
   64 pour les actions principales), VoraTextField, VoraChip (puce d'offre), VoraBadge
   (vérifié, ok, attention, sos, repère jaune), VoraSheet (feuille arrondie 24), VoraPriceBlock
   (prix en gros + décomposition), VoraTripPoints (départ/arrivée à deux points),
   VoraDriverCard, VoraBoardingCode (4 cases), VoraSosButton.
   Les polices Sora et IBM Plex Sans ne sont pas installées : télécharge-les dans assets/fonts
   et déclare-les dans pubspec.yaml (sans cette déclaration, l'appli retombe silencieusement
   sur la police système — c'est une erreur classique).

2. packages/vora_core : modèles typés (User, Quote, Ride, Driver, Landmark, Zone), client API
   (dio) avec le jeton, client Socket.IO, gestion d'erreurs traduites en messages utilisateur
   selon la voix de la charte (« Pas de réseau. Votre commande partira dès le retour de la
   connexion. »), state management avec Riverpod.

3. Navigation et écrans vides mais routés :
   passager : démarrage → langue → téléphone/e-mail → code → prénom → accueil (3 onglets :
   Accueil, Mes courses, Profil)
   chauffeur : bienvenue → téléphone → code → accueil (En ligne, Gains, Pièces, Profil)

4. Une page de démonstration des composants (route /kit) dans chaque appli, pour vérifier
   visuellement la conformité à la charte.

Cible Android, minSdk 24. Montre-moi une capture de la page /kit et la commande de lancement.
```

---

### P5 · Boucle passager

```
Implémente la boucle passager en te conformant AU PIXEL PRÈS aux maquettes de
docs/VORA_maquettes_lot1_passager.html (ouvre-le et respecte la disposition, les tailles,
les libellés exacts en français).

Écrans, dans l'ordre :
1. PA-08 Accueil : carte flutter_map centrée sur la position, pilule de position corrigeable,
   champ « Où allez-vous ? », favoris, repères proches affichés en marqueurs jaunes.
2. PA-09 Recherche : appelle /v1/geo/search, résultats en une ligne (nom usuel + quartier +
   distance), icône jaune pour les repères VORA, entrée « Choisir sur la carte ».
3. PA-10 Point de rendez-vous : aiguille fixe au centre, carte qui bouge dessous, champ de
   précision (« devant la boulangerie »), repère le plus proche proposé.
4. PA-11 Offre et prix : les 3 offres avec leur prix ferme, décomposition dépliée sous l'offre
   sélectionnée, badge « Prix ferme » jaune, moto grisée avec sa raison si hors zone, mode de
   paiement, bouton « Commander · 1 625 F » (le montant DANS le bouton).
5. PA-12 Recherche de chauffeur : compteur en gros, halo animé, « 3 chauffeurs contactés »,
   et surtout l'état « Aucun chauffeur disponible » avec deux sorties.
6. PA-13 Approche : position du chauffeur en direct sur la carte, carte chauffeur (prénom,
   plaque, véhicule, note, badge Vérifié), CODE DE MONTÉE en gros, actions, bouton d'annulation
   dont le libellé change selon la fenêtre gratuite (« Annuler · gratuit encore 1:20 » puis
   « Annuler · 300 F reversés à Boris »).
7. PA-14 En course : itinéraire, ETA, bouton SOS flottant rouge visible en permanence,
   badge « X suit votre trajet » si le partage est actif.
8. PA-15 Paiement : montant identique à celui annoncé, espèces ou MoMo (simulé avec écran
   d'attente puis succès), reçu.
9. PA-16 Notation : étoiles bleues, tags dont « On m'a demandé plus que le prix » en orange.
10. PA-22 SOS : feuille de confirmation qui dit qui reçoit quoi, puis état « Alerte envoyée ».

Contraintes : tout ce qui se touche fait au moins 48 dp ; un seul bouton bleu par écran ;
le rouge uniquement pour le SOS et les erreurs ; les montants en chiffres tabulaires
(« 1 625 F » avec espace insécable).

Après chaque écran, arrête-toi et montre-moi une capture pour que je valide avant de continuer.
```

---

### P6 · Boucle chauffeur

```
Implémente l'appli chauffeur d'après docs/VORA_maquettes_lot2_chauffeur.html.

1. CH-09 En ligne : interrupteur En ligne / Hors ligne (démarre le service de position toutes
   les 5 s), gains du jour en pilule, offres actives, zones moto dessinées sur la carte
   (rouge hachuré = interdit), bouton unique 64 dp quand on est hors ligne.
2. CH-10 Demande de course EN PLEIN ÉCRAN, par-dessus tout, avec sonnerie et vibration :
   départ, destination JAMAIS masquée, distance d'approche, et surtout LE NET POUR VOUS en
   Sora 800 taille 48, avec la décomposition (prix passager, commission, retenue DGI) en petit.
   Anneau de 15 secondes qui se vide. Accepter en grand, Passer en petit.
   Variante moto : forfait 50 F au lieu du pourcentage, badge jaune.
3. CH-11 Approche : navigation vers le point de rendez-vous, note et photo du lieu envoyées par
   le passager, bouton « Je suis arrivé » 64 dp, puis chronomètre d'attente et, seulement après
   5 min (3 en moto), le bouton secondaire « Passager absent · 300 F reversés ».
4. CH-12 Code de montée : pavé numérique large, 4 cases, message d'erreur explicite si faux.
5. CH-13 En course : navigation plein écran, bandeau d'instruction en haut, SOS chauffeur,
   bouton Terminer actif seulement à moins de 100 m de la destination.
6. CH-14 Encaissement : montant à encaisser, bouton « Paiement reçu · 1 625 F », puis écran
   « Net gagné » avec le montant en 56 et le détail en petit.
7. CH-16 Gains : jour / semaine / mois, barres par heure, liste des dernières courses avec le net.
8. Mode nuit automatique de 19 h à 6 h (thème nuit de vora_ui), avec un bouton de bascule
   manuelle pour la démo, parce que le jury regardera peut-être à 14 h.

Le service de position doit être un service en avant-plan Android avec notification persistante,
sinon Android le tue et la démo échoue.
```

---

### P6b · Page d'administration (une seule page, mais elle compte)

```
Le manuel du hackathon décrit un système d'administration (§ 7). Nous n'en construisons
qu'UNE page, mais elle doit être crédible et utile pendant la démo.

Crée apps/admin : React + Vite + TypeScript, protégé par un login séparé (rôle 'ops'),
inspiré de docs/VORA_maquettes_lot5_backoffice.html (écran OP-02), avec les mêmes jetons
de couleur et de typographie que les applis.

Une seule page, quatre blocs :
1. Bandeau d'alerte SOS en haut, rouge, avec la course concernée et un bouton « Suivre ».
   Il n'apparaît que s'il y a une alerte active.
2. Six compteurs du jour : courses, demandes, taux d'acceptation, annulations, attente médiane,
   chauffeurs en ligne. Calculés par une vraie requête SQL sur ride_events, pas codés en dur.
3. Carte live (react-leaflet) : chauffeurs en ligne (voitures bleues, motos cerclées de jaune),
   courses en cours, zones interdites aux motos en rouge hachuré. Mise à jour par Socket.IO.
4. Deux listes à droite : dossiers chauffeurs en attente avec bouton « Valider » (c'est ce
   bouton qui fait passer un chauffeur à 'vérifié' pendant la démo), et dernières courses.

Ajoute dans le bandeau du haut un interrupteur « Majoration pluie » qui appelle l'API et
change le prix des devis en direct — c'est spectaculaire à montrer au jury.

Sécurité : rôle 'ops' vérifié côté serveur sur CHAQUE endpoint /v1/ops/*, jamais seulement
côté client. Écris un test qui vérifie qu'un jeton de passager reçoit 403 sur /v1/ops/dashboard.
```

---

### P7 · Simulateur de chauffeurs et données de démo

```
C'est le prompt qui sauve la démo : sans chauffeurs sur la carte, le jury voit un écran vide.

Crée services/api/src/demo/simulator.ts, activé par DEMO_MODE=true :
1. 12 chauffeurs virtuels (8 voitures, 4 motos) avec noms, plaques et véhicules camerounais,
   répartis sur des positions réalistes à Yaoundé (les voitures partout, les motos uniquement
   dans les zones autorisées).
2. Ils se déplacent le long de vrais segments de route (utilise OSRM pour tracer un itinéraire
   entre deux repères au hasard, puis avance le long de la géométrie à 20-35 km/h, et recommence).
   Position publiée toutes les 5 s comme un vrai chauffeur.
3. Comportement configurable : par défaut, le chauffeur virtuel le mieux placé ACCEPTE la course
   en 4 à 8 secondes, roule jusqu'au passager, appuie sur « arrivé », attend le code, fait la
   course en accéléré (facteur ×8 configurable), puis confirme le paiement.
4. Endpoints de contrôle pour la démo, protégés par un jeton :
   POST /v1/demo/reset  · POST /v1/demo/scenario {name}
   Scénarios : "nominal", "aucun_chauffeur", "annulation_tardive", "pluie" (active la majoration),
   "moto_zone_interdite", "sos".
5. Un script npm run demo qui remet tout à zéro et affiche les identifiants de connexion
   des comptes de démonstration.

Ce simulateur doit être clairement isolé du code métier (aucun import depuis les modules de
production vers demo/) et désactivé quand DEMO_MODE=false. Explique-moi comment tu l'as isolé :
le jury peut demander si le produit fonctionne sans lui.
```

---

### P8 · Les quatre briques d'innovation

```
Ajoute les quatre différenciateurs qui feront la note d'innovation. Fais-les dans cet ordre
et arrête-toi après chacun pour que je teste.

1. RECHERCHE EN LANGAGE NATUREL (le plus fort)
   POST /v1/geo/interpret { text } : interprète une phrase comme
   « je vais au carrefour après la pharmacie de Melen » ou « déposez-moi en face du marché Mokolo »
   et renvoie le ou les repères candidats avec un score.
   Implémentation SANS API externe : normalisation (accents, casse), extraction des prépositions
   de repérage (« en face de », « après », « avant », « derrière », « à côté de », « carrefour »),
   correspondance trigramme sur landmarks.aliases, puis ajustement géométrique selon la
   préposition (ex. « après X » sur un axe → décalage de 150 m dans le sens du trajet).
   Affiche dans l'appli passager la phrase interprétée : « Compris : Carrefour Acacias,
   côté marché » avec un bouton « Ce n'est pas ça ».

2. GÉOREPÉRAGE MOTO EXPLIQUÉ AU PASSAGER
   Quand l'offre Moto est refusée, ne dis pas seulement « indisponible » : affiche la zone
   interdite sur la carte et le message « L'arrivée est en zone interdite aux motos (arrêté
   préfectoral). VORA ne propose pas de course illégale. » C'est un argument juridique unique.

3. ANNONCES VOCALES (flutter_tts, français)
   Côté passager : « Boris arrive dans 4 minutes, Toyota Corolla grise, plaque CE 913 NR.
   Votre code est 4 8 2 1. » à l'approche, et à l'arrivée du chauffeur.
   Côté chauffeur : lecture de la demande de course (« Course Éco, 1,2 km d'approche,
   net 1 365 francs, destination Carrefour Acacias ») pour qu'il n'ait pas à lire en conduisant.
   Bouton de coupure dans les deux applis.

4. PARTAGE DE TRAJET PAR LIEN PUBLIC
   POST /v1/rides/{id}/share renvoie une URL publique ; sers une page web légère (HTML + Socket.IO)
   qui montre en direct la position, la plaque, le nom du chauffeur et l'ETA, sans authentification,
   avec expiration à la fin de la course. Ouvre ce lien sur un troisième écran pendant la démo :
   l'effet sur un jury est considérable.
```

---

### P9 · Durcissement pour la démo

```
Objectif unique : que rien ne casse devant le jury. Aucune fonctionnalité nouvelle.

1. Passe en revue tous les appels réseau des deux applis : aucun écran ne doit rester bloqué
   sur un chargement. Chaque erreur affiche un message utile en français selon la voix de la
   charte, avec une action de sortie.
2. Ajoute un mode démo dans les applis (secoue l'appareil ou triple tap sur le logo) qui permet
   de : réinitialiser, choisir un scénario, forcer la pluie, forcer le mode nuit, sauter l'OTP.
3. Vérifie les cas qui plantent le plus souvent : permission de localisation refusée, GPS
   désactivé, perte de réseau pendant une course (coupe le Wi-Fi et vérifie la reprise),
   application chauffeur mise en arrière-plan pendant 2 minutes, rotation d'écran,
   deux courses lancées d'affilée sans redémarrer.
4. Ajoute un écran « À propos » dans le profil qui affiche la version, l'ID VORA et un lien
   vers le dépôt : les jurys aiment voir un numéro de version.
5. Écris scripts/demo.sh qui, en une commande, remet la base à zéro, lance l'API, le simulateur
   et affiche les comptes de démonstration.
6. Lance les tests, corrige ce qui échoue, et donne-moi la liste des bugs connus restants
   classés par risque pour la démo.

SÉCURITÉ — le manuel du hackathon en fait un critère d'évaluation à part entière (§ 10).
Passe en revue et corrige :
- aucun secret, mot de passe, jeton ou clé dans le dépôt ; git log fouillé pour vérifier
  qu'aucun n'a été commité puis retiré ; .env.example complet et documenté ;
- validation zod sur TOUTES les entrées d'API, y compris les paramètres d'URL ;
- rôles vérifiés côté serveur sur chaque route (passager / chauffeur / ops) : écris un test
  d'autorisation croisée où un passager tente de lire la course d'un autre et reçoit 403 ;
- limitation de débit sur /auth/otp/request (3 par heure et par cible) et sur /quotes ;
- aucune donnée personnelle dans les logs (ni téléphone, ni e-mail, ni jeton) ;
- les DTO de sortie ne laissent jamais fuir le téléphone de l'autre partie : vérifie chaque
  réponse contenant un chauffeur ou un passager ;
- en-têtes de sécurité (helmet), CORS restreint aux origines connues ;
- jetons JWT signés avec un secret d'environnement, expiration vérifiée.

Termine par un tableau : chaque point de sécurité, où il est implémenté (fichier), et comment
on le démontre au jury en 20 secondes.
```

---

### P10 · Livrables : README, manuel de démarrage, pitch

```
Prépare les livrables exigés par le manuel du hackathon (§ 17, 18, 19, 24). Sois précis :
la documentation est un critère d'évaluation à part entière.

1. README.md à la racine, avec EXACTEMENT ces 20 sections, dans cet ordre :
   1. Présentation · 2. Problème · 3. Notre solution · 4. Fonctionnalités · 5. Innovation
   6. Sécurité · 7. Architecture · 8. Technologies · 9. Installation · 10. Configuration
   11. Variables d'environnement · 12. Base de données · 13. Lancement du projet
   14. Comptes de démonstration · 15. Structure du projet · 16. API utilisées · 17. Limites
   18. Membres de l'équipe · 19. Figma · 20. Démonstration

   Consignes par section :
   - 2. Problème : appuie-toi sur docs/VORA_brief_produit_MVP.md (prix opaques, suppléments
     réclamés, adressage par repères, motos interdites au centre, chauffeurs mal payés).
     Cite des chiffres réels : dépôt ≈ 2 000 F, ramassage 350 F, commission concurrente 20 %.
   - 4. Fonctionnalités : une ligne par fonctionnalité exigée par le hackathon
     (authentification, géolocalisation, cartographie, réservation, itinéraire, estimation du
     coût, suivi temps réel, interface responsive) avec le fichier qui l'implémente.
   - 5. Innovation : nos quatre différenciateurs, en expliquant le problème résolu par chacun.
   - 6. Sécurité : le tableau produit au prompt P9.
   - 7. Architecture : un schéma Mermaid + 10 lignes d'explication.
   - 8. Technologies : pour CHAQUE technologie, pourquoi choisie, avantages, limites,
     comment elle s'intègre — le manuel exige cette justification (§ 4.2).
   - 17. Limites : sois honnête (chauffeurs simulés, paiement simulé, coordonnées des repères
     approximatives, appels non implémentés). Un jury respecte une équipe lucide.
   - 20. Démonstration : le lien vers la vidéo si vous en faites une, et le scénario joué.

2. MANUEL_DEMARRAGE.md, fichier séparé, qui répond à la question du manuel :
   « je viens de cloner votre dépôt, que dois-je faire ? »
   Prérequis versionnés (Node 20, Flutter 3.x, Docker), puis les commandes une par une,
   dans l'ordre, testées : clone, cp .env.example .env, docker compose up -d, npm install,
   npm run migrate, npm run seed, npm run dev, flutter pub get, flutter run.
   Section base de données : comment elle est créée, les migrations, les données de démo.
   Section comptes de démonstration avec les identifiants (uniquement des comptes de test).
   Section dépannage : port occupé, OSRM injoignable, permission de localisation refusée,
   émulateur qui ne voit pas localhost (utiliser 10.0.2.2).

3. docs/DEMO.md : le script minuté de la démonstration de 5 minutes, qui tient quel téléphone,
   quel scénario est déclenché à quel moment, et les trois questions probables du jury
   avec la réponse préparée.

4. docs/ARCHITECTURE.md : le schéma, les modules, le modèle de données, le cycle de vie d'une
   course, et une section « ce qu'on ferait différemment en production » qui renvoie au
   document de conception.

5. Vérifications finales : aucun secret commité, .env.example complet, le dépôt se clone et
   se lance sur une machine vierge, chaque membre de l'équipe apparaît dans l'historique git.
```

---

## 5. Le script de démo (à répéter trois fois avant la fin)

| Temps | Écran | Ce qu'on montre | Ce qu'on dit |
|---|---|---|---|
| 0:00 | — | — | « À Yaoundé, on ne donne pas une adresse, on donne un repère. Et on négocie le prix à la portière. VORA supprime les deux. » |
| 0:30 | Passager | On tape « en face de la pharmacie de Melen » → repère trouvé | L'innovation locale |
| 1:00 | Passager | Prix ferme décomposé, badge Prix ferme | « Ce prix ne bougera pas » |
| 1:20 | Passager | On sélectionne Moto → refusée, zone rouge affichée | « L'appli refuse une course illégale » |
| 1:50 | Deux téléphones | Commande → demande plein écran chez le chauffeur avec **le net** | « Le chauffeur sait ce qu'il gagne avant d'accepter » |
| 2:30 | Passager | Suivi en direct, annonce vocale, code de montée | Sécurité |
| 3:00 | 3ᵉ écran | Lien de partage ouvert sur un navigateur, la course avance en direct | Effet |
| 3:30 | Passager | SOS → alerte reçue | Sécurité |
| 4:00 | Chauffeur | Fin de course, net gagné, décomposition | « Chaque trajet compte » |
| 4:30 | Écran de code | README, dossier de conception | « Voilà ce qu'on a conçu au-delà de la démo » |

Gardez 30 secondes de marge. Si une chose doit tomber, c'est le SOS, pas le prix ferme.

---

## 6. Checklist de soumission (manuel § 24 et § 28)

### Livrables obligatoires

| Livrable | Où | Fait |
|---|---|---|
| Application / MVP fonctionnel | APK des deux applis + API qui tourne | ☐ |
| Dépôt GitHub avec tout le code | branche `main` | ☐ |
| README.md aux 20 sections | racine | ☐ |
| Manuel de démarrage | `MANUEL_DEMARRAGE.md` | ☐ |
| **Fichier Figma partagé en lecture** | lien dans README § 19 | ☐ |
| Présentation / démonstration | `docs/DEMO.md` + répétée 3 fois | ☐ |
| Membres de l'équipe et rôles | README § 18 | ☐ |

### Produit

☐ Le parcours passager complet fonctionne · ☐ Le chauffeur reçoit, accepte et termine une course · ☐ La carte, l'itinéraire et l'estimation fonctionnent · ☐ Le suivi temps réel fonctionne · ☐ Les cas d'erreur du manuel § 21 sont gérés : pas de réseau, localisation refusée, aucun chauffeur, course annulée, paiement échoué

### Sécurité

☐ Mots de passe et codes hachés · ☐ Rôles vérifiés côté serveur · ☐ Validation de toutes les entrées · ☐ Aucun secret dans le dépôt, y compris dans l'historique · ☐ SOS, partage de trajet, code de montée, chauffeur vérifié · ☐ Numéros jamais exposés à l'autre partie

### Technique et équipe

☐ Branches et commits lisibles · ☐ Chaque membre présent dans l'historique · ☐ `.env.example` complet · ☐ Base de données documentée · ☐ Chaque membre sait expliquer la partie qu'il a intégrée

---

## 7. Les questions que le jury posera, et vos réponses

| Question | Votre réponse |
|---|---|
| « Pourquoi cette stack ? » | Section 8 du README, avec avantages ET limites de chaque choix. Assumez les écarts avec la production : positions en mémoire au lieu de Redis, OSRM public, paiement simulé — chacun est un arbitrage de 48 h, documenté dans le document de conception. |
| « Qu'est-ce qui est vraiment innovant ? » | La recherche par repères en langage naturel, et le refus automatique des courses moto illégales. Montrez-les, ne les racontez pas. |
| « L'IA a fait le travail à votre place ? » | Montrez le dossier de conception écrit avant le hackathon, expliquez la machine à états et le calcul du prix au tableau, et laissez chaque membre parler de sa partie. |
| « Comment gagnez-vous de l'argent ? » | 15 % voiture, 50 F par course moto, avec le calcul du net chauffeur à l'écran. Comparez aux 20 % de la concurrence. |
| « Et si le réseau tombe ? » | Montrez-le : coupez le Wi-Fi pendant une course, la reprise est automatique. |
| « C'est légal ? » | Licence S10, sept pièces vérifiées, retenue fiscale de 1 %, géorepérage des motos. Aucune autre équipe n'aura cette réponse. |
