#!/usr/bin/env python3
"""Extract enum lists from Enemy Within's script packages into data/enums.json.

The save stores items, techs, Foundry projects, facilities and research
credits by number; these enums say which number is which. They are read from
the player's own install (the packages are Firaxis's and are not committed):

    python3 scripts/upk_enums.py samples/CookedPCConsole > data/enums.json

Long War ships XComGame.upk and XComStrategyGame.upk decompressed, which is
what scripts/upk.py reads.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from upk import enum_values, enums, load  # noqa: E402

WANTED = {
    'XComGame.upk': ['EItemType', 'ETechType', 'EFoundryTech', 'EFacilityType', 'EResearchCredits', 'EShipType'],
}


def main():
    cooked = sys.argv[1]
    out = {'source': 'XEW/XComGame/CookedPCConsole (Long War 1.0), read by scripts/upk_enums.py', 'enums': {}}
    for pkg, names in WANTED.items():
        info, pk = load(os.path.join(cooked, pkg))
        if pk is None:
            sys.exit(f'{pkg} is compressed: {info}')
        found = enums(pk)
        for name in names:
            out['enums'][name] = enum_values(pk, found[name])
    json.dump(out, sys.stdout, indent=1)


if __name__ == '__main__':
    main()
