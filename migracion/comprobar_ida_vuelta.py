"""Prueba de fidelidad de la migración (fase 0).

Hace la ida y vuelta completa sin intervención:
    Gramps (.gramps/.gpkg) -> JSON -> Gramps XML -> JSON
y compara objeto a objeto el primer JSON con el último. También compara
el resumen (las cifras del informe «Resumen de la base de datos») de
ambos extremos. Termina con código 0 si todo coincide y 1 si no.

El JSON es el de exportar_json.py: con las rutas de las fotos relativas a la
carpeta base de multimedia de Gramps y sin rutas en las descripciones
(arbol.relativizar_multimedia, 30/10/2026). Esas son las únicas diferencias
con el árbol original que se admiten, y se cuentan; además, el XML de vuelta
lleva esa carpeta base, y cada foto se sigue encontrando en el mismo fichero.

Los tipos propios del catálogo van como código en el JSON y vuelven a Gramps
con el texto del catálogo en castellano (tipos_propios.py, 31/10/2026). La
comparación se hace con los códigos: el árbol de vuelta, convertido otra vez
a códigos, debe ser idéntico al JSON. Así, un sinónimo («Deported») que
vuelve con el texto del catálogo («Deportación») no cuenta como pérdida;
cualquier otra diferencia, sí.

También (31/10/2026; arbol.a_la_web, lo mismo que exportar_json.py): el JSON
va sin los atributos «RIN» y «_UID» (se cuentan; el XML de vuelta tampoco los
lleva) y con el checksum de las fotos que no lo tenían, que debe ser el que
calcula Gramps con el fichero (gramps.gen.utils.file.create_checksum). Así la
ida y vuelta sale exacta.

Uso:
    python comprobar_ida_vuelta.py ..\\datos\\entrada\\arbol.gpkg
"""
import argparse
import copy
import json
import os
import sys

import entorno  # noqa: F401
import arbol
from gramps.gen.utils.file import create_checksum
import resumen
import tipos_propios


def indexar(lista):
    # Se incluye «change» (fecha de última modificación): debe conservarse.
    return {d["handle"]: d for d in lista}


def diferencias(a, b, ruta=""):
    """Primeras rutas de campo en que difieren dos estructuras JSON."""
    if type(a) is not type(b):
        return [ruta or "/"]
    if isinstance(a, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            out += diferencias(a.get(k), b.get(k), f"{ruta}/{k}")
        return out
    if isinstance(a, list):
        if len(a) != len(b):
            return [f"{ruta} (longitud {len(a)} ≠ {len(b)})"]
        out = []
        for i, (x, y) in enumerate(zip(a, b)):
            out += diferencias(x, y, f"{ruta}[{i}]")
        return out
    return [] if a == b else [ruta or "/"]


def comprobar_multimedia(gramps, base, web, base_vuelta):
    ok = True
    if any(arbol.es_ruta(m.get("path", "")) and (m["path"][1:2] == ":" or m["path"][:1] in "/\\")
           for m in web.get("Media", [])):
        ok = False
        print("  Quedan rutas absolutas en las fotos")
    original = {m["handle"]: m for m in gramps.get("Media", [])}
    mismos = calculados = 0
    for m in web.get("Media", []):
        o = original[m["handle"]]
        # El checksum puede cambiar solo si estaba vacío (lo calcula la
        # migración, 31/10/2026).
        sin = {"path": "", "desc": "", **({"checksum": ""} if not o.get("checksum") else {})}
        otros = [d for d in diferencias({**o, **sin}, {**m, **sin})]
        if otros:
            ok = False
            print(f"  {m['gramps_id']}: cambia algo más que la ruta, la descripción y el checksum vacío: {', '.join(otros[:5])}")
        # El checksum, el mismo que calcula Gramps con el fichero.
        ruta = arbol.ruta_local(m, base_vuelta or "")
        if ruta and m.get("checksum") != create_checksum(ruta):
            ok = False
            print(f"  {m['gramps_id']}: el checksum no es el que calcula Gramps con el fichero")
        elif ruta and not o.get("checksum"):
            calculados += 1
        if m.get("desc") != o.get("desc") and not arbol.es_ruta(o.get("desc", "")):
            ok = False
            print(f"  {m['gramps_id']}: ha cambiado una descripción que no era una ruta")
        if "://" in o["path"]:
            continue
        antes = os.path.normcase(os.path.normpath(os.path.join(base, o["path"])))
        despues = os.path.normcase(os.path.normpath(os.path.join(base_vuelta or "", m["path"])))
        if antes != despues or not os.path.exists(despues):
            ok = False
            print(f"  {m['gramps_id']}: la ruta de vuelta no lleva al mismo fichero")
        else:
            mismos += 1
    print(f"  Fotos: {mismos} se encuentran en el mismo fichero con la carpeta base del XML de vuelta; "
          f"{calculados} checksum calculados en la migración, iguales a los de Gramps (create_checksum)")
    return ok


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("origen", help="Fichero .gramps o .gpkg exportado desde Gramps")
    ap.add_argument("--trabajo", default=None, help="Carpeta para ficheros intermedios")
    ap.add_argument("--carpeta-multimedia", default=None, help="Carpeta base de multimedia de Gramps (como en exportar_json.py)")
    args = ap.parse_args()

    trabajo = args.trabajo or os.path.join(os.path.dirname(os.path.abspath(args.origen)), "..", "salida", "trabajo")
    trabajo = os.path.abspath(trabajo)
    os.makedirs(trabajo, exist_ok=True)

    print("1/4 Leyendo el árbol original…")
    xml, base = arbol.preparar_origen(args.origen, trabajo)
    db1 = arbol.xml_a_bd(xml, base)
    r1 = resumen.resumen(db1)
    gramps = json.loads(json.dumps(arbol.bd_a_objetos(db1)))
    obj1 = copy.deepcopy(gramps)
    # Los mismos cambios que exportar_json.py.
    local = arbol.a_la_web(obj1, base, args.carpeta_multimedia)

    print("2/4 JSON -> base de datos -> Gramps XML…")
    textos = copy.deepcopy(obj1)
    tipos_propios.a_textos(textos)
    db2 = arbol.objetos_a_bd(textos)
    arbol.fijar_persona_inicio(db2, arbol.persona_inicio(db1))
    db2.set_mediapath(local)
    vuelta = os.path.join(trabajo, "ida-vuelta.gramps")
    arbol.bd_a_xml(db2, vuelta)

    print("3/4 Releyendo el XML generado (con su propia carpeta base)…")
    db3 = arbol.xml_a_bd(vuelta)
    r3 = resumen.resumen(db3)
    obj3 = arbol.bd_a_objetos(db3)
    # De vuelta a códigos, para compararlo con el JSON (a_codigos se para si
    # algún código ha llegado a Gramps sin convertir).
    tipos_propios.a_codigos(obj3)

    print("4/4 Comparando…")
    ok = True
    print(f"\n{'Tipo':<12}{'Original':>10}{'Vuelta':>10}{'Distintos':>11}")
    for tipo, _, _ in arbol.TIPOS:
        a, b = indexar(obj1[tipo]), indexar(obj3[tipo])
        distintos = [h for h in a if a[h] != b.get(h)] + [h for h in b if h not in a]
        print(f"{tipo:<12}{len(a):>10}{len(b):>10}{len(distintos):>11}")
        for h in distintos[:3]:
            ok = False
            print(f"    {tipo} {a.get(h, b.get(h, {})).get('gramps_id', h)}: "
                  f"{', '.join(diferencias(a.get(h), b.get(h))[:5])}")
        if distintos:
            ok = False

    # Las fotos: solo cambian la ruta y la descripción, y la ruta, resuelta
    # con la carpeta base del XML de vuelta, es el mismo fichero.
    ok = comprobar_multimedia(gramps, base, obj1, db3.get_mediapath()) and ok

    print()
    if arbol.persona_inicio(db1) != arbol.persona_inicio(db3):
        ok = False
        print(f"  DIFERENCIA en la persona de inicio: {arbol.persona_inicio(db1)} ≠ {arbol.persona_inicio(db3)}")
    for k, etiqueta in resumen.ETIQUETAS.items():
        if r1[k] != r3[k]:
            ok = False
            print(f"  DIFERENCIA en «{etiqueta}»: {r1[k]} ≠ {r3[k]}")
    resumen.imprimir(r1, "Resumen del árbol original (compáralo con el informe de Gramps)")
    print("\nRESULTADO:", "ida y vuelta SIN pérdidas" if ok else "HAY DIFERENCIAS (ver arriba)")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
