# ChainTix — Complete UI Build Specification

**Read this entire document before writing any code.** This is not a sketch.
Every screen, state and journey below is required. If you finish a screen and it
has no empty state, no loading state and no error state, it is not finished.

Reference quality bar: **looped.co.ke** for visual polish and information
density, **Ticketmaster** for resale and organiser depth. Match that level. Do
not ship placeholder layouts, lorem ipsum, or "coming soon" panels.

---

## 0. What ChainTix is

A Web 2.5 event ticketing platform for Kenya. Attendees pay with **M-Pesa** and
never see a crypto wallet. Behind the scenes each ticket is an **ERC-721 NFT on
Base** with a smart-contract-enforced resale ceiling and organiser royalty.
Tickets display as a **rotating QR credential** that regenerates every 30
seconds. Gate staff validate **fully offline** after a pre-event sync.

Five distinct product surfaces, each with its own navigation shell:

| Surface | Users | Theme default |
|---|---|---|
| **Attendee PWA** | Ticket buyers | Dark |
| **Seller Portal (P2P)** | Attendees reselling | Dark |
| **Organiser Console** | Event promoters | Light, dark toggle |
| **Scanner PWA** | Gate staff | Dark, high contrast |
| **Platform Admin** | ChainTix staff | Light |

---

## 1. Design system — build this first

Create `src/styles/tokens.css` and a Tailwind config that consumes it. Every
value below is a token. **No hard-coded hex anywhere in components.**

### 1.1 Colour

```
/* Dark theme (default for Attendee, Seller, Scanner) */
--bg-base:        #0A0A0F   /* page background */
--bg-surface:     #131318   /* cards, panels */
--bg-elevated:    #1C1C24   /* modals, dropdowns, hover */
--bg-inset:       #08080C   /* inputs, wells */

--border-subtle:  #24242E
--border-default: #32323E
--border-strong:  #4A4A58

--text-primary:   #F5F5F7
--text-secondary: #A1A1AE
--text-tertiary:  #6B6B78
--text-disabled:  #45454F

/* Light theme (Organiser Console, Platform Admin) */
--bg-base:        #FFFFFF
--bg-surface:     #FFFFFF
--bg-elevated:    #FFFFFF
--bg-inset:       #F7F8F7
--border-subtle:  #ECEEEC
--border-default: #DCE0DC
--text-primary:   #14171A
--text-secondary: #5A6169
--text-tertiary:  #8A929B

/* Brand — identical in both themes */
--brand-primary:    #7C5CFF   /* violet. Logo, active nav, links */
--brand-accent:     #C3F53C   /* lime. Primary CTA only. Use sparingly */
--brand-accent-ink: #14171A   /* text on lime buttons */

/* Semantic */
--success:    #2FB344   /* money in, confirmed, valid */
--success-bg: rgba(47,179,68,0.12)
--warning:    #E8A317   /* pending, awaiting, T+2 */
--warning-bg: rgba(232,163,23,0.12)
--danger:     #E5484D   /* denied, failed, deductions */
--danger-bg:  rgba(229,72,77,0.12)
--info:       #3E8BFF
--info-bg:    rgba(62,139,255,0.12)

/* Chain-specific */
--chain-verified: #00D4AA   /* on-chain confirmed badge */
--chain-pending:  #E8A317   /* mint in flight */
```

**Money colour rules — enforce globally.**
Revenue and earnings render in `--success`. Deductions, fees and refunds render
in `--danger` with a leading minus. Pending and escrowed amounts render in
`--warning`. Neutral balances render in `--text-primary`. Never colour a zero
value; zero is always `--text-secondary`.

### 1.2 Type

Font: **Inter** (variable). Fallback system stack. Load only 400, 500, 600, 700.

```
--fs-display: 34px / 1.15 / 700   /* page hero only */
--fs-h1:      26px / 1.2  / 700
--fs-h2:      20px / 1.3  / 600
--fs-h3:      16px / 1.4  / 600
--fs-body:    14px / 1.55 / 400
--fs-body-sm: 13px / 1.5  / 400
--fs-label:   11px / 1.3  / 500 / uppercase / 0.06em tracking
--fs-metric:  30px / 1.1  / 700 / tabular-nums
--fs-caption: 12px / 1.4  / 400
```

**All currency, counts, token IDs, timestamps and countdowns use
`font-variant-numeric: tabular-nums`.** Numbers must not jitter when they change.

### 1.3 Spacing, radius, elevation

4px base scale: `4 8 12 16 20 24 32 40 48 64`.

Radius: `sm 6px` inputs and chips, `md 10px` cards, `lg 14px` panels and modals,
`full` pills and avatars.

Shadow: dark theme uses border contrast, not shadow. Light theme uses
`0 1px 2px rgba(20,23,26,0.05)` for cards and
`0 8px 24px rgba(20,23,26,0.12)` for modals and popovers.

### 1.4 Motion

150ms ease-out for hover and colour. 220ms cubic-bezier(0.32,0.72,0,1) for
panels, drawers and modals. Respect `prefers-reduced-motion: reduce` — disable
all transform animation, keep opacity fades at 80ms.

---

## 2. Shell components

### 2.1 Sidebar (Organiser, Seller, Admin)

Fixed 264px. Scrolls independently. Collapses to a 64px icon rail below 1280px,
becomes an off-canvas drawer below 900px.

Structure, top to bottom:

1. **Product mark** — icon + wordmark + "View Site" external link
2. **Identity block** — avatar, name, role subtitle (e.g. "P2P Marketplace")
3. **Grouped nav.** Each group has an uppercase `--fs-label` header in
   `--text-tertiary` with 20px top margin. Items are 40px tall with a 20px
   leading icon, 12px gap, `--fs-body` label.
4. **Contextual footer card** — a persistent reassurance or status panel

Active item: `--brand-primary` text, `--brand-primary` at 10% opacity
background, 3px left bar in `--brand-primary`, radius `md`.
Hover on inactive: `--bg-elevated` background, `--text-primary` text.

Nav groups that must exist:

**Seller Portal**
```
MAIN        Dashboard
LISTINGS    Sell a Ticket · My Listings · Sold History
FINANCIAL   Wallet · Payout History
SUPPORT     Help & FAQs · Contact Support · Dispute Centre
ACCOUNT     Profile & Verification · Log Out
```
Footer card: shield icon, "Secure Escrow", "Your funds are protected until the
event ends. T+2 payout system."

**Organiser Console**
```
EVENT TICKETING CORE  [badge: CORE]
            Control Center · Earnings · Reports · Marketing Analytics
            Ticket Central · Ticket Audit Lookup · Event Management
            Crowd Control
MEMBERSHIP & VIP      [badge: VIP]
            QR Scanner Hub · Live QR Scanner · Guest Lists
BLOCKCHAIN
            Contract Status · Royalty Ledger · Resale Compliance
ANALYTICS & REPORTS
            Attendance · Revenue Breakdown · Export Centre
SETTINGS
            Organisation Profile · Payout Details · Team & Roles
```

**Platform Admin**
```
OVERSIGHT   Platform Dashboard · Organiser Accounts · Event Approvals
FINANCIAL   Platform Costs · Fee Configuration · Payout Queue
INTEGRITY   Resale Compliance · Fraud Signals · Audit Log
SYSTEM      Admin Users · Communication Center · Notifications
            Feature Flags
```

### 2.2 Top bar

Height 64px, sticky, `--bg-surface` with bottom `--border-subtle`.
Left: breadcrumb trail (light themes) or page title (dark themes).
Right, in order: theme toggle (sun/moon with label), notification bell with
count badge, user menu (avatar + name + chevron opening a dropdown with Profile,
Settings, Switch Organisation, Log Out).

### 2.3 Stat card

The single most repeated component. Anatomy:

```
┌──────────────────────────────┐
│ LABEL (--fs-label)      [ic] │
│ 1,240 (--fs-metric)          │
│ ▲ 12.4% vs last week         │  ← optional delta row
│ Helper sentence              │  ← optional --fs-caption
└──────────────────────────────┘
```

Padding 20px, radius `md`, `--bg-surface`, 1px `--border-subtle`.
Icon is 20px, `--text-tertiary`, top-right.
Delta: `--success` with ▲ or `--danger` with ▼.

Emphasised variant: 1px `--brand-accent` border at 40% opacity plus
`--brand-accent` at 4% background. Use for the single most important metric on a
page — never more than one per page.

### 2.4 Required generic components

Build these as a library in `src/components/ui/` **before** building any page.

`Button` (variants: primary lime, secondary outline, ghost, danger; sizes sm/md/lg;
loading spinner state; icon-left and icon-only) · `Input` · `Select` · `Textarea` ·
`DatePicker` · `FileDropzone` (drag state, preview, size and type validation) ·
`Toggle` · `Checkbox` · `RadioGroup` · `Badge` (9 semantic colours) · `Chip`
(selectable, removable) · `Avatar` · `Card` · `StatCard` · `Table` (sortable
headers, sticky header, row hover, bulk-select column, per-row action menu) ·
`Pagination` · `Tabs` · `Modal` · `Drawer` · `Toast` · `Tooltip` · `Popover` ·
`DropdownMenu` · `Breadcrumb` · `ProgressBar` · `Skeleton` · `EmptyState` ·
`ErrorState` · `SearchField` · `DateRangePicker` · `CopyButton` · `MoneyText` ·
`CountdownRing` · `QRDisplay` · `ChainBadge` · `TimelineStepper` · `FilterBar`

### 2.5 Three states, every single time

**Empty** — illustration or 40px muted icon, a heading, one sentence of
explanation, and a primary action button. Never an empty table.
Example: "No transactions yet. Start by selling a ticket!" + `Sell a Ticket`.

**Loading** — skeleton shapes matching the real layout. Never a centred spinner
on a full page. Tables get 5 skeleton rows. Cards get shimmer blocks.

**Error** — what failed in plain language, why if known, and a `Try again`
button. Network errors additionally offer `Work offline` where the surface
supports it.

---

## 3. Attendee PWA

Mobile-first, 375px baseline. Installable. Bottom tab bar on mobile, top nav on
desktop ≥1024px.

### 3.1 Journey: discover → buy → hold → enter

```
Landing → Browse/Search → Event detail → Tier select → Checkout
  → STK push wait → Confirmation → My Tickets → Credential → Gate
```

### 3.2 Screens

**Landing** — hero with search (event, artist, venue), city selector defaulting
to Nairobi, "This Weekend" horizontal scroller, category chips (Concerts,
Festivals, Sports, Theatre, Conferences), "Selling Fast" row with urgency badges,
trust strip explaining M-Pesa payment and verified tickets in one line each.

**Browse** — left filter rail on desktop (date range, price slider in KES,
category, venue, availability toggle), sort dropdown (Date, Price low/high,
Popularity), result count, responsive grid 1/2/3 up. Each card: 16:9 poster,
title, venue, date, lowest price "From KES 1,500", availability badge.
Infinite scroll with a skeleton sentinel. Empty state: "No events match your
filters" + `Clear filters`.

**Event detail** — poster hero, title, artists, venue with map link, date/time,
share row, Add to Calendar. Sticky purchase panel (right on desktop, bottom
sheet on mobile) listing tiers as selectable rows: name, description, price,
remaining count, per-order limit. Sold-out tiers dimmed with a `Sold Out` badge
and a `Notify me` action. Below: description, lineup, venue info, terms, and a
**Resale Policy panel** stating: "Tickets for this event may be resold at a
maximum of 120% of face value. A 10% royalty returns to the organiser on every
resale. These limits are enforced by smart contract and cannot be overridden."

**Checkout** — three-step `TimelineStepper`: Details → Payment → Confirmation.
Order summary with tier, quantity, unit price, subtotal, service fee, total.
Phone input with a Kenyan flag prefix and live `07XX XXX XXX` masking, validated
on blur. Terms checkbox. `Pay KES 3,500 with M-Pesa` primary lime button.
No wallet, seed phrase, or token language appears anywhere.

**STK push wait** — modal that cannot be dismissed. Animated phone illustration,
"Check your phone", "Enter your M-Pesa PIN to confirm", a 60-second countdown
ring, and the masked number. Polls payment status every 2s. Three terminal
states: success → confirmation; timeout → "Didn't receive it?" with `Resend` and
`Change number`; failure → the Daraja reason in plain language plus `Try again`.

**Confirmation** — success animation, order reference, ticket summary, and a
`ChainBadge` reading "Securing on blockchain…" that resolves to "Verified
on-chain" with a Basescan link. **The ticket is usable before the mint
confirms** — never gate the credential on chain state. Primary action
`View my ticket`, secondary `Add to calendar`.

**My Tickets** — tabs Upcoming / Past / Listed for Resale. Ticket cards show
poster thumbnail, event, date, venue, tier, and a status badge (Active, Listed,
Used, Refunded).

**Ticket credential** — the most important screen in the product.
- Event header with gate assignment
- Large rotating QR, minimum 240px
- `CountdownRing` showing seconds to refresh, with a thin progress arc
- "Refreshes every 30 seconds — screenshots will not work" in `--text-secondary`
- Detail rows: Ticket ID, Tier, Seat, Token ID
- **Offline pill** in the header reading "Works offline" with a check icon
- Screen brightness boost prompt on open
- Actions: `Sell this ticket`, `Transfer to a friend`, `Claim to my own wallet`
- `Claim to my own wallet` opens an explainer sheet: what a self-custodial wallet
  is, what changes, what does not, and a warning that platform support cannot
  recover a claimed ticket. Requires typed confirmation.

**PWA install prompt** — a dismissible bottom sheet after the first successful
purchase, not on first visit.

---

## 4. Seller Portal — P2P resale

### 4.1 Escrow banner

Persistent at the top of the Seller Dashboard. Lock icon, heading "Secure Escrow
System", then two bolded lines:
- "**When your ticket sells:** Money appears in your wallet immediately as
  **Pending**."
- "**After 2 days:** Funds move to **Available** and you can withdraw to M-Pesa."

Footer line in `--text-tertiary`: "Withdrawals are only available 2 days after
the event ends to protect buyers."
Dismissible per user, re-shown after 30 days.

### 4.2 Seller Dashboard

Greeting with the user's name and a wave emoji, subtitle "Manage your ticket
listings and wallet".

Four stat cards: **Total Listings**, **Pending Review**, **Live Listings**,
**Sold Tickets**.

Two-column panel row below:
- **Wallet Balance** — three columns Available / Pending (T+2) / On Hold, each
  with `KES 0` in `--fs-metric`, plus a `View Wallet →` button
- **Quick Actions** — `Sell a Ticket` lime primary, `My Listings` ghost

**Recent Transactions** table spanning full width, empty state "No transactions
yet. Start by selling a ticket!"

### 4.3 Sell a Ticket — the critical flow

Four-step wizard with a `TimelineStepper`.

**Step 1 — Choose ticket.** Grid of the seller's eligible tickets. Ineligible
ones appear dimmed with the reason inline ("Already used", "Resale disabled by
organiser", "Event has ended", "Listing window closed").

**Step 2 — Set price.** This screen carries the anti-scalping story.
- Face value displayed prominently
- **Price cap panel**: "Maximum resale price: KES 4,200 (120% of face value)"
  with a note "This limit is enforced by smart contract"
- A slider plus numeric input, both clamped to the floor and ceiling
- The input **cannot** accept a value above the cap. On attempt, show inline
  error "Above the maximum allowed for this event" and shake the field once
- Live **payout breakdown** updating as the price changes:
  ```
  Listing price          KES 4,000
  Organiser royalty 10%  − KES  400
  Platform fee 5%        − KES  200
  ─────────────────────────────────
  You receive            KES 3,400
  ```
- Below: "Funds are held in escrow and released 2 days after the event ends."

**Step 3 — Review.** Full summary, terms checkbox, `List ticket` button.

**Step 4 — Listed.** Success state, listing reference, `View listing` and
`List another`.

### 4.4 My Listings

Tabs: Active · Pending Review · Sold · Paused · Cancelled · Expired.

Table columns: Event (thumbnail + title + date), Tier, Listed price, Your
payout, Views, Status, Listed date, Actions.

Row actions: Edit price (reopens the capped price step), Pause listing, Cancel
listing, View public listing. Bulk select with bulk pause and bulk cancel.

**Paused state must be explained.** When an organiser lowers the price cap and a
listing falls outside the new bounds, it pauses rather than deletes. The row
shows an amber badge and an inline notice: "Paused — the organiser reduced the
maximum resale price for this event. Lower your price to KES 3,600 to relist."
with a `Reprice and relist` action.

### 4.5 Wallet

Three balance cards: Available, Pending (T+2) with a "releases on 16 March"
sub-line, On Hold with a "held pending dispute" sub-line if non-zero.

`Withdraw to M-Pesa` primary button, disabled below the minimum with a tooltip
explaining "Minimum withdrawal is KES 101".

Withdrawal modal: amount input with a `Max` shortcut, destination number
(pre-filled, editable with OTP re-verification), fee line, net amount, confirm.

Transaction ledger below with a `FilterBar` (type, date range, status), showing
Date, Type, Description, Amount, Balance after, Status, and a receipt download
per row.

### 4.6 Dispute Centre

List of open and resolved disputes. Detail view with a message thread, evidence
upload, status timeline (Raised → Under review → Resolved), and the amount held.

---

## 5. Organiser Console

Light theme default.

### 5.1 Control Center

- "Welcome back, {name}" with `Drop New Event` lime primary top-right
- **Active Plans** row of badges (CORE TICKETING, VIP MEMBERSHIP)
- Two balance cards: **Available** (green tint, "No balance yet" when zero) and
  **Pending** ("Releasing soon")
- Split card: **All-time tickets** | **All-time revenue**
- **Send Complimentary Tickets** panel with event selector, recipient name,
  phone, tier, quantity, and a note field. Empty state: "No active events right
  now. Create an event to get started." with the link inline
- **Traffic Sources** panel with Today / This Week / This Month / All Time
  segmented control, a donut chart, and a source table (Direct, Instagram,
  WhatsApp, X, Referral) with sessions, conversions and conversion rate
- **Live Now** strip appearing only during an active event: tickets scanned,
  admission rate, gates online, last sync time

### 5.2 Event Management — create and edit

Two-column layout. Left: live poster preview card with placeholder rows "Venue
TBC", "Date TBC", "Artist TBC" that fill in as the form is completed. Right: the
form.

Fields in order:
`Title*` · `Venue` · `Artists/Lineup` (tag input) · `Event Image*` (dropzone,
PNG/JPG/WEBP, 1:1 recommended, with crop) · `Starts*` · `Ends` · `Description`
(rich text: bold, italic, lists, links) · `Event Status` (Draft / Live / Paused /
Sold Out / Cancelled) · `Capacity (Total Tickets)`

**Enable Resale toggle** — lime when on, with helper "Allow ticket buyers to
resell their tickets on ChainTix." When enabled, reveal a resale settings block:
- Maximum resale price as a percentage slider, 100–200%, with a live KES preview
- Organiser royalty percentage, 0–30%, with a live KES preview
- Resale window: opens X days after sale, closes Y hours before the event
- A locked notice: "Once the event goes live these values are written to the
  smart contract and cannot be increased."

**Ticket Categories** — repeatable rows with `+ Add Category`. Each row: name,
description, price in KES, quantity, sales start, sales end, per-order max,
visibility (Public / Hidden / Password). Drag to reorder. Empty state: "No
categories yet. Add a category like 'General Access' or 'VIP' to get started."

**Gate configuration** — define gates (name, ticket ID range or tier mapping) so
scanner assignment works.

Footer: `Back` ghost left, `Save as Draft` secondary, `Save Event` lime right.
Unsaved-changes guard on navigation.

### 5.3 Earnings

Breadcrumb `Dashboard › Earnings`.
"Primary ticket and resale revenue breakdown — your complete earnings picture."

**Your Wallet** section with `Reports & Statement` button top-right, and three
cards:
- **Online Pending** — "Released automatically 4 days after your event."
- **Available Balance** — emphasised card — "Gate sales funds are shown per event below."
- **Total Paid Out** — "Lifetime disbursed amount"

Payout notice bar when below threshold: "Your available balance is too low to
request a payout. Minimum is KES 101."

Second row of four:
**Total Revenue** ("Online + gate sales") · **ChainTix Fee (5%)** in `--danger`
with leading minus · **Scanning Fees** in `--danger` ("Door scanning costs") ·
**Your Earnings** emphasised in `--success` ("After all deductions")

Then **Tickets Sold**, and a **Royalty Income** card unique to ChainTix: resale
count, gross resale value, royalty earned, with a "view on-chain" link.

**Per-event breakdown table**: Event, Date, Online sales, Gate sales, Resale
royalties, Fees, Net, Payout status, and an expand row showing tier-level detail.

**Revenue over time** chart with a date range picker and a series toggle
(Primary / Resale / Total).

### 5.4 Ticket Central

Master ticket table across all events. Columns: Ticket ID, Event, Tier, Holder
(masked phone), Status, Purchased, Token ID, Gate, Checked in.

`FilterBar` with event, status, tier, date range, and a free-text search.
Row expand shows the full lifecycle timeline: purchased → minted → listed →
sold → admitted, with timestamps and transaction hashes.
Bulk actions: export CSV, void, resend credential.

### 5.5 Ticket Audit Lookup

Single-ticket forensic view. Search by ticket ID, phone, or M-Pesa receipt.
Returns a vertical timeline of every event in that ticket's life with actor,
timestamp, IP where relevant, and on-chain transaction links. Include a
"Suspicious activity" panel flagging repeated failed scans, rapid ownership
changes, or scans from an unassigned gate.

### 5.6 Crowd Control

Live during events. Real-time admission counter against capacity, per-gate
throughput chart, gates online/offline status list with last sync time and
cached ticket count, current queue estimate, and a manual override panel
(requires a reason, writes to the audit log).

### 5.7 QR Scanner Hub

Device management. Table of scanner devices: device name, assigned gate,
operator, status (Invited / Active / Revoked / Expired), last sync, tickets
cached, total scans, invalid attempts.

`Invite scanner` modal sends a phone OTP invite with a gate assignment and an
access window. Revoke action with confirmation.

### 5.8 Blockchain section

**Contract Status** — deployed address with copy button and Basescan link,
network badge, deployment timestamp, configured cap and royalty values, total
minted, mint success rate, average gas cost, and a failed-mint retry queue.

**Royalty Ledger** — every royalty payment: date, ticket, resale price, royalty
amount, transaction hash, status. Export to CSV.

**Resale Compliance** — count of rejected above-cap listing attempts, listings
paused by cap changes, and a distribution chart of resale prices against face
value. This is the organiser's proof that scalping is being prevented.

---

## 6. Scanner PWA

Dark, high contrast, designed for outdoor daylight and one-handed use. Minimum
tap target 48px. No small text anywhere.

### 6.1 Sync screen

Event selector, gate chips (single select), progress panel with a determinate
bar and "3,412 of 4,380 tickets cached to this device", detail rows for last
sync, storage used and access window, and a lime `Start Scanning` button
disabled until sync completes.

Footer note: "Once synced, this device validates tickets without an internet
connection."

### 6.2 Scan screen

Camera viewfinder filling the upper half with a reticle overlay and the hint
"Align QR code within frame". Persistent header showing gate name, admitted
count and a connectivity pill that reads **"Offline — validation active"** in
`--success`, not `--danger`. Being offline is the designed state, not an error.

### 6.3 Result

Full-screen takeover, unmissable.

**Granted** — `--success` background, large check, "ACCESS GRANTED", tier and
gate and timestamp, then a check list: Signature verified ✓, Credential current
✓, Not previously used ✓, Correct gate ✓. Auto-dismiss after 2.5s or on tap.

**Denied** — `--danger` background, large cross, "ACCESS DENIED", and the
specific reason as a heading: "Credential expired", "Already admitted at 20:14",
"Wrong gate — this ticket is for Gate A", "Invalid signature — possible
counterfeit". Requires explicit tap to dismiss. Never auto-dismiss a denial.

Haptic feedback: one short pulse on grant, two long on denial.

### 6.4 Session and reconciliation

Running session panel: scanned, admitted, denied, pending upload.
When connectivity returns, an upload banner appears with progress and a
completion state. After successful upload, prompt "Clear cached credentials from
this device" with an explanation.

---

## 7. Platform Admin

**Platform Dashboard** — GMV, active events, tickets sold today, platform fee
revenue, organiser count, failed mint count, payout queue depth.

**Organiser Accounts** — verification queue with KRA PIN and registration
document review, approve/reject with reason, suspension controls.

**Event Approvals** — queue for events awaiting review, with a side-by-side of
submitted details and a policy checklist.

**Platform Costs** — infrastructure, gas spend, SMS spend, Daraja charges, with
a per-event unit economics table.

**Fee Configuration** — platform fee percentage, scanning fee, minimum payout,
escrow period, each with an effective-date and an audit trail of changes.

**Fraud Signals** — flagged accounts, unusual resale velocity, repeated failed
scans, duplicate device fingerprints.

**Communication Center** — compose SMS, push and in-app broadcasts with audience
targeting (all users, event attendees, organisers, gate staff), scheduling,
preview, and delivery stats per channel.

**Audit Log** — immutable, filterable, exportable. Actor, action, target,
before/after, timestamp, IP.

---

## 8. Cross-cutting requirements

### 8.1 Currency and numbers
Always `KES 3,500` — prefix, non-breaking space, thousands separators, no
decimals unless the value has them. Never render a bare number for money.
Build a `MoneyText` component and use it everywhere. It takes `value`,
`variant` (`neutral | positive | negative | pending`), and `size`.

### 8.2 Phone numbers
Display as `0712 345 678`. Mask as `07** *** 678` anywhere an operator or
organiser sees another person's number. Store and transmit as `254712345678`.

### 8.3 Blockchain language
Attendees never see: wallet, gas, mint, token, chain, crypto, NFT.
They see: "Verified", "Secured", "Ownership confirmed".
Organisers and admins see full technical detail including addresses and hashes.
The `ChainBadge` component has three states: pending (amber, "Securing…"),
verified (`--chain-verified`, "Verified on-chain", links to Basescan), failed
(amber not red — the ticket still works, "Verification retrying").

### 8.4 Dates and times
Africa/Nairobi in all UI. Relative for recent ("2 minutes ago", "Yesterday"),
absolute beyond 7 days ("14 Mar 2026, 19:00"). Always render weekday for event
dates. Store UTC.

### 8.5 Responsive breakpoints
`sm 640` `md 768` `lg 1024` `xl 1280` `2xl 1536`.
Below 900px: sidebars become drawers, tables become stacked cards with a
label-value layout, multi-column forms become single column, sticky purchase
panels become bottom sheets.

### 8.6 Accessibility — non-negotiable
WCAG 2.1 AA. 4.5:1 contrast on body text, 3:1 on large text and UI borders.
Every interactive element reachable and operable by keyboard with a visible
`--brand-primary` 2px focus ring at 2px offset. Semantic landmarks. Form inputs
have associated labels, not placeholders as labels. Errors announced via
`aria-live="polite"`, scan results via `aria-live="assertive"`. Modals trap
focus and restore it on close. Colour is never the only signal — pair every
status colour with an icon or text.

### 8.7 Performance
Route-level code splitting. Images lazy-loaded with width and height set to
prevent layout shift. Virtualise any list over 100 rows. Skeleton screens rather
than spinners. Targets: LCP under 2.5s, CLS under 0.1, cached shell under 10MB.

### 8.8 Offline behaviour
Service worker caches the app shell for both the Attendee and Scanner PWAs.
Attendee: cached tickets and credentials remain available offline; an offline
banner appears for any screen requiring network.
Scanner: fully functional offline after sync — this is the primary mode, not a
degraded one.

---

## 9. Build order

1. **Tokens and theme system.** Both themes, toggle persisted, no hard-coded colour.
2. **Component library.** All of §2.4, each with every state, in a Storybook or
   a `/dev/components` route.
3. **Shells.** Sidebar, top bar, drawer, responsive behaviour, for all surfaces.
4. **Attendee PWA.** Discovery → checkout → credential. The credential screen is
   the highest-value screen in the product; give it the most care.
5. **Seller Portal.** Dashboard, the four-step sell wizard with live cap
   enforcement, listings, wallet.
6. **Organiser Console.** Control Center, Event Management, Earnings, Ticket
   Central, then the rest.
7. **Scanner PWA.** Sync, scan, result, reconciliation.
8. **Platform Admin.**
9. **Polish pass.** Every empty state, every loading state, every error state,
   keyboard navigation, screen reader pass, reduced-motion pass.

---

## 10. Definition of done

A screen is complete only when all of the following are true:

- [ ] Renders correctly at 375, 768, 1024 and 1440px
- [ ] Has an empty state with an action
- [ ] Has a skeleton loading state matching the real layout
- [ ] Has an error state with a retry
- [ ] Works in both light and dark theme
- [ ] Fully keyboard navigable with visible focus
- [ ] Passes axe with zero violations
- [ ] Uses zero hard-coded colours, spacing values or font sizes
- [ ] All money rendered through `MoneyText`
- [ ] All numeric displays use tabular figures
- [ ] Respects `prefers-reduced-motion`

---

## 11. Stop and ask

Do not guess on these:

- Anything requiring a design decision not specified above
- Anything that would expose blockchain terminology to an attendee
- Anything that would let a resale price exceed the smart contract cap in the UI
- Anything that would make the Scanner PWA require network during validation