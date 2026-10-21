// Shared UI vocabulary — not mock-specific, both mockApi and a future live
// backend need the same category list for events.
export const CATEGORIES = ["Music", "Conference", "Comedy", "Sports", "Arts"];

// Pages that render on-chain data (contract address, tx hashes, mint
// status) show a "simulated data" banner when this is false. The mock
// backend invents those values; the real backend mints on a deployed
// contract (Base Sepolia), so its data is real. Read straight from the env
// rather than importing api.js, which would make a circular import.
export const CONTRACT_DEPLOYED = (import.meta.env.VITE_USE_MOCK ?? "true") === "false";
