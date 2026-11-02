# Letras de símbolos y hebrea

(Las letras de la interfaz, Noto Sans, Noto Sans Hebrew, Literata y Noto
Serif Hebrew, no están aquí: vienen de los paquetes `@fontsource/…` de
`app/package.json`, versión 5.3.0, y Vite las sirve con la web, sin pedir
nada a Google; decisión del 24/10/2026, «Diseño visual». Licencia SIL
Open Font License 1.1, como estas. Solo se usan en pantalla: los PDF
siguen con las de aquí y las de `chartExport/fuentes/`.)

Para que los símbolos de nacimiento y defunción que no tiene Noto Sans (la
letra principal del PDF, en `../gramps-connect/chartExport/fuentes/`)
sigan siendo texto en el PDF: ✡, ✝, ⚭, ⚰, ♂, ♀, estrellas, círculos…
Decisión de Carlos del 22/10/2026. Uso: `simbolos.ts`.

| Fichero | Origen | Caracteres |
|---|---|---|
| `NotoSansSymbols-subset.ttf` (34 KB) | Noto Sans Symbols, `ofl/notosanssymbols/NotoSansSymbols[wght].ttf` | 180 |
| `NotoSansSymbols2-subset.ttf` (89 KB) | Noto Sans Symbols 2, `ofl/notosanssymbols2/NotoSansSymbols2-Regular.ttf` | 601 |
| `NotoSansHebrew-Regular-subset.ttf` (14 KB) | Noto Sans Hebrew, `ofl/notosanshebrew/NotoSansHebrew[wdth,wght].ttf`, peso 400 | 189 |
| `NotoSansHebrew-Bold-subset.ttf` (14 KB) | la misma, peso 700 | 189 |

- De https://github.com/google/fonts, commit
  `45e3d5269e4a17d823f6d84470bc084dc5ae46f6` (22/10/2026).
- Licencia: SIL Open Font License 1.1 (`OFL.txt`; la misma para las dos).
  Copyright 2022 The Noto Project Authors.
- Cómo se han hecho, con fontTools 4.60.1:

  ```
  fonttools varLib.instancer "NotoSansSymbols[wght].ttf" wght=400 -o NotoSansSymbols-400.ttf
  pyftsubset NotoSansSymbols-400.ttf --unicodes="U+2190-21FF,U+2600-26FF,U+2700-27BF" --layout-features="" --no-hinting --output-file=NotoSansSymbols-subset.ttf
  pyftsubset NotoSansSymbols2-Regular.ttf --unicodes="U+2190-21FF,U+2200-22FF,U+25A0-25FF,U+2600-26FF,U+2700-27BF,U+2B00-2BFF" --layout-features="" --no-hinting --output-file=NotoSansSymbols2-subset.ttf
  ```

  La primera es una fuente variable: se saca la versión de peso normal
  (400), porque jsPDF no trabaja con fuentes variables.
- Si se vuelven a hacer, hay que poner al día los rangos de `RANGOS` en
  `simbolos.ts` (los caracteres que tiene de verdad cada fichero, de su
  tabla cmap).

## Hebrea

Decisión de Carlos del 22/10/2026: en el árbol real hay hebreo. Con ella,
el hebreo sale como texto en el PDF (antes, «?» en el libro y la página
del árbol como imagen).

- De https://github.com/google/fonts, commit
  `8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5` (12/3/2026). Licencia: SIL
  Open Font License 1.1 (`OFL-hebrew.txt`; el mismo texto que `OFL.txt`
  con el copyright de la letra hebrea, 2022 The Noto Project Authors).
- Es una fuente variable (peso y anchura): se sacan dos estáticas, normal
  (400) y negrita (700), con la anchura normal (100), y se recortan al
  hebreo (letras, signos y formas de presentación) más los espacios, cifras
  y signos de puntuación corrientes, para que un tramo en hebreo con
  espacios o cifras vaya entero con la misma letra. Con fontTools 4.60.1:

  ```
  fonttools varLib.instancer "NotoSansHebrew[wdth,wght].ttf" wght=400 wdth=100 -o NotoSansHebrew-400.ttf
  fonttools varLib.instancer "NotoSansHebrew[wdth,wght].ttf" wght=700 wdth=100 -o NotoSansHebrew-700.ttf
  pyftsubset NotoSansHebrew-400.ttf --unicodes="U+0020-0040,U+005B-0060,U+007B-007E,U+00A0,U+0591-05C7,U+05D0-05EA,U+05EF-05F4,U+2010-2014,U+2018-201E,U+2026,U+20AA,U+FB1D-FB4F" --layout-features="" --no-hinting --output-file=NotoSansHebrew-Regular-subset.ttf
  ```

  (y lo mismo con la de 700 para `NotoSansHebrew-Bold-subset.ttf`).
- jsPDF no aplica las reglas de colocación de la letra: los signos
  vocálicos (niqud) pueden quedar algo desplazados. El hebreo sin niqud,
  el habitual, sale bien.
