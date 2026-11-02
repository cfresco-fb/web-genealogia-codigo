// Solicitudes (paso 12; docs/edicion.md, «Solicitudes»): cada usuario ve
// las suyas y cómo van (DA-19 a: sin correo al solicitante), y las puede
// retirar mientras estén pendientes; el administrador las ve todas y las
// resuelve aquí: «Aplicar» tal cual (DA-20 a), «Modificar y aplicar» (el
// formulario de la ficha con la propuesta a la vista, paso 14) o
// «Rechazar». La lista, también en la pantalla de administración.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Anchor, Badge, Button, Center, Group, List, Loader, Modal, Stack, Table, Text, Textarea, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { Link, useParams } from "react-router";
import type { Timestamp } from "firebase/firestore/lite";
import type { EstadoSolicitud } from "../../../comun/solicitudes.ts";
import { useSesion } from "../acceso/sesion";
import { useArbol, useEdicion } from "../arbol/contexto";
import type { Arbol } from "../arbol/arbol";
import { rutaEditarFamilia, rutaEditarPersona, rutaFamilia, rutaPersona } from "../componentes/Enlaces";
import { cambiosDePropuesta, Descripcion } from "../componentes/cambiosSolicitud";
import { CambiadasDesde } from "../componentes/PropuestaALaVista";
import { textoError } from "../componentes/Formulario";
import { Seccion, Tarjeta } from "../componentes/Ficha";
import { idioma, t, type Clave } from "../i18n";
import { fichasCambiadas, leerSolicitud, leerSolicitudes, rechazarSolicitud, retirarSolicitud, type SolicitudWeb } from "../solicitudes";

const COLOR_ESTADO: Record<EstadoSolicitud, string> = { pendiente: "yellow", aplicada: "green", rechazada: "red", retirada: "gray" };

function Estado({ estado }: { estado: EstadoSolicitud }) {
  return <Badge variant="light" color={COLOR_ESTADO[estado]} tt="none">{t(`solicitudes.estado.${estado}` as Clave)}</Badge>;
}

const fechaHora = (f: Timestamp | null | undefined) =>
  f ? f.toDate().toLocaleString(idioma().codigo, { dateStyle: "long", timeStyle: "short" }) : "";

/** Qué pide una solicitud, en palabras (componentes/cambiosSolicitud.ts):
 * el título, el porqué y lo que cambia. */
function describir(arbol: Arbol, s: SolicitudWeb) {
  const d = new Descripcion(arbol, cambiosDePropuesta(arbol, s.objetos), s.noPermitidos);
  const { lineas, grupos } = d.describir(s.clase, s.principal);
  return { titulo: d.titulo(s.clase, s.principal), razones: d.razones(s.clase === "borrado" ? s.principal : undefined), lineas, grupos };
}

/** Las primeras líneas de lo que cambia, para la lista. */
const RESUMEN = 3;
function resumen({ lineas, grupos }: ReturnType<typeof describir>): string[] {
  const todas = [...lineas, ...grupos.flatMap((g) => [g.titulo, ...g.lineas])];
  if (todas.length <= RESUMEN) return todas;
  const resto = todas.length - (RESUMEN - 1);
  return [...todas.slice(0, RESUMEN - 1), resto === 1 ? t("solicitudes.masUno") : t("solicitudes.mas", { n: resto })];
}

function Que({ arbol, s }: { arbol: Arbol; s: SolicitudWeb }) {
  const d = useMemo(() => describir(arbol, s), [arbol, s]);
  return (
    <Stack gap={2}>
      <Anchor component={Link} to={`/solicitudes/${s.id}`}>{d.titulo}</Anchor>
      {resumen(d).map((l, i) => <Text key={i} size="sm" c="dimmed">{l}</Text>)}
    </Stack>
  );
}

function autor(arbol: Arbol, s: SolicitudWeb, admin: boolean): string {
  const nombre = arbol.nombre(arbol.persona(s.autor.persona));
  if (!admin) return nombre;
  return nombre ? `${nombre} (${s.autor.correo})` : s.autor.correo;
}

export function Solicitudes() {
  const { invitacion } = useSesion();
  const admin = invitacion.rol === "administrador";
  const [lista, setLista] = useState<SolicitudWeb[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    leerSolicitudes(admin ? null : invitacion.correo).then(setLista, () => setError(true));
  }, [admin, invitacion.correo]);

  return (
    <Stack maw={1100}>
      <Title order={1}>{t("solicitudes.titulo")}</Title>
      {!admin && <Text>{t("solicitudes.ayuda")}</Text>}
      {error && <Alert color="red">{t("solicitudes.errorCarga")}</Alert>}
      {!lista && !error && <Center h={120}><Loader /></Center>}
      {lista?.length === 0 && <Text c="dimmed">{t("solicitudes.ninguna")}</Text>}
      {!!lista?.length && <ListaSolicitudes lista={lista} />}
    </Stack>
  );
}

/** Una lista de solicitudes: tabla en el escritorio; en el móvil, una
 * tarjeta por solicitud. */
export function ListaSolicitudes({ lista }: { lista: SolicitudWeb[] }) {
  const arbol = useArbol();
  const admin = useSesion().invitacion.rol === "administrador";
  const estrecha = useMediaQuery("(max-width: 48em)") ?? false;
  return (
    <>
      {estrecha && (
        <Stack gap="sm">
          {lista.map((s) => (
            <Tarjeta key={s.id}>
              <Stack gap={4}>
                <Que arbol={arbol} s={s} />
                {admin && <Text size="sm">{autor(arbol, s, admin)}</Text>}
                <Group gap="sm"><Text size="sm" c="dimmed">{fechaHora(s.fecha)}</Text><Estado estado={s.estado} /></Group>
              </Stack>
            </Tarjeta>
          ))}
        </Stack>
      )}
      {!estrecha && (
        <Table.ScrollContainer minWidth={500}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("solicitudes.fecha")}</Table.Th>
                <Table.Th>{t("solicitudes.que")}</Table.Th>
                {admin && <Table.Th>{t("solicitudes.de")}</Table.Th>}
                <Table.Th w={130}>{t("solicitudes.estado")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lista.map((s) => (
                <Table.Tr key={s.id}>
                  <Table.Td>{fechaHora(s.fecha)}</Table.Td>
                  <Table.Td><Que arbol={arbol} s={s} /></Table.Td>
                  {admin && <Table.Td>{autor(arbol, s, admin)}</Table.Td>}
                  <Table.Td><Estado estado={s.estado} /></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </>
  );
}

export function DetalleSolicitud() {
  const { id = "" } = useParams();
  const arbol = useArbol();
  const { invitacion } = useSesion();
  const admin = invitacion.rol === "administrador";
  const [s, setS] = useState<SolicitudWeb | null | undefined>(undefined);
  const [preguntando, setPreguntando] = useState(false);
  const [resolviendo, setResolviendo] = useState<"aplicar" | "rechazar" | null>(null);
  const [retirando, setRetirando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(() => leerSolicitud(id).then(setS, () => setS(null)), [id]);
  useEffect(() => { void cargar(); }, [cargar]);

  if (s === undefined) return <Center h={120}><Loader /></Center>;
  const volver = <Anchor component={Link} to="/solicitudes">{t("solicitud.volverLista")}</Anchor>;
  if (!s) return <Stack maw={800}><Text>{t("solicitud.noExiste")}</Text>{volver}</Stack>;

  const propia = s.autor.correo === invitacion.correo;
  const { titulo, razones, lineas, grupos } = describir(arbol, s);
  // La ficha principal, si está en el árbol: un enlace para verla.
  const { tipo: tp, handle: hp } = s.principal;
  const ruta = !arbol.obtener(tp, hp) ? null : tp === "Person" ? rutaPersona(hp) : tp === "Family" ? rutaFamilia(hp) : null;
  // «Modificar y aplicar»: el formulario de la primera persona o familia que
  // cambia y sigue en el árbol (los demás formularios son ventanas).
  const aModificar = s.clase === "cambio"
    ? s.objetos.find((o) => o.operacion === "modificar" && (o.tipo === "Person" || o.tipo === "Family") && arbol.obtener(o.tipo, o.handle))
    : undefined;
  // Si alguna ficha ha cambiado desde que se pidió, «Aplicar» tal cual no
  // puede ser (DA-20 a): se dice cuáles y con qué cambios, y solo queda
  // «Modificar y aplicar» o «Rechazar».
  const cambiada = admin && s.estado === "pendiente" && fichasCambiadas(arbol, s).length > 0;
  const rutaModificar = aModificar && `${(aModificar.tipo === "Person" ? rutaEditarPersona : rutaEditarFamilia)(aModificar.handle)}?resuelve=${s.id}`;
  async function retirar() {
    setError(null);
    setRetirando(true);
    try {
      await retirarSolicitud(id);
      setPreguntando(false);
      await cargar();
    } catch (e) {
      setError(textoError(e, admin));
    } finally {
      setRetirando(false);
    }
  }

  return (
    <Stack maw={800} gap="lg">
      <Stack gap="xs">
        {volver}
        <Group gap="sm">
          <Title order={1}>{titulo}</Title>
          <Estado estado={s.estado} />
        </Group>
        <Text c="dimmed">{[fechaHora(s.fecha), propia ? "" : autor(arbol, s, admin)].filter(Boolean).join(" · ")}</Text>
      </Stack>
      {s.resolucion && (
        <Alert color={COLOR_ESTADO[s.estado]}>
          {t("solicitud.resuelta", { estado: t(`solicitudes.estado.${s.estado}` as Clave), fecha: fechaHora(s.resolucion.fecha) })}
          {s.resolucion.modificada && <Text size="sm" mt={4}>{t("solicitud.modificada")}</Text>}
          {s.resolucion.comentario && <Text size="sm" mt={4}>{t("solicitud.comentario", { texto: s.resolucion.comentario })}</Text>}
          {s.resolucion.cambio && (admin || invitacion.rol === "revisor") && (
            <Anchor component={Link} to={`/cambios/${s.resolucion.cambio}`} size="sm">{t("registro.verCambio")}</Anchor>
          )}
        </Alert>
      )}
      {admin && s.aviso?.error && <Alert color="red">{t("solicitud.avisoError", { error: s.aviso.error })}</Alert>}

      <Seccion titulo={t("solicitud.motivo")}>
        <Tarjeta><Text style={{ whiteSpace: "pre-wrap" }}>{s.motivo}</Text></Tarjeta>
      </Seccion>

      {razones.length > 0 && (
        <Seccion titulo={t("solicitud.porQue")}>
          <Tarjeta><List size="sm">{razones.map((r) => <List.Item key={r}>{r}</List.Item>)}</List></Tarjeta>
        </Seccion>
      )}

      <Seccion titulo={t("solicitud.fichas")}>
        <Tarjeta>
          <Stack gap="sm">
            {lineas.length > 0 && <List size="sm">{lineas.map((l, i) => <List.Item key={i}>{l}</List.Item>)}</List>}
            {grupos.map((g, i) => (
              <Stack key={i} gap={4}>
                <Text size="sm" fw={600}>{g.titulo}</Text>
                {g.lineas.length > 0 && <List size="sm">{g.lineas.map((l, j) => <List.Item key={j}>{l}</List.Item>)}</List>}
              </Stack>
            ))}
            {ruta && <Anchor component={Link} to={ruta} size="sm">{t("solicitud.verFicha")}</Anchor>}
            {s.ficheros.length > 0 && <Text size="sm">{t("solicitud.fotos", { n: s.ficheros.length })}</Text>}
          </Stack>
        </Tarjeta>
      </Seccion>

      {/* El administrador la resuelve (DA-19 a): «Aplicar» tal cual (DA-20 a)
          o «Rechazar». */}
      {cambiada && (
        <Alert color="yellow" title={t("solicitud.cambiadasTitulo")}>
          <Stack gap={6}>
            <CambiadasDesde s={s} />
            <Text size="sm">{t(rutaModificar ? "solicitud.cambiadasAyuda" : "solicitud.cambiadasSinModificar")}</Text>
          </Stack>
        </Alert>
      )}
      {admin && s.estado === "pendiente" && (
        <Group>
          {!cambiada && <Button onClick={() => setResolviendo("aplicar")}>{t("solicitud.aplicar")}</Button>}
          {rutaModificar && <Button component={Link} to={rutaModificar} variant="default">{t("solicitud.modificarAplicar")}</Button>}
          <Button variant="default" color="red" onClick={() => setResolviendo("rechazar")}>{t("solicitud.rechazar")}</Button>
        </Group>
      )}
      <Modal opened={!!resolviendo} onClose={() => setResolviendo(null)} centered
        title={t(resolviendo === "rechazar" ? "solicitud.rechazarTitulo" : "solicitud.aplicarTitulo")}>
        {resolviendo && <Resolver s={s} modo={resolviendo} alCerrar={() => setResolviendo(null)} alTerminar={() => { void cargar(); }} />}
      </Modal>
      {propia && s.estado === "pendiente" && (
        <Group><Button variant="default" onClick={() => setPreguntando(true)}>{t("solicitud.retirar")}</Button></Group>
      )}
      <Modal opened={preguntando} onClose={() => setPreguntando(false)} title={t("solicitud.retirar")} centered>
        <Stack>
          <Text>{t("solicitud.retirarPregunta")}</Text>
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPreguntando(false)} disabled={retirando}>{t("formulario.cancelar")}</Button>
            <Button onClick={retirar} loading={retirando}>{t("solicitud.retirar")}</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

/** Aplicar o rechazar una solicitud (el administrador), con un comentario
 * opcional que verá quien la pidió. */
function Resolver({ s, modo, alCerrar, alTerminar }: { s: SolicitudWeb; modo: "aplicar" | "rechazar"; alCerrar: () => void; alTerminar: () => void }) {
  const { aplicarSolicitud } = useEdicion();
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function resolver() {
    setError(null);
    setEnviando(true);
    const texto = comentario.trim() || null;
    try {
      if (modo === "aplicar") await aplicarSolicitud(s.id, texto, s.autor.persona);
      else await rechazarSolicitud(s.id, texto);
      alCerrar();
      alTerminar();
    } catch (e) {
      const codigo = (e as { details?: { codigo?: string } }).details?.codigo;
      setError(codigo === "CONFLICTO" ? t("solicitud.conflicto") : textoError(e, true));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Stack>
      <Text>{t(modo === "aplicar" ? "solicitud.aplicarAyuda" : "solicitud.rechazarAyuda")}</Text>
      <Textarea label={t("registro.comentarioCampo")} description={t("solicitud.comentarioAyuda")} value={comentario}
        onChange={(e) => setComentario(e.currentTarget.value)} autosize minRows={2} maxLength={2000} />
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end">
        <Button variant="default" onClick={alCerrar} disabled={enviando}>{t("formulario.cancelar")}</Button>
        <Button color={modo === "rechazar" ? "red" : undefined} onClick={resolver} loading={enviando}>
          {t(modo === "aplicar" ? "solicitud.aplicar" : "solicitud.rechazar")}
        </Button>
      </Group>
    </Stack>
  );
}