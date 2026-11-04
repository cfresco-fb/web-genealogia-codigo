"""Convierte con la biblioteca de Gramps (gramps/gen/lib/gcalendar.py) una
serie de números de día (SDN) a año, mes y día en cada calendario, para
comprobar que comun/calendarios.ts (su traducción) da lo mismo (prueba en
comun/calendarios.test.ts).

Guarda en comun/datos-prueba/calendarios-gramps.json, para cada
calendario, los SDN probados y su [año, mes, día] según Gramps. La prueba
comprueba también la vuelta (de [año, mes, día] al SDN).

Uso (tras actualizar la biblioteca de Gramps):
    python calendarios_gramps.py
"""
import json
import os

import entorno  # noqa: F401

from gramps.gen.lib import gcalendar
from gramps.version import VERSION as VERSION_GRAMPS

AQUI = os.path.dirname(os.path.abspath(__file__))
DESTINO = os.path.join(AQUI, "..", "comun", "datos-prueba", "calendarios-gramps.json")

# Del año 1585 al 2050, más o menos; el republicano francés, solo en su
# época (1792-1805). Un paso que no es divisor de 7 ni de los meses recorre
# todos los días de la semana y del mes.
AMPLIO = (2300000, 2470000, 97)
CALENDARIOS = {
    "gregoriano": (0, gcalendar.gregorian_ymd, AMPLIO),
    "juliano": (1, gcalendar.julian_ymd, AMPLIO),
    "hebreo": (2, gcalendar.hebrew_ymd, AMPLIO),
    "frances": (3, gcalendar.french_ymd, (2375840, 2380950, 7)),
    "persa": (4, gcalendar.persian_ymd, AMPLIO),
    "islamico": (5, gcalendar.islamic_ymd, AMPLIO),
    # El sueco, también en su periodo propio (1700-1712) y su vuelta al
    # gregoriano en 1753.
    "sueco": (6, gcalendar.swedish_ymd, (2340000, 2365000, 11)),
}


def main():
    salida = {"gramps": VERSION_GRAMPS, "calendarios": {}}
    for nombre, (numero, a_ymd, (desde, hasta, paso)) in CALENDARIOS.items():
        sdns = list(range(desde, hasta, paso))
        salida["calendarios"][nombre] = {
            "calendario": numero,
            "sdn": sdns,
            "ymd": [list(a_ymd(sdn)) for sdn in sdns],
        }
    with open(DESTINO, "w", encoding="utf-8", newline="\n") as f:
        json.dump(salida, f, separators=(",", ":"))
        f.write("\n")
    print(f"Escrito {DESTINO}")


if __name__ == "__main__":
    main()
