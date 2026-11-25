"""The only code that calls the Supabase Auth Admin API (KAN-69).

It uses the service role key, which can create and ban any account, so it is
read from SUPABASE_SERVICE_ROLE_KEY by the backend and never sent to the
browser. Endpoints get it through `get_supabase_admin`, which tests replace
with a fake so no test ever calls Supabase.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Any

import httpx
from fastapi import Depends, HTTPException

from app.config import Settings, get_settings

# Supabase has no permanent ban, so a deactivated account is banned for ~100 years.
BAN_DURATION = "876000h"
USERS_PER_PAGE = 1000


@dataclass(frozen=True)
class AuthAccount:
    id: uuid.UUID
    email: str
    # True once the user has accepted the invite (or confirmed their email).
    confirmed: bool
    banned: bool


class AdminError(Exception):
    """Supabase refused a request or could not be reached."""

    def __init__(self, status_code: int, message: str, code: str = ""):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.code = code


def _is_future(timestamp: str | None) -> bool:
    if not timestamp:
        return False
    try:
        return datetime.fromisoformat(timestamp.replace("Z", "+00:00")) > datetime.now(UTC)
    except ValueError:
        return False


def _account(user: dict[str, Any]) -> AuthAccount:
    return AuthAccount(
        id=uuid.UUID(user["id"]),
        email=user.get("email") or "",
        confirmed=bool(user.get("email_confirmed_at") or user.get("confirmed_at")),
        banned=_is_future(user.get("banned_until")),
    )


def _error(response: httpx.Response) -> AdminError:
    try:
        body = response.json()
    except ValueError:
        body = {}
    message = (
        body.get("msg") or body.get("message") or body.get("error_description")
        or body.get("error") or f"Supabase answered {response.status_code}."
    )
    return AdminError(response.status_code, str(message), str(body.get("error_code") or ""))


class SupabaseAdmin:
    def __init__(self, url: str, service_role_key: str, client: httpx.Client | None = None):
        self._base = f"{url.rstrip('/')}/auth/v1"
        self._headers = {"apikey": service_role_key, "Authorization": f"Bearer {service_role_key}"}
        self._client = client or httpx.Client(timeout=10.0)

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            response = self._client.request(method, f"{self._base}{path}", headers=self._headers, **kwargs)
        except httpx.HTTPError as error:
            raise AdminError(503, "Could not reach Supabase. Try again in a moment.") from error
        if response.is_error:
            raise _error(response)
        return response.json() if response.content else None

    def invite_user(self, email: str, redirect_to: str) -> AuthAccount:
        """Create the account and email the invite link (auth.admin.inviteUserByEmail)."""
        user = self._request("POST", "/invite", json={"email": email}, params={"redirect_to": redirect_to})
        return _account(user)

    def list_users(self) -> list[AuthAccount]:
        accounts: list[AuthAccount] = []
        page = 1
        while True:
            body = self._request("GET", "/admin/users", params={"page": page, "per_page": USERS_PER_PAGE})
            users = body.get("users", [])
            accounts.extend(_account(user) for user in users)
            if len(users) < USERS_PER_PAGE:
                return accounts
            page += 1

    def get_user(self, user_id: uuid.UUID) -> AuthAccount:
        return _account(self._request("GET", f"/admin/users/{user_id}"))

    def ban_user(self, user_id: uuid.UUID) -> None:
        self._request("PUT", f"/admin/users/{user_id}", json={"ban_duration": BAN_DURATION})

    def delete_user(self, user_id: uuid.UUID) -> None:
        self._request("DELETE", f"/admin/users/{user_id}")


def get_supabase_admin(settings: Annotated[Settings, Depends(get_settings)]) -> SupabaseAdmin:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise HTTPException(
            503,
            "User management is not configured: set SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY in backend/.env.",
        )
    return SupabaseAdmin(settings.supabase_url, settings.supabase_service_role_key)
