// Ajustes (decisiones del 23/10/2026, «Ajustes, persona de inicio, cajas y
// fechas», y del 24/10/2026, «Diseño visual»), en dos bloques, cada sección
// en su tarjeta: «Tu cuenta» (correo con el rol, quién soy en el árbol,
// persona de inicio, símbolos, región y formato de fecha, modo de color) y
// «Administración del árbol» (nombre del árbol, quién se considera vivo).
// Los demás usuarios no ven el bloque del administrador. «Salir», en el
// menú de la cuenta de la cabecera (28/10/2026).

import { useMemo, useState, type ReactNode } from "react";
import { Alert, Checkbox, Group, NumberInput, SegmentedControl, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { GENERACIONES_MIN, GENERACIONES_POR_DEFECTO, type Generaciones as GeneracionesArbol } from "../arbol/grafico";
import { MODOS_COLOR, usePreferencias, type ModoColor } from "../acceso/preferencias";
import { useSesion } from "../acceso/sesion";
import { useArbol } from "../arbol/contexto";
import { muestraFecha, normalizarRegion, regionFechas, regionNavegador } from "../arbol/fechas";
import { EnlacePersona } from "../componentes/Enlaces";
import { Tarjeta } from "../componentes/Ficha";
import { SeccionNombreArbol } from "../componentes/NombreArbol";
import { SeccionSimbolos } from "../componentes/Simbolos";
import { SeccionVivos } from "../componentes/Vivos";
import { VolverAMi } from "../componentes/VolverAMi";
import { comparador, idioma, t, type Clave } from "../i18n";

/** Regiones que se ofrecen (además de la del navegador, si no está): las
 * de los países donde hay familia o es fácil que la haya. */
const REGIONES = [
  "es-ES", "es-AR", "es-CL", "es-CO", "es-MX", "es-PE", "es-UY", "es-VE", "es-US", "ca-ES",
  "en-US", "en-GB", "en-CA", "en-AU", "fr-FR", "de-DE", "it-IT", "pt-PT", "pt-BR", "nl-NL", "pl-PL",
  "ru-RU", "uk-UA", "he-IL",
];

/** «Inglés (Estados Unidos)». */
function nombreRegion(r: string): string {
  try {
    const n = new Intl.DisplayNames(idioma().intl, { type: "language", languageDisplay: "standard" }).of(r) ?? r;
    return n.charAt(0).toUpperCase() + n.slice(1);
  } catch {
    return r;
  }
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <Tarjeta>
      <Stack gap="xs" component="section">
        <Title order={3}>{titulo}</Title>
        {children}
      </Stack>
    </Tarjeta>
  );
}

/** Uno de los dos bloques: «Tu cuenta» y «Administración del árbol». */
function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <Stack gap="sm" component="section">
      <Title order={2}>{titulo}</Title>
      {children}
    </Stack>
  );
}

/** Modo de color (decisión del 24/10/2026, «Diseño visual»): se guarda en
 * la cuenta, como la persona de inicio. */
function ModoDeColor() {
  const { modoColor, guardarModoColor } = usePreferencias();
  const [estado, setEstado] = useState<"" | "guardando" | "guardado" | "error">("");

  async function cambiar(v: string) {
    setEstado("guardando");
    try {
      await guardarModoColor(v as ModoColor);
      setEstado("guardado");
    } catch (e) {
      console.error(e);
      setEstado("error");
    }
  }

  return (
    <>
      <Text size="sm" c="dimmed">{t("ajustes.modoColorAyuda")}</Text>
      <SegmentedControl
        aria-label={t("ajustes.modoColor")}
        value={modoColor}
        onChange={cambiar}
        disabled={estado === "guardando"}
        data={MODOS_COLOR.map((m) => ({ value: m, label: t(`ajustes.modo.${m}` as Clave) }))}
        style={{ alignSelf: "flex-start" }}
      />
      {estado === "guardado" && <Text size="sm" c="green">{t("simbolos.guardado")}</Text>}
      {estado === "error" && <Alert color="red"><Text size="sm">{t("simbolos.error")}</Text></Alert>}
    </>
  );
}

function PersonaInicio() {
  const arbol = useArbol();
  const { invitacion } = useSesion();
  const { personaInicio, personaInicioPropia } = usePreferencias();
  const vinculada = arbol.persona(invitacion.persona);

  return (
    <>
      <Text size="sm" c="dimmed">{t("ajustes.personaInicioAyuda")}</Text>
      {personaInicio
        ? <Text><EnlacePersona persona={personaInicio} anios /></Text>
        : <Text c="dimmed">{t("inicio.sinPersonaInicio")}</Text>}
      {!personaInicioPropia && personaInicio && (
        <Text size="sm" c="dimmed">{t(vinculada ? "ajustes.esVinculada" : "ajustes.esDeGramps")}</Text>
      )}
      <VolverAMi />
    </>
  );
}

function Region() {
  const { region, guardarRegion } = usePreferencias();
  const [estado, setEstado] = useState<"" | "guardando" | "guardado" | "error">("");
  const navegador = regionNavegador();
  const AUTO = "auto";
  const opciones = useMemo(() => {
    const lista = [...new Set([...REGIONES, navegador, ...(region ? [region] : [])])]
      .map((r) => ({ value: r, label: nombreRegion(r) }))
      .sort((a, b) => comparador.compare(a.label, b.label));
    return [{ value: AUTO, label: t("ajustes.regionAuto", { region: nombreRegion(navegador) }) }, ...lista];
  }, [navegador, region]);
  const actual = regionFechas();

  async function cambiar(v: string | null) {
    if (!v) return;
    setEstado("guardando");
    try {
      await guardarRegion(v === AUTO ? null : normalizarRegion(v));
      setEstado("guardado");
    } catch (e) {
      console.error(e);
      setEstado("error");
    }
  }

  return (
    <>
      <Text size="sm" c="dimmed">{t("ajustes.regionAyuda")}</Text>
      <Select
        label={t("ajustes.regionCampo")}
        data={opciones}
        value={region ?? AUTO}
        onChange={cambiar}
        allowDeselect={false}
        searchable
        maw={420}
        disabled={estado === "guardando"}
      />
      <Text size="sm">
        {t("ajustes.regionEjemplo", {
          largo: muestraFecha(actual, "largo"), corto: muestraFecha(actual, "corto"), abreviado: muestraFecha(actual, "abreviado"),
        })}
      </Text>
      {estado === "guardado" && <Text size="sm" c="green">{t("simbolos.guardado")}</Text>}
      {estado === "error" && <Alert color="red"><Text size="sm">{t("simbolos.error")}</Text></Alert>}
    </>
  );
}

/** Generaciones con que se abre el árbol (decisión del 29/10/2026): desde 2,
 * sin límite, o todas; sin elegir, 4. Se guarda al dejar de escribir. */
function Generaciones() {
  const { generaciones, guardarGeneraciones } = usePreferencias();
  const [numero, setNumero] = useState<number | string>(generaciones === "todas" ? GENERACIONES_POR_DEFECTO : generaciones);
  // La casilla cambia al momento, sin esperar a que se guarde.
  const [todas, setTodas] = useState(generaciones === "todas");
  const [estado, setEstado] = useState<"" | "guardando" | "guardado" | "error">("");

  async function guardar(g: GeneracionesArbol) {
    if (g === generaciones) return;
    setEstado("guardando");
    try {
      // Las de por defecto no se guardan.
      await guardarGeneraciones(g === GENERACIONES_POR_DEFECTO ? null : g);
      setEstado("guardado");
    } catch (e) {
      console.error(e);
      setEstado("error");
    }
  }
  const valido = typeof numero === "number" && Number.isInteger(numero) && numero >= GENERACIONES_MIN;

  return (
    <>
      <Text size="sm" c="dimmed">{t("ajustes.generacionesAyuda")}</Text>
      <Group gap="md" align="center">
        <NumberInput
          label={t("ajustes.generacionesCampo")}
          value={numero}
          min={GENERACIONES_MIN}
          allowDecimal={false}
          allowNegative={false}
          w={140}
          disabled={todas}
          error={!valido && !todas ? t("ajustes.generacionesMinimo", { n: GENERACIONES_MIN }) : undefined}
          onChange={setNumero}
          onBlur={() => { if (valido) guardar(numero); }}
          onKeyDown={(e) => { if (e.key === "Enter" && valido) guardar(numero); }}
        />
        <Checkbox
          mt="lg"
          label={t("ajustes.generacionesTodas")}
          checked={todas}
          disabled={estado === "guardando"}
          onChange={(e) => {
            const marcada = e.currentTarget.checked;
            setTodas(marcada);
            guardar(marcada ? "todas" : valido ? numero : GENERACIONES_POR_DEFECTO);
          }}
        />
      </Group>
      {estado === "guardado" && <Text size="sm" c="green">{t("simbolos.guardado")}</Text>}
      {estado === "error" && <Alert color="red"><Text size="sm">{t("simbolos.error")}</Text></Alert>}
    </>
  );
}

export function Ajustes() {
  const arbol = useArbol();
  const { usuario, invitacion } = useSesion();
  const admin = invitacion.rol === "administrador";
  const vinculada = arbol.persona(invitacion.persona);

  return (
    <Stack gap="xl" maw={760}>
      <Title order={1}>{t("ajustes.titulo")}</Title>

      <Bloque titulo={t("ajustes.tuCuenta")}>
        <Tarjeta>
          <Group gap="sm" align="flex-end" wrap="wrap">
            <TextInput
              label={t("ajustes.correo")}
              description={t("ajustes.correoAyuda")}
              value={usuario.email ?? invitacion.correo}
              readOnly
              w={420}
              maw="100%"
            />
            <span className="tema-pildora" style={{ marginBottom: 8 }}>
              {t("ajustes.rol", { rol: t(`rol.${invitacion.rol}` as Clave) })}
            </span>
          </Group>
        </Tarjeta>

        <Seccion titulo={t("ajustes.quienSoy")}>
          {vinculada
            ? <Text><EnlacePersona persona={vinculada} anios /></Text>
            : <Text c="dimmed">{t("ajustes.sinVinculo")}</Text>}
        </Seccion>

        <Seccion titulo={t("ajustes.personaInicio")}>
          <PersonaInicio />
        </Seccion>

        <Seccion titulo={t("ajustes.generaciones")}>
          <Generaciones />
        </Seccion>

        <Seccion titulo={t("simbolos.titulo")}>
          <SeccionSimbolos />
        </Seccion>

        <Seccion titulo={t("ajustes.region")}>
          <Region />
        </Seccion>

        <Seccion titulo={t("ajustes.modoColor")}>
          <ModoDeColor />
        </Seccion>
      </Bloque>

      {admin && (
        <Bloque titulo={t("ajustes.administracion")}>
          <Seccion titulo={t("nombreArbol.titulo")}>
            <SeccionNombreArbol />
          </Seccion>

          <Seccion titulo={t("vivos.titulo")}>
            <SeccionVivos />
          </Seccion>
        </Bloque>
      )}
    </Stack>
  );
}
