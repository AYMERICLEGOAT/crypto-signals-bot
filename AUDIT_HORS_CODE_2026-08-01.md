# Audit hors-code — 01/08/2026

Audit de ce qui bloque le projet en tant qu'**activité**, pas en tant que
logiciel. Le code est en bon état après les correctifs du jour ; ce document
porte sur le juridique, le commercial, l'opérationnel et l'acquisition.

Classement par gravité réelle, pas par facilité de correction.

---

## 🔴 BLOQUANT — à traiter avant d'encaisser le prochain paiement

### 1. Aucune identification légale de l'éditeur

Le site vendait des abonnements sans publier l'identité du vendeur. C'est une
obligation de l'article 6-III de la LCEN, sanctionnée jusqu'à 75 000 € d'amende
pour une personne physique. Aucune page de mentions légales n'existait.

**Fait aujourd'hui :** page `public/mentions-legales.html` créée, liée depuis
toutes les pages et ajoutée au sitemap, avec la structure complète et
l'hébergeur renseigné.

**Reste à faire (toi seul peux le fournir) :** nom, statut juridique, adresse,
e-mail, SIREN/SIRET, TVA, directeur de la publication. Tant que ces champs
affichent `[À COMPLÉTER]`, ne pas encaisser.

### 2. Statut juridique et déclaration des revenus

Encaisser des abonnements est une activité commerciale. Sans structure
déclarée (micro-entreprise au minimum), il s'agit de travail dissimulé, et les
revenus crypto non déclarés s'ajoutent au problème.

**Action :** créer une micro-entreprise (gratuit, en ligne, ~15 min sur le
guichet unique INPI) avant la prochaine vente. Le seuil de franchise de TVA
(art. 293 B du CGI) évite la TVA au démarrage — à mentionner dans les
mentions légales.

### 3. Consentement à la renonciation au droit de rétractation

Les CGV affirmaient que l'abonné renonce à ses 14 jours de rétractation, mais
ce consentement n'était **jamais recueilli**. L'article L221-28 13° du code de
la consommation exige un accord préalable *exprès* ET la reconnaissance
expresse de la perte du droit — une clause dans les CGV ne suffit pas. Sans
ça, un abonné peut exiger le remboursement pendant 14 jours, voire 12 mois si
l'information manque.

**Fait aujourd'hui :** étape de consentement explicite ajoutée dans le bot
entre le choix de l'offre et le paiement (bouton « J'ai compris et j'accepte »),
avec rappel des trois points clés et lien vers les CGV. Le clic est horodaté
dans les journaux du Worker.

**Amélioration possible :** persister le consentement en base (colonne dédiée)
pour une preuve plus robuste qu'un journal applicatif.

### 4. Médiateur de la consommation absent

Obligatoire pour tout professionnel vendant à des consommateurs
(art. L612-1 du code de la consommation). Aucun n'est désigné.

**Action :** adhérer à un organisme agréé (coût typique 50-200 €/an) et
renseigner ses coordonnées dans les mentions légales.

### 5. Cadre réglementaire MiCA — à faire valider

Fournir des « conseils sur les crypto-actifs » est un service réglementé par
le règlement européen MiCA. Le service diffuse des analyses identiques à tous
les abonnés, ce qui le rapproche de l'information générique plutôt que du
conseil personnalisé — mais la frontière dépend de la façon dont c'est
présenté et commercialisé.

**Action :** faire valider par un juriste avant de développer l'activité.
Je ne peux pas trancher ce point, et ce document n'est pas un avis juridique.

---

## 🟠 CRITIQUE — le produit ne tient pas sa promesse implicite

### 6. L'espérance de la stratégie est négative sur 24 mois

Mesuré aujourd'hui : **−0,0191 % par trade** sur 24 mois, malgré la correction
de géométrie qui a réellement amélioré les choses. Détail et méthode dans
`signals/DIAGNOSTIC_SIGNAUX_2026-08-01.md`.

C'est le vrai problème du projet. Vendre un abonnement à des signaux dont la
mesure interne dit qu'ils perdent de l'argent en moyenne est intenable —
commercialement (les abonnés partent), juridiquement (pratique commerciale
trompeuse si la communication laisse croire l'inverse) et humainement.

**Fait aujourd'hui :** `signals/edge_guard.py` suspend automatiquement la
diffusion si l'espérance réalisée devient nettement négative sur ≥30 trades
clôturés, avec alerte admin.

**Décision produit à prendre :** soit repositionner l'offre sur ce qui est
réellement défendable (discipline, transparence, pédagogie), soit suspendre la
vente le temps de trouver un edge démontrable. Continuer à vendre « des
signaux performants » n'est pas une option tenable.

### 7. Aucun historique réel à montrer

2 signaux émis depuis la création, tous deux encore ouverts. La page
transparence et le journal public sont vides de contenu significatif. Un
prospect n'a rien pour juger.

Le correctif de rattrapage déployé aujourd'hui devrait amener ~2,6 signaux/jour.
**Attendre 3-4 semaines de données réelles avant toute campagne d'acquisition** :
lancer maintenant, c'est brûler les prospects sur une page vide.

---

## 🟡 IMPORTANT — ce qui bloque la croissance

### 8. Le paiement en crypto uniquement tue la conversion

Pour s'abonner, il faut posséder de l'USDT sur Polygon (ou XMR, ou LTC) et
savoir faire un transfert on-chain. C'est probablement le premier frein de
conversion : la grande majorité des prospects intéressés par des signaux crypto
n'ont pas de wallet approvisionné sur le bon réseau.

**Options, par ordre de rapport effort/impact :**
- Ajouter un moyen de paiement classique (Stripe, Lemon Squeezy). Lemon Squeezy
  agit comme *merchant of record* et gère la TVA européenne à ta place —
  intéressant vu le point 2.
- À défaut, un guide pas-à-pas « acheter 19 USDT et les envoyer » avec captures.
  Le guide de paiement existe déjà mais suppose des fonds déjà disponibles.

### 9. Twitter et Reddit hors service depuis le début

- Twitter : erreur 403, l'application n'a pas la permission OAuth1 « Read and
  Write ». Trois exécutions en échec.
- Reddit : les quatre secrets ne sont pas renseignés. Trois exécutions en échec.
- Discord et le site fonctionnent.

Deux des quatre canaux d'acquisition n'ont donc jamais rien publié.

**Action :** activer « Read and Write » dans le portail développeur X puis
régénérer les tokens ; renseigner les secrets Reddit. Ne pas relancer les
workflows avant d'avoir le point 7 (contenu à montrer).

### 10. Proposition de valeur indifférenciée

« Signaux crypto avec TP/SL » décrit des centaines de canaux Telegram, dont
beaucoup mentent sur leurs résultats. Rien ne distingue l'offre au premier
regard.

**Angle réellement disponible et rare :** la transparence intégrale — code
source public, journal de chaque trade gagnant *et perdant*, suspension
automatique si la performance se dégrade. Presque aucun concurrent ne peut
s'aligner là-dessus, parce que presque aucun ne le supporterait.

C'est aussi le seul positionnement cohérent avec le point 6.

---

## 🟢 ROBUSTESSE — risques opérationnels

### 11. Point de défaillance unique : une seule personne

Un seul administrateur, un seul compte Telegram, un seul projet Supabase, un
seul compte Cloudflare. Une perte d'accès (téléphone perdu, compte suspendu)
arrête tout sans recours, avec des abonnés payants en cours.

**Actions :** activer la 2FA partout, conserver les codes de secours hors
ligne, et documenter la procédure de reprise (où sont les secrets, comment
redéployer).

### 12. Restauration jamais testée en conditions réelles

La sauvegarde tourne et va dans un bucket Supabase privé. `restore_db.py`
existe mais n'a été exécuté qu'en simulation. Une sauvegarde dont la
restauration n'a jamais été testée n'est pas une sauvegarde.

**Action :** créer un projet Supabase de test et y restaurer une sauvegarde
complète, une fois.

### 13. `.dev.vars` n'était pas ignoré par git

Le fichier contient le jeton du bot, la clé secrète Supabase et une clé privée
Polygon. Il n'a jamais été commité — vérifié sur tout l'historique — mais rien
n'empêchait un `git add -A` de l'exposer définitivement sur un dépôt public.

**Fait aujourd'hui :** ajouté à `.gitignore`.

**Reste à faire :** la clé privée Polygon dans `.dev.vars` ne sert plus à rien
depuis la suppression du code on-chain (Audit#30). Si ce wallet détient encore
des fonds, les transférer et abandonner la clé.

---

## Ordre d'exécution recommandé

1. **Suspendre les nouvelles ventes** jusqu'aux points 1 à 4 (quelques heures
   de démarches, pas de développement).
2. Créer la micro-entreprise, compléter les mentions légales, adhérer à un
   médiateur.
3. Laisser tourner 3-4 semaines pour accumuler un historique réel (point 7),
   `edge_guard` surveille.
4. Décider du repositionnement produit sur la base des chiffres réels (point 6).
5. Seulement ensuite : ajouter un paiement classique (point 8), réparer les
   canaux sociaux (point 9), lancer l'acquisition sur l'angle transparence
   (point 10).

Faire l'inverse — acquérir d'abord — reviendrait à amener des gens sur une
offre qui n'est ni juridiquement en règle, ni démontrablement performante.
