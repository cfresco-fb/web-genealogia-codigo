# Migración Gramps ⇄ web

Programas en Python que usan la biblioteca oficial de Gramps 6.0.5.
Se ejecutan en tu PC; los datos no salen de él.

| Programa | Qué hace |
|---|---|
| `exportar_json.py` | `.gpkg`/`.gramps` → JSON de la web, e imprime el resumen |
| `importar_json.py` | JSON de la web → `.gramps` (para reimportar en Gramps); `--idioma` de los tipos propios guardados como código (castellano por defecto) |
| `comprobar_ida_vuelta.py` | Prueba automática de fidelidad de todo el circuito |
| `comparar_json.py` | Compara objeto a objeto dos JSON (lo usa `npm run circuito`) |
| `vivos_gramps.py` | Quién está «probablemente vivo» según Gramps en el árbol de ejemplo, para comprobar la traducción de la web (`app/src/arbol/vivos.test.ts`) |
| `rama_gramps.py` | Rama editable y referencias de una muestra de objetos según la biblioteca de Gramps, en el árbol de ejemplo, para comprobar `comun/rama.ts` y `comun/referencias.ts` (`comun/contraste.test.ts`) |
| `fechas_gramps.py` | Las fechas del árbol de ejemplo (y unas hechas a mano con Gramps) con su texto en Gramps, para comprobar el lector de fechas de los formularios (`app/src/arbol/leerFecha.test.ts`) |
| `plantillas_gramps.py` | Plantillas vacías y esquemas de los objetos de Gramps para la edición (`comun/gramps/plantillas.json`), con su prueba de exportar e importar en Gramps |
| `generar_textos_gramps.py` | Nombres de los tipos de Gramps (evento, parentesco…) en cada idioma de la web, desde las traducciones de Gramps |

Módulos de apoyo: `arbol.py` (conversiones), `tipos_propios.py` (tipos
propios como códigos, con el catálogo `comun/tipos-propios.json`; prueba:
`python -m unittest tipos_propios_test`; los demás cambios de la migración,
`python -m unittest arbol_test`), `resumen.py` (cifras del
informe de Gramps), `entorno.py` y `gramps_sin_interfaz/` (ver
`docs/fase-0-migracion.md`).

## Preparación (una vez), en PowerShell desde esta carpeta

```
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Uso

```
.venv\Scripts\Activate.ps1
python comprobar_ida_vuelta.py ..\datos\entrada\arbol.gpkg
python exportar_json.py ..\datos\entrada\arbol.gpkg ..\datos\salida\arbol.json
python importar_json.py ..\datos\salida\arbol.json ..\datos\salida\arbol-vuelta.gramps
```

Aviso habitual e inofensivo: «ICU not loaded… Localization will be
impaired». Solo afecta a la ordenación alfabética con acentos de Gramps,
que aquí no se usa.
