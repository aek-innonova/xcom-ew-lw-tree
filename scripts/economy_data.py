#!/usr/bin/env python3
"""What a version's base costs to keep, from its own files: each facility's
upkeep (the INI's FacilityBalance iMaintenance, times
FACILITY_MAINTENANCE_BALANCE, as XGItemTree.GetFacilityMaintenanceCost does)
with its name (the INT's m_aFacilityNames), and the Skyranger's upkeep
(BASE_SKYRANGER_MAINTENANCE). Long War 1.0 counts it per month, LWR per day
(its INI says so).

    python3 scripts/economy_data.py lw <ini> <XComStrategyGame.int> lwr <ini> <int> > data/economy.json
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from game_data import ini_lines  # noqa: E402

FACILITIES = json.load(open(os.path.join(os.path.dirname(__file__), '../data/enums.json')))['enums']['EFacilityType']


def version(ini_path, int_path):
    ini = open(ini_path, encoding='latin-1').read()
    loc = open(int_path, encoding='utf-16' if open(int_path, 'rb').read(2) == b'\xff\xfe' else 'latin-1').read()
    names = dict(re.findall(r'^m_aFacilityNames\[(\w+)\]="([^"]*)"', loc, re.M))
    const = lambda k: float(re.search(rf'^{k}\s*=\s*(-?[\d.]+)', ini, re.M).group(1))  # noqa: E731
    per_day = bool(re.search(r'^BASE_SKYRANGER_MAINTENANCE\s*=.*per day', ini, re.M | re.I))
    balance = const('FACILITY_MAINTENANCE_BALANCE')
    facilities = []
    for kv in ini_lines(ini, 'FacilityBalance'):
        enum = kv['eFacility']
        upkeep = int(kv.get('iMaintenance', '0') or 0)
        if upkeep <= 0:
            continue
        facilities.append({
            'id': FACILITIES.index(enum),
            'enum': enum,
            'name': names.get(enum, enum),
            'upkeep': round(upkeep * balance),
        })
    return {
        'per': 'day' if per_day else 'month',
        'facilities': facilities,
        'skyranger': int(const('BASE_SKYRANGER_MAINTENANCE')),
    }


if __name__ == '__main__':
    a = sys.argv[1:]
    out = {'generated': 'by scripts/economy_data.py from each version\'s DefaultGameCore.ini and INT'}
    for i in range(0, len(a), 3):
        out[a[i]] = version(a[i + 1], a[i + 2])
    json.dump(out, sys.stdout, indent=1)
    print()
