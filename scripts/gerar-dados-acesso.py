"""
Gera public/dados/acesso.json: meio de acesso estimado de cada orelhão, pelo OpenStreetMap.

Para cada orelhão procura, num raio de 1,5 km:
  - a estrada mais próxima (tipo, nome/número e piso);
  - o rio, canal ou lago mais próximo (riachos e açudes ficam de fora);
e pistas de pouso a até 10 km. Com isso monta um resumo ("Por estrada",
"Provável acesso fluvial"...). É uma ESTIMATIVA: depende de quanto o
OpenStreetMap está mapeado em cada lugar.

Fonte (baixar antes): extratos regionais do Brasil da Geofabrik
  https://download.geofabrik.de/south-america/brazil/<regiao>-latest.osm.pbf
  (norte, nordeste, centro-oeste, sudeste, sul)

Uso: python scripts/gerar-dados-acesso.py <pasta_com_os_pbf>
"""
import json, os, re, sys, time, urllib.request
import geopandas as gpd
import pandas as pd
from shapely.ops import unary_union

PBF = sys.argv[1]
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, 'public', 'dados', 'acesso.json')
METRICO = 5880          # SIRGAS 2000 / Brazil Polyconic (metros)
RAIO = 1500             # m, estradas e água
RAIO_AERO = 10000       # m, pistas de pouso
REGIAO = {**dict.fromkeys('AC AM AP PA RO RR TO'.split(), 'norte'), **dict.fromkeys('AL BA CE MA PB PE PI RN SE'.split(), 'nordeste'),
          **dict.fromkeys('GO MS MT DF'.split(), 'centro-oeste'), **dict.fromkeys('ES MG RJ SP'.split(), 'sudeste'),
          **dict.fromkeys('PR RS SC'.split(), 'sul')}

VIAS = ('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'track', 'residential', 'living_street', 'service', 'road',
        'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link')
DESC = {'motorway': 'Rodovia', 'trunk': 'Rodovia', 'primary': 'Rodovia', 'secondary': 'Estrada', 'tertiary': 'Estrada',
        'unclassified': 'Estrada vicinal', 'track': 'Ramal / estrada de terra', 'residential': 'Rua', 'living_street': 'Rua',
        'service': 'Acesso local', 'road': 'Estrada'}
PAV = {'paved', 'asphalt', 'concrete', 'concrete:plates', 'paving_stones', 'sett', 'cobblestone', 'chipseal', 'metal'}
TERRA = {'unpaved', 'dirt', 'ground', 'gravel', 'sand', 'earth', 'compacted', 'fine_gravel', 'grass', 'mud', 'pebblestone', 'rock'}
AGUA_OK = {'river', 'canal', 'oxbow', 'lake', 'lagoon'}

def tag(outros, chave):
    if not isinstance(outros, str): return None  # sem etiquetas extras (vem como NaN)
    m = re.search(rf'"{re.escape(chave)}"=>"([^"]*)"', outros)
    return m.group(1) if m else None

def ler(caminho, camada, where, mask, cols):
    t = time.time()
    g = gpd.read_file(caminho, layer=camada, where=where, mask=mask, columns=cols, engine='pyogrio')
    print(f'    {camada}: {len(g)} feições em {time.time() - t:.0f}s', flush=True)
    return g.set_crs(4326, allow_override=True)

# --- orelhões (leitura no Supabase) ---
env = dict(l.strip().split('=', 1) for l in open(os.path.join(RAIZ, '.env.local'), encoding='utf8') if '=' in l)
U, K = env['NEXT_PUBLIC_SUPABASE_URL'], env['NEXT_PUBLIC_SUPABASE_ANON_KEY']
orel = []
for ini in range(0, 20000, 1000):
    r = urllib.request.Request(f'{U}/rest/v1/orelhoes?select=id,uf,lat,lng&order=id',
                               headers={'apikey': K, 'Authorization': f'Bearer {K}', 'Range': f'{ini}-{ini + 999}'})
    lote = json.load(urllib.request.urlopen(r, timeout=60)); orel += lote
    if len(lote) < 1000: break
O = gpd.GeoDataFrame(orel, geometry=gpd.points_from_xy([o['lng'] for o in orel], [o['lat'] for o in orel]), crs=4326)
O['regiao'] = O['uf'].map(REGIAO)
print('orelhões:', len(O))

saida = {}
for regiao, grupo in O.groupby('regiao'):
    arq = os.path.join(PBF, f'{regiao}-latest.osm.pbf')
    print(f'== {regiao}: {len(grupo)} orelhões', flush=True)
    M = grupo.to_crs(METRICO)
    mask = gpd.GeoSeries([unary_union(M.buffer(RAIO + 200).geometry)], crs=METRICO).to_crs(4326).iloc[0]
    mask_aero = gpd.GeoSeries([unary_union(M.buffer(RAIO_AERO + 500).geometry)], crs=METRICO).to_crs(4326).iloc[0]

    vias_sql = ','.join(f"'{v}'" for v in VIAS)
    linhas = ler(arq, 'lines', f"highway IN ({vias_sql}) OR waterway IN ('river','canal')", mask, ['name', 'highway', 'waterway', 'other_tags'])
    polis = ler(arq, 'multipolygons', "natural = 'water' OR other_tags LIKE '%\"waterway\"=>\"riverbank\"%' OR aeroway = 'aerodrome'",
                mask_aero, ['name', 'natural', 'aeroway', 'other_tags'])
    pts = ler(arq, 'points', "other_tags LIKE '%\"aeroway\"=>\"aerodrome\"%'", mask_aero, ['name', 'other_tags'])

    est = linhas[linhas['highway'].notna()].copy()
    est['nome'] = [n if isinstance(n, str) else tag(o, 'ref') for n, o in zip(est['name'], est['other_tags'])]
    est['surface'] = [tag(o, 'surface') for o in est['other_tags']]
    est['tracktype'] = [tag(o, 'tracktype') for o in est['other_tags']]

    agua_l = linhas[linhas['waterway'].notna()][['name', 'geometry']]
    poli_agua = polis[polis['aeroway'] != 'aerodrome'].copy()
    poli_agua['water'] = [tag(o, 'water') for o in poli_agua['other_tags']]
    poli_agua = poli_agua[poli_agua['water'].isin(AGUA_OK) | poli_agua['other_tags'].fillna('').str.contains('"waterway"=>"riverbank"', regex=False)]
    agua = pd.concat([agua_l, poli_agua[['name', 'geometry']]], ignore_index=True)
    aero = pd.concat([polis[polis['aeroway'] == 'aerodrome'][['name', 'geometry']], pts[['name', 'geometry']]], ignore_index=True)

    def mais_proximo(alvo, raio):
        if alvo is None or len(alvo) == 0: return {}
        A = gpd.GeoDataFrame(alvo, geometry='geometry', crs=4326).to_crs(METRICO)
        J = gpd.sjoin_nearest(M[['id', 'geometry']], A, how='inner', max_distance=raio, distance_col='m')
        return {r['id']: r for _, r in J.sort_values('m').drop_duplicates('id').iterrows()}

    pe, pa, pr = mais_proximo(est, RAIO), mais_proximo(agua, RAIO), mais_proximo(aero, RAIO_AERO)
    # nome do curso d'água: o mais próximo COM nome, se estiver a até 300 m além do mais próximo
    agua_nomeada = mais_proximo(agua[agua['name'].notna()], RAIO)

    for oid in grupo['id']:
        a = {}
        if oid in pe:
            r = pe[oid]; hw = str(r['highway']).replace('_link', '')
            piso = 'pavimentada' if r['surface'] in PAV else 'terra' if r['surface'] in TERRA else (
                'terra' if r['tracktype'] in ('grade2', 'grade3', 'grade4', 'grade5') else '?')
            a['estrada'] = {'m': round(r['m']), 'desc': DESC.get(hw, 'Estrada'), 'piso': piso,
                            **({'nome': r['nome']} if isinstance(r['nome'], str) else {})}
        if oid in pa:
            m = round(pa[oid]['m']); nome = None
            if oid in agua_nomeada and agua_nomeada[oid]['m'] <= m + 300: nome = agua_nomeada[oid]['name']
            a['rio'] = {'m': m, **({'nome': nome} if nome else {})}
        if oid in pr:
            r = pr[oid]
            a['aero'] = {'m': round(r['m']), **({'nome': r['name']} if isinstance(r['name'], str) else {})}

        e, rio = a.get('estrada', {}).get('m'), a.get('rio', {}).get('m')
        if e is not None and e <= 150 and rio is not None and rio <= 300: a['resumo'] = 'Por estrada e por rio'
        elif e is not None and e <= 150: a['resumo'] = 'Por estrada'
        elif rio is not None and rio <= 300: a['resumo'] = 'Provável acesso fluvial (barco)'
        elif e is not None: a['resumo'] = 'Por estrada (via mapeada mais próxima um pouco afastada)'
        elif rio is not None: a['resumo'] = 'Provável acesso fluvial (rio a mais de 300 m)'
        else: a['resumo'] = 'Sem estrada ou rio mapeado a 1,5 km (mapa pode estar incompleto)'
        saida[oid] = a

os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
json.dump(saida, open(SAIDA, 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'), allow_nan=False)
from collections import Counter
print('salvo:', SAIDA, f'({os.path.getsize(SAIDA) // 1024} KB)')
print('resumos:', Counter(a['resumo'] for a in saida.values()).most_common())
