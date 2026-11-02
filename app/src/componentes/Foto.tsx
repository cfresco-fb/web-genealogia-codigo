// Fotos servidas desde Storage (multimedia/{handle}) y visor ampliado con
// la lista de personas, familias y eventos en los que aparece la foto.

import { useEffect, useState } from "react";
import { Anchor, Box, Center, Image, Loader, Modal, Stack, Text } from "@mantine/core";
import { Link } from "react-router";
import { descripcionFoto } from "../arbol/arbol";
import { useArbol } from "../arbol/contexto";
import type { Evento, Familia, Multimedia, Persona } from "../arbol/tipos";
import { urlMultimedia } from "../firebase";
import { nombreTipo, t } from "../i18n";
import { textoFecha } from "../arbol/fechas";
import { rutaFamilia, rutaPersona } from "./Enlaces";
import { color } from "../tema/colores";

/** La copia pequeña (las miniaturas) o la grande (el visor). */
function useUrl(media: Multimedia, copia: "pequena" | "grande"): string | null | undefined {
  // undefined: cargando; null: no disponible.
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let vigente = true;
    setUrl(undefined);
    urlMultimedia(media.handle, copia).then((u) => vigente && setUrl(u));
    return () => {
      vigente = false;
    };
  }, [media.handle, copia]);
  return url;
}

interface FotoProps {
  media: Multimedia;
  /** Lado del recuadro en píxeles. */
  tam: number;
  alPulsar?: () => void;
}

/** Miniatura cuadrada (la imagen entera, sin recortar). */
export function Foto({ media, tam, alPulsar }: FotoProps) {
  const url = useUrl(media, "pequena");
  return (
    <Box
      w={tam}
      h={tam}
      onClick={alPulsar}
      style={{ cursor: alPulsar ? "pointer" : undefined, flexShrink: 0, borderRadius: "var(--mantine-radius-sm)", overflow: "hidden" }}
      bg={color("superficie-hundida")}
      title={descripcionFoto(media) || undefined}
    >
      {url === undefined ? (
        <Center h="100%"><Loader size="sm" /></Center>
      ) : url === null ? (
        <Center h="100%" p={4}><Text size="xs" c="dimmed" ta="center">{t("foto.noDisponible")}</Text></Center>
      ) : (
        <Image src={url} alt={descripcionFoto(media)} w={tam} h={tam} fit="contain" />
      )}
    </Box>
  );
}

/** Visor a pantalla casi completa. Cerrado si media es null. */
export function VisorFoto({ media, alCerrar }: { media: Multimedia | null; alCerrar: () => void }) {
  return (
    <Modal opened={!!media} onClose={alCerrar} size="auto" title={media ? descripcionFoto(media) : undefined} closeButtonProps={{ "aria-label": t("foto.cerrar") }}>
      {media && <ContenidoVisor media={media} />}
    </Modal>
  );
}

function ContenidoVisor({ media }: { media: Multimedia }) {
  const arbol = useArbol();
  const url = useUrl(media, "grande");
  const referentes = arbol.referentes(media.handle);
  return (
    <Stack>
      {url === undefined && <Center h={200}><Loader /></Center>}
      {url === null && <Text c="dimmed">{t("foto.noDisponible")}</Text>}
      {url && <Image src={url} alt={descripcionFoto(media)} mah="75dvh" maw="min(90vw, 1200px)" fit="contain" />}
      {textoFecha(media.date) && <Text size="sm">{textoFecha(media.date)}</Text>}
      {referentes.length > 0 && (
        <div>
          <Text fw={600} size="sm">{t("foto.apareceEn")}</Text>
          {referentes.map(({ tipo, objeto }) => (
            <div key={objeto.handle}>
              {tipo === "Person" && <Anchor component={Link} to={rutaPersona(objeto.handle)}>{arbol.nombre(objeto as Persona)}</Anchor>}
              {tipo === "Family" && <Anchor component={Link} to={rutaFamilia(objeto.handle)}>{arbol.nombreFamilia(objeto as Familia)}</Anchor>}
              {tipo === "Event" && <Text size="sm">{nombreTipo((objeto as Evento).type)} {textoFecha((objeto as Evento).date)}</Text>}
            </div>
          ))}
        </div>
      )}
    </Stack>
  );
}
