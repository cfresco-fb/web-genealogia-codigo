import { lazy, Suspense, useEffect, useState } from "react";
import { Anchor, AppShell, Avatar, Burger, Button, Center, Divider, Group, Loader, Menu, NavLink, Text, TextInput, UnstyledButton } from "@mantine/core";
import { color } from "./tema/colores";
import { useDisclosure } from "@mantine/hooks";
import { Link, Route, Routes, useLocation, useNavigate } from "react-router";
import { usePreferencias } from "./acceso/preferencias";
import { useSesion } from "./acceso/sesion";
import { t, type Clave } from "./i18n";
import { Ajustes } from "./paginas/Ajustes";
import { Buscar } from "./paginas/Buscar";
import { EditarFamilia, NuevaFamilia } from "./paginas/EditarFamilia";
import { EditarPersona } from "./paginas/EditarPersona";
import { FichaFamilia } from "./paginas/FichaFamilia";
import { FichaPersona } from "./paginas/FichaPersona";
import { Grafico } from "./paginas/Grafico";
import { Inicio } from "./paginas/Inicio";
import { ListaEventos, ListaFamilias, ListaLugares, ListaMultimedia, ListaPersonas } from "./paginas/Listas";
import { DetalleSolicitud, Solicitudes } from "./paginas/Solicitudes";
import { DetalleCambio } from "./paginas/Cambios";
import { Administracion } from "./paginas/Administracion";
import { Privacidad } from "./paginas/Privacidad";
import { FichaLugar } from "./paginas/FichaLugar";
import { Calendario } from "./paginas/Calendario";

// Menú lateral en dos grupos (decisión del 24/10/2026, «Diseño visual»):
// arriba Inicio, Árbol y Buscar (y Solicitudes, paso 12, y Administración,
// paso 14, para el administrador y los revisores); debajo, con el rótulo
// «Listas», las cinco listas, el calendario (entre Familias y Eventos,
// 03/11/2026) y el mapa (detrás de «Lugares», 02/11/2026).
const MENU: [string, Clave][] = [
  ["/", "menu.inicio"],
  ["/arbol", "menu.arbol"],
  ["/buscar", "menu.buscar"],
  ["/solicitudes", "menu.solicitudes"],
];
const MENU_LISTAS: [string, Clave][] = [
  ["/personas", "menu.personas"],
  ["/familias", "menu.familias"],
  ["/calendario", "menu.calendario"],
  ["/eventos", "menu.eventos"],
  ["/lugares", "menu.lugares"],
  ["/mapa", "menu.mapa"],
  ["/multimedia", "menu.multimedia"],
];

// Créditos y licencias, aparte: con los textos de las licencias, solo se
// descarga al abrirla.
const Creditos = lazy(() => import("./paginas/Creditos").then((m) => ({ default: m.Creditos })));
// El mapa, con Leaflet, también aparte (docs/mapa.md).
const Mapa = lazy(() => import("./paginas/Mapa").then((m) => ({ default: m.Mapa })));

// Las listas ocupan el alto de la ventana; el mapa, no (debajo puede llevar
// la lista de lugares sin coordenadas), ni el calendario.
const LISTAS = MENU_LISTAS.map(([ruta]) => ruta).filter((ruta) => ruta !== "/mapa" && ruta !== "/calendario");
const ALTO_CABECERA = 60;

function Opcion({ ruta, clave, pathname }: { ruta: string; clave: Clave; pathname: string }) {
  const activa = ruta === "/" ? pathname === "/" : pathname.startsWith(ruta);
  return (
    <NavLink component={Link} to={ruta} label={t(clave)} active={activa} aria-current={activa ? "page" : undefined} />
  );
}

function BusquedaRapida() {
  const navegar = useNavigate();
  const [texto, setTexto] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        navegar(`/buscar?q=${encodeURIComponent(texto)}`);
        setTexto("");
      }}
    >
      <TextInput
        placeholder={t("menu.buscar")}
        value={texto}
        onChange={(e) => setTexto(e.currentTarget.value)}
        aria-label={t("menu.buscar")}
        w={{ base: 140, sm: 280 }}
      />
    </form>
  );
}

// La cuenta, junto a «Ajustes», como en otras webs (decisión del
// 28/10/2026): un botón con la inicial del correo que despliega el correo,
// el rol y «Salir».
function MenuCuenta() {
  const { usuario, invitacion, salir } = useSesion();
  const correo = usuario.email ?? invitacion.correo;
  return (
    <Menu position="bottom-end" width={260} withinPortal>
      <Menu.Target>
        <UnstyledButton aria-label={t("cuenta.boton")} title={correo} style={{ borderRadius: "50%" }}>
          <Avatar radius="xl" size={34} variant="light">{correo.charAt(0).toUpperCase()}</Avatar>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{t("cuenta.sesionCon")}</Menu.Label>
        <Text size="sm" px="sm" pb={4} fw={600} style={{ overflowWrap: "anywhere" }}>{correo}</Text>
        <Text size="sm" px="sm" pb="xs" c="dimmed">{t("ajustes.rol", { rol: t(`rol.${invitacion.rol}` as Clave) })}</Text>
        <Menu.Divider />
        {/* La nota de privacidad, aquí y no en Ajustes (31/10/2026). */}
        <Menu.Item component={Link} to="/privacidad">{t("privacidad.enlace")}</Menu.Item>
        <Menu.Item component={Link} to="/creditos">{t("cuenta.creditos")}</Menu.Item>
        <Menu.Item onClick={salir}>{t("acceso.salir")}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export function App() {
  const [abierto, { toggle, close }] = useDisclosure();
  const { pathname } = useLocation();
  const { nombreArbol } = usePreferencias();
  const { rol } = useSesion().invitacion;
  const revisa = rol === "administrador" || rol === "revisor";
  useEffect(close, [pathname]);
  // El nombre del árbol, en la cabecera y en la pestaña (decisión del
  // 23/10/2026; sin nombre, «Árbol familiar»).
  useEffect(() => {
    document.title = nombreArbol;
  }, [nombreArbol]);
  // Las listas y el árbol ocupan el alto de la ventana: la tabla tiene su
  // propia barra de desplazamiento y el árbol se desplaza por dentro.
  const esLista = LISTAS.includes(pathname) || pathname === "/arbol" || pathname.startsWith("/arbol/");

  return (
    <AppShell
      header={{ height: ALTO_CABECERA }}
      navbar={{ width: 216, breakpoint: "sm", collapsed: { mobile: !abierto } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" miw={0}>
            <Burger opened={abierto} onClick={toggle} hiddenFrom="sm" size="sm" aria-label={t("app.menu")} />
            <Anchor component={Link} to="/" underline="never" visibleFrom="xs" className="tema-nombre-arbol" lineClamp={1}>
              {nombreArbol}
            </Anchor>
          </Group>
          <Group gap="sm" wrap="nowrap">
            <BusquedaRapida />
            <Button component={Link} to="/ajustes" variant={pathname === "/ajustes" ? "light" : "default"} size="sm" px="sm">
              {t("ajustes.boton")}
            </Button>
            <MenuCuenta />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm" component="nav" aria-label={t("app.menu")}>
        {MENU.map(([ruta, clave]) => <Opcion key={ruta} ruta={ruta} clave={clave} pathname={pathname} />)}
        {revisa && <Opcion ruta="/administracion" clave="menu.administracion" pathname={pathname} />}
        {/* Las listas, separadas solo por una línea fina (decisión del
            29/10/2026); el rótulo «Listas», solo para los lectores de
            pantalla. */}
        <Divider my="sm" color={color("linea")} />
        <div role="group" aria-label={t("menu.listas")}>
          {MENU_LISTAS.map(([ruta, clave]) => <Opcion key={ruta} ruta={ruta} clave={clave} pathname={pathname} />)}
        </div>
      </AppShell.Navbar>

      <AppShell.Main
        // Menos la barra de los emuladores, si la hay (tema.css).
        style={esLista ? { height: "calc(100dvh - var(--alto-aviso-emulador, 0px))", minHeight: 0, display: "flex", flexDirection: "column" } : undefined}
      >
        <div style={esLista ? { flex: 1, minHeight: 0 } : undefined}>
          <Routes>
            <Route path="/" element={<Inicio />} />
            <Route path="/personas" element={<ListaPersonas />} />
            <Route path="/familias" element={<ListaFamilias />} />
            <Route path="/calendario" element={<Calendario />} />
            <Route path="/eventos" element={<ListaEventos />} />
            <Route path="/lugares" element={<ListaLugares />} />
            <Route path="/mapa" element={<Suspense fallback={<Center p="xl"><Loader /></Center>}><Mapa /></Suspense>} />
            <Route path="/multimedia" element={<ListaMultimedia />} />
            <Route path="/buscar" element={<Buscar />} />
            <Route path="/persona/:handle" element={<FichaPersona />} />
            <Route path="/persona/:handle/editar" element={<EditarPersona />} />
            <Route path="/familia/:handle" element={<FichaFamilia />} />
            <Route path="/familia/nueva" element={<NuevaFamilia />} />
            <Route path="/familia/:handle/editar" element={<EditarFamilia />} />
            <Route path="/lugar/:handle" element={<FichaLugar />} />
            <Route path="/arbol" element={<Grafico />} />
            <Route path="/arbol/:handle" element={<Grafico />} />
            <Route path="/ajustes" element={<Ajustes />} />
            <Route path="/privacidad" element={<Privacidad />} />
            <Route path="/creditos" element={<Suspense fallback={<Center p="xl"><Loader /></Center>}><Creditos /></Suspense>} />
            <Route path="/administracion" element={<Administracion />} />
            <Route path="/solicitudes" element={<Solicitudes />} />
            <Route path="/solicitudes/:id" element={<DetalleSolicitud />} />
            <Route path="/cambios/:id" element={<DetalleCambio />} />
            <Route path="*" element={<Text>{t("app.noEncontrado")}</Text>} />
          </Routes>
        </div>
      </AppShell.Main>
    </AppShell>
  );
}
