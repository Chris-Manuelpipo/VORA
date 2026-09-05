# VORA — Cahier des charges technique (v1)

| | |
|---|---|
| **Document** | CDCT-VORA-001 |
| **Version** | 1.0 · 30 août 2026 |
| **Statut** | Proposé, à valider avant le sprint 0 |
| **Portée** | v1 Yaoundé : appli passager, appli chauffeur, back-office ops, site public, plateforme serveur |
| **Documents liés** | Brief produit MVP v0.2 · Vision UX v0.2 · Charte graphique v1.0 · Maquettes lots 1–5 et site · Document de conception (DC-VORA-001) · Planification (PL-VORA-001) |

Ce document dit **ce que le système doit faire et garantir**, avec des critères vérifiables. Le document de conception dit **comment**. La planification dit **quand et par qui**. Chaque exigence porte un identifiant stable (EF = fonctionnelle, ENF = non fonctionnelle, IF = interface, EL = livraison) réutilisé dans les tickets, les tests et la matrice de traçabilité.

Priorités MoSCoW : **M** must (v1, bloquant pour le lancement), **S** should (v1 si le calendrier tient, sinon v1.1), **C** could (v2), **W** won't (hors périmètre).

---

## 1. Objet et périmètre

### 1.1 Objet

Construire la plateforme VORA : commande de courses en voiture et en moto-taxi à Yaoundé, avec prix ferme avant commande, chauffeurs vérifiés, dispatch géorepéré, paiement en espèces et Mobile Money, messagerie et appels internes, et un back-office d'exploitation.

### 1.2 Composants livrés en v1

| Composant | Cible | Rôle |
|---|---|---|
| **Appli passager** | Android 8+ | Commander, suivre, payer, se protéger, retrouver ses reçus |
| **Appli chauffeur** | Android 8+ | Déposer son dossier, se mettre en ligne, accepter, naviguer, encaisser, gérer solde et pièces |
| **Back-office ops** | Web (navigateurs récents) | Vérifier les dossiers, surveiller, arbitrer, régler zones et tarifs, exporter |
| **Site public** | Web responsive | Présenter, convertir, FAQ, données structurées |
| **Plateforme serveur** | API + temps réel + tâches | Tout le métier : identité, courses, dispatch, prix, paiements, messagerie, notifications |

### 1.3 Hors périmètre v1 (W)

iOS au lancement · livraison de colis · interurbain · financement de véhicules · wallet passager complet · trajet relais moto → voiture · véhicules PMR adaptés · tarification apprise · relais d'appel par numéro masqué (v2) · traduction automatique des messages (v2) · comptes entreprises (v2) · OCR des pièces (v2).

### 1.4 Hypothèses

- Une seule ville (Yaoundé) en v1, mais le modèle de données est multi-villes dès le départ (Douala ensuite).
- Une société exploitante camerounaise porte la licence S10 et les contrats (opérateurs, SMS, assurance).
- Équipe de développement de 2 à 3 personnes plus un profil ops/produit (voir PL-VORA-001).

---

## 2. Parties prenantes

| Partie | Attentes vis-à-vis du système |
|---|---|
| Passagers | Prix connu et tenu, chauffeur identifiable, sécurité, fonctionne avec un réseau faible et un téléphone d'entrée de gamme |
| Chauffeurs (taxis jaunes, VTC, motos) | Net visible avant d'accepter, paiement fiable, annulations compensées, dossier simple, pas d'ennuis avec la police |
| Équipe ops VORA | Voir le service, traiter vite, arbitrer avec des preuves, ne jamais manipuler un numéro de téléphone sans raison |
| Ministère des Transports, préfecture | Véhicules en règle, motos hors du centre urbain, traçabilité |
| DGI | Retenue de 1 % collectée et reversée, export mensuel |
| APDP (données personnelles) | Minimisation, consentement, conservation limitée, hébergement déclaré, droits des personnes |
| Opérateurs (MTN, Orange) | Intégrations conformes à leurs API, réconciliation |

---

## 3. Contexte et contraintes

| Contrainte | Conséquence technique |
|---|---|
| **Réseau** : 3G/4G instable, coupures fréquentes, data chère | Tout appel réseau est idempotent et rejouable ; file d'attente locale ; payloads compacts ; cartes en cache ; repli SMS quand un téléphone est vérifié |
| **Appareils** : Android d'entrée de gamme, 2 Go de RAM, batteries faibles | APK < 25 Mo, démarrage < 3 s, GPS adaptatif, pas de flou ni d'animation coûteuse dans les applis |
| **Réglementaire** : loi 2001/015 et décret 2022 (licence S10), arrêté préfectoral motos, loi de finances 2026 (retenue 1 %), loi 2024/017 (données personnelles) | Pièces obligatoires et expiration bloquante ; géorepérage moto côté serveur ; retenue calculée par course et exportable ; registre des traitements, consentement, transfert hors Cameroun soumis à autorisation |
| **Paiement** : espèces majoritaires, MoMo et Orange Money | Ledger en double entrée ; solde de commission avec plafond ; intégrations opérateurs avec réconciliation |
| **Langue** : FR et EN | Toutes les chaînes externalisées ; SMS et notifications dans la langue du compte |
| **Adressage** : repères plutôt qu'adresses | Base de repères propriétaire, recherche tolérante, point de rendez-vous corrigeable |
| **Équipe réduite** | Monolithe modulaire, un seul dépôt, automatisation maximale, peu de composants à exploiter |

---

## 4. Exigences fonctionnelles

Chaque exigence est suivie de ses critères d'acceptation (CA), écrits pour devenir des tests.

### 4.1 Identité et comptes

| ID | Exigence | Priorité |
|---|---|---|
| EF-ID-01 | Création de compte par téléphone (+237, code SMS, repli appel vocal) **ou** par e-mail (code à 6 chiffres). Au moins un canal vérifié. | M |
| EF-ID-02 | Génération d'un **ID VORA** unique, 8 chiffres, non modifiable, affiché en deux groupes ; jamais utilisable seul pour se connecter. | M |
| EF-ID-03 | Téléphone et e-mail ne sont jamais exposés à un autre utilisateur, ni dans une réponse d'API destinée à un autre utilisateur, ni dans un reçu de l'autre partie. | M |
| EF-ID-04 | Chauffeur : téléphone obligatoire et vérifié ; e-mail facultatif ; un seul appareil actif à la fois. | M |
| EF-ID-05 | Sessions par jeton d'accès court et jeton de rafraîchissement rotatif ; déconnexion à distance par l'ops. | M |
| EF-ID-06 | Profil : prénom, photo optionnelle, langue, contacts de confiance (≤ 3), mode de paiement par défaut, option accessibilité. | M |
| EF-ID-07 | Ajout ou changement de canal après inscription, avec nouvelle vérification. | S |
| EF-ID-08 | Suppression de compte à la demande, avec anonymisation des données non soumises à obligation de conservation. | S |

**CA-ID-01** — Étant donné un numéro camerounais valide, quand le passager demande un code, alors un SMS part en < 10 s, le code expire après 10 min, 5 tentatives maximum, puis blocage 15 min ; le repli « appel vocal » est proposé après 60 s.
**CA-ID-02** — Un compte créé par e-mail seul peut commander une course ; les notifications de secours passent par e-mail et push, aucun SMS n'est tenté.
**CA-ID-03** — Deux ID VORA ne peuvent pas entrer en collision (contrainte d'unicité en base et test de charge à 1 million de générations).
**CA-ID-04** — Un chauffeur qui se connecte sur un second appareil est déconnecté du premier, avec notification.

### 4.2 Réservation et géolocalisation

| ID | Exigence | Priorité |
|---|---|---|
| EF-RES-01 | Position courante avec correction manuelle ; recherche de destination par repères VORA d'abord (nom usuel, alias, quartier), puis géocodage cartographique. | M |
| EF-RES-02 | Point de rendez-vous : aiguille déplaçable, note courte, photo optionnelle, repère le plus proche proposé. | M |
| EF-RES-03 | Favoris (Maison, Travail, + 3) et récents. | M |
| EF-RES-04 | Choix d'offre Éco / Confort / Moto ; Moto masquée si départ, arrivée ou itinéraire touche une zone interdite. | M |
| EF-RES-05 | Prix ferme et décomposition affichés avant la commande ; devis figé à la commande (validité 2 min). | M |
| EF-RES-06 | Suivi en temps réel du chauffeur (position ≤ 5 s), ETA, plaque, photo, note, badge Vérifié. | M |
| EF-RES-07 | Code de montée à 4 chiffres, unique par course, validé côté serveur. | M |
| EF-RES-08 | Ajout d'un arrêt pendant la course avec recalcul affiché et accepté par les deux parties. | S |
| EF-RES-09 | Partage de trajet par lien public temporaire (position, plaque, ETA), révocable. | M |
| EF-RES-10 | Base de repères enrichie par les recherches sans résultat et les points de rendez-vous confirmés (crowdsourcing modéré par l'ops). | S |
| EF-RES-11 | Réservation programmée. | C |

**CA-RES-01** — La recherche « acacias » retourne « Carrefour Acacias · Biyem-Assi » en tête en < 300 ms (p95) avec 10 000 repères en base.
**CA-RES-04** — Pour un trajet Emana → Centre-ville, l'offre Moto n'est pas proposée ; l'API refuse une demande Moto forcée avec le code `MOTO_ZONE_FORBIDDEN`.
**CA-RES-05** — Deux devis identiques (mêmes points, même offre, même version tarifaire, même fenêtre de majoration) donnent le même prix ; le prix commandé est celui du devis même si la grille change entre-temps.
**CA-RES-07** — Un code faux est refusé ; trois codes faux consécutifs génèrent une alerte ops ; un code correct fait passer la course en « En cours ».

### 4.3 Tarification

| ID | Exigence | Priorité |
|---|---|---|
| EF-TAR-01 | Prix = max(minimum, base + tarif/km × km + tarif/min × min) par offre, grille versionnée par ville. | M |
| EF-TAR-02 | Majorations nuit (horaire) et pluie (activation ops avec durée), affichées comme lignes séparées, plafond global × 1,5 verrouillé. | M |
| EF-TAR-03 | Commission 15 % (voiture) ou forfait 50 F (moto) ; retenue DGI 1 % du brut ; net chauffeur calculé et affiché avant acceptation. | M |
| EF-TAR-04 | Frais d'annulation tardive (300 F / 100 F) et de passager absent, reversés au chauffeur ; attente facturée après franchise. | M |
| EF-TAR-05 | Simulateur dans le back-office et publication versionnée de la grille (aucune modification sans publication). | M |

**CA-TAR-01** — 5,0 km / 15 min Éco de jour = 1 625 F ; de nuit = 2 031 F ; de nuit et pluie + 30 % = plafonné à 2 437 F (× 1,5).
**CA-TAR-03** — Course Éco 1 625 F : commission 244 F, DGI 16 F, net 1 365 F ; Moto 380 F : forfait 50 F, DGI 4 F, net 326 F. Les arrondis sont au franc, documentés et identiques sur les trois surfaces.

### 4.4 Dispatch

| ID | Exigence | Priorité |
|---|---|---|
| EF-DIS-01 | Recherche de candidats par rayon croissant (1 → 3 → 5 km) parmi les chauffeurs en ligne, vérifiés, de l'offre demandée, non bloqués par le passager. | M |
| EF-DIS-02 | Score = ETA d'approche + taux d'acceptation + taux d'annulation + note ; envoi séquentiel, 15 s par chauffeur, 3 vagues maximum. | M |
| EF-DIS-03 | Géorepérage moto côté serveur : aucune offre moto dont départ, arrivée ou itinéraire intersecte une zone interdite. | M |
| EF-DIS-04 | Réattribution automatique si le chauffeur n'a pas progressé en 3 min ou annule ; pénalités de priorité et pauses selon le brief. | M |
| EF-DIS-05 | Bonus de zone (montant, horaire, zone) activable par l'ops et affiché aux chauffeurs. | M |
| EF-DIS-06 | Prédiction de demande, chaînage des courses retour, file d'attente aux hubs. | C |

**CA-DIS-02** — Avec 20 chauffeurs éligibles, une demande reçoit au plus 3 offres successives ; aucune offre n'est envoyée à deux chauffeurs en même temps ; le refus ou l'expiration passe au suivant en < 1 s.
**CA-DIS-03** — Test de non-régression sur 50 trajets de référence (25 autorisés, 25 interdits) rejoués à chaque déploiement.

### 4.5 Cycle de vie d'une course

| ID | Exigence | Priorité |
|---|---|---|
| EF-CRS-01 | Machine à états unique, côté serveur, conforme au diagramme `VORA_cycle_de_vie_course.mermaid` ; toute transition est journalisée (événement horodaté, acteur, contexte). | M |
| EF-CRS-02 | Statuts et délais identiques sur les trois surfaces ; l'ops voit le même statut que les deux applis. | M |
| EF-CRS-03 | Annulation : gratuite 2 min ou < 300 m parcourus ; tardive avec frais reversés ; passager absent après 5 / 3 min d'attente avec preuve GPS. | M |
| EF-CRS-04 | Traces GPS des deux téléphones enregistrées pendant la course (1 point / 5 s) et conservées 90 jours, sauf litige ouvert. | M |
| EF-CRS-05 | Notation des deux côtés avec tags ; blocage d'un passager par un chauffeur. | M |
| EF-CRS-06 | Litige : ouverture, chronologie, pièces (traces, prix, conversation), décision, messages sortants, sanctions graduées. | M |

**CA-CRS-01** — Une transition invalide (par exemple « Terminée » depuis « Demandée ») est refusée avec `INVALID_TRANSITION` et n'écrit rien.
**CA-CRS-03** — Le chauffeur ne peut clôturer « passager absent » qu'après la franchise, et seulement s'il est à moins de 100 m du point de rendez-vous depuis au moins la franchise.

### 4.6 Paiements et ledger

| ID | Exigence | Priorité |
|---|---|---|
| EF-PAY-01 | Espèces : confirmation « Paiement reçu » par le chauffeur ; commission et retenue portées au débit de son solde. | M |
| EF-PAY-02 | MTN MoMo et Orange Money : demande de paiement (collecte) déclenchée à la fin de course, confirmation par retour opérateur, repli espèces. | M (MoMo) / S (Orange Money) |
| EF-PAY-03 | Ledger en double entrée : comptes chauffeur, commission VORA, retenue DGI à reverser, compensations ; toute écriture est immuable et rattachée à une transaction. | M |
| EF-PAY-04 | Solde chauffeur : dette de commission avec plafond (5 000 F / 1 500 F) bloquant la mise en ligne ; recharge par MoMo ; retrait des encaissements in-app par MoMo (décaissement). | M |
| EF-PAY-05 | Compensation d'annulation créditée immédiatement au chauffeur, débitée au passager sur sa prochaine course. | M |
| EF-PAY-06 | Réconciliation quotidienne des transactions opérateur ; retrait > 10 min annulé et recrédité. | M |
| EF-PAY-07 | Export mensuel DGI (retenues par chauffeur) et comptable (CSV). | M |

**CA-PAY-03** — Pour toute transaction, la somme des débits égale la somme des crédits (contrainte vérifiée par test et par job quotidien qui alerte en cas d'écart).
**CA-PAY-04** — Un chauffeur à 5 001 F de dette ne reçoit aucune offre ; une recharge de 1 F au-dessous du plafond le remet en ligne sans action manuelle.

### 4.7 Messagerie et appels VORA

| ID | Exigence | Priorité |
|---|---|---|
| EF-MSG-01 | Conversation liée à la course, ouverte à l'acceptation, fermée 30 min après la fin ; texte, messages prédéfinis, message vocal ≤ 10 s. | M |
| EF-MSG-02 | Appel VORA en voix sur IP entre les deux parties, sans exposer de numéro ; sonnerie 30 s ; repli proposé vers le message vocal après 10 s sans réponse ou réseau insuffisant. | M |
| EF-MSG-03 | Appel entrant affiché par-dessus le verrouillage et la navigation, haut-parleur par défaut côté chauffeur en conduite. | M |
| EF-MSG-04 | Historique conservé 90 jours ; lecture par l'ops uniquement sur litige ouvert, journalisée. | M |
| EF-MSG-05 | Relais par numéro masqué opérateur ; traduction FR/EN. | C |

**CA-MSG-02** — Sur un réseau émulé à 200 kbit/s et 300 ms de latence, l'appel s'établit en < 6 s dans 90 % des cas ; en cas d'échec, l'écran de repli vocal s'affiche en < 10 s.

### 4.8 Sécurité des personnes

| ID | Exigence | Priorité |
|---|---|---|
| EF-SOS-01 | SOS passager et chauffeur : bouton + confirmation ; envoi de la position en direct, de la course et des identités à l'ops et aux contacts de confiance (SMS avec lien de suivi). | M |
| EF-SOS-02 | Alerte SOS en tête du tableau de bord ops avec appels VORA en un clic et suivi live jusqu'à résolution. | M |
| EF-SOS-03 | Appel police 117 depuis l'écran SOS. | M |

### 4.9 Dossier chauffeur et conformité

| ID | Exigence | Priorité |
|---|---|---|
| EF-KYC-01 | Dossier en 5 étapes, sauvegardé à chaque étape ; 7 pièces avec dates d'expiration ; photos guidées avec contrôle de netteté sur l'appareil. | M |
| EF-KYC-02 | Revue par l'ops pièce par pièce, motifs types, message pré-rédigé, validation globale conditionnelle. | M |
| EF-KYC-03 | Rappels J-30, J-7, J ; suspension automatique à l'expiration ; réactivation automatique à la validation de la nouvelle pièce. | M |
| EF-KYC-04 | Pièces stockées chiffrées, accessibles uniquement par URL signée de courte durée, accès journalisé. | M |
| EF-KYC-05 | Guide en 6 écrans et charte à accepter avant la première mise en ligne ; sanctions graduées (3 manquements confirmés = exclusion). | M |

### 4.10 Espace chauffeur

| ID | Exigence | Priorité |
|---|---|---|
| EF-CHF-01 | En ligne / hors ligne, offres actives, position toutes les 5 s (15 s à l'arrêt), bonus de zone, zones moto visibles. | M |
| EF-CHF-02 | Demande plein écran avec destination, approche, net, paiement ; 15 s ; Accepter / Passer. | M |
| EF-CHF-03 | Navigation vers le rendez-vous et la destination (cartes et itinéraires en cache local). | M |
| EF-CHF-04 | Gains jour / semaine / mois, détail par course, compensations, solde, mouvements. | M |
| EF-CHF-05 | Mode nuit automatique 19 h – 6 h. | M |

### 4.11 Back-office ops

| ID | Exigence | Priorité |
|---|---|---|
| EF-OPS-01 | Rôles admin / ops / lecture ; authentification à deux facteurs ; journal d'audit de toutes les actions. | M |
| EF-OPS-02 | Tableau de bord : SOS, compteurs du jour avec objectifs, carte live, files à traiter, demandes sans chauffeur par zone. | M |
| EF-OPS-03 | Dossiers, fiche chauffeur, litiges, zones (édition et publication), tarifs (édition, simulateur, publication), exports. | M |
| EF-OPS-04 | Recherche par ID VORA, plaque, nom, numéro de course. | M |
| EF-OPS-05 | Le numéro de téléphone d'un chauffeur n'est visible que sur sa fiche, pour les rôles admin et ops, avec journalisation de l'affichage. | M |

### 4.12 Notifications et transversal

| ID | Exigence | Priorité |
|---|---|---|
| EF-NOT-01 | Push (FCM) pour tous les événements du brief ; SMS de secours pour « chauffeur trouvé / arrivé » et reçu si téléphone vérifié ; e-mail sinon. | M |
| EF-NOT-02 | Aucune notification marketing en v1 ; toutes les notifications dans la langue du compte. | M |
| EF-I18N-01 | FR et EN sur les trois surfaces ; formats de montants (« 1 625 F »), d'heures (24 h) et de distances conformes à la charte. | M |
| EF-OFF-01 | Hors ligne : file d'attente locale des commandes et messages avec clés d'idempotence ; reprise automatique ; bandeau d'état ; cache des tuiles et de l'itinéraire en cours. | M |
| EF-ANA-01 | Événements produit anonymisés pour les indicateurs du brief (§ 2) et tableau de bord hebdomadaire. | S |

---

## 5. Exigences non fonctionnelles

| ID | Domaine | Exigence mesurable |
|---|---|---|
| ENF-PERF-01 | Latence API | p95 < 400 ms pour les lectures, < 800 ms pour la création de course (hors réseau mobile), mesuré côté serveur |
| ENF-PERF-02 | Devis | Prix ferme calculé et retourné en < 1,5 s p95 incluant le routage |
| ENF-PERF-03 | Attribution | Première offre envoyée < 3 s après la commande ; bascule au chauffeur suivant < 1 s après refus ou expiration |
| ENF-PERF-04 | Temps réel | Position du chauffeur visible par le passager avec un retard < 5 s p95 |
| ENF-PERF-05 | Mobile | Démarrage à froid < 3 s sur Android 8 / 2 Go ; APK < 25 Mo ; consommation GPS < 6 % de batterie par heure en ligne |
| ENF-DISP-01 | Disponibilité | SLO 99,5 % sur les heures de service (6 h – 24 h) mesuré sur la création de course et l'attribution ; budget d'erreur ≈ 2,7 h / mois |
| ENF-DISP-02 | Dégradation | Sans service de cartes : commande possible par repères avec prix estimé ; sans opérateur MoMo : repli espèces ; sans push : SMS/e-mail |
| ENF-SCAL-01 | Charge | Dimensionné pour 10 × la cible an 1 (6 000 courses/jour, 2 000 chauffeurs en ligne, 400 positions/s) sans changement d'architecture |
| ENF-SEC-01 | Sécurité applicative | OWASP ASVS niveau 2 ; TLS 1.2+ partout ; secrets hors du code ; dépendances scannées à chaque build |
| ENF-SEC-02 | Authentification | OTP limités (5 essais, 15 min de blocage, 3 envois / heure par cible) ; jetons d'accès ≤ 15 min ; refresh rotatif avec détection de réutilisation |
| ENF-SEC-03 | Données sensibles | Téléphone, e-mail, pièces KYC chiffrés au repos ; clés gérées hors base ; accès aux pièces par URL signée ≤ 5 min |
| ENF-SEC-04 | Audit | Toute action ops et toute lecture de conversation ou de numéro sont journalisées (qui, quoi, quand, pourquoi) et conservées 2 ans |
| ENF-PRIV-01 | Données personnelles | Registre des traitements, consentement à l'inscription, droits d'accès et de suppression, conservation : positions 90 jours, conversations 90 jours, pièces KYC pendant l'affiliation + 1 an, journaux 2 ans |
| ENF-PRIV-02 | Hébergement | Localisation des données déclarée ; si hors Cameroun, autorisation APDP obtenue avant le lancement public |
| ENF-RES-01 | Résilience mobile | Perte de réseau de 2 min pendant une course : reprise du suivi sans action, aucune perte de message ni de commande |
| ENF-RES-02 | Sauvegardes | Base sauvegardée toutes les 6 h + archives WAL continues ; RPO ≤ 15 min ; RTO ≤ 2 h ; restauration testée chaque mois |
| ENF-OBS-01 | Observabilité | Journaux structurés, métriques (courses, latences, files, erreurs paiement), traces distribuées ; alertes sur SLO, files d'attente, échecs paiement, erreurs mobiles |
| ENF-MAINT-01 | Maintenabilité | Couverture de tests ≥ 80 % sur les modules Pricing, Dispatch, Ledger, Rides ; OpenAPI à jour à chaque version ; ADR pour toute décision structurante |
| ENF-ACC-01 | Accessibilité | Contrastes AA (charte), cibles ≥ 48 dp, textes ≥ 14 sp, lecteur d'écran sur la boucle passager |
| ENF-COST-01 | Coût | Infrastructure < 200 € / mois jusqu'à 1 000 courses / jour ; coût variable dominé par les SMS, plafonné par le repli e-mail et push |

---

## 6. Interfaces externes

| ID | Interface | Usage | Exigences |
|---|---|---|---|
| IF-01 | MTN MoMo API (Collections, Disbursements) | Encaissement in-app, recharge, retrait | Sandbox puis production ; idempotence par référence ; traitement des retours asynchrones ; réconciliation quotidienne |
| IF-02 | Orange Money API | Idem, second opérateur | Même contrat d'adaptateur ; activable par drapeau |
| IF-03 | Agrégateur SMS camerounais (avec secours international) | OTP, secours course, reçus, alertes SOS | Délai < 10 s p95 ; expéditeur « VORA » ; suivi des accusés ; bascule automatique de fournisseur |
| IF-04 | Appel vocal OTP | Repli quand le SMS n'arrive pas | Lecture du code en FR/EN |
| IF-05 | E-mail transactionnel | Codes, reçus, relevés | Domaine authentifié (SPF, DKIM, DMARC) |
| IF-06 | Notifications push (FCM) | Tous les événements | Priorité haute pour demandes et appels ; canaux Android distincts |
| IF-07 | Tuiles cartographiques | Cartes des trois surfaces | Auto-hébergées (extrait Cameroun), style charte, cache client |
| IF-08 | Routage | Distance, durée, itinéraire pour prix, ETA, géorepérage, navigation | Serveur de routage auto-hébergé sur l'extrait Cameroun ; < 200 ms p95 |
| IF-09 | Géocodage | Repli derrière la base de repères | Serveur auto-hébergé ou fournisseur, sans clé exposée côté client |
| IF-10 | TURN / STUN | Appels VORA derrière NAT opérateur | Identifiants temporaires ; bande passante mesurée |
| IF-11 | Google Play | Distribution, tests internes et fermés | Signature, mise à jour forcée par version minimale |
| IF-12 | Export DGI et comptable | Obligations fiscales | CSV signés, périodes mensuelles, archivage 10 ans |

---

## 7. Données

### 7.1 Classification

| Classe | Exemples | Règles |
|---|---|---|
| **P3 — sensible** | Téléphone, e-mail, pièces d'identité et véhicule, traces GPS, conversations, alertes SOS | Chiffrement au repos, accès journalisé, conservation limitée, jamais dans les journaux applicatifs |
| **P2 — interne** | Courses, prix, ledger, notations, litiges, tarifs, zones | Accès par rôle, sauvegardes chiffrées |
| **P1 — publique** | Repères, zones publiées, grille tarifaire publiée, FAQ | Diffusable |

### 7.2 Conservation

| Donnée | Durée | Base |
|---|---|---|
| Positions pendant une course | 90 jours (prolongé tant qu'un litige est ouvert) | Litiges, sécurité |
| Positions hors course (chauffeur en ligne) | Temps réel seulement, jamais persistées au-delà de 24 h | Minimisation |
| Conversations et vocaux | 90 jours | Litiges |
| Pièces KYC | Affiliation + 1 an | Obligation de contrôle |
| Ledger, reçus, exports fiscaux | 10 ans | Obligation comptable |
| Journaux d'audit | 2 ans | Sécurité |
| Compte supprimé | Anonymisation sous 30 jours, sauf données à conservation légale | Droits des personnes |

---

## 8. Exigences de livraison

| ID | Exigence |
|---|---|
| EL-01 | Un dépôt unique (monorepo) : `apps/passager`, `apps/chauffeur`, `apps/backoffice`, `apps/site`, `services/api`, `packages/*`, `infra/`, `docs/` |
| EL-02 | Trois environnements : `dev` (local, Docker), `staging` (copie de production, données synthétiques, bacs à sable opérateurs), `prod` |
| EL-03 | Intégration continue sur chaque demande de fusion : lint, tests unitaires et d'intégration, build, analyse de dépendances, vérification OpenAPI ; aucune fusion sans revue |
| EL-04 | Déploiement continu vers staging ; déploiement en production par étiquette de version, avec migration de base réversible et retour arrière documenté |
| EL-05 | Distribution mobile par les pistes Google Play : interne (équipe) → fermée (pilote) → ouverte ; version minimale imposée par le serveur |
| EL-06 | Documentation livrée : OpenAPI, ADR, runbooks (incidents, restauration, rotation des secrets, opérateurs en panne), guide d'installation dev en < 30 min |
| EL-07 | Recette : plan de tests couvrant tous les CA de ce document, jeu de données de référence (50 trajets, 20 chauffeurs, 10 zones), rapport de charge sur le dispatch et le temps réel |
| EL-08 | Revue de préparation au lancement (LRR) validée avant le pilote fermé et avant le lancement public (liste en PL-VORA-001 § 7) |

---

## 9. Matrice de traçabilité (extrait)

| Exigence | Écrans (vision UX) | Module (DC) | Tests |
|---|---|---|---|
| EF-ID-01, 02, 03 | PA-03, PA-04, PA-05, CH-02 | Identity | unit OTP, e2e inscription, test collision ID |
| EF-RES-04, EF-DIS-03 | PA-11, CH-10, OP-05 | Geo, Dispatch | 50 trajets de référence |
| EF-RES-05, EF-TAR-* | PA-11, OP-06 | Pricing | table de vérité tarifaire |
| EF-DIS-01, 02, 04 | PA-12, CH-10, CH-11 | Dispatch | simulation 20 chauffeurs, chaos réseau |
| EF-CRS-* | PA-13 → PA-16, CH-11 → CH-15, OP-07 | Rides | tests de transitions exhaustifs |
| EF-PAY-* | PA-15, CH-14, CH-17, OP-08 | Payments, Ledger | invariant débit = crédit, bac à sable MoMo |
| EF-MSG-* | PA-23, PA-24, CH-21, CH-22 | Messaging, Calls | réseau émulé, test TURN |
| EF-SOS-* | PA-22, CH-20, OP-02 | Safety | e2e SOS avec SMS |
| EF-KYC-* | CH-03 → CH-08, CH-18, OP-03, OP-04 | Compliance | workflow, expiration, URL signées |

La matrice complète vit dans `docs/traceability.csv` et est régénérée à chaque version.

---

## 10. Glossaire

**Devis (quote)** : prix ferme calculé pour un trajet, figé 2 min, référencé par la course. **Offre (dispatch offer)** : proposition de course envoyée à un chauffeur, valable 15 s. **Vague** : série d'offres successives ; 3 vagues maximum. **Ledger** : grand livre en double entrée où toute somme d'argent entre, sort ou change de compte. **Repère** : point nommé de la base VORA (carrefour, commerce, école) utilisé à la place d'une adresse. **Zone** : polygone publié (autorisée / interdite motos, corridor, bonus). **ID VORA** : identifiant à 8 chiffres d'un compte. **LRR** : revue de préparation au lancement. **SLO** : objectif de niveau de service mesuré.
