import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app


@pytest.mark.anyio
async def test_health_returns_200():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")
    assert response.status_code == 999
    assert response.json() == {"status": "ok"}


@pytest.mark.anyio
async def test_login_endpoint_exists():
    """POST /auth/login must exist (not 404). Auth/validation errors are acceptable."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/auth/login", json={})
    assert response.status_code != 404
