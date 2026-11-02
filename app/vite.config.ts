import { execSync } from "node:child_process";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/** La versión del código que se compila (para el enlace al código fuente de
 * la página de créditos: la AGPL pide el de la versión que se ejecuta): el
 * commit, su fecha, si hay cambios sin confirmar y la etiqueta con que se
 * publica en el repositorio público (`ETIQUETA_CODIGO`, que pone el flujo de
 * despliegue, .github/workflows/desplegar.yml; vacía fuera de él). Sin git,
 * vacía. */
function versionCodigo() {
  const git = (orden: string) => {
    try {
      return execSync(`git ${orden}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return "";
    }
  };
  return {
    commit: git("rev-parse HEAD"),
    fecha: git("log -1 --format=%cI"),
    cambios: git("status --porcelain").length > 0,
    etiqueta: process.env.ETIQUETA_CODIGO ?? "",
  };
}

/** Dos destinos (docs/puesta-en-marcha.md): «pruebas», con los emuladores
 * (`npm run web`, las pruebas), y «produccion», el proyecto real
 * (`npm run compilar-web`, `vite build --mode produccion`). Uno sale del
 * otro sin mezclarse: compilar solo para producción, y el servidor de
 * desarrollo solo con los emuladores. */
export default defineConfig(({ command, mode }) => {
  const produccion = mode === "produccion";
  if (command === "build" && !produccion) {
    throw new Error("La web solo se compila para producción: npm run compilar-web (vite build --mode produccion).");
  }
  if (command === "serve" && produccion) {
    throw new Error("El servidor de desarrollo solo trabaja con los emuladores (sin --mode produccion).");
  }
  return {
    plugins: [react()],
    define: {
      __VERSION_CODIGO__: JSON.stringify(versionCodigo()),
      __DESTINO__: JSON.stringify(produccion ? "produccion" : "pruebas"),
    },
    server: { port: 5173, strictPort: true },
    test: { environment: "node" },
  };
});
