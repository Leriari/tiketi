// Seed data for the mock backend. Dates are relative to "today" so the app
// always shows upcoming events regardless of when this is opened.
const d = (daysFromNow, hh = 18, mm = 0) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + daysFromNow);
  dt.setHours(hh, mm, 0, 0);
  return dt.toISOString();
};

export const seedEvents = [
  {
    id: "evt-nairobi-music-fest",
    title: "Nairobi Music Festival 2026",
    category: "Music",
    venue: "KICC Grounds, Nairobi",
    event_date: d(24, 16, 0),
    description:
      "A full day of Afrobeat, Gengetone and live bands across three stages. Gates open at 2pm, headliners from 7pm.",
    organizer_phone: "254722000001",
    organizer_name: "Zuri Events Co.",
    artists: ["Sauti Sol", "Bien", "Nyashinski", "Khaligraph Jones"],
    total_capacity: 620,
    tiers: [
      { id: "tier-nmf-reg", name: "Regular", price: 1500, capacity: 500 },
      { id: "tier-nmf-vip", name: "VIP", price: 5500, capacity: 120 },
    ],
    resale: { ceilingMultiplier: 1.1, royaltyPercent: 8 },
  },
  {
    id: "evt-web3-summit",
    title: "Web3 Africa Summit",
    category: "Conference",
    venue: "Sarit Centre, Westlands",
    event_date: d(11, 9, 0),
    description:
      "Builders, founders and regulators on stage together — payments, on-chain identity and the state of African crypto policy.",
    organizer_phone: "254733000002",
    organizer_name: "Chain Collective Africa",
    artists: ["Iyin Aboyeji", "Rehmat Alam", "Daraja Africa panel"],
    total_capacity: 300,
    tiers: [
      { id: "tier-w3-reg", name: "General", price: 3000, capacity: 260 },
      { id: "tier-w3-vip", name: "All-Access", price: 9000, capacity: 40 },
    ],
    resale: { ceilingMultiplier: 1.0, royaltyPercent: 15 },
  },
  {
    id: "evt-laugh-republic",
    title: "Laugh Republic Live",
    category: "Comedy",
    venue: "The Alchemist, Westlands",
    event_date: d(6, 20, 0),
    description: "A rotating line-up of Nairobi's sharpest stand-up, two hours, one mic, no filters.",
    organizer_phone: "254711000003",
    organizer_name: "Laugh Republic",
    artists: ["Chipukeezy", "Njugush", "Jalang'o"],
    total_capacity: 180,
    tiers: [{ id: "tier-lr-reg", name: "Regular", price: 800, capacity: 180 }],
    resale: { ceilingMultiplier: 1.2, royaltyPercent: 10 },
  },
  {
    id: "evt-city-marathon",
    title: "Nairobi City Marathon",
    category: "Sports",
    venue: "Nyayo National Stadium",
    event_date: d(41, 6, 30),
    description: "Full, half and 10K routes through the city centre. Entry includes a timing chip and finisher medal.",
    organizer_phone: "254700000004",
    organizer_name: "Athletics Kenya Events",
    artists: [],
    total_capacity: 5000,
    tiers: [
      { id: "tier-cm-10k", name: "10K Entry", price: 1000, capacity: 2500 },
      { id: "tier-cm-half", name: "Half Marathon", price: 1800, capacity: 1800 },
      { id: "tier-cm-full", name: "Full Marathon", price: 2500, capacity: 700 },
    ],
    resale: { ceilingMultiplier: 1.0, royaltyPercent: 5, resaleEnabled: false },
  },
  {
    id: "evt-art-expo",
    title: "Contemporary Art Expo",
    category: "Arts",
    venue: "Circle Art Gallery, Lavington",
    event_date: d(17, 10, 0),
    description: "New work from 14 East African contemporary artists — opening weekend, artists in attendance.",
    organizer_phone: "254722000005",
    organizer_name: "Circle Art Gallery",
    artists: ["Michael Soi", "Wangechi Mutu (guest)", "Beatrice Wanjiku"],
    total_capacity: 220,
    tiers: [{ id: "tier-ae-reg", name: "Entry", price: 500, capacity: 220 }],
    resale: { ceilingMultiplier: 1.0, royaltyPercent: 0 },
  },
];
