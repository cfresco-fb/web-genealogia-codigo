"""Fechas del árbol de ejemplo con su texto en Gramps, para comprobar el
lector de fechas de los formularios (app/src/arbol/leerFecha.ts) contra
Gramps: cada fecha, tal como la guarda Gramps (con su sortval), y cómo la
escribe Gramps en castellano con los formatos «Día Mes Año» (el de Gramps
de escritorio, «29 agosto 1987») y numérico («29/8/1987»).

Además, unas fechas hechas a mano con Date.set() de Gramps (intervalos,
periodos, calidades, calendarios, año nuevo) para tener todos los casos,
aunque el árbol de ejemplo no los traiga.

Guarda app/src/arbol/datos-prueba/fechas-ejemplo.json.gz. Nunca con datos
reales: solo el árbol de ejemplo oficial de Gramps.

Uso:
    python fechas_gramps.py
"""
import gzip
import json
import os

import entorno  # noqa: F401
import arbol

from gramps.gen.datehandler._date_es import DateDisplayES
from gramps.gen.lib import Date
from gramps.gen.lib.json_utils import object_to_dict
from gramps.gen.utils.grampslocale import GrampsLocale

AQUI = os.path.dirname(os.path.abspath(__file__))
EJEMPLO = os.path.join(AQUI, ".venv", "share", "doc", "gramps", "example", "gramps", "example.gramps")
DESTINO = os.path.join(AQUI, "..", "app", "src", "arbol", "datos-prueba", "fechas-ejemplo.json.gz")

# Formatos de DateDisplayES.formats: 1 «Numérica», 4 «Día Mes, Año».
FORMATOS = {"numerico": 1, "diaMesAnio": 4}


def a_mano():
    """Fechas con todos los modificadores, calidades y calendarios."""
    casos = []

    def nueva(**kw):
        d = Date()
        d.set(**kw)
        casos.append(d)

    q, m = Date.QUAL_NONE, Date.MOD_NONE
    for mod in (Date.MOD_NONE, Date.MOD_BEFORE, Date.MOD_AFTER, Date.MOD_ABOUT, Date.MOD_FROM, Date.MOD_TO):
        for valor in ((3, 5, 1950, False), (0, 5, 1950, False), (0, 0, 1950, False)):
            nueva(quality=q, modifier=mod, value=valor)
    for mod in (Date.MOD_RANGE, Date.MOD_SPAN):
        nueva(quality=q, modifier=mod, value=(0, 0, 1746, False, 0, 0, 1755, False))
        nueva(quality=q, modifier=mod, value=(3, 5, 1950, False, 5, 6, 1951, False))
        nueva(quality=Date.QUAL_ESTIMATED, modifier=mod, value=(1, 1, 1900, False, 0, 3, 1901, False))
    for qual in (Date.QUAL_ESTIMATED, Date.QUAL_CALCULATED):
        nueva(quality=qual, modifier=m, value=(0, 0, 1850, False))
        nueva(quality=qual, modifier=Date.MOD_ABOUT, value=(2, 2, 1800, False))
    for cal in (Date.CAL_JULIAN, Date.CAL_HEBREW, Date.CAL_FRENCH, Date.CAL_PERSIAN, Date.CAL_ISLAMIC, Date.CAL_SWEDISH):
        nueva(quality=q, modifier=m, calendar=cal, value=(10, 4, 1700 if cal in (Date.CAL_JULIAN, Date.CAL_SWEDISH) else 12, False))
    nueva(quality=q, modifier=m, calendar=Date.CAL_JULIAN, value=(11, 2, 1750, True), newyear=Date.NEWYEAR_MAR25)
    nueva(quality=q, modifier=m, value=(0, 0, 1700, True))
    nueva(quality=q, modifier=m, value=(1, 1, -50, False))
    return casos


def main():
    es = GrampsLocale(lang="es_ES")
    pantallas = {k: DateDisplayES(format=v, blocale=es) for k, v in FORMATOS.items()}
    db = arbol.xml_a_bd(EJEMPLO)
    try:
        vistas, fechas = set(), []
        fuentes = [("ejemplo", e.get_date_object()) for e in db.iter_events()]
        fuentes += [("a mano", d) for d in a_mano()]
        for origen, d in fuentes:
            dic = object_to_dict(d)
            clave = json.dumps(dic, sort_keys=True)
            if clave in vistas:
                continue
            vistas.add(clave)
            fechas.append({
                "origen": origen,
                "fecha": dic,
                "gramps": {k: p.display(d) for k, p in pantallas.items()},
            })
        os.makedirs(os.path.dirname(DESTINO), exist_ok=True)
        with gzip.open(DESTINO, "wt", encoding="utf-8") as f:
            json.dump({"fechas": fechas}, f, ensure_ascii=False, separators=(",", ":"))
        print(f"{len(fechas)} fechas distintas ({sum(1 for x in fechas if x['origen'] == 'a mano')} hechas a mano): {DESTINO}")
        for x in fechas[:3] + fechas[-6:]:
            print(" ", x["gramps"], x["fecha"]["dateval"])
    finally:
        db.close()


if __name__ == "__main__":
    main()
