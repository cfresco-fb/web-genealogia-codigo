"""Cifras equivalentes al informe «Resumen de la base de datos» de Gramps,
para comparar el árbol antes y después de cada conversión."""
import os

import entorno  # noqa: F401

from gramps.gen.datehandler import get_date
from gramps.gen.lib import Person
from gramps.gen.utils.file import media_path_full


def resumen(db):
    r = {
        "personas": 0, "hombres": 0, "mujeres": 0, "otro_genero": 0,
        "genero_desconocido": 0, "nombres_incompletos": 0,
        "sin_fecha_nacimiento": 0, "sin_parientes": 0,
        "apellidos_distintos": 0, "personas_con_multimedia": 0,
    }
    apellidos = set()
    for p in db.iter_people():
        r["personas"] += 1
        nombres = [p.get_primary_name()] + p.get_alternate_names()
        if p.get_media_list():
            r["personas_con_multimedia"] += 1
        for n in nombres:
            if n.get_first_name().strip() == "":
                r["nombres_incompletos"] += 1
            elif n.get_surname_list():
                r["nombres_incompletos"] += sum(
                    1 for s in n.get_surname_list() if s.get_surname().strip() == ""
                )
            else:
                r["nombres_incompletos"] += 1
            if n.get_surname().strip():
                apellidos.add(n.get_surname().strip())
        if not p.get_main_parents_family_handle() and not p.get_family_handle_list():
            r["sin_parientes"] += 1
        ref = p.get_birth_ref()
        if not ref or not get_date(db.get_event_from_handle(ref.ref)):
            r["sin_fecha_nacimiento"] += 1
        g = p.get_gender()
        clave = {Person.FEMALE: "mujeres", Person.MALE: "hombres",
                 Person.OTHER: "otro_genero"}.get(g, "genero_desconocido")
        r[clave] += 1
    r["apellidos_distintos"] = len(apellidos)
    r["familias"] = db.get_number_of_families()
    r["eventos"] = db.get_number_of_events()
    r["lugares"] = db.get_number_of_places()
    r["fuentes"] = db.get_number_of_sources()
    r["citas"] = db.get_number_of_citations()
    r["repositorios"] = db.get_number_of_repositories()
    r["notas"] = db.get_number_of_notes()
    r["etiquetas"] = db.get_number_of_tags()
    r["multimedia"] = db.get_number_of_media()
    tam, faltan = 0, []
    for m in db.iter_media():
        ruta = media_path_full(db, m.get_path())
        if os.path.isfile(ruta):
            tam += os.path.getsize(ruta)
        else:
            faltan.append(m.get_path())
    r["multimedia_mb"] = round(tam / 1_000_000, 1)
    r["multimedia_no_encontrada"] = faltan
    return r


ETIQUETAS = {
    "personas": "Número de personas", "hombres": "Hombres", "mujeres": "Mujeres",
    "otro_genero": "Personas de otro género", "genero_desconocido": "Personas de género desconocido",
    "nombres_incompletos": "Nombres incompletos", "sin_fecha_nacimiento": "Personas sin fecha de nacimiento",
    "sin_parientes": "Personas sin parientes", "apellidos_distintos": "Apellidos distintos",
    "personas_con_multimedia": "Personas con objetos audiovisuales", "familias": "Número de familias",
    "eventos": "Número de eventos", "lugares": "Número de lugares", "fuentes": "Número de fuentes",
    "citas": "Número de citas", "repositorios": "Número de repositorios", "notas": "Número de notas",
    "etiquetas": "Número de etiquetas", "multimedia": "Objetos audiovisuales distintos",
    "multimedia_mb": "Tamaño total de los objetos audiovisuales (MB)",
}


def imprimir(r, titulo):
    print(f"\n{titulo}")
    print("-" * len(titulo))
    for k, etiqueta in ETIQUETAS.items():
        print(f"  {etiqueta}: {r[k]}")
    if r["multimedia_no_encontrada"]:
        print(f"  Ficheros multimedia no encontrados: {len(r['multimedia_no_encontrada'])}")
        for ruta in r["multimedia_no_encontrada"][:10]:
            print(f"    - {ruta}")
