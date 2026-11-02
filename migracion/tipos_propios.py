"""Tipos propios (personalizados) de Gramps como códigos (docs/idiomas.md,
apartado 3; decisiones de Carlos del 24 y el 31/10/2026).

Gramps guarda un tipo propio con su texto en «string» («Separación»). En la
web, los que están en el catálogo (comun/tipos-propios.json, el mismo que
usan la web y el servidor) van como código: «@» y el código
(«@separacion»), y cada uno los ve en su idioma. Los demás siguen como texto
libre.

- a_codigos(objetos): Gramps → web (exportar_json.py). Cambia los textos del
  catálogo (o sus sinónimos) por su código y devuelve los cambiados y los
  que no están en el catálogo, que siguen como texto (se avisan).
- a_textos(objetos, idioma): web → Gramps (importar_json.py). Cambia cada
  código por su texto en ese idioma.

Los textos se comparan sin mayúsculas, acentos ni espacios de más
(normalizar, igual que normalizarTipo en comun/tipos.ts). Los casos de
prueba, comunes con la web: comun/tipos-propios.casos.json
(tipos_propios_test.py).
"""
import io
import json
import os
import re
import unicodedata
from collections import Counter

AQUI = os.path.dirname(os.path.abspath(__file__))
RUTA_CATALOGO = os.path.join(AQUI, "..", "comun", "tipos-propios.json")
MARCA = "@"

with io.open(RUTA_CATALOGO, encoding="utf-8") as _f:
    CATALOGO = json.load(_f)["tipos"]


def normalizar(texto):
    sin_acentos = "".join(c for c in unicodedata.normalize("NFD", texto) if not unicodedata.category(c).startswith("M"))
    return re.sub(r"\s+", " ", sin_acentos.lower().strip())


def codigo_de(clase, texto):
    """El código («@…») de un texto de esa clase, o None si no está en el
    catálogo."""
    n = normalizar(texto)
    if not n or n.startswith(MARCA):
        return None
    for e in CATALOGO:
        if e["clase"] == clase and any(normalizar(s) == n for s in [e["codigo"], *e["textos"].values(), *e["sinonimos"]]):
            return MARCA + e["codigo"]
    return None


def texto_de(clase, codigo, idioma="es"):
    """El texto de un código en un idioma (si no lo tiene, el castellano).
    Un código que no está en el catálogo es un error."""
    for e in CATALOGO:
        if e["clase"] == clase and MARCA + e["codigo"] == codigo:
            return e["textos"].get(idioma, e["textos"]["es"])
    raise SystemExit(f"Código de tipo desconocido: {clase} «{codigo}» (no está en comun/tipos-propios.json)")


def _tipos(v):
    """Los tipos de Gramps (mapas con «_class» acabado en «Type») de una
    estructura, a cualquier profundidad."""
    if isinstance(v, list):
        for x in v:
            yield from _tipos(x)
    elif isinstance(v, dict):
        if isinstance(v.get("_class"), str) and v["_class"].endswith("Type"):
            yield v
        else:
            for x in v.values():
                yield from _tipos(x)


def a_codigos(objetos):
    """Gramps → web. Devuelve (cambiados, desconocidos): Counter de
    (clase, texto original, código) y de (clase, texto)."""
    cambiados, desconocidos = Counter(), Counter()
    for lista in objetos.values():
        for t in _tipos(lista):
            s = t.get("string")
            if not s:
                continue
            if s.startswith(MARCA):
                raise SystemExit(f"Un tipo propio de Gramps empieza por «{MARCA}» ({t['_class']} «{s}»): "
                                 "se confundiría con un código. Cámbialo en Gramps.")
            codigo = codigo_de(t["_class"], s)
            if codigo:
                t["string"] = codigo
                cambiados[(t["_class"], s, codigo)] += 1
            else:
                desconocidos[(t["_class"], s)] += 1
    return cambiados, desconocidos


def a_textos(objetos, idioma="es"):
    """Web → Gramps: cada código, por su texto en ese idioma. Devuelve
    cuántos ha cambiado."""
    n = 0
    for lista in objetos.values():
        for t in _tipos(lista):
            s = t.get("string")
            if s and s.startswith(MARCA):
                t["string"] = texto_de(t["_class"], s, idioma)
                n += 1
    return n


def imprimir(cambiados, desconocidos):
    total = sum(cambiados.values())
    print(f"\nTipos propios: {total} pasan a código (catálogo comun/tipos-propios.json)")
    for (clase, texto, codigo), n in sorted(cambiados.items()):
        print(f"  {clase} «{texto}» -> {codigo}: {n}")
    if desconocidos:
        print(f"AVISO: {len(desconocidos)} tipos propios no están en el catálogo y siguen como texto libre "
              "(revisa que deban quedarse así; si no, añádelos al catálogo):")
        for (clase, texto), n in sorted(desconocidos.items()):
            print(f"  {clase} «{texto}»: {n}")
