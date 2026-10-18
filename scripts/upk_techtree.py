#!/usr/bin/env python3
"""Extract the research and Foundry rules from Long War's XComStrategyGame.upk
into data/techtree.json: what each tech needs before it can be researched,
which research credits cover what, and what a Foundry project needs in stores.

    python3 scripts/upk_techtree.py samples > data/techtree.json

`samples` holds the player's CookedPCConsole/, INT2/ (or INT/) and
DefaultGameCore.ini, which stay out of the repository; only the facts read
from them are committed. The rules come from XGTechTree's compiled script
(scripts/upk_script.py):

- BuildTechs: BuildTech(iTech, iHours, bCustomReqs, eItemReq, eTechReq,
  iImage, eCreditGranted) per tech. HasPrereqs: a tech needs its eTechReq
  researched and its eItemReq ever held (XGStorage.m_arrItemArchives); with
  bCustomReqs also its case in HasPrereqs' switch.
- BuildResearchCredits: each credit's iBonus (percent).
- CreditAppliesToTech / CreditAppliesToFoundryTech: which techs and Foundry
  projects each credit covers.
- HasFoundryPrereqs: a project needs its INI eReqTech researched and its INI
  eReqItem in stores now (any number); Alien Grenades also an item ever held.
  Long War jumps over vanilla's two other checks (projects 16 and 20).

Anything the script does not recognise stops it, so a changed rule is noticed
rather than dropped.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from upk import enum_values, enums, load  # noqa: E402
from upk_script import statements  # noqa: E402


def localized(path, key):
    """key[index or enum name] = "text" lines; later lines win, as in the game."""
    out = {}
    if not os.path.exists(path):
        return out
    raw = open(path, 'rb').read()
    # The game's .int files are UTF-16 (with a byte order mark) or 8-bit.
    text = raw.decode('utf-16') if raw[:2] in (b'\xff\xfe', b'\xfe\xff') else raw.decode('utf-8', 'replace')
    for line in text.splitlines():
        m = re.match(rf'^{key}\[(\w+)\]="(.*)"', line.strip())
        if m:
            out[m.group(1)] = m.group(2)
    return out


def names(values, loc):
    def name(i):
        return loc.get(values[i]) or loc.get(str(i)) or values[i]
    return name


def num(x):
    return int(x.lstrip('b'))


def cases(lines):
    """The switch(eCredit) { case c: switch(eTech) { case t: ... return true } }
    shape: {c: [t, ...]}, or {c: None} for a case that returns true outright."""
    out = {}; state = 'outer'; outer = None; inner = []
    for _, s in lines:
        if m := re.fullmatch(r'case (b?\d+):', s):
            if state == 'outer':
                outer = num(m.group(1)); inner = []; state = 'picked'
            elif state == 'inner':
                inner.append(num(m.group(1)))
            else:
                raise ValueError(f'unexpected case in a credit switch: {s}')
        elif s == 'switch(eTech)':
            state = 'inner'
        elif s == 'return true':
            out[outer] = None if state == 'picked' else inner
            state = 'outer' if state == 'picked' else 'closing'
        elif s.startswith('goto'):
            state = 'outer'
        elif s not in ('switch(eCredit)', 'default:', 'return false', 'return return', 'nothing', 'END', ''):
            raise ValueError(f'unexpected statement in a credit switch: {s}')
    return out


def main():
    root = sys.argv[1]
    cooked = os.path.join(root, 'CookedPCConsole')
    loc_dir = next(d for d in (os.path.join(root, 'INT2'), os.path.join(root, 'INT'))
                   if os.path.exists(os.path.join(d, 'XComGame.int')))
    ini = next(p for p in (os.path.join(root, 'DefaultGameCore.ini'),
                           os.path.join(root, 'Config', 'DefaultGameCore.ini')) if os.path.exists(p))

    _, game = load(os.path.join(cooked, 'XComGame.upk'))
    _, pk = load(os.path.join(cooked, 'XComStrategyGame.upk'))
    found = enums(game)
    item_enum = enum_values(game, found['EItemType'])
    tech_enum = enum_values(game, found['ETechType'])
    foundry_enum = enum_values(game, found['EFoundryTech'])
    ship_enum = enum_values(game, found['EShipType'])
    item_name = names(item_enum, localized(os.path.join(loc_dir, 'XComGame.int'), 'm_aItemNames'))
    ship_name = names(ship_enum, localized(os.path.join(loc_dir, 'XComStrategyGame.int'), 'ShipTypeNames'))

    def item(i):
        return {'id': i, 'name': item_name(i)}

    # BuildTech calls.
    techs = {}
    for _, s in statements(pk, 'XGTechTree.BuildTechs'):
        m = re.fullmatch(r'BuildTech\((.*)\)', s)
        if not m:
            continue
        a = [x.strip() for x in m.group(1).split(',')] + [''] * 7
        v = lambda x: num(x) if x else 0  # noqa: E731
        tid = v(a[0])
        techs[tid] = {
            'id': tid, 'enum': tech_enum[tid], 'custom': a[2] == 'true',
            'tech': v(a[4]), 'item': v(a[3]), 'grants_credit': v(a[6]),
        }

    # Custom requirements: HasPrereqs' switch(iTech), each case returning a condition.
    custom = {}; pending = []
    for _, s in statements(pk, 'XGTechTree.HasPrereqs'):
        if m := re.fullmatch(r'case (\d+):', s):
            pending.append(int(m.group(1)))
        elif s.startswith('return ') and pending:
            for c in pending:
                custom[c] = s[len('return '):]
            pending = []

    corpse_line = statements(pk, 'XGStorage.HasXenobiologyCorpse')[0][1]
    corpses = sorted({int(x) for x in re.findall(r'm_arrItems\[(\d+)\]', corpse_line)})
    captive = ' '.join(s for _, s in statements(pk, 'XGFacility_Labs.HasInterrogatedCaptive'))
    lo, hi = (int(x) for x in re.search(r'iInterrogation = (\d+).*iInterrogation <= (\d+)', captive).groups())

    out_techs = []
    for tid in sorted(techs):
        t = techs[tid]
        e = {'id': tid, 'enum': t['enum'], 'requires': [t['tech']] if t['tech'] else []}
        if t['item']:
            e['ever_had'] = item(t['item'])
        cond = custom.get(tid, '') if t['custom'] else ''
        rest = cond
        for n in re.findall(r'LABS\(\)\.IsResearched\((\d+)\)', cond):
            e['requires'].append(int(n))
        rest = re.sub(r'LABS\(\)\.IsResearched\(\d+\)', '', rest)
        if 'STORAGE().HasXenobiologyCorpse()' in rest:
            e['in_stores'] = {'any_of': [item(i) for i in corpses], 'name': 'an alien corpse'}
            rest = rest.replace('STORAGE().HasXenobiologyCorpse()', '')
        if 'LABS().HasInterrogatedCaptive()' in rest:
            e['any_of'] = list(range(lo, hi + 1))
            rest = rest.replace('LABS().HasInterrogatedCaptive()', '')
        if m := re.search(r'\(STORAGE\(\)\.GetNumItemsAvailable\((\d+)\) > 0\)', rest):
            e['in_stores'] = {'any_of': [item(int(m.group(1)))], 'name': item_name(int(m.group(1)))}
            rest = rest.replace(m.group(0), '')
        # LWR: one analysis for several types, any of them captured.
        caps = re.findall(r'\(GEOSCAPE\(\)\.self\.m_arrCraftEncounters\[(\d+)\] > 0\)', rest)
        if caps:
            e['captured'] = {'any_of': [{'id': int(c), 'name': ship_name(int(c))} for c in caps]}
            rest = re.sub(r'\(GEOSCAPE\(\)\.self\.m_arrCraftEncounters\[\d+\] > 0\)', '', rest).replace('||', '')
        if m := re.search(r'\(GEOSCAPE\(\)\.self\.m_arrCraftEncounters\[\(iTech - (\d+)\)\] != 0\)', rest):
            ship = tid - int(m.group(1))
            # Counted after a won crash-site or landed-UFO mission (XGStrategy.PostCombat).
            e['captured'] = {'id': ship, 'name': ship_name(ship)}
            rest = rest.replace(m.group(0), '')
        if re.sub(r'[()&\s]', '', rest):
            sys.exit(f'tech {tid}: unrecognised requirement {cond!r} (left: {rest!r})')
        e['requires'] = sorted(set(e['requires']))
        if t['grants_credit']:
            e['grants_credit'] = t['grants_credit']
        out_techs.append(e)

    # Research credits.
    bonus = {}
    for _, s in statements(pk, 'XGTechTree.BuildResearchCredits'):
        if m := re.fullmatch(r'BuildResearchCredit\((b?\d+), (\d+), .*\)', s):
            bonus[num(m.group(1))] = int(m.group(2))
    tech_cov = cases(statements(pk, 'XGTechTree.CreditAppliesToTech'))
    foundry_cov = cases(statements(pk, 'XGTechTree.CreditAppliesToFoundryTech'))
    for e in out_techs:
        e['credits'] = sorted(c for c, ts in tech_cov.items() if ts is None or e['id'] in ts)

    # Foundry: requirements from the INI's FoundryBalance lines, as BalanceFoundry reads them.
    lines = statements(pk, 'XGTechTree.HasFoundryPrereqs')
    ever = {}
    for i, (_, s) in enumerate(lines):
        if m := re.fullmatch(r'if !\(\(iFoundryTech == (\d+)\)\) goto \d+', s):
            n = re.fullmatch(r'if !\(!\(STORAGE\(\)\.EverHadItem\((\d+)\)\)\) goto \d+', lines[i + 1][1])
            if not n:
                sys.exit(f'HasFoundryPrereqs: unrecognised check after {s!r}')
            ever[int(m.group(1))] = int(n.group(1))
    text = open(ini, encoding='latin-1').read()
    foundry = []
    for m in re.finditer(r'^FoundryBalance=\((.*?)\)', text, re.M):
        kv = {k.strip(): v.strip() for k, v in
              (p.split('=', 1) for p in m.group(1).split(',') if '=' in p)}

        def val(x, values):
            return int(x) if x.isdigit() else values.index(x)
        fid = val(kv['eTech'], foundry_enum)
        e = {'id': fid, 'requires': val(kv['eReqTech'], tech_enum)}
        if foundry_enum[fid].startswith('eFoundry_') and foundry_enum[fid] != 'eFoundry_MAX':
            e['enum'] = foundry_enum[fid]  # Long War's projects past 24 reuse other enums' numbers
        req_item = val(kv['eReqItem'], item_enum)
        if req_item:
            e['in_stores'] = item(req_item)
        if fid in ever:
            e['ever_had'] = item(ever[fid])
        e['credits'] = sorted(c for c, ps in foundry_cov.items() if ps is None or fid in ps)
        foundry.append(e)

    json.dump({
        'source': 'Long War 1.0 XComStrategyGame.upk (XGTechTree), FoundryBalance in '
                  'DefaultGameCore.ini, names from the INT localization; read by scripts/upk_techtree.py',
        'credit_bonus': {str(k): v for k, v in sorted(bonus.items())},
        'techs': out_techs,
        'foundry': sorted(foundry, key=lambda e: e['id']),
    }, sys.stdout, indent=1)
    print()


if __name__ == '__main__':
    main()
