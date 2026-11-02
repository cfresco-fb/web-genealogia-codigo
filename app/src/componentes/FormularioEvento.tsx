// Formulario de evento (fase 3, paso 8; docs/edicion.md, «Formulario de
// evento»): tipo, fecha (con el editor de fechas), lugar y descripción. Lo
// demás del evento (citas, atributos, fotos) se conserva tal cual.
//
// Desde el paso 9, también el lugar y las notas del evento: «Nuevo lugar»
// y «Añadir nota» o «Editar» una nota, como borradores que se guardan con el
// evento en un solo «Guardar»; y «Corregir lugar» (si se puede), que abre el
// formulario de lugar y guarda por su cuenta (no toca el evento).
//
// Desde el paso 10, también como borrador de los formularios de persona y
// familia (`borrador`): un evento nuevo o uno existente, que no se guarda
// aquí, sino con la persona o la familia en un solo «Guardar». Lo que se
// devuelve: el evento y lo que lleva consigo (lugar nuevo, notas).
//
// Como todos los formularios (Formulario.tsx): «Motivo» opcional (DA-18 a)
// y el guardado por
// la función del servidor, que lo aplica al árbol en memoria. Si otro lo ha
// cambiado mientras tanto (DA-14 a), se enseña qué cambió y se pueden volver
// a aplicar los cambios propios sobre la versión nueva. En el móvil, a
// pantalla completa (respuesta de Carlos del 24/10/2026).

import { useMemo, useState } from "react";
import { Button, Group, Paper, Stack, Text, TextInput } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import type { ObjetoGramps } from "../../../comun/gramps.ts";
import type { ObjetoPeticion } from "../../../comun/peticion.ts";
import { useSesion } from "../acceso/sesion";
import { useArbol } from "../arbol/contexto";
import { textoFecha } from "../arbol/fechas";
import { completarFecha } from "../arbol/leerFecha";
import { usePermisos } from "../arbol/permisos";
import type { Base, Evento, Lugar, Nota } from "../arbol/tipos";
import { DateInput } from "../gramps-connect/formularios/DateInput";
import { RecordPicker } from "../gramps-connect/formularios/RecordPicker";
import type { GrampsDate } from "../gramps-connect/gramps-date";
import { nombreTipo, t } from "../i18n";
import {
  CampoMotivo, Conflicto, Hecho, lineaCambio, PantallaSolicitud, PieEditar, SelectorTipo, tipoDe, useGuardado, useSinGuardar, VentanaFormulario,
} from "./Formulario";
import { FormularioLugar, tituloBorrador } from "./FormularioLugar";
import { FormularioNota, textoCorto } from "./FormularioNota";

/** Lo que se edita del evento. */
interface Campos {
  tipo: string;
  fecha: GrampsDate;
  lugar: string;
  descripcion: string;
}

const camposDe = (e: Evento): Campos => ({
  tipo: nombreTipo(e.type),
  fecha: completarFecha(e.date as GrampsDate),
  lugar: e.place ?? "",
  descripcion: e.description ?? "",
});

type Campo = keyof Campos;
const CAMPOS: Campo[] = ["tipo", "fecha", "lugar", "descripcion"];
const ROTULOS: Record<Campo, Parameters<typeof t>[0]> = {
  tipo: "col.tipo", fecha: "col.fecha", lugar: "col.lugar", descripcion: "col.descripcion",
};

const igual = (c: Campo, a: Campos, b: Campos) =>
  c === "fecha" ? JSON.stringify(a.fecha) === JSON.stringify(b.fecha) : a[c].trim() === b[c].trim();

/** Una nota del evento cambiada en el formulario: la versión de la que se
 * parte y cómo queda. */
interface NotaCambiada {
  base: Nota;
  despues: Nota;
}

/** Un evento como borrador de otro formulario: de dónde se parte (la
 * última versión hecha aquí, con lo que lleva consigo) y qué hacer al
 * terminar. */
export interface BorradorEvento {
  partida: Evento;
  extras: ObjetoPeticion[];
  alTerminar: (evento: Evento, extras: ObjetoPeticion[]) => void;
}

export function FormularioEvento({ evento, alCerrar, borrador, zIndex }: {
  /** El evento como está en el árbol, o uno nuevo (que aún no está). */
  evento: Evento | null;
  alCerrar: () => void;
  borrador?: BorradorEvento;
  zIndex?: number;
}) {
  const movil = useMediaQuery("(max-width: 36em)") ?? false;
  const arbol = useArbol();
  const titulo = evento && !arbol.eventos.has(evento.handle) ? t("evento.nuevo") : t("evento.editar");
  return (
    <VentanaFormulario abierta={!!evento} alCerrar={alCerrar} titulo={titulo} movil={movil} zIndex={zIndex}>
      {evento && <Contenido key={evento.handle} evento={evento} alCerrar={alCerrar} borrador={borrador} />}
    </VentanaFormulario>
  );
}

function Contenido({ evento, alCerrar, borrador }: { evento: Evento; alCerrar: () => void; borrador?: BorradorEvento }) {
  const arbol = useArbol();
  const { puede } = usePermisos();
  const admin = useSesion().invitacion.rol === "administrador";
  const { paso, setPaso, error, guardar, solicitud } = useGuardado("evento.errorPermiso");
  // La versión de la que se parte (cambia si hay conflicto y se vuelve a
  // aplicar sobre la nueva).
  const [original, setOriginal] = useState(evento);
  const nuevo = !arbol.eventos.has(evento.handle);
  const inicial = useMemo(() => camposDe(original), [original]);
  const [campos, setCampos] = useState(() => (borrador ? camposDe(borrador.partida) : inicial));
  const [motivo, setMotivo] = useState("");
  const [eligiendoLugar, setEligiendoLugar] = useState(false);
  // Borradores: un lugar nuevo y las notas nuevas o cambiadas (como
  // borrador de otro formulario, los que ya traía).
  const deExtras = (tipo: string, operacion: string) =>
    (borrador?.extras ?? []).filter((o) => o.tipo === tipo && o.operacion === operacion).map((o) => o.despues as unknown);
  const [lugarNuevo, setLugarNuevo] = useState<Lugar | null>(() => (deExtras("Place", "crear")[0] as Lugar | undefined) ?? null);
  const [notasNuevas, setNotasNuevas] = useState<Nota[]>(() => deExtras("Note", "crear") as Nota[]);
  const [notasCambiadas, setNotasCambiadas] = useState<Map<string, NotaCambiada>>(() => new Map(
    (deExtras("Note", "modificar") as Nota[]).map((n) => [n.handle, { base: arbol.notas.get(n.handle)!, despues: n }]),
  ));
  // Formularios abiertos encima: lugar (nuevo o el borrador, o corregir
  // uno del árbol) y nota.
  const [formLugar, setFormLugar] = useState<{ lugar: Lugar | null; borrador: boolean } | null>(null);
  const [formNota, setFormNota] = useState<Nota | "nueva" | null>(null);

  const cambiados = CAMPOS.filter((c) => !igual(c, campos, inicial));
  const usaLugarNuevo = !!lugarNuevo && campos.lugar === lugarNuevo.handle;
  const hayCambios = nuevo || cambiados.length > 0 || notasNuevas.length > 0 || notasCambiadas.size > 0;
  useSinGuardar(hayCambios && (paso.tipo === "editar" || paso.tipo === "guardando" || paso.tipo === "solicitud"));
  const fijar = <K extends Campo>(c: K, v: Campos[K]) => setCampos((x) => ({ ...x, [c]: v }));
  const tituloDe = (h: string) => (lugarNuevo && h === lugarNuevo.handle ? tituloBorrador(arbol, lugarNuevo) : arbol.tituloLugar(h));
  const textoCampo = (c: Campo, v: Campos) => (c === "fecha" ? textoFecha(v.fecha) : c === "lugar" ? tituloDe(v.lugar) : v[c].trim());
  const participantes = arbol.participantes(evento).map((r) =>
    r.tipo === "Person" ? arbol.nombre(r.objeto as never) : arbol.nombreFamilia(r.objeto as never));
  // Las notas del evento, como quedarían.
  const notas: Nota[] = [
    ...original.note_list.map((h) => notasCambiadas.get(h)?.despues ?? arbol.notas.get(h)).filter((n): n is Nota => !!n),
    ...notasNuevas,
  ];

  async function enviar() {
    const despues: Evento = {
      ...structuredClone(original),
      type: tipoDe("EventType", campos.tipo, original.type),
      date: campos.fecha,
      place: campos.lugar,
      description: campos.descripcion.trim(),
      note_list: [...original.note_list.filter((h) => arbol.notas.has(h)), ...notasNuevas.map((n) => n.handle)],
    };
    const objetos: ObjetoPeticion[] = [];
    if (usaLugarNuevo) objetos.push({ tipo: "Place", handle: lugarNuevo!.handle, operacion: "crear", base: null, despues: lugarNuevo as unknown as ObjetoGramps });
    for (const n of notasNuevas) objetos.push({ tipo: "Note", handle: n.handle, operacion: "crear", base: null, despues: n as unknown as ObjetoGramps });
    for (const { base, despues: d } of notasCambiadas.values()) {
      objetos.push({ tipo: "Note", handle: base.handle, operacion: "modificar", base: base.change, despues: d as unknown as ObjetoGramps });
    }
    if (borrador) {
      borrador.alTerminar(despues, objetos);
      alCerrar();
      return;
    }
    objetos.unshift({ tipo: "Event", handle: original.handle, operacion: "modificar", base: original.change, despues: despues as unknown as ObjetoGramps });
    await guardar({ accion: "editarEvento", motivo: motivo.trim() || null, objetos });
  }

  /** Una nota terminada en su formulario (borrador). */
  function notaHecha(n: Nota) {
    if (!arbol.notas.has(n.handle)) {
      setNotasNuevas((l) => (l.some((x) => x.handle === n.handle) ? l.map((x) => (x.handle === n.handle ? n : x)) : [...l, n]));
      return;
    }
    setNotasCambiadas((m) => {
      const copia = new Map(m);
      copia.set(n.handle, { base: m.get(n.handle)?.base ?? arbol.notas.get(n.handle)!, despues: n });
      return copia;
    });
  }

  if (paso.tipo === "hecho") return <Hecho marcado={paso.marcado} solicitud={paso.solicitud} alCerrar={alCerrar} />;
  if (paso.tipo === "solicitud") return <PantallaSolicitud paso={paso} motivo={motivo} error={error} solicitud={solicitud} />;

  if (paso.tipo === "conflicto") {
    const deEvento = paso.fichas.find((f) => f.tipo === "Event");
    const borrada = paso.fichas.some((f) => !f.actual);
    const actual = deEvento?.actual as unknown as Evento | undefined;
    const lineas = borrada ? null : [
      ...(actual ? CAMPOS.filter((c) => !igual(c, camposDe(actual), inicial))
        .map((c) => lineaCambio(t(ROTULOS[c]), textoCampo(c, inicial), textoCampo(c, camposDe(actual)))) : []),
      ...paso.fichas.filter((f) => f.tipo === "Note").map((f) => {
        const antes = notasCambiadas.get(f.handle)?.base;
        return t("evento.notaCambiada", { antes: textoCorto(antes?.text.string ?? "", 40), despues: textoCorto((f.actual as unknown as Nota).text.string, 40) });
      }),
    ];
    return (
      <Conflicto
        titulo={t("evento.conflicto")}
        lineas={lineas}
        otros={t("evento.conflictoOtrosCampos")}
        alDescartar={alCerrar}
        alVolverAAplicar={() => {
          if (actual) {
            // Los campos propios cambiados, sobre la versión nueva.
            const mios = Object.fromEntries(cambiados.map((c) => [c, campos[c]]));
            setOriginal(actual);
            setCampos({ ...camposDe(actual), ...mios });
          }
          // Las notas propias cambiadas, sobre su versión nueva.
          setNotasCambiadas((m) => {
            const copia = new Map(m);
            for (const f of paso.fichas.filter((x) => x.tipo === "Note" && x.actual)) {
              const c = copia.get(f.handle);
              const nueva = f.actual as unknown as Nota;
              if (c) copia.set(f.handle, { base: nueva, despues: { ...c.despues, change: nueva.change } });
            }
            return copia;
          });
          setPaso({ tipo: "editar" });
        }}
      />
    );
  }

  const lugarElegido = campos.lugar ? (usaLugarNuevo ? lugarNuevo : arbol.lugares.get(campos.lugar)) : null;
  const corregible = !!lugarElegido && !usaLugarNuevo && puede("Place", lugarElegido.handle).ok;
  const pie = (arriba?: "ventana") => (
    <PieEditar
      arriba={arriba}
      alCancelar={alCerrar}
      alGuardar={enviar}
      puedeGuardar={hayCambios && !!campos.tipo.trim()}
      guardando={paso.tipo === "guardando"}
      error={error}
      rotulo={borrador ? t("formulario.hecho") : undefined}
    />
  );
  return (
    <Stack>
      {pie("ventana")}
      {admin && <Text size="sm" c="dimmed">{t("col.id")}: {original.gramps_id}</Text>}
      {participantes.length > 0 && <Text size="sm" c="dimmed">{t("evento.participantes", { nombres: participantes.join(", ") })}</Text>}
      <SelectorTipo clase="EventType" label={t("col.tipo")} valor={campos.tipo} alCambiar={(v) => fijar("tipo", v)} />
      <DateInput label={t("col.fecha")} value={campos.fecha} onChange={(f) => fijar("fecha", f)} />
      <Stack gap={4}>
        <Text size="sm" fw={500}>{t("col.lugar")}</Text>
        <Group gap="xs">
          <Text>{lugarElegido ? tituloDe(lugarElegido.handle) : t("ficha.sinDatos")}</Text>
          <Button size="xs" variant="default" onClick={() => setEligiendoLugar((x) => !x)}>{lugarElegido ? t("evento.cambiarLugar") : t("evento.elegirLugar")}</Button>
          <Button size="xs" variant="default" onClick={() => setFormLugar({ lugar: usaLugarNuevo ? lugarNuevo : null, borrador: true })}>
            {usaLugarNuevo ? t("evento.corregirLugar") : t("evento.nuevoLugar")}
          </Button>
          {corregible && <Button size="xs" variant="default" onClick={() => setFormLugar({ lugar: lugarElegido, borrador: false })}>{t("evento.corregirLugar")}</Button>}
          {lugarElegido && <Button size="xs" variant="default" onClick={() => fijar("lugar", "")}>{t("evento.quitarLugar")}</Button>}
        </Group>
        {eligiendoLugar && (
          <RecordPicker
            tipo="Place"
            placeholder={t("evento.buscarLugar")}
            rotulo={(o: Base) => arbol.tituloLugar(o.handle)}
            conIds={admin}
            alElegir={(o) => { fijar("lugar", o.handle); setEligiendoLugar(false); }}
          />
        )}
      </Stack>
      <TextInput label={t("col.descripcion")} value={campos.descripcion} onChange={(e) => fijar("descripcion", e.currentTarget.value)} />
      <Stack gap={4}>
        <Text size="sm" fw={500}>{t("ficha.notas")}</Text>
        {notas.map((n) => (
          <Paper key={n.handle} withBorder p="xs">
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }} lineClamp={3}>{n.text.string}</Text>
              {(!arbol.notas.has(n.handle) || puede("Note", n.handle).ok) && (
                <Button size="xs" variant="default" onClick={() => setFormNota(n)} aria-label={t("nota.editar")}>{t("editar.boton")}</Button>
              )}
            </Group>
          </Paper>
        ))}
        <Group><Button size="xs" variant="default" onClick={() => setFormNota("nueva")}>{t("nota.anadir")}</Button></Group>
      </Stack>
      {!borrador && <CampoMotivo valor={motivo} alCambiar={setMotivo} />}
      {pie()}

      <FormularioLugar
        abierto={!!formLugar}
        lugar={formLugar?.lugar ?? null}
        borrador={formLugar?.borrador}
        alTerminar={(l) => { setLugarNuevo(l); fijar("lugar", l.handle); setEligiendoLugar(false); }}
        alCerrar={() => setFormLugar(null)}
      />
      <FormularioNota
        abierto={!!formNota}
        nota={formNota === "nueva" ? null : formNota}
        duenio={{ tipo: "Event", handle: original.handle }}
        borrador
        alTerminar={notaHecha}
        alCerrar={() => setFormNota(null)}
      />
    </Stack>
  );
}
