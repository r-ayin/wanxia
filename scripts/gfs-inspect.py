"""检查 GFS GRIB2 文件中的变量列表"""
import urllib.request, tempfile, os

url = 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/gfs.20260620/00/atmos/gfs.t00z.goessimpgrb2.0p25.f000'
print(f'下载: {url}')
data = urllib.request.urlopen(url, timeout=30).read()
print(f'大小: {len(data)} 字节')

tmp = tempfile.NamedTemporaryFile(suffix='.grib2', delete=False)
tmp.write(data)
tmp.close()

try:
    import eccodes
    with open(tmp.name, 'rb') as f:
        count = eccodes.codes_count_in_file(f)
        print(f'\nGRIB messages: {count}')
        f.seek(0)
        shown = set()
        for i in range(min(count, 30)):
            gid = eccodes.codes_grib_new_from_file(f)
            name = eccodes.codes_get(gid, 'name')
            shortName = eccodes.codes_get(gid, 'shortName')
            level = eccodes.codes_get(gid, 'level')
            typeOfLevel = eccodes.codes_get(gid, 'typeOfLevel')
            key = f'{shortName}@{typeOfLevel}'
            if key not in shown:
                shown.add(key)
                print(f'  {name} ({shortName}) @ {typeOfLevel} level={level}')
            eccodes.codes_release(gid)
        print(f'\n唯一变量数: {len(shown)}')
finally:
    os.unlink(tmp.name)
