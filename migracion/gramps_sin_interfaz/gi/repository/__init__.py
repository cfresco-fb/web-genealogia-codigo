"""Módulos de gi.repository: GLib con lo que usa gramps.gen.const y,
para el resto (Gtk, Gdk, Pango…), objetos vacíos que admiten cualquier
atributo. Nada de esto se ejecuta: solo evita errores al importar."""
import os


class _DirectorioUsuario:
    DIRECTORY_PICTURES = 0


class GLib:
    UserDirectory = _DirectorioUsuario

    @staticmethod
    def get_user_data_dir():
        return os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share"))

    @staticmethod
    def get_user_config_dir():
        return os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config"))

    @staticmethod
    def get_user_cache_dir():
        return os.environ.get("XDG_CACHE_HOME", os.path.expanduser("~/.cache"))

    @staticmethod
    def get_user_special_dir(_):
        return os.path.expanduser("~")

    @staticmethod
    def check_version(*args):
        return None


class _Meta(type):
    def __getattr__(cls, name):
        return _Meta(name, (object,), {})

    def __call__(cls, *args, **kwargs):
        return super().__call__()


class _Modulo:
    def __init__(self, nombre):
        self.__name__ = nombre

    def __getattr__(self, name):
        return _Meta(name, (object,), {})


def __getattr__(name):
    return _Modulo(name)
