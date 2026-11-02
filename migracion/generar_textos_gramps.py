"""Genera los nombres de los tipos de Gramps (tipos de evento, de
parentesco, de lugar…) en cada idioma de la web, tomados de las
traducciones oficiales de Gramps, para que la web use exactamente los
mismos términos que Gramps de escritorio.

Salida: app/src/i18n/gramps/<idioma>.generated.ts, y
app/src/i18n/gramps/personalizados.generated.ts con el valor numérico de
«personalizado» de cada clase (_CUSTOM: 0 en EventType, 4 en
FamilyRelType…), que no depende del idioma.

Uso (tras actualizar la biblioteca de Gramps):
    python generar_textos_gramps.py
"""
import json
import os
import subprocess
import sys

IDIOMAS = ["es", "fr", "en"]
AQUI = os.path.dirname(os.path.abspath(__file__))
DESTINO = os.path.join(AQUI, "..", "app", "src", "i18n", "gramps")


def tipos_del_idioma_actual():
    """Ejecutado en un proceso hijo con LANGUAGE ya fijado: Gramps traduce
    los nombres de _DATAMAP al importar sus módulos."""
    import entorno  # noqa: F401
    import gramps.gen.lib as lib
    from gramps.gen.lib.grampstype import GrampsType

    tipos = {}
    for nombre, clase in clases_tipo(lib, GrampsType):
        tipos[nombre] = {str(valor): texto for valor, texto, _ in clase._DATAMAP}
    return tipos


def clases_tipo(lib, GrampsType):
    for nombre in sorted(dir(lib)):
        clase = getattr(lib, nombre)
        if isinstance(clase, type) and issubclass(clase, GrampsType) and clase is not GrampsType:
            yield nombre, clase


def personalizados():
    import entorno  # noqa: F401
    import gramps.gen.lib as lib
    from gramps.gen.lib.grampstype import GrampsType

    return {nombre: clase._CUSTOM for nombre, clase in clases_tipo(lib, GrampsType)}


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--hijo":
        sys.stdout.buffer.write(json.dumps(tipos_del_idioma_actual(), ensure_ascii=False).encode("utf-8"))
        return
    os.makedirs(DESTINO, exist_ok=True)
    for idioma in IDIOMAS:
        env = dict(os.environ, LANGUAGE=idioma, LANG=idioma, LC_ALL=idioma)
        salida = subprocess.run([sys.executable, __file__, "--hijo"], env=env, cwd=AQUI,
                                capture_output=True, check=True).stdout
        tipos = json.loads(salida.decode("utf-8"))
        ruta = os.path.join(DESTINO, f"{idioma}.generated.ts")
        with open(ruta, "w", encoding="utf-8", newline="\n") as f:
            f.write("// GENERADO por migracion/generar_textos_gramps.py a partir de las\n")
            f.write("// traducciones de Gramps. No editar a mano.\n")
            f.write("// Nombres de los tipos de Gramps por clase y valor numérico.\n\n")
            f.write(f"export const tipos: Readonly<Record<string, Readonly<Record<string, string>>>> = ")
            f.write(json.dumps(tipos, ensure_ascii=False, indent=2))
            f.write(";\n")
        print(f"Guardado {os.path.relpath(ruta, os.path.join(AQUI, '..'))} ({len(tipos)} tipos)")
    ruta = os.path.join(DESTINO, "personalizados.generated.ts")
    with open(ruta, "w", encoding="utf-8", newline="\n") as f:
        f.write("// GENERADO por migracion/generar_textos_gramps.py. No editar a mano.\n")
        f.write("// Valor numérico de «personalizado» de cada clase de tipo de Gramps (_CUSTOM).\n\n")
        f.write("export const personalizados: Readonly<Record<string, number>> = ")
        f.write(json.dumps(personalizados(), indent=2))
        f.write(";\n")
    print(f"Guardado {os.path.relpath(ruta, os.path.join(AQUI, '..'))}")


if __name__ == "__main__":
    main()
