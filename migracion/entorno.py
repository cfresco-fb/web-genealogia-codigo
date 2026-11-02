"""Prepara el entorno antes de importar la biblioteca de Gramps.

Importar este módulo ANTES que cualquier módulo de gramps:
- añade el sustituto de gi (gramps_sin_interfaz) a la ruta de importación;
- fija GRAMPSHOME en una carpeta propia, para que la biblioteca NO lea ni
  modifique la configuración de tu Gramps de escritorio (%APPDATA%\\gramps);
- silencia los avisos de complementos de interfaz que no se usan.
"""
import logging
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, "gramps_sin_interfaz"))

GRAMPSHOME = os.path.join(AQUI, ".gramps-home")
os.makedirs(GRAMPSHOME, exist_ok=True)
os.environ["GRAMPSHOME"] = GRAMPSHOME
# En Linux/Mac, la biblioteca usa además las carpetas XDG.
for var in ("XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"):
    os.environ[var] = os.path.join(GRAMPSHOME, var.lower())

# Algunas rutas de multimedia de Gramps usan esta variable (por ejemplo, el
# árbol de ejemplo oficial: «{GRAMPS_RESOURCES}/example/gramps»). El lanzador
# de Gramps de escritorio la define; aquí se apunta a la documentación que
# instala pip junto a la biblioteca.
os.environ.setdefault("GRAMPS_RESOURCES", os.path.join(sys.prefix, "share", "doc", "gramps"))

logging.basicConfig(level=logging.ERROR)
for nombre in ("", "gramps", ".gramps"):
    logging.getLogger(nombre).setLevel(logging.CRITICAL)
