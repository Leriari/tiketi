// Shared UI vocabulary — not mock-specific, both mockApi and a future live
// backend need the same category list for events.
export const CATEGORIES = ["Music", "Conference", "Comedy", "Sports", "Arts"];

// No smart contract is deployed anywhere for this project (see backend
// audit). Pages that render on-chain-looking data (contract address, tx
// hashes, gas cost, mint status) gate a "simulated data" banner on this
// flag so it disappears automatically once a real deployment exists.
export const CONTRACT_DEPLOYED = false;
