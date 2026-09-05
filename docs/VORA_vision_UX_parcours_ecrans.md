# VORA — Vision UX, parcours et inventaire d'écrans (v1)

**Version** 0.2 · 30 août 2026 · **Statut** : validé ; mis à jour pour l'ID VORA, l'inscription par téléphone ou e-mail et la messagerie / appel VORA
**Périmètre** : appli passager, appli chauffeur, back-office ops · Yaoundé · voitures + motos

Le brief produit dit *quoi* (fonctionnalités, règles). Ce document dit *comment on le vit* (parcours, écrans, états). Les maquettes diront *à quoi ça ressemble*. Rien ici ne rouvre le périmètre du brief : chaque écran ci-dessous sert une fonction déjà décidée.

---

## 1. Vision UX

> Commander une course VORA doit être aussi simple que héler un taxi au carrefour, et aussi sûr que monter avec quelqu'un qu'on connaît. Le chauffeur doit savoir, avant d'accepter, exactement où il va et ce qu'il gagne.

### Les trois moments de vérité

Tout le reste de l'expérience existe pour réussir ces trois instants. Si l'un échoue, le reste ne compte plus.

1. **Le prix s'affiche avant la commande, et ne bouge plus.** C'est le moment où le passager décide de faire confiance.
2. **Le chauffeur arrive comme promis.** Bonne plaque, bon endroit, à l'heure annoncée, sans négociation à la portière.
3. **Le chauffeur voit son net après la course.** Le montant qu'il gardera, sans surprise. C'est le moment où il décide de rester.

### Principes d'expérience

| Principe | Ce que ça impose |
|---|---|
| **Trois gestes pour commander** | Destination → offre → Commander. Jamais plus de trois écrans entre l'accueil et la commande. Tout le reste (point de rendez-vous, paiement, contacts) est optionnel ou pré-rempli. |
| **Le prix avant tout** | Aucun « estimation », aucun « à partir de ». Le prix ferme et sa décomposition sont visibles avant le bouton Commander, sur le même écran. |
| **On ne cache rien au chauffeur** | Destination, distance d'approche, net estimé et mode de paiement sont sur l'écran de demande, avant d'accepter. Pas de destination masquée. |
| **Ça marche à une main, au soleil, avec une barre de réseau** | Boutons ≥ 48 px, actions principales en bas d'écran, fond blanc, tolérance aux coupures : la commande se met en file d'attente, le suivi reprend seul. |
| **Le GPS n'a jamais le dernier mot** | Position corrigeable sur la carte, recherche par repères, photo et note du point de rendez-vous. On ne fait jamais confiance à un point GPS sans le montrer. |
| **La sécurité est un geste, pas un menu** | SOS visible pendant toute la course, partage de trajet en un tap, code de montée sur l'écran d'approche. Aucun réglage à faire pour être protégé. |
| **Pas de surprise, pas de silence** | Chaque attente a une explication (« Recherche d'un chauffeur… 20 s », « Réseau faible »), chaque erreur a une action suivante. L'appli ne laisse jamais un écran figé. |
| **Une langue choisie une fois** | FR ou EN au premier lancement, changeable dans le profil. Tous les SMS suivent la langue choisie. |
| **Rien de personnel ne circule** | Numéro et e-mail invisibles de l'autre partie ; ID VORA comme identifiant ; messagerie, message vocal et appel VORA intégrés à la course. |

### Ce que VORA ne fera pas vivre

- Pas de tarification qui change pendant la recherche de chauffeur.
- Pas de « promo » qui masque le vrai prix.
- Pas de notification marketing dans les 30 premiers jours après l'installation.
- Pas de demande de note obligatoire : la notation se ferme d'un geste.

---

## 2. Les trois produits

| Produit | Personne | Ce qu'elle doit pouvoir faire seule, sans support |
|---|---|---|
| **Appli passager** (Android) | Aïcha, Marc, Maman Rose | S'inscrire, commander, suivre, payer, se protéger, retrouver un reçu, signaler |
| **Appli chauffeur** (Android) | Boris, Ismaël | Déposer son dossier, se mettre en ligne, accepter, naviguer, encaisser, comprendre ses gains, tenir ses pièces à jour |
| **Back-office ops** (web) | Équipe VORA | Vérifier les dossiers, surveiller la carte, arbitrer les litiges, dessiner les zones, régler les tarifs, exporter |

Un canal transversal : les **SMS transactionnels** (OTP, chauffeur en approche avec plaque, reçu, alerte SOS). Ils doublent l'appli quand la data manque.

---

## 3. Parcours passager

Chaque étape indique ce que la personne vit, ce que l'appli doit dire, et l'écran concerné (voir inventaire § 7).

| Étape | Ce que vit le passager | Ce que l'appli fait ou dit | Écrans |
|---|---|---|---|
| **Installer** | Aïcha a entendu parler de VORA par une amie. Data limitée. | APK légère, pas de vidéo au premier lancement. Langue en premier. | PA-01, PA-02 |
| **S'inscrire** | Elle ne veut pas remplir un formulaire, et ne veut pas donner son numéro à des inconnus. | Téléphone ou e-mail au choix, code à 6 chiffres (repli appel vocal pour le SMS), prénom, ID VORA généré et expliqué. Photo et contacts de confiance proposés, ignorables. Permission localisation expliquée avant la demande système. | PA-03 → PA-07 |
| **Arriver sur l'accueil** | Elle est sur le campus, il est 21 h. | Carte centrée, sa position corrigeable, « Où allez-vous ? », favoris (Maison, Travail), repères proches, dernières destinations. Rien d'autre. | PA-08 |
| **Dire où elle va** | Elle pense « Biyem-Assi, carrefour Acacias », pas à une rue. | Recherche qui propose d'abord les repères VORA, puis la carte. Résultat en une ligne : nom usuel + quartier. | PA-09 |
| **Préciser le rendez-vous** (optionnel) | Le GPS la met de l'autre côté du carrefour. | Aiguille déplaçable, photo et note courte (« devant la boulangerie »). Sautable. | PA-10 |
| **Choisir et voir le prix** | Elle veut savoir combien avant de s'engager. | Éco / Confort / Moto avec prix ferme, décomposition dépliable, ETA. Moto absente si hors zone. Mode de paiement pré-sélectionné (espèces). Bouton « Commander · 1 625 F ». | PA-11 |
| **Attendre un chauffeur** | Le moment d'incertitude. | Compteur visible, rayon de recherche animé, « 3 chauffeurs contactés ». Si aucun : « Aucun chauffeur disponible pour l'instant » + « Attendre 2 min » / « Réessayer ». Jamais un spinner muet. | PA-12 |
| **Voir le chauffeur arriver** | Elle veut la plaque et le visage, et savoir que c'est bien lui. | Carte chauffeur (photo, prénom, plaque, véhicule, note, badge Vérifié), ETA, position en direct, **code de montée** en gros, actions : Appel VORA, Message (texte, prédéfini ou vocal), Partager mon trajet, Annuler (avec le décompte de l'annulation gratuite). SMS de secours avec la plaque si un téléphone est vérifié. | PA-13, PA-21 |
| **Monter** | Elle dit le code, il démarre la course. | L'écran passe en mode course quand le chauffeur valide le code. | PA-13 → PA-14 |
| **Être en course** | Elle veut se sentir en sécurité, surtout la nuit. | Itinéraire, ETA d'arrivée, **SOS** toujours visible, partage actif (« Marie suit votre trajet »), ajouter un arrêt (recalcul affiché). | PA-14, PA-22 |
| **Arriver et payer** | Elle a le montant exact en tête depuis le début. | Montant identique, choix espèces / MoMo, reçu par SMS. Si MoMo refusé : message clair + repli espèces. | PA-15 |
| **Noter (ou pas)** | Elle est pressée. | Étoiles + tags en un tap, dont « On m'a demandé plus que le prix ». Fermable d'un geste. | PA-16 |
| **Retrouver plus tard** | Un reçu pour se faire rembourser, un litige. | Mes courses, détail avec reçu et « Signaler un problème ». | PA-17, PA-18 |
| **Gérer** | Changer de langue, ajouter un contact de confiance, joindre le support. | Profil sobre ; support avec FAQ, chat et numéro. | PA-19, PA-20 |

**Cas Maman Rose** : l'option « J'ai besoin de plus de temps pour embarquer » est dans le profil et rappelée sur PA-11 ; elle allonge l'attente gratuite et priorise les chauffeurs volontaires. Aucun écran supplémentaire.

**Cas Marc (quotidien)** : depuis l'accueil, un tap sur le favori « Travail » ouvre directement PA-11 avec l'offre et le paiement habituels. Deux gestes au total.

---

## 4. Parcours chauffeur

| Étape | Ce que vit le chauffeur | Ce que l'appli fait ou dit | Écrans |
|---|---|---|---|
| **S'inscrire** | Boris a entendu que VORA prend 15 %. Il est méfiant. | Téléphone obligatoire (c'est là qu'arrivent ses gains) mais invisible des passagers, code SMS, e-mail facultatif, puis le dossier en 5 étapes avec sauvegarde à chaque étape (il peut reprendre plus tard). Chaque pièce : photo guidée + date d'expiration. | CH-01 → CH-06 |
| **Attendre la vérification** | Il veut savoir où en est son dossier. | Récapitulatif avec statut par pièce, délai annoncé (48 h ouvrées), motif précis en cas de refus, renvoi d'une seule pièce sans tout refaire. SMS à chaque changement de statut. | CH-07 |
| **Comprendre les règles** | Il n'a pas le temps de lire. | Guide en 6 écrans (une image, une phrase) + charte à accepter : code de montée, prix ferme, pas de supplément, casques pour les motos. | CH-08 |
| **Se mettre en ligne** | Il est à un carrefour, il attend. | Bouton En ligne / Hors ligne plein largeur, offres actives, zone de bonus si elle existe, zones interdites pour les motos. Gains du jour en un coup d'œil. | CH-09 |
| **Recevoir une demande** | Il a 15 secondes et une main sur le volant. | Plein écran, sonnerie distincte : départ, destination, distance d'approche, **net pour vous**, paiement. Anneau de 15 s. Accepter (gros) / Passer (petit). | CH-10 |
| **Aller chercher** | Il veut trouver la personne, pas un point GPS. | Navigation, note et photo du point de rendez-vous, appel VORA et messagerie, « Je suis arrivé ». Chronomètre d'attente, puis « Passager absent » avec la trace conservée. | CH-11 |
| **Faire monter** | Il vérifie que c'est le bon passager. | Saisie du code à 4 chiffres, gros pavé. Erreur : « Ce n'est pas le bon code, demandez-le au passager ». | CH-12 |
| **Conduire** | Il conduit, il ne lit pas. | Navigation plein écran, SOS chauffeur, arrêt ajouté par le passager signalé par une voix et une bannière. Mode nuit automatique. | CH-13 |
| **Encaisser** | Le moment qui décide s'il reste. | Montant passager, mode, « Paiement reçu » à confirmer pour les espèces ; MoMo confirmé automatiquement. Puis **net gagné** en gros, avec commission et retenue en petit. | CH-14 |
| **Noter le passager** | Rare, mais il veut pouvoir bloquer quelqu'un. | Étoiles + « Bloquer ce passager ». Fermable. | CH-15 |
| **Comprendre ses gains** | Fin de journée, il compte. | Jour / semaine / mois, détail par course, compensations d'annulation visibles séparément. | CH-16 |
| **Gérer son solde** | Il a fait 10 courses en espèces, il doit de la commission. | Solde clair (« Vous devez 2 100 F »), plafond expliqué, recharge MoMo en deux taps, retrait des gains encaissés dans l'appli. Compte bloqué = message qui dit exactement quoi faire. | CH-17 |
| **Tenir ses pièces** | Sa visite technique expire dans 3 semaines. | Liste avec dates, rappels J-30 / J-7, renvoi d'une pièce. | CH-18 |

**Cas Ismaël (moto)** : mêmes écrans. Différences : offres limitées à Moto, carte avec zones interdites toujours visibles, demande refusée en amont si elle sort de zone (il ne la voit jamais), forfait de 50 F affiché à la place du pourcentage, plafond de dette 1 500 F.

---

## 5. Parcours ops

| Tâche | Fréquence | Ce que l'outil doit permettre en moins d'une minute | Écran |
|---|---|---|---|
| Vérifier un dossier chauffeur | 10 à 30 / jour au lancement | Voir les pièces côte à côte, valider, refuser avec motif type, demander une seule pièce | OP-03, OP-04 |
| Surveiller le service | Continu | Carte live (chauffeurs en ligne, courses), compteurs (demandes, acceptations, annulations, temps d'attente), alertes SOS en tête | OP-02 |
| Arbitrer un litige | Quelques / jour | Trace GPS des deux côtés, prix calculé, messages, décision (rembourser, compenser, sanctionner) | OP-07 |
| Activer la majoration pluie | Quelques / semaine | Un bouton, une durée, un message aux chauffeurs | OP-06 |
| Dessiner ou modifier une zone | Rare | Éditeur de polygones, zones moto autorisées / interdites, bonus de zone | OP-05 |
| Exporter pour la DGI et la compta | Mensuel | Export CSV par période | OP-08 |

---

## 6. Architecture d'information

### Appli passager — 3 onglets

```
Accueil (carte)            Mes courses              Profil
├─ Où allez-vous ?         ├─ En cours              ├─ Langue FR / EN
├─ Favoris                 ├─ Passées               ├─ ID VORA, téléphone, e-mail
│                          │                        ├─ Contacts de confiance
├─ Repères proches         │   └─ Détail + reçu     ├─ Paiement (espèces / MoMo)
└─ Sécurité (accès SOS,    │       └─ Signaler      ├─ Accessibilité (temps d'embarquement)
   partage, contacts)      └─ Annulées              ├─ Aide et support
                                                    └─ À propos / Mentions légales
```

L'onglet Accueil est l'appli. Les deux autres servent à revenir en arrière (reçus, litiges) et à régler (langue, contacts). Pas de menu latéral, pas de quatrième onglet en v1.

### Appli chauffeur — 4 onglets

```
En ligne (carte)           Gains                    Pièces                   Profil
├─ En ligne / Hors ligne   ├─ Aujourd'hui           ├─ Statut par pièce      ├─ Véhicule et offres
├─ Offres actives          ├─ Semaine / mois        ├─ Dates d'expiration    ├─ Langue
├─ Bonus de zone           ├─ Détail par course     └─ Renvoyer une pièce    ├─ Guide et charte
├─ Zones moto              └─ Solde et MoMo                                  ├─ ID VORA, téléphone (invisible), e-mail
│                              │                                              ├─ Aide et support
└─ Demande (plein écran,       ├─ Recharger                                  └─ Se déconnecter
   par-dessus tout)            └─ Retirer
```

La demande de course, le SOS, la messagerie et l'appel VORA sont des écrans superposés : ils s'affichent par-dessus n'importe quel onglet.

### Back-office — menu latéral

Tableau de bord · Dossiers · Chauffeurs · Courses et litiges · Zones · Tarifs · Exports · Équipe (rôles).

---

## 7. Inventaire des écrans

Priorité de maquettage : **P1** = boucle centrale (à dessiner d'abord), **P2** = onboarding et gestion, **P3** = rare ou back-office.

### 7.1 Appli passager

| ID | Écran | Objectif | Éléments clés | États à dessiner | Priorité |
|---|---|---|---|---|---|
| PA-01 | Démarrage | Charger | Symbole, mot VORA | — | P2 |
| PA-02 | Langue et bienvenue | Choisir FR / EN | Deux grands boutons, une phrase de promesse | — | P2 |
| PA-03 | Créer un compte | Identifier par téléphone ou e-mail | Sélecteur Téléphone / E-mail, champ, promesse « jamais montré aux chauffeurs » | Erreur de format, réseau absent | P2 |
| PA-04 | Code de vérification | Vérifier | 6 cases, renvoyer (SMS, appel vocal ou e-mail), compte à rebours | Code faux, délai dépassé, e-mail non reçu | P2 |
| PA-05 | Prénom, photo et ID VORA | Personnaliser, montrer l'identifiant | Prénom obligatoire, photo optionnelle, encadré ID VORA expliqué | — | P2 |
| PA-06 | Permission localisation | Expliquer avant de demander | Une phrase, un bouton, « Plus tard » | Refus (accueil sans position, saisie manuelle) | P2 |
| PA-07 | Contacts de confiance | Préparer la sécurité | Jusqu'à 3 contacts, « Plus tard » | — | P2 |
| PA-08 | Accueil (carte) | Commander vite | Carte, position, champ « Où allez-vous ? », favoris, repères proches, onglets | Sans position, hors ligne, course en cours (bandeau), première visite | **P1** |
| PA-09 | Recherche de destination | Trouver un lieu par repère | Champ, suggestions repères VORA, récents, favoris, « Choisir sur la carte » | Aucun résultat (proposer la carte), hors ligne (récents seulement) | **P1** |
| PA-10 | Point de rendez-vous | Préciser où attendre | Aiguille déplaçable, photo, note, « C'est ici » | — | P2 |
| PA-11 | Offre et prix | Décider en connaissance | Puces Éco / Confort / Moto, prix ferme, décomposition, ETA, paiement, accessibilité, bouton Commander avec montant | Moto indisponible (hors zone), majoration active, prix en recalcul (réseau) | **P1** |
| PA-12 | Recherche de chauffeur | Rassurer pendant l'attente | Compteur, rayon animé, « chauffeurs contactés », Annuler | Trouvé (transition), aucun chauffeur (attendre / réessayer) | **P1** |
| PA-13 | Chauffeur en approche | Reconnaître et se préparer | Carte + position live, carte chauffeur (photo, prénom, plaque, véhicule, note, Vérifié), ETA, code de montée, Appel VORA, Message, Partager, Annuler | Chauffeur arrivé, décompte annulation gratuite terminé, réattribution en cours, hors ligne (SMS envoyé) | **P1** |
| PA-14 | En course | Se sentir en sécurité | Itinéraire, ETA, SOS, partage actif, ajouter un arrêt | Arrêt ajouté (prix recalculé), détour signalé | **P1** |
| PA-15 | Fin de course et paiement | Payer sans surprise | Montant, espèces / MoMo, reçu | MoMo en attente, MoMo refusé, payé | **P1** |
| PA-16 | Notation et signalement | Donner un retour en 5 s | Étoiles, tags, « Supplément demandé », fermer | — | **P1** |
| PA-17 | Mes courses | Retrouver | Liste par date, montant, statut | Vide (première fois) | P2 |
| PA-18 | Détail de course | Reçu et litige | Trajet, prix, chauffeur, reçu, « Signaler un problème » | Litige ouvert / résolu | P2 |
| PA-19 | Profil et paramètres | Régler | Langue, contacts, paiement, accessibilité | — | P2 |
| PA-20 | Aide et support | Être aidé | FAQ, chat, appeler | Hors ligne (numéro seulement) | P3 |
| PA-21 | Annulation (feuille) | Annuler en connaissance | « Gratuit pendant encore 1 min 20 » ou « 300 F reversés au chauffeur », motif | — | **P1** |
| PA-22 | SOS (feuille) | Alerter en 2 gestes | Appui long ou confirmation, contacts alertés, position envoyée, appeler la police | Envoyé | **P1** |
| PA-23 | Messagerie VORA | Se parler sans numéro | Conversation liée à la course, messages prédéfinis, message vocal 10 s, bouton d'appel | Hors ligne (envoi en attente), conversation fermée | **P1** |
| PA-24 | Appel VORA | Appeler sans numéro | Écran d'appel sortant et entrant, muet, haut-parleur, raccrocher, repli vocal | Sonnerie, en cours, échec (proposer le vocal) | **P1** |

### 7.2 Appli chauffeur

| ID | Écran | Objectif | Éléments clés | États à dessiner | Priorité |
|---|---|---|---|---|---|
| CH-01 | Langue et bienvenue | Choisir FR / EN | Promesse chauffeur : « Chaque trajet compte » | — | P2 |
| CH-02 | Téléphone et code | Identifier et préparer les paiements | Téléphone obligatoire et invisible, e-mail facultatif, liste des pièces annoncée | Erreurs | P2 |
| CH-03 | Dossier : identité | CNI + selfie | Photo guidée recto/verso, selfie | Photo floue (reprendre) | P2 |
| CH-04 | Dossier : permis | Permis + expiration | Photo, date | — | P2 |
| CH-05 | Dossier : véhicule | Carte grise, assurance, visite technique, photos, plaque | 3 pièces + dates, 2 photos du véhicule | Moto : casques photographiés | P2 |
| CH-06 | Dossier : professionnel | Licence / carte bleue, capacité T | 2 pièces + dates | — | P2 |
| CH-07 | Récapitulatif et statut | Savoir où on en est | Statut par pièce, délai, motif de refus, renvoyer une pièce | En revue, refusé, vérifié, expiré | P2 |
| CH-08 | Guide et charte | Comprendre en 2 min | 6 écrans image + phrase, acceptation de la charte | — | P2 |
| CH-09 | En ligne (carte) | Travailler | Bouton En ligne / Hors ligne, offres actives, gains du jour, bonus de zone, zones moto | Hors ligne, en ligne sans demande, compte bloqué (dette), pièce expirée | **P1** |
| CH-10 | Demande de course | Décider en 15 s | Départ, destination, approche, net, paiement, anneau 15 s, Accepter / Passer | Demande expirée, demande annulée avant réponse | **P1** |
| CH-11 | Approche | Trouver le passager | Navigation, note et photo du RDV, appel VORA et messagerie, « Je suis arrivé », chrono d'attente, « Passager absent » | Attente dépassée, passager a annulé (compensation affichée) | **P1** |
| CH-12 | Code de montée | Vérifier le passager | Pavé 4 chiffres | Code faux | **P1** |
| CH-13 | En course | Conduire | Navigation, SOS, bannière d'arrêt ajouté | Mode nuit, réseau faible (navigation locale) | **P1** |
| CH-14 | Encaissement | Confirmer et voir le net | Montant passager, mode, « Paiement reçu », net gagné, détail | MoMo en attente, espèces non confirmées | **P1** |
| CH-15 | Notation passager | Retour et blocage | Étoiles, bloquer, fermer | — | P2 |
| CH-16 | Gains | Comprendre | Jour / semaine / mois, courbe simple, détail par course, compensations | Vide (première journée) | **P1** |
| CH-17 | Solde et MoMo | Régler et retirer | Solde, dette, plafond, Recharger, Retirer | Dette au plafond, retrait en cours | P2 |
| CH-18 | Pièces | Rester en règle | Liste, dates, rappels, renvoyer | Expire bientôt, expirée (compte suspendu) | P2 |
| CH-19 | Profil et aide | Régler, être aidé | Véhicule, offres, langue, guide, support, déconnexion | — | P3 |
| CH-20 | SOS chauffeur (feuille) | Alerter | Comme passager | Envoyé | P2 |
| CH-21 | Messagerie VORA | Se parler sans numéro | Comme PA-23, en mode nuit, enregistrement vocal à une main | Hors ligne | **P1** |
| CH-22 | Appel VORA entrant / sortant | Répondre en conduisant | Appel entrant sur verrouillage, répondre / refuser, « Répondre par message », haut-parleur par défaut | Réseau faible (repli vocal) | **P1** |

### 7.3 Back-office ops

| ID | Écran | Objectif | Éléments clés | Priorité |
|---|---|---|---|---|
| OP-01 | Connexion | Sécuriser | E-mail, mot de passe, rôle | P3 |
| OP-02 | Tableau de bord | Voir le service vivre | Carte live, compteurs du jour, alertes SOS, files (dossiers, litiges) | P3 |
| OP-03 | File des dossiers | Traiter vite | Liste triée par ancienneté, filtre voiture / moto, ouverture d'un dossier | P3 |
| OP-04 | Fiche chauffeur | Décider | Pièces côte à côte avec zoom, dates, historique, sanctions, valider / refuser (motifs types) / demander une pièce | P3 |
| OP-05 | Zones | Dessiner | Carte, polygones autorisés / interdits motos, bonus de zone, corridors | P3 |
| OP-06 | Tarifs et majorations | Régler | Grille par offre, majoration nuit, bouton pluie avec durée, aperçu d'un prix type | P3 |
| OP-07 | Courses et litiges | Arbitrer | Liste, détail d'une course (deux traces GPS, prix, messages), décision et sanction | P3 |
| OP-08 | Exports | Sortir les données | Période, type (DGI, paiements, courses), CSV | P3 |

**Total** : 24 écrans passager, 22 chauffeur, 8 ops. Boucle centrale P1 : 12 écrans passager + 9 chauffeur. C'est par là que commencent les maquettes.

---

## 8. États transversaux (à dessiner une fois, à réutiliser partout)

| État | Règle | Exemple |
|---|---|---|
| **Chargement** | Squelettes gris clair, jamais un écran blanc de plus d'une seconde ; sur les boutons, roue sans libellé | « Recherche d'un chauffeur… 12 s » |
| **Hors ligne** | Bandeau orange en haut, fonctionnalités locales conservées (récents, reçus), actions mises en file avec message | « Pas de réseau. Votre commande partira dès le retour de la connexion. » |
| **Erreur** | Message qui dit ce qui s'est passé et l'action suivante ; jamais de code technique | « Paiement MoMo refusé. Solde insuffisant. Réessayez ou choisissez Espèces. » |
| **Vide** | Une phrase qui invite à agir, jamais une illustration seule | « Aucune course pour l'instant. Restez en ligne près d'un carrefour. » |
| **Permission refusée** | L'appli continue en mode dégradé et explique ce qui manque | Accueil sans position : « Indiquez votre point de départ » |
| **Compte bloqué / suspendu** | Écran plein qui dit pourquoi et comment débloquer, avec le bouton qui débloque | « Solde à régler : 5 200 F. Rechargez pour repasser en ligne. » |

---

## 9. Notifications et SMS

| Événement | Passager | Chauffeur | Canal |
|---|---|---|---|
| Code de vérification | ✓ | ✓ | SMS (repli appel vocal) ou e-mail |
| Chauffeur trouvé | ✓ | — | Push + SMS si téléphone vérifié, sinon e-mail (prénom, plaque, véhicule, ETA) |
| Chauffeur arrivé | ✓ | — | Push + SMS |
| Nouvelle demande | — | ✓ | Push plein écran + sonnerie distincte |
| Nouveau message ou vocal | ✓ | ✓ | Push |
| Appel VORA entrant | ✓ | ✓ | Push prioritaire + sonnerie, écran d'appel sur verrouillage |
| Annulation de l'autre partie | ✓ | ✓ | Push (avec compensation côté chauffeur) |
| Reçu de course | ✓ | — | SMS |
| Paiement MoMo confirmé | ✓ | ✓ | Push |
| Alerte SOS | contacts | ops | SMS aux contacts + alerte back-office |
| Dossier : changement de statut | — | ✓ | SMS + push |
| Pièce expire (J-30, J-7, J) | — | ✓ | Push + SMS |
| Solde proche du plafond | — | ✓ | Push |
| Bonus de zone activé | — | ✓ | Push (zone, montant, durée) |

Aucune notification marketing en v1. Toute notification est dans la langue du compte.

---

## 10. Cycle de vie d'une course

Le diagramme d'états livré avec ce document (`VORA_cycle_de_vie_course.mermaid`) fixe les statuts, les transitions et les délais. Les deux applis et le back-office affichent le **même** statut au même moment ; c'est la condition pour que les litiges soient arbitrables.

Statuts : Brouillon → Demandée → Proposée → Acceptée → En approche → Arrivé (attente) → En cours → Terminée → Payée → Notée, avec les sorties Expirée, Annulée (gratuite / tardive / par le chauffeur), Passager absent, Litige.

---

## 11. Plan de maquettage

| Lot | Contenu | Format |
|---|---|---|
| **Lot 1 — boucle passager** | PA-08, 09, 11, 12, 13, 14, 15, 16, 21, 22, 23, 24 avec leurs états | Android 360 × 800 dp, FR, mode clair |
| **Lot 2 — boucle chauffeur** | CH-09, 10, 11, 12, 13, 14, 16, 21, 22 avec leurs états, dont le mode nuit | Android 360 × 800 dp, FR, clair + nuit |
| **Lot 3 — onboarding** | PA-02 → 07, CH-01 → 08 | Android, FR |
| **Lot 4 — gestion** | PA-17 → 20, CH-15, 17, 18, 19 | Android, FR |
| **Lot 5 — back-office** | OP-02, 03, 04, 07 d'abord | Web 1440 px |
| **Lot 6 — site web** | Site public : passagers, chauffeurs, FAQ, données structurées lisibles par les assistants IA | Web 1440 px + mobile |

Chaque lot est livré avec un flux cliquable (enchaînement des écrans) et la liste des composants de la charte utilisés. Aucun composant nouveau sans mise à jour de la charte.

---

## 12. Décisions à valider avant le lot 1

1. **Onglets passager** : 3 onglets (Accueil, Mes courses, Profil) ou accueil seul avec menu ? Recommandation : 3 onglets.
2. **SOS** : appui long (2 s) ou bouton + confirmation ? Recommandation : bouton + confirmation en une feuille, appui long en v2.
3. **Contacts de confiance** : proposés à l'inscription (PA-07) ou seulement au premier trajet de nuit ? Recommandation : à l'inscription, ignorable.
4. **Confirmation des espèces côté chauffeur** : obligatoire (« Paiement reçu ») ou implicite à la fin de course ? Recommandation : obligatoire, c'est la base des litiges.
5. **Messagerie** — tranché le 30 août : chat, messages prédéfinis, message vocal et appel VORA en v1 ; relais par numéro masqué en v2.
6. **Identité** — tranché le 30 août : ID VORA généré, inscription par téléphone ou e-mail (un canal vérifié minimum), téléphone obligatoire et invisible pour les chauffeurs.
