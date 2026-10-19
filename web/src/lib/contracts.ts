import { CONTRACT_ADDRESS } from "./config";
import { type Address, type TxStage, parseJson, readContract, writeAndWait } from "./genlayer";

export type Round = { at: number; answer: number; outcome: "proposed" | "confirmed"; by: string };

export type Contest = {
  contest_id: string;
  organizer: string;
  title: string;
  rubric: string;
  prize: string;
  paid_out: string;
  paid_to: string;
  entries_close_at: number;
  judge_interval: number;
  rounds_required: number;
  max_entries: number;
  status: "open" | "judging" | "awarded" | "no_winner" | "expired";
  next_round_at: number;
  proposal: number;
  has_proposal: boolean;
  confirmations: number;
  rounds: number;
  history: Round[];
  injection_flags: string[];
};

export type Entry = {
  index: number;
  entrant: string;
  url: string;
  note: string;
  content_hash: string;
  total_chars: number;
  entered_at: number;
};

export type Schedule = {
  contest_id: string;
  status: string;
  now: number;
  entries: number;
  can_enter: boolean;
  can_judge: boolean;
  next_round_at: number;
  can_expire: boolean;
  expires_at: number;
};

export type Books = { balance: string; escrowed: string; credits: string };
export type Stats = { contests: number; by_status: Record<string, number>; settled: string };
export type EventRow = { event: string; [key: string]: unknown };

type OnStage = (stage: TxStage, hash: string) => void;
const read = (fn: string, args: string[] = []) => readContract<string>(CONTRACT_ADDRESS, fn, args);

export async function listContests(): Promise<string[]> {
  return parseJson<string[]>(await read("list_contests"), []);
}
export async function getContest(id: string): Promise<Contest | null> {
  const c = parseJson<Contest>(await read("get_contest", [id]), {} as Contest);
  return c.contest_id ? c : null;
}
export async function getEntries(id: string): Promise<Entry[]> {
  return parseJson<Entry[]>(await read("get_entries", [id]), []);
}
export async function getSchedule(id: string): Promise<Schedule | null> {
  const s = parseJson<Schedule>(await read("get_schedule", [id]), {} as Schedule);
  return s.contest_id ? s : null;
}
export async function getBooks(): Promise<Books | null> {
  return parseJson<Books | null>(await read("get_balance"), null);
}
export async function getStats(): Promise<Stats | null> {
  return parseJson<Stats | null>(await read("get_stats"), null);
}
export async function getEvents(): Promise<EventRow[]> {
  return parseJson<EventRow[]>(await read("get_events"), []);
}
export async function getCredit(address: string): Promise<string> {
  return (await read("get_credit", [address])) || "0";
}

export type NewContest = {
  id: string;
  title: string;
  rubric: string;
  closeIn: string;
  interval: string;
  rounds: string;
  maxEntries: string;
  /** The prize in wei; it travels as the transaction's value. */
  prize: string;
};

export async function openContest(account: Address, provider: unknown, c: NewContest, on?: OnStage) {
  return writeAndWait(
    account,
    provider,
    CONTRACT_ADDRESS,
    "open_contest",
    [c.id, c.title, c.rubric, c.closeIn, c.interval, c.rounds, c.maxEntries],
    on,
    BigInt(c.prize || "0"),
  );
}

export async function enter(
  account: Address,
  provider: unknown,
  id: string,
  url: string,
  note: string,
  on?: OnStage,
) {
  return writeAndWait(account, provider, CONTRACT_ADDRESS, "enter", [id, url, note], on);
}

const simple = (fn: string) => (account: Address, provider: unknown, id: string, on?: OnStage) =>
  writeAndWait(account, provider, CONTRACT_ADDRESS, fn, [id], on);
export const judge = simple("judge");
export const expire = simple("expire");

export async function withdrawCredit(account: Address, provider: unknown, on?: OnStage) {
  return writeAndWait(account, provider, CONTRACT_ADDRESS, "withdraw_credit", [], on);
}
