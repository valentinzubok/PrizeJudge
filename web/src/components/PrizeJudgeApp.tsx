"use client";

import { useCallback, useEffect, useState } from "react";
import { CHAIN_ID, CONTRACT_ADDRESS, DEMO_BASE, DEMO_RUBRIC, EXPLORER, GITHUB, txUrl } from "@/lib/config";
import {
  enter,
  expire,
  getBooks,
  getContest,
  getCredit,
  getEntries,
  getEvents,
  getSchedule,
  getStats,
  judge,
  listContests,
  openContest,
  withdrawCredit,
  type Books,
  type Contest,
  type Entry,
  type EventRow,
  type Schedule,
  type Stats,
} from "@/lib/contracts";
import { fundWithTestGen, getNativeBalance, type TxStage } from "@/lib/genlayer";
import { useWallet } from "./WalletProvider";

const short = (h: string, n = 10) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : "—");
const utc = (seconds: number) =>
  seconds ? `${new Date(seconds * 1000).toISOString().replace("T", " ").slice(0, 16)} UTC` : "—";
const span = (seconds: number) =>
  seconds >= 86400
    ? `${Math.round(seconds / 8640) / 10} d`
    : seconds >= 3600
      ? `${Math.round(seconds / 360) / 10} h`
      : `${Math.round(seconds / 6) / 10} min`;

/** Wei as GEN, trimmed: 1500000000000000000 -> "1.5". */
const fmtGen = (wei: string | number | undefined) => {
  let v: bigint;
  try {
    v = BigInt(wei || 0);
  } catch {
    return "0";
  }
  const whole = v / BigInt(10 ** 18);
  const frac = (v % BigInt(10 ** 18)).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac.slice(0, 6)}` : `${whole}`;
};

/** GEN typed by a person as wei, or "" when it is not a number. */
const toWei = (text: string) => {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(text.trim());
  if (!m) return "";
  return (BigInt(m[1]) * BigInt(10 ** 18) + BigInt((m[2] || "").padEnd(18, "0") || "0")).toString();
};

const STATUS: Record<string, string> = {
  open: "entries open",
  judging: "judging · not final",
  awarded: "awarded",
  no_winner: "no entry met the rubric · prize returned",
  expired: "expired unresolved · prize returned",
};

/** Hero illustration: one round is a proposal; only agreeing, separated rounds pay. */
function Rounds() {
  return (
    <div className="roundsbox" aria-hidden="true">
      <p className="q">Which entry best meets the rubric?</p>
      <div className="lane">
        <span>entries</span>
        <span className="bar yes">pages frozen when entered · SHA-256</span>
      </div>
      <div className="lane">
        <span>round 1</span>
        <span className="bar yes">validators: entry 0 → a proposal</span>
      </div>
      <p className="gap">⋮ at least one full interval</p>
      <div className="lane">
        <span>round 2</span>
        <span className="bar yes">validators again: entry 0</span>
      </div>
      <div className="lane">
        <span>result</span>
        <span className="bar final">prize → entrant 0&apos;s wallet</span>
      </div>
    </div>
  );
}

function Dots({ have, need }: { have: number; need: number }) {
  return (
    <span className="confirm" title={`${have} of ${need} agreeing rounds`}>
      {Array.from({ length: need }, (_, i) => (
        <i key={i} className={i < have ? "on" : ""} />
      ))}
    </span>
  );
}

export function PrizeJudgeApp() {
  const { address, provider, connect, error: walletError } = useWallet();
  const [rows, setRows] = useState<Contest[]>([]);
  const [entries, setEntries] = useState<Record<string, Entry[]>>({});
  const [schedules, setSchedules] = useState<Record<string, Schedule>>({});
  const [books, setBooks] = useState<Books | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [credit, setCredit] = useState("0");
  const [gen, setGen] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const [tx, setTx] = useState("");
  const [stage, setStage] = useState<TxStage | "">("");

  const [cid, setCid] = useState("maps/my-contest");
  const [title, setTitle] = useState("Map renderer contest");
  const [rubric, setRubric] = useState(DEMO_RUBRIC);
  const [closeIn, setCloseIn] = useState("300");
  const [interval, setIntervalSeconds] = useState("120");
  const [rounds, setRounds] = useState("2");
  const [cap, setCap] = useState("4");
  const [prizeGen, setPrizeGen] = useState("2");
  const [entryUrl, setEntryUrl] = useState(DEMO_BASE + "entry-tilelight.html");
  const [entryNote, setEntryNote] = useState("Live demo, public repository and a write-up");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ids, s, ev, b] = await Promise.all([listContests(), getStats(), getEvents(), getBooks()]);
      setStats(s);
      setBooks(b);
      setEvents(ev.slice(-10).reverse());
      const loaded = await Promise.all(ids.map((id) => getContest(id)));
      setRows((loaded.filter(Boolean) as Contest[]).reverse());
      const es = await Promise.all(ids.map((id) => getEntries(id)));
      setEntries(Object.fromEntries(ids.map((id, i) => [id, es[i]])));
      const sc = await Promise.all(ids.map((id) => getSchedule(id)));
      setSchedules(
        Object.fromEntries(sc.filter(Boolean).map((x) => [(x as Schedule).contest_id, x as Schedule])),
      );
      if (address) {
        setGen(await getNativeBalance(address));
        setCredit(await getCredit(address));
      } else setCredit("0");
    } catch (e) {
      setMsg(`Error: ${e instanceof Error ? e.message : "read failed"}`);
      setOk(false);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onStage = (next: TxStage, hash: string) => {
    setTx(hash);
    setStage(next);
    if (next === "finalized") void refresh();
  };

  const run = async (name: string, fn: () => Promise<string | void>) => {
    if (!address || !provider) {
      setMsg("Connect MetaMask for writes");
      setOk(false);
      return;
    }
    setBusy(name);
    setMsg("");
    setStage("");
    try {
      const hash = await fn();
      if (hash) setTx(hash);
      await refresh();
      setMsg(`${name}: accepted by consensus`);
      setOk(true);
    } catch (e) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
      setOk(false);
    } finally {
      setBusy("");
    }
  };

  const acct = address as `0x${string}`;
  const disabled = !!busy || !address;
  const prizeWei = toWei(prizeGen);
  const same = (a: string, b: string | null) => !!b && a.toLowerCase() === b.toLowerCase();

  return (
    <main className="wrap">
      <section className="hero">
        <div>
          <h1>
            Prize<span className="accent">Judge</span>
          </h1>
          <p className="lede">
            A contest is only as fair as whoever picks the winner, and the organizer usually both
            holds the prize and picks. Here the prize sits in the contract from the start, the
            rubric is fixed, every entry page is frozen when it is entered, and the winner is the
            entry <strong>validators agree on in separated rounds</strong>. The organizer cannot
            keep the prize, move it or hand it to a favourite.
          </p>
          <div className="chips">
            <span className="chip">
              chain <b>{CHAIN_ID}</b>
            </span>
            {stats && (
              <>
                <span className="chip">
                  contests <b>{stats.contests}</b>
                </span>
                <span className="chip hot">
                  awarded <b>{stats.by_status.awarded || 0}</b>
                </span>
              </>
            )}
            {books && (
              <span className="chip">
                prizes held <b>{fmtGen(books.balance)} GEN</b>
              </span>
            )}
          </div>
          <p className="muted" style={{ marginTop: "0.8rem" }}>
            Contract <a href={EXPLORER}>{short(CONTRACT_ADDRESS, 12)}</a> · nobody is privileged ·{" "}
            <a href={GITHUB}>source</a>
          </p>
          <div>
            {!address ? (
              <button onClick={() => void connect()}>Connect MetaMask</button>
            ) : (
              <span className="pill">
                <span className="dot" /> {short(address)} · {gen || "?"} GEN
              </span>
            )}
            {address && (
              <button
                className="ghost"
                style={{ marginLeft: "0.5rem" }}
                disabled={!!busy}
                onClick={() =>
                  void run("Get test GEN", async () => {
                    await fundWithTestGen(acct);
                  })
                }
              >
                Get test GEN
              </button>
            )}
          </div>
          {address && credit !== "0" && (
            <p className="verdictbox">
              The contract holds <strong>{fmtGen(credit)} GEN</strong> for you from a contest it
              refused to open.{" "}
              <button
                className="ghost tiny"
                disabled={!!busy}
                onClick={() => void run("withdraw_credit", () => withdrawCredit(acct, provider, onStage))}
              >
                take it back
              </button>
            </p>
          )}
          {walletError && <p className="msg">{walletError}</p>}
          {msg && <p className={ok ? "okmsg" : "msg"}>{msg}</p>}
          {tx && (
            <p className="tx muted">
              last tx <a href={txUrl(tx)}>{short(tx, 14)}</a>{" "}
              {stage === "finalized" ? (
                <span className="stagepill final">finalized · payouts have landed</span>
              ) : (
                <span className="stagepill accepted">accepted — awaiting finalization</span>
              )}
            </p>
          )}
        </div>
        <Rounds />
      </section>

      <div className="row">
        <section className="card">
          <h2>1 · Open a contest</h2>
          <p className="muted">
            The prize is sent with this transaction and held by the contract. Everything that
            decides the result is fixed here and has no setter. <code>judge</code> later takes a
            contest id and nothing else.
          </p>
          <label htmlFor="cid">Contest id</label>
          <input id="cid" value={cid} onChange={(e) => setCid(e.target.value)} />
          <label htmlFor="title">Title</label>
          <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label htmlFor="rubric">Rubric</label>
          <textarea id="rubric" rows={3} value={rubric} onChange={(e) => setRubric(e.target.value)} />
          <div className="grid2">
            <div>
              <label htmlFor="prize">Prize (GEN)</label>
              <input id="prize" value={prizeGen} onChange={(e) => setPrizeGen(e.target.value)} />
            </div>
            <div>
              <label htmlFor="closeIn">Entries close in (s)</label>
              <input id="closeIn" value={closeIn} onChange={(e) => setCloseIn(e.target.value)} />
            </div>
            <div>
              <label htmlFor="rounds">Agreeing rounds needed (1–4)</label>
              <input id="rounds" value={rounds} onChange={(e) => setRounds(e.target.value)} />
            </div>
            <div>
              <label htmlFor="interval">Interval between rounds (s)</label>
              <input id="interval" value={interval} onChange={(e) => setIntervalSeconds(e.target.value)} />
            </div>
            <div>
              <label htmlFor="cap">Max entries (1–8)</label>
              <input id="cap" value={cap} onChange={(e) => setCap(e.target.value)} />
            </div>
          </div>
          <p className="muted">
            The earliest a winner can be paid is{" "}
            {span((Number(closeIn) || 0) + Math.max(0, (Number(rounds) || 1) - 1) * (Number(interval) || 0))}{" "}
            from now, whoever calls and however often.
          </p>
          <button
            disabled={disabled || !cid || !title || !rubric || prizeWei === ""}
            onClick={() =>
              void run("open_contest", () =>
                openContest(
                  acct,
                  provider,
                  { id: cid, title, rubric, closeIn, interval, rounds, maxEntries: cap, prize: prizeWei },
                  onStage,
                ),
              )
            }
          >
            {busy === "open_contest" ? (
              <span className="working">
                <span className="spinner" /> opening…
              </span>
            ) : (
              `escrow ${prizeGen || "0"} GEN and open the contest`
            )}
          </button>
        </section>

        <section className="card">
          <h2>2 · Enter</h2>
          <p className="muted">
            One entry per address, before entries close; the organizer cannot enter. Validators
            fetch your page now and freeze it: editing it later changes nothing the judge reads.
          </p>
          <label htmlFor="entryUrl">Your entry page (https)</label>
          <input id="entryUrl" value={entryUrl} onChange={(e) => setEntryUrl(e.target.value)} />
          <p className="muted">
            Demo pages:{" "}
            {["entry-tilelight.html", "entry-mapdream.html", "entry-quickmap.html"].map((f) => (
              <button key={f} className="ghost tiny" onClick={() => setEntryUrl(DEMO_BASE + f)}>
                {f.replace("entry-", "").replace(".html", "")}
              </button>
            ))}
          </p>
          <label htmlFor="entryNote">Note (up to 200 chars)</label>
          <input id="entryNote" value={entryNote} onChange={(e) => setEntryNote(e.target.value)} />
          <label htmlFor="enterId">Contest id</label>
          <input id="enterId" value={cid} onChange={(e) => setCid(e.target.value)} />
          <button
            disabled={disabled || !entryUrl || (schedules[cid] ? !schedules[cid].can_enter : false)}
            onClick={() => void run("enter", () => enter(acct, provider, cid, entryUrl, entryNote, onStage))}
          >
            {busy === "enter" ? (
              <span className="working">
                <span className="spinner" /> validators are freezing your page…
              </span>
            ) : schedules[cid] && !schedules[cid].can_enter ? (
              "entries are not open for this id"
            ) : (
              "enter the contest"
            )}
          </button>
          <ul className="decide" style={{ marginTop: "1rem" }}>
            <li>
              <span className="tag">a round</span> validators agree on one answer: the index of
              the entry that best meets the rubric, or none.
            </li>
            <li>
              <span className="tag">same answer</span> one more confirmation;{" "}
              <span className="tag">different</span> the count restarts.
            </li>
            <li>
              <span className="tag">reverts</span> a malformed answer or a consensus failure
              records nothing.
            </li>
          </ul>
        </section>
      </div>

      <section style={{ marginTop: "2rem" }}>
        <div className="head">
          <h2>Contests on chain</h2>
          <button className="ghost" disabled={loading} onClick={() => void refresh()}>
            {loading ? "reading…" : "refresh"}
          </button>
        </div>
        {rows.length === 0 && !loading && <p className="muted">No contests yet.</p>}
        {rows.map((c) => {
          const s = schedules[c.contest_id];
          const list = entries[c.contest_id] || [];
          const settled = ["awarded", "no_winner", "expired"].includes(c.status);
          return (
            <article className="card" key={c.contest_id} style={{ marginTop: "1rem" }}>
              <div className="head">
                <span className="id">{c.contest_id}</span>
                <span className="muted">
                  {STATUS[c.status] || c.status} <Dots have={c.confirmations} need={c.rounds_required} />
                </span>
              </div>
              <p className="claimtext">{c.title}</p>
              <p className="hashline">rubric: {c.rubric}</p>
              <p className="hashline">
                prize <strong>{fmtGen(c.prize)} GEN</strong>
                {settled ? ` · paid to ${short(c.paid_to)}` : " · held by the contract"} · organizer{" "}
                {short(c.organizer)} · entries close {utc(c.entries_close_at)} · rounds ≥ {span(c.judge_interval)} apart
                {s && <> · judging deadline {utc(s.expires_at)} (judge only before it, expire only from it)</>}
              </p>
              <div className="outcomes">
                {list.map((e) => (
                  <span
                    key={e.index}
                    className={`outcome ${settled && c.status === "awarded" && same(e.entrant, c.paid_to) ? "final" : c.has_proposal && c.proposal === e.index ? "proposed" : ""}`}
                  >
                    #{e.index} <a href={e.url}>{e.url.split("/").pop()}</a>
                    <small>
                      {short(e.entrant)} · sha-256 {e.content_hash.slice(0, 10)}…
                    </small>
                  </span>
                ))}
                {list.length === 0 && <span className="muted">no entries yet</span>}
              </div>
              {c.history.length > 0 && (
                <p className="hashline">
                  rounds:{" "}
                  {c.history
                    .map((h) => `${h.answer < 0 ? "none" : "#" + h.answer} (${h.outcome}, ${utc(h.at)})`)
                    .join(" → ")}
                </p>
              )}
              {c.injection_flags.length > 0 && (
                <p className="hashline">
                  instruction-like text flagged to the validators: {c.injection_flags.join(", ")}
                </p>
              )}
              {!settled && (
                <button
                  className="ghost"
                  disabled={disabled || (s ? !s.can_judge : false)}
                  onClick={() => void run("judge", () => judge(acct, provider, c.contest_id, onStage))}
                >
                  {s?.can_expire
                    ? "judging deadline passed · only expire is accepted"
                    : s && !s.can_judge
                      ? `next round from ${utc(c.next_round_at)}`
                      : "run a judging round"}
                </button>
              )}
              {s?.can_expire && (
                <button
                  className="ghost"
                  style={{ marginLeft: "0.5rem" }}
                  disabled={disabled}
                  onClick={() => void run("expire", () => expire(acct, provider, c.contest_id, onStage))}
                >
                  expire (returns the prize)
                </button>
              )}
            </article>
          );
        })}
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Recent events</h2>
        {events.length === 0 ? (
          <p className="muted">No events yet.</p>
        ) : (
          <ul className="timeline">
            {events.map((e, i) => (
              <li key={i}>
                <strong>{String(e.event)}</strong>{" "}
                <span className="muted">
                  {[
                    e.id,
                    typeof e.index === "number" ? `entry #${e.index}` : null,
                    typeof e.answer === "number" ? (e.answer < 0 ? "none" : `entry #${e.answer}`) : null,
                    e.outcome,
                    e.amount ? `${fmtGen(String(e.amount))} GEN` : null,
                    e.prize ? `${fmtGen(String(e.prize))} GEN` : null,
                    e.to ? `to ${short(String(e.to))}` : null,
                    typeof e.at === "number" ? utc(e.at) : null,
                  ]
                    .filter(Boolean)
                    .map(String)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="foot">
        PrizeJudge on GenLayer Studio Dev (chain {CHAIN_ID}). Reads work without a wallet; writes
        need MetaMask and test GEN. The demo entry pages are files in this repository.
      </footer>
    </main>
  );
}
