// Diálogo para descargar el árbol que se está viendo en PDF (decisiones del
// 23/10/2026, «Opciones de los PDF»): primero el título y el subtítulo (por
// defecto «Ascendientes de X»… y el nombre del árbol); después el papel (de
// A5 a A0, B, Letter, Legal, Tabloid y ANSI, con avisos para los muy
// pequeños y los muy grandes), la orientación (automática por defecto) y
// la disposición del árbol (por defecto, la del árbol en pantalla). Letra
// mínima de 8 puntos en el papel; si no cabe en una página, páginas de
// continuación (por defecto) o mosaico; y con A3, A2, A1 y A0, también «Una
// sola página» (por defecto con ellos; decisión del 25/10/2026), con la
// letra mínima más baja (4, 5 o 6 puntos, a elegir aquí; la persona
// principal, igual que las demás), también en papel de rollo de 91,4 cm, y, si ni así cabe, la propuesta de un papel mayor o de
// menos generaciones, la otra disposición o las cajas pequeñas. Las cajas
// pequeñas (sin fotos ni lugares, solo años) se pueden elegir en cualquier
// reparto (respuestas del 25/10/2026). Las generaciones empiezan con las de
// la pantalla y se pueden cambiar aquí, también a «Todas»; el administrador
// puede incluir los identificadores, en su línea bajo el nombre (decisiones
// del 30/10/2026). El reparto lo calcula
// app/src/arbol/paginasPdf.ts y el PDF lo hace app/src/componentes/
// pdfArbol.ts. Al terminar la descarga, la ventana se cierra sola (decisión
// del 22/10/2026); si hay algo que avisar, lo muestra la página con
// `alAvisar`.

import { useMemo, useState } from "react";
import { Alert, Button, Checkbox, Group, Modal, Radio, SegmentedControl, Select, Stack, Text, TextInput } from "@mantine/core";
import type { PaperOrientation } from "../gramps-connect/chartExport/paperSizes";
import type { TreeChartLabels } from "../gramps-connect/graficos/charts/treeChart";
import type { Arbol } from "../arbol/arbol";
import { useSesion } from "../acceso/sesion";
import {
  construirGrafico, generacionesEfectivas, generacionesQueHay, opcionesGeneraciones, type Disposicion, type Generaciones,
  type PresentacionCajas, type TipoGrafico,
} from "../arbol/grafico";
import {
  avisoPapel, dondeCabeUnaPagina, geometria, letraMinima, LETRA_MINIMA_PT, LETRA_MINIMA_UNA_PAGINA_PT,
  LETRAS_UNA_PAGINA_PT, PAPELES, PAPELES_UNA_PAGINA, planificarMosaico, planificarPaginas, planificarUnaPagina, rangoDonde, ROLLO,
  ROLLO_ANCHO_MM, ROLLO_LARGO_MAXIMO_MM, textosPlan, type ModoPdf, type PaginaPlan, type Papel, type PapelArbol, type Plan,
} from "../arbol/paginasPdf";
import type { Persona } from "../arbol/tipos";
import { textoMomento } from "../arbol/fechas";
import { formatoNumero, t, type Clave } from "../i18n";
import { OpcionDisposicion } from "./OpcionDisposicion";
import { exportarMosaico, exportarPaginas } from "./pdfArbol";

const ORIENTACIONES: PaperOrientation[] = ["auto", "portrait", "landscape"];

/** Nombre de un papel en la lista («A2», «Rollo de 91,4 cm») y dentro de
 * una frase («A2», «el rollo de 91,4 cm»). */
const nombrePapel = (p: PapelArbol) => (p === ROLLO ? t("pdf.rollo") : p);
const papelEnFrase = (p: PapelArbol) => (p === ROLLO ? t("pdf.rolloEnFrase") : p);

// Papel, orientación, modo, letra de «Una sola página» y cajas pequeñas
// elegidos la última vez, en este navegador.
const CLAVE = "web-genealogia.pdf";
interface Opciones {
  papel: PapelArbol;
  orientacion: PaperOrientation;
  modo: ModoPdf;
  /** Letra mínima en «Una sola página». */
  letraUna: number;
  /** Cajas pequeñas: sin fotos ni lugares, solo años. */
  sencillas: boolean;
}
const POR_DEFECTO: Opciones = {
  papel: "A4", orientacion: "auto", modo: "continuacion", letraUna: LETRA_MINIMA_UNA_PAGINA_PT, sencillas: false,
};
function leerOpciones(): Opciones {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) ?? "{}");
    return {
      papel: PAPELES.includes(v.papel) || v.papel === ROLLO ? v.papel : POR_DEFECTO.papel,
      orientacion: ORIENTACIONES.includes(v.orientacion) ? v.orientacion : POR_DEFECTO.orientacion,
      modo: v.modo === "mosaico" || v.modo === "unaPagina" ? v.modo : POR_DEFECTO.modo,
      letraUna: (LETRAS_UNA_PAGINA_PT as readonly number[]).includes(v.letraUna) ? v.letraUna : POR_DEFECTO.letraUna,
      sencillas: v.sencillas === true,
    };
  } catch {
    return POR_DEFECTO;
  }
}
function guardarOpciones(o: Opciones) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(o));
  } catch {
    // sin almacenamiento local: no se recuerda
  }
}

interface Props {
  abierto: boolean;
  alCerrar: () => void;
  arbol: Arbol;
  persona: Persona;
  tipo: TipoGrafico;
  /** Las pedidas en el árbol en pantalla («todas» o un número); se pueden
   * cambiar aquí. */
  generaciones: Generaciones;
  /** La del árbol en pantalla; se puede cambiar aquí. */
  disposicion: Disposicion;
  /** Símbolos de las cajas (las fechas, en el PDF, abreviadas; los IDs,
   * solo con la casilla). */
  presentacion: PresentacionCajas;
  labels: TreeChartLabels;
  photoUrl: (handle: string) => Promise<string | null>;
  /** Subtítulo por defecto: el nombre del árbol. */
  subtitulo: string;
  /** Aviso para después de cerrar (p. ej., que el árbol fue como imagen). */
  alAvisar: (aviso: string) => void;
}

export function ExportarPdf(props: Props) {
  return (
    <Modal opened={props.abierto} onClose={props.alCerrar} title={t("pdf.titulo")} closeButtonProps={{ "aria-label": t("pdf.cancelar") }}>
      {props.abierto && <Contenido {...props} />}
    </Modal>
  );
}

/** Nombre de fichero sin caracteres que Windows no admite. */
function nombreFichero(texto: string): string {
  return texto.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
}

function Contenido({
  alCerrar, alAvisar, arbol, persona, tipo, generaciones: generacionesPantalla, disposicion: inicial, presentacion, labels, photoUrl,
  subtitulo: subtituloInicial,
}: Props) {
  const [opciones, setOpciones] = useState(leerOpciones);
  const admin = useSesion().invitacion.rol === "administrador";
  // Sin recordar: cada vez, desmarcada (decisión del 30/10/2026).
  const [conIds, setConIds] = useState(false);
  // Las del árbol en pantalla, como mucho las que hay; se pueden cambiar (y
  // «Una sola página» puede proponer menos).
  const [pedidas, setPedidas] = useState<Generaciones>(generacionesPantalla);
  const hay = useMemo(() => generacionesQueHay(arbol, persona, tipo), [arbol, persona, tipo]);
  const generaciones = generacionesEfectivas(pedidas, hay);
  const [disposicion, setDisposicion] = useState(inicial);
  const [titulo, setTitulo] = useState(() => t(`grafico.titulo.${tipo}` as Clave, { nombre: arbol.nombre(persona) }));
  const [subtitulo, setSubtitulo] = useState(subtituloInicial);
  const [progreso, setProgreso] = useState<{ hecho: number; total: number } | null>(null);
  const [error, setError] = useState(false);
  const { papel, orientacion, letraUna, sencillas } = opciones;
  const conUnaPagina = (p: PapelArbol) => p === ROLLO || PAPELES_UNA_PAGINA.includes(p);
  const grande = conUnaPagina(papel);
  // El rollo solo tiene «Una sola página»; los otros repartos se calculan
  // (sin mostrarlos) con A0.
  const rollo = papel === ROLLO;
  const papelHojas: Papel = papel === ROLLO ? "A0" : papel;
  const modo: ModoPdf = rollo ? "unaPagina" : opciones.modo === "unaPagina" && !grande ? "continuacion" : opciones.modo;

  const cambiar = (o: Partial<Opciones>) => {
    const nuevas = { ...opciones, ...o };
    // Con A3 a A0, «Una sola página» por defecto; con los demás no existe.
    if (o.papel && o.papel !== papel) {
      const esGrande = conUnaPagina(o.papel);
      if (esGrande && !grande) nuevas.modo = "unaPagina";
      if (!esGrande && nuevas.modo === "unaPagina") nuevas.modo = "continuacion";
    }
    setOpciones(nuevas);
    guardarOpciones(nuevas);
  };

  // En el PDF, las fechas de las cajas con el mes abreviado («12 abr 1926»).
  const cajas = useMemo<PresentacionCajas>(
    () => ({ ...presentacion, ids: false, idsDebajo: admin && conIds, formato: "abreviado", sencillas }),
    [presentacion, admin, conIds, sencillas],
  );

  // El reparto en páginas, sin dibujar nada (rápido).
  const plan = useMemo(
    () => planificarPaginas({
      arbol, persona, tipo, generaciones, simbolos: cajas, papel: papelHojas, orientacion, disposicion, continua: (n) => t("pdf.continua", { n }),
    }),
    [arbol, persona, tipo, generaciones, cajas, papelHojas, orientacion, disposicion],
  );
  const paginas = plan.paginas;
  const primero = paginas[0].bloques[0];
  const cabe = !rollo && paginas.length === 1 && paginas[0].bloques.length === 1;
  const completo = useMemo(() => construirGrafico(arbol, persona, tipo, generaciones, cajas), [arbol, persona, tipo, generaciones, cajas]);
  const formas = useMemo(() => geometria(completo, disposicion), [completo, disposicion]);
  const mosaico = useMemo(() => planificarMosaico(formas, papelHojas, orientacion), [formas, papelHojas, orientacion]);
  const unaPagina = useMemo(
    () => (grande ? planificarUnaPagina(completo, persona, tipo, generaciones, disposicion, papel, orientacion, letraUna) : null),
    [grande, completo, persona, tipo, generaciones, disposicion, papel, orientacion, letraUna],
  );
  const ptUna = unaPagina?.plan.paginas[0].composicion.pt ?? 0;
  // En el rollo, el largo de la hoja, en cm.
  const hojaRollo = unaPagina?.plan.hoja;
  const largoRollo = hojaRollo ? Math.round((hojaRollo.ancho === ROLLO_ANCHO_MM ? hojaRollo.alto : hojaRollo.ancho) / 10) : 0;
  // Si no cabe: el papel en que cabría (o el rollo), o las generaciones que
  // caben en el rollo; y lo mismo con la otra disposición, por si es mejor.
  const noCabeUna = !cabe && modo === "unaPagina" && !!unaPagina && !unaPagina.cabe;
  const otra: Disposicion = disposicion === "vertical" ? "horizontal" : "vertical";
  const donde = useMemo(
    () => (noCabeUna ? dondeCabeUnaPagina({ arbol, persona, tipo, generaciones, simbolos: cajas, disposicion, orientacion }, completo, letraUna) : null),
    [noCabeUna, arbol, persona, tipo, generaciones, cajas, disposicion, orientacion, completo, letraUna],
  );
  const dondeOtra = useMemo(
    () => (noCabeUna
      ? dondeCabeUnaPagina({ arbol, persona, tipo, generaciones, simbolos: cajas, disposicion: otra, orientacion }, completo, letraUna)
      : null),
    [noCabeUna, arbol, persona, tipo, generaciones, cajas, otra, orientacion, completo, letraUna],
  );
  // La otra disposición, si cabe en un papel más pequeño o con más
  // generaciones (si cabe en el papel elegido, se dice así).
  const mejorOtra = !!donde && !!dondeOtra && rangoDonde(dondeOtra) < rangoDonde(donde);
  // Con cajas pequeñas, ¿cabría en este papel?
  const cabePequenas = useMemo(() => {
    if (!noCabeUna || sencillas) return false;
    const d = construirGrafico(arbol, persona, tipo, generaciones, { ...cajas, sencillas: true });
    return planificarUnaPagina(d, persona, tipo, generaciones, disposicion, papel, orientacion, letraUna).cabe;
  }, [noCabeUna, sencillas, arbol, persona, tipo, generaciones, cajas, disposicion, papel, orientacion, letraUna]);
  const peor = letraMinima(plan);
  const puntos = (n: number) => formatoNumero(Math.round(n * 10) / 10);
  const aviso = rollo ? "grande" : avisoPapel(papel);
  const tituloFinal = titulo.trim();

  // Al pie de la primera página, las generaciones y la fecha de los datos
  // (decisión del 23/10/2026).
  const piePrimera = t("pdf.pieDatos", { n: generaciones, fecha: textoMomento(new Date(arbol.generada)) });
  const enUnaPagina = !cabe && modo === "unaPagina" && !!unaPagina;
  const planPaginas: Plan = enUnaPagina ? unaPagina!.plan : plan;
  const todos = useMemo(
    () => textosPlan(arbol, planPaginas, persona, tipo, subtitulo.trim(), 0, true, tituloFinal, piePrimera),
    [arbol, planPaginas, persona, tipo, subtitulo, tituloFinal, piePrimera],
  );
  const textos = (p: PaginaPlan) => todos[p.numero - 1];

  async function descargar() {
    const porPaginas = cabe || modo !== "mosaico";
    setProgreso({ hecho: 0, total: porPaginas ? planPaginas.paginas.reduce((n, p) => n + p.bloques.length, 0) : mosaico.hojas.length });
    setError(false);
    const dibujo = { labels, photoUrl, layout: disposicion };
    const fichero = nombreFichero(tituloFinal);
    try {
      const resultado = porPaginas
        ? await exportarPaginas(planPaginas, papel, textos, dibujo, fichero, (hecho, total) => setProgreso({ hecho, total }))
        : await exportarMosaico(completo, formas.formas, persona.handle, mosaico, {
          titulo: tituloFinal,
          pie: piePrimera,
          hoja: (n, total, fila, columna, filas, columnas) => t("pdf.hoja", { n, total, fila, columna, filas, columnas }),
        }, dibujo, fichero);
      alCerrar();
      if (resultado.comoImagen) alAvisar(t("pdf.imagen"));
    } catch (e) {
      console.error(e);
      setError(true);
    } finally {
      setProgreso(null);
    }
  }

  return (
    <Stack>
      <TextInput label={t("pdf.tituloPdf")} value={titulo} onChange={(e) => setTitulo(e.currentTarget.value)} />
      <TextInput label={t("pdf.subtituloPdf")} value={subtitulo} onChange={(e) => setSubtitulo(e.currentTarget.value)} />
      <Select
        label={t("pdf.papel")}
        data={([...PAPELES, ROLLO] as PapelArbol[]).map((p) => ({ value: p, label: nombrePapel(p) }))}
        value={papel}
        onChange={(v) => v && cambiar({ papel: v as PapelArbol })}
        allowDeselect={false}
        w={220}
      />
      {aviso && <Alert color="orange" p="xs"><Text size="sm">{t(`pdf.papel.${aviso}` as Clave)}</Text></Alert>}
      <div>
        <Text size="sm" fw={500} mb={4}>{t("pdf.orientacion")}</Text>
        <SegmentedControl
          value={orientacion}
          onChange={(v) => cambiar({ orientacion: v as PaperOrientation })}
          data={ORIENTACIONES.map((o) => ({ value: o, label: t(`pdf.orientacion.${o}` as Clave) }))}
        />
      </div>
      <Select
        label={t("grafico.generaciones")}
        w={140}
        data={opcionesGeneraciones(hay).map((v) => ({ value: v, label: v === "todas" ? t("generaciones.todas") : v }))}
        value={pedidas === "todas" ? "todas" : String(generaciones)}
        onChange={(v) => v && setPedidas(v === "todas" ? "todas" : Number(v))}
        allowDeselect={false}
      />
      <OpcionDisposicion value={disposicion} onChange={setDisposicion} />
      <Checkbox
        checked={sencillas}
        onChange={(e) => cambiar({ sencillas: e.currentTarget.checked })}
        label={t("pdf.cajasPequenas")}
        description={t("pdf.cajasPequenasAyuda")}
      />
      {admin && (
        <Checkbox
          checked={conIds}
          onChange={(e) => setConIds(e.currentTarget.checked)}
          label={t("pdf.incluirIds")}
          description={t("pdf.incluirIdsAyuda")}
        />
      )}
      {rollo ? (
        <Text size="sm">
          {unaPagina?.cabe
            ? t("pdf.rolloAyuda", { largo: formatoNumero(largoRollo), pt: puntos(ptUna) })
            : t("pdf.rolloNoCabe", { max: formatoNumero(ROLLO_LARGO_MAXIMO_MM / 1000), min: letraUna })}
        </Text>
      ) : cabe ? (
        <Text size="sm">{t("pdf.cabe", { pt: puntos(paginas[0].composicion.pt) })}</Text>
      ) : (
        <Radio.Group label={t("pdf.noCabe", { min: LETRA_MINIMA_PT })} value={modo} onChange={(v) => cambiar({ modo: v as ModoPdf })}>
          <Stack gap="xs" mt={6}>
            {grande && (
              <Radio
                value="unaPagina"
                label={t("pdf.modo.unaPagina")}
                description={unaPagina?.cabe
                  ? t("pdf.modo.unaPaginaAyuda", { papel, pt: puntos(ptUna) })
                  : t("pdf.modo.unaPaginaNoCabe", { papel, min: letraUna })}
              />
            )}
            <Radio
              value="continuacion"
              label={t("pdf.modo.continuacion")}
              description={t("pdf.modo.continuacionAyuda", { paginas: paginas.length, g: primero.generaciones })}
            />
            <Radio
              value="mosaico"
              label={t("pdf.modo.mosaico")}
              description={t("pdf.modo.mosaicoAyuda", { hojas: mosaico.hojas.length, filas: mosaico.filas, columnas: mosaico.columnas })}
            />
          </Stack>
        </Radio.Group>
      )}
      {!cabe && grande && modo === "unaPagina" && (
        <div>
          <Text size="sm" mb={4}>{t("pdf.unaPagina.letra")}</Text>
          <SegmentedControl
            value={String(letraUna)}
            onChange={(v) => cambiar({ letraUna: Number(v) })}
            data={LETRAS_UNA_PAGINA_PT.map((n) => ({ value: String(n), label: t("pdf.unaPagina.puntos", { n }) }))}
          />
        </div>
      )}
      {noCabeUna && donde && (
        <Alert color="orange">
          <Stack gap="xs">
            <Text size="sm">
              {donde.papel
                ? t("pdf.unaPagina.cabeEn", { papel: papelEnFrase(donde.papel) })
                : donde.generaciones
                  ? t("pdf.unaPagina.niEnRollo", { g: donde.generaciones })
                  : t("pdf.unaPagina.niConMinimas")}
            </Text>
            {mejorOtra && dondeOtra && (
              <Text size="sm">
                {dondeOtra.papel === papel
                  ? t("pdf.unaPagina.otraAqui", { disp: t(`pdf.disposicionCorta.${otra}`) })
                  : dondeOtra.papel
                    ? t("pdf.unaPagina.otraEn", { disp: t(`pdf.disposicionCorta.${otra}`), papel: papelEnFrase(dondeOtra.papel) })
                    : t("pdf.unaPagina.otraGen", { disp: t(`pdf.disposicionCorta.${otra}`), g: dondeOtra.generaciones! })}
              </Text>
            )}
            {cabePequenas && <Text size="sm">{t("pdf.unaPagina.pequenasAqui")}</Text>}
            <Group gap="xs">
              {mejorOtra && (
                <Button size="xs" variant="default" onClick={() => setDisposicion(otra)}>{t("pdf.unaPagina.usarDisposicion", { disp: t(`pdf.disposicionCorta.${otra}`) })}</Button>
              )}
              {cabePequenas && <Button size="xs" variant="default" onClick={() => cambiar({ sencillas: true })}>{t("pdf.unaPagina.usarPequenas")}</Button>}
              {donde.papel && <Button size="xs" variant="default" onClick={() => cambiar({ papel: donde.papel! })}>{t("pdf.unaPagina.usarPapel", { papel: papelEnFrase(donde.papel) })}</Button>}
              {!donde.papel && donde.generaciones && (
                <Button size="xs" variant="default" onClick={() => setPedidas(donde.generaciones!)}>{t("pdf.unaPagina.usarGeneraciones", { g: donde.generaciones })}</Button>
              )}
              {!rollo && <Button size="xs" variant="default" onClick={() => cambiar({ modo: "continuacion" })}>{t("pdf.unaPagina.usarContinuacion")}</Button>}
            </Group>
          </Stack>
        </Alert>
      )}
      {!cabe && modo === "continuacion" && peor && peor.pt < LETRA_MINIMA_PT && (
        <Alert color="orange">
          <Text size="sm">{t("pdf.letraPequena", { pagina: peor.pagina.numero, pt: puntos(peor.pt), min: LETRA_MINIMA_PT, nombre: arbol.nombre(peor.pagina.bloques[0].persona) })}</Text>
        </Alert>
      )}
      {cabe && peor && peor.pt < LETRA_MINIMA_PT && (
        <Alert color="orange">
          <Text size="sm">{t("pdf.letraPequena", { pagina: 1, pt: puntos(peor.pt), min: LETRA_MINIMA_PT, nombre: arbol.nombre(persona) })}</Text>
        </Alert>
      )}
      {error && <Alert color="red"><Text size="sm">{t("pdf.error")}</Text></Alert>}
      {progreso && <Text size="sm" c="dimmed">{t("pdf.preparando", { n: Math.min(progreso.hecho + 1, progreso.total), total: progreso.total })}</Text>}
      <Group justify="flex-end">
        <Button variant="default" onClick={alCerrar}>{t("pdf.cancelar")}</Button>
        <Button onClick={descargar} loading={!!progreso} disabled={!tituloFinal || (enUnaPagina && !unaPagina!.cabe)}>{t("pdf.descargar")}</Button>
      </Group>
    </Stack>
  );
}
