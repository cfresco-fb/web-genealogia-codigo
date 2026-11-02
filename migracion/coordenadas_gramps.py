"""Convierte con la biblioteca de Gramps (conv_lat_lon) una lista de
coordenadas escritas de muchas formas, para comprobar que la web las lee
igual (app/src/arbol/mapa.ts, prueba en mapa.test.ts).

Los casos son los de la prueba de gramps/gen/utils/place.py y algunos más.
Guarda en app/src/arbol/datos-prueba/coordenadas-gramps.json, para cada
caso, la latitud y la longitud de Gramps con 8 decimales («D.D8»), o null
si Gramps no las puede convertir.

Uso (tras actualizar la biblioteca de Gramps):
    python coordenadas_gramps.py
"""
import json
import os

import entorno  # noqa: F401

from gramps.gen.utils.place import conv_lat_lon
from gramps.version import VERSION as VERSION_GRAMPS

AQUI = os.path.dirname(os.path.abspath(__file__))
DESTINO = os.path.join(AQUI, "..", "app", "src", "arbol", "datos-prueba", "coordenadas-gramps.json")

CASOS = [
    # De la prueba de Gramps.
    ("50.849888888888", "2.885897222222"),
    (" 50°50'59.60\"N", "  2°53'9.23\"E"),
    (" 50 : 50 : 59.60 ", " -2:53 : 9.23   "),
    (" dummy", "  2#53 ' 9.23  \"  E "),
    (" 50:50: 59.60", "  d u m my"),
    (" 50°59.60\"N", "  2°53'E"),
    (" 11° 11' 11\" N, 11° 11' 11\" O", " "),
    ("-0.00006", "-0.00006"),
    (" 50°59.60\"", "  2°53'E"),
    (" 50°59.60\"E", "  2°53'N"),
    (" 50°59.99\"E", "  2°59'59.99\"N"),
    (" 50°59.99\"S", "  2°59'59.99\"E"),
    ("N50.849888888888", "E2.885897222222"),
    ("90.849888888888", "2.885897222222"),
    ("90", "-180"),
    ("90° 00' 00.00\" S ", "179° 59'59.99\"W"),
    ("90° 00' 00.00\" N", "180° 00'00.00\" E"),
    ("90: 00: 00.00 ", "-179: 59:59.99"),
    ("90° 00' 00.00\" N", "180:00:00.00"),
    ("90", "180"),
    (" 89°59'60\"N", "  2°53'W"),
    (" 89°60'00\"N", "  2°53'W"),
    (" 89.1°40'00\"N", "  2°53'W"),
    (" 89°40'00\"N", "  2°53.1'W"),
    ("0", "0"),
    (" 1°1\"N", "  1°1'E"),
    (" 1°59.999\"N", "  1°59.999\"E"),
    (" 1°59'59.9999\"N", "  1°59'59.9999\"E"),
    ("89°59'59.9999\"S", "179°59'59.9999\"W"),
    ("89°59'59.9999\"N", "179°59'59.9999\"E"),
    ("89°59'59.99999999\"N", "179°59'59.99999999\"E"),
    ("89°59'59.99'' N", "179°59'59.99''E"),
    ("50.849888888888", "2,885897222222"),
    ("89°59'59.9999\"S", "179°59'59,9999\"W"),
    ("89°59'1.599,999\"S", "179°59'59,9999\"W"),
    ("81.2", "-182.3"),
    ("-91.2", "-1"),
    ("++50:10:1", "2:1:2"),
    ("-50:10:1", "-+2:1:2"),
    ("-50::1", "-2:1:2"),
    ("- 50  : 2 : 1 ", "-2:1:2"),
    # Más: decimales como los de este árbol, minutos con decimales,
    # direcciones delante y detrás, º, # y comillas tipográficas, signos,
    # exponentes, vacíos y sin sentido.
    ("41.006381", "28.9758715"),
    ("-34.6037", "-58.3816"),
    ("40.4168N", "3.7038W"),
    ("S34.6037", "W58.3816"),
    ("40°25.008'N", "3°42.228'W"),
    ("40º25'0.5\"N", "3º42'13.7\"W"),
    ("40#25'0.5\"N", "3#42'13.7\"W"),
    ("40°25′0.5″N", "3°42′13.7″W"),
    ("+40.4168", "+3.7038"),
    ("4.04168e1", "-3.7038"),
    ("", ""),
    ("40.4168", ""),
    ("x", "y"),
    ("40:25", "-3:42"),
    ("40:60", "3:42"),
    ("40°25'N", "3°42'"),
]


def main():
    resultados = []
    for lat, lon in CASOS:
        a, b = conv_lat_lon(lat, lon, "D.D8")
        resultados.append({"lat": lat, "long": lon, "gramps": None if a is None else [a, b]})
    with open(DESTINO, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"version_gramps": VERSION_GRAMPS, "casos": resultados}, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"{len(resultados)} casos en {os.path.relpath(DESTINO, AQUI)}")


if __name__ == "__main__":
    main()
