"""Importar aquí los models.py de cada módulo para que Alembic los vea."""

from app.modules.accounts import models as accounts  # noqa: F401
from app.modules.cash import models as cash  # noqa: F401
from app.modules.catalogs import models as catalogs  # noqa: F401
from app.modules.categories import models as categories  # noqa: F401
from app.modules.days import models as days  # noqa: F401
from app.modules.services import models as services  # noqa: F401
from app.modules.settings import models as settings  # noqa: F401
from app.modules.shifts import models as shifts  # noqa: F401
