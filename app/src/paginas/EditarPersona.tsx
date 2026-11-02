// Formulario de persona (fase 3, paso 10; docs/edicion.md, «Formularios de
// persona y familia»), escrito nuevo con el esquema del de evento (decisión
// del 25/10/2026): nombres (el principal y los otros), sexo, eventos con su
// papel, atributos, direcciones, direcciones web, asociaciones, notas y
// galería (solo enlazar fotos que ya están). Las citas y las ordenanzas SUD
// se conservan tal cual (DA-9). Las familias de la persona no se tocan aquí:
// se cambian desde la familia.
//
// Es una página propia (`/persona/:handle/editar`), en el móvil y en el
// escritorio (decisiones del 24/10/2026 y del 27/10/2026). Todo lo que se
// hace en ella (eventos, notas) son borradores que se guardan con la persona
// en un solo «Guardar». Una persona nueva desde la familia usa el mismo
// formulario en una ventana (`VentanaPersona`), como borrador; en ella, los
// datos principales a la vista (respuesta de Carlos del 27/10/2026): los
// campos del nombre, sin «Editar», y la fecha y el lugar de nacimiento y de
// defunción, que crean esos eventos (`EventoRapido`).

import { useRef, useState } from "react";
import { Anchor, Group, Stack, Text, TextInput, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { Link, useParams } from "react-router";
import { plantilla } from "../../../comun/esquema.ts";
import type { ObjetoGramps } from "../../../comun/gramps.ts";
import type { ObjetoPeticion } from "../../../comun/peticion.ts";
import { useSesion } from "../acceso/sesion";
import { useArbol } from "../arbol/contexto";
import { textoFecha } from "../arbol/fechas";
import { completarFecha } from "../arbol/leerFecha";
import { ContextoPropuesta, usePermisos } from "../arbol/permisos";
import type { Base, Evento, Persona } from "../arbol/tipos";
import { indicesVitales, reaplicar, seccionesCambiadas } from "../arbol/edicionFichas";
import { rutaPersona } from "../componentes/Enlaces";
import { CamposNombre, EditorNombre, limpiarNombre, nombreNuevo, textoNombre, type NombreGramps } from "../componentes/EditorNombre";
import { NoExiste, Seccion, Tarjeta } from "../componentes/Ficha";
import {
  AvisoPropuesta, CampoMotivo, Conflicto, Hecho, PantallaSolicitud, PieEditar, SelectorTipo, tipoDe, useAvisoAlSalir, useCorreccion, useGuardado, useSinGuardar,
  VentanaFormulario,
} from "../componentes/Formulario";
import { ListaEditable } from "../componentes/ListaEditable";
import { useFotosSolicitud } from "../componentes/PropuestaALaVista";
import { SelectorSexo } from "../componentes/PersonaNueva";
import {
  EventoRapido, fotosBorradores, hayBorradores, objetosBorradores, SeccionAtributos, SeccionEventos, SeccionGaleria, SeccionNotas, sinBorradores, type Borradores, type FotoApartada,
} from "../componentes/SeccionesFormulario";
import { DateInput } from "../gramps-connect/formularios/DateInput";
import { useSubidasListas } from "../subidas";
import { RecordPicker } from "../gramps-connect/formularios/RecordPicker";
import type { GrampsDate } from "../gramps-connect/gramps-date";
import { nombreTipo, t, type Clave, type TipoGramps } from "../i18n";

/** La persona completa, con los campos que la web no usa en las fichas. */
type PersonaGramps = Persona & {
  attribute_list: { type: TipoGramps; value: string }[];
  address_list: Direccion[];
  urls: DireccionWeb[];
  person_ref_list: Asociacion[];
};
interface Direccion {
  street: string; locality: string; city: string; county: string; state: string; country: string; postal: string; phone: string;
  date: GrampsDate;
  [campo: string]: unknown;
}
interface DireccionWeb { type: TipoGramps; path: string; desc: string; [campo: string]: unknown }
interface Asociacion { ref: string; rel: string; [campo: string]: unknown }

const ROL_PRINCIPAL = 1;

const ROTULOS: Record<string, Clave> = {
  primary_name: "formulario.nombres", alternate_names: "formulario.nombres", gender: "col.sexo",
  event_ref_list: "ficha.eventos", birth_ref_index: "ficha.eventos", death_ref_index: "ficha.eventos",
  attribute_list: "formulario.atributos", address_list: "formulario.direcciones", urls: "formulario.direccionesWeb",
  person_ref_list: "formulario.asociaciones", note_list: "ficha.notas", media_list: "formulario.fotos",
  family_list: "formulario.familias", parent_family_list: "formulario.familias",
};
const rotulos = () => Object.fromEntries(Object.entries(ROTULOS).map(([k, v]) => [k, t(v)]));

export function EditarPersona() {
  const { handle = "" } = useParams();
  const arbol = useArbol();
  const { puede } = usePermisos();
  const p = arbol.personas.get(handle);
  if (!p) return <NoExiste />;
  // Fuera de la rama: el mismo formulario, para proponer el cambio (paso 12).
  return (
    <ContextoPropuesta.Provider value={!puede("Person", handle).ok}>
      <Contenido key={handle} persona={p} />
    </ContextoPropuesta.Provider>
  );
}

function Contenido({ persona }: { persona: Persona }) {
  const arbol = useArbol();
  const admin = useSesion().invitacion.rol === "administrador";
  const { paso, setPaso, error, guardar, solicitud } = useGuardado("persona.errorPermiso");
  // La versión de la que se parte y cómo va quedando.
  const [base, setBase] = useState(() => persona as PersonaGramps);
  const [p, setP] = useState(() => structuredClone(persona) as PersonaGramps);
  const [borradores, setBorradores] = useState<Borradores>(sinBorradores);
  // Versiones más nuevas que las del árbol de eventos y notas (tras un
  // conflicto).
  const [bases, setBases] = useState(new Map<string, Base>());
  const [motivo, setMotivo] = useState("");
  const correccion = useCorreccion();
  const apartadas = useFotosSolicitud(correccion.resuelve, persona.handle);

  const hayCambios = JSON.stringify(p) !== JSON.stringify(base) || hayBorradores(borradores);
  const { aviso, salir } = useAvisoAlSalir(hayCambios && paso.tipo !== "hecho");
  const fijar = (cambios: Partial<PersonaGramps>) => setP((x) => ({ ...x, ...cambios }));
  const volver = () => salir(rutaPersona(persona.handle));
  const eventoDe = (h: string) => borradores.eventos.get(h)?.evento ?? arbol.eventos.get(h) ?? null;

  const subidasListas = useSubidasListas(fotosBorradores(borradores, p.media_list.map((r) => r.ref)).subidas);

  async function enviar() {
    const despues = { ...p, ...indicesVitales(p, base, eventoDe) };
    const objetos: ObjetoPeticion[] = [
      { tipo: "Person", handle: base.handle, operacion: "modificar", base: base.change, despues: despues as unknown as ObjetoGramps },
      ...objetosBorradores(borradores, despues.event_ref_list.map((r) => r.ref), despues.note_list, arbol, bases, base.handle, despues.media_list.map((r) => r.ref)),
    ];
    const fotos = fotosBorradores(borradores, despues.media_list.map((r) => r.ref), arbol, bases);
    objetos.push(...fotos.objetos);
    await guardar({ accion: "editarPersona", motivo: motivo.trim() || null, objetos, ficheros: fotos.ficheros, corrige: correccion.corrige, resuelve: correccion.resuelve });
  }

  if (paso.tipo === "hecho") {
    return <Stack maw={800}><Hecho marcado={paso.marcado} solicitud={paso.solicitud} alCerrar={volver} /></Stack>;
  }

  if (paso.tipo === "solicitud") {
    return <Stack maw={800}>{aviso}<PantallaSolicitud paso={paso} motivo={motivo} error={error} solicitud={solicitud} /></Stack>;
  }

  if (paso.tipo === "conflicto") {
    const borrada = paso.fichas.some((f) => !f.actual);
    const lineas = borrada ? null : paso.fichas.map((f) => {
      if (f.tipo === "Person") return t("formulario.conflictoSecciones", { secciones: seccionesCambiadas(base, f.actual!, rotulos()).join(", ") });
      if (f.tipo === "Event") return t("formulario.conflictoEvento", { tipo: nombreTipo((f.actual as unknown as Evento).type) });
      return t("formulario.conflictoNota");
    });
    return (
      <Stack maw={800}>
        <Conflicto
          titulo={t("persona.conflicto")}
          lineas={lineas}
          otros={t("formulario.conflictoOtrosCampos")}
          alDescartar={volver}
          alVolverAAplicar={() => {
            const nuevas = new Map(bases);
            for (const f of paso.fichas) {
              if (f.tipo === "Person") {
                const actual = f.actual as unknown as PersonaGramps;
                setP(reaplicar(base, p, actual));
                setBase(actual);
              } else nuevas.set(f.handle, f.actual as unknown as Base);
            }
            setBases(nuevas);
            setPaso({ tipo: "editar" });
          }}
        />
      </Stack>
    );
  }

  return (
    <Stack gap="xl" maw={900}>
      <Stack gap={4}>
        <Title order={1}>{t("persona.editarDe", { nombre: arbol.nombre(persona) })}</Title>
        <AvisoPropuesta />
        {correccion.aviso}
        {admin && <Text size="sm" c="dimmed">{t("col.id")}: {persona.gramps_id}</Text>}
        <Anchor component={Link} to={rutaPersona(persona.handle)} size="sm">{t("formulario.volverFicha")}</Anchor>
      </Stack>
      <PieEditar arriba="pagina" alCancelar={volver} alGuardar={enviar} puedeGuardar={hayCambios && subidasListas} guardando={paso.tipo === "guardando"} error={error}
        aviso={subidasListas ? null : t("foto.esperando")} />
      <CamposPersona p={p} fijar={fijar} borradores={borradores} alCambiarBorradores={setBorradores} apartadas={apartadas} />
      <Stack gap="sm">
        <CampoMotivo valor={motivo} alCambiar={setMotivo} />
        <PieEditar alCancelar={volver} alGuardar={enviar} puedeGuardar={hayCambios && subidasListas} guardando={paso.tipo === "guardando"}
          aviso={subidasListas ? null : t("foto.esperando")} />
      </Stack>
      {aviso}
    </Stack>
  );
}

/** Las secciones del formulario de persona, en la página o en la ventana de
 * una persona nueva. */
function CamposPersona({ p, fijar, borradores, alCambiarBorradores, nueva = false, apartadas }: {
  p: PersonaGramps;
  fijar: (cambios: Partial<PersonaGramps>) => void;
  borradores: Borradores;
  alCambiarBorradores: (b: Borradores) => void;
  /** Persona nueva: los datos principales a la vista. */
  nueva?: boolean;
  /** «Modificar y aplicar»: las fotos de la solicitud (paso 14). */
  apartadas?: FotoApartada[];
}) {
  const [nombreAbierto, setNombreAbierto] = useState<NombreGramps | null>(null);
  // Qué hacer con el nombre al terminar su ventana.
  const alTerminarNombre = useRef<((n: NombreGramps) => void) | null>(null);
  return (
    <>
      <Seccion titulo={t("formulario.nombres")}>
        <Tarjeta>
          <Stack gap="sm">
            {nueva ? (
              <CamposNombre valor={p.primary_name as NombreGramps} alCambiar={(primary_name) => fijar({ primary_name })} conTipo={false} conFecha={false} />
            ) : <ListaEditable<NombreGramps>
              elementos={[p.primary_name as NombreGramps]}
              alCambiar={([n]) => fijar({ primary_name: n })}
              titulo={t("nombre.principal")}
              rotuloAnadir=""
              vacia=""
              fijo={() => true}
              alEditar={(n, terminar) => { setNombreAbierto(n); alTerminarNombre.current = terminar; }}
              resumen={(n) => (
                <Stack gap={0}>
                  <Text size="xs" c="dimmed">{t("nombre.principal")} · {nombreTipo(n.type)}</Text>
                  <Text fw={600}>{textoNombre(n)}</Text>
                  {n.nick && <Text size="sm">{t("ficha.apodo")}: “{n.nick}”</Text>}
                </Stack>
              )}
            />}
            <Text size="sm" fw={500}>{t("ficha.otrosNombres")}</Text>
            <ListaEditable<NombreGramps>
              elementos={p.alternate_names as NombreGramps[]}
              alCambiar={(l) => fijar({ alternate_names: l })}
              titulo={t("nombre.otro")}
              rotuloAnadir={t("nombre.anadirOtro")}
              vacia={t("formulario.sinOtrosNombres")}
              ordenar
              alEditar={(n, terminar) => {
                setNombreAbierto(n ?? { ...nombreNuevo(), type: { _class: "NameType", value: 1, string: "" } });
                alTerminarNombre.current = terminar;
              }}
              resumen={(n) => (
                <Stack gap={0}>
                  <Text size="xs" c="dimmed">{nombreTipo(n.type)}</Text>
                  <Text>{textoNombre(n)}</Text>
                </Stack>
              )}
            />
            <SelectorSexo valor={p.gender} alCambiar={(gender) => fijar({ gender })} />
          </Stack>
        </Tarjeta>
      </Seccion>

      {nueva && (
        <Seccion titulo={t("persona.nacimientoDefuncion")}>
          <Tarjeta>
            <Stack gap="md">
              {[EV_NACIMIENTO, EV_DEFUNCION].map((tipo) => (
                <EventoRapido key={tipo} tipo={tipo} rol={ROL_PRINCIPAL} primero={tipo === EV_NACIMIENTO}
                  refs={p.event_ref_list} alCambiarRefs={(event_ref_list) => fijar({ event_ref_list })}
                  borradores={borradores} alCambiarBorradores={alCambiarBorradores} />
              ))}
              <Text size="sm" c="dimmed">{t("persona.vitalesAyuda")}</Text>
            </Stack>
          </Tarjeta>
        </Seccion>
      )}

      <Seccion titulo={t("ficha.eventos")}>
        <Tarjeta>
          <SeccionEventos
            refs={p.event_ref_list}
            alCambiar={(event_ref_list) => fijar({ event_ref_list })}
            borradores={borradores}
            alCambiarBorradores={alCambiarBorradores}
            rolPorDefecto={ROL_PRINCIPAL}
            duenio={p.handle}
          />
        </Tarjeta>
      </Seccion>

      <Seccion titulo={t("formulario.atributos")}>
        <Tarjeta><SeccionAtributos lista={p.attribute_list} alCambiar={(attribute_list) => fijar({ attribute_list })} /></Tarjeta>
      </Seccion>

      <Seccion titulo={t("formulario.direcciones")}>
        <Tarjeta><SeccionDirecciones lista={p.address_list} alCambiar={(address_list) => fijar({ address_list })} /></Tarjeta>
      </Seccion>

      <Seccion titulo={t("formulario.direccionesWeb")}>
        <Tarjeta><SeccionDireccionesWeb lista={p.urls} alCambiar={(urls) => fijar({ urls })} /></Tarjeta>
      </Seccion>

      <Seccion titulo={t("formulario.asociaciones")}>
        <Tarjeta><SeccionAsociaciones lista={p.person_ref_list} alCambiar={(person_ref_list) => fijar({ person_ref_list })} yo={p.handle} /></Tarjeta>
      </Seccion>

      <Seccion titulo={t("ficha.notas")}>
        <Tarjeta>
          <SeccionNotas
            lista={p.note_list}
            alCambiar={(note_list) => fijar({ note_list })}
            borradores={borradores}
            alCambiarBorradores={alCambiarBorradores}
            duenio={{ tipo: "Person", handle: p.handle }}
          />
        </Tarjeta>
      </Seccion>

      <Seccion titulo={t("formulario.fotos")}>
        <Tarjeta>
          <SeccionGaleria duenio={p.handle} lista={p.media_list} alCambiar={(media_list) => fijar({ media_list })} borradores={borradores} alCambiarBorradores={alCambiarBorradores} apartadas={apartadas} />
        </Tarjeta>
      </Seccion>

      <EditorNombre
        nombre={nombreAbierto}
        titulo={t("nombre.editar")}
        alTerminar={(n) => alTerminarNombre.current?.(n)}
        alCerrar={() => setNombreAbierto(null)}
      />
    </>
  );
}

const EV_NACIMIENTO = 12;
const EV_DEFUNCION = 13;

/** Una persona nueva, o una nueva ya empezada, desde otro formulario (el de
 * familia: padre, madre, hijo): el formulario completo en una ventana,
 * como borrador (decisión del 27/10/2026). Se guarda con la familia. */
export interface PersonaBorrador {
  persona: Persona;
  borradores: Borradores;
}

export function VentanaPersona({ partida, titulo, alTerminar, alCerrar }: {
  partida: PersonaBorrador | null;
  titulo: string;
  alTerminar: (b: PersonaBorrador) => void;
  alCerrar: () => void;
}) {
  const movil = useMediaQuery("(max-width: 36em)") ?? false;
  return (
    <VentanaFormulario abierta={!!partida} alCerrar={alCerrar} titulo={titulo} movil={movil} zIndex={250} grande>
      {partida && <ContenidoVentana key={partida.persona.handle} partida={partida} alTerminar={alTerminar} alCerrar={alCerrar} />}
    </VentanaFormulario>
  );
}

function ContenidoVentana({ partida, alTerminar, alCerrar }: { partida: PersonaBorrador; alTerminar: (b: PersonaBorrador) => void; alCerrar: () => void }) {
  const arbol = useArbol();
  const [inicial] = useState(partida);
  const [p, setP] = useState(() => structuredClone(partida.persona) as PersonaGramps);
  const [borradores, setBorradores] = useState<Borradores>(partida.borradores);
  const hayCambios = JSON.stringify(p) !== JSON.stringify(inicial.persona) || borradores !== inicial.borradores;
  useSinGuardar(hayCambios);
  const fijar = (cambios: Partial<PersonaGramps>) => setP((x) => ({ ...x, ...cambios }));
  const n = limpiarNombre(p.primary_name as NombreGramps);
  const sinNombre = !n.first_name && !n.surname_list.length;
  const eventoDe = (h: string) => borradores.eventos.get(h)?.evento ?? arbol.eventos.get(h) ?? null;
  const pie = (arriba?: "ventana") => (
    <PieEditar
      arriba={arriba}
      alCancelar={alCerrar}
      alGuardar={() => {
        alTerminar({ persona: { ...p, primary_name: n, ...indicesVitales(p, inicial.persona, eventoDe) }, borradores });
        alCerrar();
      }}
      puedeGuardar={!sinNombre}
      rotulo={t("formulario.hecho")}
    />
  );
  return (
    <Stack gap="lg">
      {pie("ventana")}
      <CamposPersona p={p} fijar={fijar} borradores={borradores} alCambiarBorradores={setBorradores} nueva={!arbol.personas.has(p.handle)} />
      {sinNombre && <Text size="sm" c="red">{t("nombre.faltaNombre")}</Text>}
      {pie()}
    </Stack>
  );
}

// ---- Direcciones ----

const CAMPOS_DIRECCION: [keyof Direccion & string, Clave][] = [
  ["street", "direccion.calle"], ["locality", "direccion.localidad"], ["city", "direccion.ciudad"], ["postal", "direccion.postal"],
  ["county", "direccion.comarca"], ["state", "direccion.provincia"], ["country", "direccion.pais"], ["phone", "direccion.telefono"],
];

function SeccionDirecciones({ lista, alCambiar }: { lista: Direccion[]; alCambiar: (l: Direccion[]) => void }) {
  return (
    <ListaEditable<Direccion>
      elementos={lista}
      alCambiar={alCambiar}
      titulo={t("formulario.direccion")}
      rotuloAnadir={t("formulario.anadirDireccion")}
      vacia={t("formulario.sinDirecciones")}
      ordenar
      nuevo={() => plantilla<Direccion>("Address")}
      limpiar={(d) => ({ ...d, ...Object.fromEntries(CAMPOS_DIRECCION.map(([c]) => [c, String(d[c]).trim()])) })}
      valido={(d) => CAMPOS_DIRECCION.some(([c]) => !!d[c])}
      resumen={(d) => (
        <Stack gap={0}>
          <Text size="sm">{[d.street, d.locality, d.city, d.postal, d.county, d.state, d.country].filter(Boolean).join(", ")}</Text>
          {(textoFecha(d.date) || d.phone) && <Text size="xs" c="dimmed">{[textoFecha(d.date), d.phone].filter(Boolean).join(" · ")}</Text>}
        </Stack>
      )}
      campos={(d, cambiar) => (
        <Stack gap="sm">
          <Group grow align="flex-start" wrap="wrap">
            {CAMPOS_DIRECCION.map(([c, rotulo]) => (
              <TextInput key={c} miw={200} label={t(rotulo)} value={String(d[c])} onChange={(e) => cambiar({ ...d, [c]: e.currentTarget.value })} />
            ))}
          </Group>
          <DateInput label={t("col.fecha")} value={completarFecha(d.date)} onChange={(f) => cambiar({ ...d, date: f })} />
        </Stack>
      )}
    />
  );
}

// ---- Direcciones web ----

function SeccionDireccionesWeb({ lista, alCambiar }: { lista: DireccionWeb[]; alCambiar: (l: DireccionWeb[]) => void }) {
  return (
    <ListaEditable<DireccionWeb>
      elementos={lista}
      alCambiar={alCambiar}
      titulo={t("formulario.direccionWeb")}
      rotuloAnadir={t("formulario.anadirDireccionWeb")}
      vacia={t("formulario.sinDireccionesWeb")}
      ordenar
      nuevo={() => ({ ...plantilla<DireccionWeb>("Url"), type: { _class: "UrlType", value: 2, string: "" } })}
      limpiar={(u) => ({ ...u, path: u.path.trim(), desc: u.desc.trim() })}
      valido={(u) => !!u.path && !!nombreTipo(u.type)}
      resumen={(u) => (
        <Stack gap={0}>
          <Text size="xs" c="dimmed">{nombreTipo(u.type)}</Text>
          <Text size="sm" style={{ overflowWrap: "anywhere" }}>{u.desc ? `${u.desc}: ${u.path}` : u.path}</Text>
        </Stack>
      )}
      campos={(u, cambiar) => <CamposDireccionWeb valor={u} alCambiar={cambiar} />}
    />
  );
}

function CamposDireccionWeb({ valor, alCambiar }: { valor: DireccionWeb; alCambiar: (u: DireccionWeb) => void }) {
  const [tipo, setTipo] = useState(nombreTipo(valor.type));
  return (
    <Stack gap="sm">
      <SelectorTipo clase="UrlType" label={t("col.tipo")} valor={tipo}
        alCambiar={(v) => { setTipo(v); alCambiar({ ...valor, type: tipoDe("UrlType", v, valor.type) }); }} />
      <TextInput label={t("formulario.direccionWeb")} value={valor.path} onChange={(e) => alCambiar({ ...valor, path: e.currentTarget.value })} data-autofocus />
      <TextInput label={t("col.descripcion")} value={valor.desc} onChange={(e) => alCambiar({ ...valor, desc: e.currentTarget.value })} />
    </Stack>
  );
}

// ---- Asociaciones ----

function SeccionAsociaciones({ lista, alCambiar, yo }: { lista: Asociacion[]; alCambiar: (l: Asociacion[]) => void; yo: string }) {
  const arbol = useArbol();
  return (
    <ListaEditable<Asociacion>
      elementos={lista}
      alCambiar={alCambiar}
      titulo={t("formulario.asociacion")}
      rotuloAnadir={t("formulario.anadirAsociacion")}
      vacia={t("formulario.sinAsociaciones")}
      nuevo={() => ({ ...plantilla<Asociacion>("PersonRef"), ref: "" })}
      limpiar={(a) => ({ ...a, rel: a.rel.trim() })}
      valido={(a) => !!a.ref && !!a.rel}
      resumen={(a) => <Text size="sm"><Text span fw={600}>{a.rel}:</Text> {arbol.nombre(arbol.persona(a.ref))}</Text>}
      campos={(a, cambiar) => <CamposAsociacion valor={a} alCambiar={cambiar} yo={yo} />}
    />
  );
}

function CamposAsociacion({ valor, alCambiar, yo }: { valor: Asociacion; alCambiar: (a: Asociacion) => void; yo: string }) {
  const arbol = useArbol();
  const admin = useSesion().invitacion.rol === "administrador";
  return (
    <Stack gap="sm">
      <TextInput label={t("formulario.relacion")} description={t("formulario.relacionAyuda")} value={valor.rel}
        onChange={(e) => alCambiar({ ...valor, rel: e.currentTarget.value })} data-autofocus />
      <Text size="sm" fw={500}>{t("formulario.persona")}: {valor.ref ? arbol.nombre(arbol.persona(valor.ref)) : t("ficha.sinDatos")}</Text>
      <RecordPicker
        tipo="Person"
        placeholder={t("formulario.buscarPersona")}
        conIds={admin}
        excluir={new Set([yo])}
        rotulo={(o: Base) => arbol.nombre(o as Persona)}
        alElegir={(o) => alCambiar({ ...valor, ref: o.handle })}
      />
    </Stack>
  );
}
