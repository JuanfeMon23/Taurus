import os
import subprocess
import sys
from collections.abc import AsyncIterator, Callable
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.config import get_settings

BACKEND_DIR = Path(__file__).resolve().parents[4]
TEST_DB = "taurus_test"


@pytest.fixture(scope="session")
def test_url() -> str:
    url = make_url(get_settings().database_url).set(database=TEST_DB)
    return url.render_as_string(hide_password=False)


@pytest.fixture(scope="session")
def alembic(test_url: str) -> Callable[..., None]:
    def run(*args: str) -> None:
        env = {**os.environ, "DATABASE_URL": test_url}
        subprocess.run(
            [sys.executable, "-m", "alembic", *args],
            cwd=BACKEND_DIR,
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )

    return run


@pytest.fixture(scope="session", autouse=True)
def migrated(alembic: Callable[..., None]) -> None:
    alembic("upgrade", "head")


@pytest_asyncio.fixture
async def session(test_url: str) -> AsyncIterator[AsyncSession]:
    """Sesión con rollback al final: ningún test deja datos."""
    engine = create_async_engine(test_url)
    async with engine.connect() as conn:
        trans = await conn.begin()
        async with AsyncSession(bind=conn, join_transaction_mode="create_savepoint") as s:
            yield s
        await trans.rollback()
    await engine.dispose()
