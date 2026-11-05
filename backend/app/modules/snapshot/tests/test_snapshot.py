from typing import Any

from httpx import AsyncClient

URL = "/api/v1/snapshot"
T1 = "2026-11-04T10:00:00Z"
T2 = "2026-11-04T11:00:00Z"


def svc(**kw: Any) -> dict[str, Any]:
    return {
        "id": "s1",
        "date": "2026-11-04",
        "amount": 12.5,
        "method": "cash",
        "updatedAt": T1,
        **kw,
    }


def trip(**kw: Any) -> dict[str, Any]:
    return {"startTime": "22:30", "endTime": "00:15", "distanceKm": 7.5, **kw}


async def put(client: AsyncClient, body: dict[str, Any]) -> Any:
    return await client.put(URL, json=body)


async def get_col(client: AsyncClient, col: str) -> list[dict[str, Any]]:
    return (await client.get(URL)).json()[col]


async def test_health(client: AsyncClient) -> None:
    r = await client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


async def test_get_devuelve_las_cinco_colecciones(client: AsyncClient) -> None:
    r = await client.get(URL)
    assert r.status_code == 200
    assert set(r.json()) == {"categories", "days", "services", "cash", "movements"}


async def test_snapshot_parcial_solo_toca_lo_enviado(client: AsyncClient) -> None:
    r = await put(client, {"services": [svc()]})
    assert r.status_code == 200
    body = r.json()
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
    s = snap["services"][0]
    assert s["startTime"] == "22:30" and s["endTime"] == "00:15"
    assert s["distanceKm"] == 7.5 and isinstance(s["amount"], int | float)
    assert s["date"] == "2026-11-04" and s["deleted"] is False
    assert snap["days"][0]["costs"][0]["categoryId"] == "c1"
    assert snap["categories"][0]["intervalKm"] == 1000
    assert snap["cash"][0]["openedAt"].startswith("2026-11-04T10:00:00")
    assert snap["movements"][0]["type"] == "expense"


async def test_last_write_wins_ignora_mas_viejo(client: AsyncClient) -> None:
    await put(client, {"services": [svc(amount=20, updatedAt=T2)]})
    r = await put(client, {"services": [svc(amount=99, updatedAt=T1)]})
    assert r.json()["skipped"]["services"] == 1
    assert (await get_col(client, "services"))[0]["amount"] == 20


async def test_last_write_wins_aplica_mas_nuevo(client: AsyncClient) -> None:
    await put(client, {"services": [svc(amount=20, updatedAt=T1)]})
    r = await put(client, {"services": [svc(amount=30, updatedAt=T2)]})
    assert r.json()["applied"]["services"] == 1
    assert (await get_col(client, "services"))[0]["amount"] == 30


async def test_empate_gana_la_lapida(client: AsyncClient) -> None:
    await put(client, {"services": [svc(amount=20)]})
    r = await put(client, {"services": [svc(amount=20, deleted=True)]})
    assert r.json()["applied"]["services"] == 1
    assert (await get_col(client, "services"))[0]["deleted"] is True


async def test_empate_vivo_no_revive_lapida(client: AsyncClient) -> None:
    await put(client, {"services": [svc(deleted=True)]})
    r = await put(client, {"services": [svc(amount=77)]})
    assert r.json()["skipped"]["services"] == 1
    assert (await get_col(client, "services"))[0]["deleted"] is True


async def test_lapidas_se_devuelven_en_get(client: AsyncClient) -> None:
    await put(client, {"services": [svc(deleted=True)]})
    rows = await get_col(client, "services")
    assert [x["id"] for x in rows] == ["s1"] and rows[0]["deleted"] is True


async def test_idempotente(client: AsyncClient) -> None:
    body = {"services": [svc(), svc(id="s2", updatedAt=T2)]}
    await put(client, body)
    before = (await client.get(URL)).json()
    r = await put(client, body)
    assert r.status_code == 200
    assert (await client.get(URL)).json() == before


async def test_ids_duplicados_en_el_mismo_envio_gana_el_mas_nuevo(client: AsyncClient) -> None:
    r = await put(client, {"services": [svc(amount=1, updatedAt=T2), svc(amount=2, updatedAt=T1)]})
    assert r.json()["applied"]["services"] == 1
    assert r.json()["skipped"]["services"] == 1
    assert (await get_col(client, "services"))[0]["amount"] == 1


async def test_servicio_sin_datos_de_viaje_se_acepta(client: AsyncClient) -> None:
    assert (await put(client, {"services": [svc()]})).status_code == 200
    s = (await get_col(client, "services"))[0]
    assert s.get("startTime") is None


async def test_viaje_completo_sin_origen_ni_destino_se_acepta(client: AsyncClient) -> None:
    assert (await put(client, {"services": [svc(**trip())]})).status_code == 200


async def test_viaje_incompleto_devuelve_422_en_espanol(client: AsyncClient) -> None:
    r = await put(client, {"services": [svc(startTime="10:00", endTime="10:30")]})
    assert r.status_code == 422
    err = r.json()
    assert err["code"] == "validation_error"
    assert "viaje" in str(err["details"]).lower()


async def test_origen_sin_datos_de_viaje_devuelve_422(client: AsyncClient) -> None:
    r = await put(client, {"services": [svc(origin="A")]})
    assert r.status_code == 422


async def test_distancia_negativa_422(client: AsyncClient) -> None:
    r = await put(client, {"services": [svc(**trip(distanceKm=-1))]})
    assert r.status_code == 422


async def test_hora_con_formato_invalido_422(client: AsyncClient) -> None:
    r = await put(client, {"services": [svc(**trip(startTime="25:00"))]})
    assert r.status_code == 422
    r = await put(client, {"services": [svc(**trip(endTime="9:5"))]})
    assert r.status_code == 422


async def test_put_guarda_bonus_y_get_lo_devuelve(client: AsyncClient) -> None:
    assert (await put(client, {"services": [svc(bonus=2.5)]})).status_code == 200
    assert (await get_col(client, "services"))[0]["bonus"] == 2.5


async def test_bonus_ausente_o_null_se_guarda_como_cero(client: AsyncClient) -> None:
    await put(client, {"services": [svc(), svc(id="s2", bonus=None)]})
    rows = await get_col(client, "services")
    assert [x["bonus"] for x in rows] == [0, 0]


async def test_bonus_se_actualiza_con_last_write_wins(client: AsyncClient) -> None:
    await put(client, {"services": [svc(bonus=1)]})
    await put(client, {"services": [svc(bonus=4, updatedAt=T2)]})
    assert (await get_col(client, "services"))[0]["bonus"] == 4


async def test_bonus_negativo_422_en_espanol(client: AsyncClient) -> None:
    r = await put(client, {"services": [svc(bonus=-1)]})
    assert r.status_code == 422
    assert r.json()["code"] == "validation_error"


async def test_422_no_aplica_nada_de_otras_colecciones(client: AsyncClient) -> None:
    mov = {"id": "m1", "date": "2026-11-04", "type": "deposit", "amount": 1, "updatedAt": T1}
    r = await put(client, {"movements": [mov], "services": [svc(origin="A")]})
    assert r.status_code == 422
    assert await get_col(client, "movements") == []


async def test_dia_con_id_distinto_de_fecha_422(client: AsyncClient) -> None:
    day = {"id": "x", "date": "2026-11-04", "km": 1, "updatedAt": T1, "costs": []}
    assert (await put(client, {"days": [day]})).status_code == 422


async def test_enum_invalido_422(client: AsyncClient) -> None:
    r = await put(client, {"services": [svc(method="card")]})
    assert r.status_code == 422
