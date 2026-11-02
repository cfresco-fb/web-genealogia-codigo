// Página de la nota de privacidad dentro de la web (/privacidad), enlazada
// desde el menú de la cuenta. Sin sesión, la misma nota sale en las
// pantallas de acceso.

import { Stack, Title } from "@mantine/core";
import { Tarjeta } from "../componentes/Ficha";
import { NotaPrivacidad } from "../componentes/NotaPrivacidad";
import { t } from "../i18n";

export function Privacidad() {
  return (
    <Stack gap="lg" maw={760}>
      <Title order={1}>{t("privacidad.titulo")}</Title>
      <Tarjeta>
        <NotaPrivacidad />
      </Tarjeta>
    </Stack>
  );
}
