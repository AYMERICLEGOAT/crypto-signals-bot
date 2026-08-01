import { Env } from "../../env";
import { sendMessage } from "../../telegram";

/**
 * /faq — répond aux OBJECTIONS, pas aux questions confortables.
 *
 * Motif (audit du 01/08/2026) : le bot avait 22 commandes, dont aucune ne
 * traitait les deux questions que se pose réellement toute personne qui
 * découvre un service de signaux crypto — « est-ce une arnaque ? » et
 * « est-ce que je vais gagner de l'argent ? ». Dans un secteur où l'escroquerie
 * est la norme, la méfiance est le premier obstacle à la conversion, bien
 * avant le prix. /help liste les commandes ; il n'existait rien pour lever
 * ces objections.
 *
 * Parti pris : répondre franchement, y compris quand la réponse dessert
 * l'argumentaire commercial. Le service n'a pas démontré de rentabilité
 * (voir signals/DIAGNOSTIC_SIGNAUX_2026-08-01.md) et le dire ouvertement est
 * à la fois la seule option honnête et, dans ce marché précis, un argument
 * différenciant : personne d'autre ne le fait.
 *
 * Envoyé SANS markdown : le texte contient des caractères (%, parenthèses,
 * tirets, slashs de commandes) qui ont déjà cassé des messages Markdown sur
 * ce projet à plusieurs reprises. Le gain de mise en forme ne vaut pas le
 * risque d'un message entièrement non délivré.
 */
export async function handleFaqCommand(env: Env, telegramId: number): Promise<void> {
  const channel = env.TELEGRAM_CHANNEL_URL ?? "notre canal public";

  const text = [
    "❓ QUESTIONS FRÉQUENTES",
    "",
    "▸ Est-ce que je vais gagner de l'argent ?",
    "Nous ne le promettons pas, et personne ne devrait vous le promettre.",
    "Notre stratégie est testée sur 24 mois de données réelles : sur cette",
    "période, gains et pertes se compensent quasiment. Elle n'a pas démontré",
    "de rentabilité, et nous publions ce résultat plutôt que de le cacher.",
    "Ce que le service apporte : des niveaux (entrée, stop loss, objectifs)",
    "définis À L'AVANCE, un suivi automatique jusqu'à la clôture, et la",
    "publication de TOUS les résultats. Un cadre de discipline, pas une",
    "machine à gains.",
    "",
    "▸ Comment savoir que ce n'est pas une arnaque ?",
    "Trois vérifications que tu peux faire toi-même :",
    "1. Le code est public sur GitHub — la stratégie, les backtests, et même",
    "   les analyses qui concluent que l'avantage n'est pas démontré.",
    "2. Les résultats sont publiés en entier, pertes comprises, sur le canal",
    `   public : ${channel}`,
    "3. Essai gratuit de 3 jours avec /trial, sans moyen de paiement demandé.",
    "",
    "▸ Pourquoi un taux de réussite ne suffit-il pas ?",
    "Parce qu'il ne dit rien de la rentabilité. Une stratégie qui gagne 7 fois",
    "sur 10, avec des gains de 1 € et des pertes de 3 €, fait +7 contre -9 sur",
    "10 trades : perdante, avec 70% de réussite. Ce qui compte est le taux de",
    "réussite ET le rapport entre gains et pertes moyens. Méfie-toi de tout",
    "service qui affiche l'un sans jamais mentionner l'autre.",
    "",
    "▸ Combien ça coûte, et comment payer ?",
    "Standard : 19 USDT / 30 jours. Découverte : 5 USDT / 14 jours, en nombre",
    "limité, pour tester. Paiement en crypto uniquement (USDT sur Polygon,",
    "Litecoin, Monero) — pas encore de carte bancaire, autant le dire avant.",
    "Aucun prélèvement automatique : ça s'arrête tout seul à échéance.",
    "",
    "▸ Combien de signaux par jour ?",
    "2 à 3 en moyenne, mais ce nombre n'est PAS garanti : la stratégie se",
    "déclenche selon le marché, pas selon un quota. Certains jours n'en",
    "produisent aucun — forcer des signaux pour tenir une promesse de",
    "fréquence dégraderait leur qualité. Les journées sans signal sont",
    "annoncées sur le canal plutôt que passées sous silence.",
    "",
    "▸ Faut-il de l'expérience ?",
    "Pas pour lire un signal : chacun indique entrée, stop loss et objectifs.",
    "Mais oui pour l'utiliser correctement — savoir calculer sa taille de",
    "position à partir de son stop est indispensable. /guide explique la",
    "marche à suivre pas à pas.",
    "",
    "▸ Que se passe-t-il après l'ouverture d'un signal ?",
    "Suivi automatique jusqu'à la clôture, avec notification à chaque étape :",
    "premier objectif atteint (le stop remonte alors au prix d'entrée, le",
    "trade ne peut plus finir perdant), objectifs suivants, ou stop touché.",
    "Un signal qui n'atteint ni l'un ni l'autre est clôturé au bout de 10 jours.",
    "",
    "▸ Est-ce un conseil en investissement ?",
    "Non. C'est une information générale, diffusée à l'identique à tous les",
    "abonnés, sans tenir compte de ta situation, de tes objectifs ni de ta",
    "tolérance au risque. Le trading de cryptoactifs comporte un risque de",
    "perte en capital, y compris totale.",
    "",
    "▸ Comment arrêter ?",
    "Rien à résilier : sans prélèvement automatique, l'abonnement s'arrête",
    "seul. /cancel stoppe en plus les relances. /delete_my_data efface tes",
    "données personnelles immédiatement.",
    "",
    "Une question qui n'est pas ici ? /help liste toutes les commandes.",
  ].join("\n");

  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, text);
}
