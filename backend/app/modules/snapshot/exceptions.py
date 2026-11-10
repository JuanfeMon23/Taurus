from app.core.errors import ApiError


class UnknownCatalogCode(ApiError):
    """Un registro apunta a un código de catálogo que no existe (FK diferida al commit)."""

    status_code = 422
    code = "unknown_catalog_code"
    message = "Hay códigos de catálogo que no existen"
