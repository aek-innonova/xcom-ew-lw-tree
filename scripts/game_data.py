#!/usr/bin/env python3
"""Generate a game version's research tree and Foundry data from its own
files, in the shapes of tech.json and longwar_foundry.json.

    python3 scripts/game_data.py <root> <techtree.json> <out dir>

`root` holds the install's CookedPCConsole/, INT (or INT2)/ and
DefaultGameCore.ini (or Config/DefaultGameCore.ini); `techtree.json` is the
same install's output of scripts/upk_techtree.py. Writes techs.json,
foundry.json and prices.json (grey market) to `out dir`.

What comes from where:
- names: the INT localization (TechTypeNames, FoundryTechNames,
  FoundryTechSummary, m_aItemNames / m_aItemNamesPlural, m_aFacilityNames);
- research time, alloys, elerium, fragments and item counts: the INI's
  TechBalance lines, as XGTechTree.BalanceTechs reads them; the points a day
  of iTime is worth: XGTechTree.TechCost (Long War 1.0: 720, LWR: 240), turned
  into base days of 720 points so both versions share one scale;
- prerequisites, gates and credits: techtree.json;
- unlocks: the items (XGItemTree.BuildItems) and facilities (BuildFacilities)
  that name the tech, and the credit an interrogation grants (not yet gene
  mods, whose tech is in reused INI lines, nor psionic abilities);
- Foundry: FoundryBalance lines (as BalanceFoundry reads them; iFragments
  packs Meld as thousands) plus BuildFoundryItemCost's hard-coded items;
  its work per project from XGTechTree.FoundryDaysToHours;
- lanes (categories): Long War 1.0's, by id (tech.json, longwar_foundry.json),
  since the ids keep their roles.
Nothing is borrowed from Long War 1.0 beyond the lanes; what the files do not
say is left out.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from upk import enum_values, enums, load  # noqa: E402
from upk_script import statements  # noqa: E402
from upk_airwar import args  # noqa: E402
from upk_techtree import localized  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CREDITS = {1: 'Laser Weapons', 2: 'Plasma Weapons', 3: 'Weapons', 4: 'Aerospace', 5: 'Armor',
           6: 'Cybernetics', 7: 'Gauss Weapons', 8: 'Psionics'}


def find(root, *names):
    for n in names:
        p = os.path.join(root, n)
        if os.path.exists(p):
            return p
    raise SystemExit(f'none of {names} under {root}')


def ini_lines(text, key):
    out = []
    for m in re.finditer(rf'^{key}\s*=\s*\((.*?)\)', text, re.M | re.I):
        kv = {}
        for part in m.group(1).split(','):
            if '=' in part:
                k, v = part.split('=', 1)
                kv[k.strip()] = v.strip()
        out.append(kv)
    return out


def main():
    root, techtree_path, out_dir = sys.argv[1:4]
    cooked = find(root, 'CookedPCConsole')
    loc = os.path.dirname(find(root, 'INT2/XComGame.int', 'INT/XComGame.int'))
    ini = open(find(root, 'DefaultGameCore.ini', 'Config/DefaultGameCore.ini'), encoding='latin-1').read()
    techtree = json.load(open(techtree_path))

    _, game = load(os.path.join(cooked, 'XComGame.upk'))
    _, pk = load(os.path.join(cooked, 'XComStrategyGame.upk'))
    found = enums(game)
    tech_enum = enum_values(game, found['ETechType'])
    item_enum = enum_values(game, found['EItemType'])
    foundry_enum = enum_values(game, found['EFoundryTech'])
    facility_enum = enum_values(game, found['EFacilityType'])

    def names(path, key):
        return localized(os.path.join(loc, path), key)
    tech_names = names('XComStrategyGame.int', 'TechTypeNames')
    foundry_names = names('XComStrategyGame.int', 'FoundryTechNames')
    foundry_summaries = names('XComStrategyGame.int', 'FoundryTechSummary')
    item_names = names('XComGame.int', 'm_aItemNames')
    item_plurals = names('XComGame.int', 'm_aItemNamesPlural')
    facility_names = names('XComStrategyGame.int', 'm_aFacilityNames')

    def by(table, values, i):
        return table.get(values[i]) or table.get(str(i))

    def item_text(i, n):
        name = by(item_names, item_enum, i) or item_enum[i]
        plural = by(item_plurals, item_enum, i) or name
        return name if n == 1 else f'{n} {plural}'

    # The points one INI day is worth (XGTechTree.TechCost).
    cost = ' '.join(s for _, s in statements(pk, 'XGTechTree.TechCost'))
    consts = {m.group(1): float(m.group(2)) for m in re.finditer(r'^(\w+)\s*=\s*(-?[\d.]+)', ini, re.M)}
    if m := re.search(r'return \(iExpectedScientists \* (\d+)\)', cost):
        per_day = int(m.group(1))
    elif 'return (((iExpectedScientists * 24) * 3) * fBalanceFactor)' in cost and 'TECH_TIME_BALANCE' in cost:
        per_day = 72 * consts['TECH_TIME_BALANCE']
    else:
        raise SystemExit(f'TechCost: not a form this script knows: {cost}')

    # Foundry work (XGTechTree.FoundryDaysToHours), as a formula the app evaluates.
    fdh = ' '.join(s for _, s in statements(pk, 'XGTechTree.FoundryDaysToHours'))
    if 'return ((iDays * 24) * iEngineers)' in fdh:
        foundry_work = 'days*24*engineers'
    elif 'return (((iDays * iEngineers) * iEngineers) / 3)' in fdh:
        foundry_work = 'days*engineers*engineers/3'
    else:
        raise SystemExit(f'FoundryDaysToHours: not a form this script knows: {fdh}')

    # What each tech unlocks: items and facilities that name it.
    unlocks = {}
    for _, s in statements(pk, 'XGItemTree.BuildItems'):
        if s.startswith('BuildItem('):
            a = args(s)
            if len(a) > 7 and a[7]:
                unlocks.setdefault(int(a[7].lstrip('b')), []).append(
                    by(item_names, item_enum, int(a[0].lstrip('b'))) or item_enum[int(a[0].lstrip('b'))])
    for _, s in statements(pk, 'XGItemTree.BuildFacilities'):
        if s.startswith('BuildFacility('):
            a = args(s)
            if len(a) > 9 and a[9]:
                f = int(a[0].lstrip('b'))
                unlocks.setdefault(int(a[9].lstrip('b')), []).append(by(facility_names, facility_enum, f)
                                                                      or facility_enum[f])

    lw = {t['id']: t for t in json.load(open(os.path.join(HERE, 'tech.json')))['techs']}
    lw_data = json.load(open(os.path.join(HERE, 'tech.json')))
    rules = {t['id']: t for t in techtree['techs']}
    balance = {}
    for kv in ini_lines(ini, 'TechBalance'):
        key = kv['eTech']
        tid = int(key) if key.isdigit() else tech_enum.index(key)
        balance[tid] = (key, kv)

    def ref(i):
        return {'id': i, 'name': by(tech_names, tech_enum, i) or tech_enum[i]}

    techs = []
    for tid in sorted(rules):
        r = rules[tid]
        key, kv = balance.get(tid, (tech_enum[tid], {}))
        num = lambda k: int(kv.get(k, 0) or 0)  # noqa: E731
        items = r.get('ever_had', {}).get('id') if r.get('ever_had') else None
        item_cost = item_text(items, num('iNumItems')) if items and num('iNumItems') > 0 else None
        unl = list(dict.fromkeys(unlocks.get(tid, [])))
        if 'grants_credit' in r:
            g = r['grants_credit']
            unl.append('credit for all research and Foundry projects' if g == 9 else f'{CREDITS[g]} research credit')
        techs.append({
            'id': tid,
            'enum': tech_enum[tid],
            'config_key': key,
            'name': by(tech_names, tech_enum, tid) or tech_enum[tid],
            'category': lw[tid]['category'] if tid in lw else 'Other',
            'base_days': round(num('iTime') * per_day / 720, 2),
            'cost': {'alloys': num('iAlloys'), 'elerium': num('iElerium'),
                     'weapon_fragments': num('iNumFragments'), 'items': item_cost},
            'prerequisites': [ref(p) for p in r['requires']],
            'any_one_of': [ref(p) for p in r.get('any_of', [])],
            'unlocks': unl,
        })
    for t in techs:
        t['leads_to'] = [ref(o['id']) for o in techs
                         if any(p['id'] == t['id'] for p in o['prerequisites'] + o['any_one_of'])]

    # Foundry projects.
    extras = {}
    cur = None
    for _, s in statements(pk, 'XGTechTree.BuildFoundryItemCost'):
        if m := re.fullmatch(r'if !\(\(iTech == (\d+)\)\) goto \d+', s):
            cur = int(m.group(1)); extras[cur] = []
        elif m := re.fullmatch(r'out kTech\.kCost\.arrItems\.AddItem\(b?(\d+)\)', s):
            extras[cur].append([int(m.group(1)), 0])
        elif m := re.fullmatch(r'out kTech\.kCost\.arrItemQuantities\.AddItem\(b?(\d+)\)', s):
            extras[cur][-1][1] = int(m.group(1))
    lw_foundry = {p['id']: p for p in json.load(open(os.path.join(HERE, 'longwar_foundry.json')))['projects']}
    lw_foundry_data = json.load(open(os.path.join(HERE, 'longwar_foundry.json')))
    frules = {f['id']: f for f in techtree['foundry']}
    projects = []
    for kv in ini_lines(ini, 'FoundryBalance'):
        key = kv['eTech']
        fid = int(key) if key.isdigit() else foundry_enum.index(key)
        num = lambda k: int(kv.get(k, 0) or 0)  # noqa: E731
        frag = num('iFragments')
        # BalanceFoundry sets every item's quantity but fragments' and Meld's to the
        # INI's iNumItems, the hard-coded extras' too.
        items = [f"{num('iNumItems')}x {by(item_names, item_enum, i) or item_enum[i]}" for i, _ in extras.get(fid, [])]
        req_item = frules.get(fid, {}).get('in_stores')
        if req_item and num('iNumItems') > 0:
            items.append(f"{num('iNumItems')}x {req_item['name']}")
        req = frules.get(fid, {}).get('requires', 0)
        projects.append({
            'id': fid,
            'enum': foundry_enum[fid],
            'config_key': key,
            'name': by(foundry_names, foundry_enum, fid) or f'Foundry {fid}',
            'category': lw_foundry[fid]['category'] if fid in lw_foundry else 'Other',
            'base_days': num('iTime'),
            'engineers': num('iEngineers'),
            'cost': {'cash': num('iCash'), 'alloys': num('iAlloys'), 'elerium': num('iElerium'),
                     'weapon_fragments': frag % 1000, 'meld': frag // 1000, 'items': items},
            'requires_tech': ref(req) if req else None,
            'effect': by(foundry_summaries, foundry_enum, fid) or '',
        })
    projects.sort(key=lambda p: p['id'])

    # Grey market prices: ItemBalance_Normal's iCash, as model/inventory.ts parsePrices reads them.
    prices = {}
    for raw in ini.splitlines():
        line = re.sub(r'(;|//).*$', '', raw).strip()
        if m := re.match(r'^ItemBalance_Normal\s*=\s*\(\s*eItem\s*=\s*(eItem_\w+)\s*,\s*iCash\s*=\s*(-?\d+)', line, re.I):
            prices[m.group(1)] = int(m.group(2))

    os.makedirs(out_dir, exist_ok=True)
    json.dump({'generated': f'ItemBalance_Normal iCash, by scripts/game_data.py', 'prices': prices},
              open(os.path.join(out_dir, 'prices.json'), 'w'), indent=1)
    source = f'generated by scripts/game_data.py from {os.path.basename(os.path.abspath(root))}'
    json.dump({'game': lw_data.get('game'), 'mod': None, 'generated': source, 'categories': lw_data['categories'],
               'research_points_per_base_day': 720, 'ini_points_per_day': per_day, 'techs': techs},
              open(os.path.join(out_dir, 'techs.json'), 'w'), indent=1)
    json.dump({'generated': source, 'categories': lw_foundry_data['categories'], 'work': foundry_work,
               'projects': projects},
              open(os.path.join(out_dir, 'foundry.json'), 'w'), indent=1)
    print(f'{len(techs)} techs, {len(projects)} Foundry projects, {per_day} points a day, Foundry work {foundry_work}')


if __name__ == '__main__':
    main()
