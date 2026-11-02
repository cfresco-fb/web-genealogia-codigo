// Búsqueda de texto completo en todo el árbol, con ámbito elegible. La
// consulta y el ámbito van en la dirección (?q=…&en=Person,Place), para
// poder volver atrás o compartir el enlace.

import { useDeferredValue, useMemo, useState } from "react";
import { Anchor, Button, Chip, Group, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { Link, useSearchParams } from "react-router";
import { descripcionFoto, TIPOS_OBJETO, type TipoObjeto } from "../arbol/arbol";
import { useSesion } from "../acceso/sesion";
import { useArbol } from "../arbol/contexto";
import { textoFecha } from "../arbol/fechas";
import type { Base, Evento, Familia, Lugar, Multimedia, Nota, Persona } from "../arbol/tipos";
import { EnlaceFamilia, EnlacePersona, rutaFamilia, rutaPersona } from "../componentes/Enlaces";
import { Foto, VisorFoto } from "../componentes/Foto";
import { nombreTipo, t, type Clave } from "../i18n";

const LIMITE = 50;

const NOMBRE_AMBITO: Record<TipoObjeto, Clave> = {
  Person: "menu.personas", Family: "menu.familias", Event: "menu.eventos",
  Place: "menu.lugares", Media: "menu.multimedia", Note: "buscar.notas",
};

export function Buscar() {
  const arbol = useArbol();
  const [params, setParams] = useSearchParams();
  const consulta = params.get("q") ?? "";
  const diferida = useDeferredValue(consulta);
  const ambitos = (params.get("en")?.split(",").filter((a): a is TipoObjeto => TIPOS_OBJETO.includes(a as TipoObjeto))) ?? [];
  const efectivos = ambitos.length ? ambitos : TIPOS_OBJETO;
  const [abierta, setAbierta] = useState<Multimedia | null>(null);

  const admin = useSesion().invitacion.rol === "administrador";
  const resultados = useMemo(() => arbol.buscar(diferida, efectivos, LIMITE, admin), [arbol, diferida, efectivos.join(), admin]);
  const total = [...resultados.values()].reduce((s, r) => s + r.total, 0);

  function cambiar(q: string, en: string[]) {
    const nuevos = new URLSearchParams();
    if (q) nuevos.set("q", q);
    if (en.length && en.length < TIPOS_OBJETO.length) nuevos.set("en", en.join(","));
    setParams(nuevos, { replace: true });
  }

  return (
    <Stack gap="md" maw={1000}>
      <Title order={1}>{t("buscar.titulo")}</Title>
      <TextInput
        placeholder={t("buscar.placeholder")}
        value={consulta}
        onChange={(e) => cambiar(e.currentTarget.value, ambitos)}
        size="md"
        autoFocus
        aria-label={t("buscar.titulo")}
      />
      <Group gap="xs" align="center">
        <Text size="sm" fw={600}>{t("buscar.ambito")}:</Text>
        <Chip.Group multiple value={ambitos} onChange={(en) => cambiar(consulta, en)}>
          {TIPOS_OBJETO.map((tipo) => <Chip key={tipo} value={tipo} size="sm">{t(NOMBRE_AMBITO[tipo])}</Chip>)}
        </Chip.Group>
        {ambitos.length > 0 && <Button size="compact-sm" variant="subtle" onClick={() => cambiar(consulta, [])}>{t("buscar.todo")}</Button>}
      </Group>
      <Text size="xs" c="dimmed">{t("buscar.ayuda")}</Text>

      {diferida.trim() && (total === 0
        ? <Text>{t("buscar.sinResultados")}</Text>
        : <Text c="dimmed" size="sm">{t("buscar.resultados", { n: total })}</Text>)}

      {[...resultados].map(([tipo, { total: n, objetos }]) => (
        <Stack key={tipo} gap={6}>
          <Title order={2}>{t(NOMBRE_AMBITO[tipo])} ({n})</Title>
          {objetos.map((o) => <Resultado key={o.handle} tipo={tipo} objeto={o} admin={admin} alAbrirFoto={setAbierta} />)}
          {n > objetos.length && <Text size="xs" c="dimmed">{t("buscar.limite", { n: LIMITE })}</Text>}
        </Stack>
      ))}
      <VisorFoto media={abierta} alCerrar={() => setAbierta(null)} />
    </Stack>
  );
}

// El ID de Gramps, solo para el administrador, entre corchetes y en gris al
// final del rótulo de cada resultado (como en los formularios y el libro).
function Id({ objeto, admin }: { objeto: Base; admin: boolean }) {
  return admin && objeto.gramps_id ? <Text span c="dimmed"> [{objeto.gramps_id}]</Text> : null;
}

function Resultado({ tipo, objeto, admin, alAbrirFoto }: { tipo: TipoObjeto; objeto: Base; admin: boolean; alAbrirFoto: (m: Multimedia) => void }) {
  const arbol = useArbol();
  const id = <Id objeto={objeto} admin={admin} />;
  switch (tipo) {
    case "Person":
      return <Text><EnlacePersona persona={objeto as Persona} anios />{id}</Text>;
    case "Family":
      return <Text><EnlaceFamilia familia={objeto as Familia} />{id}</Text>;
    case "Event": {
      const e = objeto as Evento;
      const participantes = arbol.participantes(e);
      return (
        <Text size="sm">
          <Text span fw={600}>{nombreTipo(e.type)}</Text>{id}
          {" "}{[textoFecha(e.date), arbol.tituloLugar(e.place), e.description].filter(Boolean).join(" · ")}
          {participantes.map(({ tipo: tp, objeto: o }) => (
            <span key={o.handle}> — {tp === "Person" ? <EnlacePersona persona={o as Persona} /> : <EnlaceFamilia familia={o as Familia} />}</span>
          ))}
        </Text>
      );
    }
    case "Place": {
      const l = objeto as Lugar;
      return <Text size="sm">{arbol.tituloLugar(l.handle)} <Text span c="dimmed">({nombreTipo(l.place_type)})</Text>{id}</Text>;
    }
    case "Media": {
      const m = objeto as Multimedia;
      return (
        <Group gap="sm" wrap="nowrap">
          {arbol.esImagen(m) && <Foto media={m} tam={56} alPulsar={() => alAbrirFoto(m)} />}
          <Text size="sm">{descripcionFoto(m)}{id}</Text>
        </Group>
      );
    }
    case "Note": {
      const n = objeto as Nota;
      const de = arbol.referentes(n.handle).find((r) => r.tipo === "Person" || r.tipo === "Family");
      return (
        <Paper withBorder p="xs">
          {(de || admin) && (
            <Text size="sm">
              {de && (
                <Anchor component={Link} size="sm" to={de.tipo === "Person" ? rutaPersona(de.objeto.handle) : rutaFamilia(de.objeto.handle)}>
                  {t("buscar.notaDe", { nombre: de.tipo === "Person" ? arbol.nombre(de.objeto as Persona) : arbol.nombreFamilia(de.objeto as Familia) })}
                </Anchor>
              )}
              {id}
            </Text>
          )}
          <Text size="sm" lineClamp={3} style={{ whiteSpace: "pre-wrap" }}>{n.text.string}</Text>
        </Paper>
      );
    }
  }
}
