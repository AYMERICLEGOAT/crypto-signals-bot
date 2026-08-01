import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        // singleWorker : un seul runtime workerd partagé par tous les fichiers
        // de test, au lieu d'un par fichier lancé en parallèle.
        //
        // Sans cette option, la suite échoue de façon ALÉATOIRE sous Windows :
        // des fichiers passent seuls (vérifié : abi.test.ts, 6/6) mais tombent
        // en exécution parallèle avec « Fallback service failed to fetch
        // module » ou « The Workers runtime failed to start ». Ce sont des
        // erreurs de démarrage de runtime, pas des assertions — chaque fichier
        // démarre son propre workerd et la machine sature. Reproduit sur du
        // code non modifié, donc sans rapport avec les tests eux-mêmes.
        //
        // Coût : une suite un peu plus lente. Bénéfice : un résultat
        // déterministe — condition pour que « les tests passent » veuille dire
        // quelque chose avant un déploiement.
        singleWorker: true,
      },
    },
  },
});
