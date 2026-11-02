# Código procedente de Gramps Connect

Origen: https://github.com/dsblank/gramps-connect. Commits:

- `e00c51750ad1fdf955dc4bf4f88691cfffed2e86` (20/10/2026): `gramps-date/`
  y `tabla/`.
- `884ad355a5e02910f40bdba23a475d9dd58a3921` (21/10/2026): `graficos/` y
  `chartExport/`.
- `948731405185a1b6419ceeab174996a37ce927d5` (23/10/2026): `formularios/`
  (copiado el 25/10/2026).

Licencia: AGPL-3.0-or-later (la misma que este proyecto; texto completo
en `LICENSE`, en la raíz). Los avisos de autoría y licencia originales se
conservan en la cabecera de cada fichero. Los ficheros de Gramps Connect
que no traen cabecera la llevan aquí con el origen, el commit y, si se han
modificado, la fecha y el resumen de los cambios.

## `gramps-date/`

Copia de `packages/gramps-date/src/` (sin `__tests__/`) y su `README.md`.
Es la traducción a TypeScript del modelo de fechas de Gramps y de su
presentación en todos los idiomas de Gramps (GPL-2.0-or-later en origen,
combinable con AGPL-3.0; ver el README).

- Dependencias: ninguna. Solo usa TypeScript.
- Modificaciones: **ninguna**. Para actualizarla, volver a copiar la
  carpeta `src/` de Gramps Connect.
- Los idiomas se cargan bajo demanda (`loadLocale("es")`), cada uno en su
  propio fragmento del paquete; los que no se usan no se descargan.

## `tabla/`

`DataTable.tsx` y `DataTable.module.css`, de `app/src/components/`: la
tabla virtualizada de los listados.

- Dependencias del original: `@mantine/core` (Tooltip),
  `@tanstack/react-virtual` y, sobre todo, la capa de datos de Gramps
  Connect: `store/viewStore.ts`, `store/views.ts`, `store/registry.ts`,
  `store/placeIndex.ts`, `hooks/useViewStore.ts` e `i18n/i18n.ts`
  (unas 2.700 líneas más, que arrastran sql.js, OPFS, la autenticación y
  las llamadas a gramps-web-api). Esa capa no se copia.
- **Modificado** (21/10/2026), como permite la AGPL, para trabajar con
  datos en memoria:
  - recibe filas y columnas por propiedades en lugar de leerlas de un
    `ViewStore`; ordenación y filtrado los hace quien la usa;
  - sin selección múltiple (Ctrl/Mayús + clic) ni su aviso emergente:
    un clic en una fila abre la ficha;
  - textos a través del módulo de traducciones de esta web;
  - anchos de columna guardados en `localStorage` aquí mismo;
  - colores del tema de Mantine estándar en lugar de los propios de
    Gramps Connect (`grampsBlue`, `selection`); desde el 24/10/2026
    («Diseño visual»), los del tema de la web (`--tema-…`, en los dos
    modos), filas de 34 px y letra de 15 px (cabecera, 14).

## `graficos/`

Gráfico de árbol (ascendientes y descendientes alrededor de una persona),
de `app/src/charts/` y `app/src/components/visuals/`:

| Aquí | Original |
|---|---|
| `charts/treeChart.ts` | `app/src/charts/treeChart.ts` |
| `charts/genderColors.ts` | `app/src/charts/genderColors.ts` |
| `visuals/TreeChart.tsx` | `app/src/components/visuals/TreeChart.tsx` |

- Dependencias: `d3-hierarchy`, `d3-selection`, `d3-shape`,
  `d3-transition` y `d3-zoom` (las mismas versiones que Gramps Connect;
  `d3-array`, que también tenía, no se usa y se quitó el 29/10/2026), `@mantine/core` (`useComputedColorScheme`). El
  original depende además de su capa de datos: `store/treeData.ts` (la
  forma `TreeNode`, la descarga de personas de gramps-web-api por
  generaciones y las miniaturas con token), `store/apiImage.ts`,
  `store/lifeEventDates.ts`, `store/placeIndex.ts` y
  `store/treeExpandPreference.ts`. Nada de eso se copia: los datos los
  prepara `app/src/arbol/grafico.ts` desde la instantánea en memoria.
- `genderColors.ts`: **modificado** (24/10/2026, «Diseño visual»): los
  colores salen del tema de la web como variables CSS (sin la pareja fija
  por modo ni el parámetro `dark`), y el sexo desconocido u otro lleva
  franja gris.
- `treeChart.ts` y `TreeChart.tsx`: **modificados** (22/10/2026):
  - `TreeNode` propio, con los textos ya preparados y traducidos
    (`TreePerson`, `TreeFamily`), en lugar de las personas de
    gramps-web-api;
  - del lado de descendientes, como en Gramps (23/10/2026), los cónyuges
    en su propia caja a los dos lados de la persona (también «Cónyuge
    desconocido», con borde discontinuo) y, entre la persona y cada
    cónyuge, un óvalo con la fecha y el lugar de la boda, con los hijos de
    esa pareja debajo; las líneas van de la persona y del cónyuge al óvalo
    y del óvalo a cada hijo. Desde el 24/10/2026, el óvalo recibe sus
    líneas ya preparadas (`TreeFamily.lines`: boda, «Pareja», «div. …»,
    «sep. …») y crece en alto con más de dos (y con él, su generación,
    `ovalRows`); los padres sin relación de pareja (`noUnion`), sin óvalo:
    un punto con el texto al lado. El cónyuge desconocido, en una caja de
    fondo gris claro (sin borde discontinuo, que queda para las personas
    repetidas); `layoutHalf` calcula cajas, óvalos y líneas
    sin dibujar, con un trazado propio por perfiles (en lugar de `tree()`
    de d3-hierarchy, que centra cada nodo sobre sus hijos y no permite
    fijar los óvalos bajo cada pareja);
  - el nombre, en dos líneas (tres en horizontal con foto, `fitName`; el
    hueco de la tercera, solo en las columnas con alguna foto);
  - dos disposiciones (`ChartLayout`): vertical (por defecto), con los
    ascendientes arriba y los descendientes abajo, y horizontal, con los
    ascendientes a la izquierda y los descendientes a la derecha (el
    original solo tiene la horizontal, con los ascendientes a la derecha);
    la persona central siempre en (0, 0), las dos mitades dibujadas en el
    mismo sistema de coordenadas (en el original, cada mitad con su
    desplazamiento y la vista centrada en la media de las dos raíces); el
    `TreeChart.tsx` recibe la disposición (`layout`) y vuelve a centrar la
    vista al cambiarla;
  - sin ampliación perezosa por ramas ni su observador de visibilidad: la
    marca «+» solo indica que hay más generaciones, y pulsarla centra el
    árbol en esa persona;
  - pulsar una caja centra el árbol en esa persona (en el original, la
    selecciona y abre una tarjeta); botón de ficha en cada caja;
  - personas repetidas en el mismo árbol, con borde discontinuo;
  - fotos de Storage (`fillThumbnails`), recortadas en el navegador según
    el recorte de la referencia, y algo más pequeñas (60 en lugar de 70);
    en vertical, arriba y centradas, con el texto debajo (23/10/2026); sin
    recorte, las fotos verticales cubren el cuadro ancladas arriba (en el
    original, centradas; 29/10/2026);
  - textos recortados midiéndolos en el navegador (`fitTexts`), con
    versión corta de las fechas, en lugar de estimar el ancho por letra;
    las cuatro líneas de la caja salen siempre: si falta el nombre de pila
    o los apellidos, el rótulo de que falta («[sin nombre de pila]»; en el
    original, «…», que parece un texto cortado), y las fechas con «sin
    datos»; los textos fijos llegan traducidos (`TreeChartLabels`);
  - las letras del PDF (Noto Sans y, para los símbolos y el hebreo, las de
    `app/src/fuentes/`) también en pantalla, para que lo que cabe en
    pantalla quepa igual en el papel;
  - ampliación inicial menor en pantallas estrechas, doble clic sin
    ampliar, límites de ampliación, `touch-action: none` (gestos con los
    dedos en el móvil) y `zoomBy`/`fitAll` para los botones de ampliar,
    reducir y ver todo;
  - cajas como en Gramps (23/10/2026): fecha y lugar de nacimiento y de
    defunción (`TreeLine`: si no cabe, `fitTexts` recorta el lugar y, si ni
    así, deja la fecha sin el lugar o pasa al año), el ID de Gramps junto
    al nombre (`grampsId`, solo para el administrador; `fitTexts` no lo
    recorta, `data-suffix`) y el nombre como «Apellidos, Nombre» en hasta
    dos líneas (`fitName`); en vertical, el hueco de la foto solo en las
    filas con alguna foto (`photoRows`; cajas de 190 × 146 o 190 × 84);
  - `measureTreeChart`: tamaño del árbol sin dibujarlo (con su
    disposición y su esquina), para repartirlo en páginas del PDF antes de
    dibujarlo; `treeChartShapes`: las cajas y puntos de las líneas, para
    saber qué hojas de un mosaico quedarían en blanco;
  - «continúa en la pág. N» junto a las cajas del borde (`continuation`),
    para los PDF de varias páginas; `fillThumbnails` devuelve una promesa
    que se cumple cuando han llegado todas las fotos;
  - la línea de defunción solo sale si hay dato; los símbolos de las fechas
    llegan ya puestos en el texto;
  - aspecto de la web (24/10/2026, «Diseño visual»; `docs/graficos.md`,
    «Aspecto»): todos los colores son variables del tema (`--tema-…`), sin
    el parámetro `dark` ni volver a dibujar al cambiar de modo; franja del
    sexo de 6 px por dentro de la caja (en el original, una píldora que
    asoma por la izquierda); persona central con borde teja y sombra;
    esquinas de 10; líneas de 1,5 px; datos a 12;
  - cajas pequeñas para el PDF (25/10/2026; `compact` en
    `renderTreeChart`, `measureTreeChart` y `treeChartShapes`): medidas de
    cajas, óvalos y huecos entre generaciones en un objeto (`Medidas`,
    normales o pequeñas) que fijan esas funciones mientras trabajan
    (`conMedidas`), y líneas más juntas en las cajas pequeñas;
  - apodo en su propia línea (27/10/2026; `TreePerson.nick`): las filas
    con algún apodo (`chartRows`, junto con las de foto) llevan cajas una
    línea más altas; en horizontal, si hay alguno, todas;
  - ID en su propia línea, bajo el apodo (30/10/2026; `TreePerson.idLine`,
    en los PDF con «Incluir identificadores»): las líneas bajo el nombre se
    cuentan por fila (`extraDepths`, `extraRows`), y cada una hace la caja
    una línea más alta.

## `chartExport/`

Exportación de gráficos, de `app/src/store/chartExport/`
(`exportChart.ts`, `paperSizes.ts`, `pdfFonts.ts`, `prepareSvg.ts`), y
las fuentes de `app/src/assets/fonts/` en `fuentes/` (Noto Sans recortada,
licencia SIL Open Font License 1.1, texto en `fuentes/OFL.txt`).

- Dependencias: `jspdf` 4.2.1 y `svg2pdf.js` 2.8.1 (cargadas solo al
  exportar). El original usa además `store/apiFetch.ts` y
  `store/downloadFile.ts`; su diálogo, `components/visuals/
  ChartExportDialog.tsx` (PNG, JPEG, SVG y PDF con muchas opciones), no
  se copia: esta web tiene el suyo, más sencillo y solo para PDF
  (`app/src/componentes/ExportarPdf.tsx`).
- **Modificados** (22/10/2026):
  - `exportChart.ts`: título y subtítulo encima del gráfico en el PDF y
    propiedades del documento; la descarga del fichero, aquí mismo; y
    exportadas algunas piezas internas (`rasterize`, `saveBlob`,
    `adaptForSvg2pdf`, `withAttached`, `chartText`, `PDF_IMAGE_DPI`) para
    los PDF de varias páginas y en mosaico, que hace esta web en
    `app/src/componentes/pdfArbol.ts`.
  - `paperSizes.ts`: hueco para el título (`headerMm`); la orientación
    automática elige la que deja el gráfico más grande (en el original,
    la que coincide con la forma del gráfico).
  - `prepareSvg.ts`: las imágenes se leen con `fetch` (direcciones
    `blob:` de Storage) y las que aún no han llegado se quitan.
    Desde el 26/10/2026 se reducen a 600 píxeles por el lado mayor y
    en JPEG: svg2pdf desbordaba la pila con fotos de unos 7 MB.
  - `pdfFonts.ts`: rutas de las fuentes; `loadBrowserFonts` (la misma
    letra en pantalla); y rangos de caracteres corregidos. Los del
    original incluyen bloques que los ficheros recortados no tienen
    (flechas, signo menos, círculos numerados, formas geométricas,
    símbolos varios como ⚭ o ⚰): con ellos, un texto con esos caracteres
    saldría en el PDF como cuadraditos en lugar de pasar a imagen. Los
    rangos nuevos se leyeron de la tabla `cmap` de las fuentes.


## `formularios/`

Piezas de los formularios de edición (fase 3), de `app/src/components/`,
sin cabecera de autoría ni de licencia en el original. Cada una lleva en
la suya el origen, el commit, la licencia y la fecha de la modificación
(añadidos el 01/11/2026, sección 5a de la AGPL). Inventario y
propuesta pieza a pieza en `docs/inventario-formularios.md`.

| Aquí | Original |
|---|---|
| `DateInput.tsx` | `app/src/components/DateInput.tsx` |
| `RecordPicker.tsx` | `app/src/components/RecordPicker.tsx` |

- **Modificados** (25/10/2026):
  - `DateInput.tsx`: el campo rápido muestra la fecha en el formato de la
    web (`textoFecha`) y la lee con `leerFecha` (`app/src/arbol/
    leerFecha.ts`, nuevo), que acepta además el formato numérico de la
    región y el de Gramps; si el texto no ha cambiado, no se vuelve a leer.
    Sin selector de calendario (se conserva el de la fecha y se dice cuál
    es), sin calendarios lunares ni consultas al servidor, sin año nuevo a
    la vista (se conserva); el interruptor de fecha doble solo si la fecha
    ya lo es, y una fecha doble nueva da un aviso (decisión del
    24/10/2026). La fecha vacía es la de Gramps (no null) y todas llevan
    los campos de la plantilla de Gramps (`format`). Textos por `t()`,
    iconos propios en lugar de `CircleGlyphButton`, colores del tema y, en
    el móvil, el diálogo a pantalla completa.
  - `RecordPicker.tsx`: busca en el árbol en memoria (`Arbol.buscar`) en
    lugar de pedir páginas a gramps-web-api; el rótulo lo da quien lo usa;
    sin «crear nuevo» ni botón de confirmar; el ID, solo para el
    administrador; textos por `t()`; `excluir` (25/10/2026) quita
    resultados (en «situado en», el propio lugar y los que contiene).
- **Escrito nuevo mirando el original** (27/10/2026), fuera de esta
  carpeta y sin su código: el editor de nombre
  (`app/src/componentes/EditorNombre.tsx`), con los campos de
  `app/src/components/NameEditDialog.tsx`; y la lista común de los
  formularios (`app/src/componentes/ListaEditable.tsx`), con la idea de
  `EmbeddedListFields.tsx`.
