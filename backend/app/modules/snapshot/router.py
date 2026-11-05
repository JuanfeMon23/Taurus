from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db.session import get_session
from app.modules.snapshot import controller
from app.modules.snapshot.schemas import SnapshotRead, SnapshotResult, SnapshotWrite

router = APIRouter(tags=["snapshot"])
Session = Annotated[AsyncSession, Depends(get_session)]


@router.get(
    "", response_model=SnapshotRead, response_model_by_alias=True, response_model_exclude_none=True
)
async def get_snapshot(session: Session) -> SnapshotRead:
    return await controller.get_snapshot(session)


@router.put("", response_model=SnapshotResult, response_model_by_alias=True)
async def put_snapshot(body: SnapshotWrite, session: Session) -> SnapshotResult:
    return await controller.apply_snapshot(session, body)
