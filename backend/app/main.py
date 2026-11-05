from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core import health
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.modules.snapshot.router import router as snapshot_router

app = FastAPI(title="Taurus API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["GET", "PUT", "OPTIONS"],
    allow_headers=["Content-Type"],
)
register_error_handlers(app)

app.include_router(health.router, prefix="/api/v1")
app.include_router(snapshot_router, prefix="/api/v1/snapshot")
