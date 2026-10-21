# ChainTix design principles

The ChainTix visual system was redesigned in October 2026. This page gives
the reasoning behind it, so later decisions can be checked against the
same principles instead of taste. Everything below is implemented once, in
`frontend/src/styles/tokens.css` and the component library
(`frontend/src/components/ui/`). Pages stay plain and inherit the style.

"Futuristic" here does not mean chrome, gradients or sci-fi decoration.
It means a system that feels **precise, live and trustworthy**: the
qualities you want in something that holds your money and gets you
through a gate.

## First principles

1. **The ticket and the money are the product.** Every screen has one
   thing that matters most, such as the QR code, a price or a balance.
   That one thing gets the most contrast, the most size and the only
   colour. Chrome (navigation, borders, labels) stays quiet so it never
   competes.

2. **Every mark must carry information.** A border separates, a colour
   signals status, a glow means "live" or "focused". Nothing is
   decorative. The futuristic feel comes from precision: hairline
   rules, an exact grid, and data set like an instrument panel.

3. **Light is a signal, never decoration.** Luminous colour (the lime
   action colour, the violet signal colour, glows) is reserved for things
   that are active, verified or need a decision. So a glowing element
   always means something, and people learn to look for it.

4. **Numbers are instruments.** Money, counts, codes, IDs and times are
   set in a monospaced face with tabular figures. Columns line up,
   digits don't shift as values change, and machine-checkable values
   look different from prose.

5. **Depth is hierarchy.** Layers go base, then surface, then elevated,
   then overlay. Each step up is lighter and gains a faint top
   highlight, like light hitting the top edge of a glass panel. Higher
   means closer to the action. No heavy blur or drop shadows, which
   fail on cheap phones and in sunlight.

6. **Motion explains cause and effect.** It lasts 120–220 ms and only
   shows a state change (opened, confirmed, failed). Nothing loops
   except true live indicators. `prefers-reduced-motion` turns it off.

7. **It has to work at a gate in the sun on a KES 8,000 phone.** Text
   contrast is WCAG AA (4.5:1) or better in both themes. Tap targets are
   at least 40 px. There are no essential effects that depend on
   `backdrop-filter` or GPU-heavy rendering. System fonts take over if
   web fonts don't load.

## The system

| Decision | Value | Principle |
|---|---|---|
| UI typeface | Geist | 1, 2: neutral and engineered, so it stays out of the way |
| Data typeface | Geist Mono, tabular figures | 4 |
| Section labels | Mono, uppercase, wide tracking, tertiary ink | 2, 4: labels read as instrument markings |
| Dark base | Deep blue-black (`#06070c`), not pure black | 5: room for the layers above to read as lighter |
| Borders | Hairline, translucent white or ink at 6–14% | 2: separation without weight |
| Surface highlight | 1 px inset top edge | 5 |
| Action colour | Lime (`--brand-accent`) | 3: one colour means "do this" |
| Signal colour | Violet (`--brand-primary`) | 3: selection, focus, links, live state |
| Focus | 2 px violet ring plus soft glow | 3, 7: always visible, keyboard first |
| Radii | 4 / 8 / 12 px | 2: precise, not bubbly |
| Backdrop | Faint 32 px grid plus two soft colour fields, dark theme only | 5: the "instrument" base layer, under 3% visible |
| Light theme | Cool paper white, ink navy, same signal roles | 7: Organiser and Admin are used at desks in daylight |

Contrast for every text token against every surface it sits on is
re-checked by `frontend/scripts/check-contrast.mjs`. Run it after
changing any colour.
