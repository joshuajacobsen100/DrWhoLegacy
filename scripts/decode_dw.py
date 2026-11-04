import base64, os, sys, json
SRC = "apk_extracted/assets/Data"
DST = "data_json"
MAGIC = '$D%5]0C#O!D=>E>!IGA_M+)E@'
ok = bad = 0
for root, _, files in os.walk(SRC):
    for f in files:
        if not f.endswith('.dw'): continue
        p = os.path.join(root, f)
        t = open(p, 'r', encoding='ascii', errors='replace').read()
        n = t.index(MAGIC) + len(MAGIC)
        try:
            js = base64.b64decode(t[n:]).decode('utf-8')
            obj = json.loads(js)
        except Exception as e:
            bad += 1; print("FAIL", p, e); continue
        out = os.path.join(DST, os.path.relpath(p, SRC)[:-3] + '.json')
        os.makedirs(os.path.dirname(out), exist_ok=True)
        json.dump(obj, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        ok += 1
print("ok", ok, "bad", bad)
