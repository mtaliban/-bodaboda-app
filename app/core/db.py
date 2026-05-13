from time import time

from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session


# ── DB query timing ───────────────────────────────────────────────────────────
# Hooks into SQLAlchemy's sync engine (which the async engine wraps) to measure
# every query and record it in the bodaboda_db_query_duration_seconds histogram.

@event.listens_for(engine.sync_engine, "before_cursor_execute")
def _before_query(conn, cursor, statement, params, context, executemany):
    conn.info.setdefault("_qstart", []).append(time())


@event.listens_for(engine.sync_engine, "after_cursor_execute")
def _after_query(conn, cursor, statement, params, context, executemany):
    from app.metrics import DB_QUERY_DURATION  # lazy — avoids import-time circularity
    elapsed = time() - conn.info["_qstart"].pop(-1)
    op = statement.strip().split()[0].upper() if statement else "UNKNOWN"
    DB_QUERY_DURATION.labels(operation=op).observe(elapsed)
