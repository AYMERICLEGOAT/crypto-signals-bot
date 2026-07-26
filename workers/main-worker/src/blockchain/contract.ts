import { Env } from "../env";
import { ethCall, buildPolygonRpcConfig } from "./rpc";
import { SELECTORS, encodeAddressArg, encodeCall, decodeUint256, decodeBool } from "./abi";
import { buildAndSignLegacyTx } from "./tx";
import { sendRawTransaction } from "./rpc";

const USDT_DECIMALS = 6;

function rpcOf(env: Env) {
  return buildPolygonRpcConfig(env);
}

export async function isOnChainActive(env: Env, address: string): Promise<boolean> {
  const data = encodeCall(SELECTORS.isActive, encodeAddressArg(address));
  const result = await ethCall(rpcOf(env), env.CONTRACT_ADDRESS, data);
  return decodeBool(result);
}

export async function getPlanPriceUsdt(env: Env, plan: 1 | 2): Promise<number> {
  const selectorHex = plan === 1 ? SELECTORS.plan1Price : SELECTORS.plan2Price;
  const result = await ethCall(rpcOf(env), env.CONTRACT_ADDRESS, selectorHex);
  return Number(decodeUint256(result)) / 10 ** USDT_DECIMALS;
}

/**
 * Signe et diffuse setTrial(userAddress) avec la clé du wallet OWNER.
 * Retourne le hash de la transaction envoyée (pas encore forcément minée).
 */
export async function callSetTrial(env: Env, userAddress: string): Promise<string> {
  const rpc = rpcOf(env);
  const data = encodeCall(SELECTORS.setTrial, encodeAddressArg(userAddress));

  const rawTx = await buildAndSignLegacyTx(rpc, env.ADMIN_PRIVATE_KEY, {
    to: env.CONTRACT_ADDRESS,
    data,
    value: 0n,
  });

  return sendRawTransaction(rpc, rawTx);
}
