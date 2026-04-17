import openpyxl
from collections import defaultdict

wb = openpyxl.load_workbook(
    r'C:/Users/Goncalo.Barata/Desktop/App stocks/reference/Report diário produção.xlsm',
    read_only=True, data_only=True, keep_links=False)

ws = wb['MCF data']

# Header at R16, data starts R17
# Key columns (0-indexed):
#   24 (Y) = Linha produção (code like 01.1, 02.1, 03.1)
#   25 (Z) = Produto final (SKU like 1200x95x18)
#    6 (G) = Linha_aux (descriptive name)
#    8 (I) = Tipo produto (T=tábua, B=barrote, etc.)

line_codes = {
    '01.1': 'Linha principal',
    '01.2': 'Madeira de 2ª',
    '02.1': 'Charriot [B]',
    '02.2': 'Charriot [Tábuas]',
    '02.3': 'Charriot [Duplos]',
    '03.1': 'Aproveitamentos L01',
    '03.2': 'Aproveitamentos L02',
    '04':   'Linha PSY',
    '04.1': 'Linha PSY (retestadeira peq)',
    '04.2': 'Linha PSY (retestadeira grd)',
    '05':   'Traçador manual MCF',
}

# Collect unique products per line code
produtos_por_linha = defaultdict(lambda: defaultdict(int))  # code -> produto -> count
tipo_por_linha = defaultdict(set)

for row in ws.iter_rows(min_row=17, values_only=True):
    code = row[24]  # col Y (Linha produção)
    produto = row[25]  # col Z (Produto final)
    tipo = row[8]  # col I (Tipo produto)

    if not code or not produto:
        continue
    code = str(code).strip()
    produto = str(produto).strip()

    # Normalize code: 03.1.1, 03.1.2 -> 03.1; 03.2.1, 03.2.2 -> 03.2
    if code.startswith('03.1'):
        code = '03.1'
    elif code.startswith('03.2'):
        code = '03.2'
    elif code.startswith('04.'):
        code = '04'

    produtos_por_linha[code][produto] += 1
    if tipo:
        tipo_por_linha[code].add(str(tipo).strip())

print("=" * 80)
print("PRODUTOS POR LINHA DE PRODUÇÃO MCF (do histórico 2024-2026)")
print("=" * 80)

for code in sorted(produtos_por_linha.keys()):
    label = line_codes.get(code, f'(desconhecido: {code})')
    prods = produtos_por_linha[code]
    tipos = tipo_por_linha.get(code, set())

    # Sort by frequency descending
    sorted_prods = sorted(prods.items(), key=lambda x: -x[1])

    print(f"\n{'─' * 60}")
    print(f"Linha {code} — {label}  |  Tipos: {tipos}")
    print(f"  {len(sorted_prods)} produtos distintos, {sum(prods.values())} registos")
    print(f"{'─' * 60}")
    for p, cnt in sorted_prods:
        print(f"  {p:<25s}  ({cnt} registos)")

wb.close()
