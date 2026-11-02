"""Rama editable y referencias calculadas con la biblioteca de Gramps sobre
el árbol de ejemplo, para comprobar la traducción de la web y del servidor
(comun/rama.ts, comun/referencias.ts) persona a persona.

Guarda en comun/datos-prueba/rama-ejemplo.json.gz:
- el árbol de ejemplo reducido a las relaciones (personas con sus
  familias; familias con padre, madre e hijos y su filiación);
- para varias personas, su rama según la regla decidida
  (docs/decisiones-web-familiar.md, «Permisos de edición» y DA-3 a DA-5):
  - descendientes con el filtro de Gramps IsDescendantOf;
  - padres y abuelos (de la persona y de cada cónyuge) por todas sus
    familias de padres (DA-3 a), con la API de Gramps; el filtro de Gramps
    IsLessThanNthGenerationAncestorOf solo sigue la primera familia de
    padres, y se cuenta en cuántos casos da otra cosa;
  - cónyuges: el otro miembro de cada familia propia (DA-4 a);
  - hermanos (ampliación de la rama del 24/10/2026): quien comparte un
    padre o una madre por cualquier filiación, y los hijos del cónyuge de
    un padre con otra pareja (respuesta del 25/10/2026), con la API de
    Gramps; cada uno se clasifica con get_sibling_type (hermano, medio
    hermano, hermanastro, desconocido) y se cuentan los de cada clase;
  - hijastros (respuestas del 25/10/2026): hijos de un cónyuge con otra
    pareja, de la persona y de cualquier raíz o descendiente de una raíz,
    cada uno con su rama, y se cuentan;
  - familias: con el padre o la madre en la rama (DA-5 b);
- una muestra de objetos de cada tipo, completos, con
  get_referenced_handles_recursively() de Gramps.

Nunca con datos reales: solo el árbol de ejemplo oficial de Gramps.

Uso:
    python rama_gramps.py
"""
import gzip
import json
import os
import random

import entorno  # noqa: F401
import arbol

from gramps.gen.filters import GenericFilter
from gramps.gen.filters.rules.person import IsDescendantOf, IsLessThanNthGenerationAncestorOf
from gramps.gen.lib.json_utils import object_to_dict
from gramps.gen.relationship import RelationshipCalculator
from gramps.version import VERSION as VERSION_GRAMPS

AQUI = os.path.dirname(os.path.abspath(__file__))
EJEMPLO = os.path.join(AQUI, ".venv", "share", "doc", "gramps", "example", "gramps", "example.gramps")
DESTINO = os.path.join(AQUI, "..", "comun", "datos-prueba", "rama-ejemplo.json.gz")

# Personas con ramas de todo tipo (las de los recorridos de la fase 2 y
# otras al azar, con semilla fija).
FIJAS = ["I0044", "I0027", "I1248", "I1509", "I1078", "I0063", "I0001", "I0104"]
AL_AZAR = 22
MUESTRA_POR_TIPO = 40


CALCULADORA = RelationshipCalculator()
CLASES = {
    RelationshipCalculator.NORM_SIB: "hermanos", RelationshipCalculator.HALF_SIB_MOTHER: "medios por la madre",
    RelationshipCalculator.HALF_SIB_FATHER: "medios por el padre", RelationshipCalculator.STEP_SIB: "hermanastros",
    RelationshipCalculator.UNKNOWN_SIB: "sin clasificar",
}


def filtrar(db, regla):
    f = GenericFilter()
    f.add_rule(regla)
    return set(f.apply(db, db.iter_person_handles()))


def padres(db, handle):
    p = db.get_person_from_handle(handle)
    salida = []
    for fh in p.get_parent_family_handle_list():
        fam = db.get_family_from_handle(fh)
        for x in (fam.get_father_handle(), fam.get_mother_handle()):
            if x:
                salida.append(x)
    return salida


def ascendientes(db, handle, n=2):
    """Padres y abuelos por todas las familias de padres (sin la persona)."""
    salida, nivel = set(), [handle]
    for _ in range(n):
        siguiente = []
        for x in nivel:
            for p in padres(db, x):
                if p not in salida and p != handle:
                    salida.add(p)
                    siguiente.append(p)
        nivel = siguiente
    return salida


def conyuges(db, handle):
    p = db.get_person_from_handle(handle)
    salida = []
    for fh in p.get_family_handle_list():
        fam = db.get_family_from_handle(fh)
        padre, madre = fam.get_father_handle(), fam.get_mother_handle()
        otro = madre if padre == handle else padre if madre == handle else None
        if otro:
            salida.append(otro)
    return salida


def hijos_de(db, quienes):
    """Hijos de todas las familias propias de esas personas."""
    salida = set()
    for q in quienes:
        for fh in db.get_person_from_handle(q).get_family_handle_list():
            salida |= {c.ref for c in db.get_family_from_handle(fh).get_child_ref_list()}
    return salida


def hermanos(db, handle):
    """Quienes comparten con la persona un padre o una madre, y los hijos
    del cónyuge de un padre con otra pareja (sin ella)."""
    p = db.get_person_from_handle(handle)
    salida = set()
    for fh in p.get_parent_family_handle_list():
        salida |= {c.ref for c in db.get_family_from_handle(fh).get_child_ref_list()}
    for x in padres(db, handle):
        salida |= hijos_de(db, [x, *conyuges(db, x)])
    salida.discard(handle)
    return salida


def hijastros(db, handle):
    """Hijos de los cónyuges de la persona (con ella o con otra pareja)."""
    return hijos_de(db, conyuges(db, handle)) - {handle}


def rama_propia(db, h):
    """La rama de una raíz, y los hijastros de ella y de sus descendientes
    (raíces nuevas; respuesta del 25/10/2026)."""
    gid = db.get_person_from_handle(h).get_gramps_id()
    desc = filtrar(db, IsDescendantOf([gid, "0"]))
    personas = {h} | ascendientes(db, h) | desc
    for x in [h, *desc]:
        for c in conyuges(db, x):
            personas.add(c)
            personas |= ascendientes(db, c)
    nuevos = set()
    for x in [h, *desc]:
        nuevos |= hijastros(db, x)
    return personas, nuevos - desc - {h}


def rama(db, persona, clases):
    gid = persona.get_gramps_id()
    h = persona.handle
    raices = {h}
    for x in [h, *conyuges(db, h)]:
        px = db.get_person_from_handle(x)
        for o in hermanos(db, x):
            raices.add(o)
            clases[CALCULADORA.get_sibling_type(db, px, db.get_person_from_handle(o))] += 1
    personas, pendientes = set(), list(raices)
    while pendientes:
        suyas, nuevos = rama_propia(db, pendientes.pop())
        personas |= suyas
        for n in nuevos - raices:
            raices.add(n)
            pendientes.append(n)
            clases["hijastros"] += 1
    familias = {
        fh for fh in db.iter_family_handles()
        if (f := db.get_family_from_handle(fh)).get_father_handle() in personas
        or f.get_mother_handle() in personas
    }
    # Diferencia con el filtro de Gramps (solo la primera familia de padres).
    gramps = filtrar(db, IsLessThanNthGenerationAncestorOf([gid, "3"])) - {h}
    distinta = gramps != ascendientes(db, h)
    return personas, familias, distinta


def main():
    db = arbol.xml_a_bd(EJEMPLO)
    try:
        personas = sorted(db.iter_people(), key=lambda p: p.handle)
        familias = sorted(db.iter_families(), key=lambda f: f.handle)
        rnd = random.Random(20261024)
        ids = FIJAS + [p.get_gramps_id() for p in rnd.sample(personas, AL_AZAR)]
        casos, distintas, clases = [], 0, {k: 0 for k in [*CLASES, "hijastros"]}
        for gid in ids:
            p = db.get_person_from_gramps_id(gid)
            r_personas, r_familias, distinta = rama(db, p, clases)
            distintas += distinta
            casos.append({"persona": p.handle, "id": gid, "personas": sorted(r_personas), "familias": sorted(r_familias)})

        reducido = {
            "Person": [{
                "handle": p.handle, "_class": "Person",
                "parent_family_list": p.get_parent_family_handle_list(),
                "family_list": p.get_family_handle_list(),
            } for p in personas],
            "Family": [{
                "handle": f.handle, "_class": "Family",
                "father_handle": f.get_father_handle(), "mother_handle": f.get_mother_handle(),
                "child_ref_list": [{
                    "ref": c.ref, "frel": {"value": int(c.get_father_relation())},
                    "mrel": {"value": int(c.get_mother_relation())},
                } for c in f.get_child_ref_list()],
            } for f in familias],
        }

        referencias = []
        metodos = {
            "Person": db.iter_people, "Family": db.iter_families, "Event": db.iter_events,
            "Place": db.iter_places, "Source": db.iter_sources, "Citation": db.iter_citations,
            "Repository": db.iter_repositories, "Media": db.iter_media, "Note": db.iter_notes,
            "Tag": db.iter_tags,
        }
        for tipo, it in metodos.items():
            objetos = sorted(it(), key=lambda o: o.handle)
            for o in rnd.sample(objetos, min(MUESTRA_POR_TIPO, len(objetos))):
                refs = []
                for clase, handle in o.get_referenced_handles_recursively():
                    if [clase, handle] not in refs:
                        refs.append([clase, handle])
                referencias.append({"tipo": tipo, "objeto": object_to_dict(o), "referencias": refs})

        salida = {
            "version_gramps": VERSION_GRAMPS,
            "objetos": reducido,
            "casos": casos,
            "referencias": referencias,
        }
        os.makedirs(os.path.dirname(DESTINO), exist_ok=True)
        with gzip.open(DESTINO, "wt", encoding="utf-8") as f:
            json.dump(salida, f, ensure_ascii=False, separators=(",", ":"))
        varias = sum(1 for p in personas if len(p.get_parent_family_handle_list()) > 1)
        print(f"{len(casos)} ramas, {len(referencias)} objetos con referencias: {DESTINO}")
        print(f"Personas con más de una familia de padres: {varias}; "
              f"ramas en las que el filtro de Gramps (solo la primera) daría otros ascendientes: {distintas}")
        print("Hermanos de las personas de la muestra y de sus cónyuges, según Gramps: "
              + ", ".join(f"{CLASES.get(k, k)} {n}" for k, n in clases.items()))
    finally:
        db.close()


if __name__ == "__main__":
    main()
