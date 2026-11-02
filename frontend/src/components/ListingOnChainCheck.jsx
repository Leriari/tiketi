import { useState } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { api, ApiError } from "../api";
import { Button, MoneyText } from "./ui";
import ChainChecks, { ExplorerLink } from "./ChainChecks";

/**
 * "Check this listing on the blockchain": reads the listing back from the
 * ticket's smart contract (GET /resale/listings/{id}/onchain), so a buyer
 * sees for themselves that the price is the one on the chain and inside
 * the limits the organiser fixed there — before paying.
 */
export default function ListingOnChainCheck({ listingId, listingTxUrl }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.verifyResaleListingOnchain(listingId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the blockchain. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="listing-chain-heading" className="rounded-md border border-chain-verified/30 bg-chain-verified/5 px-4 py-3 flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <ShieldCheck size={16} className="text-chain-verified flex-none mt-0.5" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <h2 id="listing-chain-heading" className="text-body-sm font-semibold text-ink-primary">Price checked by the smart contract</h2>
          <p className="text-body-sm text-ink-secondary">
            The organiser&apos;s resale price limits are written into this ticket&apos;s smart contract. A price outside them can&apos;t be listed at all.
            {listingTxUrl && <> <ExplorerLink href={listingTxUrl}>See the listing transaction</ExplorerLink></>}
          </p>
        </div>
      </div>

      {!result && (
        <Button variant="secondary" size="sm" className="w-auto self-start px-4" onClick={check} disabled={busy}
          iconLeft={busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}>
          {busy ? "Reading the blockchain…" : "Check it on the blockchain"}
        </Button>
      )}
      {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}

      {result && (
        <div className="flex flex-col gap-2 pt-1">
          <ChainChecks result={result} passedText="This listing matches the blockchain." failedText="This listing doesn't match the blockchain. Don't pay; contact ChainTix support." />
          <p className="text-caption text-ink-tertiary">
            Limits on the contract: {result.floor_kes != null ? <><MoneyText value={result.floor_kes} size="caption" /> to </> : "up to "}
            <MoneyText value={result.cap_kes} size="caption" /> · token #{result.token_id} on{" "}
            <ExplorerLink href={result.contract_url}>{result.network}</ExplorerLink>
          </p>
        </div>
      )}
    </section>
  );
}
