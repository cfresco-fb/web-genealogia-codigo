"""Pruebas de los cambios de la migración en arbol.py (31/10/2026): los
atributos de GEDCOM que se quitan y el checksum de las fotos.

Uso (en migracion\\, con el entorno):
    .venv\\Scripts\\python -m unittest arbol_test
"""
import os
import tempfile
import unittest

import entorno  # noqa: F401
import arbol
from gramps.gen.utils.file import create_checksum


def atributo(texto, clase="AttributeType"):
    return {"_class": "Attribute", "type": {"_class": clase, "value": 0, "string": texto}, "value": "x"}


class PruebasArbol(unittest.TestCase):
    def test_quitar_atributos_gedcom(self):
        objetos = {
            "Family": [{"handle": "f1", "attribute_list": [atributo("RIN"), atributo("_UID"), atributo("Correo electrónico")],
                        "child_ref_list": [{"attribute_list": [atributo(" rin ")]}]}],
            "Source": [{"handle": "s1", "attribute_list": [atributo("_UID", "SrcAttributeType")]}],
            "Person": [{"handle": "p1", "attribute_list": [atributo("Apodo RIN")]}],
        }
        cuenta = arbol.quitar_atributos_gedcom(objetos)
        self.assertEqual(dict(cuenta), {("Family", "RIN"): 1, ("Family", "_UID"): 1, ("Family", " rin "): 1, ("Source", "_UID"): 1})
        self.assertEqual([a["type"]["string"] for a in objetos["Family"][0]["attribute_list"]], ["Correo electrónico"])
        self.assertEqual(objetos["Family"][0]["child_ref_list"][0]["attribute_list"], [])
        self.assertEqual(objetos["Source"][0]["attribute_list"], [])
        self.assertEqual(len(objetos["Person"][0]["attribute_list"]), 1)

    def test_checksum_como_gramps(self):
        with tempfile.TemporaryDirectory() as carpeta:
            os.makedirs(os.path.join(carpeta, "Fotos"))
            ruta = os.path.join(carpeta, "Fotos", "a.jpg")
            with open(ruta, "wb") as f:
                f.write(os.urandom(200_000))
            self.assertEqual(arbol.md5_fichero(ruta), create_checksum(ruta))
            objetos = {"Media": [
                {"handle": "m1", "gramps_id": "O1", "path": "Fotos/a.jpg", "checksum": ""},
                {"handle": "m2", "gramps_id": "O2", "path": "Fotos/no-esta.jpg", "checksum": ""},
                {"handle": "m3", "gramps_id": "O3", "path": "Fotos/a.jpg", "checksum": "ya-tenia"},
                {"handle": "m4", "gramps_id": "O4", "path": "https://ejemplo.org/a.jpg", "checksum": ""},
            ]}
            self.assertEqual(arbol.calcular_checksums(objetos, carpeta), (1, ["O2"]))
            self.assertEqual([m["checksum"] for m in objetos["Media"]], [create_checksum(ruta), "", "ya-tenia", ""])


if __name__ == "__main__":
    unittest.main()
