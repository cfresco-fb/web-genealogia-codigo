// Sesión y acceso por invitación (docs/acceso.md).
//
// La web solo enseña el árbol a quien tiene sesión, un correo verificado y
// una invitación activa para ese correo. Las reglas de seguridad comprueban
// lo mismo en cada petición: esto es solo para mostrar la pantalla que
// corresponde, no la protección en sí.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Center, Group, Loader, Stack, Text } from "@mantine/core";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore/lite";
import { auth, db, olvidarMultimedia, salir } from "../firebase";
import { t } from "../i18n";
import { NoAcceso, PantallasEntrada, Verificar } from "./Pantallas";

export type Rol = "administrador" | "revisor" | "familiar";

export interface Invitacion {
  correo: string;
  /** Handle de la persona del árbol vinculada. */
  persona: string;
  rol: Rol;
}

export interface Sesion {
  usuario: User;
  invitacion: Invitacion;
  salir: () => Promise<void>;
}

type Estado =
  | { tipo: "cargando" }
  | { tipo: "sinSesion" }
  | { tipo: "sinVerificar"; usuario: User }
  | { tipo: "sinAcceso"; usuario: User }
  | { tipo: "error"; usuario: User; mensaje: string }
  | { tipo: "dentro"; usuario: User; invitacion: Invitacion };

const Contexto = createContext<Sesion | null>(null);

async function comprobarAcceso(usuario: User): Promise<Estado> {
  if (!usuario.emailVerified || !usuario.email) return { tipo: "sinVerificar", usuario };
  // Tras confirmar el correo, el token guardado puede seguir diciendo
  // email_verified = false hasta que se renueva; las reglas lo leen del token.
  const token = await usuario.getIdTokenResult();
  if (token.claims.email_verified !== true) await usuario.getIdToken(true);
  try {
    const inv = await getDoc(doc(db, "invitaciones", usuario.email.toLowerCase()));
    const datos = inv.data();
    if (!inv.exists() || datos?.estado !== "activa") return { tipo: "sinAcceso", usuario };
    return { tipo: "dentro", usuario, invitacion: { correo: datos.correo, persona: datos.persona, rol: datos.rol } };
  } catch (e) {
    if ((e as { code?: string }).code === "permission-denied") return { tipo: "sinAcceso", usuario };
    return { tipo: "error", usuario, mensaje: e instanceof Error ? e.message : String(e) };
  }
}

function Esperando() {
  return (
    <Center h="100dvh">
      <Stack align="center">
        <Loader />
        <Text>{t("acceso.comprobando")}</Text>
      </Stack>
    </Center>
  );
}

export function ProveedorAcceso({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  // Solo vale la comprobación más reciente (pueden solaparse).
  const turno = useRef(0);

  const revisar = useCallback(async (usuario: User | null) => {
    const mio = ++turno.current;
    if (!usuario) {
      olvidarMultimedia();
      setEstado({ tipo: "sinSesion" });
      return;
    }
    setEstado({ tipo: "cargando" });
    const nuevo = await comprobarAcceso(usuario);
    if (mio === turno.current) setEstado(nuevo);
  }, []);

  useEffect(() => onAuthStateChanged(auth, revisar), [revisar]);

  switch (estado.tipo) {
    case "cargando":
      return <Esperando />;
    case "sinSesion":
      return <PantallasEntrada />;
    case "sinVerificar":
      return <Verificar usuario={estado.usuario} alConfirmar={() => revisar(auth.currentUser)} />;
    case "sinAcceso":
      return <NoAcceso correo={estado.usuario.email ?? ""} />;
    case "error":
      return (
        <Center h="100dvh" p="md">
          <Alert color="red" title={t("acceso.error.comprobar")} maw={480}>
            <Stack>
              <Text size="sm" ff="monospace">{estado.mensaje}</Text>
              <Group>
                <Button onClick={() => revisar(estado.usuario)}>{t("acceso.reintentar")}</Button>
                <Button variant="default" onClick={salir}>{t("acceso.salir")}</Button>
              </Group>
            </Stack>
          </Alert>
        </Center>
      );
    case "dentro":
      return (
        <Contexto.Provider value={{ usuario: estado.usuario, invitacion: estado.invitacion, salir }}>
          {children}
        </Contexto.Provider>
      );
  }
}

export function useSesion(): Sesion {
  const s = useContext(Contexto);
  if (!s) throw new Error("useSesion() fuera de ProveedorAcceso");
  return s;
}
