"""
Organisation onboarding (Work Order 04 B2). Wires Organizer and
OrganizerMember, which have existed since the first migration with zero
rows and no routes.

No verification workflow is built — verification_status is set PENDING at
creation and never progressed by any code here.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.models import Organizer, OrganizerMember, OrganizerRole, OrganizerVerificationStatus, User
from app.schemas.schemas import (
    OrganisationCreate, OrganisationOut, MyOrganisationOut, MemberInvite, MemberRoleUpdate, MemberOut,
)
from app.core.dependencies import get_current_user
from app.core.authz import require_org_role
from app.services.auth_service import get_or_create_user

router = APIRouter(prefix="/organisations", tags=["Organisations"])


def _member_out(member: OrganizerMember) -> MemberOut:
    return MemberOut(
        id=member.id,
        account_id=member.account_id,
        phone_number=member.user.phone_number if member.user else "",
        role=member.role.value,
        created_at=member.created_at,
    )


@router.post("/", response_model=OrganisationOut, status_code=status.HTTP_201_CREATED)
def create_organisation(
    body: OrganisationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create an organisation. The creating user becomes its OWNER."""
    org = Organizer(business_name=body.business_name, verification_status=OrganizerVerificationStatus.PENDING)
    db.add(org)
    db.flush()

    db.add(OrganizerMember(organizer_id=org.id, account_id=current_user.id, role=OrganizerRole.OWNER))
    current_user.is_organizer = True
    db.commit()
    db.refresh(org)
    return org


@router.get("/mine", response_model=list[MyOrganisationOut])
def list_my_organisations(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Every organisation the current user is a member of, any role, with
    the caller's own role in each — the frontend's AuthContext (C1) uses
    this to decide whether the Organiser surface is reachable at all."""
    memberships = db.query(OrganizerMember).filter(OrganizerMember.account_id == current_user.id).all()
    return [
        MyOrganisationOut(
            id=m.organizer.id,
            business_name=m.organizer.business_name,
            verification_status=m.organizer.verification_status.value,
            created_at=m.organizer.created_at,
            role=m.role.value,
        )
        for m in memberships if m.organizer
    ]


@router.get("/{organization_id}/members", response_model=list[MemberOut])
def list_members(
    member: OrganizerMember = Depends(require_org_role(OrganizerRole.STAFF)),
    db: Session = Depends(get_db),
):
    """Any member (owner or staff) can view the roster."""
    members = db.query(OrganizerMember).filter(OrganizerMember.organizer_id == member.organizer_id).all()
    return [_member_out(m) for m in members]


@router.post("/{organization_id}/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
def invite_member(
    organization_id: str,
    body: MemberInvite,
    _owner: OrganizerMember = Depends(require_org_role(OrganizerRole.OWNER)),
    db: Session = Depends(get_db),
):
    """Invite a user (by phone number) to this organisation with a role.
    Owner-only. Creates the user account if this is their first contact
    with the platform, same as auth does at verify-otp/login."""
    invitee = get_or_create_user(db, body.phone_number)

    existing = (
        db.query(OrganizerMember)
        .filter(OrganizerMember.organizer_id == organization_id, OrganizerMember.account_id == invitee.id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="This user is already a member of this organisation")

    member = OrganizerMember(organizer_id=organization_id, account_id=invitee.id, role=OrganizerRole(body.role))
    db.add(member)
    invitee.is_organizer = True
    db.commit()
    db.refresh(member)
    return _member_out(member)


@router.patch("/{organization_id}/members/{member_id}", response_model=MemberOut)
def update_member_role(
    organization_id: str,
    member_id: str,
    body: MemberRoleUpdate,
    _owner: OrganizerMember = Depends(require_org_role(OrganizerRole.OWNER)),
    db: Session = Depends(get_db),
):
    """Change a member's role. Owner-only. An organisation cannot be left
    with no owner — rejects demoting the last remaining OWNER."""
    member = (
        db.query(OrganizerMember)
        .filter(OrganizerMember.id == member_id, OrganizerMember.organizer_id == organization_id)
        .first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    new_role = OrganizerRole(body.role)
    if member.role == OrganizerRole.OWNER and new_role != OrganizerRole.OWNER:
        remaining_owners = (
            db.query(OrganizerMember)
            .filter(
                OrganizerMember.organizer_id == organization_id,
                OrganizerMember.role == OrganizerRole.OWNER,
                OrganizerMember.id != member_id,
            )
            .count()
        )
        if remaining_owners == 0:
            raise HTTPException(status_code=400, detail="An organisation cannot be left with no owner")

    member.role = new_role
    db.commit()
    db.refresh(member)
    return _member_out(member)


@router.delete("/{organization_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    organization_id: str,
    member_id: str,
    _owner: OrganizerMember = Depends(require_org_role(OrganizerRole.OWNER)),
    db: Session = Depends(get_db),
):
    """Remove a member. Owner-only. Cannot remove the last remaining owner."""
    member = (
        db.query(OrganizerMember)
        .filter(OrganizerMember.id == member_id, OrganizerMember.organizer_id == organization_id)
        .first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    if member.role == OrganizerRole.OWNER:
        remaining_owners = (
            db.query(OrganizerMember)
            .filter(
                OrganizerMember.organizer_id == organization_id,
                OrganizerMember.role == OrganizerRole.OWNER,
                OrganizerMember.id != member_id,
            )
            .count()
        )
        if remaining_owners == 0:
            raise HTTPException(status_code=400, detail="An organisation cannot be left with no owner")

    db.delete(member)
    db.commit()
