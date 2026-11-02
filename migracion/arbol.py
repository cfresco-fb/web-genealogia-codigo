"""Conversión entre Gramps XML y el formato JSON de la web.

El JSON usa la serialización oficial de objetos de Gramps 6
(gramps.gen.lib.json_utils), la misma que usa gramps-web-api.
"""
import contextlib
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import sys
import tarfile
import tempfile
import types
from collections import Counter
from datetime import datetime, timezone

import entorno  # noqa: F401  (debe ir antes de gramps)

from gramps.gen.db import DbTxn
from gramps.gen.db.utils import make_database
from gramps.gen.lib.json_utils import data_to_object, object_to_dict
from gramps.gen.user import User
from gramps.plugins.importer.importxml import importData
from gramps.version import VERSION as VERSION_GRAMPS

VERSION_FORMATO = 1

# Orden de inserción: primero lo que otros objetos referencian.
TIPOS = [
    ("Tag", "iter_tags", "add_tag"),
    ("Note", "iter_notes", "add_note"),
    ("Repository", "iter_repositories", "add_repository"),
    ("Source", "iter_sources", "add_source"),
    ("Citation", "iter_citations", "add_citation"),
    ("Media", "iter_media", "add_media"),
    ("Place", "iter_places", "add_place"),
    ("Event", "iter_events", "add_event"),
    ("Person", "iter_people", "add_person"),
    ("Family", "iter_families", "add_family"),
]


def bd_temporal():
    """Base de datos SQLite de Gramps en una carpeta temporal.

    Al crear la primera base de datos, Gramps registra todos sus
    complementos, incluidos los de interfaz gráfica, que fallan sin GTK y
    escriben errores en pantalla. No afectan a la conversión, así que esa
    salida se descarta.
    """
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        db = make_database("sqlite")
    db.load(tempfile.mkdtemp(prefix="gramps-tmp-"))
    return db


def preparar_origen(ruta, carpeta_trabajo):
    """Devuelve (ruta_xml, carpeta_base_multimedia).

    Admite .gramps (XML, comprimido o no) y .gpkg (paquete con multimedia).
    Un .gpkg se extrae en carpeta_trabajo.
    """
    if ruta.lower().endswith(".gpkg"):
        destino = os.path.join(carpeta_trabajo, os.path.splitext(os.path.basename(ruta))[0])
        if os.path.isdir(destino):
            shutil.rmtree(destino)
        os.makedirs(destino)
        with tarfile.open(ruta, "r:gz") as tar:
            tar.extractall(destino, filter="data")
        xml = os.path.join(destino, "data.gramps")
        if not os.path.exists(xml):
            raise SystemExit(f"El paquete {ruta} no contiene data.gramps")
        return xml, destino
    return ruta, os.path.dirname(os.path.abspath(ruta))


def xml_a_bd(ruta_xml, base_multimedia=None):
    db = bd_temporal()
    if base_multimedia:
        db.set_mediapath(base_multimedia)
    importData(db, ruta_xml, User())
    if base_multimedia and not db.get_mediapath():
        db.set_mediapath(base_multimedia)
    return db


def bd_a_objetos(db):
    return {tipo: [object_to_dict(o) for o in getattr(db, it)()] for tipo, it, _ in TIPOS}


def objetos_a_bd(objetos):
    """Los objetos ya traen handle y gramps_id, así que se guardan con
    commit_* en vez de add_*: add_* pone como fecha de última modificación
    («change») la hora actual, y commit_* permite conservar la original.
    (Gramps trata change = 0 como «sin fecha» y pone la hora actual.)"""
    db = bd_temporal()
    with DbTxn("Importar JSON", db) as trans:
        for tipo, _, anadir in TIPOS:
            guardar = getattr(db, anadir.replace("add_", "commit_"))
            for datos in objetos.get(tipo, []):
                obj = data_to_object(datos)
                guardar(obj, trans, change_time=obj.change)
    return db


def bd_a_xml(db, salida, comprimir=False):
    # El exportador importa clases de opciones de interfaz que aquí no se usan.
    sys.modules.setdefault(
        "gramps.gui.plug.export",
        types.SimpleNamespace(WriterOptionBox=object, WriterOptionBoxWithCompression=object),
    )
    from gramps.plugins.export.exportxml import XmlWriter

    XmlWriter(db, User(), 0, compress=comprimir).write(salida)


def persona_inicio(db):
    """Handle de la persona de inicio de Gramps, o None si no hay."""
    return db.get_default_handle() or None


def fijar_persona_inicio(db, handle):
    if handle:
        db.set_default_person_handle(handle)


_UNIDAD = re.compile(r"^[A-Za-z]:")
_DIRECCION_WEB = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*://")


def _partes(ruta):
    """Carpetas y fichero de una ruta, sin la unidad ni la barra inicial."""
    return [p for p in _UNIDAD.sub("", ruta.replace("\\", "/")).split("/") if p not in ("", ".")]


def es_ruta(texto):
    """Si un texto parece una ruta de fichero (lleva «/» o «\\»)."""
    return "/" in texto or "\\" in texto


def relativizar_multimedia(objetos, base_origen, carpeta_gramps=None):
    """Deja las rutas de las fotos relativas a la carpeta base de multimedia
    de Gramps («Fotos/50003.jpg») y quita la ruta de las descripciones que
    son una ruta (se queda el nombre del fichero). Decisión de Carlos del
    30/10/2026: nada de rutas del PC en la web (Firestore, instantánea,
    Storage).

    `base_origen`: la carpeta de la que cuelgan las rutas relativas (la del
    paquete .gpkg extraído o la del .gramps). En un .gpkg, Gramps guarda la
    ruta completa del PC sin la unidad («Users/…/Fotos/50003.jpg»).
    `carpeta_gramps`: la carpeta base de multimedia de Gramps (Preferencias),
    con o sin unidad; sin ella, la que tienen en común todas las fotos menos
    su última carpeta (todas en «…/Fotos» → «Fotos/50003.jpg»).

    Cambia los objetos Media y devuelve (carpeta local de la que cuelgan
    ahora las rutas, carpeta base en forma de Gramps, rutas cambiadas,
    descripciones cambiadas). Las direcciones web no se tocan.
    """
    medias = [m for m in objetos.get("Media", []) if m.get("path") and not _DIRECCION_WEB.match(m["path"])]
    descripciones = 0
    for m in objetos.get("Media", []):
        if m.get("desc") and es_ruta(m["desc"]):
            m["desc"] = _partes(m["desc"])[-1] if _partes(m["desc"]) else ""
            descripciones += 1
    if not medias:
        return base_origen, "", 0, descripciones

    partes = {m["handle"]: _partes(m["path"]) for m in medias}
    if carpeta_gramps:
        base = _partes(carpeta_gramps)
    else:
        comun = None
        for p in partes.values():
            carpetas = p[:-1]
            if comun is None:
                comun = carpetas
            else:
                n = 0
                while n < min(len(comun), len(carpetas)) and comun[n].lower() == carpetas[n].lower():
                    n += 1
                comun = comun[:n]
        base = comun[:-1] if comun else []

    fuera = [m for m in medias if [x.lower() for x in partes[m["handle"]][:len(base)]] != [x.lower() for x in base]
             or len(partes[m["handle"]]) <= len(base)]
    if fuera:
        raise SystemExit(f"{len(fuera)} fotos no están dentro de la carpeta base de multimedia «{'/'.join(base)}» "
                         f"(por ejemplo, {fuera[0].get('gramps_id')}). Indica otra con --carpeta-multimedia.")
    # La carpeta local de la que cuelgan ahora: la de cada fichero sin la
    # parte relativa (la misma para todos).
    locales = {}
    rutas = 0
    for m in medias:
        p = m["path"]
        absoluta = bool(_UNIDAD.match(p)) or p.startswith(("/", "\\"))
        completa = os.path.normpath(p if absoluta else os.path.join(base_origen, p))
        relativa = partes[m["handle"]][len(base):]
        local = completa
        for _ in relativa:
            local = os.path.dirname(local)
        locales.setdefault(os.path.normcase(local), local)
        nueva = "/".join(relativa)
        if nueva != p:
            m["path"] = nueva
            rutas += 1
    if len(locales) != 1:
        raise SystemExit("Las fotos están en unidades o carpetas locales distintas: indica la carpeta base con --carpeta-multimedia.")
    return next(iter(locales.values())), "/".join(base), rutas, descripciones


# Atributos que dejó una importación de GEDCOM y que no hacen falta en la web
# (decisión de Carlos del 31/10/2026): la migración los quita. Gramps de
# escritorio los conserva.
ATRIBUTOS_GEDCOM = {"rin", "_uid"}
_CLASES_ATRIBUTO = ("AttributeType", "SrcAttributeType")


def _es_atributo_gedcom(a):
    t = a.get("type") if isinstance(a, dict) else None
    return (isinstance(t, dict) and t.get("_class") in _CLASES_ATRIBUTO
            and str(t.get("string") or "").strip().lower() in ATRIBUTOS_GEDCOM)


def quitar_atributos_gedcom(objetos):
    """Quita los atributos «RIN» y «_UID» de cualquier objeto (y de sus
    referencias), a cualquier profundidad. Devuelve un Counter de
    (tipo de objeto, atributo)."""
    cuenta = Counter()

    def recorrer(v, tipo):
        if isinstance(v, list):
            for x in v:
                recorrer(x, tipo)
        elif isinstance(v, dict):
            lista = v.get("attribute_list")
            if isinstance(lista, list):
                for a in lista:
                    if _es_atributo_gedcom(a):
                        cuenta[(tipo, a["type"]["string"])] += 1
                v["attribute_list"] = [a for a in lista if not _es_atributo_gedcom(a)]
            for x in v.values():
                recorrer(x, tipo)

    for tipo, lista in objetos.items():
        recorrer(lista, tipo)
    return cuenta


def md5_fichero(ruta):
    """MD5 en hexadecimal del contenido de un fichero, como Media.checksum
    de Gramps (gramps.gen.utils.file.create_checksum) y como las fotos
    subidas desde la web (functions/src/fotos.ts)."""
    md5 = hashlib.md5()
    with open(ruta, "rb") as f:
        for trozo in iter(lambda: f.read(65536), b""):
            md5.update(trozo)
    return md5.hexdigest()


def ruta_local(media, base_local):
    """La ruta del fichero de una foto en el PC (como media_path_full de
    Gramps), o None si es una dirección web."""
    p = media.get("path") or ""
    if not p or _DIRECCION_WEB.match(p):
        return None
    return os.path.normpath(p if os.path.isabs(p) else os.path.join(base_local, p))


def calcular_checksums(objetos, base_local):
    """Rellena el checksum vacío de cada foto con el MD5 de su fichero
    (decisión de Carlos del 31/10/2026: así la ida y vuelta es exacta, porque
    Gramps lo calcula al importar un XML que no lo trae). Devuelve
    (calculados, gramps_id de las fotos cuyo fichero no se encuentra)."""
    calculados, faltan = 0, []
    for m in objetos.get("Media", []):
        if m.get("checksum"):
            continue
        ruta = ruta_local(m, base_local)
        if ruta is None:
            continue
        if os.path.isfile(ruta):
            m["checksum"] = md5_fichero(ruta)
            calculados += 1
        else:
            faltan.append(m.get("gramps_id") or m["handle"])
    return calculados, faltan


def a_la_web(objetos, base_origen, carpeta_gramps=None):
    """Los cambios de la migración sobre los objetos de Gramps, en orden (los
    usan exportar_json.py y comprobar_ida_vuelta.py): rutas de las fotos
    relativas, sin atributos de GEDCOM, tipos propios del catálogo como
    código y checksum de las fotos que no lo tienen. Imprime lo hecho y
    devuelve la carpeta local de la que cuelgan las rutas."""
    import tipos_propios
    local, carpeta, rutas, descripciones = relativizar_multimedia(objetos, base_origen, carpeta_gramps)
    print(f"\nMultimedia: carpeta base de Gramps «{carpeta or '(la del fichero)'}»; {rutas} rutas pasan a ser "
          f"relativas a ella y {descripciones} descripciones que eran una ruta se quedan con el nombre del fichero.")
    quitados = quitar_atributos_gedcom(objetos)
    print(f"\nAtributos de GEDCOM quitados (RIN y _UID): {sum(quitados.values())}")
    for (tipo, atributo), n in sorted(quitados.items()):
        print(f"  {tipo} «{atributo}»: {n}")
    tipos_propios.imprimir(*tipos_propios.a_codigos(objetos))
    calculados, faltan = calcular_checksums(objetos, local)
    print(f"\nFotos: {calculados} checksum calculados (MD5 del fichero, como Gramps)")
    if faltan:
        print(f"AVISO: {len(faltan)} fotos sin fichero, sin checksum: {', '.join(faltan[:10])}")
    return local


def guardar_json(objetos, salida, origen, base_multimedia, inicio=None):
    doc = {
        "version_formato": VERSION_FORMATO,
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "origen": os.path.basename(origen),
        "version_gramps": VERSION_GRAMPS,
        "base_multimedia": base_multimedia,
        "persona_inicio": inicio,
        "objetos": objetos,
    }
    with io.open(salida, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)


def cargar_json(ruta):
    """El JSON de la web; también comprimido («.gz»), como las copias
    nocturnas de Google Drive (functions/src/copiaDrive.ts)."""
    abrir = gzip.open if ruta.lower().endswith(".gz") else io.open
    with abrir(ruta, "rt", encoding="utf-8") as f:
        doc = json.load(f)
    if doc.get("version_formato") != VERSION_FORMATO:
        raise SystemExit(f"Formato no reconocido en {ruta}: {doc.get('version_formato')}")
    return doc
