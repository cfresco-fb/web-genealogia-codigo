// La «i» con bocadillo del diálogo del PDF del árbol (Carlos, 12/11/2026,
// «Cajas completas y ayuda del PDF»): junto a la disposición, la
// orientación, las cajas, cada forma de reparto, la letra mínima en una sola
// página e «Incluir identificadores». El bocadillo se abre al pasar el ratón,
// al tocar en el móvil y con el teclado, como las explicaciones de la barra
// del árbol, y lleva una o dos frases y un dibujo esquemático: cajas sin
// texto, con rayas en lugar de letras, y sus líneas, con los colores del tema
// (se ven bien en los dos modos). Nunca capturas del árbol. Los dibujos son
// decorativos: la frase lo dice todo.

import type { ReactNode } from "react";
import { ActionIcon, Stack, Text, Tooltip } from "@mantine/core";
import { t, type Clave } from "../i18n";
import { color } from "../tema/colores";

export type QueAyuda = "disposicion" | "orientacion" | "cajas" | "continuacion" | "mosaico" | "unaPagina" | "letra" | "ids";

/** La «i»: un botón con su etiqueta («Qué es la disposición»…) y el
 * bocadillo con la frase y el dibujo. */
export function AyudaPdf({ que }: { que: QueAyuda }) {
  return (
    <Tooltip
      label={(
        <Stack gap={8}>
          <Text size="sm">{t(`pdf.info.${que}` as Clave)}</Text>
          <div aria-hidden style={{ display: "flex", justifyContent: "center" }}>{DIBUJOS[que]()}</div>
        </Stack>
      )}
      multiline
      w={300}
      withArrow
      position="top"
      openDelay={150}
      events={{ hover: true, focus: true, touch: true }}
      zIndex={1000}
      styles={{
        tooltip: {
          background: color("superficie"), color: color("tinta"), border: `1px solid ${color("linea-fuerte")}`,
          boxShadow: "var(--tema-sombra)", padding: "10px 12px",
        },
        arrow: { background: color("superficie"), border: `1px solid ${color("linea-fuerte")}` },
      }}
    >
      <ActionIcon
        variant="subtle"
        size="sm"
        radius="xl"
        aria-label={t(`pdf.info.${que}.etiqueta` as Clave)}
        // Dentro de una etiqueta, que pulsarla no cambie la opción.
        onClick={(e) => e.preventDefault()}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="8" cy="4.6" r="1" fill="currentColor" />
          <path d="M8 7v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </ActionIcon>
    </Tooltip>
  );
}

/** Un texto con su «i» detrás, en la misma línea. */
export function ConAyuda({ children, que }: { children: ReactNode; que: QueAyuda }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {children}
      <AyudaPdf que={que} />
    </span>
  );
}

// ---- Dibujos ----

const LINEA = color("linea-fuerte");
const CAJA = color("superficie");
const RAYA = color("tinta-suave");
const FONDO = color("superficie-hundida");
const MARCA = color("teja");

/** Una caja de persona: rectángulo redondeado con `rayas` (anchos de 0 a 1)
 * en lugar de letras; con `foto`, un cuadro arriba. */
function Caja({ x, y, w, h, rayas = [0.8, 0.6], foto = false, corte = false }: {
  x: number; y: number; w: number; h: number; rayas?: number[]; foto?: boolean; corte?: boolean;
}) {
  const top = foto ? y + 4 + w * 0.32 + 3 : y + 5;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={3} fill={CAJA} stroke={LINEA} />
      {foto && <rect x={x + w * 0.34} y={y + 4} width={w * 0.32} height={w * 0.32} rx={2} fill={FONDO} stroke={LINEA} strokeWidth={0.6} />}
      {rayas.map((r, i) => (
        <line key={i} x1={x + (w * (1 - r)) / 2} x2={x + (w * (1 + r)) / 2} y1={top + i * 4} y2={top + i * 4} stroke={RAYA} strokeWidth={i < 2 ? 1.6 : 1} strokeLinecap="round" />
      ))}
      {corte && <text x={x + w - 4} y={top + (rayas.length - 1) * 4 + 1.5} fontSize={6} fill={RAYA} textAnchor="end">…</text>}
    </g>
  );
}

/** Línea entre dos puntos, en curva suave por el eje de las generaciones. */
function Union({ a, b, horizontal = false }: { a: [number, number]; b: [number, number]; horizontal?: boolean }) {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const d = horizontal
    ? `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`
    : `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`;
  return <path d={d} fill="none" stroke={LINEA} strokeWidth={1} />;
}

function Rotulo({ x, y, children }: { x: number; y: number; children: string }) {
  return <text x={x} y={y} fontSize={9} fill={color("tinta")} textAnchor="middle">{children}</text>;
}

/** Un árbol pequeño en vertical (abuelos, padres, persona) o en horizontal,
 * con la persona central en (cx, cy). */
function ArbolMini({ cx, cy, horizontal = false, w = 16, h = 10 }: { cx: number; cy: number; horizontal?: boolean; w?: number; h?: number }) {
  const cajas: [number, number][] = horizontal
    ? [[cx, cy], [cx - 26, cy - 9], [cx - 26, cy + 9], [cx + 26, cy - 9], [cx + 26, cy + 9]]
    : [[cx, cy], [cx - 11, cy - 17], [cx + 11, cy - 17], [cx - 11, cy + 17], [cx + 11, cy + 17]];
  return (
    <g>
      {cajas.slice(1).map(([x, y], i) => (
        <Union key={i} horizontal={horizontal} a={horizontal ? [x + (x < cx ? w / 2 : -w / 2), y] : [x, y + (y < cy ? h / 2 : -h / 2)]}
          b={horizontal ? [cx + (x < cx ? -w / 2 : w / 2), cy] : [cx, cy + (y < cy ? -h / 2 : h / 2)]} />
      ))}
      {cajas.map(([x, y], i) => <Caja key={i} x={x - w / 2} y={y - h / 2} w={w} h={h} rayas={[0.6]} />)}
    </g>
  );
}

function Pagina({ x, y, w, h, children, discontinua = false }: { x: number; y: number; w: number; h: number; children?: ReactNode; discontinua?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={color("papel")} stroke={LINEA} strokeDasharray={discontinua ? "3 2" : undefined} />
      {children}
    </g>
  );
}

const Svg = ({ w, h, children }: { w: number; h: number; children: ReactNode }) => (
  <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="presentation" style={{ display: "block", maxWidth: "100%" }}>{children}</svg>
);

const DIBUJOS: Record<QueAyuda, () => ReactNode> = {
  disposicion: () => (
    <Svg w={240} h={84}>
      <ArbolMini cx={60} cy={38} />
      <Rotulo x={60} y={80}>{t("pdf.disposicionCorta.vertical")}</Rotulo>
      <ArbolMini cx={180} cy={38} horizontal />
      <Rotulo x={180} y={80}>{t("pdf.disposicionCorta.horizontal")}</Rotulo>
    </Svg>
  ),
  orientacion: () => (
    <Svg w={240} h={92}>
      <Pagina x={34} y={6} w={52} h={70}><ArbolMini cx={60} cy={41} /></Pagina>
      <Rotulo x={60} y={88}>{t("pdf.orientacion.portrait")}</Rotulo>
      <Pagina x={134} y={14} w={86} h={56}><ArbolMini cx={177} cy={42} horizontal /></Pagina>
      <Rotulo x={177} y={88}>{t("pdf.orientacion.landscape")}</Rotulo>
    </Svg>
  ),
  cajas: () => (
    <Svg w={260} h={104}>
      <Caja x={12} y={14} w={62} h={50} foto rayas={[0.8, 0.6, 0.85, 0.7]} corte />
      <Rotulo x={43} y={98}>{t("pdf.cajas.normales")}</Rotulo>
      <Caja x={104} y={22} w={44} h={30} rayas={[0.8, 0.6, 0.5, 0.5]} />
      <Rotulo x={126} y={98}>{t("pdf.cajas.pequenas")}</Rotulo>
      <Caja x={180} y={4} w={62} h={80} foto rayas={[0.8, 0.7, 0.6, 0.85, 0.75, 0.5, 0.85, 0.6, 0.4]} />
      <Rotulo x={211} y={98}>{t("pdf.cajas.completas")}</Rotulo>
    </Svg>
  ),
  continuacion: () => (
    <Svg w={240} h={96}>
      <Pagina x={20} y={6} w={64} h={84}>
        <ArbolMini cx={52} cy={52} />
        <rect x={34} y={20} width={36} height={4} rx={2} fill={MARCA} opacity={0.8} />
      </Pagina>
      <path d="M90,22 C120,6 130,6 152,20" fill="none" stroke={MARCA} strokeWidth={1.6} />
      <path d="M146,14 L153,21 L144,23" fill="none" stroke={MARCA} strokeWidth={1.6} strokeLinejoin="round" />
      <Pagina x={156} y={6} w={64} h={84}>
        <ArbolMini cx={188} cy={52} />
      </Pagina>
    </Svg>
  ),
  mosaico: () => (
    <Svg w={240} h={100}>
      {[0, 1, 2].flatMap((c) => [0, 1].map((f) => <Pagina key={`${c}${f}`} x={30 + c * 60} y={6 + f * 44} w={60} h={44} discontinua />))}
      <ArbolMini cx={120} cy={50} w={22} h={14} />
      <Union a={[120, 43]} b={[60, 22]} />
      <Union a={[120, 57]} b={[180, 78]} />
      <Caja x={48} y={14} w={24} h={14} rayas={[0.6]} />
      <Caja x={168} y={72} w={24} h={14} rayas={[0.6]} />
      {[[30, 6], [210, 6], [30, 94], [210, 94]].map(([x, y], i) => (
        <path key={i} d={`M${x + (x < 100 ? -6 : 6)},${y} H${x} V${y + (y < 50 ? -6 : 6)}`} fill="none" stroke={color("tinta")} strokeWidth={0.8} />
      ))}
    </Svg>
  ),
  unaPagina: () => (
    <Svg w={240} h={96}>
      <Pagina x={70} y={4} w={100} h={88}>
        {[0, 1, 2, 3].map((g) => {
          const n = 2 ** g;
          const y = 78 - g * 20;
          return Array.from({ length: n }, (_, i) => {
            const x = 80 + ((i + 0.5) * 80) / n;
            const parent = 80 + ((Math.floor(i / 2) + 0.5) * 80) / (n / 2);
            return (
              <g key={`${g}${i}`}>
                {g > 0 && <Union a={[x, y + 3]} b={[parent, y + 17]} />}
                <Caja x={x - Math.min(8, 34 / n)} y={y - 3} w={Math.min(16, 68 / n)} h={6} rayas={[]} />
              </g>
            );
          });
        })}
      </Pagina>
    </Svg>
  ),
  letra: () => (
    <Svg w={240} h={64}>
      {[4, 5, 6].map((pt, i) => (
        <g key={pt}>
          <text x={50 + i * 70} y={34} fontSize={pt * 2.6} fill={color("tinta")} textAnchor="middle" fontWeight={600}>Aa</text>
          <Rotulo x={50 + i * 70} y={58}>{t("pdf.unaPagina.puntos", { n: pt })}</Rotulo>
        </g>
      ))}
    </Svg>
  ),
  ids: () => (
    <Svg w={240} h={76}>
      <rect x={80} y={6} width={80} height={64} rx={4} fill={CAJA} stroke={LINEA} />
      <line x1={92} x2={148} y1={18} y2={18} stroke={RAYA} strokeWidth={2} strokeLinecap="round" />
      <line x1={98} x2={142} y1={26} y2={26} stroke={RAYA} strokeWidth={2} strokeLinecap="round" />
      <rect x={104} y={31} width={32} height={11} rx={5.5} fill={color("teja-claro")} stroke={MARCA} strokeWidth={0.8} />
      <text x={120} y={39.5} fontSize={8} fill={color("tinta")} textAnchor="middle">ID</text>
      <line x1={94} x2={146} y1={50} y2={50} stroke={RAYA} strokeWidth={1.2} strokeLinecap="round" />
      <line x1={98} x2={142} y1={58} y2={58} stroke={RAYA} strokeWidth={1.2} strokeLinecap="round" />
    </Svg>
  ),
};
