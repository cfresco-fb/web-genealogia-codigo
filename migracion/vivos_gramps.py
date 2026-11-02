"""Calcula con la biblioteca de Gramps quién está «probablemente vivo» en
el árbol de ejemplo, para comprobar la traducción de la web
(app/src/arbol/vivos.ts) persona a persona.

Guarda en app/src/arbol/datos-prueba/vivos-ejemplo.json.gz:
- el árbol de ejemplo reducido a lo que usa el cálculo (personas, familias
  y eventos, solo con sus referencias, tipos y fechas);
- para cada caso (parámetros y fecha del cálculo), el resultado de Gramps
  para cada persona: vivo o no, y la explicación de Gramps.

Uso (tras actualizar la biblioteca de Gramps):
    python vivos_gramps.py
"""
import gzip
import io
import json
import os
import time

import entorno  # noqa: F401
import arbol

from gramps.gen.lib import Date
from gramps.gen.lib.json_utils import object_to_dict
from gramps.gen.utils.alive import probably_alive
from gramps.version import VERSION as VERSION_GRAMPS

AQUI = os.path.dirname(os.path.abspath(__file__))
EJEMPLO = os.path.join(AQUI, ".venv", "share", "doc", "gramps", "example", "gramps", "example.gramps")
DESTINO = os.path.join(AQUI, "..", "app", "src", "arbol", "datos-prueba", "vivos-ejemplo.json.gz")

# Edad máxima, años por generación, diferencia máxima entre hermanos y
# fecha del cálculo. El primero, el de la decisión del 22/10/2026; los
# demás, para comprobar que los parámetros llegan bien.
CASOS = [
    {"edadMaxima": 120, "aniosGeneracion": 20, "difHermanos": 20, "fecha": [2026, 10, 22]},
    {"edadMaxima": 110, "aniosGeneracion": 20, "difHermanos": 20, "fecha": [2026, 10, 22]},
    {"edadMaxima": 90, "aniosGeneracion": 25, "difHermanos": 10, "fecha": [1950, 6, 15]},
    {"edadMaxima": 100, "aniosGeneracion": 30, "difHermanos": 30, "fecha": [1900, 1, 1]},
]


def reducir(objetos):
    """Solo los campos que usa el cálculo."""
    def refs(lista):
        return [{"ref": r["ref"], "role": {"value": r["role"]["value"]}} for r in lista]

    personas = [{
        "handle": p["handle"], "gramps_id": p["gramps_id"],
        "event_ref_list": refs(p["event_ref_list"]),
        "birth_ref_index": p["birth_ref_index"], "death_ref_index": p["death_ref_index"],
        "family_list": p["family_list"], "parent_family_list": p["parent_family_list"],
    } for p in objetos["Person"]]
    familias = [{
        "handle": f["handle"], "father_handle": f["father_handle"], "mother_handle": f["mother_handle"],
        "child_ref_list": [{"ref": c["ref"]} for c in f["child_ref_list"]],
        "event_ref_list": refs(f["event_ref_list"]),
    } for f in objetos["Family"]]
    eventos = [{
        "handle": e["handle"], "type": {"value": e["type"]["value"]}, "date": e["date"],
    } for e in objetos["Event"]]
    return {"Person": personas, "Family": familias, "Event": eventos}


def main():
    db = arbol.xml_a_bd(EJEMPLO)
    objetos = {
        "Person": [object_to_dict(o) for o in db.iter_people()],
        "Family": [object_to_dict(o) for o in db.iter_families()],
        "Event": [object_to_dict(o) for o in db.iter_events()],
    }
    casos = []
    for caso in CASOS:
        fecha = Date(*caso["fecha"])
        resultados = {}
        for persona in db.iter_people():
            vivo, nacimiento, defuncion, explicacion, _ = probably_alive(
                persona, db, current_date=fecha,
                max_sib_age_diff=caso["difHermanos"],
                max_age_prob_alive=caso["edadMaxima"],
                avg_generation_gap=caso["aniosGeneracion"],
                return_range=True,
            )
            resultados[persona.handle] = {
                "vivo": bool(vivo),
                "explicacion": explicacion,
                "nacimiento": str(nacimiento) if nacimiento else None,
                "defuncion": str(defuncion) if defuncion else None,
            }
        vivos = sum(r["vivo"] for r in resultados.values())
        print(f"{caso}: {vivos} vivos de {len(resultados)}")
        casos.append({**caso, "resultados": resultados})

    os.makedirs(os.path.dirname(DESTINO), exist_ok=True)
    # Gramps usa la fecha de hoy en un paso del cálculo (alive.py, Today()).
    hoy = list(time.localtime()[0:3])
    datos = {"version_gramps": VERSION_GRAMPS, "hoy": hoy, "objetos": reducir(objetos), "casos": casos}
    with gzip.open(DESTINO, "wb") as f:
        f.write(json.dumps(datos, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    print(f"Guardado {os.path.normpath(DESTINO)} ({os.path.getsize(DESTINO) / 1000:.0f} kB)")


if __name__ == "__main__":
    main()
