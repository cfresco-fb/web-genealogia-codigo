// Solicitudes pendientes en la ficha (peticiones de Carlos del 28/10/2026):
// quien pidió un cambio lo ve en la ficha, para que no crea que no se ha
// guardado y lo vuelva a pedir, y sin tener que ir a «Solicitudes» para
// saber qué pidió. El administrador ve las de todos.
//
// - Arriba, un aviso con cada solicitud y lo que pide, línea a línea.
// - Dentro de la ficha, lo pedido en su sitio, en cursiva y con la marca
//   «Pendiente» (que lleva a la solicitud): los eventos nuevos, cambiados o
//   que se quitan; en la persona, el nombre (con el apodo), el sexo y los
//   otros nombres; en la familia, el padre, la madre y los hijos.
//
// Una solicitud toca la ficha si cambia o borra la ficha misma, o uno de
// sus eventos, notas o fotos.

import { useEffect, useMemo, useState } from "react";
import { Alert, Anchor, Badge, List, Stack, Text } from "@mantine/core";
import { Link } from "react-router";
import type { ObjetoGramps, Tipo } from "../../../comun/gramps.ts";
import { useSesion } from "../acceso/sesion";
import { useArbol } from "../arbol/contexto";
import { textoMomento } from "../arbol/fechas";
import type { Base, EventRef, Evento, MediaRef, TipoGramps } from "../arbol/tipos";
import { t } from "../i18n";
import { leerPendientes, type SolicitudWeb } from "../solicitudes";
import { type Cambio, cambiosDePropuesta, Descripcion } from "./cambiosSolicitud";

/** Lo pedido en los eventos de la ficha: los nuevos (con la solicitud que
 * los pide), los cambiados (cómo quedarían) y los que se quitan. */
export interface EventosPendientes {
  nuevos: { evento: Evento; rol: TipoGramps; solicitud: string }[];
  cambiados: Map<string, { evento: Evento; solicitud: string }>;
  quitados: Map<string, string>;
}

export interface Pendientes {
  solicitudes: { s: SolicitudWeb; titulo: string; lineas: string[] }[];
  /** Cómo quedaría la ficha misma, con la solicitud más nueva que la cambia. */
  propuesta: { objeto: ObjetoGramps; solicitud: string } | null;
  eventos: EventosPendientes;
  /** Cómo quedarían las fichas que piden («Person_h» → objeto), para
   * nombrar las nuevas (un hijo nuevo). */
  fichas: Map<string, ObjetoGramps>;
}

const VACIAS: Pendientes = { solicitudes: [], propuesta: null, eventos: { nuevos: [], cambiados: new Map(), quitados: new Map() }, fichas: new Map() };

export function usePendientes(tipo: Tipo, handle: string): Pendientes {
  const arbol = useArbol();
  const { invitacion } = useSesion();
  const admin = invitacion.rol === "administrador";
  const [todas, setTodas] = useState<SolicitudWeb[]>([]);
  useEffect(() => {
    let vivo = true;
    // Si no se pueden leer, sin aviso (la ficha se ve igual).
    leerPendientes(admin ? null : invitacion.correo).then((l) => { if (vivo) setTodas(l); }, () => undefined);
    return () => { vivo = false; };
  }, [admin, invitacion.correo, tipo, handle]);

  return useMemo(() => {
    const ficha = arbol.obtener(tipo, handle) as (Base & { event_ref_list?: EventRef[]; media_list?: MediaRef[] }) | null;
    if (!ficha || !todas.length) return VACIAS;
    // Lo que cuelga de la ficha: sus eventos, notas y fotos.
    const refs = ficha.event_ref_list ?? [];
    const colgantes = new Set([
      ...refs.map((r) => `Event_${r.ref}`),
      ...ficha.note_list.map((h) => `Note_${h}`),
      ...(ficha.media_list ?? []).map((r) => `Media_${r.ref}`),
    ]);
    const salida: Pendientes = { solicitudes: [], propuesta: null, eventos: { nuevos: [], cambiados: new Map(), quitados: new Map() }, fichas: new Map() };
    // De la más nueva a la más vieja: si dos piden lo mismo, manda la nueva.
    for (const s of todas) {
      if (!s.objetos.some((o) => (o.tipo === tipo && o.handle === handle) || colgantes.has(`${o.tipo}_${o.handle}`))) continue;
      const cambios = cambiosDePropuesta(arbol, s.objetos);
      const d = new Descripcion(arbol, cambios, s.noPermitidos);
      const { lineas, grupos } = d.describir(s.clase, s.principal);
      salida.solicitudes.push({ s, titulo: d.titulo(s.clase, s.principal), lineas: [...lineas, ...grupos.flatMap((g) => [g.titulo, ...g.lineas])] });
      const propia = cambios.find((c) => c.tipo === tipo && c.handle === handle);
      if (propia?.despues && !salida.propuesta) salida.propuesta = { objeto: propia.despues, solicitud: s.id };
      for (const c of cambios) if (c.despues && !salida.fichas.has(`${c.tipo}_${c.handle}`)) salida.fichas.set(`${c.tipo}_${c.handle}`, c.despues);
      eventosDe(salida.eventos, s.id, refs, propia, cambios, (h) => arbol.eventos.get(h) ?? null);
    }
    return salida;
  }, [arbol, todas, tipo, handle]);
}

function eventosDe(out: EventosPendientes, id: string, refs: EventRef[], propia: Cambio | undefined, cambios: Cambio[], delArbol: (h: string) => Evento | null) {
  const evento = (h: string) => (cambios.find((c) => c.tipo === "Event" && c.handle === h)?.despues as unknown as Evento | undefined) ?? delArbol(h);
  const ahora = new Set(refs.map((r) => r.ref));
  // (Si se pide borrar la ficha entera, lo dice el aviso de arriba.)
  if (propia?.despues) {
    const despues = (propia.despues.event_ref_list as EventRef[] | undefined) ?? [];
    const quedan = new Set(despues.map((r) => r.ref));
    for (const r of despues) {
      const e = evento(r.ref);
      if (!ahora.has(r.ref) && e && !out.nuevos.some((n) => n.evento.handle === r.ref)) out.nuevos.push({ evento: e, rol: r.role, solicitud: id });
    }
    for (const h of ahora) if (!quedan.has(h) && !out.quitados.has(h)) out.quitados.set(h, id);
  }
  for (const c of cambios) {
    if (c.tipo === "Event" && c.operacion === "modificar" && ahora.has(c.handle) && c.despues && !out.cambiados.has(c.handle)) {
      out.cambiados.set(c.handle, { evento: c.despues as unknown as Evento, solicitud: id });
    }
  }
}

/** «Pendiente», que lleva a la solicitud. */
export function MarcaPendiente({ solicitud, texto = t("pendientes.marca") }: { solicitud: string; texto?: string }) {
  return (
    <Badge component={Link} to={`/solicitudes/${solicitud}`} color="yellow" variant="light" tt="none" style={{ cursor: "pointer", flexShrink: 0, overflow: "visible" }}>
      {texto}
    </Badge>
  );
}

/** Un dato con lo pedido: el nuevo en cursiva, el de ahora tachado, y la
 * marca. Si no hay nada pedido, el de ahora. */
export function DatoPendiente({ actual, propuesto, solicitud }: { actual: React.ReactNode; propuesto?: string; solicitud?: string }) {
  if (propuesto === undefined || !solicitud) return <>{actual}</>;
  return (
    <>
      <Text span fs="italic" inherit>{propuesto || t("ficha.sinDatos")}</Text>{" "}
      <Text span td="line-through" c="dimmed" inherit>{actual}</Text>{" "}
      <MarcaPendiente solicitud={solicitud} />
    </>
  );
}

export function AvisoSolicitudes({ pendientes }: { pendientes: Pendientes }) {
  const arbol = useArbol();
  const { invitacion } = useSesion();
  const admin = invitacion.rol === "administrador";
  const { solicitudes } = pendientes;
  if (!solicitudes.length) return null;
  const de = (s: SolicitudWeb) => (s.autor.correo === invitacion.correo ? "" : arbol.nombre(arbol.persona(s.autor.persona)) || s.autor.correo);
  return (
    <Alert color="yellow" title={t(admin ? "pendientes.tituloAdmin" : "pendientes.titulo")}>
      <Stack gap="sm">
        <Text size="sm">{t(admin ? "pendientes.ayudaAdmin" : "pendientes.ayuda")}</Text>
        {solicitudes.map(({ s, titulo, lineas }) => (
          <Stack key={s.id} gap={2}>
            <Text size="sm">
              <Anchor component={Link} to={`/solicitudes/${s.id}`} inherit fw={600}>{titulo}</Anchor>
              {" · "}{[textoMomento(s.fecha.toDate(), true), de(s)].filter(Boolean).join(" · ")}
            </Text>
            {lineas.length > 0 && <List size="sm">{lineas.map((l, i) => <List.Item key={i}>{l}</List.Item>)}</List>}
          </Stack>
        ))}
      </Stack>
    </Alert>
  );
}
