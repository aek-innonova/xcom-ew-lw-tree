#!/usr/bin/env python3
"""Extract the air war's ships, weapons and rules into data/airwar.json.

    python3 scripts/upk_airwar.py samples > data/airwar.json

Reads, from the player's own install (kept out of the repository):
- XComStrategyGame.upk: XGItemTree.BuildShips, BuildShipWeapons and
  UpdateShips (which INI line feeds which stat, the Foundry projects and
  second-wave option that add to it, how UFOs grow with the alien research
  category, which UFO types change weapons at which category) and
  XGInterceptionEngagement.UpdateEngagementResult (the chance a downed UFO
  is destroyed rather than crashed);
- DefaultGameCore.ini: the numbers (Long War reuses ContBalance_Classic
  lines for the air war, each labelled with a comment);
- the INT localization: ship, weapon and consumable names.

The combat rules themselves (to-hit, damage, stances, consumables) are
code, not data, and live in src/model/airwar.ts with their sources; see
features/air-war.md.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from upk import enum_values, enums, load  # noqa: E402
from upk_script import statements  # noqa: E402
from upk_techtree import localized  # noqa: E402


class Sym:
    """A stat as the game computes it: a base, plus amounts that apply when a
    Foundry project is done or a second-wave option is on, plus an amount per
    alien research category."""

    def __init__(s, base=0.0, foundry=None, option=None, per_category=0.0):
        s.base = base; s.foundry = dict(foundry or {}); s.option = dict(option or {}); s.per_category = per_category

    @staticmethod
    def of(x):
        return x if isinstance(x, Sym) else Sym(float(x))

    def __add__(s, o):
        o = Sym.of(o)
        f = dict(s.foundry); [f.__setitem__(k, f.get(k, 0) + v) for k, v in o.foundry.items()]
        p = dict(s.option); [p.__setitem__(k, p.get(k, 0) + v) for k, v in o.option.items()]
        return Sym(s.base + o.base, f, p, s.per_category + o.per_category)
    __radd__ = __add__

    def scale(s, k):
        return Sym(s.base * k, {i: v * k for i, v in s.foundry.items()},
                   {i: v * k for i, v in s.option.items()}, s.per_category * k)

    def __mul__(s, o):
        if isinstance(o, Cat):
            assert not s.foundry and not s.option and not s.per_category
            return Sym(0.0, per_category=s.base)
        return s.scale(float(o))
    __rmul__ = __mul__

    def __truediv__(s, o):
        return s.scale(1 / float(o))

    def json(s):
        num = lambda x: int(x) if float(x).is_integer() else round(x, 4)  # noqa: E731
        out = {'base': num(s.base)}
        if s.foundry: out['foundry'] = {str(k): num(v) for k, v in s.foundry.items()}
        if s.option: out['option'] = {str(k): num(v) for k, v in s.option.items()}
        if s.per_category: out['per_category'] = num(s.per_category)
        return out


class Cat:
    def __rmul__(s, o): return Sym.of(o) * s
    __mul__ = __rmul__


def when(kind):
    def f(n, x):
        return Sym(0.0, **{kind: {n: Sym.of(x).base}})
    return f


def ini_values(path):
    text = open(path, encoding='latin-1').read()
    rows = {}
    for m in re.finditer(r'^ContBalance_Classic\[(\d+)\]=\((.*?)\)', text, re.M):
        rows[int(m.group(1))] = {k.strip(): int(v) for k, v in
                                 (p.split('=') for p in m.group(2).split(',') if '=' in p)}
    consts = {m.group(1): float(m.group(2)) for m in re.finditer(r'^(\w+)\s*=\s*(-?[\d.]+)f?', text, re.M)}
    return rows, consts


def evaluate(expr, rows, consts):
    e = expr
    e = re.sub(r'XGTacticalGameCore::default\.ContBalance_Classic\[(\d+)\]\.(\w+)',
               lambda m: str(rows[int(m.group(1))].get(m.group(2), 0)), e)
    e = re.sub(r'XGTacticalGameCore::default\.(\w+)', lambda m: str(consts[m.group(1)]), e)
    e = re.sub(r'ENGINEERING\(\)\.IsFoundryTechResearched\((\d+)\) \? (-?[\d.]+) : 0', r'F(\1, \2)', e)
    e = re.sub(r'IsOptionEnabled\(b(\d+)\) \? (-?[\d.]+) : 0', r'O(\1, \2)', e)
    e = e.replace('self.m_iCurrentCategory', 'CAT')
    e = re.sub(r'\bb(\d+)\b', r'\1', e)
    if re.search(r'[A-Za-z_]', re.sub(r'\b(F|O|CAT)\b', '', e)):
        raise ValueError(f'cannot evaluate {expr!r} -> {e!r}')
    return Sym.of(eval(e, {'__builtins__': {}}, {'F': when('foundry'), 'O': when('option'), 'CAT': Cat()}))


def args(call):
    inner = call[call.index('(') + 1:call.rindex(')')]
    out, depth, cur = [], 0, ''
    for ch in inner:
        if ch == ',' and depth == 0:
            out.append(cur.strip()); cur = ''
            continue
        depth += ch == '('; depth -= ch == ')'; cur += ch
    out.append(cur.strip())
    return out


def structure(lines):
    """Nest if/else blocks: [('do', text) | ('if', cond, then, else)], using
    the memory offsets that jump targets point at."""
    out = []; i = 0
    while i < len(lines):
        at, mem, s = lines[i]
        m = re.fullmatch(r'if !\((.*)\) goto (\d+)', s)
        if not m:
            out.append(('do', s)); i += 1
            continue
        target = int(m.group(2)); j = i + 1
        while j < len(lines) and lines[j][1] < target:
            j += 1
        then = lines[i + 1:j]; other = []
        g = re.fullmatch(r'goto (\d+)', then[-1][2]) if then else None
        if g and int(g.group(1)) > target:
            end = int(g.group(1)); k = j
            while k < len(lines) and lines[k][1] < end:
                k += 1
            then, other, j = then[:-1], lines[j:k], k
        out.append(('if', m.group(1), structure(then), structure(other)))
        i = j
    return out


def main():
    root = sys.argv[1]
    cooked = os.path.join(root, 'CookedPCConsole')
    loc = next(d for d in (os.path.join(root, 'INT2'), os.path.join(root, 'INT'))
               if os.path.exists(os.path.join(d, 'XComGame.int')))
    ini = next(p for p in (os.path.join(root, 'DefaultGameCore.ini'),
                           os.path.join(root, 'Config', 'DefaultGameCore.ini')) if os.path.exists(p))
    rows, consts = ini_values(ini)
    _, game = load(os.path.join(cooked, 'XComGame.upk'))
    _, pk = load(os.path.join(cooked, 'XComStrategyGame.upk'))
    found = enums(game)
    ship_enum = enum_values(game, found['EShipType'])
    item_enum = enum_values(game, found['EItemType'])
    ship_names = localized(os.path.join(loc, 'XComStrategyGame.int'), 'ShipTypeNames')
    weapon_names = localized(os.path.join(loc, 'XComStrategyGame.int'), 'ShipWeaponNames')
    item_names = localized(os.path.join(loc, 'XComGame.int'), 'm_aItemNames')
    weapon_enum = [k for k in weapon_names]  # in declaration order: eShipWeapon_Cannon is 1

    ships, weapons, upgrades, variants = {}, {}, [], []

    def build_ship(a, cond=None):
        t = int(a[0].lstrip('b'))
        w = [int(x.lstrip('b')) for x in a[3:5] if x and x.lstrip('b') != '0']
        # Size class (m_strSizeSmall …) and the picture the game shows (eShipImage).
        look = {'size': re.sub(r'(?<!^)(?=[A-Z])', '_', a[1].removeprefix('self.m_strSize')).lower(),
                'image': int(a[2].lstrip('b'))}
        if cond is None:
            ships.setdefault(t, {}).update(weapons=w, **look)
        return t, w, look

    def update_ship(a):
        t = int(a[0].lstrip('b'))
        keys = ['speed', 'battle_speed', 'hp', 'armor', 'ap']
        return t, {k: evaluate(x, rows, consts).json() for k, x in zip(keys, a[1:6])}

    def build_weapon(a):
        t = int(a[0].lstrip('b'))
        keys = ['ammo', 'range', 'firing_time', 'damage', 'ap', 'to_hit']
        return t, {k: evaluate(x, rows, consts).json() for k, x in zip(keys, a[1:7])}

    for _, s in statements(pk, 'XGItemTree.BuildShips'):
        if s.startswith('BuildShip('):
            build_ship(args(s))
    for _, s in statements(pk, 'XGItemTree.BuildShipWeapons'):
        if s.startswith('BuildShipWeapon('):
            t, w = build_weapon(args(s)); weapons[t] = w

    def walk(nodes, conds):
        for n in nodes:
            if n[0] == 'if':
                c = n[1]
                walk(n[2], conds + [c]); walk(n[3], conds + ['!' + c])
                continue
            s = n[1]
            if not conds:
                if s.startswith('UpdateShip('):
                    t, v = update_ship(args(s)); ships.setdefault(t, {}).update(v)
                elif s.startswith('BuildShipWeapon('):
                    t, v = build_weapon(args(s)); weapons[t] = v
                continue
            cat = re.fullmatch(r'\(self\.m_iCurrentCategory > (\d+)\)', conds[-1])
            fdy = re.fullmatch(r'(!?)ENGINEERING\(\)\.IsFoundryTechResearched\((\d+)\)', conds[-1])
            if cat and len(conds) == 1:
                change = {'above_category': int(cat.group(1))}
                if s.startswith('BuildShip('):
                    t, w, look = build_ship(args(s), cat); change.update(ship=t, weapons=w, **look)
                elif s.startswith('UpdateShip('):
                    t, v = update_ship(args(s)); change.update(ship=t, stats=v)
                else:
                    raise SystemExit(f'UpdateShips: unexpected {s!r} under {conds}')
                upgrades.append(change)
            elif fdy and len(conds) == 1:
                fid = int(fdy.group(2)); done = not fdy.group(1)
                if s.startswith('BuildShipWeapon('):
                    t, v = build_weapon(args(s))
                    if done:
                        variants.append({'weapon': t, 'foundry': fid, 'stats': v})
                    else:
                        weapons[t] = v
                elif s.startswith('BuildShip(') and done:
                    t, w, _ = build_ship(args(s), fdy)
                    variants.append({'ship': t, 'foundry': fid, 'weapons': w})
                elif s.startswith('UpdateAllShipTemplates') or s.startswith('goto'):
                    pass
                else:
                    raise SystemExit(f'UpdateShips: unexpected {s!r} under {conds}')
            elif conds == ['(ENGINEERING() op0x72 none)']:
                pass  # "no Engineering yet": return early
            else:
                raise SystemExit(f'UpdateShips: unexpected condition {conds}')

    walk(structure(statements(pk, 'XGItemTree.UpdateShips', mem=True)), [])

    # A downed UFO: destroyed with chance (overkill / k) %; first matching case wins.
    destroy = {}; pending = []; always_crash = []
    for _, s in statements(pk, 'XGInterceptionEngagement.UpdateEngagementResult'):
        if m := re.fullmatch(r'case (\d+):', s):
            pending.append(int(m.group(1)))
        elif m := re.search(r'm_iHP / -(\d+)\)\)\) goto', s):
            for t in pending:
                destroy.setdefault(t, int(m.group(1)))
            pending = []
        elif s.endswith('m_eUFOResult = b1') and pending:
            always_crash += pending; pending = []
        elif s == 'default:':
            break

    def ship_name(t):
        return ship_names.get(ship_enum[t]) or ship_names.get(str(t)) or ship_enum[t]

    consumables = {n: item_enum.index(n) for n in
                   ('eItem_IntConsumable_Hit', 'eItem_IntConsumable_Dodge', 'eItem_IntConsumable_Boost')}
    out = {
        'source': 'Long War 1.0 XComStrategyGame.upk (XGItemTree, XGInterceptionEngagement), '
                  'ContBalance_Classic in DefaultGameCore.ini, names from the INT localization; '
                  'read by scripts/upk_airwar.py',
        'ships': [{'id': t, 'name': ship_name(t), **v} for t, v in sorted(ships.items()) if 'hp' in v],
        'weapons': [{'id': t, 'name': weapon_names.get(weapon_enum[t - 1], str(t)), **v}
                    for t, v in sorted(weapons.items())],
        'ufo_changes': upgrades,
        'foundry_variants': variants,
        'destroy_divisor': {str(k): v for k, v in sorted(destroy.items())},
        'always_crash': sorted(set(always_crash)),
        'consumables': {k.removeprefix('eItem_IntConsumable_').lower(): {'item': v, 'name': item_names.get(k, k)}
                        for k, v in consumables.items()},
        # Interceptor weapons as items in stores, and the ship weapon each one is.
        'equipment': [{'item': item_enum.index(f'eItem_IntWeap_{r}'), 'name': item_names.get(f'eItem_IntWeap_{r}'),
                       'weapon': next(t for t, n in enumerate(weapon_enum, 1)
                                      if weapon_names[n] == item_names.get(f'eItem_IntWeap_{r}'))}
                      for r in ('I', 'II', 'III', 'IV', 'V', 'VI')],
    }
    json.dump(out, sys.stdout, indent=1)
    print()


if __name__ == '__main__':
    main()
