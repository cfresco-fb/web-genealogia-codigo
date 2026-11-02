"""Sustituto mínimo de PyGObject (gi).

La biblioteca de Gramps importa gi (GTK) incluso para tareas sin interfaz.
En Windows, PyGObject es difícil de instalar con pip, y aquí no hace falta:
solo se usan la base de datos, el importador y el exportador XML.
Este paquete ofrece lo justo para que esos módulos se carguen.
"""


def require_version(*args, **kwargs):
    pass

