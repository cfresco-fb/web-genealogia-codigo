// Nota de privacidad (decisión D7; texto aprobado por Carlos el 31/10/2026,
// docs/puesta-en-marcha.md). Se ve sin sesión (pantalla de entrar) y con
// ella (/privacidad, enlazada desde el menú de la cuenta). La frase del
// mapa, aprobada por Carlos el 02/11/2026 (docs/privacidad.md).

import type { ReactNode } from "react";
import { Anchor, Stack, Text } from "@mantine/core";
import { CORREO_CONTACTO, FECHA_PRIVACIDAD } from "../configuracion";
import { idioma, t, type Clave } from "../i18n";

function Parrafo({ titulo, children }: { titulo: Clave; children: ReactNode }) {
  return (
    <Text>
      <Text span fw={600} inherit>{t(titulo)}</Text> {children}
    </Text>
  );
}

export function NotaPrivacidad() {
  const [a, m, d] = FECHA_PRIVACIDAD.split("-").map(Number);
  const fecha = new Intl.DateTimeFormat(idioma().intl, { dateStyle: "long" }).format(new Date(a, m - 1, d));
  return (
    <Stack gap="md">
      <Parrafo titulo="privacidad.datos.titulo">{t("privacidad.datos.texto")}</Parrafo>
      <Parrafo titulo="privacidad.quien.titulo">
        {t("privacidad.quien.texto")} {t("privacidad.recaptcha")} (
        <Anchor href={`https://policies.google.com/privacy?hl=${idioma().codigo}`} target="_blank" rel="noopener noreferrer">
          {t("privacidad.politicaGoogle")}
        </Anchor>). {t("privacidad.mapa")} {t("privacidad.nominatim")} (
        <Anchor href="https://osmfoundation.org/wiki/Privacy_Policy" target="_blank" rel="noopener noreferrer">
          {t("privacidad.politicaOsm")}
        </Anchor>).
      </Parrafo>
      <Parrafo titulo="privacidad.donde.titulo">{t("privacidad.donde.texto")}</Parrafo>
      <Parrafo titulo="privacidad.cambiar.titulo">
        {t("privacidad.cambiar.antes")} <Anchor href={`mailto:${CORREO_CONTACTO}`}>{CORREO_CONTACTO}</Anchor>{" "}
        {t("privacidad.cambiar.despues")}
      </Parrafo>
      <Text size="sm" c="dimmed">{t("privacidad.revision", { fecha })}</Text>
    </Stack>
  );
}
