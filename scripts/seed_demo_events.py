"""
Fill an empty deployment with demo events, so the public site has something
to browse and buy.

Every organisation, event and artist here is fictional (the venues are
real places). Events are created through the same service the Organiser
Console uses (organiser_service.create_event), so they are validated and
shaped exactly like hand-made ones, and each gets generated cover art.

Safe to re-run: events that already exist (by title) are skipped.

Usage:
    python scripts/seed_demo_events.py
    python scripts/seed_demo_events.py --owner 0712345678   # also make this user an OWNER of the demo organisations
    python scripts/seed_demo_events.py --remove             # delete demo events that have no tickets yet
"""
import argparse
import base64
import io
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image, ImageDraw, ImageFilter

from app.db.session import SessionLocal
from app.models.models import (
    Event, Organizer, OrganizerMember, OrganizerRole, OrganizerVerificationStatus, Ticket, User,
)
from app.schemas.schemas import EventCreate, normalize_kenyan_phone
from app.services.organiser_service import create_event

EAT = timezone(timedelta(hours=3))

# A placeholder account that owns the demo organisations. It can never sign
# in: it isn't one of the DEMO_PHONE_CODES numbers and SMS is off.
PLACEHOLDER_PHONE = "254700000100"

ORGS = {
    "savanna": "Savanna Live Events",
    "forums": "Silicon Savannah Forums",
    "uwanja": "Uwanja Sports & Culture",
}

# Matches frontend/src/lib/categoryGradient.js, so the art sits naturally
# with the gradient shown while it loads.
PALETTES = {
    "Music": ("#4c2f9e", "#7c5cff"),
    "Conference": ("#1d2a52", "#3e8bff"),
    "Comedy": ("#8a4b1f", "#e8a317"),
    "Sports": ("#7a2d2d", "#e5484d"),
    "Arts": ("#1f5c4a", "#00d4aa"),
}


def at(y, m, d, hh, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=EAT)


def tier(name, price, capacity, description=None, per_order_max=None):
    return {"name": name, "price": price, "capacity": capacity,
            "description": description, "perOrderMax": per_order_max}


EVENTS = [
    dict(org="savanna", title="Savanna Sounds Festival", category="Music",
         venue="Uhuru Gardens, Lang'ata Road, Nairobi",
         start=at(2026, 11, 28, 14), end=at(2026, 11, 28, 23, 30),
         artists=["Nyota Collective", "DJ Kalulu", "Wanjiru Sky", "The Rift Brass"],
         description="A full day of Afro-house, benga revival and live brass under the open sky. "
                     "Food trucks, a craft market and a sunset set you won't forget.",
         gates=["Main Gate", "VIP Gate"],
         tiers=[tier("Early Bird", 2500, 300, "Limited first-release tickets."),
                tier("Regular", 3500, 1200),
                tier("VIP", 8000, 150, "Raised deck, private bar and fast-track entry.", 4)]),
    dict(org="savanna", title="Nairobi Jazz Nights", category="Music",
         venue="Alliance Française, Loita Street, Nairobi",
         start=at(2026, 11, 13, 19), end=at(2026, 11, 13, 23),
         artists=["Amani Strings Quartet", "Kito Mwangi Trio"],
         description="An intimate evening of Afro-jazz and soul in the heart of the city.",
         gates=["Main Entrance"],
         tiers=[tier("Regular", 1500, 200),
                tier("Table for 4", 8000, 20, "Reserved table for four, with a welcome drink each.", 1)]),
    dict(org="savanna", title="Coastal Afrobeats Weekend", category="Music",
         venue="Nyali Beach, Mombasa",
         start=at(2026, 12, 19, 16), end=at(2026, 12, 20, 2),
         artists=["Pwani Vibes", "DJ Mawimbi", "Zuri & The Tide"],
         description="Afrobeats and amapiano on the sand as the sun goes down over the Indian Ocean.",
         gates=["Beach Gate", "VIP Gate"],
         tiers=[tier("General Admission", 2000, 800),
                tier("VIP Cabana", 6000, 80, "Shaded cabana seating and table service.", 6)]),
    dict(org="savanna", title="New Year's Eve Countdown 2027", category="Music",
         venue="Carnivore Grounds, Lang'ata, Nairobi",
         start=at(2026, 12, 31, 18), end=at(2027, 1, 1, 3),
         artists=["DJ Kalulu", "Nyota Collective", "Sauti Moto"],
         description="Ring in 2027 with three stages, fireworks at midnight and music till late.",
         gates=["Gate 1", "Gate 2", "VIP Gate"],
         tiers=[tier("Regular", 3000, 2000),
                tier("VIP", 7500, 300, "VIP lounge with a view of the main stage.", 6),
                tier("VVIP", 15000, 50, "Backstage access, open bar and private parking.", 2)]),
    dict(org="savanna", title="Laugh Out Nairobi", category="Comedy",
         venue="Kenya National Theatre, Harry Thuku Road, Nairobi",
         start=at(2026, 11, 21, 19, 30), end=at(2026, 11, 21, 22, 30),
         artists=["Baraka the Joker", "Mama Mzaha", "Ochieng' Unfiltered"],
         description="Kenya's sharpest new stand-up comics on one stage for one night only.",
         gates=["Main Entrance"],
         tiers=[tier("Regular", 1200, 350), tier("Front Row", 2500, 40, None, 4)]),
    dict(org="savanna", title="Comedy Night at the Coast", category="Comedy",
         venue="Swahili Pot Hub, Mombasa",
         start=at(2027, 1, 17, 19), end=at(2027, 1, 17, 22),
         artists=["Mama Mzaha", "Salim Vichekesho"],
         description="Stand-up in English, Swahili and Sheng — the coast's favourite comedy night.",
         gates=["Main Entrance"],
         tiers=[tier("Regular", 1000, 250)]),
    dict(org="forums", title="Kenya Startup & Tech Summit", category="Conference",
         venue="KICC, Harambee Avenue, Nairobi",
         start=at(2026, 11, 19, 8, 30), end=at(2026, 11, 19, 17, 30),
         artists=["Dr. Achieng' Odhiambo", "Brian Kiprono", "Fatuma Abdi"],
         description="Founders, investors and builders on fintech, agritech and climate tech in East Africa. "
                     "Keynotes, pitch battles and a startup expo.",
         gates=["Registration Desk", "Expo Hall"],
         tiers=[tier("Student", 1000, 300, "Valid student ID required at entry."),
                tier("Standard", 4500, 900),
                tier("Investor Pass", 12000, 100, "Investor lounge and curated founder meetings.", 2)]),
    dict(org="forums", title="AI in Africa Forum", category="Conference",
         venue="Strathmore University, Madaraka, Nairobi",
         start=at(2026, 12, 3, 9), end=at(2026, 12, 3, 16),
         artists=["Prof. Kamau Njoroge", "Lilian Wekesa"],
         description="A practical day on building and deploying AI for African languages, health and farming.",
         gates=["Main Gate"],
         tiers=[tier("Standard", 2000, 400), tier("Workshop Add-on", 3500, 60, "Includes the afternoon hands-on lab.")]),
    dict(org="uwanja", title="Nairobi City Fun Run", category="Sports",
         venue="Nyayo National Stadium, Nairobi",
         start=at(2026, 11, 29, 6), end=at(2026, 11, 29, 12),
         artists=[],
         description="5K, 10K and half-marathon routes through the city. Medal and race T-shirt for every finisher.",
         gates=["Runners' Village"],
         tiers=[tier("5K Fun Run", 1500, 1500), tier("10K", 2000, 800), tier("Half Marathon (21K)", 2500, 500)]),
    dict(org="uwanja", title="Nairobi Basketball Showcase", category="Sports",
         venue="Nyayo National Stadium Gymnasium, Nairobi",
         start=at(2026, 12, 12, 15), end=at(2026, 12, 12, 20),
         artists=[],
         description="The city's top club teams in a one-day knockout, plus a three-point contest at half-time.",
         gates=["Gym Entrance"],
         tiers=[tier("Regular", 500, 1200), tier("Courtside", 2000, 60, None, 4)]),
    dict(org="uwanja", title="Rift Valley Rugby Sevens", category="Sports",
         venue="Nakuru Athletic Club, Nakuru",
         start=at(2027, 1, 23, 10), end=at(2027, 1, 24, 18),
         artists=[],
         description="Two days of club sevens rugby, live music between matches and the famous Nakuru crowd.",
         gates=["North Gate", "South Gate"],
         tiers=[tier("Weekend Pass", 1500, 2500), tier("VIP Stand", 4000, 200, "Covered seating and refreshments.", 4)]),
    dict(org="uwanja", title="Lamu Art & Culture Week", category="Arts",
         venue="Lamu Old Town, Lamu",
         start=at(2026, 12, 8, 10), end=at(2026, 12, 13, 18),
         artists=["Mzee Bakari Dhow Builders", "Lamu Taarab Ensemble"],
         description="Dhow races, Swahili poetry, taarab music and open studios across the old town.",
         gates=["Mkomani Square"],
         tiers=[tier("Week Pass", 1500, 600), tier("Day Pass", 500, 1000)]),
    dict(org="uwanja", title="Contemporary Kenyan Art Exhibition", category="Arts",
         venue="Nairobi National Museum, Museum Hill",
         start=at(2026, 11, 7, 10), end=at(2026, 11, 7, 18),
         artists=["Njeri Kamau", "Otieno Mbala", "Halima Yusuf"],
         description="Painting, sculpture and digital art from twelve emerging Kenyan artists.",
         gates=["Museum Entrance"],
         tiers=[tier("General", 800, 500), tier("Opening Reception", 2500, 80, "Meet the artists over drinks.", 2)]),
    dict(org="uwanja", title="Echoes of Kibera — A Stage Play", category="Arts",
         venue="Kenya National Theatre, Harry Thuku Road, Nairobi",
         start=at(2026, 12, 5, 18, 30), end=at(2026, 12, 5, 21),
         artists=["Jua Kali Theatre Company"],
         description="An award-winning ensemble tells three generations of one family's story, in Swahili and English.",
         gates=["Main Entrance"],
         tiers=[tier("Regular", 1000, 300), tier("Premium Seat", 2000, 60)]),
]


# ── Cover art ─────────────────────────────────────────────────────────────

W, H = 1600, 900


def _rgb(hex_colour):
    return tuple(int(hex_colour[i:i + 2], 16) for i in (1, 3, 5))


def cover_art(category: str, seed: str) -> str:
    """Abstract poster art for an event, as a JPEG data: URL. Deterministic
    per title, so re-running produces the same image."""
    rng = random.Random(seed)
    dark, light = (_rgb(c) for c in PALETTES[category])

    # 135° gradient: blend a vertical and a horizontal ramp.
    ramp = Image.linear_gradient("L")
    mask = Image.blend(ramp.resize((W, H)), ramp.rotate(90).transpose(Image.Transpose.FLIP_LEFT_RIGHT).resize((W, H)), 0.5)
    img = Image.composite(Image.new("RGB", (W, H), light), Image.new("RGB", (W, H), dark), mask).convert("RGBA")

    # Soft glows.
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    for _ in range(3):
        r = rng.randint(220, 420)
        x, y = rng.randint(0, W), rng.randint(0, H)
        g.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255, rng.randint(40, 80)))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(120)))

    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    white = lambda a: (255, 255, 255, a)

    if category == "Music":  # an equaliser and ripples
        cx, cy = rng.randint(900, 1300), rng.randint(250, 500)
        for i in range(1, 9):
            r = i * 70
            d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=white(70 - i * 6), width=3)
        bar_w = 26
        for i, x in enumerate(range(80, W - 80, bar_w + 14)):
            h = int(abs(rng.gauss(0, 1)) * 120 + 40 + 80 * abs(((i % 20) - 10) / 10))
            d.rounded_rectangle((x, H - 80 - h, x + bar_w, H - 80), radius=8, fill=white(60))
    elif category == "Conference":  # a network of nodes on a grid
        for x in range(0, W, 80):
            d.line((x, 0, x, H), fill=white(18), width=1)
        for y in range(0, H, 80):
            d.line((0, y, W, y), fill=white(18), width=1)
        nodes = [(rng.randint(100, W - 100), rng.randint(100, H - 100)) for _ in range(16)]
        for a in nodes:
            for b in sorted(nodes, key=lambda n: (n[0] - a[0]) ** 2 + (n[1] - a[1]) ** 2)[1:3]:
                d.line((*a, *b), fill=white(80), width=3)
        for x, y in nodes:
            d.ellipse((x - 12, y - 12, x + 12, y + 12), fill=white(170))
    elif category == "Comedy":  # bold confetti dots and a spotlight
        d.polygon(((W * 0.62, -40), (W * 0.82, -40), (W * 0.98, H), (W * 0.42, H)), fill=white(30))
        for _ in range(70):
            r = rng.randint(8, 46)
            x, y = rng.randint(0, W), rng.randint(0, H)
            d.ellipse((x - r, y - r, x + r, y + r), fill=white(rng.randint(30, 110)))
    elif category == "Sports":  # running-track lanes and speed stripes
        for i in range(7):
            off = i * 70
            d.arc((200 + off, 300 + off, W + 600 - off, H + 900 - off), 180, 270, fill=white(70), width=6)
        for i in range(12):
            x = rng.randint(-200, W)
            d.line((x, H, x + 500, 0), fill=white(rng.randint(15, 45)), width=rng.randint(6, 26))
    else:  # Arts: overlapping translucent shapes
        for _ in range(9):
            x, y = rng.randint(0, W), rng.randint(0, H)
            s = rng.randint(140, 360)
            shape = rng.choice(("circle", "square", "triangle"))
            fill = white(rng.randint(30, 90))
            if shape == "circle":
                d.ellipse((x - s, y - s, x + s, y + s), fill=fill)
            elif shape == "square":
                d.rectangle((x - s // 2, y - s // 2, x + s // 2, y + s // 2), fill=fill)
            else:
                d.polygon(((x, y - s), (x + s, y + s // 2), (x - s, y + s // 2)), fill=fill)

    img.alpha_composite(layer)
    out = io.BytesIO()
    img.convert("RGB").save(out, format="JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode()


# ── Seeding ───────────────────────────────────────────────────────────────

def _user(db, phone: str) -> User | None:
    return db.query(User).filter(User.phone_number == normalize_kenyan_phone(phone)).first()


def _ensure_member(db, org: Organizer, user: User) -> None:
    exists = db.query(OrganizerMember).filter(
        OrganizerMember.organizer_id == org.id, OrganizerMember.account_id == user.id
    ).first()
    if not exists:
        db.add(OrganizerMember(organizer_id=org.id, account_id=user.id, role=OrganizerRole.OWNER))
    user.is_organizer = True


def seed(db, owner_phone: str | None) -> None:
    placeholder = _user(db, PLACEHOLDER_PHONE)
    if not placeholder:
        placeholder = User(phone_number=PLACEHOLDER_PHONE, display_name="ChainTix Demo Organiser", phone_verified=False)
        db.add(placeholder)
        db.flush()

    owner = None
    if owner_phone:
        owner = _user(db, owner_phone)
        if not owner:
            sys.exit(f"No user with phone number {owner_phone} — they must sign in on the site once first.")

    orgs = {}
    for key, name in ORGS.items():
        org = db.query(Organizer).filter(Organizer.business_name == name).first()
        if not org:
            org = Organizer(business_name=name, verification_status=OrganizerVerificationStatus.VERIFIED)
            db.add(org)
            db.flush()
        _ensure_member(db, org, placeholder)
        if owner:
            _ensure_member(db, org, owner)
        orgs[key] = org
    db.commit()  # memberships, even when every event already exists

    created = 0
    for spec in EVENTS:
        if db.query(Event.id).filter(Event.title == spec["title"]).first():
            print(f"  exists   {spec['title']}")
            continue
        body = EventCreate(
            organization_id=orgs[spec["org"]].id,
            title=spec["title"],
            category=spec["category"],
            description=spec["description"],
            venue=spec["venue"],
            event_date=spec["start"],
            ends_at=spec["end"],
            artists=spec["artists"],
            gates=[{"name": g} for g in spec["gates"]],
            tiers=spec["tiers"],
            image_data_url=cover_art(spec["category"], spec["title"]),
            status="live",
        )
        create_event(db, body, placeholder)
        db.commit()
        created += 1
        print(f"  created  {spec['title']}  ({spec['category']}, {spec['start']:%d %b %Y})")

    print(f"Done: {created} created, {len(EVENTS) - created} already there.")
    if owner:
        print(f"{owner.phone_number} is now an owner of: {', '.join(ORGS.values())}")


def remove(db) -> None:
    titles = [e["title"] for e in EVENTS]
    for event in db.query(Event).filter(Event.title.in_(titles)).all():
        if db.query(Ticket.id).filter(Ticket.event_id == event.id).first():
            print(f"  kept     {event.title} (it has tickets)")
            continue
        for t in list(event.tiers):
            db.delete(t)
        db.delete(event)
        print(f"  removed  {event.title}")
    db.commit()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--owner", help="phone number of a signed-in user to make OWNER of the demo organisations")
    parser.add_argument("--remove", action="store_true", help="delete demo events that have no tickets")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        remove(db) if args.remove else seed(db, args.owner)
    finally:
        db.close()


if __name__ == "__main__":
    main()
