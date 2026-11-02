/// <reference types="vite/client" />

/** La versión del código compilado (app/vite.config.ts). */
declare const __VERSION_CODIGO__: { commit: string; fecha: string; cambios: boolean; etiqueta: string };

/** Con qué proyecto trabaja la web: los emuladores o el real
 * (app/vite.config.ts). */
declare const __DESTINO__: "pruebas" | "produccion";
