"""Compara objeto a objeto dos JSON de la web (por ejemplo, el original y
el reconstruido desde Firestore). La comparación es estricta: incluye la
marca «change» y distingue tipos (1 ≠ 1.0 ≠ true). Termina con código 0 si
son idénticos y 1 si no.

Uso:
    python comparar_json.py ..\\datos\\salida\\arbol.json ..\\datos\\salida\\arbol-firestore.json
"""
import argparse
import json
import sys

from comprobar_ida_vuelta import diferencias

TIPOS = ["Tag", "Note", "Repository", "Source", "Citation",
         "Media", "Place", "Event", "Person", "Family"]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("original")
    ap.add_argument("copia")
    args = ap.parse_args()

    with open(args.original, encoding="utf-8") as f:
        a = json.load(f)
    with open(args.copia, encoding="utf-8") as f:
        b = json.load(f)

    ok = True
    # base_multimedia es una carpeta del PC: no se guarda en Firestore
    # (30/10/2026), así que la copia descargada no la trae.
    for k in sorted((set(a) | set(b)) - {"objetos", "base_multimedia"}):
        if a.get(k) != b.get(k):
            ok = False
            print(f"  DIFERENCIA en la cabecera «{k}»: {a.get(k)!r} ≠ {b.get(k)!r}")
    otros = (set(a["objetos"]) | set(b["objetos"])) - set(TIPOS)
    if otros:
        ok = False
        print(f"  Tipos no reconocidos: {', '.join(sorted(otros))}")

    print(f"\n{'Tipo':<12}{'Original':>10}{'Copia':>10}{'Distintos':>11}")
    for tipo in TIPOS:
        x = {d["handle"]: d for d in a["objetos"].get(tipo, [])}
        y = {d["handle"]: d for d in b["objetos"].get(tipo, [])}
        # diferencias() y no «!=»: en Python 1 == 1.0 == True.
        distintos = [h for h in x if diferencias(x[h], y.get(h))] + [h for h in y if h not in x]
        print(f"{tipo:<12}{len(x):>10}{len(y):>10}{len(distintos):>11}")
        for h in distintos[:3]:
            print(f"    {tipo} {x.get(h, y.get(h, {})).get('gramps_id', h)}: "
                  f"{', '.join(diferencias(x.get(h), y.get(h))[:5])}")
        if distintos:
            ok = False

    print("\nRESULTADO:", "objetos IDÉNTICOS" if ok else "HAY DIFERENCIAS (ver arriba)")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
