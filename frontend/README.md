# ChainTix frontend

React 19 + Vite SPA implementing five product surfaces from `spec.md`
(repo root): **Attendee**, **Seller/P2P resale**, **Organiser Console**,
**Scanner**, and **Platform Admin**.

## Mock vs. live backend

`src/api.js` dispatches every API call to one of two implementations,
controlled by `VITE_USE_MOCK` in `.env` (defaults to `true`):

- `src/mock/mockApi.js` — a `localStorage`-backed in-browser backend that
  every surface actually runs against today. This is how the app is
  normally run and demoed.
- `src/live/liveApi.js` — calls the real FastAPI backend (`../app/`). Only
  the original Attendee purchase→ticket→gate-scan journey (~13 of ~85
  functions) is actually implemented here; everything else throws a 501
  `ApiError`. Setting `VITE_USE_MOCK=false` today will break the Seller,
  Organiser, Scanner, and Admin surfaces.

See `STATUS.md` at the repo root for the full audit of what's real vs. stubbed.

## Structure

```
src/
├── pages/{attendee,seller,organiser,scanner,admin}/   # the 5 surfaces
├── shells/            # per-surface nav/layout shells
├── components/ui/     # shared component library (Button, Card, Table, ...)
├── mock/               # in-browser mock backend + seed data
├── live/liveApi.js     # real-backend client
├── context/             # AuthContext
├── theme/               # ThemeProvider (per-surface light/dark default)
├── lib/                 # small hooks/utilities (cn, useApiData, ...)
└── styles/tokens.css    # design-token source of truth (colors, type scale)
```

## Running it

```bash
npm install
npm run dev       # http://localhost:5173, mock API by default
npm run build      # production build to dist/
```

To point at a real running backend instead, set in `.env`:

```
VITE_USE_MOCK=false
VITE_API_BASE_URL=http://localhost:8000
```

(Only the Attendee flow will actually work — see above.)

## Notes

- Not a PWA despite two surfaces being named "...PWA" in the spec — there's
  no manifest or service worker. The Scanner surface's "offline" behaviour
  is a client-side `localStorage` simulation, not real offline capability.
- No test suite exists for this frontend yet.
