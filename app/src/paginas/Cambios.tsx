// Registro de cambios en la web (paso 13; docs/edicion.md, «Reversión y
// corrección»), para el administrador y los revisores:
//
// - «Historial» al pie de las fichas de persona y familia (DA-12 b): los
//   cambios que tocaron la ficha o sus eventos, notas y fotos.
// - La página de un cambio (`/cambios/c0000123`): qué cambió, en palabras
//   (cambiosSolicitud.ts), su estado y, si no está revertido, «Revertir»
//   (con la cadena de cambios posteriores que hay que revertir antes, DA-13
//   b) y, el administrador, «Corregir» (el formulario de la ficha, que
//   guarda una corrección; diseño, 5.4).
//
// La lista de cambios marcados y el registro con filtros, en la pantalla de
// administración (paso 14, Administracion.tsx), con `ListaCambios`.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Anchor, Badge, Button, Center, Group, List, Loader, Modal, Stack, Table, Text, Textarea, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { Link, useParams } from "react-router";
import type { Tipo } from "../../../comun/gramps.ts";
import type { Eslabon } from "../../../comun/peticion.ts";
import { useSesion } from "../acceso/sesion";
import type { Arbol } from "../arbol/arbol";
import { useArbol, useEdicion } from "../arbol/contexto";
import { textoMomento } from "../arbol/fechas";
import type { Base, EventRef, MediaRef } from "../arbol/tipos";
import { cambiosDePropuesta, Descripcion, mayuscula } from "../componentes/cambiosSolicitud";
import { rutaEditarFamilia, rutaEditarPersona, rutaFamilia, rutaPersona } from "../componentes/Enlaces";
import { Seccion, Tarjeta } from "../componentes/Ficha";
import { CampoMotivo, textoError } from "../componentes/Formulario";
import { t, type Clave } from "../i18n";
import { aceptarCambio, leerCambio, leerHistorial, objetosPropuesta, type EntradaRegistro, type EstadoCambio } from "../registro";

const COLOR_ESTADO: Record<EstadoCambio, string> = { marcado: "yellow", aceptado: "green", revertido: "gray" };

/** Qué cambió, en palabras. Una carga del árbol (firestore/cargar.ts), con
 * cuántas fichas de cada tipo. */
function describir(arbol: Arbol, e: EntradaRegistro) {
  if (!e.principal) {
    const fichas = Object.entries(e.carga?.fichas ?? {}).map(([tipo, n]) => t("registro.carga.fichas", { tipo: t(`registro.carga.tipo.${tipo}` as Clave), n: String(n) }));
    const lineas = [...(e.carga?.fichero ? [t("registro.carga.fichero", { fichero: e.carga.fichero })] : []), ...fichas];
    if (e.carga?.pruebasVaciadas) lineas.push(t("registro.carga.pruebasVaciadas"));
    return { titulo: t("registro.carga.titulo"), lineas, grupos: [] };
  }
  const clase = e.accion === "borrar" ? "borrado" : "cambio";
  const d = new Descripcion(arbol, cambiosDePropuesta(arbol, objetosPropuesta(e)), []);
  const { lineas, grupos } = e.fuera ? { lineas: [], grupos: [] } : d.describir(clase, e.principal);
  return { titulo: d.titulo(clase, e.principal), lineas, grupos };
}

const fecha = (e: { fecha: { toDate(): Date } }) => textoMomento(e.fecha.toDate(), true);

function autor(arbol: Arbol, a: { correo: string; persona: string | null }, admin: boolean): string {
  // DA-17 a: el nombre de su persona; el correo, solo el administrador. Sin
  // correo (las cargas del árbol anteriores al 29/10/2026), desconocido.
  if (!a.correo) return t("registro.autorDesconocido");
  const nombre = a.persona ? arbol.nombre(arbol.persona(a.persona)) : "";
  if (!admin) return nombre || t("registro.sinPersona");
  return nombre ? `${nombre} (${a.correo})` : a.correo;
}

function Marcas({ e }: { e: EntradaRegistro }) {
  return (
    <Group gap={6}>
      <Badge variant="light" color={COLOR_ESTADO[e.estado]} tt="none">{t(`registro.estado.${e.estado}` as Clave)}</Badge>
      {e.origen !== "edicion" && <Badge variant="outline" color="gray" tt="none">{t(`registro.origen.${e.origen}` as Clave)}</Badge>}
    </Group>
  );
}

export { autor as nombreAutor };

const puedeVer = (rol: string) => rol === "administrador" || rol === "revisor";

/** «Historial» al pie de una ficha (persona o familia). Se carga al
 * pedirlo. */
export function Historial({ tipo, handle }: { tipo: Tipo; handle: string }) {
  const arbol = useArbol();
  const { invitacion } = useSesion();
  const [lista, setLista] = useState<EntradaRegistro[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(false);
  const ver = useCallback(async () => {
    const ficha = arbol.obtener(tipo, handle) as (Base & { event_ref_list?: EventRef[]; media_list?: MediaRef[] }) | null;
    const claves = [
      `${tipo}_${handle}`,
      ...(ficha?.event_ref_list ?? []).map((r) => `Event_${r.ref}`),
      ...(ficha?.note_list ?? []).map((h) => `Note_${h}`),
      ...(ficha?.media_list ?? []).map((r) => `Media_${r.ref}`),
    ];
    setCargando(true);
    setError(false);
    try {
      // Y los eventos, notas y fotos que salen en esos cambios (el árbol
      // de la web puede no tenerlos aún, o ya no: borrados).
      let encontrados = await leerHistorial([...new Set(claves)]);
      const mas = new Set(encontrados.flatMap((e) => e.objetos)
        .filter((o) => o.tipo === "Event" || o.tipo === "Note" || o.tipo === "Media")
        .map((o) => `${o.tipo}_${o.handle}`).filter((k) => !claves.includes(k)));
      if (mas.size) encontrados = await leerHistorial([...new Set([...claves, ...mas])]);
      setLista(encontrados);
    } catch {
      setError(true);
    } finally {
      setCargando(false);
    }
  }, [arbol, tipo, handle]);
  // Se carga al abrir la ficha (y si cambia la ficha).
  const ve = puedeVer(invitacion.rol);
  useEffect(() => {
    setLista(null);
    if (ve) void ver();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ve, tipo, handle]);
  if (!ve) return null;

  return (
    <Seccion titulo={t("registro.historial")}>
      {cargando && !lista && <Center h={60}><Loader size="sm" /></Center>}
      {error && (
        <Group>
          <Text c="red" size="sm">{t("registro.errorCarga")}</Text>
          <Button size="xs" variant="default" onClick={ver}>{t("registro.reintentar")}</Button>
        </Group>
      )}
      {lista?.length === 0 && <Tarjeta><Text c="dimmed">{t("registro.sinCambios")}</Text></Tarjeta>}
      {!!lista?.length && <ListaCambios lista={lista} />}
    </Seccion>
  );
}

/** Una lista de cambios del registro: tabla en el escritorio, tarjetas en
 * el móvil. */
export function ListaCambios({ lista }: { lista: EntradaRegistro[] }) {
  const admin = useSesion().invitacion.rol === "administrador";
  const estrecha = useMediaQuery("(max-width: 48em)") ?? false;
  return (
    <Tarjeta p={estrecha ? undefined : 0} style={{ overflow: "hidden" }}>
      {estrecha ? (
        <Stack gap="md">
          {lista.map((e) => <FilaMovil key={e.id} e={e} admin={admin} />)}
        </Stack>
      ) : (
        <Table verticalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("solicitudes.fecha")}</Table.Th>
              <Table.Th>{t("solicitudes.que")}</Table.Th>
              <Table.Th>{t("solicitudes.de")}</Table.Th>
              <Table.Th w={170}>{t("solicitudes.estado")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lista.map((e) => <Fila key={e.id} e={e} admin={admin} />)}
          </Table.Tbody>
        </Table>
      )}
    </Tarjeta>
  );
}

function Que({ e }: { e: EntradaRegistro }) {
  const arbol = useArbol();
  const d = useMemo(() => describir(arbol, e), [arbol, e]);
  const lineas = [...d.lineas, ...d.grupos.flatMap((g) => [g.titulo, ...g.lineas])];
  return (
    <Stack gap={2}>
      <Anchor component={Link} to={`/cambios/${e.id}`}>{d.titulo}</Anchor>
      {lineas.slice(0, 3).map((l, i) => <Text key={i} size="sm" c="dimmed">{l}</Text>)}
      {lineas.length > 3 && <Text size="sm" c="dimmed">{lineas.length === 4 ? t("solicitudes.masUno") : t("solicitudes.mas", { n: lineas.length - 3 })}</Text>}
    </Stack>
  );
}

function Fila({ e, admin }: { e: EntradaRegistro; admin: boolean }) {
  const arbol = useArbol();
  return (
    <Table.Tr>
      <Table.Td style={{ verticalAlign: "top" }}>{fecha(e)}</Table.Td>
      <Table.Td style={{ verticalAlign: "top" }}><Que e={e} /></Table.Td>
      <Table.Td style={{ verticalAlign: "top" }}>{autor(arbol, e.autor, admin)}</Table.Td>
      <Table.Td style={{ verticalAlign: "top" }}><Marcas e={e} /></Table.Td>
    </Table.Tr>
  );
}

function FilaMovil({ e, admin }: { e: EntradaRegistro; admin: boolean }) {
  const arbol = useArbol();
  return (
    <Stack gap={4}>
      <Que e={e} />
      <Text size="sm">{autor(arbol, e.autor, admin)}</Text>
      <Group gap="sm"><Text size="sm" c="dimmed">{fecha(e)}</Text><Marcas e={e} /></Group>
    </Stack>
  );
}

/** Enlace a otro cambio del registro. */
const AlCambio = ({ id }: { id: string }) => <Anchor component={Link} to={`/cambios/${id}`}>{id}</Anchor>;

export function DetalleCambio() {
  const { id = "" } = useParams();
  const arbol = useArbol();
  const { invitacion } = useSesion();
  const admin = invitacion.rol === "administrador";
  const [e, setE] = useState<EntradaRegistro | null | undefined>(undefined);
  // Abierto el cuadro de revertir: si es para rechazar (fijado al abrirlo:
  // tras rechazar, el cambio pasa a revertido).
  const [revirtiendo, setRevirtiendo] = useState<"rechazar" | "revertir" | null>(null);
  const [aceptando, setAceptando] = useState(false);
  const cargar = useCallback(() => leerCambio(id).then(setE, () => setE(null)), [id]);
  useEffect(() => { void cargar(); }, [cargar]);

  if (!puedeVer(invitacion.rol)) return <Text>{t("registro.noExiste")}</Text>;
  if (e === undefined) return <Center h={120}><Loader /></Center>;
  if (!e) return <Text>{t("registro.noExiste")}</Text>;

  const { titulo, lineas, grupos } = describir(arbol, e);
  const propio = e.autor.correo === invitacion.correo;
  const { tipo: tp, handle: hp } = e.principal ?? { tipo: "Person" as const, handle: "" };
  const existe = !!e.principal && !!arbol.obtener(tp, hp);
  const rutaFicha = !existe ? null : tp === "Person" ? rutaPersona(hp) : tp === "Family" ? rutaFamilia(hp) : null;
  // Corregir: el formulario de la ficha principal (persona o familia), con
  // el árbol al día (si la web lo cargó antes de este cambio, no lo tiene).
  const atrasado = arbol.secuencia < e.secuencia;
  const rutaCorregir = !admin || !existe || e.estado === "revertido" ? null
    : tp === "Person" ? `${rutaEditarPersona(hp)}?corrige=${e.id}` : tp === "Family" ? `${rutaEditarFamilia(hp)}?corrige=${e.id}` : null;

  return (
    <Stack maw={800} gap="lg">
      <Stack gap="xs">
        {rutaFicha && <Anchor component={Link} to={rutaFicha}>{t("registro.volverFicha")}</Anchor>}
        <Group gap="sm">
          <Title order={1}>{titulo}</Title>
          <Marcas e={e} />
        </Group>
        <Text c="dimmed">{[e.id, fecha(e), autor(arbol, e.autor, admin)].join(" · ")}</Text>
      </Stack>

      {(e.revierte || e.revertidoPor || e.corrige || e.corregidoPor.length > 0 || (e.solicitud && admin)) && (
        <Stack gap={4}>
          {e.revierte && <Text>{t("registro.revierte")} <AlCambio id={e.revierte} /></Text>}
          {e.revertidoPor && <Text>{t("registro.revertidoPor")} <AlCambio id={e.revertidoPor} /></Text>}
          {e.corrige && <Text>{t("registro.corrige")} <AlCambio id={e.corrige} /></Text>}
          {e.solicitud && admin && (
            <Text>{t("registro.deSolicitud")} <Anchor component={Link} to={`/solicitudes/${e.solicitud}`}>{e.solicitud}</Anchor></Text>
          )}
          {e.corregidoPor.length > 0 && (
            <Text>{t("registro.corregidoPor")} {e.corregidoPor.map((c, i) => <span key={c}>{i > 0 && ", "}<AlCambio id={c} /></span>)}</Text>
          )}
        </Stack>
      )}
      {e.revision?.comentario && e.estado !== "marcado" && (
        <Alert color={COLOR_ESTADO[e.estado]}>{t("registro.comentario", { texto: e.revision.comentario })}</Alert>
      )}

      {e.motivo && (
        <Seccion titulo={t("solicitud.motivo")}>
          <Tarjeta><Text style={{ whiteSpace: "pre-wrap" }}>{e.motivo}</Text></Tarjeta>
        </Seccion>
      )}

      <Seccion titulo={t("registro.queCambio")}>
        <Tarjeta>
          <Stack gap="sm">
            {e.fuera && <Text c="dimmed">{t("registro.grande")}</Text>}
            {lineas.length > 0 && <List size="sm">{lineas.map((l, i) => <List.Item key={i}>{l}</List.Item>)}</List>}
            {grupos.map((g, i) => (
              <Stack key={i} gap={4}>
                <Text size="sm" fw={600}>{g.titulo}</Text>
                {g.lineas.length > 0 && <List size="sm">{g.lineas.map((l, j) => <List.Item key={j}>{l}</List.Item>)}</List>}
              </Stack>
            ))}
          </Stack>
        </Tarjeta>
      </Seccion>

      {/* Por revisar: «Aceptar» (no el propio, DA-11 a) y «Rechazar» (es
          revertirlo). Aceptado: «Revertir». */}
      {e.estado !== "revertido" && e.origen !== "carga" && (
        <Group>
          {e.estado === "marcado" && (
            <Button onClick={() => setAceptando(true)} disabled={propio}>{t("registro.aceptar")}</Button>
          )}
          <Button variant="default" color={e.estado === "marcado" ? "red" : undefined} onClick={() => setRevirtiendo(e.estado === "marcado" ? "rechazar" : "revertir")}>
            {t(e.estado === "marcado" ? "registro.rechazar" : "registro.revertir")}
          </Button>
          {rutaCorregir && !atrasado && <Button variant="default" component={Link} to={rutaCorregir}>{t("registro.corregir")}</Button>}
        </Group>
      )}
      {e.estado === "marcado" && propio && <Text size="sm" c="dimmed">{t("registro.propio")}</Text>}
      <Modal opened={aceptando} onClose={() => setAceptando(false)} title={t("registro.aceptarTitulo", { id: e.id })} centered>
        {aceptando && <Aceptar e={e} alCerrar={() => setAceptando(false)} alTerminar={() => { void cargar(); }} />}
      </Modal>
      {rutaCorregir && !atrasado && <Text size="sm" c="dimmed">{t("registro.corregirAyuda")}</Text>}
      {rutaCorregir && atrasado && (
        <Alert color="yellow">
          <Stack gap="xs" align="flex-start">
            <Text size="sm">{t("registro.atrasado")}</Text>
            <Button size="xs" variant="default" onClick={() => window.location.reload()}>{t("registro.actualizar")}</Button>
          </Stack>
        </Alert>
      )}
      <Modal opened={!!revirtiendo} onClose={() => setRevirtiendo(null)} centered size="lg"
        title={t(revirtiendo === "rechazar" ? "registro.rechazarTitulo" : "registro.revertirTitulo", { id: e.id })}>
        {revirtiendo && <Revertir e={e} rechazo={revirtiendo === "rechazar"} alCerrar={() => setRevirtiendo(null)} alTerminar={() => { void cargar(); }} />}
      </Modal>
    </Stack>
  );
}

/** El cuadro de «Revertir» (o de «Rechazar», un cambio por revisar, que es
 * lo mismo): primero, qué habría que revertir (la cadena); después,
 * revertirlo. */
function Revertir({ e, rechazo, alCerrar, alTerminar }: { e: EntradaRegistro; rechazo: boolean; alCerrar: () => void; alTerminar: () => void }) {
  const arbol = useArbol();
  const { revertirCambio } = useEdicion();
  const admin = useSesion().invitacion.rol === "administrador";
  const [cadena, setCadena] = useState<{ eslabon: Eslabon; titulo: string }[] | null>(null);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [hecho, setHecho] = useState(false);

  /** La cadena, con el título de cada cambio (leído del registro). */
  const mostrar = useCallback(async (eslabones: Eslabon[]) => {
    const titulos = await Promise.all(eslabones.map(async (x) => {
      const entrada = x.cambio === e.id ? e : await leerCambio(x.cambio).catch(() => null);
      return entrada ? describir(arbol, entrada).titulo : x.cambio;
    }));
    setCadena(eslabones.map((eslabon, i) => ({ eslabon, titulo: titulos[i] })));
  }, [arbol, e]);

  // Solo al abrir el cuadro (tras revertir, la entrada se vuelve a leer).
  useEffect(() => {
    revertirCambio({ cambio: e.id, motivo: null }).then((r) => mostrar(r.cadena), (x: unknown) => setError(textoError(x, admin)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function revertir() {
    if (!cadena) return;
    setError(null);
    setAviso(null);
    setEnviando(true);
    try {
      await revertirCambio({ cambio: e.id, motivo: motivo.trim() || null, cadena: cadena.map((c) => c.eslabon.cambio) });
      setHecho(true);
      alTerminar();
    } catch (x) {
      const detalles = (x as { details?: { codigo?: string; detalles?: { cadena?: Eslabon[] } } }).details;
      if (detalles?.codigo === "CONFLICTO" && detalles.detalles?.cadena) {
        await mostrar(detalles.detalles.cadena);
        setAviso(t("registro.cadenaCambiada"));
      } else {
        setError(textoError(x, admin));
      }
    } finally {
      setEnviando(false);
    }
  }

  if (hecho) {
    return (
      <Stack>
        <Alert color="green" title={t(rechazo ? "registro.rechazado" : "registro.revertido")}>{t("registro.revertidoAyuda")}</Alert>
        <Group justify="flex-end"><Button onClick={alCerrar}>{t("formulario.cerrar")}</Button></Group>
      </Stack>
    );
  }
  if (!cadena) {
    return error ? <Alert color="red">{error}</Alert> : <Center h={80}><Loader /></Center>;
  }
  const otros = cadena.filter((c) => c.eslabon.cambio !== e.id);
  return (
    <Stack>
      <Text>{t(rechazo ? "registro.rechazarAyuda" : "registro.revertirAyuda")}</Text>
      {otros.length > 0 && (
        <Alert color="yellow" title={t(otros.length === 1 ? "registro.cadenaUno" : "registro.cadena", { n: otros.length })}>
          <Stack gap={4}>
            <Text size="sm">{t("registro.cadenaAyuda")}</Text>
            <List size="sm">
              {cadena.map(({ eslabon, titulo }) => (
                <List.Item key={eslabon.cambio}>
                  <Anchor component={Link} to={`/cambios/${eslabon.cambio}`} size="sm" onClick={alCerrar}>{mayuscula(titulo)}</Anchor>
                  {" · "}{textoMomento(new Date(eslabon.fecha), true)}
                  {eslabon.cambio === e.id && ` (${t("registro.este")})`}
                </List.Item>
              ))}
            </List>
          </Stack>
        </Alert>
      )}
      {aviso && <Alert color="yellow">{aviso}</Alert>}
      <CampoMotivo valor={motivo} alCambiar={setMotivo} />
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end">
        <Button variant="default" onClick={alCerrar} disabled={enviando}>{t("formulario.cancelar")}</Button>
        <Button color="red" onClick={revertir} loading={enviando}>
          {otros.length ? t(rechazo ? "registro.rechazarN" : "registro.revertirN", { n: cadena.length }) : t(rechazo ? "registro.rechazar" : "registro.revertir")}
        </Button>
      </Group>
    </Stack>
  );
}

/** El cuadro de «Aceptar»: un comentario opcional para el registro. */
function Aceptar({ e, alCerrar, alTerminar }: { e: EntradaRegistro; alCerrar: () => void; alTerminar: () => void }) {
  const admin = useSesion().invitacion.rol === "administrador";
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function aceptar() {
    setError(null);
    setEnviando(true);
    try {
      await aceptarCambio(e.id, comentario.trim() || null);
      alCerrar();
      alTerminar();
    } catch (x) {
      setError(textoError(x, admin));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Stack>
      <Text>{t("registro.aceptarAyuda")}</Text>
      <Textarea label={t("registro.comentarioCampo")} description={t("registro.comentarioAyuda")} value={comentario}
        onChange={(x) => setComentario(x.currentTarget.value)} autosize minRows={2} maxLength={2000} />
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end">
        <Button variant="default" onClick={alCerrar} disabled={enviando}>{t("formulario.cancelar")}</Button>
        <Button onClick={aceptar} loading={enviando}>{t("registro.aceptar")}</Button>
      </Group>
    </Stack>
  );
}