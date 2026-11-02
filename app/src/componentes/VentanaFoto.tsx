// Ventana de una foto de la galería de un formulario (fase 3, paso 11 b):
// una foto nueva (mientras se prepara y se sube) o una que ya estaba, con su
// descripción y su fecha (de la foto: cambian en todas las fichas que la
// usan) y el recorte para esta ficha (de la referencia).

import { useEffect, useState } from "react";
import { Alert, Button, Center, Checkbox, Group, Image, Loader, Modal, Progress, Stack, Text, TextInput } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { completarFecha } from "../arbol/leerFecha";
import type { MediaRef, Multimedia } from "../arbol/tipos";
import { urlMultimedia } from "../firebase";
import { DateInput } from "../gramps-connect/formularios/DateInput";
import type { GrampsDate } from "../gramps-connect/gramps-date";
import { t } from "../i18n";
import { reintentarSubida, useSubida } from "../subidas";
import { RECT_INICIAL, Recorte, type Rect } from "./Recorte";

export interface FotoAbierta {
  media: Multimedia;
  ref: MediaRef;
  /** La subida, si es una foto nueva. */
  subida: string | null;
}

export function VentanaFoto({ abierta, alTerminar, alCerrar }: {
  abierta: FotoAbierta | null;
  alTerminar: (media: Multimedia, ref: MediaRef) => void;
  alCerrar: () => void;
}) {
  const movil = useMediaQuery("(max-width: 36em)") ?? false;
  return (
    <Modal opened={!!abierta} onClose={alCerrar} size="xl" fullScreen={movil} zIndex={300}
      title={abierta?.subida ? t("foto.nueva") : t("foto.editarTitulo")}>
      {abierta && <Contenido key={abierta.media.handle} inicial={abierta} alTerminar={alTerminar} alCerrar={alCerrar} />}
    </Modal>
  );
}

/** La copia pequeña de una foto que ya está en el árbol. */
function useUrlPequena(media: Multimedia, nueva: boolean): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (nueva) return;
    let vigente = true;
    urlMultimedia(media.handle, "pequena").then((u) => vigente && setUrl(u));
    return () => { vigente = false; };
  }, [media, nueva]);
  return url;
}

function Contenido({ inicial, alTerminar, alCerrar }: { inicial: FotoAbierta; alTerminar: (m: Multimedia, r: MediaRef) => void; alCerrar: () => void }) {
  const nueva = !!inicial.subida;
  const subida = useSubida(inicial.subida);
  const [media, setMedia] = useState(inicial.media);
  const [rect, setRect] = useState<Rect | null>((inicial.ref.rect as Rect | null) ?? null);
  const urlArbol = useUrlPequena(inicial.media, nueva);
  const url = nueva ? subida?.urlPequena : urlArbol;
  const noSirve = subida?.estado === "error" && subida.error !== "subida";

  return (
    <Stack>
      {nueva && subida && (
        subida.estado === "preparando" ? <Group gap="xs"><Loader size="xs" /><Text size="sm">{t("foto.preparando")}</Text></Group>
          : subida.estado === "subiendo" ? (
            <Stack gap={4}>
              <Text size="sm">{t("foto.subiendo", { n: Math.round(subida.progreso * 100) })}</Text>
              <Progress value={subida.progreso * 100} aria-label={t("foto.progreso")} />
            </Stack>
          )
            : subida.estado === "lista" ? <Text size="sm" c="dimmed">{t("foto.subida")}</Text>
              : (
                <Alert color="red" title={t(noSirve ? "foto.noSirve" : "foto.errorSubida")}>
                  {noSirve ? t("foto.noSirveAyuda") : (
                    <Button size="xs" variant="default" onClick={() => reintentarSubida(inicial.subida!)}>{t("foto.reintentar")}</Button>
                  )}
                </Alert>
              )
      )}
      {!noSirve && (url ? (
        <Center>
          {rect ? <Recorte url={url} rect={rect} alCambiar={setRect} rotulo={t("foto.recorte")} />
            : <Image src={url} alt="" mah="60dvh" maw="100%" fit="contain" />}
        </Center>
      ) : url === null ? <Text c="dimmed">{t("foto.noDisponible")}</Text> : <Center h={120}><Loader /></Center>)}
      {!noSirve && (
        <Checkbox
          label={t("foto.recortar")}
          description={t("foto.recortarAyuda")}
          checked={!!rect}
          onChange={(e) => setRect(e.currentTarget.checked ? RECT_INICIAL : null)}
        />
      )}
      {!noSirve && (
        <>
          <TextInput label={t("col.descripcion")} description={t("foto.descripcionAyuda")} value={media.desc}
            onChange={(e) => { const desc = e.currentTarget.value; setMedia((m) => ({ ...m, desc })); }} data-autofocus={nueva || undefined} />
          <DateInput label={t("col.fecha")} value={completarFecha(media.date as GrampsDate)} onChange={(date) => setMedia((m) => ({ ...m, date }))} />
          {!nueva && <Text size="sm" c="dimmed">{t("foto.compartida")}</Text>}
        </>
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={alCerrar}>{t("formulario.cancelar")}</Button>
        <Button disabled={noSirve} onClick={() => { alTerminar({ ...media, desc: media.desc.trim() }, { ...inicial.ref, rect }); alCerrar(); }}>
          {t("formulario.hecho")}
        </Button>
      </Group>
    </Stack>
  );
}
