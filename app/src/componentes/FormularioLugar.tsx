// Formulario de lugar (fase 3, paso 9; docs/edicion.md, «Formularios de
// lugar y nota»). Para empezar (decisión de Carlos del 25/10/2026): nombre,
// tipo, «situado en» y coordenadas. Los nombres en otros idiomas y el código
// se conservan tal cual, sin editarlos todavía; el título no se escribe: se
// forma con la jerarquía, como en Gramps 6 (Arbol.tituloLugar).
//
// Cualquiera puede crear un lugar; corregir uno que ya existe, solo quien lo
// creó y el administrador (docs/edicion.md, «Rama y permisos»).
//
// Como la nota, por su cuenta (guarda con la función del servidor) o como
// borrador dentro del formulario de evento («Nuevo lugar»), que lo guarda
// con el evento en un solo «Guardar».

import { useMemo, useState } from "react";
import { Alert, Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { nuevoHandle, type ObjetoGramps } from "../../../comun/gramps.ts";
import { plantilla } from "../../../comun/esquema.ts";
import { useSesion } from "../acceso/sesion";
import type { Arbol } from "../arbol/arbol";
import { useArbol } from "../arbol/contexto";
import { textoFecha } from "../arbol/fechas";
import type { Base, Lugar, Ref } from "../arbol/tipos";
import { RecordPicker } from "../gramps-connect/formularios/RecordPicker";
import { BorrarFicha } from "./BorrarFicha";
import { nombreTipo, t } from "../i18n";
import {
  AvisoPropuesta, CampoMotivo, Conflicto, Hecho, lineaCambio, PantallaSolicitud, PieEditar, SelectorTipo, tipoDe, useGuardado, useSinGuardar, VentanaFormulario,
} from "./Formulario";

/** «Situado en»: la referencia completa (con su fecha, que se conserva). */
type RefLugar = Ref & { date?: unknown };

interface Campos {
  nombre: string;
  tipo: string;
  superiores: RefLugar[];
  lat: string;
  long: string;
}

const camposDe = (l: Lugar): Campos => ({
  nombre: l.name.value,
  tipo: nombreTipo(l.place_type),
  superiores: l.placeref_list as RefLugar[],
  lat: l.lat,
  long: l.long,
});

/** Un lugar nuevo, vacío. */
export function lugarNuevo(): Lugar {
  const l = plantilla<Lugar & ObjetoGramps>("Place");
  l.handle = nuevoHandle();
  return l;
}

/** Coordenada en grados con decimales dentro de ±max, o vacía. Una que no
 * se ha tocado se acepta tal cual (Gramps admite otros formatos). */
const coordenadaValida = (v: string, antes: string, max: number) => {
  const x = v.trim();
  if (x === antes.trim() || !x) return true;
  return /^-?\d+(\.\d+)?$/.test(x) && Math.abs(Number(x)) <= max;
};

/** Los lugares que no pueden ir en «situado en» de `handle`: él mismo y
 * los que contiene, a cualquier profundidad (sería un ciclo). */
function contenidos(arbol: Arbol, handle: string): Set<string> {
  const hijos = new Map<string, string[]>();
  for (const l of arbol.lugares.values()) {
    for (const r of l.placeref_list) {
      if (!hijos.has(r.ref)) hijos.set(r.ref, []);
      hijos.get(r.ref)!.push(l.handle);
    }
  }
  const salida = new Set([handle]);
  const pendientes = [handle];
  while (pendientes.length) {
    for (const h of hijos.get(pendientes.pop()!) ?? []) {
      if (!salida.has(h)) {
        salida.add(h);
        pendientes.push(h);
      }
    }
  }
  return salida;
}

/** El lugar con lo que hay en el formulario. */
function lugarCon(base: Lugar, c: Campos): Lugar {
  const l = structuredClone(base);
  l.name = { ...l.name, value: c.nombre.trim() };
  l.place_type = tipoDe("PlaceType", c.tipo, base.place_type);
  l.placeref_list = structuredClone(c.superiores);
  l.lat = c.lat.trim();
  l.long = c.long.trim();
  return l;
}

/** Título de un lugar que quizá aún no está en el árbol (un borrador). */
export function tituloBorrador(arbol: Arbol, l: Lugar): string {
  return [l.name.value, arbol.tituloLugar(l.placeref_list[0]?.ref)].filter(Boolean).join(", ");
}

interface Props {
  abierto: boolean;
  /** El lugar que se corrige, o null para uno nuevo. */
  lugar: Lugar | null;
  /** Como borrador de otro formulario: no guarda; devuelve el lugar. */
  borrador?: boolean;
  alTerminar?: (lugar: Lugar) => void;
  alCerrar: () => void;
}

export function FormularioLugar(props: Props) {
  const movil = useMediaQuery("(max-width: 36em)") ?? false;
  const arbol = useArbol();
  const nuevo = !props.lugar || !arbol.lugares.has(props.lugar.handle);
  return (
    <VentanaFormulario abierta={props.abierto} alCerrar={props.alCerrar} titulo={nuevo ? t("lugar.nuevo") : t("lugar.editar")} movil={movil} zIndex={320}>
      {props.abierto && <Contenido {...props} />}
    </VentanaFormulario>
  );
}

function Contenido({ lugar, borrador = false, alTerminar, alCerrar }: Props) {
  const arbol = useArbol();
  const admin = useSesion().invitacion.rol === "administrador";
  const { paso, setPaso, error, guardar, solicitud } = useGuardado("lugar.errorPermiso");
  const nuevo = !lugar || !arbol.lugares.has(lugar.handle);
  const [base, setBase] = useState<Lugar>(() => lugar ?? lugarNuevo());
  const inicial = useMemo(() => camposDe(lugar ?? base), [lugar, base]);
  const [campos, setCampos] = useState<Campos>(inicial);
  const [motivo, setMotivo] = useState("");
  const [eligiendo, setEligiendo] = useState(false);
  const excluir = useMemo(() => contenidos(arbol, base.handle), [arbol, base.handle]);
  const fijar = <K extends keyof Campos>(c: K, v: Campos[K]) => setCampos((x) => ({ ...x, [c]: v }));

  const titulos = (refs: RefLugar[]) => refs.map((r) => arbol.tituloLugar(r.ref)).join("; ");
  const lineas = (de: Campos, a: Campos) => {
    const l: string[] = [];
    if (de.nombre.trim() !== a.nombre.trim()) l.push(lineaCambio(t("lugar.nombre"), de.nombre.trim(), a.nombre.trim()));
    if (de.tipo !== a.tipo) l.push(lineaCambio(t("col.tipo"), de.tipo, a.tipo));
    if (titulos(de.superiores) !== titulos(a.superiores)) l.push(lineaCambio(t("lugar.situadoEn"), titulos(de.superiores), titulos(a.superiores)));
    if (de.lat.trim() !== a.lat.trim() || de.long.trim() !== a.long.trim()) {
      const c = (x: Campos) => (x.lat.trim() || x.long.trim() ? `${x.lat.trim()}, ${x.long.trim()}` : "");
      l.push(lineaCambio(t("lugar.coordenadas"), c(de), c(a)));
    }
    return l;
  };
  const cambios = lineas(inicial, campos);
  useSinGuardar(cambios.length > 0 && (paso.tipo === "editar" || paso.tipo === "guardando" || paso.tipo === "solicitud"));
  const latBien = coordenadaValida(campos.lat, inicial.lat, 90);
  const longBien = coordenadaValida(campos.long, inicial.long, 180);
  const valido = !!campos.nombre.trim() && !!campos.tipo.trim() && latBien && longBien;

  async function enviar() {
    const despues = lugarCon(base, campos);
    await guardar({
      accion: nuevo ? "crearLugar" : "editarLugar",
      motivo: motivo.trim() || null,
      objetos: [{
        tipo: "Place", handle: despues.handle, operacion: nuevo ? "crear" : "modificar", base: nuevo ? null : base.change,
        despues: despues as unknown as ObjetoGramps,
      }],
    });
  }

  if (paso.tipo === "hecho") return <Hecho marcado={paso.marcado} solicitud={paso.solicitud} alCerrar={alCerrar} />;
  if (paso.tipo === "solicitud") return <PantallaSolicitud paso={paso} motivo={motivo} error={error} solicitud={solicitud} />;

  if (paso.tipo === "conflicto") {
    const actual = paso.fichas[0]?.actual as unknown as Lugar | null;
    return (
      <Conflicto
        titulo={t("lugar.conflicto")}
        lineas={actual ? lineas(camposDe(base), camposDe(actual)) : null}
        otros={t("formulario.conflictoOtrosCampos")}
        alDescartar={alCerrar}
        alVolverAAplicar={() => {
          if (actual) setBase(actual);
          setPaso({ tipo: "editar" });
        }}
      />
    );
  }

  const conOtrosDatos = base.alt_names.length > 0 || !!(base as { code?: string }).code;
  const pie = (arriba?: "ventana") => (
    <PieEditar
      arriba={arriba}
      alCancelar={alCerrar}
      alGuardar={() => {
        if (borrador) {
          alTerminar?.(lugarCon(base, campos));
          alCerrar();
        } else void enviar();
      }}
      puedeGuardar={valido && (nuevo || cambios.length > 0)}
      guardando={paso.tipo === "guardando"}
      error={error}
      rotulo={borrador ? t("lugar.usar") : undefined}
    />
  );
  return (
    <Stack>
      {pie("ventana")}
      <AvisoPropuesta />
      {admin && !nuevo && <Text size="sm" c="dimmed">{t("col.id")}: {base.gramps_id}</Text>}
      <TextInput
        label={t("lugar.nombre")}
        value={campos.nombre}
        onChange={(e) => fijar("nombre", e.currentTarget.value)}
        error={!campos.nombre.trim() ? t("lugar.faltaNombre") : undefined}
        data-autofocus
      />
      <SelectorTipo clase="PlaceType" label={t("col.tipo")} valor={campos.tipo} alCambiar={(v) => fijar("tipo", v)} />
      <Stack gap={4}>
        <Text size="sm" fw={500}>{t("lugar.situadoEn")}</Text>
        <Text size="xs" c="dimmed">{t("lugar.situadoEnAyuda")}</Text>
        {campos.superiores.length === 0 && <Text size="sm" c="dimmed">{t("lugar.sinSuperior")}</Text>}
        {campos.superiores.map((r, i) => {
          const fecha = r.date ? textoFecha(r.date as never) : "";
          return (
            <Group key={`${r.ref}-${i}`} gap="xs" wrap="nowrap">
              <Text style={{ flex: 1 }}>{arbol.tituloLugar(r.ref)}{fecha ? ` (${fecha})` : ""}</Text>
              <Button size="xs" variant="default" onClick={() => fijar("superiores", campos.superiores.filter((_, j) => j !== i))}>{t("lugar.quitar")}</Button>
            </Group>
          );
        })}
        <Group gap="xs">
          <Button size="xs" variant="default" onClick={() => setEligiendo((x) => !x)}>{t("lugar.anadirSuperior")}</Button>
        </Group>
        {eligiendo && (
          <RecordPicker
            tipo="Place"
            placeholder={t("lugar.buscarSuperior")}
            rotulo={(o: Base) => arbol.tituloLugar(o.handle)}
            conIds={admin}
            excluir={new Set([...excluir, ...campos.superiores.map((r) => r.ref)])}
            alElegir={(o) => {
              fijar("superiores", [...campos.superiores, { ...plantilla<RefLugar>("PlaceRef"), ref: o.handle }]);
              setEligiendo(false);
            }}
          />
        )}
      </Stack>
      <Stack gap={4}>
        <Text size="sm" fw={500}>{t("lugar.coordenadas")}</Text>
        <Text size="xs" c="dimmed">{t("lugar.coordenadasAyuda")}</Text>
        <Group grow align="flex-start">
          <TextInput label={t("col.latitud")} value={campos.lat} onChange={(e) => fijar("lat", e.currentTarget.value)} error={latBien ? undefined : t("lugar.errorLatitud")} inputMode="decimal" />
          <TextInput label={t("col.longitud")} value={campos.long} onChange={(e) => fijar("long", e.currentTarget.value)} error={longBien ? undefined : t("lugar.errorLongitud")} inputMode="decimal" />
        </Group>
      </Stack>
      {campos.nombre.trim() && <Text size="sm" c="dimmed">{t("lugar.seVera", { titulo: tituloBorrador(arbol, lugarCon(base, campos)) })}</Text>}
      {conOtrosDatos && <Alert color="gray">{t("lugar.otrosDatos")}</Alert>}
      {!borrador && <CampoMotivo valor={motivo} alCambiar={setMotivo} />}
      {!borrador && !nuevo && <Group><BorrarFicha tipo="Place" handle={base.handle} alBorrar={alCerrar} /></Group>}
      {pie()}
    </Stack>
  );
}
