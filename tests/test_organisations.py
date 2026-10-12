"""
Organisation onboarding and scoping tests (Work Order 04 B1-B3).

Reuses test_api.py's TestClient/DB setup, same reasoning as test_resale.py
and test_auth_security.py.
"""
from tests.test_api import client


def _login(phone: str) -> dict:
    res = client.post("/api/v1/auth/login", json={"phone_number": phone})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _create_org(headers: dict, name: str = "Negative Test Org") -> dict:
    res = client.post("/api/v1/organisations/", json={"business_name": name}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


# ── B2: organisation onboarding ──────────────────────────────────────────────

def test_create_organisation_makes_creator_owner():
    headers = _login("0799111001")
    org = _create_org(headers, "Acme Events")
    assert org["business_name"] == "Acme Events"
    assert org["verification_status"] == "pending"

    res = client.get(f"/api/v1/organisations/{org['id']}/members", headers=headers)
    assert res.status_code == 200
    members = res.json()
    assert len(members) == 1
    assert members[0]["role"] == "owner"
    assert members[0]["phone_number"] == "254799111001"


def test_owner_can_invite_a_staff_member():
    owner_headers = _login("0799111002")
    org = _create_org(owner_headers)

    res = client.post(
        f"/api/v1/organisations/{org['id']}/members",
        json={"phone_number": "0799111003", "role": "staff"},
        headers=owner_headers,
    )
    assert res.status_code == 201, res.text
    assert res.json()["role"] == "staff"

    res = client.get(f"/api/v1/organisations/{org['id']}/members", headers=owner_headers)
    assert len(res.json()) == 2


def test_staff_cannot_invite_members():
    owner_headers = _login("0799111004")
    org = _create_org(owner_headers)
    client.post(
        f"/api/v1/organisations/{org['id']}/members",
        json={"phone_number": "0799111005", "role": "staff"},
        headers=owner_headers,
    )
    staff_headers = _login("0799111005")

    res = client.post(
        f"/api/v1/organisations/{org['id']}/members",
        json={"phone_number": "0799111006", "role": "staff"},
        headers=staff_headers,
    )
    assert res.status_code == 403


def test_outsider_cannot_list_members():
    owner_headers = _login("0799111007")
    org = _create_org(owner_headers)
    outsider_headers = _login("0799111008")

    res = client.get(f"/api/v1/organisations/{org['id']}/members", headers=outsider_headers)
    assert res.status_code == 403


def test_organisation_cannot_be_left_with_no_owner_via_role_change():
    owner_headers = _login("0799111009")
    org = _create_org(owner_headers)

    res = client.get(f"/api/v1/organisations/{org['id']}/members", headers=owner_headers)
    owner_member_id = res.json()[0]["id"]

    res = client.patch(
        f"/api/v1/organisations/{org['id']}/members/{owner_member_id}",
        json={"role": "staff"},
        headers=owner_headers,
    )
    assert res.status_code == 400


def test_organisation_cannot_be_left_with_no_owner_via_removal():
    owner_headers = _login("0799111010")
    org = _create_org(owner_headers)

    res = client.get(f"/api/v1/organisations/{org['id']}/members", headers=owner_headers)
    owner_member_id = res.json()[0]["id"]

    res = client.delete(f"/api/v1/organisations/{org['id']}/members/{owner_member_id}", headers=owner_headers)
    assert res.status_code == 400


def test_promoting_a_second_owner_allows_the_first_to_step_down():
    owner_headers = _login("0799111011")
    org = _create_org(owner_headers)

    res = client.post(
        f"/api/v1/organisations/{org['id']}/members",
        json={"phone_number": "0799111012", "role": "staff"},
        headers=owner_headers,
    )
    second_member_id = res.json()["id"]

    res = client.patch(
        f"/api/v1/organisations/{org['id']}/members/{second_member_id}",
        json={"role": "owner"},
        headers=owner_headers,
    )
    assert res.status_code == 200

    res = client.get(f"/api/v1/organisations/{org['id']}/members", headers=owner_headers)
    first_owner_member_id = next(m["id"] for m in res.json() if m["phone_number"] == "254799111011")

    res = client.patch(
        f"/api/v1/organisations/{org['id']}/members/{first_owner_member_id}",
        json={"role": "staff"},
        headers=owner_headers,
    )
    assert res.status_code == 200  # a second owner exists now, so this is fine


# ── B3: cross-organisation scoping — negative tests for every protected route ─
# These are worth more than the happy-path ones: the happy path is the one
# you'd notice is broken.

def test_org_a_cannot_create_event_for_org_b():
    """The exact defect this block exists to fix: any authenticated user
    could create an event for any organiser."""
    a_headers = _login("0799111013")
    b_headers = _login("0799111014")
    org_b = _create_org(b_headers, "Org B")

    res = client.post("/api/v1/events/", json={
        "organization_id": org_b["id"],
        "title": "Hostile Takeover Event",
        "venue": "Test Venue",
        "event_date": "2027-04-01T18:00:00",
        "organizer_phone": "0700000000",
        "ticket_price_kes": 100,
        "total_capacity": 10,
    }, headers=a_headers)
    assert res.status_code == 403


def test_user_with_no_organisation_cannot_create_any_event():
    headers = _login("0799111015")
    res = client.post("/api/v1/events/", json={
        "organization_id": "00000000-0000-0000-0000-000000000000",
        "title": "No Org Event",
        "venue": "Test Venue",
        "event_date": "2027-04-01T18:00:00",
        "organizer_phone": "0700000000",
        "ticket_price_kes": 100,
        "total_capacity": 10,
    }, headers=headers)
    assert res.status_code == 403


def test_org_a_staff_cannot_register_a_scanner_for_org_b_event():
    a_headers = _login("0799111016")
    org_a = _create_org(a_headers, "Org A")
    b_headers = _login("0799111017")
    org_b = _create_org(b_headers, "Org B")

    res = client.post("/api/v1/events/", json={
        "organization_id": org_b["id"],
        "title": "Org B Event",
        "venue": "Test Venue",
        "event_date": "2027-04-01T18:00:00",
        "organizer_phone": "0700000000",
        "ticket_price_kes": 100,
        "total_capacity": 10,
    }, headers=b_headers)
    org_b_event = res.json()

    res = client.post(
        "/api/v1/gate/scanners",
        json={"event_id": org_b_event["id"], "gate_name": "Main Gate"},
        headers=a_headers,
    )
    assert res.status_code == 403
    assert org_a["id"] != org_b["id"]  # sanity: genuinely different orgs


def test_org_a_cannot_revoke_org_b_scanner():
    b_headers = _login("0799111018")
    org_b = _create_org(b_headers, "Org B Revoke Test")
    res = client.post("/api/v1/events/", json={
        "organization_id": org_b["id"],
        "title": "Org B Revoke Event",
        "venue": "Test Venue",
        "event_date": "2027-04-01T18:00:00",
        "organizer_phone": "0700000000",
        "ticket_price_kes": 100,
        "total_capacity": 10,
    }, headers=b_headers)
    org_b_event = res.json()
    res = client.post(
        "/api/v1/gate/scanners",
        json={"event_id": org_b_event["id"], "gate_name": "Main Gate"},
        headers=b_headers,
    )
    scanner_id = res.json()["scanner_id"]

    a_headers = _login("0799111019")
    res = client.post(f"/api/v1/gate/scanners/{scanner_id}/revoke", headers=a_headers)
    assert res.status_code == 403


def test_platform_admin_dependency_rejects_non_admin():
    """require_platform_admin itself, exercised directly rather than
    through a route (no PLATFORM_ADMIN-gated route exists yet — B1 defines
    the role, B5 defines how it's bootstrapped; nothing in this work order
    builds the admin surface itself, which is explicitly out of scope)."""
    from fastapi import HTTPException
    from app.core.authz import require_platform_admin
    from app.models.models import User

    non_admin = User(phone_number="254700000999", is_platform_admin=False)
    try:
        require_platform_admin(current_user=non_admin)
        assert False, "should have raised"
    except HTTPException as e:
        assert e.status_code == 403

    admin = User(phone_number="254700000998", is_platform_admin=True)
    assert require_platform_admin(current_user=admin) is admin
