// Shared by the seller wallet, the organiser's Earnings and the admin
// Payout Queue. Statuses match app/models/models.py PayoutStatus.

export const PAYOUT_STATUS = {
  pending_approval: { label: "Waiting for approval", tone: "warning" },
  processing: { label: "Sending", tone: "info" },
  paid: { label: "Paid", tone: "success" },
  failed: { label: "Failed, money returned", tone: "danger" },
  rejected: { label: "Rejected, money returned", tone: "danger" },
};

/** M-Pesa's charge for sending `amount`, from the server's bands: [[upToKes, charge], ...]. */
export function transferCharge(bands, amount) {
  if (!bands?.length) return 0;
  const band = bands.find(([upTo]) => amount <= upTo) || bands[bands.length - 1];
  return band[1];
}

// Kenyan banks' M-Pesa paybills: a bank payout is a paybill payment with
// the account number as the reference.
export const BANK_PAYBILLS = [
  { name: "Equity Bank", paybill: "247247" },
  { name: "KCB", paybill: "522522" },
  { name: "Co-operative Bank", paybill: "400200" },
  { name: "NCBA", paybill: "880100" },
  { name: "Absa Bank Kenya", paybill: "303030" },
];
