from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

MESSAGES = {
    "missing": "Campo obligatorio",
    "json_invalid": "El cuerpo no es un JSON válido",
    "literal_error": "Valor no permitido",
    "greater_than_equal": "Debe ser mayor o igual a {ge}",
    "greater_than": "Debe ser mayor que {gt}",
    "string_type": "Debe ser texto",
    "bool_type": "Debe ser verdadero o falso",
    "list_type": "Debe ser una lista",
    "decimal_type": "Debe ser un número",
    "decimal_parsing": "Debe ser un número",
    "date_from_datetime_parsing": "Fecha inválida (AAAA-MM-DD)",
    "date_parsing": "Fecha inválida (AAAA-MM-DD)",
    "date_type": "Fecha inválida (AAAA-MM-DD)",
    "datetime_parsing": "Fecha y hora inválidas (ISO 8601 con zona horaria)",
    "datetime_from_date_parsing": "Fecha y hora inválidas (ISO 8601 con zona horaria)",
    "timezone_aware": "La fecha y hora debe incluir zona horaria (por ejemplo, Z)",
    "string_too_short": "No puede estar vacío",
}


class ApiError(Exception):
    """Error de negocio con el formato `{code, message, details}`; los módulos lo subclasean."""

    status_code = 422
    code = "error"
    message = "Error"

    def __init__(self, details: list[dict[str, str]] | None = None) -> None:
        super().__init__(self.message)
        self.details = details or []


async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message, "details": exc.details},
    )


def _message(error: dict[str, Any]) -> str:
    template = MESSAGES.get(error["type"])
    if template:
        return template.format(**error.get("ctx", {}))
    message_text = str(error["msg"])
    return message_text.removeprefix("Value error, ")


def _detail(error: dict[str, Any]) -> dict[str, str]:
    location = [str(part) for part in error["loc"] if part != "body"]
    return {"campo": ".".join(location), "mensaje": _message(error)}


async def validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "code": "validation_error",
            "message": "Los datos enviados no son válidos",
            "details": [_detail(error) for error in exc.errors()],
        },
    )


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_handler)  # type: ignore[arg-type]
