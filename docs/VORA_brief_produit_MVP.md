# VORA — Brief produit MVP (v1)

**Version** 0.2 · 30 août 2026 · **Statut** : validé, mis à jour (ID VORA, inscription par téléphone ou e-mail, messagerie et appel VORA)
**Ville de lancement** : Yaoundé · **Périmètre** : voitures + motos-taxis · **Cadre** : lancement réel

---

## 1. Fiche d'identité

| | |
|---|---|
| **Nom** | VORA |
| **Promesse** | La mobilité en règle à Yaoundé : véhicules vérifiés, prix ferme, et chaque trajet compte pour le chauffeur |
| **Problème** | Passagers : prix opaques, suppléments réclamés hors appli, annulations, points de rendez-vous introuvables, insécurité de nuit, aucune prise en charge PMR. Chauffeurs : 20 % de commission, annulations à l'approche, statut légal flou. Plateformes en place : en conflit avec l'État et les syndicats |
| **Cibles v1** | Passagers : étudiants et jeunes actifs, femmes se déplaçant de nuit, salariés d'entreprises partenaires. Chauffeurs : taxis jaunes en dépôt, VTC en règle, moto-taximen d'associations déclarées en périphérie |
| **Zone v1** | Deux corridors voitures (par ex. pôle universitaire ↔ centre-ville / Bastos) + un bassin motos dans un arrondissement autorisé, à valider sur la carte de l'arrêté préfectoral |
| **Offres** | VORA Éco (voiture), VORA Confort (voiture récente climatisée), VORA Moto (périphérie uniquement) |
| **Identité** | Blanc + bleu · bilingue FR / EN dès la v1 |
| **Plateformes** | Android d'abord (Play Store), iOS ensuite · back-office web pour l'équipe ops |

---

## 2. Objectifs et indicateurs (6 mois après lancement public)

| Objectif | Indicateur | Cible de départ |
|---|---|---|
| Conformité | Part des véhicules actifs avec les 7 pièces valides | 100 % |
| Fiabilité | Courses annulées après acceptation (les deux côtés) | < 8 % |
| Prix tenu | Courses avec signalement « supplément réclamé » confirmé | < 1 % |
| Attente | Délai médian acceptation → arrivée du chauffeur (corridors) | < 8 min |
| Volume | Courses par jour | 300 à 600 |
| Offre | Chauffeurs actifs (≥ 5 courses / semaine) | 200 voitures, 100 motos |
| Satisfaction | Note moyenne passagers et chauffeurs | ≥ 4,5 / 5 des deux côtés |
| Revenu chauffeur | Net journalier médian voiture vs. l'équivalent à 20 % de commission | + 2 000 F / jour |

Les cibles sont des valeurs de départ, à recalibrer après le pilote fermé (§ 11).

---

## 3. Utilisateurs

**Aïcha, 22 ans, étudiante** — rentre du campus vers son quartier après 21 h. Veut un prix connu avant de commander et un chauffeur identifié. Android d'entrée de gamme, data limitée, paie souvent en espèces.

**Marc, 34 ans, cadre** — dépôt quotidien domicile ↔ bureau, paie en Mobile Money, veut la ponctualité, un reçu et zéro négociation.

**Maman Rose, 58 ans, mobilité réduite** — habite un quartier enclavé. A besoin de temps pour embarquer, d'un chauffeur patient et d'un point de rendez-vous accessible.

**Boris, taximan** — taxi jaune en règle, 12 h par jour. Veut des dépôts sans marchandage, un paiement sûr et ne pas perdre de carburant sur des annulations.

**Ismaël, moto-taximan en périphérie** — gagne environ 5 000 F par jour. Refuse une commission qui mange sa marge et veut éviter tout ennui avec la police (zones interdites).

**L'équipe ops VORA (2 à 3 personnes)** — valide les dossiers, gère les litiges, dessine les zones, surveille la carte en direct.

---

## 4. Principes produit (non négociables)

1. **En règle par conception** — aucune course sans véhicule vérifié ; le service moto est géorepéré sur les zones autorisées.
2. **Prix ferme** — affiché avant la commande, décomposé, tenu jusqu'à la fin.
3. **Chaque trajet compte** — le chauffeur voit ce qu'il gagne sur chaque course et est compensé quand on lui fait perdre du temps.
4. **Repères avant adresses** — on cherche « carrefour », « en face de », pas un nom de rue.
5. **Fonctionne mal connecté** — appli légère, tolérante aux coupures, espèces acceptées.
6. **Sécurité des deux côtés** — identités vérifiées, SOS, partage de trajet, code de montée.
7. **Bilingue et lisible** — FR / EN, textes courts, boutons larges, pas de jargon.

---

## 5. Périmètre fonctionnel par brique

### 5.1 Authentification et identités

| v1 (MVP) | v2 |
|---|---|
| Création de compte par téléphone (+237, code SMS, repli par appel vocal) **ou** par e-mail (code à 6 chiffres) ; au moins un canal vérifié, l'autre facultatif et ajoutable plus tard | OTP via WhatsApp, connexion par lien e-mail |
| **ID VORA** généré à la création : 8 chiffres en deux groupes, unique, non modifiable ; affiché dans le profil et sur les reçus, sert au support, aux litiges et au parrainage ; jamais un identifiant de connexion à lui seul | |
| Téléphone et e-mail jamais visibles par les autres utilisateurs ; toute communication chauffeur-passager passe par la messagerie et l'appel VORA (§ 5.7) | |
| Chauffeur : téléphone obligatoire (paiements MoMo / Orange Money, contact ops), invisible des passagers ; e-mail facultatif | |
| Profil passager : nom, photo optionnelle, langue, jusqu'à 3 contacts de confiance | Comptes entreprises (administrateur + employés) |
| Dossier chauffeur (KYC) en 5 étapes : identité (CNI + selfie), permis, véhicule (carte grise, assurance, visite technique), professionnel (licence de transport / carte bleue, certificat de capacité T), photo du véhicule et de la plaque | Lecture automatique des pièces (OCR) et vérification de l'authenticité des visites techniques via la plateforme du ministère |
| Statuts : brouillon → en revue → vérifié / refusé (avec motif) | Biométrie à la connexion |
| Date d'expiration saisie pour chaque pièce ; rappels à J-30 et J-7 ; blocage automatique à l'expiration | |
| Badge « Vérifié » côté passager (plaque, photo, type de véhicule) | |
| Un seul appareil actif par compte chauffeur (anti-partage de compte) | |

### 5.2 Réservation (passager)

| v1 (MVP) | v2 |
|---|---|
| Position automatique + correction manuelle sur la carte | Réservation programmée |
| Recherche mixte : base de repères VORA (carrefours, commerces, écoles, églises, mosquées) + géocodage carte ; favoris (Maison, Travail, + 3) | Multi-arrêts |
| Point de rendez-vous : photo optionnelle + note courte (« devant la boulangerie ») | Trajet relais moto → voiture avec point de passage en bordure du périmètre |
| Choix de l'offre : Éco / Confort / Moto (Moto affichée seulement si départ et arrivée sont en zone autorisée) | Commande de secours par SMS / USSD ou WhatsApp |
| Prix ferme affiché avant confirmation, décomposition dépliable, ETA | Mode hors ligne : cache de carte + commande mise en file d'attente |
| Suivi en temps réel du chauffeur ; messagerie et appel VORA (§ 5.7) | Relais par numéro masqué (mise en relation opérateur) quand la data ne permet pas l'appel |
| Code de montée à 4 chiffres à donner au chauffeur | Wallet passager, promotions, parrainage |
| Partage de trajet en direct (lien) + bouton SOS (appel d'un contact de confiance + alerte ops avec position) | |
| Annulation selon les règles du § 6 | |
| Fin de course : montant, paiement (espèces / MoMo / Orange Money), reçu, note + tags (« ponctuel », « supplément demandé », « véhicule propre »…) | |
| Historique et reçus | |
| Option accessibilité : « J'ai besoin de plus de temps pour embarquer » (attente non facturée, chauffeurs volontaires en priorité) | Véhicules adaptés et chauffeurs formés PMR |

### 5.3 Smart dispatch

| v1 (MVP) | v2 |
|---|---|
| Position des chauffeurs en ligne toutes les 5 s (15 s à l'arrêt, pour la batterie) | Prédiction de demande par zone et par heure (IA) |
| Recherche des candidats par rayon croissant (1 km → 3 km → 5 km), filtrés par offre, statut vérifié et zone autorisée (moto) | Chaînage des courses retour (proposer une course dans le sens du retour vers la base du chauffeur) |
| Score d'attribution = ETA d'approche + taux d'acceptation + taux d'annulation + note | Heatmap chauffeur en temps réel |
| Envoi séquentiel : un chauffeur à la fois, 15 s pour accepter, puis le suivant ; 3 vagues maximum, sinon « aucun chauffeur disponible » avec option d'attendre 2 min | File d'attente virtuelle aux points de forte demande (gares, campus, marchés) |
| **Géorepérage moto** : polygones des zones autorisées ; course refusée si départ, arrivée ou itinéraire traverse une zone interdite | Équilibrage automatique des bonus de zone |
| Anti-annulation : un chauffeur qui annule après acceptation perd sa priorité 30 min ; 3 annulations dans la journée → pause de 2 h | |
| Bonus de zone (activé manuellement depuis le back-office) : supplément fixe côté chauffeur pour un quartier sous-servi, visible dans l'espace chauffeur | |
| Ré-attribution automatique si le chauffeur ne progresse pas vers le passager après 3 min | |

### 5.4 Tarification et paiement

| v1 (MVP) | v2 |
|---|---|
| Grille par offre : prix = max(minimum, base + tarif/km × km + tarif/min × min) | Comptes entreprises avec facturation mensuelle |
| Valeurs de départ (à calibrer) : Éco 500 F + 150 F/km + 25 F/min, minimum 1 000 F · Confort = Éco × 1,4 · Moto 200 F + 60 F/km, minimum 300 F | Pourboire |
| Prix ferme calculé sur l'itinéraire estimé ; ne change que si le passager ajoute un arrêt ou change de destination (recalcul affiché et accepté) | Tarif PMR subventionné |
| Majorations affichées comme lignes séparées : nuit (22 h – 5 h) + 25 % ; pluie / forte demande jusqu'à + 50 % ; plafond global × 1,5 | Tarification apprise (IA) sous plafond |
| Décomposition visible : base, distance, temps, majoration, total | |
| Commission : 15 % sur les voitures ; 50 F fixe par course moto | |
| Retenue DGI : 1 % du montant brut par course côté chauffeur (base imposable 20 % × 5 %), ligne visible dans l'espace chauffeur, reversée par VORA | |
| Paiement : espèces par défaut ; MoMo / Orange Money par demande de paiement dans l'appli (repli si l'API n'est pas prête au lancement : le passager paie sur le numéro du chauffeur et coche « payé MoMo ») | |
| Frais d'annulation et compensation d'approche (§ 6) | |
| Reçu par SMS ou e-mail | |

**Exemple** — Course Éco de 5 km / 15 min : 500 + 750 + 375 = 1 625 F. Chauffeur : 1 625 − 244 (15 %) − 16 (DGI) ≈ 1 365 F net. Course Moto de 3 km : 200 + 180 = 380 F ; chauffeur : 380 − 50 − 4 = 326 F.

### 5.5 Espace chauffeur affilié

| v1 (MVP) | v2 |
|---|---|
| Onboarding guidé (dossier KYC) + guide d'utilisation intégré (vidéo courte + FAQ FR / EN) | Abonnement hebdomadaire à commission réduite pour les gros rouleurs |
| Bouton En ligne / Hors ligne ; offres activées (Éco / Confort / Moto) | Coffre d'épargne pour l'assurance et la visite technique |
| Réception de demande en plein écran : départ, destination (jamais masquée), distance d'approche, montant net estimé, 15 s pour accepter | Parrainage de chauffeurs |
| Navigation vers le passager puis vers la destination | Statistiques avancées (heures et zones les plus rentables) |
| Saisie du code de montée pour démarrer la course | Formation PMR |
| Gains : jour / semaine / mois ; détail par course (brut, commission, retenue DGI, net, compensation d'annulation) | |
| Solde : dette de commission sur les courses en espèces ; recharge par MoMo ; retrait MoMo des gains encaissés dans l'appli ; plafond de dette 5 000 F (voiture) / 1 500 F (moto) au-delà duquel le compte est bloqué jusqu'à recharge | |
| Pièces : statut, dates d'expiration, rappels, nouvel envoi | |
| Signalements : passager absent (avec trace GPS), incident, SOS chauffeur | |
| Note du passager ; possibilité de bloquer un passager | |
| Bonus de zone visibles sur la carte | |

| Messagerie et appel VORA avec le passager, de l'acceptation à 30 min après la fin de course (§ 5.7) | |

### 5.6 Back-office ops (brique cachée, indispensable pour un lancement réel)

v1 : file de validation des dossiers KYC · éditeur de zones (dessin des géofences) · grille tarifaire et majorations (bouton « pluie ») · litiges (prix, supplément, passager absent) avec trace GPS · sanctions graduées · tableau de bord (courses, annulations, chauffeurs en ligne, carte en direct) · export mensuel DGI · bonus de zone · messages diffusés aux chauffeurs.

### 5.7 Messagerie et appel VORA (commun aux deux applis)

v1 : conversation liée à la course, ouverte à l'acceptation et fermée 30 min après la fin · messages texte · messages prédéfinis (« J'arrive », « Je suis devant », « Où êtes-vous ? ») · message vocal de 10 s maximum, compressé, lisible sur réseau faible · appel VORA en voix sur IP, codec bas débit, écran d'appel sur verrouillage, sonnerie distincte ; si l'appel n'aboutit pas en 10 s, l'appli propose le message vocal · aucun numéro affiché de part et d'autre · historique conservé 90 jours pour l'arbitrage des litiges · l'ops ne peut lire une conversation que dans le cadre d'un litige ouvert.

v2 : relais par numéro masqué via l'opérateur quand la data est absente · traduction automatique FR / EN des messages.

---

## 6. Règles métier (valeurs de départ, à calibrer au pilote)

| Règle | Valeur v1 |
|---|---|
| Annulation gratuite passager | Dans les 2 min après acceptation, ou tant que le chauffeur n'a pas parcouru 300 m |
| Annulation tardive passager | 300 F (voiture) / 100 F (moto), reversés intégralement au chauffeur ; VORA crédite le chauffeur immédiatement et récupère les frais sur la prochaine course du passager |
| Passager absent | Le chauffeur attend 5 min (voiture) / 3 min (moto) au point de rendez-vous, puis peut clôturer « passager absent » → mêmes frais |
| Attente au départ | 3 min gratuites, puis 25 F/min (moto : 2 min puis 10 F/min) ; option accessibilité : 10 min gratuites |
| Acceptation chauffeur | 15 s par chauffeur, 3 vagues maximum |
| Annulation chauffeur après acceptation | Perte de priorité 30 min ; 3 par jour → pause 2 h ; récidive hebdomadaire → revue ops |
| Supplément réclamé (signalé, confirmé par l'ops) | 1er : avertissement · 2e : suspension 7 jours · 3e : exclusion |
| Note chauffeur | < 4,0 sur les 50 dernières courses → revue ops |
| Plafond de majoration | × 1,5 du prix de base |
| Dette de commission | 5 000 F voiture / 1 500 F moto → compte bloqué jusqu'à recharge |
| Moto | Course autorisée uniquement si départ, arrivée et itinéraire sont dans les zones autorisées |
| Code de montée | 4 chiffres, obligatoire pour démarrer la course |
| Session chauffeur | Un seul appareil actif |
| ID VORA | 8 chiffres, généré, unique, non modifiable, affiché en deux groupes de 4 |
| Numéros et e-mails | Jamais affichés à l'autre partie, ni sur ses reçus, ni dans les exports |
| Messagerie | Ouverte de l'acceptation à 30 min après la fin de course ; conservation 90 jours ; lecture par l'ops uniquement sur litige ouvert |
| Appel VORA | Sonnerie 30 s ; si échec ou réseau insuffisant en 10 s, proposition du message vocal |
| Conservation des positions GPS | 90 jours, sauf litige ouvert |

---

## 7. Spécificités camerounaises intégrées (checklist)

- **Adressage** : base de repères VORA alimentée par les chauffeurs et les passagers (point + photo + nom usuel), recherche par « carrefour », « en face de », « après ».
- **Réseau faible** : APK < 25 Mo, images compressées, cache des tuiles de carte, reprise automatique du suivi après coupure, SMS de secours avec l'état de la course (chauffeur en approche, plaque), uniquement si un téléphone vérifié est associé au compte ; sinon notification et e-mail.
- **Vie privée** : ID VORA à la place du numéro, téléphone et e-mail invisibles de l'autre partie, messagerie et appels internes.
- **Espèces** : mode de paiement par défaut ; la commission se règle sur le solde chauffeur.
- **Mobile Money** : MoMo et Orange Money pour payer, recharger et retirer.
- **Bilinguisme** : FR / EN choisi à l'inscription, changeable à tout moment.
- **Saison des pluies** : majoration « pluie » activée par l'ops, plafonnée et affichée.
- **Sécurité de nuit** : identité vérifiée des deux côtés, partage de trajet, SOS, code de montée, plaque visible avant la montée.
- **Motos** : géorepérage des zones autorisées ; casque passager obligatoire dans la charte chauffeur.
- **Fiscalité** : retenue DGI par course, export mensuel.
- **Conformité** : les 7 pièces exigées par le ministère des Transports, rappels d'échéance, blocage à l'expiration.
- **PMR** : option « plus de temps pour embarquer », chauffeurs volontaires priorisés, attente non facturée.

---

## 8. Exigences non fonctionnelles

- **Performance** : rafraîchissement de la position < 5 s ; attribution < 20 s ; démarrage de l'appli < 3 s sur Android 8 / 2 Go de RAM.
- **Réseau** : utilisable en 3G ; dégradation gracieuse (si le service de cartes est indisponible : saisie par repères + prix estimé sur la distance à vol d'oiseau majorée).
- **Appels VORA** : voix sur IP avec codec bas débit (Opus, environ 24 kbit/s), serveur TURN dédié, réveil de l'appli par notification prioritaire, écran d'appel sur verrouillage Android, repli automatique vers le message vocal.
- **Disponibilité** : 99,5 % visée sur les heures de service.
- **Sécurité** : chiffrement en transit, secrets hors du code, rôles minimaux, journal d'audit des actions ops, numéros de téléphone jamais exposés dans les logs.
- **Données personnelles** : conformité à la loi n° 2024/017 du 23 décembre 2024 (APDP) — registre des traitements, consentement explicite à l'inscription, autorisation préalable de traitement, notification des violations, durées de conservation définies (§ 6). Le transfert de données hors du Cameroun nécessite une autorisation : la localisation de l'hébergement est une décision à prendre (§ 12).
- **Réglementaire** : licence spéciale S10 et autorisation ministérielle annuelle au nom de la société exploitante ; retenue et reversement DGI.
- **Observabilité** : logs structurés, métriques (courses, latence d'attribution, erreurs paiement), alertes.
- **Batterie** : GPS adaptatif côté chauffeur, pas de suivi hors ligne.

---

## 9. Orientation technique (détaillée à l'étape « conception logicielle »)

- **Mobile** : Flutter, Android d'abord — deux applis (passager, chauffeur) partageant un package commun (modèles, thème blanc/bleu, client API).
- **Backend** : Node.js (API REST + WebSocket pour le temps réel), PostgreSQL + PostGIS (géofences, requêtes de proximité), Redis (positions en direct, files d'attribution), file de tâches pour SMS / push / reçus.
- **Cartes** : MapLibre avec tuiles OpenStreetMap (auto-hébergées ou fournisseur) ou Google Maps — décision coût / qualité à prendre (§ 12). Géocodage : base de repères VORA en premier, moteur OSM en repli.
- **Intégrations** : SMS OTP via agrégateur local, e-mail transactionnel (codes, reçus, relevés), API MTN MoMo et Orange Money, notifications push.
- **Messagerie et appels** : WebSocket pour les messages, WebRTC avec serveur TURN (coturn) pour les appels VORA, messages vocaux stockés compressés, notifications prioritaires pour les appels entrants.
- **IA en v1 — un seul module, bien fait** : interprétation des descriptions de lieu en langage naturel (« après la pharmacie du carrefour ») vers un repère de la base, avec repli sur la recherche classique. **IA en v2** : prédiction de demande par zone et par heure, détection d'anomalies (détour, supplément), ETA apprise sur les trajets réels.
- **Hébergement** : à trancher au regard de la loi 2024/017 (transfert hors Cameroun soumis à autorisation).

---

## 10. Hors périmètre v1

Livraison de colis · transport interurbain · financement de véhicules · wallet passager complet · iOS au lancement · trajet relais moto → voiture · véhicules adaptés PMR · tarification apprise · super-app (paiement de factures, e-commerce).

---

## 11. Livrables et jalons (indicatifs)

| Jalon | Contenu | Échéance |
|---|---|---|
| J0 | Brief validé (ce document) | Semaine 1 |
| M1 | Charte graphique blanc / bleu, maquettes passager, chauffeur, back-office | Mois 1 |
| M1 | Architecture, modèle de données, dépôt GitHub initialisé, documentation démarrée | Mois 1 |
| M2 → M4 | Développement v1, dans l'ordre : authentification → réservation + tarification → dispatch → espace chauffeur → back-office | Mois 2 à 4 |
| M4 | Dossier S10 déposé ; accords avec syndicats de taxis et associations de motos ; assurance partenaire | Mois 4 |
| M5 | Pilote fermé : 30 voitures + 15 motos, 1 corridor, 4 semaines ; mesure des indicateurs du § 2 ; recalibrage des règles du § 6 | Mois 5 |
| M6 | Lancement public à Yaoundé · pitch · documentation complète · GEO (site public, FAQ, données structurées lisibles par les assistants IA) | Mois 6 |

---

## 12. Décisions à prendre avant la conception logicielle

1. Fournisseur de cartes : coût Google Maps vs. OpenStreetMap auto-hébergé.
2. Intégration MoMo / Orange Money dès la v1, ou repli manuel au lancement.
3. Société exploitante qui portera la licence S10 (forme juridique, capital, gérant).
4. Assurance partenaire couvrant le transport de personnes pour les VTC privés.
5. Mécanisme exact de retenue et de reversement DGI, à valider avec un fiscaliste.
6. Hébergement des données (Cameroun ou étranger avec autorisation APDP).
7. Relais par numéro masqué (v2) : choix de l'opérateur et coût.
8. Fournisseur d'e-mail transactionnel (codes, reçus, relevés chauffeurs).
9. Noms définitifs des offres (Éco / Confort / Moto) et charte des chauffeurs (casque, tenue, comportement).

---

## Sources consultées

- Sanctions du ministère des Transports contre Yango et pièces exigées (mai 2026) : https://leconomie.info/transport-urbain-le-ministere-des-transports-sanctionne-yango-et-six-de-ses-chauffeurs-partenaires/
- Licence spéciale S10 et autorisation annuelle (loi 2001/015, décret 2022) : https://www.droitmediasfinance.com/index.php/actualites/droit-ohada-affaires/453-droit-des-transports-cameroun-la-plate-forme-numerique-de-transport-yango-frappee-de-suspension
- Plateforme ssdtmint.cm, carte bleue vs licence : https://lefisk.cm/blog/licence-transport-cameroun-categories-prix-dossier
- Retenue DGI sur les revenus VTC (Loi de finances 2026) : https://camerounactuel.com/chauffeurs-vtc-ce-que-cache-vraiment-la-nouvelle-taxe-de-1/
- Interdiction des motos-taxis dans le centre urbain de Yaoundé : https://www.stopblablacam.com/societe/1104-12196-lutte-contre-le-desordre-urbain-le-prefet-du-mfoundi-passe-a-la-repression-deja-une-centaine-de-motos-saisies
- Loi n° 2024/017 sur la protection des données à caractère personnel : https://cio-mag.com/protection-des-donnees-au-cameroun-la-course-contre-la-montre-avant-juin-2026/
