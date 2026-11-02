// Piezas para las personas nuevas (fase 3, paso 10): una persona vacía con
// su handle y el selector del sexo. El formulario de una persona nueva es el
// de persona, en una ventana (VentanaPersona, en EditarPersona.tsx).

import { Select } from "@mantine/core";
import { plantilla } from "../../../comun/esquema.ts";
import { nuevoHandle, type ObjetoGramps } from "../../../comun/gramps.ts";
import type { Persona } from "../arbol/tipos";
import { t, type Clave } from "../i18n";
import type { NombreGramps } from "./EditorNombre";

const SEXOS = [0, 1, 2, 3];
const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Una persona vacía, con su handle, el nombre y el sexo dados. */
export function personaNueva(nombre: NombreGramps, sexo: number): Persona {
  const p = plantilla<Persona & ObjetoGramps>("Person");
  p.handle = nuevoHandle();
  p.primary_name = nombre;
  p.gender = sexo;
  return p;
}

/** Selector del sexo de una persona. */
export function SelectorSexo({ valor, alCambiar }: { valor: number; alCambiar: (v: number) => void }) {
  return (
    <Select
      label={t("col.sexo")}
      data={SEXOS.map((v) => ({ value: String(v), label: mayuscula(t(`ficha.sexo.${v}` as Clave)) }))}
      value={String(valor)}
      onChange={(v) => { if (v !== null) alCambiar(Number(v)); }}
      allowDeselect={false}
      maw={260}
    />
  );
}
