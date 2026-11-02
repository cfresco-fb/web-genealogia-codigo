import { describe, expect, it } from "vitest";
import type { EntradaRegistro } from "../registro";
import { FILTROS_VACIOS, TODOS, filtrarRegistro, opcionesAutores, valorAutor } from "./filtrosRegistro";

const entrada = (secuencia: number, correo: string, origen = "edicion"): EntradaRegistro => ({
  id: `c${secuencia}`, secuencia, fecha: null as never, autor: { correo, persona: null, rol: "administrador" },
  origen, accion: "cambiar", principal: null, motivo: null, objetos: [], estado: "aceptado", revision: null,
  revertidoPor: null, revierte: null, corrige: null, corregidoPor: [], fuera: null,
});

describe("filtros del registro", () => {
  // Fallo del 29/10/2026: la carga del árbol, sin correo de autor, tenía el
  // mismo valor que «Todos» y Mantine rompía la página.
  const entradas = [entrada(1, "", "carga"), entrada(2, "ana@example.com"), entrada(3, "ana@example.com"), entrada(4, "luis@example.com")];
  const opciones = opcionesAutores(entradas, (a) => a.correo || "Autor desconocido");

  it("una opción por autor, sin valores repetidos ni el de «Todos»", () => {
    const valores = opciones.map((o) => o.value);
    expect(valores).toHaveLength(3);
    expect(new Set([TODOS, ...valores]).size).toBe(4);
  });

  it("filtra por un autor sin correo", () => {
    expect(filtrarRegistro(entradas, { ...FILTROS_VACIOS, autor: valorAutor("") }).map((e) => e.secuencia)).toEqual([1]);
    expect(filtrarRegistro(entradas, { ...FILTROS_VACIOS, autor: valorAutor("ana@example.com") }).map((e) => e.secuencia)).toEqual([2, 3]);
  });

  it("«Todos» no filtra", () => {
    expect(filtrarRegistro(entradas, FILTROS_VACIOS)).toHaveLength(4);
    expect(filtrarRegistro(entradas, { ...FILTROS_VACIOS, origen: "carga" }).map((e) => e.secuencia)).toEqual([1]);
  });
});
