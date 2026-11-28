"""Supabase Auth: verify the caller's JWT and load their role.

The frontend logs in with Supabase and sends the access token as
`Authorization: Bearer <JWT>`. `get_current_user` verifies that token and
returns the caller's `app_user` row; protected endpoints depend on it.
"""

import uuid
from functools import lru_cache
from typing import Annotated, Any, Literal

import jwt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.database import get_session
from app.models import AppUser, Student, Teacher

router = APIRouter(prefix="/auth", tags=["auth"])

Role = Literal["director", "teacher", "student"]

# Algorithms Supabase uses for asymmetric signing keys (JWKS).
ASYMMETRIC_ALGORITHMS = ["ES256", "RS256"]

# auto_error=False so a missing header becomes our own 401 with a clear
# message instead of FastAPI's default 403.
bearer_scheme = HTTPBearer(auto_error=False)


class CurrentUser(BaseModel):
    id: uuid.UUID
    role: Role
    degree_ids: list[int] = []


def _not_authenticated() -> HTTPException:
    return HTTPException(
        401, "Not authenticated", headers={"WWW-Authenticate": "Bearer"}
    )


@lru_cache(maxsize=4)
def _jwks_client(url: str) -> jwt.PyJWKClient:
    # One client per URL so the public keys are fetched once and cached.
    return jwt.PyJWKClient(url, cache_keys=True)


def decode_token(token: str, settings: Settings) -> dict[str, Any]:
    """Return the token's claims, or raise 401 if it is not valid."""
    issuer = (
        f"{settings.supabase_url.rstrip('/')}/auth/v1"
        if settings.supabase_url
        else None
    )

    try:
        if settings.supabase_jwt_secret:
            key: Any = settings.supabase_jwt_secret
            algorithms = ["HS256"]
        elif settings.supabase_jwks_url:
            jwks = _jwks_client(settings.supabase_jwks_url)
            key = jwks.get_signing_key_from_jwt(token).key
            algorithms = ASYMMETRIC_ALGORITHMS
        else:
            raise HTTPException(500, "Authentication is not configured on the server.")

        return jwt.decode(
            token,
            key,
            algorithms=algorithms,
            audience=settings.supabase_jwt_audience,
            issuer=issuer,
            options={"require": ["exp", "sub"]},
        )
    except jwt.PyJWKClientConnectionError as error:
        # Supabase's key endpoint is unreachable: the token may be fine.
        raise HTTPException(503, "Could not verify the token right now.") from error
    except jwt.PyJWTError as error:
        raise _not_authenticated() from error


def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(bearer_scheme)
    ],
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
) -> CurrentUser:
    if credentials is None:
        raise _not_authenticated()

    claims = decode_token(credentials.credentials, settings)

    try:
        user_id = uuid.UUID(str(claims["sub"]))
    except ValueError as error:
        raise _not_authenticated() from error

    user = session.get(AppUser, user_id)
    if user is None:
        raise HTTPException(403, "User has no role assigned")

    return CurrentUser(
        id=user.id,
        role=user.role,
        degree_ids=[degree.id for degree in user.degrees] if user.role == "director" else [],
    )

def require_role(*roles: Role):
    """Require the current user to have one of the specified roles."""

    def role_checker(
        user: Annotated[CurrentUser, Depends(get_current_user)],
    ) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(403, "Insufficient permissions")
        return user

    return role_checker

def require_director(
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> CurrentUser:
    """Require a signed-in director for draft-mutating operations."""
    if user.role != "director":
        raise HTTPException(403, "Only directors can modify draft timetables.")
    return user


class AccountView(CurrentUser):
    """GET /auth/me: the caller plus the record their account is linked to (KAN-69)."""

    teacher_id: int | None = None
    student_id: int | None = None


def _account(user: CurrentUser, session: Session) -> AppUser:
    # Already loaded by get_current_user in this session, so no extra query.
    return session.get(AppUser, user.id)


# teacher_id and student_id are left out when empty, as in the KAN-44 contract.
@router.get(
    "/me",
    response_model=AccountView,
    response_model_exclude_none=True,
    response_model_exclude={"degree_ids"},
)
def read_current_user(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> AccountView:
    account = _account(user, session)
    return AccountView(**user.model_dump(), teacher_id=account.teacher_id, student_id=account.student_id)


def get_current_teacher(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Teacher:
    """The teacher record of the signed-in teacher (for KAN-58's endpoints)."""
    if user.role != "teacher":
        raise HTTPException(403, "Only teachers can use this.")
    teacher = _account(user, session).teacher
    if teacher is None:
        raise HTTPException(403, "Your account is not linked to a teacher record.")
    return teacher


def get_current_student(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Student:
    """The student profile of the signed-in student (for KAN-59's /students/me endpoints).

    It is loaded in the request's database session, so an endpoint can pass it
    straight to the student services together with its own `session`.
    """
    if user.role != "student":
        raise HTTPException(403, "Only students can use this.")
    student = _account(user, session).student
    if student is None:
        raise HTTPException(403, "Your account is not linked to a student profile.")
    return student
