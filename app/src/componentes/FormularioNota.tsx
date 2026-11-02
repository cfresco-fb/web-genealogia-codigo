// Formulario de nota (fase 3, paso 9; docs/edicion.md, «Formularios de
// lugar y nota»): el texto y el tipo. Corregir una nota que ya existe (si
// todo lo que la usa se puede modificar, DA-8 a) o añadir una nota nueva a
// una persona, una familia o un evento.
//
// Formato (DA-25 a): si no se toca el texto, la nota conserva su formato
// (negrita, enlaces…; StyledText.tags); si se cambia, el formato se pierde
// y se avisa antes.
//
// Dos maneras de usarlo: por su cuenta, guardando con la función del
// servidor (fichas de persona y familia), o como borrador dentro de otro
// formulario (el de evento), que la guarda con lo suyo en un solo
// «Guardar» (`borrador` y `alTerminar`).

import { useState } from "react";
import { Alert, Stack, Text, Textarea } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { nuevoHandle, type ObjetoGramps } from "../../../comun/gramps.ts";
import { plantilla } from "../../../comun/esquema.ts";
import type { ObjetoPeticion } from "../../../comun/peticion.ts";
import { useArbol } from "../arbol/contexto";
import type { Arbol } from "../arbol/arbol";
import type { Base, Evento, Familia, Nota, Persona } from "../arbol/tipos";
import { nombreTipo, t, valoresTipo } from "../i18n";
import {
  CampoMotivo, Conflicto, Hecho, lineaCambio, PantallaSolicitud, PieEditar, SelectorTipo, tipoDe, useGuardado, useSinGuardar, VentanaFormulario,
} from "./Formulario";

export interface DuenioNota {
  tipo: "Person" | "Family" | "Event";
  handle: string;
}

/** El tipo de una nota nueva, como en Gramps: «Nota de persona», «Nota de
 * familia», «Nota de evento». */
const TIPO_NOTA: Record<DuenioNota["tipo"], number> = { Person: 4, Family: 9, Event: 10 };

/** Texto de una nota, recortado (para las líneas del conflicto). */
export const textoCorto = (s: string, n = 60) => {
  const una = s.replace(/\s+/g, " ").trim();
  return una.length > n ? `${una.slice(0, n - 1)}…` : una;
};

/** Una nota nueva, vacía, para `duenio`. */
export function notaNueva(duenio: DuenioNota): Nota {
  const n = plantilla<Nota & ObjetoGramps>("Note");
  n.handle = nuevoHandle();
  const valor = TIPO_NOTA[duenio.tipo];
  n.type = { _class: "NoteType", value: valor, string: "" };
  if (!valoresTipo("NoteType").some((x) => x.value === valor)) n.type.value = 1;
  return n;
}

const tieneFormato = (n: Nota) => ((n.text as { tags?: unknown[] }).tags ?? []).length > 0;

/** La nota con el texto y el tipo del formulario. Si el texto cambia, sin
 * formato (DA-25 a). */
export function notaCon(base: Nota, texto: string, tipo: string): Nota {
  const n = structuredClone(base);
  n.type = tipoDe("NoteType", tipo, base.type);
  if (texto !== base.text.string) n.text = { ...base.text, string: texto, tags: [] } as Nota["text"];
  return n;
}

/** Nombre de la ficha a la que se añade la nota. */
function nombreDuenio(arbol: Arbol, tipo: DuenioNota["tipo"], obj: Base): string {
  if (tipo === "Person") return arbol.nombre(obj as Persona);
  if (tipo === "Family") return arbol.nombreFamilia(obj as Familia);
  return nombreTipo((obj as Evento).type);
}

interface Props {
  abierto: boolean;
  /** La nota que se corrige, o null para una nueva de `duenio`. */
  nota: Nota | null;
  duenio?: DuenioNota;
  /** Como borrador de otro formulario: no guarda; devuelve la nota. */
  borrador?: boolean;
  alTerminar?: (nota: Nota) => void;
  alCerrar: () => void;
}

export function FormularioNota(props: Props) {
  const movil = useMediaQuery("(max-width: 36em)") ?? false;
  const arbol = useArbol();
  const nueva = !props.nota || !arbol.notas.has(props.nota.handle);
  return (
    <VentanaFormulario abierta={props.abierto} alCerrar={props.alCerrar} titulo={nueva ? t("nota.nueva") : t("nota.editar")} movil={movil} zIndex={320}>
      {props.abierto && <Contenido {...props} />}
    </VentanaFormulario>
  );
}

function Contenido({ nota, duenio, borrador = false, alTerminar, alCerrar }: Props) {
  const arbol = useArbol();
  const { paso, setPaso, error, guardar, solicitud } = useGuardado("nota.errorPermiso");
  const nueva = !nota || !arbol.notas.has(nota.handle);
  // Las versiones de las que se parte (cambian si hay conflicto y se vuelve
  // a aplicar sobre la nueva).
  const [base, setBase] = useState<Nota>(() => nota ?? notaNueva(duenio!));
  const [baseDuenio, setBaseDuenio] = useState<Base | null>(() => (duenio ? arbol.mapa(duenio.tipo).get(duenio.handle) ?? null : null));
  const [texto, setTexto] = useState(base.text.string);
  const [tipo, setTipo] = useState(nombreTipo(base.type));
  const [motivo, setMotivo] = useState("");

  const original = nota ?? base;
  const hayCambios = tipo !== nombreTipo(original.type) || texto !== original.text.string;
  useSinGuardar(hayCambios && (paso.tipo === "editar" || paso.tipo === "guardando" || paso.tipo === "solicitud"));
  const valido = !!texto.trim() && !!tipo.trim();
  const pierdeFormato = tieneFormato(base) && texto !== base.text.string;

  async function enviar() {
    const despues = notaCon(base, texto, tipo);
    const objetos: ObjetoPeticion[] = nueva
      ? [
        { tipo: "Note", handle: despues.handle, operacion: "crear", base: null, despues: despues as unknown as ObjetoGramps },
        {
          tipo: duenio!.tipo, handle: baseDuenio!.handle, operacion: "modificar", base: baseDuenio!.change,
          despues: { ...structuredClone(baseDuenio!), note_list: [...baseDuenio!.note_list, despues.handle] } as unknown as ObjetoGramps,
        },
      ]
      : [{ tipo: "Note", handle: base.handle, operacion: "modificar", base: base.change, despues: despues as unknown as ObjetoGramps }];
    await guardar({ accion: nueva ? "anadirNota" : "editarNota", motivo: motivo.trim() || null, objetos });
  }

  if (paso.tipo === "hecho") return <Hecho marcado={paso.marcado} solicitud={paso.solicitud} alCerrar={alCerrar} />;
  if (paso.tipo === "solicitud") return <PantallaSolicitud paso={paso} motivo={motivo} error={error} solicitud={solicitud} />;

  if (paso.tipo === "conflicto") {
    const deNota = paso.fichas.find((f) => f.tipo === "Note");
    const deDuenio = paso.fichas.find((f) => f.tipo !== "Note");
    const borrada = paso.fichas.some((f) => !f.actual);
    const actualNota = deNota?.actual as unknown as Nota | undefined;
    const lineas = borrada ? null : actualNota
      ? [
        ...(nombreTipo(actualNota.type) !== nombreTipo(base.type) ? [lineaCambio(t("col.tipo"), nombreTipo(base.type), nombreTipo(actualNota.type))] : []),
        ...(actualNota.text.string !== base.text.string ? [lineaCambio(t("nota.texto"), textoCorto(base.text.string), textoCorto(actualNota.text.string))] : []),
      ]
      : [];
    return (
      <Conflicto
        titulo={deNota ? t("nota.conflicto") : t("nota.conflictoDuenio")}
        lineas={lineas}
        otros={deNota ? t("formulario.conflictoOtrosCampos") : t("nota.conflictoDuenioAyuda")}
        alDescartar={alCerrar}
        alVolverAAplicar={() => {
          if (actualNota) setBase(actualNota);
          if (deDuenio?.actual) setBaseDuenio(deDuenio.actual as unknown as Base);
          setPaso({ tipo: "editar" });
        }}
      />
    );
  }

  const pie = (arriba?: "ventana") => (
    <PieEditar
      arriba={arriba}
      alCancelar={alCerrar}
      alGuardar={() => {
        if (borrador) {
          alTerminar?.(notaCon(base, texto, tipo));
          alCerrar();
        } else void enviar();
      }}
      puedeGuardar={valido && (nueva || hayCambios)}
      guardando={paso.tipo === "guardando"}
      error={error}
      rotulo={borrador ? t("nota.usar") : undefined}
    />
  );
  return (
    <Stack>
      {pie("ventana")}
      {duenio && nueva && baseDuenio && <Text size="sm" c="dimmed">{t("nota.de", { nombre: nombreDuenio(arbol, duenio.tipo, baseDuenio) })}</Text>}
      <SelectorTipo clase="NoteType" label={t("col.tipo")} valor={tipo} alCambiar={setTipo} />
      <Textarea
        label={t("nota.texto")}
        value={texto}
        onChange={(e) => setTexto(e.currentTarget.value)}
        autosize
        minRows={5}
        maxRows={20}
        error={!texto.trim() ? t("nota.faltaTexto") : undefined}
        data-autofocus
      />
      {pierdeFormato && <Alert color="yellow">{t("nota.perderaFormato")}</Alert>}
      {!borrador && <CampoMotivo valor={motivo} alCambiar={setMotivo} />}
      {pie()}
    </Stack>
  );
}
