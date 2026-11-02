"""Convierte el JSON de la web en un fichero Gramps XML (.gramps).

El resultado se puede importar en Gramps de escritorio en un árbol NUEVO
(nunca en el que usas a diario) para comprobar que no se ha perdido nada.

Uso:
    python importar_json.py ..\\datos\\salida\\arbol.json ..\\datos\\salida\\arbol-vuelta.gramps [--idioma es]

Los tipos propios que la web guarda como código («@separacion») vuelven a
Gramps con su texto en el idioma elegido (castellano, si no se dice otro;
tipos_propios.py).
"""
import argparse

import entorno  # noqa: F401
import arbol
import resumen
import tipos_propios


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("json", help="Fichero JSON generado por exportar_json.py")
    ap.add_argument("salida", help="Fichero .gramps de salida")
    ap.add_argument("--carpeta-multimedia", default=None,
                    help="Carpeta base de multimedia que llevará el .gramps (por defecto, la del JSON, si la trae)")
    ap.add_argument("--idioma", default="es", help="Idioma de los tipos propios guardados como código (por defecto, es)")
    args = ap.parse_args()

    doc = arbol.cargar_json(args.json)
    n = tipos_propios.a_textos(doc["objetos"], args.idioma)
    print(f"Tipos propios: {n} códigos pasan a texto ({args.idioma})")
    db = arbol.objetos_a_bd(doc["objetos"])
    arbol.fijar_persona_inicio(db, doc.get("persona_inicio"))
    # Las rutas de las fotos son relativas a la carpeta base de multimedia
    # (30/10/2026): el .gramps la lleva, y Gramps la usa al importarlo en un
    # árbol nuevo. Un JSON descargado de Firestore no la trae.
    carpeta = args.carpeta_multimedia or doc.get("base_multimedia")
    if carpeta:
        db.set_mediapath(carpeta)
    arbol.bd_a_xml(db, args.salida, comprimir=True)
    resumen.imprimir(resumen.resumen(db), f"Resumen de {args.salida}")
    print(f"\nGuardado {args.salida}")


if __name__ == "__main__":
    main()
