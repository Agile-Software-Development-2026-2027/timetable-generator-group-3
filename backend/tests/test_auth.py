import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from app import auth
from app.config import Settings, get_settings
from app.main import app
from app.models import AppUser, Degree


def _use_settings(**overrides):
    settings = Settings(
        _env_file=None,
        supabase_url="",
        supabase_jwt_secret="",
        supabase_jwks_url="",
        supabase_jwt_audience="authenticated",
    ).model_copy(update=overrides)
    app.dependency_overrides[get_settings] = lambda: settings


def _add_user(session, role="director"):
    user = AppUser(id=uuid.uuid4(), role=role, **linked_record(session, role))
    session.add(user)
    session.commit()
    return user


def _get_me(client, token):
    return client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})


def test_director_token_returns_only_id_and_role(client, session, make_token):
    user = _add_user(session, "director")

    response = _get_me(client, make_token(user.id))

    assert response.status_code == 200
    assert response.json() == {"id": str(user.id), "role": "director"}


@pytest.mark.parametrize("role,field", [("teacher", "teacher_id"), ("student", "student_id")])
def test_me_returns_the_linked_record(client, session, make_token, role, field):
    user = _add_user(session, role)

    response = _get_me(client, make_token(user.id))

    assert response.status_code == 200
    assert response.json() == {
        "id": str(user.id),
        "role": role,
        "degree_ids": [],
    }

def test_auth_client_fixture_logs_in_with_the_given_role(auth_client):
    response = auth_client("teacher").get("/auth/me")

    assert response.status_code == 200
    assert response.json()["role"] == "teacher"


def test_missing_token_returns_401(client):
    response = client.get("/auth/me")

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}
    assert response.headers["www-authenticate"] == "Bearer"


def test_non_bearer_scheme_returns_401(client):
    response = client.get("/auth/me", headers={"Authorization": "Basic abc"})

    assert response.status_code == 401


def test_expired_token_returns_401(client, session, make_token):
    user = _add_user(session)

    response = _get_me(client, make_token(user.id, expires_in=-60))

    assert response.status_code == 401


def test_bad_signature_returns_401(client, session, make_token):
    user = _add_user(session)
    token = make_token(user.id, secret="another-secret-that-is-long-enough-123")

    assert _get_me(client, token).status_code == 401


def test_wrong_audience_returns_401(client, session, make_token):
    user = _add_user(session)

    assert _get_me(client, make_token(user.id, audience="anon")).status_code == 401


def test_garbage_token_returns_401(client):
    assert _get_me(client, "not-a-jwt").status_code == 401


def test_subject_that_is_not_a_uuid_returns_401(client, make_token):
    assert _get_me(client, make_token("not-a-uuid")).status_code == 401


def test_unknown_user_returns_403(client, make_token):
    response = _get_me(client, make_token(uuid.uuid4()))

    assert response.status_code == 403
    assert response.json() == {"detail": "User has no role assigned"}


def test_issuer_is_checked_when_supabase_url_is_set(client, session, make_token):
    user = _add_user(session)
    secret = "issuer-test-secret-0123456789-abcdef"
    _use_settings(supabase_url="https://demo.supabase.co/", supabase_jwt_secret=secret)

    good = make_token(user.id, secret=secret, iss="https://demo.supabase.co/auth/v1")
    other = make_token(user.id, secret=secret, iss="https://other.supabase.co/auth/v1")

    assert _get_me(client, good).status_code == 200
    assert _get_me(client, other).status_code == 401


def test_asymmetric_keys_from_jwks_are_supported(client, session, monkeypatch):
    user = _add_user(session, "student")
    private_key = ec.generate_private_key(ec.SECP256R1())

    class FakeJwksClient:
        def get_signing_key_from_jwt(self, _token):
            return jwt.PyJWK.from_dict(
                {**jwt.algorithms.ECAlgorithm.to_jwk(private_key.public_key(), as_dict=True),
                 "alg": "ES256"}
            )

    monkeypatch.setattr(auth, "_jwks_client", lambda _url: FakeJwksClient())
    _use_settings(supabase_jwks_url="https://demo.supabase.co/auth/v1/.well-known/jwks.json")
    now = int(time.time())
    token = jwt.encode(
        {"sub": str(user.id), "aud": "authenticated", "iat": now, "exp": now + 60},
        private_key,
        algorithm="ES256",
    )

    response = _get_me(client, token)

    assert response.status_code == 200
    assert response.json()["role"] == "student"


def test_unreachable_jwks_returns_503(client, monkeypatch, make_token):
    class DownJwksClient:
        def get_signing_key_from_jwt(self, _token):
            raise jwt.PyJWKClientConnectionError("connection refused")

    monkeypatch.setattr(auth, "_jwks_client", lambda _url: DownJwksClient())
    _use_settings(supabase_jwks_url="https://demo.supabase.co/auth/v1/.well-known/jwks.json")

    assert _get_me(client, make_token(uuid.uuid4())).status_code == 503


def test_missing_auth_configuration_returns_500(client, make_token):
    _use_settings()

    assert _get_me(client, make_token(uuid.uuid4())).status_code == 500

def test_director_degree_relationship(session):
    user = _add_user(session, role="director")
    degree = Degree(name="Computer Science")

    user.degrees.append(degree)
    session.commit()

    saved_user = session.get(AppUser, user.id)

    assert len(saved_user.degrees) == 1
    assert saved_user.degrees[0].name == "Computer Science"

def test_auth_me_returns_assigned_degree_ids(client, session, make_token):
    user = _add_user(session, role="director")
    degree = Degree(name="Computer Science")
    user.degrees.append(degree)
    session.commit()

    response = _get_me(client, make_token(user.id))

    assert response.status_code == 200
    assert response.json()["degree_ids"] == [degree.id]
