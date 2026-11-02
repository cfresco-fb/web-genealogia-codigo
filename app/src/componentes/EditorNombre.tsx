// Editor de un nombre de persona (fase 3, paso 10; docs/edicion.md,
// «Formularios de persona y familia»), escrito nuevo mirando el de Gramps
// Connect (NameEditDialog.tsx): nombre de pila, apellidos (varios, con
// prefijo, conector y cuál es el principal), sufijo, título, apodo, nombre
// usual, tipo y fecha. Lo demás del nombre (origen de cada apellido,
// agrupación, orden, citas y notas, decisión del 25/10/2026) se conserva tal
// cual.

import { useState } from "react";
import { ActionIcon, Button, Group, Modal, Radio, Stack, Text, TextInput } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { plantilla } from "../../../comun/esquema.ts";
import { completarFecha } from "../arbol/leerFecha";
import type { Apellido, Nombre } from "../arbol/tipos";
import { DateInput } from "../gramps-connect/formularios/DateInput";
import type { GrampsDate } from "../gramps-connect/gramps-date";
import { nombreTipo, t } from "../i18n";
import { SelectorTipo, tipoDe } from "./Formulario";
import { Ayuda } from "./ListaEditable";

/** Un nombre de Gramps completo (con los campos que no se editan aquí). */
export type NombreGramps = Nombre & { date: GrampsDate; [campo: string]: unknown };

/** Un nombre vacío, del tipo «Nombre al nacer». */
export const nombreNuevo = (): NombreGramps => {
  const n = plantilla<NombreGramps>("Name");
  n.surname_list = [apellidoNuevo(true)];
  return n;
};

const apellidoNuevo = (primary: boolean): Apellido => ({ ...plantilla<Apellido>("Surname"), primary });

/** «Nombre Apellidos», para las listas del formulario. */
export function textoNombre(n: Nombre): string {
  const apellidos = n.surname_list.map((s) => [s.prefix, s.surname, s.connector].filter(Boolean).join(" ")).filter(Boolean).join(" ");
  return [n.title, n.first_name, apellidos, n.suffix].filter(Boolean).join(" ") || t("persona.sinNombre");
}

/** El nombre sin espacios sobrantes; los apellidos vacíos fuera (si queda
 * alguno, uno es el principal). */
export function limpiarNombre(n: NombreGramps): NombreGramps {
  const limpio = structuredClone(n);
  for (const c of ["first_name", "suffix", "title", "nick", "call"] as const) limpio[c] = limpio[c].trim();
  limpio.surname_list = limpio.surname_list
    .map((s) => ({ ...s, surname: s.surname.trim(), prefix: s.prefix.trim(), connector: s.connector.trim() }))
    .filter((s) => s.surname || s.prefix);
  if (limpio.surname_list.length && !limpio.surname_list.some((s) => s.primary)) limpio.surname_list[0].primary = true;
  return limpio;
}

/** Los campos de un nombre, para usarlos en una ventana o en otro
 * formulario. */
export function CamposNombre({ valor, alCambiar, conTipo = true, conFecha = true }: {
  valor: NombreGramps;
  alCambiar: (n: NombreGramps) => void;
  conTipo?: boolean;
  conFecha?: boolean;
}) {
  const [tipo, setTipo] = useState(nombreTipo(valor.type));
  const fijar = (cambios: Partial<NombreGramps>) => alCambiar({ ...valor, ...cambios });
  const fijarApellido = (i: number, cambios: Partial<Apellido>) =>
    fijar({ surname_list: valor.surname_list.map((s, j) => (j === i ? { ...s, ...cambios } : s)) });
  return (
    <Stack gap="sm">
      <TextInput label={t("nombre.pila")} value={valor.first_name} onChange={(e) => fijar({ first_name: e.currentTarget.value })} data-autofocus />
      <Stack gap={4}>
        <Text size="sm" fw={500}>{t("nombre.apellidos")}</Text>
        <Radio.Group
          value={String(valor.surname_list.findIndex((s) => s.primary))}
          onChange={(v) => fijar({ surname_list: valor.surname_list.map((s, j) => ({ ...s, primary: String(j) === v })) })}
        >
          <Stack gap="xs">
            {valor.surname_list.map((s, i) => (
              <Group key={i} gap="xs" align="flex-end" wrap="wrap">
                <TextInput w={90} label={i === 0 ? t("nombre.prefijo") : undefined} aria-label={t("nombre.prefijo")} value={s.prefix}
                  onChange={(e) => fijarApellido(i, { prefix: e.currentTarget.value })} />
                <TextInput style={{ flex: 1, minWidth: 140 }} label={i === 0 ? t("nombre.apellido") : undefined} aria-label={t("nombre.apellido")}
                  value={s.surname} onChange={(e) => fijarApellido(i, { surname: e.currentTarget.value })} />
                <TextInput w={80} label={i === 0 ? t("nombre.conector") : undefined} aria-label={t("nombre.conector")} value={s.connector}
                  onChange={(e) => fijarApellido(i, { connector: e.currentTarget.value })} />
                {valor.surname_list.length > 1 && (
                  <Radio value={String(i)} label={t("nombre.principal")} mb={8} />
                )}
                {valor.surname_list.length > 1 && (
                  <ActionIcon variant="default" size="lg" mb={2} aria-label={t("lista.quitar")}
                    onClick={() => fijar({ surname_list: valor.surname_list.filter((_, j) => j !== i) })}>×</ActionIcon>
                )}
              </Group>
            ))}
          </Stack>
        </Radio.Group>
        <Group gap={6}>
          <Button size="xs" variant="default" onClick={() => fijar({ surname_list: [...valor.surname_list, apellidoNuevo(!valor.surname_list.length)] })}>
            {t("nombre.anadirApellido")}
          </Button>
          <Ayuda rotulo={t("nombre.apellidos")} ayuda={t("nombre.apellidosAyuda")} />
        </Group>
      </Stack>
      <Group grow align="flex-start">
        <TextInput label={t("nombre.titulo")} description={t("nombre.tituloAyuda")} value={valor.title} onChange={(e) => fijar({ title: e.currentTarget.value })} />
        <TextInput label={t("nombre.sufijo")} description={t("nombre.sufijoAyuda")} value={valor.suffix} onChange={(e) => fijar({ suffix: e.currentTarget.value })} />
      </Group>
      <Group grow align="flex-start">
        <TextInput label={t("ficha.apodo")} description={t("nombre.apodoAyuda")} value={valor.nick} onChange={(e) => fijar({ nick: e.currentTarget.value })} />
        <TextInput label={t("nombre.usual")} description={t("nombre.usualAyuda")} value={valor.call} onChange={(e) => fijar({ call: e.currentTarget.value })} />
      </Group>
      {conTipo && (
        <SelectorTipo clase="NameType" label={t("col.tipo")} valor={tipo} alCambiar={(v) => { setTipo(v); fijar({ type: tipoDe("NameType", v, valor.type) }); }} />
      )}
      {conFecha && <DateInput label={t("nombre.fecha")} value={completarFecha(valor.date)} onChange={(f) => fijar({ date: f })} />}
    </Stack>
  );
}

/** Ventana para un nombre: el principal, uno alternativo nuevo o uno que ya
 * estaba. Devuelve el nombre limpio. */
export function EditorNombre({ nombre, titulo, alTerminar, alCerrar }: {
  nombre: NombreGramps | null;
  titulo: string;
  alTerminar: (n: NombreGramps) => void;
  alCerrar: () => void;
}) {
  const movil = useMediaQuery("(max-width: 36em)") ?? false;
  return (
    <Modal opened={!!nombre} onClose={alCerrar} title={titulo} size="lg" fullScreen={movil} zIndex={300}>
      {nombre && <ContenidoNombre nombre={nombre} alTerminar={alTerminar} alCerrar={alCerrar} />}
    </Modal>
  );
}

function ContenidoNombre({ nombre, alTerminar, alCerrar }: { nombre: NombreGramps; alTerminar: (n: NombreGramps) => void; alCerrar: () => void }) {
  const [valor, setValor] = useState(nombre);
  const limpio = limpiarNombre(valor);
  const vacio = !limpio.first_name && !limpio.surname_list.length;
  return (
    <Stack>
      <CamposNombre valor={valor} alCambiar={setValor} />
      {vacio && <Text size="sm" c="red">{t("nombre.faltaNombre")}</Text>}
      <Group justify="flex-end">
        <Button variant="default" onClick={alCerrar}>{t("formulario.cancelar")}</Button>
        <Button disabled={vacio || !valor.type} onClick={() => { alTerminar(limpio); alCerrar(); }}>{t("formulario.hecho")}</Button>
      </Group>
    </Stack>
  );
}
