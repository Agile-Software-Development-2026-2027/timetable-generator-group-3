"""KAN-69: the Supabase Admin API wrapper, against a fake HTTP server."""

import json
import uuid

import httpx
import pytest

from app.config import Settings
from app.supabase_admin import BAN_DURATION, AdminError, SupabaseAdmin, get_supabase_admin

USER_ID = uuid.uuid4()


def user(**fields):
    return {"id": str(USER_ID), "email": "ada@unical.it", **fields}


def admin_with(handler):
    calls = []

    def record(request):
        calls.append(request)
        return handler(request)

    client = httpx.Client(transport=httpx.MockTransport(record))
    return SupabaseAdmin("https://demo.supabase.co/", "service-key", client), calls


def test_invite_posts_the_email_and_redirect_with_the_service_key():
    admin, calls = admin_with(lambda _request: httpx.Response(200, json=user(invited_at="2026-01-01T00:00:00Z")))

    account = admin.invite_user("ada@unical.it", "http://localhost:3000/set-password")

    [request] = calls
    assert (request.method, request.url.path) == ("POST", "/auth/v1/invite")
    assert request.url.params["redirect_to"] == "http://localhost:3000/set-password"
    assert json.loads(request.content) == {"email": "ada@unical.it"}
    assert request.headers["apikey"] == "service-key"
    assert request.headers["authorization"] == "Bearer service-key"
    assert (account.id, account.email, account.confirmed, account.banned) == (USER_ID, "ada@unical.it", False, False)


def test_list_users_reads_every_page(monkeypatch):
    monkeypatch.setattr("app.supabase_admin.USERS_PER_PAGE", 2)
    pages = {
        "1": [user(id=str(uuid.uuid4())), user(id=str(uuid.uuid4()))],
        "2": [user(email_confirmed_at="2026-01-01T00:00:00Z", banned_until="2999-01-01T00:00:00Z")],
    }
    admin, calls = admin_with(lambda request: httpx.Response(200, json={"users": pages[request.url.params["page"]]}))

    accounts = admin.list_users()

    assert len(accounts) == 3
    assert [request.url.params["page"] for request in calls] == ["1", "2"]
    assert (accounts[-1].confirmed, accounts[-1].banned) == (True, True)


def test_an_expired_ban_is_not_a_ban():
    admin, _calls = admin_with(lambda _request: httpx.Response(200, json=user(banned_until="2000-01-01T00:00:00Z")))

    assert admin.get_user(USER_ID).banned is False


def test_ban_sets_a_long_ban_duration():
    admin, calls = admin_with(lambda _request: httpx.Response(200, json=user()))

    admin.ban_user(USER_ID)

    [request] = calls
    assert (request.method, request.url.path) == ("PUT", f"/auth/v1/admin/users/{USER_ID}")
    assert json.loads(request.content) == {"ban_duration": BAN_DURATION}


def test_delete_user_calls_the_admin_endpoint():
    admin, calls = admin_with(lambda _request: httpx.Response(200))

    admin.delete_user(USER_ID)

    assert (calls[0].method, calls[0].url.path) == ("DELETE", f"/auth/v1/admin/users/{USER_ID}")


def test_errors_keep_supabases_status_message_and_code():
    body = {"code": 422, "error_code": "email_exists", "msg": "A user with this email address has already been registered"}
    admin, _calls = admin_with(lambda _request: httpx.Response(422, json=body))

    with pytest.raises(AdminError) as raised:
        admin.invite_user("ada@unical.it", "http://localhost:3000/set-password")

    assert (raised.value.status_code, raised.value.code) == (422, "email_exists")
    assert raised.value.message == body["msg"]


def test_unreachable_supabase_is_a_503():
    def refuse(request):
        raise httpx.ConnectError("connection refused", request=request)

    admin, _calls = admin_with(refuse)

    with pytest.raises(AdminError) as raised:
        admin.list_users()

    assert raised.value.status_code == 503


@pytest.mark.parametrize("settings", [
    {"supabase_url": "", "supabase_service_role_key": "key"},
    {"supabase_url": "https://demo.supabase.co", "supabase_service_role_key": ""},
])
def test_missing_configuration_is_a_503(settings):
    with pytest.raises(Exception) as raised:
        get_supabase_admin(Settings(_env_file=None, **settings))

    assert raised.value.status_code == 503
