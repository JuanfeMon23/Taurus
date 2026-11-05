import re
from datetime import date, time
from decimal import Decimal
from typing import Annotated, Any, Literal, Self

from pydantic import (
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    PlainSerializer,
    model_validator,
)
from pydantic.alias_generators import to_camel

HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _parse_hhmm(value: Any) -> Any:
    if isinstance(value, str):
        if not HHMM.match(value):
            raise ValueError("La hora debe tener el formato HH:MM (00:00 a 23:59)")
        return time(int(value[:2]), int(value[3:]))
    return value


# Decimal en la BD, number en el JSON; hora HH:MM.
Num = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]
NonNeg = Annotated[
    Decimal, Field(ge=0), PlainSerializer(float, return_type=float, when_used="json")
]
Positive = Annotated[
    Decimal, Field(gt=0), PlainSerializer(float, return_type=float, when_used="json")
]
Hhmm = Annotated[
    time,
    BeforeValidator(_parse_hhmm),
    PlainSerializer(lambda t: t.strftime("%H:%M"), return_type=str, when_used="json"),
]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class SyncRecord(CamelModel):
    id: str = Field(min_length=1)
    updated_at: AwareDatetime
    deleted: bool = False


class DateIdRecord(SyncRecord):
    """Días y cajas: el id es la fecha."""

    date: date

    @model_validator(mode="after")
    def _id_es_la_fecha(self) -> Self:
        if self.id != self.date.isoformat():
            raise ValueError("El id debe ser igual a la fecha (AAAA-MM-DD)")
        return self


class CategoryRec(SyncRecord):
    name: str
    rate_mode: Literal["direct", "derived"]
    rate_per_km: NonNeg | None = None
    total_cost: NonNeg | None = None
    interval_km: Positive | None = None
    active: bool = True


class CostLine(CamelModel):
    category_id: str
    name: str
    rate: float
    amount: float


class DayRec(DateIdRecord):
    km: NonNeg
    note: str | None = None
    costs: list[CostLine] = []


class CashRec(DateIdRecord):
    opening: NonNeg
    opened_at: AwareDatetime
    closed_at: AwareDatetime | None = None
    counted: NonNeg | None = None


class MovementRec(SyncRecord):
    date: date
    type: Literal["expense", "withdrawal", "deposit"]
    amount: NonNeg
    note: str | None = None


class ServiceRec(SyncRecord):
    date: date
    amount: NonNeg
    method: Literal["cash", "transfer"]
    bonus: Annotated[NonNeg, BeforeValidator(lambda v: 0 if v is None else v)] = Decimal(0)
    note: str | None = None
    start_time: Hhmm | None = None
    end_time: Hhmm | None = None
    distance_km: NonNeg | None = None
    origin: str | None = None
    destination: str | None = None

    @model_validator(mode="after")
    def _viaje_completo(self) -> Self:
        trip = (self.start_time, self.end_time, self.distance_km)
        extra = (self.origin, self.destination)
        if any(v is not None for v in trip) and any(v is None for v in trip):
            raise ValueError(
                "Los datos de viaje van juntos: deben venir startTime, endTime y distanceKm"
            )
        if all(v is None for v in trip) and any(v for v in extra):
            raise ValueError(
                "Origen y destino requieren los datos de viaje: startTime, endTime y distanceKm"
            )
        return self


class SnapshotWrite(CamelModel):
    """Snapshot parcial: cualquier subconjunto de colecciones."""

    categories: list[CategoryRec] = []
    days: list[DayRec] = []
    services: list[ServiceRec] = []
    cash: list[CashRec] = []
    movements: list[MovementRec] = []


class SnapshotRead(SnapshotWrite):
    pass


class SnapshotResult(CamelModel):
    applied: dict[str, int]
    skipped: dict[str, int]
