// Editor de fechas al estilo de Gramps, adaptado de Gramps Connect
// (app/src/components/DateInput.tsx; origen y cambios en ../ORIGEN.md).
//
// Procede de Gramps Connect (https://github.com/dsblank/gramps-connect,
// app/src/components/DateInput.tsx, commit 9487314), AGPL-3.0-or-later.
// MODIFICADO el 25/10/2026 para esta web (los cambios, abajo).
//
// Como en Gramps de escritorio: un campo de texto rápido, siempre a la
// vista, y un diálogo con la fecha desglosada (tipo, calidad, día, mes y
// año, segunda fecha para «entre» y «de… a…», y texto).
//
// Cambios respecto a Gramps Connect:
// - el campo muestra la fecha en el formato de la web (textoFecha, «3 de
//   mayo de 1950») y la lee con leerFecha, que acepta además el numérico
//   de la región y el de Gramps (decisión del 24/10/2026, «Formularios
//   (inventario)»); si el texto no ha cambiado, no se vuelve a leer, para no
//   tocar una fecha que no se ha editado;
// - el calendario no se elige (los calendarios están descartados): se
//   conserva el de la fecha y, si no es el gregoriano, se dice cuál es;
// - las fechas dobles (1745/6) se conservan y se muestran, pero no se
//   ofrecen para crear: el interruptor solo aparece si la fecha ya lo es, y
//   escribir una fecha doble nueva da un aviso (misma decisión). El año
//   nuevo distinto del 1 de enero se conserva sin mostrarse;
// - sin calendarios lunares ni nada que pregunte al servidor;
// - textos por t(), colores del tema, iconos propios; en el móvil, el
//   diálogo a pantalla completa.

import { useEffect, useRef, useState } from "react";
import { ActionIcon, Button, Group, Modal, NumberInput, Select, Stack, Switch, Text, TextInput, Tooltip } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  Calendar, EMPTY_DATE_PART, Modifier, Quality, getStartDate, getStopDate, isCompound, makeDate, validateDate,
  type DatePart, type GrampsDate,
} from "../gramps-date";
import { textoFecha } from "../../arbol/fechas";
import { completarFecha, fechaVacia, leerFecha } from "../../arbol/leerFecha";
import { IconoCalendario, IconoDetalle } from "../../componentes/Iconos";
import { t, type Clave } from "../../i18n";

interface DateInputProps {
  label: string;
  value: GrampsDate;
  onChange: (date: GrampsDate) => void;
}

const MODIFICADORES: [Modifier, Clave][] = [
  [Modifier.NONE, "fecha.modNormal"],
  [Modifier.BEFORE, "fecha.modAntes"],
  [Modifier.AFTER, "fecha.modDespues"],
  [Modifier.ABOUT, "fecha.modHacia"],
  [Modifier.RANGE, "fecha.modEntre"],
  [Modifier.SPAN, "fecha.modPeriodo"],
  [Modifier.FROM, "fecha.modDesde"],
  [Modifier.TO, "fecha.modHasta"],
  [Modifier.TEXTONLY, "fecha.modTexto"],
];

const CALIDADES: [Quality, Clave][] = [
  [Quality.NONE, "fecha.calNormal"],
  [Quality.ESTIMATED, "fecha.calEstimada"],
  [Quality.CALCULATED, "fecha.calCalculada"],
];

const CALENDARIOS: Partial<Record<Calendar, Clave>> = {
  [Calendar.JULIAN]: "fecha.calendarioJuliano",
  [Calendar.HEBREW]: "fecha.calendarioHebreo",
  [Calendar.FRENCH]: "fecha.calendarioFrances",
  [Calendar.PERSIAN]: "fecha.calendarioPersa",
  [Calendar.ISLAMIC]: "fecha.calendarioIslamico",
  [Calendar.SWEDISH]: "fecha.calendarioSueco",
};

const opciones = <T extends number>(l: [T, Clave][]) => l.map(([v, c]) => ({ value: String(v), label: t(c) }));

function parteVacia(part: DatePart): boolean {
  return part[0] === 0 && part[1] === 0 && part[2] === 0;
}

/** `<input type="date">` solo entiende fechas gregorianas completas (día,
 * mes y año positivos); para lo demás se queda en blanco y se usan los
 * campos numéricos. */
function aValorNativo(part: DatePart): string {
  const [day, month, year] = part;
  if (!day || !month || year <= 0) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function deValorNativo(v: string, slash: boolean): DatePart {
  const [y, m, d] = v.split("-").map(Number);
  return [d || 0, m || 0, y || 0, slash];
}

/** El botón del calendario y un `<input type="date">` oculto que abre el
 * selector de fecha del navegador. */
function BotonSelectorNativo({ part, onChange, calendar }: { part: DatePart; onChange: (part: DatePart) => void; calendar: Calendar }) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const enabled = calendar === Calendar.GREGORIAN;
  const nombre = CALENDARIOS[calendar];
  const rotulo = enabled ? t("fecha.elegirEnCalendario") : t("fecha.soloGregoriano", { calendario: nombre ? t(nombre) : "" });
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <Tooltip label={rotulo}>
        <ActionIcon variant="default" size="lg" disabled={!enabled} onClick={() => pickerRef.current?.showPicker()} aria-label={rotulo}>
          <IconoCalendario />
        </ActionIcon>
      </Tooltip>
      {/* Oculto con opacidad, no con display:none: Chrome y Firefox no
       * abren el selector de un campo con display:none. Del tamaño del
       * botón, para que el selector salga junto a él. */}
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={aValorNativo(part)}
        onChange={(e) => onChange(deValorNativo(e.target.value, part[3]))}
        style={{ position: "absolute", inset: 0, opacity: 0, pointerEvents: "none", border: 0 }}
      />
    </span>
  );
}

function FilaFecha({ part, onChange, calendar, invalid }: { part: DatePart; onChange: (part: DatePart) => void; calendar: Calendar; invalid?: boolean }) {
  const [day, month, year, slash] = part;
  const fijar = (next: { day?: number; month?: number; year?: number }) => onChange([next.day ?? day, next.month ?? month, next.year ?? year, slash]);
  return (
    <Group gap="xs" wrap="nowrap" align="flex-end" style={{ flex: 1 }}>
      <Group grow gap="xs" style={{ flex: 1 }}>
        <NumberInput label={t("fecha.dia")} value={day || ""} onChange={(v) => fijar({ day: Number(v) || 0 })}
          hideControls allowDecimal={false} allowNegative={false} error={invalid} min={1} max={31} />
        <NumberInput label={t("fecha.mes")} value={month || ""} onChange={(v) => fijar({ month: Number(v) || 0 })}
          hideControls allowDecimal={false} allowNegative={false} error={invalid} min={1} max={12} />
        <NumberInput label={t("fecha.anio")} value={year || ""} onChange={(v) => fijar({ year: Number(v) || 0 })}
          hideControls allowDecimal={false} error={invalid} />
      </Group>
      <BotonSelectorNativo part={part} onChange={onChange} calendar={calendar} />
    </Group>
  );
}

export function DateInput({ label, value, onChange }: DateInputProps) {
  const movil = useMediaQuery("(max-width: 36em)") ?? false;
  const modifier = value.modifier;
  const quality = value.quality;
  const calendar = value.calendar;
  const text = value.text ?? "";
  const start = getStartDate(value);
  const stop = isCompound(value) ? getStopDate(value) : EMPTY_DATE_PART;
  const compound = modifier === Modifier.RANGE || modifier === Modifier.SPAN;
  const textOnly = modifier === Modifier.TEXTONLY;
  const doble = start[3];
  const validation = !textOnly && !parteVacia(start) ? validateDate(value) : null;
  const [detalle, setDetalle] = useState(false);

  function commit(next: { modifier?: Modifier; quality?: Quality; text?: string; start?: DatePart; stop?: DatePart }) {
    const m = next.modifier ?? modifier;
    const q = next.quality ?? quality;
    const tx = next.text ?? text;
    if (m === Modifier.TEXTONLY) {
      onChange(completarFecha(makeDate({ modifier: m, quality: q, text: tx }), value));
      return;
    }
    const comp = m === Modifier.RANGE || m === Modifier.SPAN;
    const ini = next.start ?? start;
    const fin = next.stop ?? stop;
    if (!tx && parteVacia(ini) && (!comp || parteVacia(fin))) {
      onChange(fechaVacia());
      return;
    }
    onChange(completarFecha(makeDate({ modifier: m, quality: q, calendar, newyear: value.newyear, text: tx, start: ini, stop: comp ? fin : undefined }), value));
  }

  const error = !validation || validation.valid
    ? null
    : validation.date1Invalid ? t("fecha.errorFecha")
      : validation.date2Empty ? t("fecha.errorFaltaFin")
        : validation.date2Invalid ? t("fecha.errorFin")
          : validation.date2OrderInvalid ? t("fecha.errorOrden")
            : null;
  const nombreCalendario = CALENDARIOS[calendar];

  return (
    <Stack gap={4}>
      <CampoRapido
        label={label}
        value={value}
        onChange={onChange}
        alElegir={(p) => commit({ start: p })}
        start={start}
        calendar={calendar}
        alDetalle={() => setDetalle(true)}
      />
      {error && <Text size="sm" c="red">{error}</Text>}

      <Modal opened={detalle} onClose={() => setDetalle(false)} title={label} size="lg" fullScreen={movil} zIndex={310}>
        <Stack gap="sm">
          <Group grow gap="xs" wrap={movil ? "wrap" : "nowrap"}>
            <Select label={t("fecha.tipo")} data={opciones(MODIFICADORES)} value={String(modifier)}
              onChange={(v) => commit({ modifier: Number(v ?? Modifier.NONE) as Modifier })} allowDeselect={false} comboboxProps={{ zIndex: 320 }} />
            <Select label={t("fecha.calidad")} data={opciones(CALIDADES)} value={String(quality)}
              onChange={(v) => commit({ quality: Number(v ?? Quality.NONE) as Quality })} allowDeselect={false} comboboxProps={{ zIndex: 320 }} />
          </Group>

          {!textOnly && (
            <Stack gap="xs">
              <FilaFecha part={start} onChange={(p) => commit({ start: p })} calendar={calendar} invalid={validation?.date1Invalid} />
              {compound && (
                <>
                  <Text size="sm">{modifier === Modifier.RANGE ? t("fecha.y") : t("fecha.a")}</Text>
                  <FilaFecha part={stop} onChange={(p) => commit({ stop: p })} calendar={calendar}
                    invalid={validation ? validation.date2Empty || validation.date2Invalid || validation.date2OrderInvalid : false} />
                </>
              )}
              {doble && (
                <Switch label={t("fecha.doble")} checked={doble}
                  onChange={(e) => commit({ start: [start[0], start[1], start[2], e.currentTarget.checked], stop: [stop[0], stop[1], stop[2], e.currentTarget.checked] })} />
              )}
              {nombreCalendario && <Text size="sm" c="dimmed">{t("fecha.calendarioConservado", { calendario: t(nombreCalendario) })}</Text>}
            </Stack>
          )}

          {/* Siempre a la vista, como en Gramps: es la fecha cuando el tipo
           * es «Solo texto» y un comentario junto a la fecha si no. */}
          <TextInput
            label={textOnly ? t("fecha.textoLibre") : t("fecha.comentario")}
            value={text}
            onChange={(e) => commit({ text: e.currentTarget.value })}
          />
          <Text size="sm" c="dimmed">{t("fecha.vistaPrevia")}: {textoFecha(value) || t("ficha.sinDatos")}</Text>

          <Group justify="flex-end">
            <Button onClick={() => setDetalle(false)}>{t("fecha.hecho")}</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

/** El campo rápido: un texto que empieza con la fecha en el formato de la
 * web y se vuelve a poner al día cuando la fecha cambia por otro lado (el
 * diálogo), pero no mientras se escribe en él. Se lee al salir del campo o
 * con Intro, como en Gramps. */
function CampoRapido({ label, value, onChange, alElegir, start, calendar, alDetalle }: {
  label: string;
  value: GrampsDate;
  onChange: (date: GrampsDate) => void;
  alElegir: (part: DatePart) => void;
  start: DatePart;
  calendar: Calendar;
  alDetalle: () => void;
}) {
  const [buffer, setBuffer] = useState(() => textoFecha(value));
  const [aviso, setAviso] = useState<string | null>(null);
  const enFoco = useRef(false);

  useEffect(() => {
    if (!enFoco.current) setBuffer(textoFecha(value));
  }, [value]);

  function leer() {
    setAviso(null);
    // Sin cambios en el texto: la fecha se queda como está.
    if (buffer.trim() === textoFecha(value)) return;
    const leida = leerFecha(buffer);
    if (!leida) {
      onChange(fechaVacia());
      return;
    }
    // Fechas dobles: solo se conservan las que ya había.
    if (getStartDate(leida)[3] && !getStartDate(value)[3]) {
      setAviso(t("fecha.dobleNoPermitida"));
      return;
    }
    onChange(leida);
    if (leida.modifier === Modifier.TEXTONLY) setAviso(t("fecha.comoTexto"));
  }

  return (
    <Stack gap={4}>
      <Group gap="xs" wrap="nowrap" align="flex-end">
        <TextInput
          style={{ flex: 1 }}
          label={label}
          description={t("fecha.ayuda")}
          value={buffer}
          onChange={(e) => setBuffer(e.currentTarget.value)}
          onFocus={() => { enFoco.current = true; }}
          onBlur={() => { enFoco.current = false; leer(); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
        />
        <BotonSelectorNativo part={start} onChange={alElegir} calendar={calendar} />
        <Tooltip label={t("fecha.detalle")}>
          <ActionIcon variant="default" size="lg" onClick={alDetalle} aria-label={t("fecha.detalle")}>
            <IconoDetalle />
          </ActionIcon>
        </Tooltip>
      </Group>
      {aviso && <Text size="sm" c="dimmed" role="status">{aviso}</Text>}
    </Stack>
  );
}
