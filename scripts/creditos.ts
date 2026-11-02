// Lista de las bibliotecas que van en la web, para la página de créditos
// (`/creditos`, app/src/paginas/Creditos.tsx; docs/creditos.md).
//
// Compila la web con Vite sin escribir nada y apunta de qué paquete de
// node_modules sale cada trozo del resultado (el código de los fragmentos
// y los ficheros que acompañan, como las letras): así la lista es la de lo
// que de verdad se sirve, con lo que traen las dependencias, y sin lo que
// se queda fuera (las dependencias del servidor, las de desarrollo o el
// código que no se usa). De cada paquete guarda nombre, versión, licencia,
// enlace y el texto de su licencia (los avisos de copyright que piden MIT,
// BSD, ISC, Apache…), sin repetir los textos iguales.
//
// Salida: app/src/creditos/bibliotecas.json. Uso, tras cambiar las
// dependencias de la web (`npm install`):
//     npm run creditos

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Bibliotecas, Paquete, TextoLicencia } from "../app/src/creditos/tipos.ts";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(RAIZ, "app");
const SALIDA = path.join(APP, "src", "creditos", "bibliotecas.json");
const LICENCIAS = path.join(RAIZ, "scripts", "licencias");

/** Código que añaden Vite y Rolldown al compilar (módulos virtuales). */
const VIRTUALES: Record<string, string> = { "vite/": "vite", "rolldown/": "rolldown" };

/** Ficheros de licencia que traen, además del suyo, los de lo que llevan
 * dentro para su propio uso: aquí solo va lo de antes de esa marca. */
const RECORTES: Record<string, string> = { vite: "# Licenses of bundled dependencies" };

/** Titular del copyright de los paquetes sin fichero de licencia cuyo
 * package.json no lo dice bien (Firebase: «Firebase <…>»; el de las
 * cabeceras de su código es Google LLC). */
const TITULARES: [RegExp, string][] = [[/^(@firebase\/|firebase$)/, "Google LLC"]];

const leerJson = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"));
/** Sin retornos de carro ni líneas en blanco al principio y al final (la
 * sangría de la primera línea se conserva). */
const normalizar = (s: string) => s.replace(/\r\n?/g, "\n").replace(/^(\s*\n)+/, "").trimEnd();

/** «node_modules/@scope/nombre» o «node_modules/nombre» de una ruta, o null. */
function carpetaPaquete(ruta: string): string | null {
  const r = ruta.replaceAll("\\", "/");
  const i = r.lastIndexOf("node_modules/");
  if (i < 0) return null;
  const partes = r.slice(i + "node_modules/".length).split("/");
  const n = partes[0].startsWith("@") ? 2 : 1;
  return r.slice(0, i) + "node_modules/" + partes.slice(0, n).join("/");
}

/** Compila la web y devuelve las carpetas de los paquetes que lleva. */
async function carpetasEnLaWeb(): Promise<Set<string>> {
  const { build } = await import("vite");
  const carpetas = new Set<string>();
  const anadir = (ruta: string) => {
    const virtual = ruta.startsWith("\0") && Object.keys(VIRTUALES).find((p) => ruta.startsWith("\0" + p));
    if (virtual) carpetas.add(path.join(RAIZ, "node_modules", VIRTUALES[virtual]));
    else if (ruta.startsWith("\0")) throw new Error(`Módulo virtual desconocido: ${JSON.stringify(ruta)}`);
    else {
      const c = carpetaPaquete(path.resolve(APP, ruta));
      if (c) carpetas.add(path.normalize(c));
    }
  };
  await build({
    root: APP,
    configFile: path.join(APP, "vite.config.ts"),
    // La web que se publica (app/vite.config.ts solo compila para producción).
    mode: "produccion",
    logLevel: "error",
    build: { write: false },
    plugins: [{
      name: "creditos",
      generateBundle(_opciones, salida) {
        for (const f of Object.values(salida)) {
          if (f.type === "chunk") {
            for (const [id, m] of Object.entries(f.modules)) if (m.renderedLength > 0) anadir(id);
          } else {
            for (const ruta of f.originalFileNames) anadir(ruta);
          }
        }
      },
    }],
  });
  return carpetas;
}

function nombreAutor(autor: unknown): string | null {
  if (!autor) return null;
  if (typeof autor === "object" && "name" in autor) return String(autor.name);
  return String(autor).replace(/\s*[<(].*$/, "").trim() || null;
}

function enlace(pkg: Record<string, any>): string {
  if (typeof pkg.homepage === "string" && pkg.homepage) return pkg.homepage.replace(/#readme$/, "");
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  if (typeof repo === "string" && repo) {
    if (/^[\w.-]+\/[\w.-]+$/.test(repo)) return `https://github.com/${repo}`;
    return repo.replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/\.git$/, "");
  }
  return `https://www.npmjs.com/package/${pkg.name}`;
}

function licencia(pkg: Record<string, any>): string {
  if (typeof pkg.license === "string") return pkg.license;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l: any) => l.type ?? l).join(" OR ");
  throw new Error(`${pkg.name}: sin licencia en package.json`);
}

/** El texto de la licencia del paquete: sus ficheros LICENSE, COPYING o
 * NOTICE (Apache pide reproducir también este) o, si no trae ninguno, el
 * texto estándar de su licencia con el autor que dice su package.json. */
function textoLicencia(carpeta: string, pkg: Record<string, any>, spdx: string): TextoLicencia {
  const ficheros = fs.readdirSync(carpeta)
    .filter((f) => /^(licen[cs]e|copying|notice)([.-].*)?$/i.test(f) && fs.statSync(path.join(carpeta, f)).isFile())
    .sort((a, b) => Number(/^notice/i.test(a)) - Number(/^notice/i.test(b)) || a.localeCompare(b));
  if (ficheros.length) {
    const textos = ficheros.map((f) => {
      let t = normalizar(fs.readFileSync(path.join(carpeta, f), "utf8"));
      const corte = RECORTES[pkg.name];
      if (corte && t.includes(corte)) t = normalizar(t.slice(0, t.indexOf(corte)));
      return ficheros.length > 1 ? `--- ${f} ---\n\n${t}` : t;
    });
    return { texto: textos.join("\n\n"), estandar: false };
  }
  const autor = TITULARES.find(([re]) => re.test(pkg.name))?.[1] ?? nombreAutor(pkg.author) ?? `the ${pkg.name} authors`;
  if (spdx === "MIT") {
    const plantilla = fs.readFileSync(path.join(LICENCIAS, "MIT.txt"), "utf8");
    return { texto: normalizar(plantilla.replace("{autor}", autor)), estandar: true };
  }
  if (spdx === "Apache-2.0") {
    const apache = fs.readFileSync(path.join(LICENCIAS, "Apache-2.0.txt"), "utf8");
    return { texto: `Copyright ${autor}\n\n${normalizar(apache)}`, estandar: true };
  }
  throw new Error(`${pkg.name}: sin fichero de licencia ni texto estándar de ${spdx} en scripts/licencias/`);
}

async function main() {
  // La página importa el fichero: si aún no existe, uno vacío para compilar.
  if (!fs.existsSync(SALIDA)) {
    fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
    fs.writeFileSync(SALIDA, JSON.stringify({ paquetes: [], textos: [], sinUsar: [] }) + "\n");
  }
  const directas = Object.keys(leerJson(path.join(APP, "package.json")).dependencies ?? {});
  const carpetas = await carpetasEnLaWeb();

  const paquetes: (Omit<Paquete, "texto"> & { t: TextoLicencia })[] = [];
  for (const carpeta of carpetas) {
    const pkg = leerJson(path.join(carpeta, "package.json"));
    const spdx = licencia(pkg);
    paquetes.push({
      nombre: pkg.name, version: pkg.version, licencia: spdx, enlace: enlace(pkg),
      directa: directas.includes(pkg.name), t: textoLicencia(carpeta, pkg, spdx),
      carpeta: path.relative(RAIZ, carpeta).replaceAll("\\", "/"),
    });
  }
  paquetes.sort((a, b) => a.nombre.localeCompare(b.nombre, "en") || a.version.localeCompare(b.version, "en"));

  const textos: TextoLicencia[] = [];
  const posicion = new Map<string, number>();
  const datos: Bibliotecas = {
    paquetes: paquetes.map(({ t, ...p }) => {
      const clave = `${t.estandar}\n${t.texto}`;
      if (!posicion.has(clave)) posicion.set(clave, textos.push(t) - 1);
      return { ...p, texto: posicion.get(clave)! };
    }),
    textos,
    sinUsar: directas.filter((d) => !paquetes.some((p) => p.nombre === d)).sort(),
  };
  fs.writeFileSync(SALIDA, JSON.stringify(datos, null, 1) + "\n");
  console.log(`${datos.paquetes.length} paquetes y ${textos.length} textos de licencia en ${path.relative(RAIZ, SALIDA)}.`);
  if (datos.sinUsar.length) console.log(`Dependencias de la web que no llegan a la web compilada: ${datos.sinUsar.join(", ")}.`);
}

await main();
