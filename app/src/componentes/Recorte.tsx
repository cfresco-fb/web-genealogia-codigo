// Recorte de una foto para una persona (fase 3, paso 11 b; DF-3 a): un
// recuadro sobre la foto que se mueve arrastrándolo y se agranda o achica
// desde las esquinas, como en Gramps. Se guarda en la referencia
// (MediaRef.rect) en porcentajes enteros de 0 a 100: [x1, y1, x2, y2]. El
// árbol, la ficha y el libro ya lo usan. Escrito nuevo.

import { useRef, type PointerEvent as EventoPuntero } from "react";
import { Box, Image } from "@mantine/core";
import { color } from "../tema/colores";

export type Rect = [number, number, number, number];

/** Recuadro de partida: el centro de la foto, algo más alto que ancho, que
 * suele ser donde está la cara en un retrato. */
export const RECT_INICIAL: Rect = [25, 10, 75, 70];
const MINIMO = 5;

type Agarre = "mover" | "no" | "ne" | "so" | "se";

/** Esquinas que mueve cada agarre: [x1, y1, x2, y2]. */
const MUEVE: Record<Agarre, [boolean, boolean, boolean, boolean]> = {
  mover: [true, true, true, true],
  no: [true, true, false, false],
  ne: [false, true, true, false],
  so: [true, false, false, true],
  se: [false, false, true, true],
};

const limitar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** El recuadro tras arrastrar `dx`, `dy` (en porcentajes) con un agarre. */
export function moverRect(r: Rect, agarre: Agarre, dx: number, dy: number): Rect {
  if (agarre === "mover") {
    const ddx = limitar(dx, -r[0], 100 - r[2]);
    const ddy = limitar(dy, -r[1], 100 - r[3]);
    return [r[0] + ddx, r[1] + ddy, r[2] + ddx, r[3] + ddy];
  }
  const [mx1, my1, mx2, my2] = MUEVE[agarre];
  const x1 = mx1 ? limitar(r[0] + dx, 0, r[2] - MINIMO) : r[0];
  const y1 = my1 ? limitar(r[1] + dy, 0, r[3] - MINIMO) : r[1];
  const x2 = mx2 ? limitar(r[2] + dx, r[0] + MINIMO, 100) : r[2];
  const y2 = my2 ? limitar(r[3] + dy, r[1] + MINIMO, 100) : r[3];
  return [x1, y1, x2, y2];
}

export function Recorte({ url, rect, alCambiar, rotulo }: {
  url: string;
  rect: Rect;
  alCambiar: (r: Rect) => void;
  /** Para los lectores de pantalla. */
  rotulo: string;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const arrastre = useRef<{ agarre: Agarre; x: number; y: number; rect: Rect } | null>(null);

  const empezar = (agarre: Agarre) => (e: EventoPuntero) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    arrastre.current = { agarre, x: e.clientX, y: e.clientY, rect };
  };
  const mover = (e: EventoPuntero) => {
    const a = arrastre.current;
    const c = caja.current?.getBoundingClientRect();
    if (!a || !c) return;
    const dx = ((e.clientX - a.x) / c.width) * 100;
    const dy = ((e.clientY - a.y) / c.height) * 100;
    alCambiar(moverRect(a.rect, a.agarre, dx, dy).map(Math.round) as Rect);
  };
  const terminar = () => { arrastre.current = null; };

  const [x1, y1, x2, y2] = rect;
  const esquina = (agarre: Agarre, estilo: React.CSSProperties) => (
    <div
      onPointerDown={empezar(agarre)}
      style={{
        position: "absolute", width: 18, height: 18, margin: -9, borderRadius: 3, touchAction: "none",
        background: color("superficie"), border: `2px solid ${color("teja")}`,
        cursor: agarre === "no" || agarre === "se" ? "nwse-resize" : "nesw-resize", ...estilo,
      }}
    />
  );
  return (
    <Box ref={caja} pos="relative" style={{ display: "inline-block", lineHeight: 0, userSelect: "none", touchAction: "none", overflow: "hidden" }}
      onPointerMove={mover} onPointerUp={terminar} onPointerCancel={terminar} role="group" aria-label={rotulo}>
      <Image src={url} alt="" mah="60dvh" maw="100%" fit="contain" draggable={false} />
      <div
        onPointerDown={empezar("mover")}
        style={{
          position: "absolute", left: `${x1}%`, top: `${y1}%`, width: `${x2 - x1}%`, height: `${y2 - y1}%`,
          cursor: "move", touchAction: "none",
          border: `2px solid ${color("teja")}`,
          // Lo que queda fuera del recorte, velado.
          boxShadow: `0 0 0 9999px color-mix(in srgb, ${color("tinta")} 55%, transparent)`,
        }}
      >
        {esquina("no", { left: 0, top: 0 })}
        {esquina("ne", { right: 0, top: 0 })}
        {esquina("so", { left: 0, bottom: 0 })}
        {esquina("se", { right: 0, bottom: 0 })}
      </div>
    </Box>
  );
}
