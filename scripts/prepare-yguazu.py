# Rebuild the Day 9 research sample from the extracted INE GeoJSON directory.
import sys,json,hashlib
from pathlib import Path
from shapely.geometry import shape,MultiPolygon
from shapely.ops import unary_union,transform
from pyproj import Transformer,CRS
import pyarrow as pa,pyarrow.parquet as pq
root=Path(__file__).resolve().parents[2];base=Path(sys.argv[1])
fs=json.loads((base/'Barrios Localidades_Alto Parana.geojson').read_text())['features'];fs=[f for f in fs if f['properties']['CLAVE']=='1009']
d=next(f for f in json.loads((base/'Distritos_Alto Parana.geojson').read_text())['features'] if f['properties']['CLAVE']=='1009')
tr=Transformer.from_crs(4674,4326,always_xy=True).transform
metric=Transformer.from_crs(4674,32721,always_xy=True).transform
regions={a:unary_union([shape(f['geometry']) for f in fs if f['properties']['AREA']==a]) for a in ['1','6']}
whole=shape(d['geometry']);cover=unary_union(list(regions.values()))
stats={'district_code':'1009','polygons':len(fs),'counts':{a:sum(f['properties']['AREA']==a for f in fs) for a in regions},'all_source_valid':all(shape(f['geometry']).is_valid for f in fs),'district_valid':whole.is_valid,'gap_or_excess_m2':transform(metric,whole.symmetric_difference(cover)).area,'overlap_m2':transform(metric,regions['1'].intersection(regions['6'])).area,'population':{'urban':3843,'rural':4288,'total':8131},'source_crs':'EPSG:4674','export_crs':'EPSG:4326','archive_sha256':'a9ff06b8397c8996253f291eecfeb5868d50d494cde29f5e9a5bea54e5527158','source_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in base.glob('*.geojson') if p.name.startswith(('Barrios','Distritos'))}}
rows=[];bounds=[]
for a,g in regions.items():
 g=transform(tr,g)
 if g.geom_type=='Polygon':g=MultiPolygon([g])
 bounds.append(g.bounds);rows.append({'district_code':'1009','area_code':a,'area_type':'urban' if a=='1' else 'rural','census_year':2022,'population':3843 if a=='1' else 4288,'geometry':g.wkb})
t=pa.Table.from_pylist(rows);geo={'version':'1.1.0','primary_column':'geometry','columns':{'geometry':{'encoding':'WKB','geometry_types':['MultiPolygon'],'crs':CRS.from_epsg(4326).to_json_dict(),'bbox':[min(b[0] for b in bounds),min(b[1] for b in bounds),max(b[2] for b in bounds),max(b[3] for b in bounds)]}}};t=t.replace_schema_metadata({b'geo':json.dumps(geo).encode()});p=root/'docs/research/day9-yguazu.parquet';pq.write_table(t,p,compression='zstd');r=pq.read_table(p);assert r.num_rows==2 and sum(r.column('population').to_pylist())==8131;assert r.schema.metadata[b'geo']==t.schema.metadata[b'geo'];stats['geoparquet_bytes']=p.stat().st_size;stats['area_km2']={a:transform(metric,g).area/1e6 for a,g in regions.items()};print(json.dumps(stats,indent=2));(root/'docs/research/day9-verification.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2)+'\n')
