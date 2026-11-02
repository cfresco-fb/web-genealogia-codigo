# Árbol Frescó-Werchowsky: código fuente de la web

Código fuente de la web colaborativa del árbol familiar Frescó-Werchowsky
(https://arbol.freswer.org), una web para consultar y editar entre
familiares un árbol genealógico guardado en el formato de Gramps, sobre
Firebase (Authentication, Firestore, Storage, Functions y Hosting).

Se publica porque la licencia AGPL-3.0 obliga a ofrecer el código fuente a
quien usa la web a través de internet.

## Qué hay aquí

- **Una copia automática**, no un proyecto abierto a colaboraciones. Cada
  versión desplegada en la web se publica aquí con su etiqueta
  (`vAAAA.MM.DD-N`); la página «Créditos y licencias» de la web enlaza a la
  de la versión que está funcionando. No se edita a mano: el desarrollo se
  hace en otro repositorio, que no es público.
- **Sin datos**: el árbol, las fotos y las cuentas de la familia no forman
  parte del código y no se publican. Las pruebas usan el árbol de ejemplo
  oficial de Gramps (`example.gramps`) y datos inventados.
- **Sin secretos**: las contraseñas y los permisos de los servicios están
  fuera del código. Las claves que aparecen (la configuración de Firebase de
  la web y la clave de sitio de reCAPTCHA) no son secretas: van en la web
  que descarga cualquier navegador.
- No incluye la documentación interna del proyecto, por eso algunos
  comentarios citan ficheros de `docs/` que no están.

| Carpeta | Contenido |
|---|---|
| `app/` | La web (Vite, React, TypeScript, Mantine) |
| `functions/` | Funciones de Firebase: guardado de los cambios con sus permisos, solicitudes, instantánea, avisos y copias |
| `comun/` | Código común de la web, las funciones y los programas |
| `firestore/` | Programas de carga, descarga, invitaciones y mantenimiento, y lanzador de los emuladores de las pruebas |
| `migracion/` | Conversión entre Gramps y el JSON de la web (Python, con la biblioteca de Gramps) y generadores de ficheros que usa la web |
| `reglas/` | Pruebas de las reglas de seguridad |
| `scripts/` | Generadores de los iconos y de la lista de bibliotecas de los créditos |
| `docs/iconos/` | Dibujos originales de los iconos |

## Compilar y probar

Hace falta Node 24, Java 21 (para los emuladores de Firebase) y, para las
pruebas del servidor y los generadores, Python 3.11 con
`migracion/requirements.txt`.

```
npm ci
npm run tipos
npm run lint
npm run pruebas                # web
npm run pruebas-comun          # código común
npm run pruebas-reglas         # reglas, con los emuladores
npm run pruebas-servidor       # funciones, con los emuladores
npm run compilar-web
```

## Procedencia y licencias

- **Licencia: AGPL-3.0-or-later** (texto completo en `LICENSE`).
- Partes de la web proceden de [Gramps Connect](https://github.com/dsblank/gramps-connect)
  (AGPL-3.0-or-later), copiadas y adaptadas: el modelo de fechas, la tabla
  de los listados, el gráfico del árbol, su exportación a PDF y piezas de
  los formularios. Origen, commits y cambios en
  `app/src/gramps-connect/ORIGEN.md`; cada fichero modificado lo indica en
  su cabecera.
- De [Gramps](https://gramps-project.org) (GPL-2.0-or-later) vienen el
  formato de los datos, las plantillas y esquemas de los objetos, los
  nombres de los tipos de sus traducciones oficiales y el algoritmo de
  quién se considera vivo.
- Letras Literata, Noto Sans, Noto Sans Hebrew, Noto Serif Hebrew y Noto
  Sans Symbols: SIL Open Font License 1.1.
- Las bibliotecas que lleva la web, con sus licencias, en
  `app/src/creditos/bibliotecas.json` (se ven en la página de créditos de
  la web).
