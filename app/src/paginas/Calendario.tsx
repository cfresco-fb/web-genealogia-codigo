// Calendario de aniversarios (/calendario; docs/calendario.md; decisiones
// de Carlos del 01/11/2026 y del 03/11/2026 en
// docs/decisiones-web-familiar.md, «Calendario de aniversarios»): los
// próximos aniversarios desde hoy, con un rango de opciones fijas (30 días
// al abrir, sin recordarlo) y casillas por tipo, todas marcadas al abrir.
// Debajo de los filtros, lo que hay en Ajustes sobre el correo de
// aniversarios (o lo elegido), con el enlace (04/11/2026). Agrupados por
// día, con «Hoy» o «Mañana» delante; en cada día, primero los vivos (cumpleaños y aniversarios de boda) y después los fallecidos. Qué
// fechas cuentan y los textos, en comun/aniversarios.ts, lo mismo que el
// correo de aniversarios. De quién (Carlos, 11/11/2026): «Mi familia
// cercana» o «Todo el árbol», al abrir lo de Ajustes; cambiarlo aquí no se
// guarda. Sin persona vinculada, todo el árbol y sin selector.

import { useMemo, useState } from "react";
import { Anchor, Checkbox, Collapse, Group, SegmentedControl, Stack, Text, Title } from "@mantine/core";
import { usePreferencias } from "../acceso/preferencias";
import { useSesion } from "../acceso/sesion";
import { useArbol } from "../arbol/contexto";
import { textoFecha } from "../arbol/fechas";
import type { Familia, Persona } from "../arbol/tipos";
import { AvisoAjustes, EnlaceFamilia, EnlacePersona } from "../componentes/Enlaces";
import { QuienEntra, useFamiliaCercana } from "../componentes/FamiliaCercana";
import { Tarjeta } from "../componentes/Ficha";
import { t, type Clave } from "../i18n";
import {
  aniversarios, hoyEn, nombreTipoAniversario, porDia, sdnDia, soloDe, sumarDias, textoAniversario, TIPOS_ANIVERSARIO,
  type Aniversario, type DeQuien, type Dia, type TipoAniversario,
} from "../../../comun/aniversarios.ts";

const RANGOS = ["7", "30", "90", "365"] as const;
type Rango = (typeof RANGOS)[number];

/** El último día del rango: hoy y los N - 1 siguientes; con «1 año», hasta
 * la víspera del mismo día del año que viene. */
function hastaDe(hoy: Dia, rango: Rango): Dia {
  if (rango !== "365") return sumarDias(hoy, Number(rango) - 1);
  const [y, m, d] = hoy;
  // El 29 de febrero, el año que viene no existe: hasta el 28.
  return m === 2 && d === 29 ? [y + 1, 2, 28] : sumarDias([y + 1, m, d], -1);
}

/** Una fecha gregoriana con día, mes y año en el formato largo de las
 * fichas («3 de noviembre de 2026»). */
const fechaLarga = (d: Dia) => textoFecha({ modifier: 0, quality: 0, calendar: 0, dateval: [d[2], d[1], d[0], false], text: "", newyear: 0 }, "largo");

function Linea({ a, admin }: { a: Aniversario; admin: boolean }) {
  const arbol = useArbol();
  const persona = a.persona ? arbol.personas.get(a.persona) : undefined;
  const familia = a.familia ? arbol.familias.get(a.familia) : undefined;
  const objeto: Persona | Familia | undefined = persona ?? familia;
  return (
    <Text>
      <Text span fw={600} inherit>{nombreTipoAniversario(a, t)}</Text>
      {" · "}
      {persona ? <EnlacePersona persona={persona} /> : familia ? <EnlaceFamilia familia={familia} /> : null}
      {admin && objeto?.gramps_id ? <Text span c="dimmed"> [{objeto.gramps_id}]</Text> : null}
      {" — "}
      {textoAniversario(a, t)}
    </Text>
  );
}

export function Calendario() {
  const arbol = useArbol();
  const { vivas, aniversarios: suscripcion, aniversariosDe } = usePreferencias();
  const familia = useFamiliaCercana();
  const [deQuien, setDeQuien] = useState<DeQuien>(aniversariosDe);
  const [verQuien, setVerQuien] = useState(false);
  const admin = useSesion().invitacion.rol === "administrador";
  const [rango, setRango] = useState<Rango>("30");
  const [tipos, setTipos] = useState<TipoAniversario[]>(TIPOS_ANIVERSARIO);

  const hoy = useMemo(() => hoyEn(), []);
  const todos = useMemo(() => aniversarios(arbol, vivas, hoy, hastaDe(hoy, rango)), [arbol, vivas, hoy, rango]);
  const suyos = useMemo(() => (familia && deQuien === "familia" ? soloDe(todos, familia, arbol) : todos), [todos, familia, deQuien, arbol]);
  const dias = useMemo(() => porDia(suyos.filter((a) => tipos.includes(a.tipo))), [suyos, tipos]);

  const rotuloDia = (d: Dia) => {
    const dif = sdnDia(d) - sdnDia(hoy);
    const fecha = fechaLarga(d);
    return dif === 0 ? `${t("calendario.hoy")}, ${fecha}` : dif === 1 ? `${t("calendario.manana")}, ${fecha}` : fecha;
  };

  return (
    <Stack gap="md" maw={860}>
      <Title order={1}>{t("menu.calendario")}</Title>
      <Group gap="lg" align="flex-end">
        {familia && (
          <div>
            <Text size="sm" fw={600} mb={4} id="calendario-quien">{t("calendario.deQuien")}</Text>
            <SegmentedControl
              aria-labelledby="calendario-quien"
              value={deQuien}
              onChange={(v) => setDeQuien(v === "arbol" ? "arbol" : "familia")}
              data={[
                { value: "familia", label: t("aniversariosDe.familia") },
                { value: "arbol", label: t("aniversariosDe.arbol") },
              ]}
            />
          </div>
        )}
        <div>
          <Text size="sm" fw={600} mb={4} id="calendario-rango">{t("calendario.rango")}</Text>
          <SegmentedControl
            aria-labelledby="calendario-rango"
            value={rango}
            onChange={(v) => setRango(v as Rango)}
            data={RANGOS.map((r) => ({ value: r, label: t(`calendario.rango.${r}` as Clave) }))}
          />
        </div>
        <div role="group" aria-labelledby="calendario-filtros">
          <Text id="calendario-filtros" size="sm" fw={600} mb={4}>{t("calendario.filtros")}</Text>
          <Group gap="md">
            {TIPOS_ANIVERSARIO.map((x) => (
              <Checkbox
                key={x}
                label={t(`calendario.filtro.${x}` as Clave)}
                checked={tipos.includes(x)}
                onChange={(e) => {
                  const marcado = e.currentTarget.checked;
                  setTipos((ts) => (marcado ? TIPOS_ANIVERSARIO.filter((y) => y === x || ts.includes(y)) : ts.filter((y) => y !== x)));
                }}
              />
            ))}
          </Group>
        </div>
      </Group>
      <Text size="sm" c="dimmed">{t("calendario.ayuda")}</Text>
      {/* De quién son (11/11/2026): quién entra en la familia cercana, y dónde se elige. */}
      {familia ? (
        <div>
          {deQuien === "familia" && (
            <>
              <Anchor component="button" type="button" size="sm" onClick={() => setVerQuien((v) => !v)} aria-expanded={verQuien}>
                {t("calendario.quienEntra")}
              </Anchor>
              <Collapse in={verQuien}>
                <Stack mt={4} mb="xs"><QuienEntra cuantas={familia.size} /></Stack>
              </Collapse>
            </>
          )}
          <AvisoAjustes texto={t("calendario.deQuienAjustes")} seccion="aniversarios-de" />
        </div>
      ) : (
        <Text size="sm" c="dimmed">{t("calendario.sinPersona")}</Text>
      )}
      {/* Lo que hay en Ajustes sobre el correo (Carlos, 04/11/2026), o lo que tiene elegido. */}
      <AvisoAjustes texto={t(`calendario.correo.${suscripcion ?? "ninguno"}` as Clave)} seccion="aniversarios" />

      {dias.length === 0 && (
        <Text c="dimmed">{rango === "365" ? t("calendario.vacioAnio") : t("calendario.vacio", { n: Number(rango) })}</Text>
      )}
      {dias.map(({ fecha, aniversarios: lista }) => (
        <Tarjeta key={sdnDia(fecha)}>
          <Stack gap={6}>
            <Title order={2} size="h4">{rotuloDia(fecha)}</Title>
            {lista.map((a) => <Linea key={`${a.tipo}-${a.persona ?? a.familia}`} a={a} admin={admin} />)}
          </Stack>
        </Tarjeta>
      ))}
    </Stack>
  );
}
