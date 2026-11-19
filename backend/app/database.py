from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def _make_engine():
    settings = get_settings()
    url = settings.database_url

    if url.startswith("sqlite"):
        return create_engine(
            url, connect_args={"check_same_thread": False}, future=True
        )

    connect_args: dict = {}
    if "supabase.co" in url or "supabase.com" in url:
        if "sslmode=" not in url:
            connect_args["sslmode"] = "require"

    if "pooler.supabase.com" in url:
        # Supabase's pooler (Supavisor) already pools connections and caps
        # clients per project (15 on this plan), shared by the whole team.
        # SQLAlchemy's default QueuePool can hold up to 15 connections per
        # process on its own, which exhausts that cap (EMAXCONNSESSION).
        # NullPool returns each connection as soon as the session closes.
        return create_engine(
            url, connect_args=connect_args, poolclass=NullPool, future=True
        )

    return create_engine(
        url, connect_args=connect_args, pool_pre_ping=True, future=True
    )


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_session() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
