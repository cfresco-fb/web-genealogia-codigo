// Listas de personas, familias, eventos, lugares y multimedia.

import { useCallback, useMemo, useState } from "react";
import { Button, Group, NumberInput, Select, Text } from "@mantine/core";
import { useNavigate } from "react-router";
import { useSesion } from "../acceso/sesion";
import { useArbol } from "../arbol/contexto";
import { anio, textoFecha, valorOrden } from "../arbol/fechas";
import { descripcionFoto, type FechaVital } from "../arbol/arbol";
import type { Familia, Lugar, Multimedia, Persona } from "../arbol/tipos";
import { Listado, type ColumnaLista } from "../componentes/Listado";
import { FormularioLugar } from "../componentes/diferidos";
import { IconoEditar } from "../componentes/Iconos";
import { ContextoPropuesta, usePermisos } from "../arbol/permisos";
import { Foto, VisorFoto } from "../componentes/Foto";
import { EnlaceLugar, rutaFamilia, rutaPersona } from "../componentes/Enlaces";
import { nombreTipo, t } from "../i18n";

/** El ID de Gramps (columna y filtro), solo para el administrador (decisión
 * del 23/10/2026, «Parejas y cajas: respuestas»). */
const useAdmin = () => useSesion().invitacion.rol === "administrador";
const sinId = <T,>(admin: boolean, columnas: ColumnaLista<T>[]) => (admin ? columnas : columnas.filter((c) => c.clave !== "id"));

/** Fecha de un nacimiento o defunción; en cursiva si es un sustituto
 * (bautismo, entierro…), como en Gramps. */
function FechaVitalCelda({ fv }: { fv: FechaVital | null }) {
  if (!fv) return null;
  const texto = textoFecha(fv.evento.date, "corto");
  return fv.sustituto
    ? <Text span fs="italic" inherit title={t("ficha.sustituto", { tipo: nombreTipo(fv.evento.type) })}>{texto}</Text>
    : <>{texto}</>;
}

/** Filtro de años bajo un solo rótulo («Nacimiento»), con sus casillas
 * «desde» y «hasta» debajo (decisión del 24/10/2026, «Diseño visual»). */
function RangoAnios({ id, rotulo, desde, hasta, alCambiarDesde, alCambiarHasta, etiquetaDesde, etiquetaHasta }: {
  id: string;
  rotulo: string;
  desde: Anio;
  hasta: Anio;
  alCambiarDesde: (v: Anio) => void;
  alCambiarHasta: (v: Anio) => void;
  etiquetaDesde: string;
  etiquetaHasta: string;
}) {
  const props = { w: 92, min: -9999, max: 9999, allowDecimal: false, hideControls: true } as const;
  return (
    <div role="group" aria-labelledby={id} title={t("lista.ayudaAnios")}>
      <Text id={id} size="sm" fw={600}>{rotulo}</Text>
      <Group gap={6} wrap="nowrap">
        <NumberInput aria-label={etiquetaDesde} placeholder={t("lista.desde")} value={desde} onChange={alCambiarDesde} {...props} />
        <NumberInput aria-label={etiquetaHasta} placeholder={t("lista.hasta")} value={hasta} onChange={alCambiarHasta} {...props} />
      </Group>
    </div>
  );
}

// ---- Personas ----

interface FilaPersona {
  p: Persona;
  nombre: string;
  nac: FechaVital | null;
  def: FechaVital | null;
  anioNac: number | null;
  anioDef: number | null;
}

type Anio = number | string;
const enRango = (a: number | null, desde: Anio, hasta: Anio) =>
  (desde === "" && hasta === "") ||
  (a !== null && (desde === "" || a >= Number(desde)) && (hasta === "" || a <= Number(hasta)));

export function ListaPersonas() {
  const arbol = useArbol();
  const admin = useAdmin();
  const navegar = useNavigate();
  const [sexo, setSexo] = useState<string>("todos");
  const [nacDesde, setNacDesde] = useState<Anio>("");
  const [nacHasta, setNacHasta] = useState<Anio>("");
  const [defDesde, setDefDesde] = useState<Anio>("");
  const [defHasta, setDefHasta] = useState<Anio>("");

  const filas = useMemo(() => [...arbol.personas.values()].map((p): FilaPersona => {
    const nac = arbol.nacimiento(p);
    const def = arbol.defuncion(p);
    return { p, nombre: arbol.nombreOrden(p), nac, def, anioNac: anio(nac?.evento.date), anioDef: anio(def?.evento.date) };
  }), [arbol]);

  const columnas = useMemo((): ColumnaLista<FilaPersona>[] => sinId<FilaPersona>(admin, [
    { clave: "nombre", etiqueta: t("col.nombre"), ancho: 260, anchoPorTexto: true, celda: (f) => f.nombre, titulo: (f) => f.nombre, valor: (f) => f.nombre },
    { clave: "id", etiqueta: t("col.id"), ancho: 80, celda: (f) => f.p.gramps_id, valor: (f) => f.p.gramps_id },
    { clave: "sexo", etiqueta: t("col.sexo"), ancho: 110, celda: (f) => t(`sexo.${f.p.gender}` as "sexo.0"), valor: (f) => t(`sexo.${f.p.gender}` as "sexo.0") },
    { clave: "nacimiento", etiqueta: t("col.nacimiento"), ancho: 210, celda: (f) => <FechaVitalCelda fv={f.nac} />, valor: (f) => valorOrden(f.nac?.evento.date) },
    { clave: "lugarNac", etiqueta: t("col.lugarNacimiento"), ancho: 220, visible: false, celda: (f) => arbol.tituloLugar(f.nac?.evento.place), titulo: (f) => arbol.tituloLugar(f.nac?.evento.place), valor: (f) => arbol.tituloLugar(f.nac?.evento.place) },
    { clave: "defuncion", etiqueta: t("col.defuncion"), ancho: 210, celda: (f) => <FechaVitalCelda fv={f.def} />, valor: (f) => valorOrden(f.def?.evento.date) },
    { clave: "lugarDef", etiqueta: t("col.lugarDefuncion"), ancho: 220, visible: false, celda: (f) => arbol.tituloLugar(f.def?.evento.place), titulo: (f) => arbol.tituloLugar(f.def?.evento.place), valor: (f) => arbol.tituloLugar(f.def?.evento.place) },
    { clave: "apellidos", etiqueta: t("col.apellidos"), visible: false, celda: (f) => arbol.apellidos(f.p.primary_name), valor: (f) => arbol.apellidos(f.p.primary_name) },
    { clave: "pila", etiqueta: t("col.nombrePila"), visible: false, celda: (f) => f.p.primary_name.first_name, valor: (f) => f.p.primary_name.first_name },
  ]), [arbol, admin]);

  const filtro = useCallback((f: FilaPersona) =>
    (sexo === "todos" || String(f.p.gender) === sexo) &&
    enRango(f.anioNac, nacDesde, nacHasta) &&
    enRango(f.anioDef, defDesde, defHasta),
  [sexo, nacDesde, nacHasta, defDesde, defHasta]);

  const hayFiltros = sexo !== "todos" || [nacDesde, nacHasta, defDesde, defHasta].some((v) => v !== "");
  const limpiar = () => {
    setSexo("todos");
    [setNacDesde, setNacHasta, setDefDesde, setDefHasta].forEach((f) => f(""));
  };

  const controles = (
    <>
      <Select
        label={t("lista.sexo")}
        w={140}
        value={sexo}
        onChange={(v) => setSexo(v ?? "todos")}
        allowDeselect={false}
        data={[
          { value: "todos", label: t("lista.todos") },
          ...["1", "0", "2", "3"].map((v) => ({ value: v, label: t(`sexo.${v}` as "sexo.0") })),
        ]}
      />
      <RangoAnios
        id="filtro-nacimiento"
        rotulo={t("lista.nacimiento")}
        desde={nacDesde}
        hasta={nacHasta}
        alCambiarDesde={setNacDesde}
        alCambiarHasta={setNacHasta}
        etiquetaDesde={t("lista.nacimientoDesde")}
        etiquetaHasta={t("lista.nacimientoHasta")}
      />
      <RangoAnios
        id="filtro-defuncion"
        rotulo={t("lista.defuncion")}
        desde={defDesde}
        hasta={defHasta}
        alCambiarDesde={setDefDesde}
        alCambiarHasta={setDefHasta}
        etiquetaDesde={t("lista.defuncionDesde")}
        etiquetaHasta={t("lista.defuncionHasta")}
      />
    </>
  );

  return (
    <Listado
      clave="personas"
      titulo={t("menu.personas")}
      filas={filas}
      columnas={columnas}
      claveFila={(f) => f.p.handle}
      texto={(f) => `${f.nombre}${admin ? ` ${f.p.gramps_id}` : ""}`}
      ordenInicial={{ columna: "nombre", direccion: "asc" }}
      alPulsar={(f) => navegar(rutaPersona(f.p.handle))}
      controles={controles}
      filtro={filtro}
      hayFiltros={hayFiltros}
      alLimpiarFiltros={limpiar}
    />
  );
}

// ---- Familias ----

const TIPO_MATRIMONIO = 1; // EventType.MARRIAGE

export function ListaFamilias() {
  const arbol = useArbol();
  const admin = useAdmin();
  const navegar = useNavigate();
  const filas = useMemo(() => [...arbol.familias.values()].map((f) => ({
    f,
    padre: arbol.padre(f) ? arbol.nombreOrden(arbol.padre(f)!) : "",
    madre: arbol.madre(f) ? arbol.nombreOrden(arbol.madre(f)!) : "",
    matrimonio: arbol.eventosFamilia(f).find((e) => e.evento.type.value === TIPO_MATRIMONIO)?.evento ?? null,
  })), [arbol]);
  type Fila = (typeof filas)[number];

  const columnas = useMemo((): ColumnaLista<Fila>[] => sinId<Fila>(admin, [
    { clave: "padre", etiqueta: t("col.padre"), ancho: 240, anchoPorTexto: true, celda: (x) => x.padre, titulo: (x) => x.padre, valor: (x) => x.padre },
    { clave: "madre", etiqueta: t("col.madre"), ancho: 240, anchoPorTexto: true, celda: (x) => x.madre, titulo: (x) => x.madre, valor: (x) => x.madre },
    { clave: "id", etiqueta: t("col.id"), ancho: 80, celda: (x) => x.f.gramps_id, valor: (x) => x.f.gramps_id },
    { clave: "relacion", etiqueta: t("col.relacion"), ancho: 130, celda: (x) => nombreTipo(x.f.type), valor: (x) => nombreTipo(x.f.type) },
    { clave: "matrimonio", etiqueta: t("col.matrimonio"), ancho: 170, celda: (x) => textoFecha(x.matrimonio?.date, "corto"), valor: (x) => valorOrden(x.matrimonio?.date) },
    { clave: "lugar", etiqueta: t("col.lugar"), ancho: 220, visible: false, celda: (x) => arbol.tituloLugar(x.matrimonio?.place), valor: (x) => arbol.tituloLugar(x.matrimonio?.place) },
    { clave: "hijos", etiqueta: t("col.hijos"), ancho: 80, celda: (x) => x.f.child_ref_list.length, valor: (x) => x.f.child_ref_list.length },
  ]), [arbol, admin]);

  return (
    <Listado
      clave="familias"
      titulo={t("menu.familias")}
      filas={filas}
      columnas={columnas}
      claveFila={(x) => x.f.handle}
      texto={(x) => `${x.padre} ${x.madre}${admin ? ` ${x.f.gramps_id}` : ""}`}
      ordenInicial={{ columna: "padre", direccion: "asc" }}
      alPulsar={(x) => navegar(rutaFamilia(x.f.handle))}
    />
  );
}

// ---- Eventos ----

export function ListaEventos() {
  const arbol = useArbol();
  const admin = useAdmin();
  const navegar = useNavigate();
  const filas = useMemo(() => [...arbol.eventos.values()].map((e) => {
    const participantes = arbol.participantes(e);
    return {
      e,
      tipo: nombreTipo(e.type),
      fecha: textoFecha(e.date, "corto"),
      lugar: arbol.tituloLugar(e.place),
      participantes,
      nombres: participantes.map(({ tipo, objeto }) =>
        tipo === "Person" ? arbol.nombre(objeto as Persona) : arbol.nombreFamilia(objeto as Familia)).join("; "),
    };
  }), [arbol]);
  type Fila = (typeof filas)[number];

  const columnas = useMemo((): ColumnaLista<Fila>[] => sinId<Fila>(admin, [
    { clave: "tipo", etiqueta: t("col.tipo"), ancho: 150, celda: (x) => x.tipo, valor: (x) => x.tipo },
    { clave: "participantes", etiqueta: t("col.participantes"), ancho: 260, anchoPorTexto: true, celda: (x) => x.nombres, titulo: (x) => x.nombres, valor: (x) => x.nombres },
    { clave: "fecha", etiqueta: t("col.fecha"), ancho: 170, celda: (x) => x.fecha, valor: (x) => valorOrden(x.e.date) },
    { clave: "lugar", etiqueta: t("col.lugar"), ancho: 240, celda: (x) => x.lugar, titulo: (x) => x.lugar, valor: (x) => x.lugar },
    { clave: "descripcion", etiqueta: t("col.descripcion"), ancho: 260, celda: (x) => x.e.description, titulo: (x) => x.e.description, valor: (x) => x.e.description },
    { clave: "id", etiqueta: t("col.id"), ancho: 80, celda: (x) => x.e.gramps_id, valor: (x) => x.e.gramps_id },
  ]), [admin]);

  return (
    <Listado
      clave="eventos"
      titulo={t("menu.eventos")}
      filas={filas}
      columnas={columnas}
      claveFila={(x) => x.e.handle}
      texto={(x) => `${x.tipo} ${x.nombres} ${x.fecha} ${x.lugar} ${x.e.description}${admin ? ` ${x.e.gramps_id}` : ""}`}
      ordenInicial={{ columna: "fecha", direccion: "asc" }}
      alPulsar={(x) => {
        // Abre la ficha del primer participante (persona o familia).
        const p = x.participantes[0];
        if (p) navegar(p.tipo === "Person" ? rutaPersona(p.objeto.handle) : rutaFamilia(p.objeto.handle));
      }}
    />
  );
}

// ---- Lugares ----

export function ListaLugares() {
  const arbol = useArbol();
  const admin = useAdmin();
  const { puede } = usePermisos();
  // Formulario abierto: un lugar que se corrige o «nuevo».
  const [editando, setEditando] = useState<Lugar | "nuevo" | null>(null);
  const filas = useMemo(() => [...arbol.lugares.values()].map((l) => ({
    l, titulo: arbol.tituloLugar(l.handle), superior: arbol.lugarSuperior(l), tipo: nombreTipo(l.place_type),
  })), [arbol]);
  type Fila = { l: Lugar; titulo: string; superior: string; tipo: string };

  const columnas = useMemo((): ColumnaLista<Fila>[] => sinId<Fila>(admin, [
    // El nombre, enlazado a la ficha del lugar (añadidos del mapa, 02/11/2026).
    { clave: "nombre", etiqueta: t("col.nombre"), ancho: 200, celda: (x) => <EnlaceLugar handle={x.l.handle} texto={x.l.name.value} />, valor: (x) => x.l.name.value },
    { clave: "tipo", etiqueta: t("col.tipo"), ancho: 130, celda: (x) => x.tipo, valor: (x) => x.tipo },
    { clave: "superior", etiqueta: t("col.lugarSuperior"), ancho: 260, celda: (x) => x.superior, titulo: (x) => x.superior, valor: (x) => x.superior },
    { clave: "titulo", etiqueta: t("col.titulo"), ancho: 320, visible: false, celda: (x) => x.titulo, titulo: (x) => x.titulo, valor: (x) => x.titulo },
    { clave: "id", etiqueta: t("col.id"), ancho: 80, celda: (x) => x.l.gramps_id, valor: (x) => x.l.gramps_id },
    { clave: "lat", etiqueta: t("col.latitud"), ancho: 110, visible: false, celda: (x) => x.l.lat, valor: (x) => x.l.lat },
    { clave: "long", etiqueta: t("col.longitud"), ancho: 110, visible: false, celda: (x) => x.l.long, valor: (x) => x.l.long },
    {
      // Los lugares que no puede corregir, para proponer el cambio (paso 12).
      clave: "editar", etiqueta: t("editar.boton"), ancho: 170, siempre: true,
      celda: (x) => (
        <Button size="xs" variant="default" leftSection={<IconoEditar />} onClick={() => setEditando(x.l)}
          aria-label={t("lugar.editarDe", { nombre: x.l.name.value })}>
          {t(puede("Place", x.l.handle).ok ? "editar.boton" : "solicitud.proponer")}
        </Button>
      ),
    },
  ]), [admin, puede]);

  return (
    <Listado
      clave="lugares"
      titulo={t("menu.lugares")}
      filas={filas}
      columnas={columnas}
      claveFila={(x) => x.l.handle}
      texto={(x) => `${x.titulo} ${x.l.alt_names.map((n) => n.value).join(" ")}${admin ? ` ${x.l.gramps_id}` : ""}`}
      ordenInicial={{ columna: "nombre", direccion: "asc" }}
      controles={<Button variant="default" onClick={() => setEditando("nuevo")}>{t("lugar.nuevo")}</Button>}
      pie={(
        <ContextoPropuesta.Provider value={!!editando && editando !== "nuevo" && !puede("Place", editando.handle).ok}>
          <FormularioLugar
            abierto={!!editando}
            lugar={editando === "nuevo" ? null : editando && (arbol.lugares.get(editando.handle) ?? null)}
            alCerrar={() => setEditando(null)}
          />
        </ContextoPropuesta.Provider>
      )}
    />
  );
}

// ---- Multimedia ----

const ALTO_MINIATURA = 64;

export function ListaMultimedia() {
  const arbol = useArbol();
  const admin = useAdmin();
  const [abierta, setAbierta] = useState<Multimedia | null>(null);
  const filas = useMemo(() => [...arbol.multimedia.values()], [arbol]);

  const columnas = useMemo((): ColumnaLista<Multimedia>[] => sinId<Multimedia>(admin, [
    { clave: "vista", etiqueta: t("col.vista"), ancho: 90, celda: (m) => arbol.esImagen(m) ? <Foto media={m} tam={ALTO_MINIATURA - 6} /> : null },
    { clave: "descripcion", etiqueta: t("col.descripcion"), ancho: 300, celda: (m) => descripcionFoto(m), titulo: (m) => descripcionFoto(m), valor: (m) => descripcionFoto(m) },
    { clave: "id", etiqueta: t("col.id"), ancho: 80, celda: (m) => m.gramps_id, valor: (m) => m.gramps_id },
    { clave: "fecha", etiqueta: t("col.fecha"), ancho: 150, celda: (m) => textoFecha(m.date, "corto"), valor: (m) => valorOrden(m.date) },
    { clave: "mime", etiqueta: t("col.tipoMime"), ancho: 130, celda: (m) => m.mime, valor: (m) => m.mime },
    { clave: "ruta", etiqueta: t("col.ruta"), ancho: 260, visible: false, celda: (m) => m.path, titulo: (m) => m.path, valor: (m) => m.path },
  ]), [arbol, admin]);

  return (
    <>
      <Listado
        clave="multimedia"
        titulo={t("menu.multimedia")}
        filas={filas}
        columnas={columnas}
        claveFila={(m) => m.handle}
        // Sin la ruta ni una descripción que lo sea (30/10/2026).
        texto={(m) => `${descripcionFoto(m)}${admin ? ` ${m.gramps_id}` : ""}`}
        ordenInicial={{ columna: "descripcion", direccion: "asc" }}
        alPulsar={(m) => arbol.esImagen(m) && setAbierta(m)}
        altoFila={ALTO_MINIATURA}
      />
      <VisorFoto media={abierta} alCerrar={() => setAbierta(null)} />
    </>
  );
}

