"""Plantillas y esquemas de los objetos de Gramps para la edición en la web
(docs/edicion.md, «Plantillas y esquemas»).

Genera comun/gramps/plantillas.json con:
- plantillas: cada clase de Gramps (Person, Name, Date, EventRef…) vacía,
  con todos sus campos, tal como la serializa Gramps 6
  (object_to_dict de una instancia nueva). Los formularios parten de ellas
  y la función del servidor exige que cada objeto tenga exactamente esos
  campos;
- esquemas: el JSON Schema de cada tipo de objeto principal
  (get_schema() de Gramps), contra el que valida la función.

Y lo comprueba: un objeto de cada tipo hecho con las plantillas (con
handle, ID y las referencias mínimas) se guarda en una base de datos de
Gramps, se exporta a Gramps XML, se vuelve a importar y tiene que salir
igual.

Uso (tras actualizar la biblioteca de Gramps):
    python plantillas_gramps.py
"""
import copy
import json
import os
import tempfile

import entorno  # noqa: F401
import arbol

import gramps.gen.lib as lib
from gramps.gen.lib.json_utils import object_to_dict
from gramps.version import VERSION as VERSION_GRAMPS

AQUI = os.path.dirname(os.path.abspath(__file__))
DESTINO = os.path.join(AQUI, "..", "comun", "gramps", "plantillas.json")

PRINCIPALES = ["Tag", "Note", "Repository", "Source", "Citation", "Media", "Place", "Event", "Person", "Family"]


def clases_del_esquema(esquema, salida):
    """Las clases (_class) que aparecen en un esquema, a cualquier nivel."""
    if isinstance(esquema, dict):
        clase = esquema.get("properties", {}).get("_class", {}).get("enum")
        if clase:
            salida.update(clase)
        for v in esquema.values():
            clases_del_esquema(v, salida)
    elif isinstance(esquema, list):
        for v in esquema:
            clases_del_esquema(v, salida)


def generar():
    esquemas = {t: getattr(lib, t).get_schema() for t in PRINCIPALES}
    # El esquema de Gramps 6.0.5 limita el sexo a 0-2 (mujer, hombre,
    # desconocido), pero Gramps tiene también «otro» (Person.OTHER = 3).
    sexo = esquemas["Person"]["properties"]["gender"]
    sexo["maximum"] = max(sexo["maximum"], lib.Person.OTHER)
    clases = set(PRINCIPALES)
    for e in esquemas.values():
        clases_del_esquema(e, clases)
    plantillas = {c: object_to_dict(getattr(lib, c)()) for c in sorted(clases)}
    return {"version_gramps": VERSION_GRAMPS, "plantillas": plantillas, "esquemas": esquemas}


def ejemplo(plantillas):
    """Un objeto de cada tipo principal a partir de las plantillas, con lo
    mínimo para que Gramps lo acepte: handle, ID, y una persona con nombre y
    nacimiento en una familia, con su lugar, nota, cita, fuente, depósito,
    foto y etiqueta."""
    o = {t: copy.deepcopy(plantillas[t]) for t in PRINCIPALES}
    ids = {"Note": "N9000", "Repository": "R9000", "Source": "S9000", "Citation": "C9000", "Media": "O9000",
           "Place": "P9000", "Event": "E9000", "Person": "I9000", "Family": "F9000"}
    for t in PRINCIPALES:
        o[t]["handle"] = f"plantilla{t}"
        o[t]["change"] = 1761300000
        if t in ids:
            o[t]["gramps_id"] = ids[t]
    o["Tag"]["name"] = "Plantilla"
    o["Note"]["text"]["string"] = "Nota de prueba"
    o["Note"]["tag_list"] = ["plantillaTag"]
    o["Repository"]["name"] = "Depósito"
    o["Source"]["title"] = "Fuente"
    reporef = copy.deepcopy(plantillas["RepoRef"])
    reporef["ref"] = "plantillaRepository"
    o["Source"]["reporef_list"] = [reporef]
    o["Citation"]["source_handle"] = "plantillaSource"
    o["Media"]["path"] = "foto.jpg"
    o["Media"]["mime"] = "image/jpeg"
    nombre = copy.deepcopy(plantillas["PlaceName"])
    nombre["value"] = "Lugar"
    o["Place"]["name"] = nombre
    o["Event"]["place"] = "plantillaPlace"
    o["Event"]["note_list"] = ["plantillaNote"]
    o["Event"]["citation_list"] = ["plantillaCitation"]
    p = o["Person"]
    p["primary_name"]["first_name"] = "Nombre"
    apellido = copy.deepcopy(plantillas["Surname"])
    apellido["surname"] = "Apellido"
    apellido["primary"] = True
    p["primary_name"]["surname_list"] = [apellido]
    ref = copy.deepcopy(plantillas["EventRef"])
    ref["ref"] = "plantillaEvent"
    p["event_ref_list"] = [ref]
    p["birth_ref_index"] = 0
    p["family_list"] = ["plantillaFamily"]
    foto = copy.deepcopy(plantillas["MediaRef"])
    foto["ref"] = "plantillaMedia"
    p["media_list"] = [foto]
    o["Family"]["father_handle"] = "plantillaPerson"
    return {t: [o[t]] for t in PRINCIPALES}


def comprobar(plantillas):
    objetos = ejemplo(plantillas)
    db = arbol.objetos_a_bd(objetos)
    xml = os.path.join(tempfile.mkdtemp(prefix="plantillas-"), "plantillas.gramps")
    arbol.bd_a_xml(db, xml)
    db.close()
    db = arbol.xml_a_bd(xml)
    vuelta = arbol.bd_a_objetos(db)
    db.close()
    errores = []
    for t in PRINCIPALES:
        if vuelta.get(t) != objetos[t]:
            errores.append(t)
    return errores


def main():
    datos = generar()
    os.makedirs(os.path.dirname(DESTINO), exist_ok=True)
    with open(DESTINO, "w", encoding="utf-8", newline="\n") as f:
        json.dump(datos, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    print(f"{len(datos['plantillas'])} plantillas y {len(datos['esquemas'])} esquemas: {DESTINO}")
    errores = comprobar(datos["plantillas"])
    if errores:
        raise SystemExit(f"ERROR: tras exportar e importar en Gramps no coinciden: {', '.join(errores)}")
    print("Comprobado: un objeto de cada tipo hecho con las plantillas sale igual tras Gramps XML.")


if __name__ == "__main__":
    main()
