#!/usr/bin/env python3
"""LWR's own class colours, read from its mutator's script
(RebalanceMutator.ChangeArmorTint in LWRebalance.u): with the INI's
SOLDIER_COST_CLASSIC at 1 (LWR's own), a soldier's armor tint is set by class
at the promotion to Lance Corporal (ability tree branch 1), and set again by
some perks chosen after. With it at 0 the function does nothing and the INI's
class colours (HQ_BASE_POWER) stand.

    python3 scripts/lwr_class_tints.py <LWRebalance.u> <XComGame.upk> <XComGame.int> \
        > data/lwr/class-tints.json

Perks are named by the INT's m_strPassiveTitle, through the XComGame.upk's
EPerkType (Long War reuses perk slots: the name is the one the game shows).
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from upk import enum_values, enums, load  # noqa: E402
from upk_script import statements  # noqa: E402


def perk_names(upk_path, int_path):
    _, game = load(upk_path)
    values = enum_values(game, enums(game)['EPerkType'])
    raw = open(int_path, 'rb').read()
    text = raw.decode('utf-16') if raw[:2] == b'\xff\xfe' else raw.decode('latin-1')
    titles = dict(re.findall(r'^m_strPassiveTitle\[(\w+)\]="([^"]*)"', text, re.M))
    return {i: titles.get(v, v) for i, v in enumerate(values)}


def main():
    _, pk = load(sys.argv[1])
    perks = perk_names(sys.argv[2], sys.argv[3])
    names = {}
    energy = None
    for _, s in statements(pk, 'RebalanceMutator.EnergyToClass'):
        if m := re.search(r'iEnergy == (\d+)', s):
            energy = [int(x) for x in re.findall(r'iEnergy == (\d+)', s)]
        elif m := re.search(r"sClass = TrN\('(\w+)'\)", s):
            for e in energy or []:
                names[e] = m.group(1)
            energy = None

    classes = {}
    cur = None
    branch1 = False
    perk = None
    for _, s in statements(pk, 'RebalanceMutator.ChangeArmorTint'):
        if 'GetEnergy() ==' in s:
            cur = [int(x) for x in re.findall(r'GetEnergy\(\) == (\d+)', s)]
            branch1 = False
            perk = None
        elif 'iAbilityTreeBranch == 1' in s:
            branch1, perk = True, None
        elif m := re.search(r'Perk == (\d+)', s):
            branch1, perk = False, int(m.group(1))
        elif m := re.search(r'iArmorTint = (\d+)', s):
            for e in cur or []:
                c = classes.setdefault(e, {'energy': e, 'class': names.get(e, str(e)), 'tint': None, 'byPerk': []})
                if branch1:
                    c['tint'] = int(m.group(1))
                elif perk is not None:
                    c['byPerk'].append({'perk': perk, 'name': perks.get(perk, str(perk)), 'tint': int(m.group(1))})
    out = {
        'generated': 'by scripts/lwr_class_tints.py from LWRebalance.u (RebalanceMutator.ChangeArmorTint)',
        'option': 'SOLDIER_COST_CLASSIC',
        'classes': sorted(classes.values(), key=lambda c: c['energy']),
    }
    json.dump(out, sys.stdout, indent=1)
    print()


if __name__ == '__main__':
    main()
