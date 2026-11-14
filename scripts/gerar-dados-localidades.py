"""
Gera public/dados/localidades.json: dados do IBGE (Censo 2022) para cada orelhão.

Para cada orelhão:
  - setor censitário (pelo código da base ou, sem código, pela coordenada):
    população, domicílios, situação (povoado, área rural, urbana...) e aglomerado;
  - município: população total e distância em linha reta até a sede municipal;
  - localidade do IBGE mais próxima (nome, tipo, distância).

Fontes (baixar antes e passar a pasta como argumento):
  - Setores com atributos, por UF (gpkg):
    https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/malha_com_atributos/setores/gpkg/UF/
  - Localidades do Brasil 2022 (gpkg):
    https://geoftp.ibge.gov.br/organizacao_do_territorio/estrutura_territorial/localidades/Localidades_do_Brasil/2022/

Uso: python scripts/gerar-dados-localidades.py <pasta_ibge>
     (<pasta_ibge>/setores/*.gpkg e <pasta_ibge>/loc/BR_localidades_2022.gpkg)
"""
import glob, json, math, os, sys, urllib.request
import geopandas as gpd
import pandas as pd

IBGE = sys.argv[1]
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, 'public', 'dados', 'localidades.json')
METRICO = 5880  # SIRGAS 2000 / Brazil Polyconic, em metros

def km(a_lat, a_lng, b_lat, b_lng):
    R, r = 6371.0, math.radians
    h = math.sin(r(b_lat - a_lat) / 2) ** 2 + math.cos(r(a_lat)) * math.cos(r(b_lat)) * math.sin(r(b_lng - a_lng) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))

# --- orelhões (leitura no Supabase) ---
env = dict(l.strip().split('=', 1) for l in open(os.path.join(RAIZ, '.env.local'), encoding='utf8') if '=' in l)
U, K = env['NEXT_PUBLIC_SUPABASE_URL'], env['NEXT_PUBLIC_SUPABASE_ANON_KEY']
orel = []
for ini in range(0, 20000, 1000):
    r = urllib.request.Request(f'{U}/rest/v1/orelhoes?select=id,uf,municipio,localidade,lat,lng,origem,cod_localidade&order=id',
                               headers={'apikey': K, 'Authorization': f'Bearer {K}', 'Range': f'{ini}-{ini + 999}'})
    lote = json.load(urllib.request.urlopen(r, timeout=60)); orel += lote
    if len(lote) < 1000: break
O = gpd.GeoDataFrame(orel, geometry=gpd.points_from_xy([o['lng'] for o in orel], [o['lat'] for o in orel]), crs=4674)
print('orelhões:', len(O))

# --- setores censitários ---
cols = ['CD_SETOR', 'SITUACAO', 'CD_SIT', 'CD_MUN', 'NM_MUN', 'NM_AGLOM', 'NM_NU', 'v0001', 'v0002']
partes = []
for f in sorted(glob.glob(os.path.join(IBGE, 'setores', '*.gpkg'))):
    g = gpd.read_file(f, columns=cols, engine='pyogrio')
    partes.append(g.to_crs(4674) if g.crs and g.crs.to_epsg() != 4674 else g)
    print('  ', os.path.basename(f), len(g))
S = pd.concat(partes, ignore_index=True)
S = gpd.GeoDataFrame(S, geometry='geometry', crs=4674)
for c in ('v0001', 'v0002'): S[c] = pd.to_numeric(S[c], errors='coerce').fillna(0).astype(int)
# Alguns setores vêm em mais de um pedaço (linhas repetidas): uma linha por setor.
por_setor = S.drop(columns='geometry').drop_duplicates('CD_SETOR').set_index('CD_SETOR')
pop_mun = por_setor.groupby('CD_MUN')['v0001'].sum().to_dict()
print('setores únicos:', len(por_setor), '| linhas repetidas descartadas:', len(S) - len(por_setor))

# setor pela coordenada
J = gpd.sjoin(O[['id', 'geometry']], S[['CD_SETOR', 'geometry']], how='left', predicate='within').drop_duplicates('id')
setor_ponto = dict(zip(J['id'], J['CD_SETOR']))

# --- localidades IBGE 2022 (sedes e povoados) ---
L = gpd.read_file(glob.glob(os.path.join(IBGE, 'loc', '**', '*.gpkg'), recursive=True)[0], engine='pyogrio')
L = L.to_crs(4674) if L.crs and L.crs.to_epsg() != 4674 else L
sede = {r.CD_MUN: (r.NM_LOCALIDADE, r.LAT_LOCALIDADE, r.LONG_LOCALIDADE) for r in L[L['SCT_LOCALIDADE'] == 'Sede Municipal'].itertuples()}
P = gpd.sjoin_nearest(O[['id', 'geometry']].to_crs(METRICO), L[['NM_LOCALIDADE', 'CT_LOCALIDADE', 'SCT_LOCALIDADE', 'geometry']].to_crs(METRICO),
                      how='left', distance_col='dist_m').drop_duplicates('id')
txt = lambda v: v if isinstance(v, str) and v.strip() not in ('', '.') else None  # vazio/NaN do IBGE -> None
perto = {r.id: (r.NM_LOCALIDADE, txt(r.SCT_LOCALIDADE) or txt(r.CT_LOCALIDADE), r.dist_m) for r in P.itertuples()}

# --- monta a saída ---
out, est = {}, {'pelo_codigo': 0, 'pela_coordenada': 0, 'sem_setor': 0, 'codigo_e_ponto_iguais': 0, 'com_codigo': 0}
for o in orel:
    cod = o['cod_localidade'] if o['cod_localidade'] in por_setor.index else None
    pt = setor_ponto.get(o['id'])
    pt = pt if isinstance(pt, str) else None
    if cod:
        est['com_codigo'] += 1
        est['codigo_e_ponto_iguais'] += cod == pt
    setor = cod or pt
    est['pelo_codigo' if cod else 'pela_coordenada' if pt else 'sem_setor'] += 1
    d = {'est': o['origem'] == 'estimada'}
    if setor:
        s = por_setor.loc[setor]
        d.update(setor=setor, sit=txt(s['SITUACAO']), pop=int(s['v0001']), dom=int(s['v0002']),
                 aglom=txt(s['NM_AGLOM']),
                 fonte='código' if cod else 'coordenada')
        mun = s['CD_MUN']
        d['mun'] = mun
        d['mun_pop'] = int(pop_mun.get(mun, 0))
        if mun in sede:
            nome, la, ln = sede[mun]
            d['sede'] = nome
            d['sede_km'] = round(km(o['lat'], o['lng'], la, ln), 1)
            d['sede_lat'], d['sede_lng'] = round(la, 5), round(ln, 5)
    if o['id'] in perto:
        n, t, m = perto[o['id']]
        d['ibge_loc'] = {'nome': n, 'tipo': t, 'km': round(m / 1000, 2)}
    out[o['id']] = d

os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
json.dump(out, open(SAIDA, 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'), allow_nan=False)
print('salvo:', SAIDA, f'({os.path.getsize(SAIDA) // 1024} KB)')
print('estatísticas:', est)
