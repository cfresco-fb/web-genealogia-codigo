// Diálogo del libro en PDF: opciones (docs/decisiones-web-familiar.md,
// «Libro: detalles») y generación. El contenido lo arma app/src/arbol/
// libro.ts y el PDF app/src/componentes/pdfLibro.ts, que se descarga solo
// al generar el libro (con jsPDF). Al terminar, la ventana se cierra sola.

import { useMemo, useState } from "react";
import {
  Alert, Button, Checkbox, Group, Modal, Radio, SegmentedControl, Select, Stack, Text, TextInput,
} from "@mantine/core";
import { usePreferencias } from "../acceso/preferencias";
import { useSesion } from "../acceso/sesion";
import type { Arbol } from "../arbol/arbol";
import { anio } from "../arbol/fechas";
import {
  generacionesEfectivas, generacionesQueHay, opcionesGeneraciones, TIPOS_GRAFICO, type Disposicion, type Generaciones, type TipoGrafico,
} from "../arbol/grafico";
import { construirLibro, personasDelLibro, type OpcionesLibro } from "../arbol/libro";
import type { Persona } from "../arbol/tipos";
import { comparador, t, type Clave } from "../i18n";
import { OpcionDisposicion } from "./OpcionDisposicion";
import type { Dibujo } from "./pdfArbol";
import { PAPELES_LIBRO, type PapelLibro } from "../arbol/paginasPdf";

// Opciones elegidas la última vez, en este navegador (no la persona ni los
// textos de la portada).
const CLAVE = "web-genealogia.libro";
interface Recordadas {
  eventos: OpcionesLibro["eventos"];
  notas: boolean;
  fotos: OpcionesLibro["fotos"];
  arboles: boolean;
  /** Cajas pequeñas en los árboles insertados, como en el PDF del árbol
   * (decisión del 29/10/2026). */
  cajasPequenas: boolean;
  indiceLugares: boolean;
  vivos: "todos" | "omitir";
  papel: PapelLibro;
}
const POR_DEFECTO: Recordadas = {
  eventos: "principales", notas: true, fotos: "principal", arboles: true, cajasPequenas: false, indiceLugares: false, vivos: "omitir", papel: "A4",
};
function leer(): Recordadas {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) ?? "{}");
    return {
      eventos: v.eventos === "todos" ? "todos" : "principales",
      notas: typeof v.notas === "boolean" ? v.notas : POR_DEFECTO.notas,
      fotos: ["ninguna", "principal", "todas"].includes(v.fotos) ? v.fotos : POR_DEFECTO.fotos,
      arboles: typeof v.arboles === "boolean" ? v.arboles : POR_DEFECTO.arboles,
      cajasPequenas: v.cajasPequenas === true,
      indiceLugares: typeof v.indiceLugares === "boolean" ? v.indiceLugares : POR_DEFECTO.indiceLugares,
      vivos: v.vivos === "todos" ? "todos" : "omitir",
      papel: PAPELES_LIBRO.includes(v.papel) ? v.papel : "A4",
    };
  } catch {
    return POR_DEFECTO;
  }
}
function guardar(o: Recordadas) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(o));
  } catch {
    // sin almacenamiento local: no se recuerda
  }
}

interface Props {
  abierto: boolean;
  alCerrar: () => void;
  /** Aviso para después de cerrar. */
  alAvisar: (aviso: string) => void;
  arbol: Arbol;
  persona: Persona;
  tipo: TipoGrafico;
  /** Las pedidas en el árbol en pantalla («todas» o un número). */
  generaciones: Generaciones;
  /** La del árbol en pantalla, para los árboles insertados; se puede cambiar. */
  disposicion: Disposicion;
  /** Etiquetas y fotos para dibujar los árboles (la disposición se elige aquí). */
  dibujo: Omit<Dibujo, "layout">;
}

export function ExportarLibro(props: Props) {
  return (
    <Modal opened={props.abierto} onClose={props.alCerrar} title={t("libro.dialogo.titulo")} size="lg" closeButtonProps={{ "aria-label": t("pdf.cancelar") }}>
      {props.abierto && <Contenido {...props} />}
    </Modal>
  );
}

function nombreFichero(texto: string): string {
  return texto.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
}

function Contenido({ alCerrar, alAvisar, arbol, persona: inicial, tipo, generaciones: genInicial, disposicion: dispInicial, dibujo }: Props) {
  const { simbolos, vivas, nombreArbol } = usePreferencias();
  const { invitacion } = useSesion();
  const [o, setO] = useState(leer);
  const [handle, setHandle] = useState(inicial.handle);
  const [alcance, setAlcance] = useState<TipoGrafico>(tipo);
  const [pedidas, setPedidas] = useState<Generaciones>(genInicial);
  const [disposicion, setDisposicion] = useState(dispInicial);
  const [titulo, setTitulo] = useState<string | null>(null);
  const [subtitulo, setSubtitulo] = useState(nombreArbol);
  const [avance, setAvance] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const persona = arbol.persona(handle) ?? inicial;
  // Sin máximo fijo: las que hay para esa persona, o todas (29/10/2026),
  // contadas desde los padres o los hijos (30/10/2026); empieza con el
  // mismo número que la pantalla.
  const hay = useMemo(() => generacionesQueHay(arbol, persona, alcance) - 1, [arbol, persona, alcance]);
  const generaciones = generacionesEfectivas(pedidas, hay, 1);
  const admin = invitacion.rol === "administrador";
  // Sin recordar: cada vez, desmarcada (decisión del 30/10/2026).
  const [conIds, setConIds] = useState(false);

  const cambiar = (c: Partial<Recordadas>) => {
    const n = { ...o, ...c };
    setO(n);
    guardar(n);
  };

  const tituloPorDefecto = t(`grafico.titulo.${alcance}` as Clave, { nombre: arbol.nombre(persona) });
  const tituloFinal = titulo ?? tituloPorDefecto;

  // Lista de personas para elegir, por apellidos.
  const lista = useMemo(() => [...arbol.personas.values()]
    .map((p) => {
      const n = anio(arbol.nacimiento(p)?.evento.date);
      return { value: p.handle, label: `${arbol.nombreOrden(p)}${n === null ? "" : ` (${n})`}` };
    })
    .sort((a, b) => comparador.compare(a.label, b.label)), [arbol]);

  const privadas = o.vivos === "omitir" ? vivas : new Set<string>();
  const opciones: OpcionesLibro = {
    persona, alcance, generaciones, eventos: o.eventos, notas: o.notas, fotos: o.fotos, arboles: o.arboles, indiceLugares: o.indiceLugares,
    ids: admin && conIds,
  };
  const libro = useMemo(
    () => construirLibro(arbol, opciones, privadas, vivas),
    // privadas cambia solo con o.vivos (ya en o) o con los parámetros.
    [arbol, persona, alcance, generaciones, o, vivas, admin, conIds],
  );
  const enLibro = useMemo(() => personasDelLibro(libro), [libro]);
  const vivasEnLibro = [...enLibro].filter((h) => vivas.has(h)).length;

  async function generar() {
    setError(false);
    setAvance(t("libro.avance.preparando"));
    try {
      const { exportarLibro } = await import("./pdfLibro");
      const r = await exportarLibro(
        arbol, libro, { ...opciones, papel: o.papel, titulo: tituloFinal, subtitulo, nombreArbol, sinVivos: o.vivos === "omitir" && vivasEnLibro > 0 },
        // El ID de Gramps en las cajas, solo para el administrador.
        { ...simbolos, ids: false, idsDebajo: admin && conIds, vivas, sencillas: o.arboles && o.cajasPequenas }, privadas, { ...dibujo, layout: disposicion }, nombreFichero(tituloFinal), (a) => setAvance(a.texto),
      );
      alCerrar();
      const avisos = [
        r.arbolComoImagen ? t("pdf.imagen") : "",
        r.sinLetra.length ? t("libro.sinLetra", { caracteres: r.sinLetra.join(" ") }) : "",
      ].filter(Boolean);
      if (avisos.length) alAvisar(avisos.join(" "));
    } catch (e) {
      console.error(e);
      setError(true);
    } finally {
      setAvance(null);
    }
  }

  return (
    <Stack gap="md">
      <TextInput label={t("libro.dialogo.tituloPortada")} value={tituloFinal} onChange={(e) => setTitulo(e.currentTarget.value)} />
      <TextInput label={t("libro.dialogo.subtituloPortada")} value={subtitulo} onChange={(e) => setSubtitulo(e.currentTarget.value)} />
      <Select
        label={t("libro.dialogo.persona")}
        data={lista}
        value={handle}
        onChange={(v) => v && setHandle(v)}
        searchable
        limit={50}
        allowDeselect={false}
        nothingFoundMessage={t("libro.dialogo.nadie")}
      />
      <Group align="flex-end" gap="md">
        <div>
          <Text size="sm" fw={500} mb={4}>{t("libro.dialogo.alcance")}</Text>
          <SegmentedControl
            value={alcance}
            onChange={(v) => setAlcance(v as TipoGrafico)}
            data={TIPOS_GRAFICO.map((v) => ({ value: v, label: t(`grafico.tipo.${v}` as Clave) }))}
          />
        </div>
        <Select
          label={t("grafico.generaciones")}
          w={110}
          data={opcionesGeneraciones(hay, 1).map((v) => ({ value: v, label: v === "todas" ? t("generaciones.todas") : v }))}
          value={pedidas === "todas" ? "todas" : String(generaciones)}
          onChange={(v) => v && setPedidas(v === "todas" ? "todas" : Number(v))}
          allowDeselect={false}
        />
      </Group>
      <Text size="sm" c="dimmed" mt={-8}>{t("libro.dialogo.generacionesAyuda")}</Text>
      <Radio.Group label={t("libro.dialogo.eventos")} value={o.eventos} onChange={(v) => cambiar({ eventos: v as Recordadas["eventos"] })}>
        <Group mt={6} gap="lg">
          <Radio value="principales" label={t("libro.dialogo.eventos.principales")} />
          <Radio value="todos" label={t("libro.dialogo.eventos.todos")} />
        </Group>
      </Radio.Group>
      <div>
        <Text size="sm" fw={500} mb={4}>{t("libro.dialogo.fotos")}</Text>
        <SegmentedControl
          value={o.fotos}
          onChange={(v) => cambiar({ fotos: v as Recordadas["fotos"] })}
          data={(["ninguna", "principal", "todas"] as const).map((v) => ({ value: v, label: t(`libro.dialogo.fotos.${v}` as Clave) }))}
        />
      </div>
      <Stack gap={6}>
        <Checkbox label={t("libro.dialogo.notas")} checked={o.notas} onChange={(e) => cambiar({ notas: e.currentTarget.checked })} />
        <Checkbox label={t("libro.dialogo.arboles")} description={t("libro.dialogo.arbolesAyuda")} checked={o.arboles} onChange={(e) => cambiar({ arboles: e.currentTarget.checked })} />
        {o.arboles && (
          <Stack gap={6} style={{ marginLeft: 32 }}>
            <OpcionDisposicion value={disposicion} onChange={setDisposicion} />
            <Checkbox
              checked={o.cajasPequenas}
              onChange={(e) => cambiar({ cajasPequenas: e.currentTarget.checked })}
              label={t("pdf.cajasPequenas")}
              description={t("pdf.cajasPequenasAyuda")}
            />
          </Stack>
        )}
        <Checkbox label={t("libro.dialogo.indiceLugares")} description={t("libro.dialogo.indicePersonasSiempre")} checked={o.indiceLugares} onChange={(e) => cambiar({ indiceLugares: e.currentTarget.checked })} />
        {admin && (
          <Checkbox label={t("pdf.incluirIds")} description={t("libro.dialogo.incluirIdsAyuda")} checked={conIds} onChange={(e) => setConIds(e.currentTarget.checked)} />
        )}
      </Stack>
      <Radio.Group
        label={t("libro.dialogo.vivos")}
        description={t("libro.dialogo.vivosAyuda")}
        value={o.vivos}
        onChange={(v) => cambiar({ vivos: v as Recordadas["vivos"] })}
      >
        <Stack mt={6} gap={6}>
          <Radio value="omitir" label={t("libro.dialogo.vivos.omitir")} />
          <Radio value="todos" label={t("libro.dialogo.vivos.todos")} />
        </Stack>
      </Radio.Group>
      <div>
        <Text size="sm" fw={500} mb={4}>{t("pdf.papel")}</Text>
        <SegmentedControl value={o.papel} onChange={(v) => cambiar({ papel: v as PapelLibro })} data={PAPELES_LIBRO.map((p) => ({ value: p, label: p }))} />
      </div>
      <Text size="sm" c="dimmed">
        {t("libro.dialogo.resumen", { personas: enLibro.size })}
        {" "}
        {vivasEnLibro > 0 && t(o.vivos === "omitir" ? "libro.dialogo.resumenOmitidas" : "libro.dialogo.resumenIncluidas", { n: vivasEnLibro })}
      </Text>
      {error && <Alert color="red"><Text size="sm">{t("libro.error")}</Text></Alert>}
      {avance && <Text size="sm" c="dimmed">{avance}</Text>}
      <Group justify="flex-end">
        <Button variant="default" onClick={alCerrar}>{t("pdf.cancelar")}</Button>
        <Button onClick={generar} loading={!!avance} disabled={!tituloFinal.trim()}>{t("libro.dialogo.generar")}</Button>
      </Group>
    </Stack>
  );
}
