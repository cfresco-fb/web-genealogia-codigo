// Comprueba la instantánea del código antes de publicarla en el repositorio
// público (docs/codigo-fuente-publico.md, apartado 4.2, paso 5): que no
// lleve ficheros prohibidos (datos del árbol, exportaciones, claves,
// documentación interna, fotos) ni nada que parezca una clave privada. El
// detector de secretos (gitleaks) se pasa aparte; esto es la lista de lo
// que no debe salir nunca, aunque .gitattributes se equivoque.
//
// Uso: node scripts/comprobar_instantanea.ts <carpeta>
// Sale con código 1 (y la lista) si encuentra algo; el flujo se para ahí,
// sin publicar ni desplegar.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const carpeta = process.argv[2];
if (!carpeta) {
  console.error("Uso: node scripts/comprobar_instantanea.ts <carpeta>");
  process.exit(2);
}

/** Carpetas y ficheros que no se publican (los de .gitattributes y los que
 * nunca deberían estar en git). */
const RUTAS_PROHIBIDAS = [
  /^docs\/(?!iconos\/)/,
  /^datos\//,
  /^CLAUDE\.md$/,
  /^redireccion-antigua\//,
  /^scripts\/utilidades\.md$/,
  /^publico\//,
  /^emulador-datos\//,
  /^\.claude\//,
  /(^|\/)node_modules\//,
  /(^|\/)\.venv\//,
  /(^|\/)\.cache\//,
];

/** Tipos de fichero prohibidos en cualquier sitio. */
const NOMBRES_PROHIBIDOS = [
  /\.(gpkg|gramps|ged)$/i, // exportaciones de Gramps
  /\.csv$/i, // la exportación de usuarios de Supabase
  /(^|\/)arbol(-[\w-]+)?\.json(\.gz)?$/i, // el JSON del árbol
  /\.(pem|key|p12|pfx|jks|keystore)$/i, // claves
  /(^|\/)id_(rsa|ed25519|ecdsa)/i,
  /\.(sqlite3?|db)$/i,
  /\.(jpe?g|heic|tiff?|gif|webp|bmp|raw)$/i, // fotos
];

/** El único .env que se publica: variables no secretas de las funciones. */
const ENV_PERMITIDOS = new Set(["functions/.env.arbol-freswer"]);

/** Imágenes PNG, solo los iconos. */
const PNG_PERMITIDOS = /^(app\/public|docs\/iconos)\/[^/]+\.png$/;

/** Más que esto, sospechoso de ser un volcado de datos. */
const TAMANO_MAXIMO = 2 * 1024 * 1024;

/** Contenido que delata una clave privada o una cuenta de servicio. */
const CONTENIDO_PROHIBIDO = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /"private_key"\s*:/, /"type"\s*:\s*"service_account"/];

const problemas: string[] = [];
let ficheros = 0;

function recorrer(dir: string) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const completa = path.join(dir, e.name);
    const ruta = path.relative(carpeta, completa).split(path.sep).join("/");
    if (e.isDirectory()) {
      if (ruta === ".git") continue;
      recorrer(completa);
      continue;
    }
    ficheros++;
    if (RUTAS_PROHIBIDAS.some((r) => r.test(ruta))) problemas.push(`${ruta}: ruta que no se publica`);
    if (NOMBRES_PROHIBIDOS.some((r) => r.test(ruta))) problemas.push(`${ruta}: tipo de fichero prohibido`);
    if (/(^|\/)\.env(\.|$)/.test(ruta) && !ENV_PERMITIDOS.has(ruta)) problemas.push(`${ruta}: fichero .env`);
    if (/\.png$/i.test(ruta) && !PNG_PERMITIDOS.test(ruta)) problemas.push(`${ruta}: imagen fuera de los iconos`);
    const tamano = statSync(completa).size;
    if (tamano > TAMANO_MAXIMO && ruta !== "package-lock.json") problemas.push(`${ruta}: demasiado grande (${tamano} bytes)`);
    const datos = readFileSync(completa);
    if (!datos.includes(0)) {
      const texto = datos.toString("utf8");
      for (const r of CONTENIDO_PROHIBIDO) if (r.test(texto)) problemas.push(`${ruta}: parece una clave (${r.source})`);
    }
  }
}

recorrer(carpeta);
for (const imprescindible of ["LICENSE", "README.md"]) {
  try {
    statSync(path.join(carpeta, imprescindible));
  } catch {
    problemas.push(`${imprescindible}: falta`);
  }
}

if (problemas.length) {
  console.error(`La instantánea NO se puede publicar (${problemas.length} problemas):`);
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Instantánea comprobada: ${ficheros} ficheros, nada prohibido.`);
