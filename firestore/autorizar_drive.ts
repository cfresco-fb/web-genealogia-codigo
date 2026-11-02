/**
 * Autorización inicial de la copia en Google Drive (docs/puesta-en-marcha.md,
 * apartado 8 bis). Lo lanza Carlos una vez (y otra si la autorización
 * caduca o se retira): abre el navegador para que dé permiso a la web a
 * escribir en su Drive (`drive.file`: solo lo que cree la propia web) y
 * muestra el permiso de refresco, que se guarda en Secret Manager
 * (`npx firebase functions:secrets:set DRIVE_REFRESH_TOKEN --project produccion`)
 * y en ningún otro sitio.
 *
 * Necesita el cliente OAuth («Aplicación de escritorio») del proyecto: su ID
 * (DRIVE_CLIENT_ID de functions/.env.arbol-freswer) y su secreto (lo
 * pregunta). La respuesta de Google llega a este ordenador
 * (http://127.0.0.1:<puerto>), sin pasar por ningún servidor.
 *
 * Uso: node firestore/autorizar_drive.ts
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { preguntar } from "./comun.ts";

const PERMISO = "https://www.googleapis.com/auth/drive.file";

function idDelCliente(): string {
  const env = readFileSync(new URL("../functions/.env.arbol-freswer", import.meta.url), "utf8");
  return /^DRIVE_CLIENT_ID=(.*)$/m.exec(env)?.[1]?.trim() ?? "";
}

const clientId = idDelCliente() || (await preguntar("ID del cliente OAuth (DRIVE_CLIENT_ID): "));
if (!clientId) {
  console.error("Falta el ID del cliente OAuth (DRIVE_CLIENT_ID en functions/.env.arbol-freswer).");
  process.exit(2);
}
const secreto = await preguntar("Secreto del cliente OAuth (el mismo que DRIVE_CLIENT_SECRET): ");
const estado = randomBytes(16).toString("hex");

// Un servidor en este ordenador recibe la respuesta de Google.
const codigo = await new Promise<{ codigo: string; redireccion: string }>((ok, mal) => {
  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/") return void res.writeHead(404).end();
    const c = url.searchParams.get("code");
    const valido = c && url.searchParams.get("state") === estado;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(valido
      ? "<p>Autorizado. Ya puedes cerrar esta pestaña y volver a la consola.</p>"
      : `<p>No se ha autorizado (${url.searchParams.get("error") ?? "respuesta no válida"}). Vuelve a la consola.</p>`);
    servidor.close();
    if (valido) ok({ codigo: c, redireccion: `http://127.0.0.1:${(servidor.address() as AddressInfo | null)?.port ?? puerto}` });
    else mal(new Error(url.searchParams.get("error") ?? "Respuesta no válida"));
  });
  let puerto = 0;
  servidor.listen(0, "127.0.0.1", () => {
    puerto = (servidor.address() as AddressInfo).port;
    const enlace = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: clientId, redirect_uri: `http://127.0.0.1:${puerto}`, response_type: "code", scope: PERMISO,
      access_type: "offline", prompt: "consent", state: estado,
    })}`;
    console.log("\nSe abre el navegador para autorizar la copia en tu Google Drive. Si no se abre, copia este enlace:\n");
    console.log(enlace + "\n");
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "", enlace.replace(/&/g, "^&")], { stdio: "ignore", detached: true }).unref();
  });
});

const r = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ code: codigo.codigo, client_id: clientId, client_secret: secreto, redirect_uri: codigo.redireccion, grant_type: "authorization_code" }),
});
const j = (await r.json()) as { refresh_token?: string; scope?: string; error?: string; error_description?: string };
if (!r.ok || !j.refresh_token) {
  console.error(`No se ha obtenido el permiso de refresco: ${j.error ?? r.status} ${j.error_description ?? ""}`);
  process.exit(1);
}
if (!j.scope?.split(" ").includes(PERMISO)) console.log(`AVISO: el permiso concedido no es ${PERMISO}: ${j.scope}`);
console.log("\nPermiso de refresco (guárdalo SOLO en Secret Manager; no lo copies en ningún otro sitio):\n");
console.log(j.refresh_token);
console.log("\nAhora: npx firebase functions:secrets:set DRIVE_REFRESH_TOKEN --project produccion  (pega el valor cuando lo pida)");
console.log("y vuelve a desplegar las funciones para que lo usen: npx firebase deploy --project produccion --only functions");
