// Carga del árbol al abrir la web y acceso desde cualquier componente con
// useArbol(). Con useEdicion(), guardar un cambio en el servidor y verlo al
// momento, y el aviso de que otros han cambiado el árbol (DA-15 b).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Center, Group, Loader, Paper, Stack, Text } from "@mantine/core";
import type { Peticion, PeticionReversion, Resultado, ResultadoReversion } from "../../../comun/peticion.ts";
import { useSesion } from "../acceso/sesion";
import { descargarInstantanea, estadoInstantanea, llamarArbol } from "../firebase";
import { t } from "../i18n";
import { Arbol, type ObjetoCambiado } from "./arbol";
import { prepararFechas } from "./fechas";
import type { Instantanea } from "./tipos";

/** Versiones de la instantánea que entiende la web (docs/instantanea.md). */
const VERSIONES_INSTANTANEA = [1, 2];
/** Cada cuánto se mira si hay datos nuevos (además de al volver a la
 * pestaña). */
const CADA_CUANTO_MS = 5 * 60_000;

const Contexto = createContext<Arbol | null>(null);

export interface Edicion {
  /** Guarda un cambio con la función del servidor y lo aplica al árbol en
   * memoria. Los errores de la función (conflicto, sin permiso…) llegan
   * como FirebaseError con details.codigo. */
  aplicarCambio: (peticion: Peticion) => Promise<Resultado>;
  /** Revierte un cambio del registro (paso 13), o sin `cadena` solo dice
   * qué habría que revertir; lo revertido se aplica al árbol en memoria. */
  revertirCambio: (peticion: PeticionReversion) => Promise<ResultadoReversion>;
  /** Aplica una solicitud (el administrador); `autor`, la persona de quien
   * la pidió (creador de lo nuevo). */
  aplicarSolicitud: (solicitud: string, comentario: string | null, autor: string | null) => Promise<Resultado>;
}

const ContextoEdicion = createContext<Edicion | null>(null);

type Estado = { tipo: "cargando" } | { tipo: "error"; mensaje: string } | { tipo: "listo"; arbol: Arbol };

async function cargarArbol(): Promise<Arbol> {
  const [datos] = await Promise.all([descargarInstantanea(), prepararFechas()]);
  const instantanea = datos as Instantanea;
  if (!VERSIONES_INSTANTANEA.includes(instantanea.version_instantanea)) {
    throw new Error(`Versión de instantánea no reconocida: ${instantanea.version_instantanea}`);
  }
  return new Arbol(instantanea);
}

export function ProveedorArbol({ children }: { children: ReactNode }) {
  const persona = useSesion().invitacion.persona || null;
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const [hayNuevos, setHayNuevos] = useState(false);
  // La instantánea descargada y los cambios propios aplicados encima: hay
  // datos nuevos si la de Storage trae algún cambio que no es de estos.
  const cargada = useRef<{ secuencia: number; generada: string; propios: Set<number> } | null>(null);

  const cargar = useCallback(() => {
    setEstado({ tipo: "cargando" });
    setHayNuevos(false);
    cargarArbol().then(
      (arbol) => {
        cargada.current = { secuencia: arbol.secuencia, generada: arbol.generada, propios: new Set() };
        setEstado({ tipo: "listo", arbol });
      },
      (e: unknown) => setEstado({ tipo: "error", mensaje: e instanceof Error ? e.message : String(e) }),
    );
  }, []);
  useEffect(cargar, [cargar]);

  // DA-15 b: al volver a la pestaña y cada pocos minutos, sin descargarla.
  useEffect(() => {
    if (estado.tipo !== "listo") return;
    const mirar = () => {
      const c = cargada.current;
      if (!c || document.visibilityState !== "visible") return;
      estadoInstantanea().then((r) => {
        const nuevos = r.secuencia
          ? Array.from({ length: Math.max(0, r.secuencia - c.secuencia) }, (_, i) => c.secuencia + 1 + i).some((s) => !c.propios.has(s))
          : r.generada !== c.generada;
        if (nuevos) setHayNuevos(true);
      }, () => {});
    };
    const reloj = setInterval(mirar, CADA_CUANTO_MS);
    document.addEventListener("visibilitychange", mirar);
    return () => {
      clearInterval(reloj);
      document.removeEventListener("visibilitychange", mirar);
    };
  }, [estado.tipo]);

  const aplicarCambio = useCallback(async (peticion: Peticion) => {
    const r = await llamarArbol<Resultado>("aplicar", { peticion });
    cargada.current?.propios.add(r.secuencia);
    setEstado((e) => (e.tipo === "listo" ? { tipo: "listo", arbol: e.arbol.conCambios(r.objetos as ObjetoCambiado[], r.secuencia, persona) } : e));
    return r;
  }, [persona]);
  const revertirCambio = useCallback(async (reversion: PeticionReversion) => {
    const r = await llamarArbol<ResultadoReversion>("revertir", { reversion });
    if (!r.cambios.length) return r;
    for (let s = r.secuencia - r.cambios.length + 1; s <= r.secuencia; s++) cargada.current?.propios.add(s);
    setEstado((e) => (e.tipo === "listo" ? { tipo: "listo", arbol: e.arbol.conCambios(r.objetos as ObjetoCambiado[], r.secuencia) } : e));
    return r;
  }, []);
  const aplicarSolicitud = useCallback(async (solicitud: string, comentario: string | null, autor: string | null) => {
    const r = await llamarArbol<Resultado>("aplicarSolicitud", { resolucion: { solicitud, comentario } });
    cargada.current?.propios.add(r.secuencia);
    setEstado((e) => (e.tipo === "listo" ? { tipo: "listo", arbol: e.arbol.conCambios(r.objetos as ObjetoCambiado[], r.secuencia, autor) } : e));
    return r;
  }, []);
  const edicion = useMemo(() => ({ aplicarCambio, revertirCambio, aplicarSolicitud }), [aplicarCambio, revertirCambio, aplicarSolicitud]);

  if (estado.tipo === "cargando") {
    return (
      <Center h="100dvh">
        <Stack align="center">
          <Loader />
          <Text>{t("app.cargando")}</Text>
        </Stack>
      </Center>
    );
  }
  if (estado.tipo === "error") {
    return (
      <Center h="100dvh" p="md">
        <Alert color="red" title={t("app.errorCarga")} maw={560}>
          <Stack>
            <Text size="sm">{t("app.errorCargaAyuda")}</Text>
            <Text size="xs" c="dimmed" ff="monospace">{estado.mensaje}</Text>
            <Button onClick={cargar} w="fit-content">{t("app.reintentar")}</Button>
          </Stack>
        </Alert>
      </Center>
    );
  }
  return (
    <ContextoEdicion.Provider value={edicion}>
      <Contexto.Provider value={estado.arbol}>
        {children}
        {hayNuevos && (
          <Paper
            withBorder
            shadow="md"
            p="sm"
            role="status"
            style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 300, maxWidth: "calc(100vw - 32px)" }}
          >
            <Group gap="sm" wrap="nowrap">
              <Text>{t("app.datosNuevos")}</Text>
              <Button onClick={cargar}>{t("app.actualizar")}</Button>
            </Group>
          </Paper>
        )}
      </Contexto.Provider>
    </ContextoEdicion.Provider>
  );
}

export function useArbol(): Arbol {
  const arbol = useContext(Contexto);
  if (!arbol) throw new Error("useArbol() fuera de ProveedorArbol");
  return arbol;
}

export function useEdicion(): Edicion {
  const e = useContext(ContextoEdicion);
  if (!e) throw new Error("useEdicion() fuera de ProveedorArbol");
  return e;
}
