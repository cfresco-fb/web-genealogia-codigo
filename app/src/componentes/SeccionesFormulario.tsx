// Secciones que comparten los formularios de persona y familia (fase 3, paso
// 10; docs/edicion.md, «Formularios de persona y familia»): eventos con su
// papel, atributos, notas y galería. Todo son borradores: nada se guarda
// hasta el «Guardar» de la persona o la familia, que lo manda junto
// (`objetosBorradores`).
//
// Quitar un evento o una nota (decisión del 27/10/2026), o una foto (desde
// el 29/10/2026): si solo lo tiene esta ficha, se borra (para que no quede
// suelto); si lo tienen otras, se dice cuáles y se elige: quitarlo solo de
// esta, o de todas, y entonces se borra. Al borrar un evento o una foto,
// también sus notas que no usa nadie más. Los ficheros de una foto borrada
// se borran de Storage pasados 30 días (regeneración nocturna).

import { useEffect, useRef, useState } from "react";
import { Button, Center, Group, List, Loader, Modal, Paper, Stack, Text, TextInput } from "@mantine/core";
import { TIPOS_FOTO } from "../../../comun/fotos.ts";
import { plantilla } from "../../../comun/esquema.ts";
import { nuevoHandle, type ObjetoGramps } from "../../../comun/gramps.ts";
import { useSesion } from "../acceso/sesion";
import { descripcionFoto } from "../arbol/arbol";
import { useArbol } from "../arbol/contexto";
import { otrosQueUsan, type Borradores, type Quitable, type Usuario } from "../arbol/edicionFichas";
import { ordenPorFecha, textoFecha } from "../arbol/fechas";
import { completarFecha } from "../arbol/leerFecha";
import { usePermisos } from "../arbol/permisos";
import type { Base, EventRef, Evento, Familia, Lugar, MediaRef, Multimedia, Nota, Persona } from "../arbol/tipos";
import { DateInput } from "../gramps-connect/formularios/DateInput";
import { RecordPicker } from "../gramps-connect/formularios/RecordPicker";
import type { GrampsDate } from "../gramps-connect/gramps-date";
import { nombreTipo, t, type TipoGramps } from "../i18n";
import { SelectorTipo, tipoDe } from "./Formulario";
import { FormularioEvento } from "./FormularioEvento";
import { tituloBorrador } from "./FormularioLugar";
import { FormularioNota, type DuenioNota } from "./FormularioNota";
import { Foto } from "./Foto";
import { ListaEditable } from "./ListaEditable";
import { descargarApartada } from "../firebase";
import { empezarSubida, reintentarSubida, usarApartada, useSubida } from "../subidas";
import { VentanaFoto, type FotoAbierta } from "./VentanaFoto";

/** Nombre de una ficha que usa algo, para los avisos. */
export function nombreUsuario(arbol: ReturnType<typeof useArbol>, r: Usuario): string {
  if (!r.objeto) return t("formulario.otroTipo");
  if (r.tipo === "Person") return arbol.nombre(r.objeto as Persona);
  if (r.tipo === "Family") return t("formulario.laFamilia", { nombre: arbol.nombreFamilia(r.objeto as Familia) });
  if (r.tipo === "Event") return t("formulario.elEvento", { tipo: nombreTipo((r.objeto as Evento).type) });
  return r.objeto.gramps_id;
}

/** Al quitar un evento, una nota o una foto del árbol: si lo tienen otras
 * fichas, pregunta si solo de esta o de todas (y entonces se borra). */
export function useQuitar(duenio: string, borradores: Borradores, alCambiarBorradores: (b: Borradores) => void) {
  const arbol = useArbol();
  const { puede } = usePermisos();
  const [preguntando, setPreguntando] = useState<{ tipo: Quitable; handle: string; quitar: () => void } | null>(null);
  const marcar = (tipo: Quitable, handle: string, todos: boolean) => {
    const quitados = new Map(borradores.quitados);
    quitados.set(handle, { tipo, todos });
    alCambiarBorradores({ ...borradores, quitados });
  };
  /** Quitar `handle` de la ficha (`quitar` lo quita de su lista). */
  const quitarDe = (tipo: Quitable, handle: string, quitar: () => void) => {
    if (!(tipo === "Event" ? arbol.eventos : tipo === "Note" ? arbol.notas : arbol.multimedia).has(handle)) return quitar();
    if (!otrosQueUsan(arbol, tipo, handle, duenio).length) {
      marcar(tipo, handle, true);
      return quitar();
    }
    setPreguntando({ tipo, handle, quitar });
  };
  /** Vuelve a la ficha algo que se había quitado. */
  const devolver = (handle: string) => {
    if (!borradores.quitados.has(handle)) return;
    const quitados = new Map(borradores.quitados);
    quitados.delete(handle);
    alCambiarBorradores({ ...borradores, quitados });
  };
  const usan = preguntando ? otrosQueUsan(arbol, preguntando.tipo, preguntando.handle, duenio) : [];
  const noEditables = usan.filter((r) => !r.objeto || !puede(r.tipo, r.handle).ok);
  const dialogo = (
    <Modal opened={!!preguntando} onClose={() => setPreguntando(null)} title={t("formulario.quitarTitulo")} zIndex={400} centered>
      {preguntando && (
        <Stack>
          <Text>{t(preguntando.tipo === "Event" ? "formulario.quitarEventoOtros" : preguntando.tipo === "Note" ? "formulario.quitarNotaOtros" : "formulario.quitarFotoOtros")}</Text>
          <List size="sm">{usan.map((r) => <List.Item key={r.handle}>{nombreUsuario(arbol, r)}</List.Item>)}</List>
          {noEditables.length > 0 && (
            <Text size="sm" c="dimmed">{t("formulario.quitarNoEditables", { nombres: noEditables.map((r) => (r.objeto ? nombreUsuario(arbol, r) : t("formulario.otroTipoMinuscula"))).join(", ") })}</Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPreguntando(null)}>{t("formulario.cancelar")}</Button>
            <Button variant="default" onClick={() => { marcar(preguntando.tipo, preguntando.handle, false); preguntando.quitar(); setPreguntando(null); }}>
              {t("formulario.quitarSoloAqui")}
            </Button>
            <Button color="red" disabled={noEditables.length > 0}
              onClick={() => { marcar(preguntando.tipo, preguntando.handle, true); preguntando.quitar(); setPreguntando(null); }}>
              {t("formulario.quitarDeTodos")}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
  return { quitarDe, devolver, dialogo };
}

export { fotosBorradores, hayBorradores, objetosBorradores, sinBorradores, type Borradores } from "../arbol/edicionFichas";

// ---- Eventos ----

/** Un evento nuevo, vacío, con su handle. */
export function eventoNuevo(): Evento {
  const e = plantilla<Evento & ObjetoGramps>("Event");
  e.handle = nuevoHandle();
  return e;
}

/** Fecha y lugar de un evento a la vista (nacimiento y defunción de una
 * persona nueva, boda de una familia nueva; decisiones del 27/10/2026):
 * crean o cambian ese evento, con el papel `rol`, como borrador, el mismo que
 * sale en «Eventos», donde se puede completar. Si se vacían, el evento nuevo
 * se quita. */
export function EventoRapido({ tipo, rol, primero = false, refs, alCambiarRefs, borradores, alCambiarBorradores }: {
  /** Valor de EventType. */
  tipo: number;
  /** Valor de EventRoleType. */
  rol: number;
  /** Si el evento nuevo va el primero de la lista (si no, al final). */
  primero?: boolean;
  refs: EventRef[];
  alCambiarRefs: (refs: EventRef[]) => void;
  borradores: Borradores;
  alCambiarBorradores: (b: Borradores) => void;
}) {
  const arbol = useArbol();
  const admin = useSesion().invitacion.rol === "administrador";
  const [eligiendo, setEligiendo] = useState(false);
  const [vacio] = useState(() => plantilla<Evento>("Event"));
  const ref = refs.find((r) => r.role.value === rol && borradores.eventos.get(r.ref)?.evento.type.value === tipo);
  const b = ref ? borradores.eventos.get(ref.ref)! : null;
  const ev = b?.evento ?? null;
  const tipoGramps: TipoGramps = { _class: "EventType", value: tipo, string: "" };
  const lugarNuevo = b?.extras.find((o) => o.tipo === "Place" && o.handle === ev?.place);
  const tituloLugar = ev?.place ? (lugarNuevo ? tituloBorrador(arbol, lugarNuevo.despues as never) : arbol.tituloLugar(ev.place)) : "";

  function cambiar(c: Partial<Evento>) {
    const despues: Evento = { ...(ev ?? { ...eventoNuevo(), type: tipoGramps }), ...c };
    const eventos = new Map(borradores.eventos);
    const sinDatos = !textoFecha(despues.date) && !despues.place && !despues.description && !despues.note_list.length;
    if (sinDatos && !arbol.eventos.has(despues.handle)) {
      eventos.delete(despues.handle);
      alCambiarRefs(refs.filter((r) => r.ref !== despues.handle));
    } else {
      eventos.set(despues.handle, { evento: despues, extras: b?.extras ?? [] });
      if (!ref) {
        const nueva = { ...plantilla<EventRef>("EventRef"), ref: despues.handle, role: { _class: "EventRoleType", value: rol, string: "" } };
        alCambiarRefs(primero ? [nueva, ...refs] : [...refs, nueva]);
      }
    }
    alCambiarBorradores({ ...borradores, eventos });
  }

  return (
    <Stack gap={4}>
      <Text fw={600}>{nombreTipo(tipoGramps)}</Text>
      <DateInput label={t("col.fecha")} value={completarFecha((ev ?? vacio).date as GrampsDate)} onChange={(f) => cambiar({ date: f })} />
      <Text size="sm" fw={500} mt={4}>{t("col.lugar")}</Text>
      <Group gap="xs">
        <Text>{tituloLugar || t("ficha.sinDatos")}</Text>
        <Button size="xs" variant="default" onClick={() => setEligiendo((x) => !x)}>{ev?.place ? t("evento.cambiarLugar") : t("evento.elegirLugar")}</Button>
        {ev?.place && <Button size="xs" variant="default" onClick={() => cambiar({ place: "" })}>{t("evento.quitarLugar")}</Button>}
      </Group>
      {eligiendo && (
        <RecordPicker
          tipo="Place"
          placeholder={t("evento.buscarLugar")}
          rotulo={(o: Base) => arbol.tituloLugar(o.handle)}
          conIds={admin}
          alElegir={(o) => { cambiar({ place: o.handle }); setEligiendo(false); }}
        />
      )}
    </Stack>
  );
}

export function SeccionEventos({ refs, alCambiar, borradores, alCambiarBorradores, rolPorDefecto, duenio }: {
  refs: EventRef[];
  alCambiar: (refs: EventRef[]) => void;
  borradores: Borradores;
  alCambiarBorradores: (b: Borradores) => void;
  /** Papel de un evento nuevo: principal en la persona, familia en la
   * familia. */
  rolPorDefecto: number;
  /** La ficha del formulario. */
  duenio: string;
}) {
  const arbol = useArbol();
  const { puede } = usePermisos();
  const admin = useSesion().invitacion.rol === "administrador";
  const [abierto, setAbierto] = useState<Evento | null>(null);
  const [eligiendo, setEligiendo] = useState(false);
  // Al terminar un evento nuevo, añadir su referencia.
  const pendiente = useRef<((ev: Evento) => void) | null>(null);
  const eventoDe = (h: string) => borradores.eventos.get(h)?.evento ?? arbol.eventos.get(h) ?? null;
  const lugarDe = (h: string, ev: Evento) => {
    const nuevo = borradores.eventos.get(h)?.extras.find((o) => o.tipo === "Place" && o.handle === ev.place);
    return nuevo ? tituloBorrador(arbol, nuevo.despues as unknown as Lugar) : arbol.tituloLugar(ev.place);
  };
  // Las notas del evento, también las nuevas o cambiadas en su formulario.
  const notasDe = (h: string, ev: Evento): Nota[] => {
    const extras = borradores.eventos.get(h)?.extras ?? [];
    return ev.note_list
      .map((n) => (extras.find((o) => o.tipo === "Note" && o.handle === n)?.despues as unknown as Nota | undefined) ?? arbol.notas.get(n))
      .filter((n): n is Nota => !!n);
  };
  const editable = (h: string) => !arbol.eventos.has(h) || puede("Event", h).ok;
  const refNueva = (h: string): EventRef => ({ ...plantilla<EventRef>("EventRef"), ref: h, role: { _class: "EventRoleType", value: rolPorDefecto, string: "" } });
  const ya = new Set(refs.map((r) => r.ref));
  const { quitarDe, devolver, dialogo } = useQuitar(duenio, borradores, alCambiarBorradores);

  return (
    <Stack gap="xs">
      <ListaEditable<EventRef>
        elementos={refs}
        alCambiar={alCambiar}
        alQuitar={(r, quitar) => quitarDe("Event", r.ref, quitar)}
        titulo={t("evento.editar")}
        rotuloAnadir={t("evento.nuevo")}
        vacia={t("formulario.sinEventos")}
        // Por fecha, sin cambiar el orden guardado; uno nuevo se añade al
        // final de la lista y se ve en su sitio (decisión del 29/10/2026).
        orden={(rs) => ordenPorFecha(rs.map((r) => eventoDe(r.ref)?.date))}
        editable={(r) => editable(r.ref)}
        alEditar={(r, alTerminar) => {
          if (!r) {
            setAbierto(eventoNuevo());
            pendiente.current = (ev) => alTerminar(refNueva(ev.handle));
          } else if (editable(r.ref)) {
            setAbierto(arbol.eventos.get(r.ref) ?? eventoDe(r.ref));
            pendiente.current = null;
          }
        }}
        resumen={(r) => {
          const ev = eventoDe(r.ref);
          if (!ev) return <Text size="sm" c="dimmed">{r.ref}</Text>;
          return (
            <Stack gap={0}>
              <Text size="sm" fw={600}>{nombreTipo(ev.type)}{admin && ev.gramps_id ? ` [${ev.gramps_id}]` : ""}</Text>
              {/* Sin fecha, lugar ni descripción, solo el tipo (decisión del
                  29/10/2026, «Datos vacíos»). */}
              {[textoFecha(ev.date), lugarDe(r.ref, ev), ev.description].some(Boolean) && (
                <Text size="sm">{[textoFecha(ev.date), lugarDe(r.ref, ev), ev.description].filter(Boolean).join(" · ")}</Text>
              )}
              {notasDe(r.ref, ev).map((n) => (
                <Text key={n.handle} size="sm" pl="md" style={{ whiteSpace: "pre-wrap" }}>
                  <Text span fw={600} inherit>{t("ficha.notaEvento")} </Text>{n.text.string}
                </Text>
              ))}
              {!editable(r.ref) && <Text size="xs" c="dimmed">{t("formulario.eventoNoEditable")}</Text>}
            </Stack>
          );
        }}
        columnas={[{
          rotulo: t("formulario.papel"),
          ayuda: t("formulario.papelAyuda"),
          ancho: 150,
          celda: (r, i) => <PapelEvento rol={r.role} alCambiar={(role) => alCambiar(refs.map((x, j) => (j === i ? { ...x, role } : x)))} />,
        }]}
      />
      <Group>
        <Button size="xs" variant="default" onClick={() => setEligiendo((x) => !x)}>{t("formulario.eventoExistente")}</Button>
      </Group>
      {eligiendo && (
        <RecordPicker
          tipo="Event"
          placeholder={t("formulario.buscarEvento")}
          conIds={admin}
          excluir={ya}
          rotulo={(o: Base) => {
            const e = o as Evento;
            const quien = arbol.participantes(e).map((x) => (x.tipo === "Person" ? arbol.nombre(x.objeto as never) : arbol.nombreFamilia(x.objeto as never)));
            return [nombreTipo(e.type), textoFecha(e.date), arbol.tituloLugar(e.place), quien.join(", ")].filter(Boolean).join(" · ");
          }}
          alElegir={(o) => { devolver(o.handle); alCambiar([...refs, refNueva(o.handle)]); setEligiendo(false); }}
        />
      )}
      {dialogo}
      <FormularioEvento
        evento={abierto}
        zIndex={280}
        alCerrar={() => setAbierto(null)}
        borrador={abierto ? {
          partida: borradores.eventos.get(abierto.handle)?.evento ?? abierto,
          extras: borradores.eventos.get(abierto.handle)?.extras ?? [],
          alTerminar: (evento, extras) => {
            const eventos = new Map(borradores.eventos);
            eventos.set(evento.handle, { evento, extras });
            alCambiarBorradores({ ...borradores, eventos });
            pendiente.current?.(evento);
            pendiente.current = null;
          },
        } : undefined}
      />
    </Stack>
  );
}

/** El papel de la persona o la familia en el evento, en su columna. */
function PapelEvento({ rol, alCambiar }: { rol: TipoGramps; alCambiar: (r: TipoGramps) => void }) {
  const [valor, setValor] = useState(nombreTipo(rol));
  return (
    <SelectorTipo clase="EventRoleType" label={t("formulario.papel")} valor={valor} sinRotulo
      alCambiar={(v) => { setValor(v); if (v.trim()) alCambiar(tipoDe("EventRoleType", v, rol)); }} />
  );
}

// ---- Atributos ----

interface Atributo {
  type: TipoGramps;
  value: string;
  [campo: string]: unknown;
}

export function SeccionAtributos({ lista, alCambiar }: { lista: Atributo[]; alCambiar: (l: Atributo[]) => void }) {
  return (
    <ListaEditable<Atributo>
      elementos={lista}
      alCambiar={alCambiar}
      titulo={t("formulario.atributo")}
      rotuloAnadir={t("formulario.anadirAtributo")}
      vacia={t("formulario.sinAtributos")}
      nuevo={() => plantilla<Atributo>("Attribute")}
      limpiar={(a) => ({ ...a, value: a.value.trim() })}
      valido={(a) => !!a.value && !!nombreTipo(a.type)}
      resumen={(a) => <Text size="sm"><Text span fw={600}>{nombreTipo(a.type)}:</Text> {a.value}</Text>}
      campos={(a, cambiar) => <CamposAtributo valor={a} alCambiar={cambiar} />}
    />
  );
}

function CamposAtributo({ valor, alCambiar }: { valor: Atributo; alCambiar: (a: Atributo) => void }) {
  const [tipo, setTipo] = useState(nombreTipo(valor.type));
  return (
    <Stack gap="sm">
      <SelectorTipo clase="AttributeType" label={t("col.tipo")} valor={tipo}
        alCambiar={(v) => { setTipo(v); alCambiar({ ...valor, type: tipoDe("AttributeType", v, valor.type) }); }} />
      <TextInput label={t("formulario.valor")} value={valor.value} onChange={(e) => alCambiar({ ...valor, value: e.currentTarget.value })} data-autofocus />
    </Stack>
  );
}

// ---- Notas ----

export function SeccionNotas({ lista, alCambiar, borradores, alCambiarBorradores, duenio }: {
  lista: string[];
  alCambiar: (l: string[]) => void;
  borradores: Borradores;
  alCambiarBorradores: (b: Borradores) => void;
  duenio: DuenioNota;
}) {
  const arbol = useArbol();
  const { puede } = usePermisos();
  const [abierta, setAbierta] = useState<Nota | "nueva" | null>(null);
  const { quitarDe, dialogo } = useQuitar(duenio.handle, borradores, alCambiarBorradores);
  const notaDe = (h: string) => borradores.notasCambiadas.get(h) ?? borradores.notasNuevas.find((n) => n.handle === h) ?? arbol.notas.get(h);

  function hecha(n: Nota) {
    if (arbol.notas.has(n.handle)) {
      const notasCambiadas = new Map(borradores.notasCambiadas);
      notasCambiadas.set(n.handle, n);
      alCambiarBorradores({ ...borradores, notasCambiadas });
      return;
    }
    const ya = borradores.notasNuevas.some((x) => x.handle === n.handle);
    alCambiarBorradores({ ...borradores, notasNuevas: ya ? borradores.notasNuevas.map((x) => (x.handle === n.handle ? n : x)) : [...borradores.notasNuevas, n] });
    if (!lista.includes(n.handle)) alCambiar([...lista, n.handle]);
  }

  return (
    <Stack gap="xs">
      {!lista.length && <Text size="sm" c="dimmed">{t("formulario.sinNotas")}</Text>}
      {lista.map((h) => {
        const n = notaDe(h);
        if (!n) return null;
        const editable = !arbol.notas.has(h) || puede("Note", h).ok;
        return (
          <Paper key={h} withBorder p="xs">
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <Stack gap={0} style={{ minWidth: 0 }}>
                <Text size="xs" c="dimmed">{nombreTipo(n.type)}</Text>
                <Text size="sm" style={{ whiteSpace: "pre-wrap" }} lineClamp={3}>{n.text.string}</Text>
              </Stack>
              <Group gap={4} wrap="nowrap">
                {editable && <Button size="xs" variant="default" onClick={() => setAbierta(n)}>{t("editar.boton")}</Button>}
                <Button size="xs" variant="default" onClick={() => quitarDe("Note", h, () => alCambiar(lista.filter((x) => x !== h)))}>{t("lista.quitar")}</Button>
              </Group>
            </Group>
          </Paper>
        );
      })}
      <Group><Button size="xs" variant="default" onClick={() => setAbierta("nueva")}>{t("nota.anadir")}</Button></Group>
      {dialogo}
      <FormularioNota
        abierto={!!abierta}
        nota={abierta === "nueva" ? null : abierta}
        duenio={duenio}
        borrador
        alTerminar={hecha}
        alCerrar={() => setAbierta(null)}
      />
    </Stack>
  );
}

// ---- Galería ----

/** Miniatura y estado de una foto que se está subiendo. */
/** El recuadro de las fotos de la solicitud, para ir a él desde el aviso de
 * arriba del formulario. */
export const ID_FOTOS_SOLICITUD = "fotos-de-la-solicitud";

/** Una foto apartada con una solicitud: el Media y la referencia que se
 * pidieron, y su subida (paso 14). */
export interface FotoApartada {
  media: Multimedia;
  ref: MediaRef;
  subida: string;
  /** Quien la pidió (su carpeta aparte). */
  correo: string;
}

function MiniaturaApartada({ f }: { f: FotoApartada }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let vigente = true;
    let creada: string | null = null;
    descargarApartada(f.correo, f.subida, "pequena")
      .then((b) => { creada = URL.createObjectURL(b); if (vigente) setUrl(creada); }, () => undefined);
    return () => { vigente = false; if (creada) URL.revokeObjectURL(creada); };
  }, [f.correo, f.subida]);
  return (
    <Center w={56} h={56} style={{ flexShrink: 0, borderRadius: "var(--mantine-radius-sm)", overflow: "hidden" }}>
      {url ? <img src={url} alt="" style={{ maxWidth: 56, maxHeight: 56 }} /> : <Loader size="sm" />}
    </Center>
  );
}

function FotoSubiendo({ subida, desc }: { subida: string; desc: string }) {
  const s = useSubida(subida);
  return (
    <Group gap="sm" wrap="nowrap">
      <Center w={56} h={56} style={{ flexShrink: 0, borderRadius: "var(--mantine-radius-sm)", overflow: "hidden" }}>
        {s?.urlPequena ? <img src={s.urlPequena} alt="" style={{ maxWidth: 56, maxHeight: 56 }} /> : <Loader size="sm" />}
      </Center>
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Text size="sm" truncate>{desc || t("foto.sinDescripcion")}</Text>
        {s?.estado === "preparando" && <Text size="xs" c="dimmed">{t("foto.preparando")}</Text>}
        {s?.estado === "subiendo" && <Text size="xs" c="dimmed">{t("foto.subiendo", { n: Math.round(s.progreso * 100) })}</Text>}
        {s?.estado === "lista" && <Text size="xs" c="dimmed">{t("foto.nuevaLista")}</Text>}
        {s?.estado === "error" && (
          <Group gap="xs">
            <Text size="xs" c="red">{t(s.error === "subida" ? "foto.errorSubida" : "foto.noSirve")}</Text>
            {s.error === "subida" && <Button size="compact-xs" variant="default" onClick={() => reintentarSubida(subida)}>{t("foto.reintentar")}</Button>}
          </Group>
        )}
      </Stack>
    </Group>
  );
}

/** Galería de un formulario: enlazar fotos del árbol y subir fotos nuevas
 * (paso 11 b), con el recorte para esta ficha (DF-3 a). Las nuevas son
 * borradores que se guardan con la ficha. */
export function SeccionGaleria({ duenio, lista, alCambiar, borradores, alCambiarBorradores, apartadas = [] }: {
  /** La ficha del formulario (para «Quitar»: si otras usan la foto). */
  duenio: string;
  lista: MediaRef[];
  alCambiar: (l: MediaRef[]) => void;
  borradores: Borradores;
  alCambiarBorradores: (b: Borradores) => void;
  /** «Modificar y aplicar» (paso 14): las fotos de la solicitud, para
   * añadirlas. */
  apartadas?: FotoApartada[];
}) {
  const arbol = useArbol();
  const { invitacion } = useSesion();
  const admin = invitacion.rol === "administrador";
  const [eligiendo, setEligiendo] = useState(false);
  const [abierta, setAbierta] = useState<FotoAbierta | null>(null);
  const alTerminarFoto = useRef<((r: MediaRef) => void) | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const { quitarDe, devolver, dialogo } = useQuitar(duenio, borradores, alCambiarBorradores);
  const ya = new Set(lista.map((r) => r.ref));
  const mediaDe = (h: string) => borradores.fotos.get(h)?.media ?? borradores.fotosCambiadas.get(h) ?? arbol.multimedia.get(h);

  /** Un fichero elegido: empieza a prepararse y subirse, y se abre su
   * ventana. */
  function elegido(fichero: File) {
    const media = { ...plantilla<Multimedia>("Media"), handle: nuevoHandle() };
    const subida = empezarSubida(fichero, invitacion.correo, media.handle);
    alTerminarFoto.current = (r) => alCambiar([...lista, r]);
    setAbierta({ media, ref: { ...plantilla<MediaRef>("MediaRef"), ref: media.handle }, subida });
  }
  /** Una foto de la solicitud: un borrador más, con lo que pidió quien la
   * subió (descripción, fecha, recorte). */
  function anadirApartada(f: FotoApartada) {
    usarApartada(f.subida, f.correo, f.media.handle);
    const fotos = new Map(borradores.fotos);
    fotos.set(f.media.handle, { media: f.media, subida: f.subida });
    alCambiarBorradores({ ...borradores, fotos });
    alCambiar([...lista, f.ref]);
  }
  const porAnadir = apartadas.filter((f) => !ya.has(f.media.handle));
  function fotoHecha(media: Multimedia, r: MediaRef) {
    if (abierta?.subida) {
      const fotos = new Map(borradores.fotos);
      fotos.set(media.handle, { media, subida: abierta.subida });
      alCambiarBorradores({ ...borradores, fotos });
    } else {
      // Una del árbol: si cambian la descripción o la fecha, la foto va en
      // el guardado; si vuelven a ser las de antes, ya no.
      const original = arbol.multimedia.get(media.handle);
      if (original) {
        const fotosCambiadas = new Map(borradores.fotosCambiadas);
        const igual = media.desc === original.desc && JSON.stringify(media.date) === JSON.stringify(original.date);
        if (igual) fotosCambiadas.delete(media.handle);
        else fotosCambiadas.set(media.handle, media);
        alCambiarBorradores({ ...borradores, fotosCambiadas });
      }
    }
    alTerminarFoto.current?.(r);
  }

  return (
    <Stack gap="xs">
      <ListaEditable<MediaRef>
        elementos={lista}
        alCambiar={alCambiar}
        titulo=""
        rotuloAnadir=""
        vacia={t("formulario.sinFotos")}
        ordenar
        alQuitar={(r, quitar) => quitarDe("Media", r.ref, quitar)}
        editable={(r) => { const m = mediaDe(r.ref); return !!m && (borradores.fotos.has(r.ref) || arbol.esImagen(m)); }}
        alEditar={(r, terminar) => {
          const m = r && mediaDe(r.ref);
          if (!r || !m) return;
          alTerminarFoto.current = terminar;
          setAbierta({ media: m, ref: r, subida: borradores.fotos.get(r.ref)?.subida ?? null });
        }}
        resumen={(r) => {
          const nueva = borradores.fotos.get(r.ref);
          const m = mediaDe(r.ref);
          return (
            <Stack gap={2}>
              {nueva ? <FotoSubiendo subida={nueva.subida} desc={nueva.media.desc} /> : (
                <Group gap="sm" wrap="nowrap">
                  {m && arbol.esImagen(m) && <Foto media={m} tam={56} />}
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Text size="sm" truncate>{m ? descripcionFoto(m) : r.ref}</Text>
                  </Stack>
                </Group>
              )}
              {(lista[0] === r || r.rect) && (
                <Text size="xs" c="dimmed">
                  {[lista[0] === r && t("formulario.fotoPrincipal"), r.rect && t("foto.conRecorte")].filter(Boolean).join(" · ")}
                </Text>
              )}
            </Stack>
          );
        }}
      />
      {porAnadir.length > 0 && (
        <Stack id={ID_FOTOS_SOLICITUD} gap={6} p="xs" style={{ border: "1px dashed var(--mantine-color-default-border)", borderRadius: "var(--mantine-radius-sm)" }}>
          <Text size="sm" fw={600}>{t("solicitud.fotosDeSolicitud")}</Text>
          {porAnadir.map((f) => (
            <Group key={f.media.handle} gap="sm" wrap="nowrap" justify="space-between">
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                <MiniaturaApartada f={f} />
                <Text size="sm" truncate>{f.media.desc || t("foto.sinDescripcion")}</Text>
              </Group>
              <Button size="xs" variant="default" onClick={() => anadirApartada(f)}>{t("solicitud.anadirFoto")}</Button>
            </Group>
          ))}
        </Stack>
      )}
      <Group gap="xs">
        <Button size="xs" variant="default" onClick={() => entrada.current?.click()}>{t("foto.subirBoton")}</Button>
        <Button size="xs" variant="default" onClick={() => setEligiendo((x) => !x)}>{t("formulario.anadirFoto")}</Button>
      </Group>
      <input
        ref={entrada}
        type="file"
        accept={TIPOS_FOTO.join(",")}
        hidden
        data-testid="subir-foto"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) elegido(f);
        }}
      />
      {eligiendo && (
        <RecordPicker
          tipo="Media"
          placeholder={t("formulario.buscarFoto")}
          conIds={admin}
          excluir={ya}
          rotulo={(o: Base) => descripcionFoto(o as Multimedia) || o.gramps_id}
          alElegir={(o) => { devolver(o.handle); alCambiar([...lista, { ...plantilla<MediaRef>("MediaRef"), ref: o.handle }]); setEligiendo(false); }}
        />
      )}
      <Text size="xs" c="dimmed">{t("formulario.fotosAyuda")}</Text>
      <VentanaFoto abierta={abierta} alTerminar={fotoHecha} alCerrar={() => setAbierta(null)} />
      {dialogo}
    </Stack>
  );
}
