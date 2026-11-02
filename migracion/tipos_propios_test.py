"""Pruebas de tipos_propios.py con los casos comunes con la web
(comun/tipos-propios.casos.json).

Uso (en migracion\\, con el entorno):
    .venv\\Scripts\\python -m unittest tipos_propios_test
"""
import copy
import io
import json
import os
import unittest

import tipos_propios as tp

with io.open(os.path.join(tp.AQUI, "..", "comun", "tipos-propios.casos.json"), encoding="utf-8") as _f:
    CASOS = json.load(_f)


def tipo(clase, valor, texto=""):
    return {"_class": clase, "value": valor, "string": texto}


class PruebasTiposPropios(unittest.TestCase):
    def test_casos_comunes(self):
        for c in CASOS["aCodigo"]:
            self.assertEqual(tp.codigo_de(c["clase"], c["texto"]), c["codigo"], f"{c['clase']} «{c['texto']}»")
        for c in CASOS["aTexto"]:
            self.assertEqual(tp.texto_de(c["clase"], c["codigo"], c["idioma"]), c["texto"], c["codigo"])

    def test_ida_y_vuelta(self):
        objetos = {
            "Event": [{"handle": "e1", "type": tipo("EventType", 0, "Deported"),
                       "attribute_list": [{"type": tipo("AttributeType", 0, "RIN")}]},
                      {"handle": "e2", "type": tipo("EventType", 12)}],
            "Family": [{"handle": "f1", "type": tipo("FamilyRelType", 4, "Sin relación de pareja"),
                        "child_ref_list": [{"frel": tipo("ChildRefType", 7, "Custom relationship to father")}]}],
        }
        original = copy.deepcopy(objetos)
        cambiados, desconocidos = tp.a_codigos(objetos)
        self.assertEqual(objetos["Event"][0]["type"]["string"], "@deportacion")
        self.assertEqual(objetos["Family"][0]["type"], tipo("FamilyRelType", 4, "@sin_relacion"))
        self.assertEqual(sum(cambiados.values()), 2)
        self.assertEqual(set(desconocidos), {("AttributeType", "RIN"), ("ChildRefType", "Custom relationship to father")})
        self.assertEqual(tp.a_textos(objetos), 2)
        # El sinónimo vuelve con el texto del catálogo; lo demás, igual.
        self.assertEqual(objetos["Event"][0]["type"]["string"], "Deportación")
        objetos["Event"][0]["type"]["string"] = "Deported"
        self.assertEqual(objetos, original)

    def test_texto_que_parece_un_codigo(self):
        with self.assertRaises(SystemExit):
            tp.a_codigos({"Event": [{"type": tipo("EventType", 0, "@separacion")}]})

    def test_codigo_desconocido(self):
        with self.assertRaises(SystemExit):
            tp.a_textos({"Event": [{"type": tipo("EventType", 0, "@inventado")}]})


if __name__ == "__main__":
    unittest.main()
