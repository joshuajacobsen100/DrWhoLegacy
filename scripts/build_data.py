"""Build compact game data + decoded images for the web port.

Reads decoded JSON in data_json/ and raw resources in apk_extracted/assets/Data,
writes web/public/data/*.json and web/public/img/**.
Run:  python -I scripts/build_data.py
"""
import glob, json, os, re, shutil, sys
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = os.path.join(ROOT, 'data_json')
RAW = os.path.join(ROOT, 'apk_extracted', 'assets', 'Data')
OUT = os.path.join(ROOT, 'web', 'public')
MAGIC = b'$D%5]0C#O!D=>E>!IGA_M+)E@'


def load(t, i):
    p = os.path.join(J, f'T{t}', f'N{i}', f'T{t}N{i}.json')
    if not os.path.exists(p):
        return None
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def ids(t):
    return sorted(int(os.path.basename(d)[1:]) for d in glob.glob(os.path.join(RAW, f'T{t}', 'N*')))


copied = {}


def export_img(t, i, name, dest_dir, dest_name):
    """Strip the magic prefix from a resource and write it under public/img."""
    key = (t, i, name)
    if key in copied:
        return copied[key]
    src = os.path.join(RAW, f'T{t}', f'N{i}', name)
    if not os.path.exists(src):
        copied[key] = None
        return None
    with open(src, 'rb') as f:
        d = f.read()
    if d.startswith(MAGIC):
        d = d[len(MAGIC):]
    rel = f'img/{dest_dir}/{dest_name}'
    out = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'wb') as f:
        f.write(d)
    copied[key] = rel
    return rel



def conv_drop(d):
    """A drop card: rows are [type, value, chance(, next card)]. Types: 1 unit/item id, 4 random fragment, 9 outfit id.
    `m` is 1 for the "multi" rule (one dice over cumulative chances) and 0 for "single" (each row rolls in turn)."""
    d = d or {}
    rows = []
    for r in d.get('rows') or []:
        try:
            t = int(r['type'])
            v = int(r['value']) if r.get('value') not in (None, '') else 0
        except (KeyError, ValueError):
            continue
        if t not in (1, 4, 9):
            continue
        row = [t, v, r['chance']]
        nx = r.get('next')
        if nx and nx.get('rows'):
            row.append(conv_drop(nx))
        rows.append(row)
    return {'m': 1 if d.get('rule') == 'multi' else 0, 'r': rows}

def main():
    os.makedirs(os.path.join(OUT, 'data'), exist_ok=True)

    # ---------- config ----------
    cfg = load(1, 1)
    args = {a['name']: a['value'] for a in cfg['argument_list']}
    type_rel = {}
    for a in cfg['info_attribute']:
        type_rel[a['id']] = {d['id']: d['damage'] for d in a['damage_ref']}
    exp_tables = {}
    t4 = load(4, 1)
    for tbl in t4['table_list']:
        lv = sorted(tbl['levels'], key=lambda l: l['level'])
        exp_tables[tbl['id']] = [l['next_level_exp'] for l in lv]  # index = level - 1

    # ---------- gems ----------
    gem_tbl = load(3, 1)['gems']
    gem_attr = {g['id']: (g['attribute'][0] if g['attribute'] else 0) for g in gem_tbl}
    for g in gem_attr:  # every skin, not just the base colours
        export_img(3, 1, f'gem{g}.png', 'gems', f'gem{g}.png')
    # crack obstacles: preset-grid value -> T59 image (from the scene-addenda config)
    obstacles = {o['id']: o['link_image'] for o in load(11, 1)['obstacle_list']}
    for img_id in set(obstacles.values()):
        export_img(59, img_id, 'image.png', 'gems', f'crack{img_id}.png')

    # ---------- units ----------
    ability_icons = set()
    units = {}
    suit_used = set()
    for uid in ids(21):
        u = load(21, uid)
        if not u or u.get('unit_type') not in (1, 2):
            continue
        lp = u['levels_property']
        ab = (u.get('abilities') or {}).get('abilities', [])
        suit = u.get('default_suit') or 0
        if not suit:
            for l in u.get('links', []):
                if l['type'] == 25:
                    suit = l['id']
                    break
        units[uid] = {
            'id': uid, 'n': u['name'], 't': u['unit_type'], 'r': u['rank'],
            'a': u['unit_attribute'], 'il': u['init_level'], 'ml': u['max_level'],
            'g': u.get('group') or 0, 'ex': u['exp_id'], 'suit': suit, 'ss': [x for x in (u.get('suits') or []) if x != suit],
            'et': u.get('evo_target', 0), 'ei': [[e['id'], e['count']] for e in u.get('evo_items', [])],
            'ec': u.get('evo_crystal', 0), 'adr': u.get('add_dr_level') or 0,
            'lp': [[p['hp'], p['min_atk'], p['max_atk'], p['heal']] for p in lp],
            'ab': [{'n': a['name'], 'd': a['desc'], 'cd': a['cd'], 't': a['type'], 'p': a['parameters'],
                    'i': a.get('link_image', 0)} for a in ab],
        }
        ability_icons.update(a.get('link_image', 0) for a in ab)
        if suit:
            suit_used.add(suit)
        suit_used.update(units[uid]['ss'])
    for s in suit_used:
        export_img(25, s, 'icon.png', 'unit', f'{s}_icon.png')
        export_img(25, s, 'square_icon.png', 'unit', f'{s}_sq.png')
    for u in units.values():
        u['suit'] = u['suit'] if u['suit'] in suit_used and copied.get((25, u['suit'], 'icon.png')) else 0
    # wardrobe: every outfit that has art, with its name (alternative outfits only count if the art exists)
    suits = {}
    for sid in sorted(suit_used):
        sq = copied.get((25, sid, 'square_icon.png')) or copied.get((25, sid, 'icon.png'))
        if sq:
            suits[sid] = {'n': (load(25, sid) or {}).get('name', ''), 'img': sq}
    for u in units.values():
        u['ss'] = [x for x in u['ss'] if x in suits]

    # ---------- items (fragments / crystals) ----------
    items = {}
    for uid in ids(21):
        u = load(21, uid)
        if not u or u.get('unit_type') not in (3, 4):
            continue
        suit = u.get('default_suit') or next((l['id'] for l in u.get('links', []) if l['type'] == 25), 0)
        icon = None
        if suit:
            icon = export_img(25, suit, 'square_icon.png', 'unit', f'{suit}_sq.png') or export_img(25, suit, 'icon.png', 'unit', f'{suit}_icon.png')
        items[uid] = {'id': uid, 'n': u['name'], 't': u['unit_type'], 'icon': icon}
    daily_bonus = cfg.get('daily_bonus', [])

    # ---------- One Turn Buffs (T10 config, T58 art) ----------
    otb_cfg = load(10, 1)
    otb_names = {1: 'atk', 2: 'heal', 3: 'hp', 4: 'drop'}  # buff_config_id -> what it raises (OTBSystem.OTBBuffType)
    otb_list = []
    for o in otb_cfg['otb_list']:
        if not o.get('otb_enable'):
            continue
        img = export_img(58, o.get('otb_link_image', 0), 'image.png', 'otb', f"{o.get('otb_link_image', 0)}.png") if o.get('otb_link_image') else None
        otb_list.append({
            'id': o['otb_id'], 'n': o['otb_name'], 'chance': int(o['otb_chance']), 'desc': o['otb_description'], 'img': img,
            'buffs': {otb_names[b['buff_config_id']]: int(b['buff_bonus']) for b in o.get('buff_list') or [] if b['buff_config_id'] in otb_names},
        })
    otb = {'except': sorted({x['level_id'] for x in otb_cfg.get('except_level_list') or []}), 'list': otb_list}

    # ---------- options: gem looks, the original's local tips, credits text ----------
    gem_skins = [{'n': k['title'], 'id': k['gem_id'], 'gems': k.get('gems') or []} for k in load(3, 1).get('skins', [])]
    tips = {t['name']: t['list'] for t in cfg.get('scrolling_data') or []}
    credits_src = os.path.join(ROOT, 'ripped', 'ExportedProject', 'Assets', 'Resources', 'ui', 'optionsmenu', 'credits.txt')
    if os.path.exists(credits_src):
        shutil.copyfile(credits_src, os.path.join(OUT, 'data', 'credits.txt'))

    # ---------- Tardis: season roll pools (T5) and purchase sets (T6 list of T26 packs) ----------
    tardis = []
    for sd in load(5, 1)['season_data']:
        rd = sd.get('roll_data') or {}
        pool = []
        for r in rd.get('rows') or []:
            try:
                t = int(r['type'])
                v = int(r['value'])
            except (KeyError, ValueError):
                continue
            if t in (1, 9) and v:
                pool.append([t, v, r['chance']])
        tardis.append({
            'n': sd.get('product_name') or sd.get('name'), 'bind': sd['bind_season'], 'roll': sd.get('available_roll', 0),
            'multi': 1 if rd.get('rule') == 'multi' else 0, 'pool': pool,
            'paSuit': sd.get('pa_suit') or 0, 'paChar': {str(c['id']): c['chance'] for c in sd.get('pa_character') or [] if c.get('chance')},
        })
    sets = []
    for pid in load(6, 1).get('pack_list', []):
        pk = load(26, pid)
        if not pk:
            continue
        its = [[x['type'], x['id'], x.get('count', 1)] for x in pk.get('item_list') or []]
        if its:
            sets.append({'id': pid, 'n': (pk.get('pack_title') or pk.get('name') or '').strip(), 'it': its})

    # ---------- perks (T8 config + T57 art) ----------
    perks = []
    perk_cfg = load(8, 1)
    for pk in perk_cfg['perk_list']:
        groups = []
        for g in pk.get('group_list') or []:
            skills = []
            for sk in g.get('skill_list') or []:
                img = export_img(57, sk.get('skill_link_image', 0), 'image.png', 'perk', f"{sk.get('skill_link_image', 0)}.png") if sk.get('skill_link_image') else None
                skills.append({
                    'id': sk['skill_id'], 'n': sk['skill_name'], 'd': (sk.get('skill_description') or '').replace('\n', ' '),
                    'img': img,
                    'fx': [[f['function_id'], f.get('function_parameters') or []] for f in (sk.get('function_list') or [])],
                })
            groups.append({'id': g['group_id'], 'n': g['group_name'], 'star': g['group_star'], 'cry': g['group_crystal'], 'skills': skills})
        perks.append({'id': pk['perk_id'], 'n': pk['perk_name'], 'groups': groups})

    # ---------- enemy templates ----------
    enemies = {}
    for eid in ids(24):
        e = load(24, eid)
        if not e:
            continue
        img = 0
        for l in e.get('links', []):
            if l['type'] == 51:
                img = l['id']
        enemies[eid] = {'img': img, 'w': e.get('image_width', 100), 'h': e.get('image_height', 100), 'n': e['name']}

    # ---------- scenes ----------
    scenes = {}
    for sid in ids(23):
        s = load(23, sid)
        if s:
            scenes[sid] = {'bg': s.get('bg_list', []), 'fg': s.get('fg_list', [])}

    # ---------- levels ----------
    levels = {}
    enemy_imgs = set()
    scene_imgs = set()
    for lid in ids(22):
        l = load(22, lid)
        if not l or not l.get('waves'):
            continue
        em = {}
        for e in l['enemies_mod']:
            p = e['properties'][0]
            ab = [{'n': a['name'], 'cd': a['cd'], 't': a['type'], 'p': a['parameters'], 'r': a.get('rate', 0),
                   'c': a.get('count', 0), 'h': a.get('roll_hp', 100), 'i': a.get('link_image', 0)}
                  for a in (p.get('abilities') or {}).get('abilities', [])]
            ability_icons.update(a['i'] for a in ab)
            dcard = conv_drop(p.get('drop'))
            em[e['id']] = {'e': e['enemy_id'], 'hp': p['hp'], 'atk': p['atk'], 'cd': p['cd'], 'def': p['def'],
                           'at': p['attribute'], 'ab': ab, 'dr': dcard['r'], 'dm': dcard['m']}
            enemy_imgs.add(enemies.get(e['enemy_id'], {}).get('img', 0))
        waves = []
        for w in l['waves']:
            wv = {'sc': w['scene_id'], 'boss': w.get('boss_fight', 0),
                  'en': [[x['id'], x['pos_x'], x['pos_y']] for x in w['enemies']]}
            # preset obstacle cells: [col, row, obstacleId] (row 0 = bottom). The original indexes match_grid[col][row]:
            # 6 lists (columns) of 5 values (rows) for its 6x5 board.
            cells = [[c, r, v] for c, col in enumerate(w.get('match_grid') or []) for r, v in enumerate(col) if v and v > 0]
            if cells:
                wv['grid'] = cells
            waves.append(wv)
            scene_imgs.update(b['id'] for b in scenes.get(w['scene_id'], {}).get('bg', []))
            scene_imgs.update(b['id'] for b in scenes.get(w['scene_id'], {}).get('fg', []))
        levels[lid] = {
            'id': lid, 'n': l['name'], 'xp': l.get('exp', 0), 'lt': l.get('limit_time', 0),
            'lc': l.get('limit_count', 0), 'cl': l.get('crystal_limit', 0), 'gems': [[g['id'], g['rate']] for g in l['gems_drop']],
            'em': em, 'w': waves, 'team': l.get('default_team', []),
        }
    # ---------- story scripts ----------
    stories = {}
    story_imgs = {'scene_image': set(), 'suit': set(), 'enemy_image': set()}
    for lid in ids(22):
        l = load(22, lid)
        sc = (l or {}).get('script') or ''
        if '<stories>' not in sc:
            continue
        try:
            root = ET.fromstring(sc)
        except ET.ParseError:
            print('story parse failed for level', lid)
            continue
        scene = root.find('story/scene')
        if scene is None:
            continue
        rows = []
        for el in scene:
            row = {'t': el.tag}
            row.update(el.attrib)
            rows.append(row)
            if el.tag == 'actor' and el.get('src_type') in story_imgs and el.get('src_value', '').isdigit():
                story_imgs[el.get('src_type')].add(int(el.get('src_value')))
        stories[lid] = rows
    for i in sorted(story_imgs['suit']):
        export_img(25, i, 'image.png', 'suit', f'{i}.png')
    for i in sorted(story_imgs['scene_image']):
        export_img(52, i, 'image.png', 'scene', f'{i}.png')
    enemy_imgs.update(story_imgs['enemy_image'])
    # ---------- audio used by story scripts ----------
    # sound ids refer to the sound table (T53); text beeps use ids 25/26/27 (chatbeeplow/mid/high); music tracks are plain
    # files in the Unity Resources/audio folder. Files are raw wav/mp3 (no magic prefix) but strip it if present.
    sound_ids = {25, 26, 27}
    for rows in stories.values():
        for row in rows:
            if row['t'] == 'playsound' and row.get('sound', '').isdigit():
                sound_ids.add(int(row['sound']))
            for key in ('onesfx',):
                if row.get(key, '').isdigit():
                    sound_ids.add(int(row[key]))
    sfx = {}
    for sid in sorted(sound_ids):
        t53 = load(53, sid)
        if not t53:
            continue
        for res in t53.get('resources', []):
            src = os.path.join(RAW, 'T53', f'N{sid}', res)
            if not os.path.exists(src):
                continue
            data = open(src, 'rb').read()
            if data.startswith(MAGIC):
                data = data[len(MAGIC):]
            ext = os.path.splitext(res)[1].lstrip('.') or t53.get('filetype', 'wav')
            rel = f'audio/sfx/{sid}.{ext}'
            os.makedirs(os.path.join(OUT, 'audio', 'sfx'), exist_ok=True)
            with open(os.path.join(OUT, rel), 'wb') as f:
                f.write(data)
            sfx[sid] = {'file': rel, 'name': t53.get('name', '')}
            break
    music = {}
    mdir = os.path.join(ROOT, 'ripped', 'ExportedProject', 'Assets', 'Resources', 'audio')
    for name in ('battlemusic01', 'battlemusic02', 'battlemusic03', 'mainmenu'):
        src = os.path.join(mdir, name + '.mp3')
        if os.path.exists(src):
            os.makedirs(os.path.join(OUT, 'audio', 'music'), exist_ok=True)
            shutil.copyfile(src, os.path.join(OUT, 'audio', 'music', name + '.mp3'))
            music[name] = f'audio/music/{name}.mp3'
    with open(os.path.join(OUT, 'data', 'audio.json'), 'w', encoding='utf-8') as f:
        json.dump({'sfx': sfx, 'music': music}, f, separators=(',', ':'))
    print('audio: sfx', sorted(sfx), 'music', sorted(music))

    with open(os.path.join(OUT, 'data', 'stories.json'), 'w', encoding='utf-8') as f:
        json.dump(stories, f, ensure_ascii=False, separators=(',', ':'))
    print('stories', len(stories), 'rows', sum(len(r) for r in stories.values()))

    for i in sorted(enemy_imgs):
        if i:
            export_img(51, i, 'image.png', 'enemy', f'{i}.png')
    for i in sorted(scene_imgs):
        if i:
            export_img(52, i, 'image.png', 'scene', f'{i}.png')
    for i in sorted(ability_icons):
        if i:
            export_img(54, i, 'image.png', 'ability', f'{i}.png')
    # drop references to images that failed to export
    for e in enemies.values():
        if not copied.get((51, e['img'], 'image.png')):
            e['img'] = 0

    # ---------- scripted boards (testGemdata.txt) ----------
    boards = {}
    tg = os.path.join(ROOT, 'ripped', 'ExportedProject', 'Assets', 'Resources', 'testGemdata.txt')
    if os.path.exists(tg):
        root = ET.fromstring(open(tg, encoding='utf-8-sig').read())
        for b in root.iter('board'):
            rows, cols = int(b.get('rows')), int(b.get('cols'))
            grid = [[0] * cols for _ in range(rows)]
            for g in b.iter('gem'):
                grid[int(g.get('row'))][int(g.get('col'))] = int(g.get('gemKey'))
            boards[b.get('name')] = {'rows': rows, 'cols': cols, 'gems': grid}
    with open(os.path.join(OUT, 'data', 'boards.json'), 'w', encoding='utf-8') as f:
        json.dump(boards, f, separators=(',', ':'))
    print('boards', list(boards))

    # ---------- level flow (menu tree) ----------
    flow = load(2, 1)['level_flow']['levels']

    data = {
        'args': args, 'typeRel': type_rel, 'exp': exp_tables, 'gemAttr': gem_attr, 'obstacles': obstacles, 'items': items, 'dailyBonus': daily_bonus, 'suits': suits, 'perks': perks, 'tardis': tardis, 'sets': sets, 'gemSkins': gem_skins, 'tips': tips, 'otb': otb, 'fragLimit': int(cfg.get('time_fragment_limit') or 0),
        'units': units, 'enemies': enemies, 'scenes': scenes, 'levels': levels, 'flow': flow,
    }
    with open(os.path.join(OUT, 'data', 'gamedata.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print('units', len(units), 'enemies', len(enemies), 'scenes', len(scenes), 'levels', len(levels))
    print('images', sum(1 for v in copied.values() if v), 'of', len(copied))
    print('gamedata.json KB', os.path.getsize(os.path.join(OUT, 'data', 'gamedata.json')) // 1024)


if __name__ == '__main__':
    main()
