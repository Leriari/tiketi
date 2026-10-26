import { useState } from "react";
import { ShieldCheck, Check, X, Clock, ExternalLink, Loader2 } from "lucide-react";
import { api, ApiError } from "../api";
import { Button, ChainBadge, CopyButton } from "./ui";

function short(value) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-line-subtle last:border-b-0">
      <span className="text-caption text-ink-tertiary flex-none">{label}</span>
      <span className="text-body-sm text-ink-primary font-medium tabular-nums text-right min-w-0 truncate">{children}</span>
    </div>
  );
}

function Link({ href, children }) {
  if (!href) return children;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-primary-on-tint hover:underline">
      {children} <ExternalLink size={12} aria-hidden="true" />
    </a>
  );
}

/**
 * The ticket's permanent on-chain record: what was minted, where, and the
 * transactions behind it, each linked to the block explorer. "Verify on the
 * blockchain" reads the token back from the contract itself and checks it
 * against ChainTix's records, item by item.
 *
 * detail: the ticket detail (api.getTicketDetail) — uses chain, chain_status.
 */
export default function OnChainRecord({ ticketId, detail }) {
  const chain = detail.chain || {};
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.verifyTicketOnchain(ticketId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the blockchain. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  const minted = detail.chain_status === "verified";

  return (
    <section aria-labelledby="onchain-heading" className="rounded-md border border-line-subtle bg-surface px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="onchain-heading" className="text-body font-semibold text-ink-primary">On-chain record</h2>
        <ChainBadge status={detail.chain_status} txUrl={chain.mint_tx_url} />
      </div>

      {!minted ? (
        <p className="text-body-sm text-ink-secondary">
          Your ticket is being recorded on the blockchain. This usually takes under a minute, and your ticket works at the gate meanwhile.
        </p>
      ) : (
        <div>
          <Row label="Network">{chain.network}</Row>
          <Row label="Token">
            <Link href={chain.token_url}>#{chain.token_id}</Link>
          </Row>
          <Row label="Contract">
            <Link href={chain.contract_url}>{short(chain.contract_address)}</Link>
          </Row>
          <Row label="Minted in">
            <Link href={chain.mint_tx_url}>tx {short(chain.mint_tx_hash)}</Link>
          </Row>
          {chain.used_tx_hash && (
            <Row label="Admission recorded">
              <Link href={chain.used_tx_url}>tx {short(chain.used_tx_hash)}</Link>
            </Row>
          )}
        </div>
      )}

      {minted && !result && (
        <Button variant="secondary" iconLeft={busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} onClick={verify} disabled={busy}>
          {busy ? "Reading the blockchain…" : "Verify on the blockchain"}
        </Button>
      )}
      {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}

      {result && (
        <div className="flex flex-col gap-2 pt-1" aria-live="polite">
          <p className={`text-body-sm font-semibold ${result.all_passed ? "text-chain-verified" : "text-danger"}`}>
            {result.all_passed ? "Everything matches the blockchain." : "Something doesn't match. Contact ChainTix support."}
          </p>
          <ul className="flex flex-col gap-1.5">
            {result.checks.map((c) => (
              <li key={c.label} className="flex items-start gap-2 text-body-sm text-ink-secondary">
                {c.pass ? <Check size={15} className="text-chain-verified flex-none mt-0.5" aria-label="Passed" />
                  : c.pending ? <Clock size={15} className="text-warning flex-none mt-0.5" aria-label="Pending" />
                    : <X size={15} className="text-danger flex-none mt-0.5" aria-label="Failed" />}
                <span>{c.label}{c.pending ? " (being recorded)" : ""}</span>
              </li>
            ))}
          </ul>
          <div className="text-caption text-ink-tertiary flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Held by {short(result.owner)}</span>
            <CopyButton value={result.owner} label="Copy address" />
            {result.minted_block && <span>· minted in block {result.minted_block.toLocaleString()}</span>}
            {result.minted_at && <span>on {new Date(result.minted_at).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
          </div>
          <p className="text-caption text-ink-tertiary">
            Read from the contract just now ({new Date(result.verified_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}).{" "}
            <button type="button" onClick={verify} disabled={busy} className="underline">Check again</button>
          </p>
        </div>
      )}
    </section>
  );
}
