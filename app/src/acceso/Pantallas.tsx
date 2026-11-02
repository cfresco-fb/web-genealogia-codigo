// Pantallas de acceso: entrada, registro, recuperación de contraseña,
// confirmación del correo y «No tienes acceso».

import { useState, type FormEvent, type ReactNode } from "react";
import { Alert, Anchor, Button, Center, Divider, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import {
  GoogleAuthProvider, createUserWithEmailAndPassword, linkWithCredential, sendEmailVerification,
  sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, type AuthCredential, type User,
} from "firebase/auth";
import { auth, salir } from "../firebase";
import { t, type Clave } from "../i18n";
import { esAltaSinInvitacion } from "../../../comun/altas.ts";
import { NotaPrivacidad } from "../componentes/NotaPrivacidad";
import { URL_CODIGO_FUENTE } from "../configuracion";

const MINIMO_CONTRASENA = 8;

/** Mensaje para un error de Firebase Auth. Con la protección contra la
 * enumeración de correos, Firebase no distingue «no existe» de
 * «contraseña incorrecta»: ambos son credenciales incorrectas. El alta de
 * un correo sin invitación la rechaza la función de bloqueo del servidor
 * (01/11/2026; docs/acceso.md, «Altas solo con invitación»). */
function mensajeError(e: unknown): string {
  if (esAltaSinInvitacion(e)) return t("acceso.error.sinInvitacion");
  const codigo = (e as { code?: string }).code ?? "";
  const claves: Record<string, Clave> = {
    "auth/invalid-credential": "acceso.error.credenciales",
    "auth/invalid-login-credentials": "acceso.error.credenciales",
    "auth/wrong-password": "acceso.error.credenciales",
    "auth/user-not-found": "acceso.error.credenciales",
    "auth/email-already-in-use": "acceso.error.correoUsado",
    "auth/invalid-email": "acceso.error.correoNoValido",
    "auth/missing-email": "acceso.error.correoNoValido",
    "auth/weak-password": "acceso.error.debil",
    "auth/too-many-requests": "acceso.error.demasiados",
    "auth/network-request-failed": "acceso.error.red",
    "auth/popup-blocked": "acceso.error.ventana",
  };
  return claves[codigo] ? t(claves[codigo]) : t("acceso.error.otro", { codigo: codigo || String(e) });
}

/** Al volver del enlace de los correos de Firebase, a la misma página. */
const volverAqui = () => ({ url: window.location.origin + window.location.pathname });

/** Las pantallas de acceso: el nombre de la web arriba, con la letra de los
 * títulos, y una tarjeta sobre el fondo de la página (decisión del
 * 24/10/2026, «Diseño visual»). Antes de entrar no se puede leer el nombre
 * del árbol que fija el administrador: es el de la web. */
function Marco({ titulo, children, ancho = 420 }: { titulo: string; children: ReactNode; ancho?: number }) {
  return (
    <Center mih="100dvh" p="md">
      <Stack w="100%" maw={ancho} gap="md">
        <Text className="tema-nombre-arbol" ta="center">{t("app.titulo")}</Text>
        <Paper withBorder p="xl">
          <Stack>
            <Title order={2}>{titulo}</Title>
            {children}
          </Stack>
        </Paper>
      </Stack>
    </Center>
  );
}

function AvisoError({ mensaje }: { mensaje: string | null }) {
  return mensaje ? <Alert color="red" variant="light">{mensaje}</Alert> : null;
}

type Pantalla = "entrar" | "registro" | "recuperar" | "privacidad";

/** Entrada, registro y recuperación, sin cambiar la dirección: tras
 * entrar, se ve la página que se había pedido. */
export function PantallasEntrada() {
  // La nota de privacidad se puede abrir sin sesión con su dirección.
  const [pantalla, setPantalla] = useState<Pantalla>(() => (window.location.pathname === "/privacidad" ? "privacidad" : "entrar"));
  const [correo, setCorreo] = useState("");
  // Credencial de Google pendiente de unir a una cuenta con contraseña.
  const [pendiente, setPendiente] = useState<{ correo: string; credencial: AuthCredential } | null>(null);
  const comun = { correo, setCorreo, ir: setPantalla };
  if (pantalla === "registro") return <Registro {...comun} />;
  if (pantalla === "recuperar") return <Recuperar {...comun} />;
  if (pantalla === "privacidad") {
    return (
      <Marco titulo={t("privacidad.titulo")} ancho={680}>
        <NotaPrivacidad />
        <Anchor component="button" type="button" size="sm" onClick={() => setPantalla("entrar")}>{t("privacidad.volver")}</Anchor>
      </Marco>
    );
  }
  return <Entrar {...comun} pendiente={pendiente} setPendiente={setPendiente} />;
}

interface PropsComunes {
  correo: string;
  setCorreo: (c: string) => void;
  ir: (p: Pantalla) => void;
}

function Entrar({ correo, setCorreo, ir, pendiente, setPendiente }: PropsComunes & {
  pendiente: { correo: string; credencial: AuthCredential } | null;
  setPendiente: (p: { correo: string; credencial: AuthCredential } | null) => void;
}) {
  const [contrasena, setContrasena] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function conContrasena(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOcupado(true);
    try {
      const r = await signInWithEmailAndPassword(auth, correo.trim(), contrasena);
      // Si venía de Google con el mismo correo, se unen las dos formas de
      // entrar en una sola cuenta.
      if (pendiente && pendiente.correo === r.user.email?.toLowerCase()) {
        await linkWithCredential(r.user, pendiente.credencial);
        setPendiente(null);
      }
    } catch (err) {
      setError(mensajeError(err));
      setOcupado(false);
    }
  }

  async function conGoogle() {
    setError(null);
    try {
      const proveedor = new GoogleAuthProvider();
      proveedor.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, proveedor);
    } catch (err) {
      const codigo = (err as { code?: string }).code;
      if (codigo === "auth/popup-closed-by-user" || codigo === "auth/cancelled-popup-request") return;
      if (codigo === "auth/account-exists-with-different-credential") {
        // Ya hay una cuenta con contraseña con ese correo y Google no es su
        // proveedor de confianza (correos que no son de Gmail).
        const credencial = GoogleAuthProvider.credentialFromError(err as never);
        const c = ((err as { customData?: { email?: string } }).customData?.email ?? "").toLowerCase();
        if (credencial && c) {
          setPendiente({ correo: c, credencial });
          setCorreo(c);
          return;
        }
      }
      setError(mensajeError(err));
    }
  }

  return (
    <Marco titulo={t("acceso.entrar.titulo")}>
      <Text size="sm">{t("acceso.entrar.texto")}</Text>
      {pendiente && <Alert variant="light">{t("acceso.vincularGoogle", { correo: pendiente.correo })}</Alert>}
      {!pendiente && (
        <>
          <Button variant="default" onClick={conGoogle}>{t("acceso.google")}</Button>
          <Divider label={t("acceso.o")} />
        </>
      )}
      <form onSubmit={conContrasena}>
        <Stack>
          <TextInput label={t("acceso.correo")} type="email" autoComplete="email" required
            value={correo} onChange={(e) => setCorreo(e.currentTarget.value)} />
          <PasswordInput label={t("acceso.contrasena")} autoComplete="current-password" required
            value={contrasena} onChange={(e) => setContrasena(e.currentTarget.value)} />
          <AvisoError mensaje={error} />
          <Button type="submit" loading={ocupado}>{t("acceso.entrar.boton")}</Button>
        </Stack>
      </form>
      <Anchor component="button" type="button" size="sm" onClick={() => ir("recuperar")}>{t("acceso.irRecuperar")}</Anchor>
      <Anchor component="button" type="button" size="sm" onClick={() => ir("registro")}>{t("acceso.irRegistro")}</Anchor>
      <Anchor component="button" type="button" size="sm" c="dimmed" onClick={() => ir("privacidad")}>{t("privacidad.enlace")}</Anchor>
      {/* El código fuente, también antes de entrar (AGPL; Carlos, 02/11/2026):
          la misma dirección que la página de créditos. */}
      <Anchor href={URL_CODIGO_FUENTE} target="_blank" rel="noopener noreferrer" size="sm" c="dimmed" ta="center">{t("acceso.codigoFuente")}</Anchor>
    </Marco>
  );
}

function Registro({ correo, setCorreo, ir }: PropsComunes) {
  const [contrasena, setContrasena] = useState("");
  const [repetida, setRepetida] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function registrar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (contrasena.length < MINIMO_CONTRASENA) return setError(t("acceso.registro.minimo", { n: MINIMO_CONTRASENA }));
    if (contrasena !== repetida) return setError(t("acceso.registro.noCoinciden"));
    setOcupado(true);
    try {
      const r = await createUserWithEmailAndPassword(auth, correo.trim(), contrasena);
      // La sesión cambia sola a la pantalla de confirmar el correo.
      await sendEmailVerification(r.user, volverAqui());
    } catch (err) {
      setError(mensajeError(err));
      setOcupado(false);
    }
  }

  return (
    <Marco titulo={t("acceso.registro.titulo")}>
      <Alert variant="light">{t("acceso.registro.aviso")}</Alert>
      <Text size="sm">{t("acceso.registro.texto")}</Text>
      <form onSubmit={registrar}>
        <Stack>
          <TextInput label={t("acceso.correo")} type="email" autoComplete="email" required
            value={correo} onChange={(e) => setCorreo(e.currentTarget.value)} />
          <PasswordInput label={t("acceso.contrasena")} autoComplete="new-password" required
            description={t("acceso.registro.minimo", { n: MINIMO_CONTRASENA })}
            value={contrasena} onChange={(e) => setContrasena(e.currentTarget.value)} />
          <PasswordInput label={t("acceso.repetirContrasena")} autoComplete="new-password" required
            value={repetida} onChange={(e) => setRepetida(e.currentTarget.value)} />
          <AvisoError mensaje={error} />
          <Button type="submit" loading={ocupado}>{t("acceso.registro.boton")}</Button>
        </Stack>
      </form>
      <Anchor component="button" type="button" size="sm" onClick={() => ir("entrar")}>{t("acceso.irEntrar")}</Anchor>
    </Marco>
  );
}

function Recuperar({ correo, setCorreo, ir }: PropsComunes) {
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOcupado(true);
    try {
      await sendPasswordResetEmail(auth, correo.trim(), volverAqui());
      setEnviado(true);
    } catch (err) {
      // Que no se pueda averiguar si un correo tiene cuenta: solo se
      // informa de los errores que no dependen de eso.
      if ((err as { code?: string }).code === "auth/user-not-found") setEnviado(true);
      else setError(mensajeError(err));
    }
    setOcupado(false);
  }

  return (
    <Marco titulo={t("acceso.recuperar.titulo")}>
      {enviado ? (
        <Alert variant="light" color="green">{t("acceso.recuperar.enviado")}</Alert>
      ) : (
        <form onSubmit={enviar}>
          <Stack>
            <Text size="sm">{t("acceso.recuperar.texto")}</Text>
            <TextInput label={t("acceso.correo")} type="email" autoComplete="email" required
              value={correo} onChange={(e) => setCorreo(e.currentTarget.value)} />
            <AvisoError mensaje={error} />
            <Button type="submit" loading={ocupado}>{t("acceso.recuperar.boton")}</Button>
          </Stack>
        </form>
      )}
      <Anchor component="button" type="button" size="sm" onClick={() => ir("entrar")}>{t("acceso.irEntrar")}</Anchor>
    </Marco>
  );
}

export function Verificar({ usuario, alConfirmar }: { usuario: User; alConfirmar: () => void }) {
  const [aviso, setAviso] = useState<{ color: string; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function comprobar() {
    setOcupado(true);
    setAviso(null);
    try {
      await usuario.reload();
      if (usuario.emailVerified) return alConfirmar();
      setAviso({ color: "yellow", texto: t("acceso.verificar.aunNo") });
    } catch (err) {
      setAviso({ color: "red", texto: mensajeError(err) });
    }
    setOcupado(false);
  }

  async function reenviar() {
    setAviso(null);
    try {
      await sendEmailVerification(usuario, volverAqui());
      setAviso({ color: "green", texto: t("acceso.verificar.reenviado") });
    } catch (err) {
      setAviso({ color: "red", texto: mensajeError(err) });
    }
  }

  return (
    <Marco titulo={t("acceso.verificar.titulo")}>
      <Text size="sm">{t("acceso.verificar.texto", { correo: usuario.email ?? "" })}</Text>
      {aviso && <Alert variant="light" color={aviso.color}>{aviso.texto}</Alert>}
      <Button onClick={comprobar} loading={ocupado}>{t("acceso.verificar.hecho")}</Button>
      <Button variant="default" onClick={reenviar}>{t("acceso.verificar.reenviar")}</Button>
      <Anchor component="button" type="button" size="sm" onClick={salir}>{t("acceso.salir")}</Anchor>
    </Marco>
  );
}

export function NoAcceso({ correo }: { correo: string }) {
  return (
    <Marco titulo={t("acceso.noAcceso.titulo")}>
      <Text>{t("acceso.noAcceso.texto", { correo })}</Text>
      <Button variant="default" onClick={salir}>{t("acceso.salir")}</Button>
    </Marco>
  );
}
