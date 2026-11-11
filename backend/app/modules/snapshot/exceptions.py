from app.core.errors import ApiError


class UnknownCatalogCode(ApiError):
    """Un registro apunta a un código de catálogo que no existe (FK diferida al commit)."""

    status_code = 422
    code = "unknown_catalog_code"
    message = "Hay códigos de catálogo que no existen"


class TripRequiresShift(ApiError):
    """Un viaje vivo llega sin turno (regla: no hay viajes sin turnos)."""

    status_code = 422
    code = "trip_requires_shift"
    message = "El viaje necesita un turno"

    def __init__(self) -> None:
        super().__init__([{"campo": "services.shiftId", "mensaje": self.message}])


class AccountRuleViolation(ApiError):
    """Cuentas incoherentes: `affectsCash` contra la cuenta, o destino de un traslado."""

    status_code = 422
    code = "account_rule_violation"
    message = "Las cuentas no cumplen las reglas"
