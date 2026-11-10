from typing import Any

from httpx import AsyncClient

URL = "/api/v1/snapshot"
T1 = "2026-11-04T10:00:00Z"
T2 = "2026-11-04T11:00:00Z"
T_FUTURE = "2099-01-01T00:00:00Z"  # la semilla de settings tiene updated_at = fecha de migración


def svc(**overrides: Any) -> dict[str, Any]:
    return {
        "id": "s1",
        "date": "2026-11-04",
        "amount": 12.5,
        "method": "cash",
        "updatedAt": T1,
        **overrides,
    }


def trip(**overrides: Any) -> dict[str, Any]:
    return {"startTime": "22:30", "endTime": "00:15", "distanceKm": 7.5, **overrides}


async def put(client: AsyncClient, body: dict[str, Any]) -> Any:
    return await client.put(URL, json=body)


async def get_col(client: AsyncClient, collection: str) -> list[dict[str, Any]]:
    return (await client.get(URL)).json()[collection]


async def test_health(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_get_devuelve_todas_las_colecciones(client: AsyncClient) -> None:
    response = await client.get(URL)
    assert response.status_code == 200
    assert set(response.json()) == {
        "categories",
        "days",
        "services",
        "cash",
        "movements",
        "depositMovements",
        "fundMovements",
        "settings",
        "shifts",
        "shiftTemplates",
        "paymentMethods",
        "movementTypes",
        "fundMovementTypes",
        "expenseCategories",
        "rateModes",
    }


async def test_snapshot_parcial_solo_toca_lo_enviado(client: AsyncClient) -> None:
    response = await put(client, {"services": [svc()]})
    assert response.status_code == 200
    body = response.json()
    assert body["applied"]["services"] == 1
    assert body["applied"]["days"] == 0
    assert body["skipped"]["services"] == 0


async def test_roundtrip_formatos_camelcase(client: AsyncClient) -> None:
    await put(
        client,
        {
            "services": [svc(**trip(origin="A", destination="B"))],
            "days": [
                {
                    "id": "2026-11-04",
                    "date": "2026-11-04",
                    "km": 80,
                    "updatedAt": T1,
                    "costs": [{"categoryId": "c1", "name": "Gas", "rate": 0.25, "amount": 20}],
                }
            ],
            "categories": [
                {
                    "id": "c1",
                    "name": "Gas",
                    "rateMode": "derived",
                    "totalCost": 300,
                    "intervalKm": 1000,
                    "active": True,
                    "updatedAt": T1,
                }
            ],
            "cash": [
                {
                    "id": "2026-11-04",
                    "date": "2026-11-04",
                    "opening": 50,
                    "openedAt": T1,
                    "updatedAt": T1,
                }
            ],
            "movements": [
                {
                    "id": "m1",
                    "date": "2026-11-04",
                    "type": "expense",
                    "amount": 3,
                    "updatedAt": T1,
                }
            ],
        },
    )
    snap = (await client.get(URL)).json()
    service = snap["services"][0]
    assert service["startTime"] == "22:30" and service["endTime"] == "00:15"
    assert service["distanceKm"] == 7.5 and isinstance(service["amount"], int | float)
    assert service["date"] == "2026-11-04" and service["deleted"] is False
    assert snap["days"][0]["costs"][0]["categoryId"] == "c1"
    assert snap["categories"][0]["intervalKm"] == 1000
    assert snap["cash"][0]["openedAt"].startswith("2026-11-04T10:00:00")
    assert snap["movements"][0]["type"] == "expense"


async def test_last_write_wins_ignora_mas_viejo(client: AsyncClient) -> None:
    await put(client, {"services": [svc(amount=20, updatedAt=T2)]})
    response = await put(client, {"services": [svc(amount=99, updatedAt=T1)]})
    assert response.json()["skipped"]["services"] == 1
    assert (await get_col(client, "services"))[0]["amount"] == 20


async def test_last_write_wins_aplica_mas_nuevo(client: AsyncClient) -> None:
    await put(client, {"services": [svc(amount=20, updatedAt=T1)]})
    response = await put(client, {"services": [svc(amount=30, updatedAt=T2)]})
    assert response.json()["applied"]["services"] == 1
    assert (await get_col(client, "services"))[0]["amount"] == 30


async def test_empate_gana_la_lapida(client: AsyncClient) -> None:
    await put(client, {"services": [svc(amount=20)]})
    response = await put(client, {"services": [svc(amount=20, deleted=True)]})
    assert response.json()["applied"]["services"] == 1
    assert (await get_col(client, "services"))[0]["deleted"] is True


async def test_empate_vivo_no_revive_lapida(client: AsyncClient) -> None:
    await put(client, {"services": [svc(deleted=True)]})
    response = await put(client, {"services": [svc(amount=77)]})
    assert response.json()["skipped"]["services"] == 1
    assert (await get_col(client, "services"))[0]["deleted"] is True


async def test_lapidas_se_devuelven_en_get(client: AsyncClient) -> None:
    await put(client, {"services": [svc(deleted=True)]})
    rows = await get_col(client, "services")
    assert [item["id"] for item in rows] == ["s1"] and rows[0]["deleted"] is True


async def test_idempotente(client: AsyncClient) -> None:
    body = {"services": [svc(), svc(id="s2", updatedAt=T2)]}
    await put(client, body)
    before = (await client.get(URL)).json()
    response = await put(client, body)
    assert response.status_code == 200
    assert (await client.get(URL)).json() == before


async def test_ids_duplicados_en_el_mismo_envio_gana_el_mas_nuevo(client: AsyncClient) -> None:
    response = await put(
        client, {"services": [svc(amount=1, updatedAt=T2), svc(amount=2, updatedAt=T1)]}
    )
    assert response.json()["applied"]["services"] == 1
    assert response.json()["skipped"]["services"] == 1
    assert (await get_col(client, "services"))[0]["amount"] == 1


async def test_servicio_sin_datos_de_viaje_se_acepta(client: AsyncClient) -> None:
    assert (await put(client, {"services": [svc()]})).status_code == 200
    service = (await get_col(client, "services"))[0]
    assert service.get("startTime") is None


async def test_viaje_completo_sin_origen_ni_destino_se_acepta(client: AsyncClient) -> None:
    assert (await put(client, {"services": [svc(**trip())]})).status_code == 200


async def test_viaje_incompleto_devuelve_422_en_espanol(client: AsyncClient) -> None:
    response = await put(client, {"services": [svc(startTime="10:00", endTime="10:30")]})
    assert response.status_code == 422
    error_body = response.json()
    assert error_body["code"] == "validation_error"
    assert "viaje" in str(error_body["details"]).lower()


async def test_origen_sin_datos_de_viaje_devuelve_422(client: AsyncClient) -> None:
    response = await put(client, {"services": [svc(origin="A")]})
    assert response.status_code == 422


async def test_distancia_negativa_422(client: AsyncClient) -> None:
    response = await put(client, {"services": [svc(**trip(distanceKm=-1))]})
    assert response.status_code == 422


async def test_hora_con_formato_invalido_422(client: AsyncClient) -> None:
    response = await put(client, {"services": [svc(**trip(startTime="25:00"))]})
    assert response.status_code == 422
    response = await put(client, {"services": [svc(**trip(endTime="9:5"))]})
    assert response.status_code == 422


async def test_put_guarda_bonus_y_get_lo_devuelve(client: AsyncClient) -> None:
    assert (await put(client, {"services": [svc(bonus=2.5)]})).status_code == 200
    assert (await get_col(client, "services"))[0]["bonus"] == 2.5


async def test_bonus_ausente_o_null_se_guarda_como_cero(client: AsyncClient) -> None:
    await put(client, {"services": [svc(), svc(id="s2", bonus=None)]})
    rows = await get_col(client, "services")
    assert [item["bonus"] for item in rows] == [0, 0]


async def test_bonus_se_actualiza_con_last_write_wins(client: AsyncClient) -> None:
    await put(client, {"services": [svc(bonus=1)]})
    await put(client, {"services": [svc(bonus=4, updatedAt=T2)]})
    assert (await get_col(client, "services"))[0]["bonus"] == 4


async def test_bonus_negativo_422_en_espanol(client: AsyncClient) -> None:
    response = await put(client, {"services": [svc(bonus=-1)]})
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_422_no_aplica_nada_de_otras_colecciones(client: AsyncClient) -> None:
    mov = {"id": "m1", "date": "2026-11-04", "type": "deposit", "amount": 1, "updatedAt": T1}
    response = await put(client, {"movements": [mov], "services": [svc(origin="A")]})
    assert response.status_code == 422
    assert await get_col(client, "movements") == []


async def test_dia_con_id_distinto_de_fecha_422(client: AsyncClient) -> None:
    day = {"id": "x", "date": "2026-11-04", "km": 1, "updatedAt": T1, "costs": []}
    assert (await put(client, {"days": [day]})).status_code == 422


async def test_metodo_vacio_y_codigo_desconocido_422(client: AsyncClient) -> None:
    assert (await put(client, {"services": [svc(method="")]})).status_code == 422
    response = await put(client, {"services": [svc(method="card")]})
    assert response.status_code == 422
    assert response.json()["code"] == "unknown_catalog_code"


def cash(**overrides: Any) -> dict[str, Any]:
    return {
        "id": "2026-11-04",
        "date": "2026-11-04",
        "opening": 50,
        "openedAt": T1,
        "updatedAt": T1,
        **overrides,
    }


def dep(**overrides: Any) -> dict[str, Any]:
    return {"id": "d1", "date": "2026-11-04", "amount": 10, "updatedAt": T1, **overrides}


async def test_to_deposit_ausente_se_omite_como_el_resto_de_nulos(client: AsyncClient) -> None:
    await put(client, {"cash": [cash()]})
    assert (await get_col(client, "cash"))[0].get("toDeposit") is None


async def test_to_deposit_put_y_get(client: AsyncClient) -> None:
    response = await put(client, {"cash": [cash(counted=100, toDeposit=40.5)]})
    assert response.status_code == 200
    cash_record = (await get_col(client, "cash"))[0]
    assert cash_record["toDeposit"] == 40.5 and cash_record["counted"] == 100


async def test_to_deposit_igual_a_counted_se_acepta(client: AsyncClient) -> None:
    assert (await put(client, {"cash": [cash(counted=100, toDeposit=100)]})).status_code == 200


async def test_to_deposit_sin_counted_se_acepta(client: AsyncClient) -> None:
    assert (await put(client, {"cash": [cash(toDeposit=30)]})).status_code == 200


async def test_to_deposit_mayor_que_counted_422(client: AsyncClient) -> None:
    response = await put(client, {"cash": [cash(counted=100, toDeposit=100.01)]})
    assert response.status_code == 422
    error_body = response.json()
    assert error_body["code"] == "validation_error"
    assert "Lo que va al depósito no puede superar lo contado" in str(error_body["details"])


async def test_to_deposit_negativo_422(client: AsyncClient) -> None:
    assert (await put(client, {"cash": [cash(toDeposit=-1)]})).status_code == 422


async def test_to_deposit_se_actualiza_con_lww(client: AsyncClient) -> None:
    await put(client, {"cash": [cash(toDeposit=10, updatedAt=T2)]})
    await put(client, {"cash": [cash(toDeposit=99, updatedAt=T1)]})
    assert (await get_col(client, "cash"))[0]["toDeposit"] == 10
    await put(client, {"cash": [cash(toDeposit=20, updatedAt="2026-11-04T12:00:00Z")]})
    assert (await get_col(client, "cash"))[0]["toDeposit"] == 20


async def test_deposit_movements_put_y_get(client: AsyncClient) -> None:
    response = await put(client, {"depositMovements": [dep(note="banco")]})
    assert response.json()["applied"]["depositMovements"] == 1
    deposit_record = (await get_col(client, "depositMovements"))[0]
    assert (
        deposit_record["id"] == "d1"
        and deposit_record["date"] == "2026-11-04"
        and deposit_record["amount"] == 10
    )
    assert deposit_record["note"] == "banco" and deposit_record["deleted"] is False
    assert deposit_record["updatedAt"].startswith("2026-11-04T10:00:00")


async def test_deposit_movements_lww_y_lapida(client: AsyncClient) -> None:
    await put(client, {"depositMovements": [dep(amount=20, updatedAt=T2)]})
    response = await put(client, {"depositMovements": [dep(amount=99)]})
    assert response.json()["skipped"]["depositMovements"] == 1
    assert (await get_col(client, "depositMovements"))[0]["amount"] == 20
    await put(client, {"depositMovements": [dep(amount=20, updatedAt=T2, deleted=True)]})
    assert (await get_col(client, "depositMovements"))[0]["deleted"] is True
    await put(client, {"depositMovements": [dep(amount=5, updatedAt=T2)]})
    assert (await get_col(client, "depositMovements"))[0]["deleted"] is True


async def test_deposit_movements_monto_negativo_422(client: AsyncClient) -> None:
    assert (await put(client, {"depositMovements": [dep(amount=-1)]})).status_code == 422


async def test_servicio_comision_por_defecto(client: AsyncClient) -> None:
    await put(client, {"services": [svc(), svc(id="s2", isIndrive=None, commission=None)]})
    for service in await get_col(client, "services"):
        assert service["isIndrive"] is True
        assert service["commission"] == 0 and service["commissionVat"] == 0


async def test_servicio_comision_put_y_get(client: AsyncClient) -> None:
    body = svc(isIndrive=False, commission=1.19, commissionVat=0.19)
    assert (await put(client, {"services": [body]})).status_code == 200
    service = (await get_col(client, "services"))[0]
    assert service["isIndrive"] is False
    assert service["commission"] == 1.19 and service["commissionVat"] == 0.19


async def test_servicio_comision_se_actualiza_con_lww(client: AsyncClient) -> None:
    await put(client, {"services": [svc(commission=1, updatedAt=T2)]})
    await put(client, {"services": [svc(commission=9, updatedAt=T1)]})
    assert (await get_col(client, "services"))[0]["commission"] == 1


async def test_servicio_comision_negativa_422(client: AsyncClient) -> None:
    assert (await put(client, {"services": [svc(commission=-1)]})).status_code == 422
    assert (await put(client, {"services": [svc(commissionVat=-0.1)]})).status_code == 422


def rates(**overrides: Any) -> dict[str, Any]:
    return {
        "id": "rates",
        "commissionRate": 0.1,
        "vatRate": 0.2,
        "updatedAt": T_FUTURE,
        **overrides,
    }


async def test_settings_get_trae_la_semilla(client: AsyncClient) -> None:
    row = (await get_col(client, "settings"))[0]
    assert row["id"] == "rates" and row["commissionRate"] == 0.095 and row["vatRate"] == 0.19
    assert row["deleted"] is False and "updatedAt" in row


async def test_settings_put_y_lww(client: AsyncClient) -> None:
    response = await put(client, {"settings": [rates()]})
    assert response.json()["applied"]["settings"] == 1
    row = (await get_col(client, "settings"))[0]
    assert row["commissionRate"] == 0.1 and row["vatRate"] == 0.2
    response = await put(client, {"settings": [rates(commissionRate=0.5, updatedAt=T1)]})
    assert response.json()["skipped"]["settings"] == 1
    assert (await get_col(client, "settings"))[0]["commissionRate"] == 0.1


async def test_settings_tasa_fuera_de_rango_422_en_espanol(client: AsyncClient) -> None:
    for body in (rates(commissionRate=1.5), rates(vatRate=-0.1)):
        response = await put(client, {"settings": [body]})
        assert response.status_code == 422
        assert "entre 0 y 1" in str(response.json()["details"])


def fund(**overrides: Any) -> dict[str, Any]:
    return {
        "id": "f1",
        "date": "2026-11-04",
        "categoryId": "c1",
        "type": "transfer",
        "amount": 25.5,
        "updatedAt": T1,
        **overrides,
    }


def fund_put(*funds: dict[str, Any], **extra: Any) -> dict[str, Any]:
    """PUT con movimientos de caja y la categoría `c1` a la que apuntan (FK diferida)."""
    return {"categories": [category()], "fundMovements": list(funds), **extra}


def movement(**overrides: Any) -> dict[str, Any]:
    return {
        "id": "m1",
        "date": "2026-11-04",
        "type": "expense",
        "amount": 3,
        "updatedAt": T1,
        **overrides,
    }


async def test_fund_movements_put_y_get(client: AsyncClient) -> None:
    response = await put(client, fund_put(fund(note="comida")))
    assert response.json()["applied"]["fundMovements"] == 1
    record = (await get_col(client, "fundMovements"))[0]
    assert record["id"] == "f1" and record["categoryId"] == "c1"
    assert record["type"] == "transfer" and record["amount"] == 25.5
    assert record["note"] == "comida" and record["deleted"] is False
    assert record["updatedAt"].startswith("2026-11-04T10:00:00")


async def test_fund_movements_nota_ausente_se_omite(client: AsyncClient) -> None:
    await put(client, fund_put(fund(type="spend")))
    assert (await get_col(client, "fundMovements"))[0].get("note") is None


async def test_fund_movements_lww_y_lapida(client: AsyncClient) -> None:
    await put(client, fund_put(fund(amount=20, updatedAt=T2)))
    response = await put(client, {"fundMovements": [fund(amount=99)]})
    assert response.json()["skipped"]["fundMovements"] == 1
    assert (await get_col(client, "fundMovements"))[0]["amount"] == 20
    await put(client, {"fundMovements": [fund(amount=20, updatedAt=T2, deleted=True)]})
    await put(client, {"fundMovements": [fund(amount=5, updatedAt=T2)]})
    assert (await get_col(client, "fundMovements"))[0]["deleted"] is True


async def test_fund_movements_tipo_vacio_y_desconocido_422(
    client: AsyncClient,
) -> None:
    response = await put(client, {"fundMovements": [fund(type="")]})
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    unknown = await put(client, fund_put(fund(type="gift")))
    assert unknown.status_code == 422
    assert unknown.json()["code"] == "unknown_catalog_code"


async def test_fund_movements_monto_negativo_422(client: AsyncClient) -> None:
    assert (await put(client, {"fundMovements": [fund(amount=-1)]})).status_code == 422


async def test_movimiento_categoria_put_y_get(client: AsyncClient) -> None:
    await put(client, {"movements": [movement(categoryId="comida")]})
    assert (await get_col(client, "movements"))[0]["categoryId"] == "comida"


async def test_movimiento_categoria_ausente_o_null_se_omite(client: AsyncClient) -> None:
    await put(client, {"movements": [movement(), movement(id="m2", categoryId=None)]})
    for record in await get_col(client, "movements"):
        assert "categoryId" not in record


async def test_movimiento_metodo_por_defecto_es_cash(client: AsyncClient) -> None:
    await put(client, {"movements": [movement(), movement(id="m2", method=None)]})
    assert [record["method"] for record in await get_col(client, "movements")] == ["cash", "cash"]


async def test_movimiento_metodo_transfer_y_lww(client: AsyncClient) -> None:
    await put(client, {"movements": [movement(method="transfer", updatedAt=T2)]})
    await put(client, {"movements": [movement(method="cash", updatedAt=T1)]})
    assert (await get_col(client, "movements"))[0]["method"] == "transfer"


async def test_movimiento_metodo_o_tipo_vacio_y_desconocido_422(
    client: AsyncClient,
) -> None:
    for field in ("method", "type"):
        assert (await put(client, {"movements": [movement(**{field: ""})]})).status_code == 422
    for field in ("method", "type"):
        unknown = await put(client, {"movements": [movement(**{field: "zz"})]})
        assert unknown.status_code == 422
        assert unknown.json()["details"][0]["campo"] == f"movements.{field}"


def shift(**overrides: Any) -> dict[str, Any]:
    return {"id": "sh1", "date": "2026-11-04", "startTime": "08:00", "updatedAt": T1, **overrides}


async def test_turno_se_guarda_y_se_lee_con_camel_case(client: AsyncClient) -> None:
    response = await put(client, {"shifts": [shift(endTime="14:30", note="mañana")]})
    assert response.status_code == 200
    assert response.json()["applied"]["shifts"] == 1
    [stored] = await get_col(client, "shifts")
    assert stored == {
        "id": "sh1",
        "date": "2026-11-04",
        "startTime": "08:00",
        "endTime": "14:30",
        "note": "mañana",
        "updatedAt": "2026-11-04T10:00:00Z",
        "deleted": False,
    }


async def test_turno_en_curso_no_trae_end_time(client: AsyncClient) -> None:
    await put(client, {"shifts": [shift()]})
    [stored] = await get_col(client, "shifts")
    assert "endTime" not in stored


async def test_turno_cruza_medianoche(client: AsyncClient) -> None:
    response = await put(client, {"shifts": [shift(startTime="22:00", endTime="02:00")]})
    assert response.status_code == 200


async def test_turno_lww_y_lapida(client: AsyncClient) -> None:
    await put(client, {"shifts": [shift(updatedAt=T2, startTime="09:00")]})
    old = await put(client, {"shifts": [shift(updatedAt=T1, startTime="07:00")]})
    assert old.json()["skipped"]["shifts"] == 1
    tombstone = await put(client, {"shifts": [shift(updatedAt=T_FUTURE, deleted=True)]})
    assert tombstone.json()["applied"]["shifts"] == 1
    [stored] = await get_col(client, "shifts")
    assert stored["deleted"] is True


async def test_turno_hora_invalida_devuelve_422_en_espanol(client: AsyncClient) -> None:
    for field, value in (("startTime", "8:00"), ("startTime", "24:00"), ("endTime", "12:60")):
        response = await put(client, {"shifts": [shift(**{field: value})]})
        assert response.status_code == 422
        assert "Hora inválida, usa HH:MM" in response.text


async def test_turno_guarda_template_id_opcional(client: AsyncClient) -> None:
    await put(client, {"shifts": [shift(templateId="tpl1")]})
    [stored] = await get_col(client, "shifts")
    assert stored["templateId"] == "tpl1"


def shift_template(**overrides: Any) -> dict[str, Any]:
    return {
        "id": "tpl1",
        "name": "Mañana",
        "startTime": "06:00",
        "endTime": "14:00",
        "updatedAt": T1,
        **overrides,
    }


async def test_plantilla_se_guarda_y_se_lee_con_camel_case(client: AsyncClient) -> None:
    response = await put(client, {"shiftTemplates": [shift_template(sortOrder=2)]})
    assert response.status_code == 200
    assert response.json()["applied"]["shiftTemplates"] == 1
    [stored] = await get_col(client, "shiftTemplates")
    assert stored == {
        "id": "tpl1",
        "name": "Mañana",
        "startTime": "06:00",
        "endTime": "14:00",
        "sortOrder": 2,
        "active": True,
        "updatedAt": "2026-11-04T10:00:00Z",
        "deleted": False,
    }


async def test_plantilla_valores_por_defecto(client: AsyncClient) -> None:
    await put(client, {"shiftTemplates": [shift_template()]})
    [stored] = await get_col(client, "shiftTemplates")
    assert stored["sortOrder"] == 0
    assert stored["active"] is True


async def test_plantilla_lww_y_lapida(client: AsyncClient) -> None:
    await put(client, {"shiftTemplates": [shift_template(updatedAt=T2, name="Nueva")]})
    old = await put(client, {"shiftTemplates": [shift_template(updatedAt=T1, name="Vieja")]})
    assert old.json()["skipped"]["shiftTemplates"] == 1
    tombstone = await put(
        client, {"shiftTemplates": [shift_template(updatedAt=T_FUTURE, deleted=True)]}
    )
    assert tombstone.json()["applied"]["shiftTemplates"] == 1
    [stored] = await get_col(client, "shiftTemplates")
    assert stored["deleted"] is True


async def test_plantilla_hora_invalida_devuelve_422_en_espanol(client: AsyncClient) -> None:
    for field, value in (("startTime", "8:00"), ("endTime", "12:60")):
        response = await put(client, {"shiftTemplates": [shift_template(**{field: value})]})
        assert response.status_code == 422
        assert "Hora inválida, usa HH:MM" in response.text


async def test_plantilla_nombre_vacio_devuelve_422(client: AsyncClient) -> None:
    for name in ("", "   "):
        response = await put(client, {"shiftTemplates": [shift_template(name=name)]})
        assert response.status_code == 422
        assert "El nombre es obligatorio" in response.text


def catalog_item(**overrides: Any) -> dict[str, Any]:
    return {"id": "tst-item", "name": "Prueba", "updatedAt": T1, **overrides}


CATALOGS = {
    "paymentMethods": {"affectsCash": True},
    "movementTypes": {"sign": -1},
    "fundMovementTypes": {"sign": 1},
    "expenseCategories": {},
}


async def test_catalogos_se_guardan_y_se_leen_en_camel_case(client: AsyncClient) -> None:
    for collection, extra in CATALOGS.items():
        item = catalog_item(sortOrder=7, **extra)
        response = await put(client, {collection: [item]})
        assert response.json()["applied"][collection] == 1
        stored = {rec["id"]: rec for rec in await get_col(client, collection)}["tst-item"]
        assert stored["name"] == "Prueba" and stored["sortOrder"] == 7
        assert stored["active"] is True and stored["deleted"] is False
        for key, value in extra.items():
            assert stored[key] == value


async def test_catalogos_lww_y_lapida(client: AsyncClient) -> None:
    for collection, extra in CATALOGS.items():
        await put(client, {collection: [catalog_item(name="Nueva", updatedAt=T2, **extra)]})
        old = await put(client, {collection: [catalog_item(name="Vieja", **extra)]})
        assert old.json()["skipped"][collection] == 1
        await put(client, {collection: [catalog_item(updatedAt=T_FUTURE, deleted=True, **extra)]})
        stored = {rec["id"]: rec for rec in await get_col(client, collection)}["tst-item"]
        assert stored["deleted"] is True and stored["name"] == "Prueba"


async def test_catalogos_nombre_vacio_422(client: AsyncClient) -> None:
    for collection, extra in CATALOGS.items():
        for name in ("", "   "):
            response = await put(client, {collection: [catalog_item(name=name, **extra)]})
            assert response.status_code == 422
            assert "El nombre es obligatorio" in response.text


async def test_catalogos_signo_invalido_422(client: AsyncClient) -> None:
    for collection in ("movementTypes", "fundMovementTypes"):
        for sign in (0, 2):
            response = await put(client, {collection: [catalog_item(sign=sign)]})
            assert response.status_code == 422
            assert "El signo debe ser 1 o -1" in response.text


async def test_tipo_de_movimiento_has_category_se_guarda_y_se_lee(client: AsyncClient) -> None:
    await put(client, {"movementTypes": [catalog_item(sign=-1, hasCategory=True)]})
    stored = {rec["id"]: rec for rec in await get_col(client, "movementTypes")}["tst-item"]
    assert stored["hasCategory"] is True


async def test_tipo_de_movimiento_has_category_ausente_o_nulo_es_false(client: AsyncClient) -> None:
    await put(client, {"movementTypes": [catalog_item(id="tst-sin", sign=-1)]})
    await put(client, {"movementTypes": [catalog_item(id="tst-nulo", sign=-1, hasCategory=None)]})
    stored = {rec["id"]: rec for rec in await get_col(client, "movementTypes")}
    assert stored["tst-sin"]["hasCategory"] is False
    assert stored["tst-nulo"]["hasCategory"] is False


def rate_mode(**overrides: Any) -> dict[str, Any]:
    return {"id": "fixed", "name": "Fija", "updatedAt": T1, **overrides}


def category(**overrides: Any) -> dict[str, Any]:
    return {"id": "c1", "name": "Gas", "rateMode": "direct", "updatedAt": T1, **overrides}


async def test_rate_modes_semillas_con_banderas_en_camelcase(client: AsyncClient) -> None:
    modes = {mode["id"]: mode for mode in await get_col(client, "rateModes")}
    assert modes["direct"]["usesRatePerKm"] is True
    assert modes["derived"]["usesCostInterval"] is True


async def test_rate_modes_ida_y_vuelta(client: AsyncClient) -> None:
    mode = rate_mode(usesRatePerKm=True, usesCostInterval=False, sortOrder=5)
    assert (await put(client, {"rateModes": [mode]})).json()["applied"]["rateModes"] == 1
    stored = {item["id"]: item for item in await get_col(client, "rateModes")}["fixed"]
    assert stored["usesRatePerKm"] is True
    assert stored["usesCostInterval"] is False
    assert stored["sortOrder"] == 5
    assert stored["name"] == "Fija"


async def test_rate_mode_sin_nombre_422(client: AsyncClient) -> None:
    assert (await put(client, {"rateModes": [rate_mode(name=" ")]})).status_code == 422


async def test_categoria_con_modo_creado_en_el_mismo_put_en_cualquier_orden(
    client: AsyncClient,
) -> None:
    body = {"categories": [category(rateMode="fixed")], "rateModes": [rate_mode()]}
    response = await put(client, body)
    assert response.status_code == 200
    assert (await get_col(client, "categories"))[0]["rateMode"] == "fixed"


async def test_codigo_inexistente_devuelve_422_sin_aplicar_nada(client: AsyncClient) -> None:
    body = {"categories": [category(rateMode="nope")], "services": [svc()]}
    response = await put(client, body)
    assert response.status_code == 422
    error = response.json()
    assert error["code"] == "unknown_catalog_code"
    assert error["details"] == [
        {"campo": "categories.rateMode", "mensaje": "Código de catálogo desconocido: nope"}
    ]
    assert await get_col(client, "categories") == []
    assert await get_col(client, "services") == []


async def test_servicio_con_metodo_desconocido_devuelve_422(client: AsyncClient) -> None:
    response = await put(client, {"services": [svc(method="card")]})
    assert response.status_code == 422
    assert response.json()["details"][0]["campo"] == "services.method"
