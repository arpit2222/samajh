import { ethers } from "ethers";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCredentialByUserId, upsertCredential } from "../db/firestore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_JSON_PATH = path.resolve(__dirname, "../contracts/SamajhSoulbound.json");
const AMOY_EXPLORER_TX_BASE = "https://amoy.polygonscan.com/tx/";
const DEFAULT_AMOY_RPC = "https://rpc-amoy.polygon.technology";

let cachedArtifact = null;

async function loadContractArtifact() {
  if (cachedArtifact) return cachedArtifact;
  const raw = await readFile(CONTRACT_JSON_PATH, "utf-8");
  cachedArtifact = JSON.parse(raw);
  return cachedArtifact;
}

/**
 * Derive a deterministic custodial EVM address per Samajh userId server-side
 * so traders never need MetaMask or any wallet UX.
 */
export function deriveCustodialAddress(userId) {
  const salt = process.env.CREDENTIAL_SIGNING_KEY?.trim() || "samajh-custodial-salt";
  const digest = ethers.keccak256(ethers.toUtf8Bytes(`${salt}:custody:${userId}`));
  return ethers.getAddress(`0x${digest.slice(-40)}`);
}

export function isRelayerConfigured(artifactAddress = "") {
  const pk = process.env.RELAYER_PRIVATE_KEY?.trim();
  const addr = process.env.SBT_CONTRACT_ADDRESS?.trim() || artifactAddress?.trim();
  return Boolean(pk && pk.startsWith("0x") && pk.length >= 66 && addr && ethers.isAddress(addr));
}

/**
 * Fire-and-forget on-chain Soulbound Token anchor on Polygon Amoy.
 * - Immediately updates Firestore credential with onchain_status: "pending"
 * - Submits mint(to, credentialId, bytes32(verificationHash)) via relayer wallet in the background
 * - Updates Firestore to "confirmed" (+ txHash, tokenId, explorerUrl) or "failed"
 * - NEVER throws into the HTTP response path and NEVER alters the HMAC-SHA256 signed record.
 */
export function triggerOnChainAnchorFireAndForget({
  userId,
  credentialId,
  verificationHash,
  walletAddress = null,
}) {
  const targetAddress =
    walletAddress && ethers.isAddress(walletAddress)
      ? ethers.getAddress(walletAddress)
      : deriveCustodialAddress(userId);

  // Detached background promise with complete error containment
  (async () => {
    try {
      const artifact = await loadContractArtifact();
      const contractAddress =
        process.env.SBT_CONTRACT_ADDRESS?.trim() || artifact.address?.trim() || "";
      const relayerKey = process.env.RELAYER_PRIVATE_KEY?.trim() || "";

      if (!isRelayerConfigured(contractAddress)) {
        const current = await getCredentialByUserId(userId);
        if (current) {
          await upsertCredential({
            ...current,
            onchain_status: "failed",
            onchain_network: "polygon-amoy",
            onchain_holder: targetAddress,
            onchain_note: "Relayer wallet or Amoy contract address not configured.",
          });
        }
        return;
      }

      const rpcUrl = process.env.POLYGON_AMOY_RPC_URL?.trim() || DEFAULT_AMOY_RPC;
      const provider = new ethers.JsonRpcProvider(rpcUrl, 80002);
      const wallet = new ethers.Wallet(relayerKey, provider);
      const contract = new ethers.Contract(contractAddress, artifact.abi, wallet);

      const hashBytes32 = verificationHash.startsWith("0x")
        ? verificationHash
        : `0x${verificationHash}`;

      const tx = await contract.mint(targetAddress, credentialId, hashBytes32);

      // Save txHash as soon as broadcast succeeds
      const broadcastDoc = await getCredentialByUserId(userId);
      if (broadcastDoc) {
        await upsertCredential({
          ...broadcastDoc,
          onchain_status: "pending",
          onchain_network: "polygon-amoy",
          onchain_holder: targetAddress,
          txHash: tx.hash,
          explorerUrl: `${AMOY_EXPLORER_TX_BASE}${tx.hash}`,
        });
      }

      // Wait for 1 confirmation (max 35s)
      const receipt = await Promise.race([
        tx.wait(1),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Amoy confirmation timed out")), 35_000)
        ),
      ]);

      let tokenId = null;
      try {
        const onchainRec = await contract.getCredential(credentialId);
        tokenId = onchainRec?.tokenId ? onchainRec.tokenId.toString() : null;
      } catch {
        // fallback: leave tokenId null if read call fails
      }

      const confirmedDoc = await getCredentialByUserId(userId);
      if (confirmedDoc) {
        await upsertCredential({
          ...confirmedDoc,
          onchain_status: receipt?.status === 1 ? "confirmed" : "failed",
          onchain_network: "polygon-amoy",
          onchain_holder: targetAddress,
          txHash: tx.hash,
          tokenId,
          explorerUrl: `${AMOY_EXPLORER_TX_BASE}${tx.hash}`,
          onchain_note: receipt?.status === 1 ? "Anchored on Polygon Amoy" : "Transaction reverted",
        });
      }
    } catch (err) {
      console.warn(`[SBT Relayer] Polygon Amoy anchor skipped/failed: ${err.message}`);
      try {
        const existing = await getCredentialByUserId(userId);
        if (existing) {
          await upsertCredential({
            ...existing,
            onchain_status: "failed",
            onchain_network: "polygon-amoy",
            onchain_holder: targetAddress,
            onchain_note: err.message || "On-chain anchor unavailable",
          });
        }
      } catch {
        // never crash process
      }
    }
  })();

  return {
    onchain_status: "pending",
    onchain_network: "polygon-amoy",
    onchain_holder: targetAddress,
  };
}
