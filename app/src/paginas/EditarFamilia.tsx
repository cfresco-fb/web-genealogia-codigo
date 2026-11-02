// Formulario de familia (fase 3, paso 10; docs/edicion.md, «Formularios de
// persona y familia»), escrito nuevo con el esquema del de evento (decisión
// del 25/10/2026): padre y madre (elegir del árbol o crear), tipo de
// relación, hijos (del árbol o nuevos, con su filiación y en orden), eventos
// con su papel, atributos, notas y galería. Las citas y las ordenanzas SUD se
// conservan tal cual (DA-9).
//
// Los vínculos dobles los pone el formulario: al añadir a alguien, también
// su lado (la familia en sus familias, o en sus familias de padres). Quitar
// un vínculo (un hijo, el padre o la madre) es borrado (DA-10 b): solo el
// administrador lo guarda; a los demás se les ofrece igual y el guardado va
// como solicitud (paso 12, opción A de Carlos del 27/10/2026).
//
// Página propia (`/familia/:handle/editar`), como la de persona.
//
// Acciones compuestas (paso 11, decisión del 25/10/2026): «Añadir padres»,
// «Añadir cónyuge» y «Añadir hijo» desde la ficha de persona abren este
// formulario con una familia nueva (`/familia/nueva?padre=…`, `madre` o
// `hijo`) y esa persona ya puesta, o, para un hijo de una familia que ya
// está, el de esa familia con «Añadir hijo nuevo» abierto (`?anadir=hijo`).
// En la familia nueva, además, la fecha y el lugar de la boda a la vista.
// Todo (familia, personas nuevas, eventos) en un solo «Guardar».

import { useEffect, useMemo, useRef, useState } from "react";
import { Anchor, Badge, Button, Group, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { Link, useParams, useSearchParams } from "react-router";
import { plantilla } from "../../../comun/esquema.ts";
import { nuevoHandle, type ObjetoGramps } from "../../../comun/gramps.ts";
import type { ObjetoPeticion } from "../../../comun/peticion.ts";
import { useSesion } from "../acceso/sesion";
import { useArbol } from "../arbol/contexto";
import { ContextoPropuesta, usePermisos } from "../arbol/permisos";
import type { Base, ChildRef, Evento, Familia, Persona } from "../arbol/tipos";
import { objetosPersonas, reaplicar, seccionesCambiadas } from "../arbol/edicionFichas";
import { rutaFamilia, rutaPersona, useAnios } from "../componentes/Enlaces";
import { NoExiste, Seccion, Tarjeta } from "../componentes/Ficha";
import {
  AvisoPropuesta, CampoMotivo, Conflicto, Hecho, PantallaSolicitud, PieEditar, SelectorTipo, tipoDe, useAvisoAlSalir, useCorreccion, useGuardado,
} from "../componentes/Formulario";
import { ListaEditable } from "../componentes/ListaEditable";
import { useFotosSolicitud } from "../componentes/PropuestaALaVista";
import { nombreNuevo } from "../componentes/EditorNombre";
import { personaNueva } from "../componentes/PersonaNueva";
import {
  EventoRapido, fotosBorradores, hayBorradores, objetosBorradores, SeccionAtributos, SeccionEventos, SeccionGaleria, SeccionNotas, sinBorradores, type Borradores,
} from "../componentes/SeccionesFormulario";
import { RecordPicker } from "../gramps-connect/formularios/RecordPicker";
import { useSubidasListas } from "../subidas";
import { nombreTipo, t, type Clave, type TipoGramps } from "../i18n";
import { VentanaPersona, type PersonaBorrador } from "./EditarPersona";

type FamiliaGramps = Familia & { attribute_list: { type: TipoGramps; value: string }[] };

const ROL_FAMILIA = 8;
const FILIACION_NACIMIENTO = 1;
const EV_MATRIMONIO = 1;

const ROTULOS: Record<string, Clave> = {
  father_handle: "familia.padreMadre", mother_handle: "familia.padreMadre", type: "ficha.tipoRelacion",
  child_ref_list: "ficha.hijos", event_ref_list: "ficha.eventos", attribute_list: "formulario.atributos",
  note_list: "ficha.notas", media_list: "formulario.fotos",
};
const rotulos = () => Object.fromEntries(Object.entries(ROTULOS).map(([k, v]) => [k, t(v)]));

export function EditarFamilia() {
  const { handle = "" } = useParams();
  const [params] = useSearchParams();
  const arbol = useArbol();
  const { puede } = usePermisos();
  const f = arbol.familias.get(handle);
  if (!f) return <NoExiste />;
  // Fuera de la rama: el mismo formulario, para proponer el cambio (paso 12).
  return (
    <ContextoPropuesta.Provider value={!puede("Family", handle).ok}>
      <Contenido key={handle} familia={f} anadir={anadirDe(params.get("anadir"))} accion={params.get("anadir") ? "anadirHijo" : "editarFamilia"} />
    </ContextoPropuesta.Provider>
  );
}

const anadirDe = (v: string | null) => (v === "hijo" || v === "hijoExistente" ? v : undefined);

/** Una familia nueva con una persona ya puesta (acciones compuestas): como
 * padre o madre («Añadir cónyuge», o «Añadir hijo» con otra pareja) o como
 * hija («Añadir padres»). Esa persona se modifica (sus familias), así que hay
 * que poder editarla. */
export function NuevaFamilia() {
  const [params] = useSearchParams();
  const arbol = useArbol();
  const { puede } = usePermisos();
  const [como, h] = (["padre", "madre", "hijo"] as const).map((c) => [c, params.get(c)] as const).find(([, v]) => v) ?? ["padre", null];
  const persona = h ? arbol.personas.get(h) : undefined;
  const [base] = useState(() => {
    const f = plantilla<FamiliaGramps & ObjetoGramps>("Family");
    f.handle = nuevoHandle();
    return f as FamiliaGramps;
  });
  const partida = useMemo<FamiliaGramps>(() => ({
    ...structuredClone(base),
    father_handle: como === "padre" ? h : null,
    mother_handle: como === "madre" ? h : null,
    child_ref_list: como === "hijo" && h ? [{ ...plantilla<ChildRef>("ChildRef"), ref: h }] : [],
  }), [base, como, h]);
  if (!persona) return <NoExiste />;
  const anadir = params.get("anadir") === "hijo" ? "hijo" : undefined;
  // Si la persona está fuera de la rama, para proponerlo (paso 12).
  return (
    <ContextoPropuesta.Provider value={!puede("Person", persona.handle).ok}>
      <Contenido
        key={base.handle}
        familia={base}
        partida={partida}
        desde={rutaPersona(persona.handle)}
        anadir={anadir}
        accion={como === "hijo" ? "anadirPadres" : anadir ? "anadirHijo" : "anadirConyuge"}
      />
    </ContextoPropuesta.Provider>
  );
}

function Contenido({ familia, partida, desde, anadir, accion }: {
  /** La familia como está en el árbol; si es nueva, vacía. */
  familia: Familia;
  /** Familia nueva: de qué se parte (con la persona ya puesta). */
  partida?: FamiliaGramps;
  /** Familia nueva: adónde se vuelve al cancelar. */
  desde?: string;
  /** Abrir ya «Añadir hijo nuevo» o el buscador de hijos. */
  anadir?: "hijo" | "hijoExistente";
  /** Para el registro: «editarFamilia», «anadirHijo»… */
  accion: string;
}) {
  const arbol = useArbol();
  const admin = useSesion().invitacion.rol === "administrador";
  const anios = useAnios();
  const { paso, setPaso, error, guardar, solicitud } = useGuardado("familia.errorPermiso");
  const [base, setBase] = useState(() => familia as FamiliaGramps);
  const [f, setF] = useState(() => structuredClone(partida ?? familia) as FamiliaGramps);
  const nueva = !!partida;
  // Personas nuevas: el padre, la madre o hijos, con lo hecho en su
  // formulario (eventos, notas).
  const [nuevas, setNuevas] = useState(new Map<string, PersonaBorrador>());
  const [borradores, setBorradores] = useState<Borradores>(sinBorradores);
  const [bases, setBases] = useState(new Map<string, Base>());
  const [motivo, setMotivo] = useState("");
  const [tipo, setTipo] = useState(nombreTipo(familia.type));
  const correccion = useCorreccion();
  const apartadas = useFotosSolicitud(nueva ? null : correccion.resuelve, familia.handle);
  // Ventana de persona nueva abierta: para qué es y de qué se parte.
  const [creando, setCreando] = useState<{ quien: "padre" | "madre" | "hijo"; partida: PersonaBorrador } | null>(null);
  const [eligiendoHijo, setEligiendoHijo] = useState(false);
  const alTerminarHijo = useRef<((c: ChildRef) => void) | null>(null);

  const hayCambios = JSON.stringify(f) !== JSON.stringify(partida ?? base) || hayBorradores(borradores);
  const { aviso, salir } = useAvisoAlSalir(hayCambios && paso.tipo !== "hecho");
  const fijar = (cambios: Partial<FamiliaGramps>) => setF((x) => ({ ...x, ...cambios }));
  // Tras guardar, a la ficha de la familia (también si es nueva: ya existe);
  // al cancelar una nueva, a la persona de la que se partía.
  const volver = () => salir(rutaFamilia(familia.handle));
  const cancelar = () => salir(nueva && desde ? desde : rutaFamilia(familia.handle));
  const personaDe = (h: string | null | undefined) =>
    (h ? nuevas.get(h)?.persona ?? (bases.get(h) as Persona | undefined) ?? arbol.persona(h) : null);
  /** Un nombre vacío; en un hijo, con el apellido principal del padre, como
   * hace Gramps (decisión del 27/10/2026). */
  const nombreDeNuevo = (quien: "padre" | "madre" | "hijo") => {
    const n = nombreNuevo();
    const apellidos = personaDe(f.father_handle)?.primary_name.surname_list ?? [];
    const delPadre = apellidos.find((s) => s.primary) ?? apellidos[0];
    if (quien === "hijo" && delPadre) n.surname_list = [{ ...structuredClone(delPadre), primary: true }];
    return n;
  };
  /** Abre la ventana de una persona nueva (o una nueva ya empezada). */
  const abrirPersona = (quien: "padre" | "madre" | "hijo", h?: string) => setCreando({
    quien,
    partida: (h && nuevas.get(h)) || {
      persona: personaNueva(nombreDeNuevo(quien), quien === "padre" ? 1 : quien === "madre" ? 0 : 2),
      borradores: sinBorradores(),
    },
  });
  /** «Nueva» o «Nuevo», según el sexo (sin él, «Nuevo»). */
  const rotuloNueva = (h: string) => t(nuevas.get(h)?.persona.gender === 0 ? "familia.nueva" : "familia.nuevo");
  const nombreDe = (h: string) => {
    const p = personaDe(h);
    const a = p && !nuevas.has(h) ? anios(p) : "";
    return `${arbol.nombre(p)}${a ? ` ${a}` : ""}`;
  };
  // Quién ya está en la familia (no se ofrece otra vez).
  const enFamilia = new Set([f.father_handle, f.mother_handle, ...f.child_ref_list.map((c) => c.ref)].filter((h): h is string => !!h));
  const hijosAntes = new Set(base.child_ref_list.map((c) => c.ref));

  // Acciones compuestas: «Añadir hijo nuevo» o el buscador, ya abiertos.
  useEffect(() => {
    if (anadir === "hijo") {
      alTerminarHijo.current = (c) => setF((x) => ({ ...x, child_ref_list: [...x.child_ref_list, c] }));
      abrirPersona("hijo");
    } else if (anadir === "hijoExistente") setEligiendoHijo(true);
    // Solo al abrir el formulario.
  }, []);

  // Fotos subidas: las de la familia y las de cada persona nueva.
  // (Una foto del árbol cambiada en dos galerías va una vez: la última.)
  const fotosDe = (b: Borradores, media: { ref: string }[]) => fotosBorradores(b, media.map((r) => r.ref), arbol, bases);
  const todasLasFotos = [fotosDe(borradores, f.media_list), ...[...nuevas].filter(([h]) => enFamilia.has(h)).map(([, x]) => fotosDe(x.borradores, x.persona.media_list))];
  const fotos = {
    objetos: [...new Map(todasLasFotos.flatMap((x) => x.objetos).map((o) => [o.handle, o])).values()],
    ficheros: todasLasFotos.flatMap((x) => x.ficheros),
  };
  const subidasListas = useSubidasListas(todasLasFotos.flatMap((x) => x.subidas));

  async function enviar() {
    const objetos: ObjetoPeticion[] = [
      nueva
        ? { tipo: "Family", handle: base.handle, operacion: "crear", base: null, despues: f as unknown as ObjetoGramps }
        : { tipo: "Family", handle: base.handle, operacion: "modificar", base: base.change, despues: f as unknown as ObjetoGramps },
      ...objetosPersonas(base, f, new Map([...nuevas].map(([h, x]) => [h, x.persona])), personaDe),
      ...objetosBorradores(borradores, f.event_ref_list.map((r) => r.ref), f.note_list, arbol, bases, base.handle, f.media_list.map((r) => r.ref)),
    ];
    // Lo hecho en el formulario de cada persona nueva que sigue en la familia.
    for (const [h, { persona, borradores: b }] of nuevas) {
      if (!enFamilia.has(h)) continue;
      objetos.push(...objetosBorradores(b, persona.event_ref_list.map((r) => r.ref), persona.note_list, arbol, bases, h, persona.media_list.map((r) => r.ref)));
    }
    objetos.push(...fotos.objetos);
    await guardar({ accion, motivo: motivo.trim() || null, objetos, ficheros: fotos.ficheros, corrige: nueva ? null : correccion.corrige, resuelve: nueva ? null : correccion.resuelve });
  }

  function personaHecha(pb: PersonaBorrador) {
    const h = pb.persona.handle;
    const ya = nuevas.has(h);
    setNuevas((m) => new Map(m).set(h, pb));
    if (ya || !creando) return;
    if (creando.quien === "padre") fijar({ father_handle: h });
    else if (creando.quien === "madre") fijar({ mother_handle: h });
    else alTerminarHijo.current?.(hijoNuevo(h));
  }

  const hijoNuevo = (h: string): ChildRef => ({ ...plantilla<ChildRef>("ChildRef"), ref: h });

  if (paso.tipo === "hecho") {
    return <Stack maw={800}><Hecho marcado={paso.marcado} solicitud={paso.solicitud} alCerrar={volver} /></Stack>;
  }

  if (paso.tipo === "solicitud") {
    return <Stack maw={800}>{aviso}<PantallaSolicitud paso={paso} motivo={motivo} error={error} solicitud={solicitud} /></Stack>;
  }

  if (paso.tipo === "conflicto") {
    const borrada = paso.fichas.some((x) => !x.actual);
    const lineas = borrada ? null : paso.fichas.map((x) => {
      if (x.tipo === "Family") return t("formulario.conflictoSecciones", { secciones: seccionesCambiadas(base, x.actual!, rotulos()).join(", ") });
      if (x.tipo === "Person") return t("formulario.conflictoPersona", { nombre: arbol.nombre(x.actual as unknown as Persona) });
      if (x.tipo === "Event") return t("formulario.conflictoEvento", { tipo: nombreTipo((x.actual as unknown as Evento).type) });
      return t("formulario.conflictoNota");
    });
    return (
      <Stack maw={800}>
        <Conflicto
          titulo={t("familia.conflicto")}
          lineas={lineas}
          otros={t("formulario.conflictoOtrosCampos")}
          alDescartar={volver}
          alVolverAAplicar={() => {
            const nuevasBases = new Map(bases);
            for (const x of paso.fichas) {
              if (x.tipo === "Family") {
                const actual = x.actual as unknown as FamiliaGramps;
                setF(reaplicar(base, f, actual));
                setBase(actual);
              } else nuevasBases.set(x.handle, x.actual as unknown as Base);
            }
            setBases(nuevasBases);
            setPaso({ tipo: "editar" });
          }}
        />
      </Stack>
    );
  }

  const progenitor = (campo: "father_handle" | "mother_handle", quien: "padre" | "madre") => {
    const h = f[campo];
    const p = personaDe(h);
    const quitable = !!h;
    return (
      <Tarjeta>
        <Stack gap="xs">
          <Text fw={600} size="sm" c="dimmed">{t(quien === "padre" ? "col.padre" : "col.madre")}</Text>
          {p ? (
            <Group gap="xs">
              <Text size="lg">{nombreDe(p.handle)}</Text>
              {nuevas.has(p.handle) && <Badge variant="light" tt="none">{rotuloNueva(p.handle)}</Badge>}
            </Group>
          ) : <Text c="dimmed">{t("ficha.desconocido")}</Text>}
          <Group gap="xs">
            {p && nuevas.has(p.handle) && <Button size="xs" variant="default" onClick={() => abrirPersona(quien, p.handle)}>{t("editar.boton")}</Button>}
            {quitable && <Button size="xs" variant="default" onClick={() => fijar({ [campo]: null })}>{t("lista.quitar")}</Button>}
            {!h && <Button size="xs" variant="default" onClick={() => abrirPersona(quien)}>{t("familia.personaNueva")}</Button>}
          </Group>
          {!h && (
            <RecordPicker
              tipo="Person"
              placeholder={t("familia.buscarPersona")}
              conIds={admin}
              excluir={enFamilia}
              rotulo={(o: Base) => nombreDe(o.handle)}
              alElegir={(o) => fijar({ [campo]: o.handle })}
            />
          )}
        </Stack>
      </Tarjeta>
    );
  };

  return (
    <Stack gap="xl" maw={900}>
      <Stack gap={4}>
        <Title order={1}>{nueva ? t("familia.nuevaTitulo") : t("familia.editarDe", { nombre: arbol.nombreFamilia(familia) })}</Title>
        <AvisoPropuesta />
        {!nueva && correccion.aviso}
        {admin && !nueva && <Text size="sm" c="dimmed">{t("col.id")}: {familia.gramps_id}</Text>}
        <Anchor component={Link} to={nueva && desde ? desde : rutaFamilia(familia.handle)} size="sm">{t("formulario.volverFicha")}</Anchor>
      </Stack>
      <PieEditar arriba="pagina" alCancelar={cancelar} alGuardar={enviar} puedeGuardar={(nueva || hayCambios) && subidasListas} guardando={paso.tipo === "guardando"}
        error={error} aviso={subidasListas ? null : t("foto.esperando")} />

      <Seccion titulo={t("familia.padreMadre")}>
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {progenitor("father_handle", "padre")}
            {progenitor("mother_handle", "madre")}
          </SimpleGrid>
          <Tarjeta>
            <SelectorTipo clase="FamilyRelType" label={t("ficha.tipoRelacion")} valor={tipo}
              alCambiar={(v) => { setTipo(v); if (v.trim()) fijar({ type: tipoDe("FamilyRelType", v, base.type) }); }} />
          </Tarjeta>
        </Stack>
      </Seccion>

      <Seccion titulo={t("ficha.hijos")}>
        <Tarjeta>
          <Stack gap="xs">
            <ListaEditable<ChildRef>
              elementos={f.child_ref_list}
              alCambiar={(child_ref_list) => fijar({ child_ref_list })}
              titulo={t("familia.filiacion")}
              rotuloAnadir={t("familia.hijoNuevo")}
              vacia={t("ficha.sinHijos")}
              ordenar
              editable={(c) => nuevas.has(c.ref)}
              alEditar={(c, terminar) => {
                alTerminarHijo.current = c ? null : terminar;
                abrirPersona("hijo", c?.ref);
              }}
              resumen={(c) => (
                <Group gap="xs">
                  <Text size="sm" fw={600}>{nombreDe(c.ref)}</Text>
                  {nuevas.has(c.ref) && <Badge variant="light" tt="none" size="sm">{rotuloNueva(c.ref)}</Badge>}
                </Group>
              )}
              columnas={(["frel", "mrel"] as const).map((campo) => ({
                rotulo: t(campo === "frel" ? "familia.conPadre" : "familia.conMadre"),
                ayuda: t(campo === "frel" ? "familia.conPadreAyuda" : "familia.conMadreAyuda"),
                ancho: 150,
                celda: (c: ChildRef, i: number) => (
                  <Filiacion campo={campo} valor={c} alCambiar={(x) => fijar({ child_ref_list: f.child_ref_list.map((y, j) => (j === i ? x : y)) })} />
                ),
              }))}
            />
            <Group><Button size="xs" variant="default" onClick={() => setEligiendoHijo((x) => !x)}>{t("familia.hijoExistente")}</Button></Group>
            {eligiendoHijo && (
              <RecordPicker
                tipo="Person"
                placeholder={t("familia.buscarHijo")}
                conIds={admin}
                excluir={enFamilia}
                rotulo={(o: Base) => nombreDe(o.handle)}
                alElegir={(o) => { fijar({ child_ref_list: [...f.child_ref_list, hijoNuevo(o.handle)] }); setEligiendoHijo(false); }}
              />
            )}
            {!admin && (!!base.father_handle || !!base.mother_handle || hijosAntes.size > 0) && <Text size="xs" c="dimmed">{t("familia.quitarSoloAdmin")}</Text>}
          </Stack>
        </Tarjeta>
      </Seccion>

      {nueva && (
        <Seccion titulo={t("familia.boda")}>
          <Tarjeta>
            <Stack gap="xs">
              <EventoRapido tipo={EV_MATRIMONIO} rol={ROL_FAMILIA} primero
                refs={f.event_ref_list} alCambiarRefs={(event_ref_list) => fijar({ event_ref_list })}
                borradores={borradores} alCambiarBorradores={setBorradores} />
              <Text size="sm" c="dimmed">{t("familia.bodaAyuda")}</Text>
            </Stack>
          </Tarjeta>
        </Seccion>
      )}

      <Seccion titulo={t("ficha.eventos")}>
        <Tarjeta>
          <SeccionEventos
            refs={f.event_ref_list}
            alCambiar={(event_ref_list) => fijar({ event_ref_list })}
            borradores={borradores}
            alCambiarBorradores={setBorradores}
            rolPorDefecto={ROL_FAMILIA}
            duenio={familia.handle}
          />
        </Tarjeta>
      </Seccion>

      <Seccion titulo={t("formulario.atributos")}>
        <Tarjeta><SeccionAtributos lista={f.attribute_list} alCambiar={(attribute_list) => fijar({ attribute_list })} /></Tarjeta>
      </Seccion>

      <Seccion titulo={t("ficha.notas")}>
        <Tarjeta>
          <SeccionNotas
            lista={f.note_list}
            alCambiar={(note_list) => fijar({ note_list })}
            borradores={borradores}
            alCambiarBorradores={setBorradores}
            duenio={{ tipo: "Family", handle: familia.handle }}
          />
        </Tarjeta>
      </Seccion>

      <Seccion titulo={t("formulario.fotos")}>
        <Tarjeta>
          <SeccionGaleria duenio={base.handle} lista={f.media_list} alCambiar={(media_list) => fijar({ media_list })} borradores={borradores} alCambiarBorradores={setBorradores} apartadas={apartadas} />
        </Tarjeta>
      </Seccion>

      <Stack gap="sm">
        <CampoMotivo valor={motivo} alCambiar={setMotivo} />
        <PieEditar alCancelar={cancelar} alGuardar={enviar} puedeGuardar={(nueva || hayCambios) && subidasListas} guardando={paso.tipo === "guardando"}
          aviso={subidasListas ? null : t("foto.esperando")} />
      </Stack>
      {aviso}

      <VentanaPersona
        partida={creando?.partida ?? null}
        titulo={t(creando?.quien === "padre" ? "familia.padreNuevo" : creando?.quien === "madre" ? "familia.madreNueva" : "familia.hijoNuevo")}
        alTerminar={personaHecha}
        alCerrar={() => setCreando(null)}
      />
    </Stack>
  );
}

/** La filiación del hijo con el padre o con la madre (nacimiento,
 * adopción…), en su columna; si no es «Nacimiento», resaltada con un fondo
 * suave (decisión del 27/10/2026). */
function Filiacion({ campo, valor, alCambiar }: { campo: "frel" | "mrel"; valor: ChildRef; alCambiar: (c: ChildRef) => void }) {
  const [texto, setTexto] = useState(nombreTipo(valor[campo]));
  return (
    <SelectorTipo clase="ChildRefType" label={t(campo === "frel" ? "familia.conPadre" : "familia.conMadre")} valor={texto} sinRotulo
      resaltado={valor[campo].value !== FILIACION_NACIMIENTO}
      alCambiar={(v) => { setTexto(v); if (v.trim()) alCambiar({ ...valor, [campo]: tipoDe("ChildRefType", v, valor[campo]) }); }} />
  );
}
