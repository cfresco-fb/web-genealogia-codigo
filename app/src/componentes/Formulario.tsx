// Piezas comunes de los formularios de edición (fase 3; docs/edicion.md,
// «Formularios»): el guardado por la función del servidor con su flujo
// (editar → guardar → hecho, o conflicto, o solicitud), las pantallas de
// «hecho», del conflicto (DA-14 a) y de la solicitud (paso 12), el pie con
// «Guardar», el campo «Motivo» (DA-18 a) y el selector de tipos.
//
// Solicitudes (paso 12): si lo que se guarda no lo puede guardar el usuario
// (lo sabe la web con el mismo código que el servidor, o lo dice el
// servidor si la web estaba atrasada), «Guardar» lleva a la pantalla de la
// solicitud: por qué, el motivo (obligatorio) y «Enviar solicitud».
//
// Sin pantalla de resumen (decisión de Carlos del 26/10/2026): «Guardar»
// guarda directamente.
//
// Tipos (decisión de Carlos del 25/10/2026): la lista oficial en el idioma
// de la web más los tipos propios que ya hay en el árbol; solo el
// administrador puede añadir uno nuevo (el servidor lo comprueba). Los demás
// también lo pueden escribir, y entonces el guardado va como solicitud.
//
// «Guardar» arriba y abajo (petición de Carlos del 28/10/2026): en las
// páginas, en una barra fija bajo la cabecera; en las ventanas, al
// principio (`PieEditar` con `arriba`).

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Anchor, Autocomplete, Box, Button, Group, List, Modal, Stack, Text, Textarea } from "@mantine/core";
import { doc, getDoc } from "firebase/firestore/lite";
import { Link, useBlocker, useNavigate, useSearchParams } from "react-router";
import { deFirestore, type ObjetoGramps, type Tipo } from "../../../comun/gramps.ts";
import type { NoPermitido } from "../../../comun/permisos.ts";
import { entradasClase, esCodigo, MARCA_CODIGO } from "../../../comun/tipos.ts";
import type { Peticion } from "../../../comun/peticion.ts";
import { PropuestaALaVista } from "./PropuestaALaVista";
import type { ClaseSolicitud } from "../../../comun/solicitudes.ts";
import { useSesion } from "../acceso/sesion";
import { normalizar } from "../arbol/arbol";
import { useArbol, useEdicion } from "../arbol/contexto";
import { useModoPropuesta, usePermisos } from "../arbol/permisos";
import { calentarServidor, db } from "../firebase";
import { cambiosDePeticion, Descripcion } from "./cambiosSolicitud";
import { enviarSolicitud } from "../solicitudes";
import { color } from "../tema/colores";
import { comparador, nombreTipo, t, valoresTipo, valorPersonalizado, type Clave } from "../i18n";

/** Una ficha que otro ha cambiado mientras se editaba: cómo está ahora
 * (null si se ha borrado). */
export interface FichaConflicto {
  tipo: Tipo;
  handle: string;
  actual: ObjetoGramps | null;
}

export type Paso =
  | { tipo: "editar" }
  | { tipo: "guardando" }
  | { tipo: "hecho"; marcado: boolean; solicitud?: string }
  | { tipo: "conflicto"; fichas: FichaConflicto[] }
  | { tipo: "solicitud"; peticion: Peticion; noPermitidos: NoPermitido[]; clase: ClaseSolicitud };

interface ErrorFuncion {
  message?: string;
  details?: { codigo?: string; detalles?: unknown; mensaje?: string | null };
}

/** El flujo de un formulario: el paso en que está, el error del último
 * intento y `guardar`, que manda la petición y pasa a «hecho», al conflicto
 * (con las fichas que han cambiado, leídas de Firestore) o vuelve al
 * formulario con el error. `errorPermiso`: el mensaje si no hay permiso. Al
 * abrir el formulario, despierta la función (DA-26 a). */
const megas = (bytes: number) => Math.round(bytes / (1024 * 1024)).toLocaleString("es-ES");

/** El texto de un fallo de la función del servidor (fuera del conflicto,
 * que tiene su pantalla). */
export function textoError(e: unknown, admin: boolean, errorPermiso: Clave = "formulario.errorPermiso"): string {
  const err = e as ErrorFuncion;
  const codigo = err.details?.codigo;
  const detalles = err.details?.detalles as {
    espacio?: { usados: number; cuota: number }; vinculadas?: { motivo: string }[]; fotosSinFicheros?: string[]; anteriorACarga?: boolean;
  } | unknown[] | undefined;
  const espacio = !Array.isArray(detalles) ? detalles?.espacio : undefined;
  const vinculadas = !Array.isArray(detalles) ? detalles?.vinculadas : undefined;
  if (codigo === "SIN_PERMISO") return t(errorPermiso);
  if (codigo === "LIMITE" && espacio) return t("foto.sinEspacio", { usados: megas(espacio.usados), cuota: megas(espacio.cuota) });
  if (codigo === "LIMITE") return t("formulario.errorLimite");
  if (codigo === "INTEGRIDAD" && vinculadas?.length) {
    return vinculadas.map((v) => t(v.motivo === "inicio" ? "borrar.vinculadaInicio" : "borrar.vinculadaInvitacion")).join(" ");
  }
  if (codigo === "INTEGRIDAD" && !Array.isArray(detalles) && detalles?.fotosSinFicheros?.length) return t("foto.sinFicheros");
  if (codigo === "PETICION" && !Array.isArray(detalles) && detalles?.anteriorACarga) return t("registro.carga.noRevertir");
  if (codigo === "CONFLICTO") return t("borrar.conflicto");
  if (codigo === "INTERNO") return t("formulario.errorInterno") + (admin && err.details?.mensaje ? ` (${err.details.mensaje})` : "");
  if (codigo) return t("formulario.errorServidor", { codigo, mensaje: err.message ?? "" });
  return t("formulario.errorConexion");
}

export function useGuardado(errorPermiso: Clave = "formulario.errorPermiso") {
  const { aplicarCambio } = useEdicion();
  const { prohibido } = usePermisos();
  const admin = useSesion().invitacion.rol === "administrador";
  const [paso, setPaso] = useState<Paso>({ tipo: "editar" });
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  useEffect(calentarServidor, []);

  /** Un fallo al guardar (o al enviar la solicitud, `peticion`): el
   * conflicto, la solicitud si no hay permiso, o el error. */
  async function trasFallo(e: unknown, peticion: Peticion, enSolicitud: boolean) {
    const err = e as ErrorFuncion;
    const codigo = err.details?.codigo;
    const detalles = Array.isArray(err.details?.detalles) ? (err.details.detalles as NoPermitido[]) : [];
    if (codigo === "CONFLICTO") {
      const fichas = await Promise.all(detalles.map(async ({ tipo, handle }) => {
        const d = await getDoc(doc(db, tipo, handle)).catch(() => null);
        return { tipo, handle, actual: d?.exists() ? (deFirestore(d.data()) as ObjetoGramps) : null };
      }));
      setPaso({ tipo: "conflicto", fichas });
      return;
    }
    // La web estaba atrasada: lo que creía que se podía guardar, no.
    if (codigo === "SIN_PERMISO" && !enSolicitud) {
      setPaso({ tipo: "solicitud", peticion, noPermitidos: detalles, clase: "cambio" });
      return;
    }
    if (!enSolicitud) setPaso({ tipo: "editar" });
    setError(textoError(e, admin, errorPermiso));
  }

  async function guardar(peticion: Peticion): Promise<void> {
    setError(null);
    const noPermitidos = prohibido(peticion.objetos);
    if (noPermitidos.length) {
      setPaso({ tipo: "solicitud", peticion, noPermitidos, clase: "cambio" });
      return;
    }
    setPaso({ tipo: "guardando" });
    try {
      const r = await aplicarCambio(peticion);
      setPaso({ tipo: "hecho", marcado: r.estado === "marcado" });
    } catch (e) {
      await trasFallo(e, peticion, false);
    }
  }

  /** Desde la pantalla de la solicitud. */
  const solicitud = {
    enviando,
    volver: () => {
      setError(null);
      setPaso({ tipo: "editar" });
    },
    enviar: async (motivo: string) => {
      if (paso.tipo !== "solicitud") return;
      const peticion = { ...paso.peticion, motivo: motivo.trim() };
      setError(null);
      setEnviando(true);
      try {
        const id = await enviarSolicitud(paso.clase, peticion);
        setPaso({ tipo: "hecho", marcado: false, solicitud: id });
      } catch (e) {
        await trasFallo(e, peticion, true);
      } finally {
        setEnviando(false);
      }
    },
  };

  return { paso, setPaso, error, guardar, solicitud };
}

// ---- Solicitudes (paso 12) ----

/** La pantalla de la solicitud: por qué no se puede guardar, el motivo
 * (obligatorio, DA-18 a) y «Enviar solicitud». `motivo`, el que se haya
 * escrito ya en el formulario. */
export function PantallaSolicitud({ paso, motivo, error, solicitud }: {
  paso: Extract<Paso, { tipo: "solicitud" }>;
  motivo: string;
  error: string | null;
  solicitud: ReturnType<typeof useGuardado>["solicitud"];
}) {
  const arbol = useArbol();
  const [texto, setTexto] = useState(motivo);
  const lineas = useMemo(
    () => new Descripcion(arbol, cambiosDePeticion(arbol, paso.peticion.objetos), paso.noPermitidos).razones(),
    [arbol, paso],
  );
  return (
    <Stack>
      <Alert color="yellow" title={t("solicitud.titulo")}>
        <Stack gap="xs">
          {lineas.length > 0 && <Text size="sm">{t("solicitud.porque")}</Text>}
          {lineas.length > 0 && <List size="sm">{lineas.map((l) => <List.Item key={l}>{l}</List.Item>)}</List>}
          <Text size="sm">{t("solicitud.ayuda")}</Text>
        </Stack>
      </Alert>
      <CampoMotivo valor={texto} alCambiar={setTexto} obligatorio />
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end">
        <Button variant="default" onClick={solicitud.volver} disabled={solicitud.enviando}>{t("solicitud.volver")}</Button>
        <Button onClick={() => solicitud.enviar(texto)} disabled={!texto.trim()} loading={solicitud.enviando}>{t("solicitud.enviar")}</Button>
      </Group>
    </Stack>
  );
}

/** Corrección del administrador (paso 13; diseño, 5.4): la página del
 * formulario abierta con `?corrige=c0000123` guarda la corrección de ese
 * cambio. El cambio que se corrige y el aviso de arriba (para los demás,
 * nada). Y «Modificar y aplicar» una solicitud (paso 14), con
 * `?resuelve=s0000012`: lo que se pidió, a la vista (PropuestaALaVista). */
export function useCorreccion(): { corrige: string | null; resuelve: string | null; aviso: ReactNode } {
  const [params] = useSearchParams();
  const admin = useSesion().invitacion.rol === "administrador";
  const id = params.get("corrige");
  const corrige = admin && id && /^c\d{7}$/.test(id) ? id : null;
  const s = params.get("resuelve");
  const resuelve = admin && !corrige && s && /^s\d{7}$/.test(s) ? s : null;
  if (resuelve) return { corrige, resuelve, aviso: <PropuestaALaVista id={resuelve} /> };
  return {
    corrige,
    resuelve,
    aviso: corrige && (
      <Alert color="blue">
        {t("registro.corrigiendo", { id: corrige })}{" "}
        <Anchor component={Link} to={`/cambios/${corrige}`} inherit>{t("registro.verCambio")}</Anchor>
      </Alert>
    ),
  };
}

/** Aviso arriba de un formulario en modo propuesta (ficha fuera de la
 * rama). */
export function AvisoPropuesta() {
  if (!useModoPropuesta()) return null;
  return <Alert color="yellow">{t("solicitud.avisoPropuesta")}</Alert>;
}

// ---- Ventana ----

/** Dónde dice el formulario si tiene cambios sin guardar. */
const ContextoSinGuardar = createContext<{ current: boolean } | null>(null);

/** El formulario de dentro de una `VentanaFormulario` dice si tiene
 * cambios sin guardar. */
export function useSinGuardar(sinGuardar: boolean) {
  const ref = useContext(ContextoSinGuardar);
  useEffect(() => {
    if (!ref) return;
    ref.current = sinGuardar;
    return () => { ref.current = false; };
  }, [ref, sinGuardar]);
}

/** La ventana de un formulario. Cerrarla con la X, Escape o pulsando fuera
 * con cambios sin guardar pregunta antes (decisión de Carlos del
 * 26/10/2026); «Cancelar» cierra sin preguntar. */
export function VentanaFormulario({ abierta, alCerrar, titulo, movil, zIndex, grande = false, children }: {
  abierta: boolean;
  alCerrar: () => void;
  titulo: ReactNode;
  movil: boolean;
  zIndex?: number;
  /** Más ancha (el formulario de persona). */
  grande?: boolean;
  children: ReactNode;
}) {
  const sinGuardar = useRef(false);
  const [preguntando, setPreguntando] = useState(false);
  return (
    <ContextoSinGuardar.Provider value={sinGuardar}>
      <Modal
        opened={abierta}
        onClose={() => (sinGuardar.current ? setPreguntando(true) : alCerrar())}
        title={titulo}
        size={grande ? "xl" : "lg"}
        fullScreen={movil}
        zIndex={zIndex}
      >
        {children}
      </Modal>
      <Modal opened={preguntando} onClose={() => setPreguntando(false)} title={t("formulario.sinGuardarTitulo")} zIndex={400} centered>
        <Stack>
          <Text>{t("formulario.sinGuardar")}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPreguntando(false)}>{t("formulario.seguirEditando")}</Button>
            <Button color="red" onClick={() => { setPreguntando(false); sinGuardar.current = false; alCerrar(); }}>{t("formulario.cerrarSinGuardar")}</Button>
          </Group>
        </Stack>
      </Modal>
    </ContextoSinGuardar.Provider>
  );
}

/** «Rótulo: antes → después», con «sin datos» si falta. */
export const lineaCambio = (rotulo: string, antes: string, despues: string) =>
  `${rotulo}: ${antes || t("ficha.sinDatos")} → ${despues || t("ficha.sinDatos")}`;

export function Hecho({ marcado, solicitud, alCerrar }: { marcado: boolean; solicitud?: string; alCerrar: () => void }) {
  if (solicitud) {
    return (
      <Stack>
        <Alert variant="light" color="green" title={t("solicitud.enviada")}>
          {t("solicitud.enviadaAyuda")}{" "}
          <Anchor component={Link} to={`/solicitudes/${solicitud}`}>{t("solicitud.verSolicitud")}</Anchor>
        </Alert>
        <Group justify="flex-end"><Button onClick={alCerrar}>{t("formulario.cerrar")}</Button></Group>
      </Stack>
    );
  }
  return (
    <Stack>
      <Alert variant="light" color="green" title={t("formulario.guardado")}>
        {marcado && t("formulario.guardadoMarcado")}
      </Alert>
      <Group justify="flex-end"><Button onClick={alCerrar}>{t("formulario.cerrar")}</Button></Group>
    </Stack>
  );
}

/** El conflicto (DA-14 a): qué ha cambiado y, si se puede, volver a aplicar
 * los cambios propios sobre la versión nueva. `lineas`: lo que ha cambiado
 * en los campos del formulario (null si se ha borrado algo). */
export function Conflicto({ titulo, lineas, otros, alDescartar, alVolverAAplicar }: {
  titulo: string;
  lineas: string[] | null;
  /** Si no ha cambiado nada de lo que se ve, qué decir. */
  otros: string;
  alDescartar: () => void;
  alVolverAAplicar: () => void;
}) {
  return (
    <Stack>
      <Alert color="yellow" title={titulo}>
        <Stack gap="xs">
          <Text size="sm">{lineas ? t("formulario.conflictoAyuda") : t("formulario.conflictoBorrado")}</Text>
          {lineas && (lineas.length
            ? <List size="sm">{lineas.map((l, i) => <List.Item key={i}>{l}</List.Item>)}</List>
            : <Text size="sm">{otros}</Text>)}
        </Stack>
      </Alert>
      <Group justify="flex-end">
        <Button variant="default" onClick={alDescartar}>{t("formulario.descartar")}</Button>
        {lineas && <Button onClick={alVolverAAplicar}>{t("formulario.volverAAplicar")}</Button>}
      </Group>
    </Stack>
  );
}

export function CampoMotivo({ valor, alCambiar, obligatorio = false }: { valor: string; alCambiar: (v: string) => void; obligatorio?: boolean }) {
  return (
    <Textarea
      label={t("formulario.motivo")}
      description={t(obligatorio ? "solicitud.motivoAyuda" : "formulario.motivoAyuda")}
      withAsterisk={obligatorio}
      value={valor}
      onChange={(e) => alCambiar(e.currentTarget.value)}
      autosize
      minRows={2}
      maxLength={2000}
    />
  );
}

/** Pie del formulario: el error del último intento, «Cancelar» y
 * «Guardar» (u otro rótulo, como «Usar este lugar» en un borrador). Con
 * `arriba`, los mismos botones al principio: en una página, en una barra
 * fija bajo la cabecera, siempre a la vista (y con el error, que así se ve
 * desde cualquier sitio; abajo, entonces, sin él); en una ventana, solo los
 * botones. */
export function PieEditar({ alCancelar, alGuardar, puedeGuardar, guardando = false, error = null, rotulo, aviso, arriba }: {
  alCancelar: () => void;
  alGuardar: () => void;
  puedeGuardar: boolean;
  guardando?: boolean;
  error?: string | null;
  rotulo?: ReactNode;
  /** Por qué aún no se puede guardar (fotos subiéndose). */
  aviso?: string | null;
  arriba?: "pagina" | "ventana";
}) {
  const propuesta = useModoPropuesta();
  const botones = (
    <Group justify="flex-end">
      <Button variant="default" onClick={alCancelar} disabled={guardando}>{t("formulario.cancelar")}</Button>
      <Button onClick={alGuardar} disabled={!puedeGuardar} loading={guardando}>{rotulo ?? t(propuesta ? "solicitud.proponer" : "formulario.guardar")}</Button>
    </Group>
  );
  if (arriba === "ventana") return botones;
  const contenido = (
    <Stack gap="sm">
      {error && <Alert color="red">{error}</Alert>}
      {aviso && <Text size="sm" c="dimmed" ta="right">{aviso}</Text>}
      {botones}
    </Stack>
  );
  if (!arriba) return contenido;
  return (
    <Box
      py="xs"
      style={{
        position: "sticky",
        top: "var(--app-shell-header-offset, 0rem)",
        zIndex: 90,
        background: "var(--mantine-color-body)",
        borderBottom: "1px solid var(--mantine-color-default-border)",
      }}
    >
      {contenido}
    </Box>
  );
}

// ---- Tipos ----

// El tipo de un nombre escrito, en su propio módulo (sin Firebase, para las
// pruebas).
export { tipoDe } from "./tipoDe";

/** Los nombres que se ofrecen para una clase de tipo: los de serie, todos
 * los del catálogo de esa clase (aunque nadie los use todavía; 31/10/2026) y
 * los propios del árbol, en el idioma de la web y por orden alfabético. */
export function useNombresTipo(clase: string): string[] {
  const arbol = useArbol();
  return useMemo(() => {
    const nombres = new Set(valoresTipo(clase).map((x) => x.nombre));
    const propio = (string: string) => nombreTipo({ _class: clase, value: valorPersonalizado(clase), string });
    for (const e of entradasClase(clase)) nombres.add(propio(MARCA_CODIGO + e.codigo));
    for (const s of arbol.tiposPropios(clase)) nombres.add(esCodigo(s) ? propio(s) : s);
    return [...nombres].sort(comparador.compare);
  }, [arbol, clase]);
}

/** Selector de tipo: se elige de la lista o se escribe uno nuevo. El del
 * administrador se guarda; el de los demás va como solicitud (paso 12;
 * respuesta de Carlos del 28/10/2026). `valor`, el nombre del tipo. */
export function SelectorTipo({ clase, label, valor, alCambiar, sinRotulo = false, resaltado = false }: {
  clase: string;
  label: string;
  valor: string;
  alCambiar: (v: string) => void;
  /** Sin rótulo a la vista (en una columna de una lista, que lo lleva
   * arriba); `label` queda para los lectores de pantalla. */
  sinRotulo?: boolean;
  /** Con un fondo suave, para que se vea un valor poco habitual. */
  resaltado?: boolean;
}) {
  const rotulo = {
    ...(sinRotulo ? { "aria-label": label } : { label }),
    styles: resaltado ? { input: { background: color("teja-claro") } } : undefined,
  };
  const admin = useSesion().invitacion.rol === "administrador";
  const nombres = useNombresTipo(clase);
  // El que tiene el objeto, aunque no esté en la lista, se puede conservar.
  const [inicial] = useState(valor);
  const datos = useMemo(() => (inicial && !nombres.includes(inicial) ? [inicial, ...nombres] : nombres), [inicial, nombres]);
  const nuevo = valor.trim() && !datos.some((n) => normalizar(n) === normalizar(valor));
  // Al pinchar, la lista entera; solo filtra lo que se escribe después.
  const [escrito, setEscrito] = useState(false);
  const eligiendo = useRef(false);
  return (
    <Autocomplete
      {...rotulo}
      data={datos}
      value={valor}
      onChange={(v) => { setEscrito(!eligiendo.current); eligiendo.current = false; alCambiar(v); }}
      onFocus={() => setEscrito(false)}
      onOptionSubmit={() => { eligiendo.current = true; }}
      filter={escrito ? undefined : ({ options }) => options}
      limit={escrito ? 60 : undefined}
      error={!valor.trim() ? t("formulario.faltaTipo") : undefined}
      description={nuevo ? t(admin ? "formulario.tipoNuevoAdmin" : "formulario.tipoNuevo", { texto: valor.trim() }) : undefined}
    />
  );
}

// ---- Páginas de formulario ----

/** Aviso al salir de una página de formulario (persona, familia) con
 * cambios sin guardar, como al cerrar una ventana de formulario (decisión
 * del 26/10/2026): por un enlace de la web, pregunta; al cerrar o recargar
 * la pestaña, el aviso del navegador. `salir` va a otra página sin
 * preguntar («Cancelar», o tras guardar). */
export function useAvisoAlSalir(activo: boolean): { aviso: ReactNode; salir: (ruta: string) => void } {
  const navegar = useNavigate();
  const activoRef = useRef(activo);
  activoRef.current = activo;
  const bloqueo = useBlocker(({ currentLocation, nextLocation }) => activoRef.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!activo) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [activo]);
  const aviso = (
    <Modal opened={bloqueo.state === "blocked"} onClose={() => bloqueo.reset?.()} title={t("formulario.sinGuardarTitulo")} zIndex={400} centered>
      <Stack>
        <Text>{t("formulario.sinGuardar")}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => bloqueo.reset?.()}>{t("formulario.seguirEditando")}</Button>
          <Button color="red" onClick={() => bloqueo.proceed?.()}>{t("formulario.salirSinGuardar")}</Button>
        </Group>
      </Stack>
    </Modal>
  );
  return {
    aviso,
    salir: (ruta) => {
      activoRef.current = false;
      navegar(ruta);
    },
  };
}
