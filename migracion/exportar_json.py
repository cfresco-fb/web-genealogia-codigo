"""Convierte una exportación de Gramps (.gramps o .gpkg) al JSON de la web.

Uso:
    python exportar_json.py ..\\datos\\entrada\\arbol.gpkg ..\\datos\\salida\\arbol.json [--carpeta-multimedia CARPETA]

Las rutas de las fotos quedan relativas a la carpeta base de multimedia de
Gramps («Fotos/50003.jpg»), sin rutas del PC, y las descripciones que son una
ruta se quedan con el nombre del fichero (arbol.relativizar_multimedia;
decisión del 30/10/2026). Sin --carpeta-multimedia, la carpeta base es la que
tienen en común todas las fotos menos su última carpeta.

Los tipos propios del catálogo (comun/tipos-propios.json) pasan a código
(«Separación» → «@separacion»; tipos_propios.py, decisión del 31/10/2026);
los que no están en él siguen como texto libre y se avisan.

Además (31/10/2026): quita los atributos «RIN» y «_UID» que dejó una
importación de GEDCOM, y calcula el checksum (MD5) de las fotos que no lo
tienen, como Gramps al importar (arbol.a_la_web).
"""
import argparse
import os

import entorno  # noqa: F401
import arbol
import resumen


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("origen", help="Fichero .gramps o .gpkg exportado desde Gramps")
    ap.add_argument("salida", help="Fichero JSON de salida")
    ap.add_argument("--carpeta-multimedia", default=None,
                    help="Carpeta base de multimedia de Gramps (Preferencias), de la que cuelgan las rutas de las fotos")
    args = ap.parse_args()

    trabajo = os.path.join(os.path.dirname(os.path.abspath(args.salida)), "trabajo")
    os.makedirs(trabajo, exist_ok=True)
    xml, base = arbol.preparar_origen(args.origen, trabajo)
    db = arbol.xml_a_bd(xml, base)
    r = resumen.resumen(db)
    resumen.imprimir(r, f"Resumen de {os.path.basename(args.origen)}")
    objetos = arbol.bd_a_objetos(db)
    local = arbol.a_la_web(objetos, base, args.carpeta_multimedia)
    arbol.guardar_json(objetos, args.salida, args.origen, local, arbol.persona_inicio(db))
    print(f"\nGuardado {args.salida} ({os.path.getsize(args.salida) / 1_000_000:.1f} MB)")


if __name__ == "__main__":
    main()
