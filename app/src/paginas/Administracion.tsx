// Administración (paso 14; diseño en docs/diseno-fase-3.md, apartado 8;
// docs/edicion.md, «Administración»), en `/administracion?pestana=…`:
//
// - Cambios por revisar: los marcados; cada uno se abre en su página
//   (`/cambios/:id`, Cambios.tsx) para aceptarlo o rechazarlo.
// - Solicitudes (solo el administrador, DA-19 a): pendientes o todas; se
//   resuelven en su página (Solicitudes.tsx).
// - Usuarios (solo el administrador, DA-22 a): las invitaciones, su alta y
//   sus cambios por la función, y el registro de esos cambios.
// - Registro: todos los cambios del árbol, por páginas, con filtros (DA-12 b).
//
// Los revisores ven «Cambios por revisar» y «Registro»: las solicitudes y
// las invitaciones solo las lee el administrador (reglas).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Anchor, Badge, Button, Center, Group, Loader, Modal, SegmentedControl, Select, Stack, Table, Tabs, Text, TextInput, Title,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { Link, useSearchParams } from "react-router";
import type { Tipo } from "../../../comun/gramps.ts";
import { useSesion } from "../acceso/sesion";
import type { Arbol } from "../arbol/arbol";
import { useArbol } from "../arbol/contexto";
import { textoMomento } from "../arbol/fechas";
import type { Base, Persona } from "../arbol/tipos";
import { EnlacePersona, useAnios } from "../componentes/Enlaces";
import { FILTROS_VACIOS, TODOS, filtrarRegistro, opcionesAutores, type FiltrosRegistro } from "../componentes/filtrosRegistro";
import { Tarjeta } from "../componentes/Ficha";
import { textoError } from "../componentes/Formulario";
import { RecordPicker } from "../gramps-connect/formularios/RecordPicker";
import { t, type Clave } from "../i18n";
import { leerHistorial, leerMarcados, leerRegistro, secuenciasEntre, type EntradaRegistro } from "../registro";
import { leerSolicitudes, type SolicitudWeb } from "../solicitudes";
import {
  guardarInvitacion, leerInvitaciones, leerRegistroUsuarios, ROLES, type DatosInvitacion, type EntradaUsuarios, type InvitacionWeb, type Rol,
} from "../usuarios";
import { ListaCambios, nombreAutor } from "./Cambios";
import { ListaSolicitudes } from "./Solicitudes";

type Pestana = "marcados" | "solicitudes" | "usuarios" | "registro";

export function Administracion() {
  const { invitacion } = useSesion();
  const admin = invitacion.rol === "administrador";
  const [params, setParams] = useSearchParams();
  const pestanas: Pestana[] = admin ? ["marcados", "solicitudes", "usuarios", "registro"] : ["marcados", "registro"];
  const pedida = params.get("pestana") as Pestana | null;
  const pestana = pedida && pestanas.includes(pedida) ? pedida : "marcados";

  if (!admin && invitacion.rol !== "revisor") return <Text>{t("admin.sinAcceso")}</Text>;
  return (
    <Stack maw={1100} gap="lg">
      <Title order={1}>{t("admin.titulo")}</Title>
      <Tabs value={pestana} onChange={(v) => v && setParams({ pestana: v }, { replace: true })} keepMounted={false}>
        <Tabs.List>
          {pestanas.map((p) => <Tabs.Tab key={p} value={p}>{t(`admin.pestana.${p}` as Clave)}</Tabs.Tab>)}
        </Tabs.List>
        <Tabs.Panel value="marcados" pt="md"><Marcados /></Tabs.Panel>
        {admin && <Tabs.Panel value="solicitudes" pt="md"><PestanaSolicitudes /></Tabs.Panel>}
        {admin && <Tabs.Panel value="usuarios" pt="md"><Usuarios /></Tabs.Panel>}
        <Tabs.Panel value="registro" pt="md"><Registro /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

const Cargando = () => <Center h={100}><Loader /></Center>;

// ---- Cambios por revisar ----

function Marcados() {
  const [lista, setLista] = useState<EntradaRegistro[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { leerMarcados().then(setLista, () => setError(true)); }, []);
  return (
    <Stack>
      <Text>{t("admin.marcadosAyuda")}</Text>
      {error && <Alert color="red">{t("admin.errorCarga")}</Alert>}
      {!lista && !error && <Cargando />}
      {lista?.length === 0 && <Text c="dimmed">{t("admin.marcadosNinguno")}</Text>}
      {!!lista?.length && <ListaCambios lista={lista} />}
    </Stack>
  );
}

// ---- Solicitudes ----

function PestanaSolicitudes() {
  const [lista, setLista] = useState<SolicitudWeb[] | null>(null);
  const [error, setError] = useState(false);
  const [cuales, setCuales] = useState<"pendientes" | "todas">("pendientes");
  useEffect(() => { leerSolicitudes(null).then(setLista, () => setError(true)); }, []);
  const pendientes = lista?.filter((s) => s.estado === "pendiente") ?? [];
  const vistas = cuales === "pendientes" ? pendientes : lista ?? [];
  return (
    <Stack>
      <SegmentedControl
        value={cuales}
        onChange={(v) => setCuales(v as "pendientes" | "todas")}
        data={[
          { value: "pendientes", label: t("admin.solicitudesPendientes", { n: pendientes.length }) },
          { value: "todas", label: t("admin.solicitudesTodas") },
        ]}
        w="fit-content"
      />
      {error && <Alert color="red">{t("admin.errorCarga")}</Alert>}
      {!lista && !error && <Cargando />}
      {lista && !vistas.length && <Text c="dimmed">{t(cuales === "pendientes" ? "admin.solicitudesNinguna" : "solicitudes.ninguna")}</Text>}
      {vistas.length > 0 && <ListaSolicitudes lista={vistas} />}
    </Stack>
  );
}

// ---- Usuarios ----

const COLOR_ROL: Record<Rol, string> = { administrador: "blue", revisor: "yellow", familiar: "gray" };

function Usuarios() {
  const arbol = useArbol();
  const [lista, setLista] = useState<InvitacionWeb[] | null>(null);
  const [registro, setRegistro] = useState<EntradaUsuarios[] | null>(null);
  const [error, setError] = useState(false);
  // La invitación que se edita (null: ninguna; "nueva": alta).
  const [editando, setEditando] = useState<InvitacionWeb | "nueva" | null>(null);
  const estrecha = useMediaQuery("(max-width: 48em)") ?? false;
  const cargar = useCallback(() => {
    leerInvitaciones().then(setLista, () => setError(true));
    leerRegistroUsuarios().then(setRegistro, () => setError(true));
  }, []);
  useEffect(cargar, [cargar]);

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <Text maw={640}>{t("admin.usuariosAyuda")}</Text>
        <Button onClick={() => setEditando("nueva")}>{t("admin.nuevaInvitacion")}</Button>
      </Group>
      {error && <Alert color="red">{t("admin.errorCarga")}</Alert>}
      {!lista && !error && <Cargando />}
      {lista && estrecha && (
        <Stack gap="sm">
          {lista.map((i) => (
            <Tarjeta key={i.correo}>
              <Stack gap={4}>
                <Text fw={600} style={{ overflowWrap: "anywhere" }}>{i.correo}</Text>
                <Text size="sm"><PersonaDe arbol={arbol} handle={i.persona} /></Text>
                <Group gap="xs"><MarcaRol rol={i.rol} /><MarcaEstado estado={i.estado} /></Group>
                <Group><Button size="xs" variant="default" onClick={() => setEditando(i)}>{t("admin.cambiar")}</Button></Group>
              </Stack>
            </Tarjeta>
          ))}
        </Stack>
      )}
      {lista && !estrecha && (
        <Table.ScrollContainer minWidth={600}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("admin.correo")}</Table.Th>
                <Table.Th>{t("admin.persona")}</Table.Th>
                <Table.Th>{t("admin.rol")}</Table.Th>
                <Table.Th>{t("admin.estado")}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lista.map((i) => (
                <Table.Tr key={i.correo}>
                  <Table.Td>{i.correo}</Table.Td>
                  <Table.Td><PersonaDe arbol={arbol} handle={i.persona} /></Table.Td>
                  <Table.Td><MarcaRol rol={i.rol} /></Table.Td>
                  <Table.Td><MarcaEstado estado={i.estado} /></Table.Td>
                  <Table.Td ta="right"><Button size="xs" variant="default" onClick={() => setEditando(i)}>{t("admin.cambiar")}</Button></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Title order={2} mt="md">{t("admin.registroUsuarios")}</Title>
      {registro?.length === 0 && <Text c="dimmed">{t("admin.registroUsuariosVacio")}</Text>}
      {!!registro?.length && (
        <Tarjeta>
          <Stack gap="sm">
            {registro.map((e) => (
              <Stack key={e.id} gap={0}>
                <Text size="sm"><b>{e.correo}</b>: {describirInvitacion(arbol, e)}</Text>
                <Text size="sm" c="dimmed">{textoMomento(e.fecha.toDate(), true)} · {nombreAutor(arbol, e.por, true)}</Text>
              </Stack>
            ))}
          </Stack>
        </Tarjeta>
      )}

      <Modal opened={!!editando} onClose={() => setEditando(null)} centered size="lg"
        title={editando === "nueva" ? t("admin.nuevaInvitacion") : t("admin.cambiarInvitacion")}>
        {editando && (
          <FormularioInvitacion
            inicial={editando === "nueva" ? null : editando}
            existentes={lista ?? []}
            alCerrar={() => setEditando(null)}
            alGuardar={() => { setEditando(null); cargar(); }}
          />
        )}
      </Modal>
    </Stack>
  );
}

const MarcaRol = ({ rol }: { rol: Rol }) => <Badge variant="light" color={COLOR_ROL[rol]} tt="none">{t(`rol.${rol}` as Clave)}</Badge>;
const MarcaEstado = ({ estado }: { estado: string }) => (
  <Badge variant="light" color={estado === "activa" ? "green" : "red"} tt="none">{t(`admin.estado.${estado}` as Clave)}</Badge>
);

function PersonaDe({ arbol, handle }: { arbol: Arbol; handle: string | null }) {
  if (!handle) return <Text span c="dimmed" size="sm">{t("admin.sinPersona")}</Text>;
  const p = arbol.persona(handle);
  if (!p) return <Text span c="red" size="sm">{t("admin.personaNoEsta")}</Text>;
  return <EnlacePersona persona={p} />;
}

/** Un cambio de invitación, en palabras. */
function describirInvitacion(arbol: Arbol, e: EntradaUsuarios): string {
  const persona = (h: string | null) => (h ? arbol.nombre(arbol.persona(h)) || h : t("admin.sinPersona"));
  const rol = (r: Rol) => t(`rol.${r}` as Clave);
  const { antes: a, despues: d } = e;
  if (!a) return t("admin.reg.alta", { rol: rol(d.rol), persona: persona(d.persona) });
  const partes: string[] = [];
  if (a.estado !== d.estado) partes.push(t(d.estado === "revocada" ? "admin.reg.revocada" : "admin.reg.reactivada"));
  if (a.rol !== d.rol) partes.push(t("admin.reg.rol", { antes: rol(a.rol), despues: rol(d.rol) }));
  if (a.persona !== d.persona) partes.push(t("admin.reg.persona", { antes: persona(a.persona), despues: persona(d.persona) }));
  return partes.join("; ");
}

function FormularioInvitacion({ inicial, existentes, alCerrar, alGuardar }: {
  inicial: InvitacionWeb | null;
  existentes: InvitacionWeb[];
  alCerrar: () => void;
  alGuardar: () => void;
}) {
  const arbol = useArbol();
  const textoAnios = useAnios();
  const [correo, setCorreo] = useState(inicial?.correo ?? "");
  const [datos, setDatos] = useState<DatosInvitacion>({ persona: inicial?.persona ?? null, rol: inicial?.rol ?? "familiar", estado: inicial?.estado ?? "activa" });
  const [eligiendo, setEligiendo] = useState(!inicial);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cambiar = (c: Partial<DatosInvitacion>) => setDatos((d) => ({ ...d, ...c }));
  const persona = arbol.persona(datos.persona);
  const correoNormal = correo.trim().toLowerCase();
  const correoValido = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(correoNormal);
  const yaExiste = !inicial && existentes.some((i) => i.correo === correoNormal);
  // Otras invitaciones vinculadas a la misma persona (se avisa, no se impide).
  const mismaPersona = datos.persona ? existentes.filter((i) => i.persona === datos.persona && i.correo !== correoNormal) : [];
  const sinCambios = !!inicial && inicial.persona === datos.persona && inicial.rol === datos.rol && inicial.estado === datos.estado;

  async function guardar() {
    setError(null);
    setEnviando(true);
    try {
      await guardarInvitacion(correoNormal, datos);
      alGuardar();
    } catch (e) {
      const motivo = (e as { details?: { detalles?: { motivo?: string } } }).details?.detalles?.motivo;
      setError(motivo === "ultimoAdministrador" ? t("admin.errorUltimoAdmin") : motivo === "persona" ? t("admin.errorPersona") : textoError(e, true));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Stack>
      <TextInput
        label={t("admin.correo")}
        description={inicial ? undefined : t("admin.correoAyuda")}
        value={correo}
        onChange={(e) => setCorreo(e.currentTarget.value)}
        disabled={!!inicial}
        error={yaExiste ? t("admin.correoYaExiste") : undefined}
        type="email"
        data-autofocus
      />
      <Stack gap={4}>
        <Text size="sm" fw={500}>{t("admin.persona")}</Text>
        <Text size="sm" c="dimmed">{t("admin.personaAyuda")}</Text>
        {persona && (
          <Group gap="sm">
            <Text>{arbol.nombre(persona)} <Text span c="dimmed" size="sm">{textoAnios(persona)}</Text></Text>
            {!eligiendo && <Button size="xs" variant="default" onClick={() => setEligiendo(true)}>{t("admin.cambiarPersona")}</Button>}
            <Button size="xs" variant="subtle" onClick={() => cambiar({ persona: null })}>{t("admin.quitarPersona")}</Button>
          </Group>
        )}
        {!persona && !eligiendo && (
          <Group gap="sm">
            <Text c="dimmed">{t("admin.sinPersona")}</Text>
            <Button size="xs" variant="default" onClick={() => setEligiendo(true)}>{t("admin.elegirPersona")}</Button>
          </Group>
        )}
        {eligiendo && (
          <RecordPicker
            tipo="Person"
            placeholder={t("admin.buscarPersona")}
            conIds
            rotulo={(o: Base) => [arbol.nombre(o as Persona), textoAnios(o as Persona)].filter(Boolean).join(" ")}
            alElegir={(o) => { cambiar({ persona: o.handle }); setEligiendo(false); }}
          />
        )}
        {mismaPersona.length > 0 && <Text size="sm" c="dimmed">{t("admin.mismaPersona", { correos: mismaPersona.map((i) => i.correo).join(", ") })}</Text>}
      </Stack>
      <Select
        label={t("admin.rol")}
        description={t("admin.rolAyuda")}
        data={ROLES.map((r) => ({ value: r, label: t(`rol.${r}` as Clave) }))}
        value={datos.rol}
        onChange={(v) => v && cambiar({ rol: v as Rol })}
        allowDeselect={false}
        maw={260}
      />
      {inicial && (
        <Stack gap={4}>
          <Text size="sm" fw={500}>{t("admin.estado")}</Text>
          <SegmentedControl
            value={datos.estado}
            onChange={(v) => cambiar({ estado: v as "activa" | "revocada" })}
            data={[{ value: "activa", label: t("admin.estado.activa") }, { value: "revocada", label: t("admin.estado.revocada") }]}
            w="fit-content"
          />
          {datos.estado === "revocada" && inicial.estado === "activa" && <Text size="sm" c="dimmed">{t("admin.revocarAyuda")}</Text>}
        </Stack>
      )}
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end">
        <Button variant="default" onClick={alCerrar} disabled={enviando}>{t("formulario.cancelar")}</Button>
        <Button onClick={guardar} loading={enviando} disabled={!correoValido || yaExiste || sinCambios}>{t("formulario.guardar")}</Button>
      </Group>
    </Stack>
  );
}

// ---- Registro ----

const TAMANO_PAGINA = 100;
const ESTADOS = ["marcado", "aceptado", "revertido"] as const;
const ORIGENES = ["edicion", "solicitud", "reversion", "correccion", "carga"] as const;
const TIPOS_FICHA: Tipo[] = ["Person", "Family", "Event", "Place", "Note", "Media"];

/** «2026-10-28» → medianoche local de ese día. */
const dia = (s: string, mas = 0): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + mas) : null;
};

function Registro() {
  const arbol = useArbol();
  const admin = useSesion().invitacion.rol === "administrador";
  const [filtros, setFiltros] = useState<FiltrosRegistro>(FILTROS_VACIOS);
  const [cargadas, setCargadas] = useState<EntradaRegistro[] | null>(null);
  // Límites de la consulta y si quedan más páginas.
  const [rango, setRango] = useState<{ min: number; max: number } | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(false);
  const [eligiendo, setEligiendo] = useState(false);
  const cambiar = (c: Partial<FiltrosRegistro>) => setFiltros((f) => ({ ...f, ...c }));

  // Las fechas y la ficha concreta van en la consulta; lo demás, aquí.
  const { desde, hasta, persona } = filtros;
  useEffect(() => {
    let vigente = true;
    setCargadas(null);
    setError(false);
    setCargando(true);
    (async () => {
      if (persona) {
        // Los de una persona: los que la tocan a ella o a sus eventos (como
        // el historial de la ficha), entre las fechas.
        const p = arbol.persona(persona);
        const claves = [`Person_${persona}`, ...(p?.event_ref_list ?? []).map((r) => `Event_${r.ref}`)];
        const d = dia(desde), h = dia(hasta, 1);
        const todas = (await leerHistorial(claves)).filter((e) => (!d || e.fecha.toDate() >= d) && (!h || e.fecha.toDate() < h));
        if (vigente) { setCargadas(todas); setHayMas(false); }
        return;
      }
      const r = await secuenciasEntre(dia(desde), dia(hasta, 1));
      if (!vigente) return;
      setRango(r);
      const pagina = r ? await leerRegistro(r.min, r.max, TAMANO_PAGINA) : [];
      if (vigente) { setCargadas(pagina); setHayMas(pagina.length === TAMANO_PAGINA); }
    })().catch(() => { if (vigente) setError(true); }).finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [arbol, desde, hasta, persona]);

  async function cargarMas() {
    if (!rango || !cargadas?.length) return;
    setCargando(true);
    try {
      const ultima = cargadas[cargadas.length - 1].secuencia;
      const pagina = await leerRegistro(rango.min, ultima - 1, TAMANO_PAGINA);
      setCargadas([...cargadas, ...pagina]);
      setHayMas(pagina.length === TAMANO_PAGINA);
    } catch {
      setError(true);
    } finally {
      setCargando(false);
    }
  }

  // Autores: los de lo cargado.
  const autores = useMemo(() => opcionesAutores(cargadas ?? [], (a) => nombreAutor(arbol, a, admin)), [cargadas, arbol, admin]);
  const vistas = useMemo(() => filtrarRegistro(cargadas ?? [], filtros), [cargadas, filtros]);
  const filtrando = JSON.stringify(filtros) !== JSON.stringify(FILTROS_VACIOS);
  const personaElegida = arbol.persona(filtros.persona);
  const opciones = (prefijo: string, valores: readonly string[]) =>
    [{ value: TODOS, label: t("admin.filtro.todos") }, ...valores.map((v) => ({ value: v, label: t(`${prefijo}.${v}` as Clave) }))];

  return (
    <Stack>
      <Tarjeta>
        <Stack gap="sm">
          <Group gap="sm" align="flex-end" wrap="wrap">
            <TextInput type="date" label={t("admin.filtro.desde")} value={filtros.desde} onChange={(e) => cambiar({ desde: e.currentTarget.value })} w={170} />
            <TextInput type="date" label={t("admin.filtro.hasta")} value={filtros.hasta} onChange={(e) => cambiar({ hasta: e.currentTarget.value })} w={170} />
            <Select label={t("admin.filtro.estado")} data={opciones("registro.estado", ESTADOS)} value={filtros.estado}
              onChange={(v) => cambiar({ estado: v ?? TODOS })} allowDeselect={false} w={160} />
            <Select label={t("admin.filtro.origen")} data={opciones("admin.origen", ORIGENES)} value={filtros.origen}
              onChange={(v) => cambiar({ origen: v ?? TODOS })} allowDeselect={false} w={180} />
            <Select label={t("admin.filtro.tipo")} data={opciones("admin.tipoFicha", TIPOS_FICHA)} value={filtros.tipo}
              onChange={(v) => cambiar({ tipo: v ?? TODOS })} allowDeselect={false} w={160} />
            <Select label={t("admin.filtro.autor")} data={[{ value: TODOS, label: t("admin.filtro.todos") }, ...autores]} value={filtros.autor}
              onChange={(v) => cambiar({ autor: v ?? TODOS })} allowDeselect={false} searchable w={240} />
          </Group>
          <Stack gap={4}>
            <Text size="sm" fw={500}>{t("admin.filtro.persona")}</Text>
            {personaElegida && (
              <Group gap="sm">
                <EnlacePersona persona={personaElegida} anios />
                <Button size="xs" variant="subtle" onClick={() => cambiar({ persona: null })}>{t("admin.filtro.quitar")}</Button>
              </Group>
            )}
            {!personaElegida && !eligiendo && (
              <Group><Button size="xs" variant="default" onClick={() => setEligiendo(true)}>{t("admin.elegirPersona")}</Button></Group>
            )}
            {!personaElegida && eligiendo && (
              <RecordPicker tipo="Person" placeholder={t("admin.buscarPersona")} conIds={admin}
                rotulo={(o: Base) => arbol.nombre(o as Persona)}
                alElegir={(o) => { cambiar({ persona: o.handle }); setEligiendo(false); }} />
            )}
          </Stack>
          {filtrando && <Group><Anchor component="button" type="button" size="sm" onClick={() => { setFiltros(FILTROS_VACIOS); setEligiendo(false); }}>{t("admin.filtro.limpiar")}</Anchor></Group>}
        </Stack>
      </Tarjeta>
      {error && <Alert color="red">{t("admin.errorCarga")}</Alert>}
      {!cargadas && !error && <Cargando />}
      {cargadas && (
        <Text size="sm" c="dimmed">
          {hayMas
            ? t("admin.registroParcial", { n: vistas.length, cargados: cargadas.length, fecha: textoMomento(cargadas[cargadas.length - 1].fecha.toDate(), true) })
            : t("admin.registroTotal", { n: vistas.length, cargados: cargadas.length })}
        </Text>
      )}
      {cargadas && !vistas.length && <Text c="dimmed">{t("admin.registroNada")}</Text>}
      {vistas.length > 0 && <ListaCambios lista={vistas} />}
      {hayMas && <Group><Button variant="default" onClick={cargarMas} loading={cargando}>{t("admin.cargarMas")}</Button></Group>}
    </Stack>
  );
}
