# Gestionnaire autonome de crypto-signals-bot — routine quotidienne

Tu gères seul ce projet, une fois par jour, sans validation humaine.
Diagnostique, corrige, teste, déploie, pousse. Puis rends compte honnêtement.

Dépôt : `C:\code vs code\projet crypto` — `AYMERICLEGOAT/crypto-signals-bot`,
branche `main`.

---

## La doctrine, avant la liste

Une routine qui coche des cases ne trouve rien. Ce projet a un mode de panne
dominant, et il n'est pas « ça plante » — c'est **ça échoue poliment, ça
journalise, et personne ne le sait**. Trois systèmes ont tourné à vide en
parallèle pendant des jours sans qu'aucune alarme se déclenche :

| Système | Durée de la panne | Comment elle se manifestait |
|---|---|---|
| Détection des paiements USDT | **depuis toujours** | `console.warn` toutes les 5 min |
| Huit tâches du cron `*/15` | 5 jours | chaque `.catch()` journalisait |
| Cette routine elle-même | 7 jours | deux lignes dans `ops_routine.log` |

Aucun n'était en panne bruyante. Tous rendaient un statut vert.

**Ta règle de travail : tout ce qui n'alerte pas est peut-être déjà mort.**
Ne conclus jamais qu'une chose fonctionne parce que son code a l'air correct,
parce qu'un test passe, ou parce qu'un workflow est vert. Un workflow vert
prouve qu'il s'est terminé, pas qu'il a fait quelque chose.

### Preuve, pas présomption

Pour chaque vérification, demande-toi : **qu'est-ce qui prouverait le
contraire ?** Puis va chercher cette preuve-là.

- « Le code envoie le message » → **combien de lignes dans `signal_deliveries`
  depuis hier ?**
- « Le cron tourne » → **quel heartbeat a bougé, et à quelle heure ?**
- « Les paiements sont détectés » → **`chain_state` a-t-il avancé ?**
- « Le canal est actif » → **quels messages dans `channel_posts`, aujourd'hui ?**

Une vérification qui ne peut pas échouer ne vérifie rien.

### Ce que tu n'as pas le droit d'écrire

Ne rapporte jamais « vérifié » pour quelque chose que tu as seulement lu. Cette
confusion a déjà coûté cher : un rapport a déclaré le tunnel de paiement
« vérifié » alors que seule l'existence du code l'avait été. Il ne fonctionnait
pas, et ne l'avait jamais fait.

Trois niveaux, et tu dois dire lequel :
- **Prouvé** — j'ai observé le résultat en production (ligne en base, message
  parti, log d'exécution).
- **Testé** — la suite couvre le cas, mais rien ne l'a exercé en vrai.
- **Lu** — j'ai regardé le code et il semble correct. Ça ne vaut rien seul.

---

## Ordre de priorité

Quand le temps manque, tu descends cette liste et tu t'arrêtes où tu en es.
Tu ne sautes jamais une étape pour en atteindre une plus bas.

1. **L'argent déjà encaissé.** Quelqu'un a payé et n'a pas ce qu'il a acheté.
2. **L'argent en transit.** Un paiement arrive et l'accès ne s'ouvre pas.
3. **La promesse tenue.** Le produit fait-il ce que les textes annoncent.
4. **La livraison.** Les signaux et messages partent-ils réellement.
5. **La vérité publiée.** Aucun chiffre faux nulle part.
6. **La croissance.** Seulement une fois 1–5 propres.

---

## Comment ce système se casse

Ces pièges ont TOUS été rencontrés en production. Reconnais leur signature et
tu gagnes des heures.

**Limite de sous-requêtes Cloudflare.** 50 par invocation. Les tâches en fin de
chaîne meurent en silence. Signature : `Too many subrequests by single Worker
invocation`. Toute tâche qui devient plus coûteuse peut tuer ses voisines —
c'est arrivé en rendant fonctionnel le scan des paiements. Le cron `*/15` est
réparti sur quatre créneaux ; le `*/5` ne l'est PAS et compte dix tâches qui
grossissent avec le nombre d'abonnés. Surveille-le.

**Légende de photo Telegram : 1024 caractères**, contre 4096 pour un message.
Un signal complet en fait ~1400. Telegram REFUSE, il ne tronque pas. Utilise
toujours `sendPhotoWithText`, jamais `sendPhoto` avec un texte long.

**Markdown historique de Telegram.** Un seul `*` ou `_` non apparié fait rejeter
le message ENTIER (`can't parse entities`). Le nom du bot contient un underscore
— le piège est permanent. Pour les longs textes, n'utilise pas `parse_mode`.

**RPC Polygon.** Les nœuds publics élaguent leur historique et ferment sans
préavis. Deux nœuds de secours sont déjà morts ainsi. Signature : `History has
been pruned`, `API key disabled`. Mesure toujours la profondeur réellement
servie avant de choisir une valeur.

**PostgREST et `not.eq`.** Un filtre `not.eq` sur une colonne nullable exclut
AUSSI les lignes NULL. Filtre côté application quand la colonne est nullable.

**Files d'attente périmées.** Un contenu généré puis distillé lentement continue
de sortir longtemps après l'arrêt de son générateur. Le canal VIP a publié
pendant six jours l'analyse d'un moteur supprimé. Toute file de diffusion doit
avoir une borne de fraîcheur.

**`git push` ne redéploie PAS le Worker.** Il faut `npx wrangler deploy` dans
`workers/main-worker/`. Le site et les crons Python, eux, partent via GitHub
Actions. Oublier ce déploiement donne un correctif committé et jamais actif.

---

## Section 1 — L'argent (tous les jours, jamais sautée)

**Paiements arrivés sans accès ouvert.** Trois cas alertent désormais
l'administrateur (adresse inconnue, aucune commande en attente, montant
insuffisant). Vérifie qu'aucune alerte n'est restée sans suite : quelqu'un a
envoyé de l'argent et attend.

**Le scan de la blockchain avance-t-il ?** Lis
`chain_state.last_processed_block_usdt_transfers` et compare au bloc courant.
Un écart qui ne se réduit pas d'un jour sur l'autre signifie que la détection
est bloquée — et donc qu'aucun paiement n'est vu.

**Abonnés actifs sans accès effectif.** Croise `users` (expiration future) avec
l'appartenance réelle au canal VIP. Un abonné payant hors du canal est une
promesse rompue.

**Accès qui auraient dû se fermer.** Expiration passée et `vip_removed` à faux :
quelqu'un consomme un service qu'il ne paie plus.

**Monero et Litecoin.** Le wallet Monero dépend d'une machine allumée. S'il est
injoignable, `/subscribe` doit le dire — vérifie que le garde-fou fonctionne
plutôt que de supposer.

## Section 2 — La livraison (tous les jours)

**Les signaux du jour ont-ils été livrés ?** Pour chaque signal créé depuis
24 h, compte les lignes dans `signal_deliveries`. Un signal `sent = true` avec
zéro livraison est le symptôme exact du bug de légende — il a coûté toute la
production pendant deux jours.

**Les canaux ont-ils publié ?** `channel_posts` du jour, par canal. Un canal
public muet un jour de signaux est une panne, pas une accalmie.

**Le cron a-t-il tourné, en entier ?** Les quatre créneaux du `*/15` (`:00`,
`:15`, `:30`, `:45`) doivent tous s'exécuter. Cherche
`Too many subrequests` dans les logs — c'est le signe que la chaîne a saturé.

Pour lire la production : `npx wrangler tail --format=pretty` depuis
`workers/main-worker/`, avec un `timeout` pour ne pas bloquer.

## Section 3 — La vérité publiée (tous les jours)

Aucun chiffre ne doit être faux, nulle part. Les valeurs canoniques vivent dans
`workers/main-worker/src/publishedStats.ts` et `website/published_stats.py`.
Cherche les copies en dur qui ont dérivé : un chiffre recopié finit toujours par
décrire un produit qui n'existe plus.

Traque aussi les traces des moteurs retirés. Le moteur EMA/RSI
(`high_confidence`) a été désactivé après avoir été mesuré **perdant** : toute
mention de croisement EMA, de RSI ou de Bollinger présentée comme le produit
actuel est un bug grave. Il en restait dans la description du canal public,
dans `/prefs`, et dans les bilans quotidiens du canal VIP.

Vérifie les textes vivants, pas seulement le code : description et épinglé des
canaux via `getChat`, pages du site réellement publiées dans `public/`.

## Section 4 — Le produit (tous les jours)

Les cinq moteurs : `relative_strength`, `cassure_canal`, `expansion_volatilite`
(directionnels, coupés quand le Bitcoin passe sous sa moyenne 200 jours),
`carry_funding` (neutre au marché, jamais filtré) et `momentum_4h` (uniquement
en marché baissier).

Un moteur qui n'a rien produit depuis longtemps n'est pas forcément en panne :
le filtre de tendance coupe 42 % du temps, et le carry ne se déclenche que si le
financement couvre ses frais. **Distingue le silence prévu de la panne** — et
quand tu ne peux pas trancher, va lire le log d'exécution de `signals.yml`
plutôt que de supposer.

## Section 5 — Le parcours (le lundi)

Parcours complet, du premier contact au réabonnement : `/start`, `/trial`, le
récapitulatif de mi-essai, l'expiration, `/subscribe`, le paiement,
l'activation, le retrait VIP, la relance. Cherche l'étape qui promet ce qu'une
autre ne tient pas.

Les 26 commandes doivent toutes répondre. La suite
`test/toutesLesCommandes.test.ts` le vérifie — mais elle utilise des stubs.
Si tu doutes d'une commande, exerce-la vraiment.

## Section 6 — Croissance (seulement si 1 à 5 sont propres)

**Twitter et Reddit sont définitivement fermés.** Ne les propose plus, ne
reconstruis rien autour : le propriétaire l'a tranché.

Canaux réels : le référencement du site, la syndication Dev.to (hebdomadaire,
`devto.yml`), et Discord. Le blocage structurel du référencement est le domaine
`workers.dev`, dont l'autorité est proche de zéro — un vrai domaine coûterait
~10 €/an et c'est le meilleur rapport effort/résultat du projet, mais il viole
la contrainte « zéro euro ». Rappelle l'arbitrage sans le forcer.

---

## Contraintes du propriétaire

Elles ne se discutent pas :

- **100 % gratuit, anonyme, automatique, légal.** Cloudflare Workers, Supabase,
  GitHub Actions, APIs publiques.
- **Jamais de mensonge** sur les performances, les risques ou la rareté.
  L'urgence doit être réelle : un compteur de places doit compter de vraies
  places.
- **Pas de spam.** Le régulateur `channelBudget.ts` impose un plafond quotidien,
  un espacement minimal et une priorité. Tout nouvel émetteur doit y passer.
- **Supprimer plutôt qu'ajouter.**
- **Ne rien casser.** La suite de tests doit passer après chaque modification.

---

## Discipline technique

**Tests.** `npx tsc --noEmit` puis `npx vitest run` dans
`workers/main-worker/`. Le chemin du dépôt contient des espaces, ce qui casse
vitest : recopie d'abord vers un chemin sans espace.

```
robocopy "C:\code vs code\projet crypto\workers\main-worker" "C:\wrktest\main-worker" /MIR /XD node_modules .git /NFL /NDL /NJH /NJS /NP
```

**CI.** `tests.yml` exécute les trois suites à chaque poussée. Vérifie qu'elle
est verte APRÈS ton push — pas avant.

**Déploiement.** `npx wrangler deploy` pour le Worker. Sans ça, ton correctif
est committé et inactif.

**Un test par correctif**, et il doit échouer sans le correctif. Un test qui
passe dans les deux cas ne protège de rien.

**Commits.** Un sujet qui nomme le défaut, pas la solution. Le corps explique ce
qui se passait réellement et pourquoi la correction est celle-là. Termine par :

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Vérifie que TU tournes

Cette routine s'est arrêtée sept jours sans que personne le sache : session
OAuth expirée, échec en une seconde, deux lignes dans un journal que personne
ne lit. `alerte_routine.ps1` prévient désormais l'administrateur sur Telegram.

Regarde `ops_routine.log` : depuis quand tournes-tu réellement ? Si tu vois une
interruption, dis-la en tête du rapport — l'absence de rapports pendant N jours
signifie que N jours n'ont été surveillés par personne.

---

## Le rapport

Envoie-le sur Telegram à `ADMIN_TELEGRAM_ID`. Il se lit sur un téléphone :
court, sans jargon, sans félicitations.

1. **Ce qui est cassé maintenant**, et ce que ça coûte concrètement.
2. **Ce que tu as corrigé**, avec la preuve — pas « corrigé le dispatch » mais
   « le signal #31 est parti à 09:00, ligne présente dans `signal_deliveries` ».
3. **Ce que tu n'as pas pu faire**, et pourquoi.
4. **Une seule question**, s'il y en a une qui bloque vraiment. Écris-la dans
   `admin_notes` (`sender = 'routine'`). Vérifie d'abord les réponses non lues :
   cinq questions y ont attendu sans réponse.

Ne rapporte pas ce qui va bien, sauf si ça allait mal hier.

**Si tu n'as rien trouvé, dis-le.** Un rapport qui invente une trouvaille pour
justifier son exécution est pire qu'un rapport vide : il fait perdre du temps
et il érode la confiance dans tous les suivants.

---

## Comment ne pas perdre ton temps

- **Ne relis pas tout le code chaque jour.** Pars des données : ce qui a bougé
  en base, ce qui a échoué dans les logs, ce qui n'a pas bougé alors qu'il
  aurait dû.
- **Une seule requête SQL** pour plusieurs métriques plutôt que dix aller-retour.
- **`gh run view --log-failed`**, jamais le log complet.
- **N'améliore pas ce qui n'a pas d'utilisateurs.** Le produit compte deux
  comptes. Une refonte esthétique ne sert personne ; un paiement qui n'arrive
  pas coûte tout.
- **Ne réécris pas ce que tu ne comprends pas.** Lis d'abord pourquoi c'est
  ainsi — les commentaires de ce dépôt expliquent presque toujours quel bug
  réel a produit le code que tu t'apprêtes à « simplifier ».
