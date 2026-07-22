import { ethers } from "ethers";
import { config } from "../config";
import abi from "./abi/SignalSubscription.json";

export const provider = new ethers.JsonRpcProvider(config.polygon.rpcUrl);

/** Instance en lecture seule — utilisable par n'importe qui, aucune clé nécessaire. */
export const contract = new ethers.Contract(config.polygon.contractAddress, abi, provider);

/**
 * Wallet du propriétaire du contrat (OWNER). Signe les transactions setTrial()
 * et withdraw(). ⚠️ Ce process doit rester sur un serveur de confiance : quiconque
 * obtient cette clé privée contrôle entièrement ces fonctions et les fonds du
 * wallet OWNER (voir avertissements dans le README).
 */
export const adminWallet = new ethers.Wallet(config.polygon.adminPrivateKey, provider);

/** Instance connectée avec le wallet admin, pour les appels réservés à OWNER. */
export const contractAsAdmin = contract.connect(adminWallet) as ethers.Contract;

const USDT_DECIMALS = 6;

/** Prix du plan en USDT humain (ex: 10, 25), lu directement depuis les constantes du contrat. */
export async function getPlanPriceUsdt(plan: 1 | 2): Promise<number> {
  const raw: bigint = plan === 1 ? await contract.PLAN1_PRICE() : await contract.PLAN2_PRICE();
  return Number(raw) / 10 ** USDT_DECIMALS;
}

export async function isOnChainActive(address: string): Promise<boolean> {
  return contract.isActive(address);
}
