/** Live PrizeJudge deploy on GenLayer Studio Dev (chain 61997). Override via env. */
export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_PRIZEJUDGE_ADDRESS ||
  "0xAdf0E11eC8Db4E0B4315182Ac78879a671cEf66a") as `0x${string}`;

/** Studio Dev / Studio Next — chain ID 61997. */
export const CHAIN_ID = 61997;
export const RPC_URL =
  process.env.NEXT_PUBLIC_GENLAYER_RPC || "https://studio-dev.genlayer.com/api";
export const EXPLORER_BASE =
  process.env.NEXT_PUBLIC_GENLAYER_EXPLORER || "https://explorer-studio-dev.genlayer.com";
export const EXPLORER = `${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`;
export const txUrl = (hash: string) => `${EXPLORER_BASE}/tx/${hash}`;

export const GITHUB = "https://github.com/valentinzubok/PrizeJudge";

/** Demo entry pages live in this repository, so every change to them is a public commit. */
export const DEMO_BASE = "https://valentinzubok.github.io/PrizeJudge/fixtures/";
export const DEMO_RUBRIC =
  "A working map renderer with a live demo, a public source repository and a written explanation of how it works. All three are required.";
