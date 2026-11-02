// «Modificar y aplicar» una solicitud (paso 14; DA-20 a): el formulario de
// la ficha, abierto con `?resuelve=s0000012`, enseña arriba lo que se pidió
// para rehacerlo a mano, y en «Fotos» las que traía, para añadirlas
// (`useFotosSolicitud`). Al guardar, la solicitud queda aplicada con ese
// cambio, y el motivo es el comentario que ve quien la pidió.

import { useEffect, useMemo, useState } from "react";
import { Alert, Anchor, Button, List, Stack, Text } from "@mantine/core";
import { Link } from "react-router";
import { plantilla } from "../../../comun/esquema.ts";
import { clave } from "../../../comun/gramps.ts";
import { useArbol } from "../arbol/contexto";
import type { MediaRef, Multimedia } from "../arbol/tipos";
import { t } from "../i18n";
import { leerHistorial, type EntradaRegistro } from "../registro";
import { fichasCambiadas, leerSolicitud, type SolicitudWeb } from "../solicitudes";
import { cambiosDePropuesta, Descripcion, laFicha, mayuscula } from "./cambiosSolicitud";
import { ID_FOTOS_SOLICITUD, type FotoApartada } from "./SeccionesFormulario";

// La solicitud se lee una vez para el aviso y para las fotos.
const leidas = new Map<string, Promise<SolicitudWeb | null>>();
function useSolicitud(id: string | null): SolicitudWeb | null | undefined {
  const [s, setS] = useState<SolicitudWeb | null | undefined>(undefined);
  useEffect(() => {
    if (!id) return;
    let p = leidas.get(id);
    if (!p) {
      p = leerSolicitud(id).catch(() => null);
      leidas.set(id, p);
    }
    let vigente = true;
    void p.then((r) => { if (vigente) setS(r); });
    return () => { vigente = false; leidas.delete(id); };
  }, [id]);
  return id ? s : null;
}

/** Las fotos de la solicitud `id` que el administrador puede añadir a la
 * ficha `handle`: el Media que se pidió crear y su referencia (la de esta
 * ficha en la propuesta, con su recorte; si no, una vacía). */
export function useFotosSolicitud(id: string | null, handle: string): FotoApartada[] {
  const s = useSolicitud(id);
  return useMemo(() => {
    if (!s || s.estado !== "pendiente") return [];
    const despues = (h: string) => {
      const o = s.objetos.find((x) => x.handle === h);
      return o?.despues ? JSON.parse(o.despues) : null;
    };
    const ficha = despues(handle) as { media_list?: MediaRef[] } | null;
    return s.ficheros.flatMap((f) => {
      const media = despues(f.handle) as Multimedia | null;
      if (!media) return [];
      const ref = ficha?.media_list?.find((r) => r.ref === f.handle) ?? { ...plantilla<MediaRef>("MediaRef"), ref: f.handle };
      return [{ media, ref, subida: f.subida, correo: s.autor.correo }];
    });
  }, [s, handle]);
}

/** Las fichas de la solicitud que han cambiado desde que se pidió, cada
 * una con los cambios del registro que la tocaron después (por qué «Aplicar»
 * da CONFLICTO). Nada si no ha cambiado ninguna. */
export function CambiadasDesde({ s }: { s: SolicitudWeb }) {
  const arbol = useArbol();
  const fichas = useMemo(() => fichasCambiadas(arbol, s), [arbol, s]);
  const claves = fichas.map((f) => clave(f.tipo, f.handle)).join(" ");
  const [cambios, setCambios] = useState<EntradaRegistro[]>([]);
  useEffect(() => {
    if (!claves) return;
    let vigente = true;
    leerHistorial(claves.split(" ")).then(
      (l) => { if (vigente) setCambios(l.filter((e) => e.fecha.toMillis() > s.fecha.toMillis()).reverse()); },
      () => undefined,
    );
    return () => { vigente = false; };
  }, [claves, s.fecha]);
  if (!fichas.length) return null;
  return (
    <List size="sm">
      {fichas.map((f) => {
        const k = clave(f.tipo, f.handle);
        const suyos = cambios.filter((e) => e.objetos.some((o) => clave(o.tipo, o.handle) === k));
        return (
          <List.Item key={k}>
            {mayuscula(laFicha(arbol, f.tipo, f.handle))}
            {suyos.length > 0 && <>{t("solicitud.cambiadaEn")} {suyos.map((e, i) => (
              <span key={e.id}>{i > 0 && ", "}<Anchor component={Link} to={`/cambios/${e.id}`} inherit>{e.id}</Anchor></span>
            ))}</>}
          </List.Item>
        );
      })}
    </List>
  );
}

export function PropuestaALaVista({ id }: { id: string }) {
  const arbol = useArbol();
  const s = useSolicitud(id);
  const d = useMemo(() => {
    if (!s) return null;
    const desc = new Descripcion(arbol, cambiosDePropuesta(arbol, s.objetos), s.noPermitidos);
    return { titulo: desc.titulo(s.clase, s.principal), ...desc.describir(s.clase, s.principal) };
  }, [arbol, s]);
  const enlace = <Anchor component={Link} to={`/solicitudes/${id}`} inherit>{t("solicitud.verSolicitud")}</Anchor>;
  if (s === undefined) return null;
  if (!s || !d) return <Alert color="red">{t("solicitud.noExiste")}</Alert>;
  if (s.estado !== "pendiente") return <Alert color="yellow">{t("solicitud.yaResuelta")} {enlace}</Alert>;
  const cambiada = fichasCambiadas(arbol, s).length > 0;
  const irAFotos = () => document.getElementById(ID_FOTOS_SOLICITUD)?.scrollIntoView({ behavior: "smooth", block: "center" });
  return (
    <Alert color="blue" title={t("solicitud.modificando", { titulo: d.titulo })}>
      <Stack gap={6}>
        <Text size="sm">{t("solicitud.motivoDe", { texto: s.motivo })}</Text>
        {d.lineas.length > 0 && <List size="sm">{d.lineas.map((l, i) => <List.Item key={i}>{l}</List.Item>)}</List>}
        {d.grupos.map((g, i) => (
          <Stack key={i} gap={2}>
            <Text size="sm" fw={600}>{g.titulo}</Text>
            {g.lineas.length > 0 && <List size="sm">{g.lineas.map((l, j) => <List.Item key={j}>{l}</List.Item>)}</List>}
          </Stack>
        ))}
        {cambiada && (
          <Stack gap={2}>
            <Text size="sm" fw={600}>{t("solicitud.cambiadasTitulo")}</Text>
            <CambiadasDesde s={s} />
            <Text size="sm">{t("solicitud.cambiadasModificar")}</Text>
          </Stack>
        )}
        <Text size="sm" fw={600}>{t("solicitud.queHacer")}</Text>
        <List size="sm" type="ordered">
          {s.ficheros.length > 0 && (
            <List.Item>
              {t("solicitud.pasoFotos", { n: s.ficheros.length })}{" "}
              <Button size="compact-xs" variant="default" onClick={irAFotos}>{t("solicitud.irAFotos")}</Button>
            </List.Item>
          )}
          <List.Item>{t(s.ficheros.length > 0 ? "solicitud.pasoResto" : "solicitud.pasoCambios")}</List.Item>
          <List.Item>{t("solicitud.pasoGuardar")}</List.Item>
        </List>
        <Text size="sm">{enlace}</Text>
      </Stack>
    </Alert>
  );
}
