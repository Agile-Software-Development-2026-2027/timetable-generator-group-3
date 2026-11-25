"""Director-only management of accounts and their teacher/student link (KAN-69)."""

import re
import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.auth import CurrentUser, Role, require_director
from app.config import Settings, get_settings
from app.database import get_session
from app.models import AppUser, Student, Teacher, TimetablePublication
from app.supabase_admin import AdminError, AuthAccount, SupabaseAdmin, get_supabase_admin

router = APIRouter(prefix="/users", tags=["users"])

Database = Annotated[Session, Depends(get_session)]
Director = Annotated[CurrentUser, Depends(require_director)]
Admin = Annotated[SupabaseAdmin, Depends(get_supabase_admin)]

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AccountLink(BaseModel):
    role: Role
    teacher_id: int | None = Field(default=None, gt=0)
    student_id: int | None = Field(default=None, gt=0)


class UserInvite(AccountLink):
    email: str = Field(max_length=254)

    @field_validator("email", mode="before")
    @classmethod
    def normalise_email(cls, value):
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("email")
    @classmethod
    def check_email(cls, value: str) -> str:
        if not EMAIL_PATTERN.match(value):
            raise ValueError("Enter a valid email address.")
        return value


class UserView(BaseModel):
    id: uuid.UUID
    email: str | None
    role: Role
    teacher_id: int | None
    student_id: int | None
    linked_name: str | None
    # "invited" until the user accepts the invite and sets a password.
    status: Literal["invited", "active", "deactivated"] | None
    created_at: datetime | None


def linked_name(user: AppUser) -> str | None:
    if user.teacher is not None:
        return user.teacher.name
    if user.student is not None:
        return f"{user.student.name} ({user.student.student_number})"
    return None


def user_view(user: AppUser, account: AuthAccount | None) -> UserView:
    status = None
    if account is not None:
        status = "deactivated" if account.banned else "active" if account.confirmed else "invited"
    return UserView(
        id=user.id,
        email=account.email if account else None,
        role=user.role,
        teacher_id=user.teacher_id,
        student_id=user.student_id,
        linked_name=linked_name(user),
        status=status,
        created_at=user.created_at,
    )


def admin_error(error: AdminError) -> HTTPException:
    if error.code == "email_exists" or "already been registered" in error.message:
        return HTTPException(409, "An account with this email already exists.")
    if error.status_code == 429:
        return HTTPException(429, f"Supabase is limiting invite emails: {error.message}")
    if error.status_code == 503:
        return HTTPException(503, error.message)
    return HTTPException(502, f"Supabase refused the request: {error.message}")


def check_link(data: AccountLink, session: Session, user_id: uuid.UUID | None = None) -> None:
    """Make sure the link fits the role, exists, and is not used by another account."""
    if data.role == "director" and (data.teacher_id or data.student_id):
        raise HTTPException(422, "A director account is not linked to a teacher or student.")
    if data.role == "teacher" and (data.teacher_id is None or data.student_id is not None):
        raise HTTPException(422, "Choose the teacher this account belongs to.")
    if data.role == "student" and (data.student_id is None or data.teacher_id is not None):
        raise HTTPException(422, "Choose the student this account belongs to.")

    if data.teacher_id is not None:
        if session.get(Teacher, data.teacher_id) is None:
            raise HTTPException(404, "Teacher not found.")
        column, label = AppUser.teacher_id, "teacher"
        linked_id = data.teacher_id
    elif data.student_id is not None:
        if session.get(Student, data.student_id) is None:
            raise HTTPException(404, "Student not found.")
        column, label = AppUser.student_id, "student"
        linked_id = data.student_id
    else:
        return

    query = select(AppUser.id).where(column == linked_id)
    if user_id is not None:
        query = query.where(AppUser.id != user_id)
    if session.scalar(query) is not None:
        raise HTTPException(409, f"This {label} is already linked to another account.")


def load_user(user_id: uuid.UUID, session: Session) -> AppUser:
    user = session.get(AppUser, user_id)
    if user is None:
        raise HTTPException(404, "Account not found.")
    return user


@router.get("", response_model=list[UserView])
def list_users(session: Database, _director: Director, admin: Admin) -> list[UserView]:
    try:
        accounts = {account.id: account for account in admin.list_users()}
    except AdminError as error:
        raise admin_error(error) from error
    users = session.scalars(
        select(AppUser).options(selectinload(AppUser.teacher), selectinload(AppUser.student))
    ).all()
    views = [user_view(user, accounts.get(user.id)) for user in users]
    return sorted(views, key=lambda view: (view.email is None, view.email or "", str(view.id)))


@router.post("", response_model=UserView, status_code=201)
def invite_user(
    data: UserInvite,
    session: Database,
    _director: Director,
    admin: Admin,
    settings: Annotated[Settings, Depends(get_settings)],
) -> UserView:
    check_link(data, session)
    try:
        account = admin.invite_user(data.email, settings.invite_redirect_url)
    except AdminError as error:
        raise admin_error(error) from error

    user = AppUser(id=account.id, role=data.role, teacher_id=data.teacher_id, student_id=data.student_id)
    session.add(user)
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        # Another request linked the same record (or reused the account) in the
        # meantime: undo the invite so no account is left without a role.
        try:
            admin.delete_user(account.id)
        except AdminError:
            pass
        raise HTTPException(409, "This account or record is already linked.") from error
    session.refresh(user)
    return user_view(user, account)


@router.patch("/{user_id}", response_model=UserView)
def update_user(
    user_id: uuid.UUID,
    data: AccountLink,
    session: Database,
    director: Director,
    admin: Admin,
) -> UserView:
    user = load_user(user_id, session)
    if user.id == director.id and data.role != "director":
        raise HTTPException(409, "You cannot change your own role.")
    check_link(data, session, user.id)

    user.role, user.teacher_id, user.student_id = data.role, data.teacher_id, data.student_id
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise HTTPException(409, "This record is already linked to another account.") from error
    session.refresh(user)
    try:
        account = admin.get_user(user.id)
    except AdminError:
        account = None
    return user_view(user, account)


@router.delete("/{user_id}", status_code=204)
def deactivate_user(user_id: uuid.UUID, session: Database, director: Director, admin: Admin) -> None:
    user = load_user(user_id, session)
    if user.id == director.id:
        raise HTTPException(409, "You cannot deactivate your own account.")
    if session.scalar(select(TimetablePublication.degree_id).where(TimetablePublication.published_by == user.id)):
        raise HTTPException(409, "This director published a timetable, so the account cannot be removed.")

    # Remove the role first, without committing, so a database problem stops here
    # before Supabase bans anyone. A plain DELETE lets the database's ON DELETE
    # rules clean up linked rows instead of loading every relationship.
    session.execute(delete(AppUser).where(AppUser.id == user.id))
    try:
        admin.ban_user(user.id)
    except AdminError as error:
        # Already gone from Supabase: removing the role is all that is left to do.
        if error.status_code != 404:
            session.rollback()
            raise admin_error(error) from error
    session.commit()
