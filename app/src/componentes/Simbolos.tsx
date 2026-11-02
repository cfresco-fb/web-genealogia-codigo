// Sección de Ajustes para elegir los símbolos de nacimiento y defunción:
// los propios y, para el administrador, el valor por defecto del árbol.

import { useState } from "react";
import { Alert, Button, Group, Radio, Stack, Text, TextInput } from "@mantine/core";
import { usePreferencias } from "../acceso/preferencias";
import { useSesion } from "../acceso/sesion";
import {
  JUEGOS_SIMBOLOS, MAX_SIMBOLO, simbolosDe, validarPreferencia, type JuegoSimbolos, type PreferenciaSimbolos,
} from "../arbol/simbolos";
import { t, type Clave } from "../i18n";

/** «n. 1850 · f. 1920», con los símbolos de la preferencia. */
function ejemplo(p: PreferenciaSimbolos): string {
  const s = simbolosDe(p);
  return t("simbolos.ejemplo", { n: s.nacimiento, f: s.defuncion });
}

const DEL_ARBOL = "arbol";

/** Elección de un juego (y de los símbolos, si es personalizado), con su
 * botón de guardar. Con `delArbol`, ofrece además «usar los del árbol». */
function Eleccion({ inicial, delArbol, alGuardar }: {
  inicial: PreferenciaSimbolos | null;
  delArbol?: PreferenciaSimbolos;
  alGuardar: (p: PreferenciaSimbolos | null) => Promise<void>;
}) {
  const [juego, setJuego] = useState<string>(inicial?.juego ?? (delArbol ? DEL_ARBOL : "abreviaturas"));
  const [nacimiento, setNacimiento] = useState(inicial?.nacimiento ?? "");
  const [defuncion, setDefuncion] = useState(inicial?.defuncion ?? "");
  const [estado, setEstado] = useState<"" | "guardando" | "guardado" | "error">("");

  const eleccion = juego === DEL_ARBOL ? null : validarPreferencia({ juego, nacimiento, defuncion });
  const invalida = juego !== DEL_ARBOL && !eleccion;

  async function guardar() {
    setEstado("guardando");
    try {
      await alGuardar(eleccion);
      setEstado("guardado");
    } catch (e) {
      console.error(e);
      setEstado("error");
    }
  }

  return (
    <Stack gap="xs">
      <Radio.Group value={juego} onChange={(v) => { setJuego(v); setEstado(""); }}>
        <Stack gap={6}>
          {delArbol && <Radio value={DEL_ARBOL} label={t("simbolos.usarDelArbol", { ejemplo: ejemplo(delArbol) })} />}
          {JUEGOS_SIMBOLOS.map((j: JuegoSimbolos) => (
            <Radio
              key={j}
              value={j}
              label={j === "personalizado"
                ? t("simbolos.juego.personalizado")
                : `${t(`simbolos.juego.${j}` as Clave)}: ${ejemplo({ juego: j })}`}
            />
          ))}
        </Stack>
      </Radio.Group>
      {juego === "personalizado" && (
        <Group gap="sm" pl={28} align="flex-start">
          <TextInput
            label={t("col.nacimiento")}
            value={nacimiento}
            maxLength={MAX_SIMBOLO}
            w={130}
            onChange={(e) => { setNacimiento(e.currentTarget.value); setEstado(""); }}
          />
          <TextInput
            label={t("col.defuncion")}
            value={defuncion}
            maxLength={MAX_SIMBOLO}
            w={130}
            onChange={(e) => { setDefuncion(e.currentTarget.value); setEstado(""); }}
          />
        </Group>
      )}
      {juego === "personalizado" && (
        <Text size="sm" c={invalida ? "red" : "dimmed"} pl={28}>
          {invalida ? t("simbolos.invalido", { max: MAX_SIMBOLO }) : ejemplo(eleccion!)}
        </Text>
      )}
      <Group gap="sm">
        <Button size="sm" onClick={guardar} disabled={invalida} loading={estado === "guardando"}>{t("simbolos.guardar")}</Button>
        {estado === "guardado" && <Text size="sm" c="green">{t("simbolos.guardado")}</Text>}
      </Group>
      {estado === "error" && <Alert color="red"><Text size="sm">{t("simbolos.error")}</Text></Alert>}
    </Stack>
  );
}

export function SeccionSimbolos() {
  const { propia, delArbol, guardarPropia, guardarDelArbol } = usePreferencias();
  const { invitacion } = useSesion();
  return (
    <Stack>
      <Text size="sm">{t("simbolos.explicacion")}</Text>
      <Text fw={600}>{t("simbolos.tuyos")}</Text>
      <Eleccion inicial={propia} delArbol={delArbol} alGuardar={guardarPropia} />
      {invitacion.rol === "administrador" && (
        <>
          <Text fw={600} mt="sm">{t("simbolos.delArbol")}</Text>
          <Text size="sm" c="dimmed">{t("simbolos.delArbolAyuda")}</Text>
          <Eleccion inicial={delArbol} alGuardar={(p) => guardarDelArbol(p!)} />
        </>
      )}
    </Stack>
  );
}
