import "@mantine/core/styles.css";
// Letras servidas desde la propia web, no desde Google Fonts (decisión del
// 24/10/2026, «Diseño visual»): Noto Sans para el texto y Literata para los
// títulos, con las hebreas de reserva.
import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/600.css";
import "@fontsource/noto-sans-hebrew/400.css";
import "@fontsource/noto-sans-hebrew/600.css";
import "@fontsource/literata/600.css";
import "@fontsource/noto-serif-hebrew/600.css";
import "./tema/tema.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { createBrowserRouter, RouterProvider } from "react-router";
import { App } from "./App";
import { ProveedorPreferencias } from "./acceso/preferencias";
import { ProveedorAcceso } from "./acceso/sesion";
import { ProveedorArbol } from "./arbol/contexto";
import { resolverVariables, tema } from "./tema/tema";

// Enrutador «de datos» de React Router, con una sola ruta que lo abarca todo
// (las rutas de verdad, con <Routes> en App): hace falta para useBlocker,
// el aviso al salir de un formulario con cambios sin guardar (paso 10).
const enrutador = createBrowserRouter([{
  path: "*",
  element: (
    <ProveedorAcceso>
      <ProveedorArbol>
        <ProveedorPreferencias>
          <App />
        </ProveedorPreferencias>
      </ProveedorArbol>
    </ProveedorAcceso>
  ),
}]);

// Modo de color: el del ordenador o el móvil hasta leer las preferencias
// del usuario, que pueden fijarlo en claro u oscuro (ProveedorPreferencias).
createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <MantineProvider theme={tema} cssVariablesResolver={resolverVariables} defaultColorScheme="auto">
      <RouterProvider router={enrutador} />
    </MantineProvider>
  </StrictMode>,
);
