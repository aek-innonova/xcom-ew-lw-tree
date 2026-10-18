"""Render the air war's pictures with Blender: the eleven UFO types and our two
jets, as our own models built from simple shapes here.

    blender -b -P scripts/ufo_art.py -- public/ships [type ...]

Each is meant to be recognisable as its class in Enemy Unknown's look, the
way UFOpaedia shows them (the Scout's thick, scooped saucer, the Destroyer's
wide flat oval, the Abductor's turreted block, the Transport's thruster
cluster, the Battleship's long winged hull and ring wheels, the Overseer's
violet lens, the Interceptor's twin-tailed jet, the Firestorm's crescent),
without copying the game's art, which stays Firaxis's. Long War's five extra
types share a parent's shape (as the game shares its pictures) plus a
feature of their own.

Writes <EShipType>.webp, 400 × 200, transparent; UFOs in three-quarter view
from slightly above, the jets in profile facing right (as they fly in the
fight). Cycles on the CPU, a few seconds each.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = ARGS[0] if ARGS else 'public/ships'
ONLY = [int(x) for x in ARGS[1:]]

# --- Scene -------------------------------------------------------------------


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 256
    sc.cycles.use_denoising = False
    sc.render.film_transparent = True
    sc.render.resolution_x, sc.render.resolution_y = 400, 200
    sc.render.image_settings.file_format = 'WEBP'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.quality = 88
    sc.view_settings.view_transform = 'Filmic'
    sc.view_settings.look = 'Medium High Contrast'
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    nodes = world.node_tree.nodes
    sky = nodes.new('ShaderNodeTexSky')
    sky.sky_type = 'HOSEK_WILKIE'
    sky.sun_direction = (0.4, -0.6, 0.7)
    world.node_tree.links.new(sky.outputs['Color'], nodes['Background'].inputs['Color'])
    nodes['Background'].inputs['Strength'].default_value = 0.35
    sc.world = world
    for name, loc, energy, size, color in (
        ('key', (3, -4, 4), 900, 4, (1.0, 0.96, 0.9)),
        ('rim', (-4, 4, 2), 800, 4, (0.55, 0.8, 1.0)),
        ('fill', (-1, -5, -1.5), 140, 6, (0.8, 0.85, 1.0)),
    ):
        light = bpy.data.lights.new(name, 'AREA')
        light.energy, light.size, light.color = energy, size, color
        o = bpy.data.objects.new(name, light)
        o.location = loc
        o.rotation_euler = (-Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        sc.collection.objects.link(o)
    return sc


SPECS = {
    # Hulls carry a panel grid (a brick texture as bump), Enemy Unknown's look.
    'hull': dict(color=(0.30, 0.32, 0.36), metal=0.9, rough=0.32, panels=3),
    'hull_light': dict(color=(0.55, 0.57, 0.61), metal=0.9, rough=0.28, panels=3),
    'hull_dark': dict(color=(0.10, 0.10, 0.13), metal=0.85, rough=0.38, panels=3),
    'ethereal': dict(color=(0.20, 0.12, 0.30), metal=0.9, rough=0.2, panels=3),
    'xcom': dict(color=(0.62, 0.65, 0.68), metal=0.7, rough=0.3, panels=0),
    'xcom_dark': dict(color=(0.16, 0.18, 0.2), metal=0.6, rough=0.4, panels=0),
    'panel': dict(color=(0.04, 0.04, 0.05), metal=0.4, rough=0.6),
    'glass': dict(color=(0.03, 0.06, 0.08), metal=0.2, rough=0.03, emit=(0.25, 0.85, 1.0), strength=0.6),
    'cyan': dict(color=(0.2, 0.8, 1.0), metal=0, rough=0.4, emit=(0.25, 0.85, 1.0), strength=9),
    'violet': dict(color=(0.7, 0.3, 1.0), metal=0, rough=0.4, emit=(0.72, 0.35, 1.0), strength=9),
    'amber': dict(color=(1.0, 0.6, 0.2), metal=0, rough=0.4, emit=(1.0, 0.55, 0.15), strength=9),
    'red': dict(color=(1.0, 0.25, 0.15), metal=0, rough=0.4, emit=(1.0, 0.22, 0.1), strength=9),
    'green': dict(color=(0.4, 1.0, 0.5), metal=0, rough=0.4, emit=(0.4, 1.0, 0.5), strength=8),
}
MATS = {}


def mat(name):
    if name in MATS:
        return MATS[name]
    spec = SPECS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*spec['color'], 1)
    b.inputs['Metallic'].default_value = spec['metal']
    b.inputs['Roughness'].default_value = spec['rough']
    if 'emit' in spec:
        b.inputs['Emission Color'].default_value = (*spec['emit'], 1)
        b.inputs['Emission Strength'].default_value = spec['strength']
    if spec.get('panels'):
        coord = nt.nodes.new('ShaderNodeTexCoord')
        brick = nt.nodes.new('ShaderNodeTexBrick')
        brick.inputs['Scale'].default_value = spec['panels']
        brick.inputs['Mortar Size'].default_value = 0.008
        brick.inputs['Color1'].default_value = (1, 1, 1, 1)
        brick.inputs['Color2'].default_value = (0.85, 0.85, 0.85, 1)
        brick.inputs['Mortar'].default_value = (0, 0, 0, 1)
        bump = nt.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 0.15
        nt.links.new(coord.outputs['Object'], brick.inputs['Vector'])
        nt.links.new(brick.outputs['Fac'], bump.inputs['Height'])
        nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    MATS[name] = m
    return m


def finish(ob, material, smooth=True):
    if ob.name not in bpy.context.scene.collection.objects:
        bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.clear()
    ob.data.materials.append(mat(material))
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    return ob


# --- Shapes ------------------------------------------------------------------


def lathe(profile, material, segments=128, sx=1.0, sy=1.0, z=0.0, x=0.0, square=2.0):
    """Revolve (radius, height) points, top to bottom, around the vertical
    axis. `square` above 2 rounds the plan towards a square (a superellipse)."""
    verts, faces, n = [], [], len(profile)
    for s in range(segments):
        a = 2 * math.pi * s / segments
        c, d = math.cos(a), math.sin(a)
        k = (abs(c) ** square + abs(d) ** square) ** (-1 / square)
        for r, h in profile:
            verts.append((x + r * c * k * sx, r * d * k * sy, z + h))
    for s in range(segments):
        t = (s + 1) % segments
        for i in range(n - 1):
            faces.append((s * n + i, t * n + i, t * n + i + 1, s * n + i + 1))
    me = bpy.data.meshes.new('lathe')
    me.from_pydata(verts, [], faces)
    return finish(bpy.data.objects.new('lathe', me), material)


def band(r, h, material, w=0.03, t=0.012, **kw):
    """A thin ring standing proud of a surface: a seam or a light strip."""
    return lathe([(r - w / 2, h + t), (r + w / 2, h + t), (r + w / 2, h - t), (r - w / 2, h - t), (r - w / 2, h + t)],
                 material, **kw)


def ball(loc, r, material, scale=(1, 1, 1), segments=24):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=segments, ring_count=segments // 2)
    ob = bpy.context.active_object
    ob.scale = scale
    return finish(ob, material)


def lights(r, h, n, size, material, sx=1.0, sy=1.0, phase=0.0, arc=(0, 2 * math.pi), square=2.0):
    for i in range(n):
        a = arc[0] + (arc[1] - arc[0]) * (i + phase) / n
        c, d = math.cos(a), math.sin(a)
        k = (abs(c) ** square + abs(d) ** square) ** (-1 / square)
        ball((r * c * k * sx, r * d * k * sy, h), size, material, segments=12)


def box(size, loc, material, bevel=0.04, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        m = ob.modifiers.new('bevel', 'BEVEL')
        m.width, m.segments = bevel, 3
    return finish(ob, material, smooth=False)


def rod(a, b, r, material, vertices=24):
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, location=(a + b) / 2, vertices=vertices)
    ob = bpy.context.active_object
    ob.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return finish(ob, material)


def ring(loc, major, minor, material, axis=(1, 0, 0)):
    """A torus whose hole looks along `axis`."""
    bpy.ops.mesh.primitive_torus_add(location=loc, major_radius=major, minor_radius=minor,
                                     major_segments=48, minor_segments=16)
    ob = bpy.context.active_object
    ob.rotation_euler = Vector(axis).to_track_quat('Z', 'Y').to_euler()
    return finish(ob, material)


def cone(loc, r, depth, material, rot=(0, 0, 0), r2=0.0):
    bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot, vertices=24)
    return finish(bpy.context.active_object, material, smooth=False)


def plate(points, thickness, material, bevel=0.012):
    """A flat polygon (x, y, z points) given thickness: fins and wings."""
    me = bpy.data.meshes.new('plate')
    me.from_pydata(points, [], [tuple(range(len(points)))])
    ob = finish(bpy.data.objects.new('plate', me), material, smooth=False)
    m = ob.modifiers.new('solid', 'SOLIDIFY')
    m.thickness, m.offset = thickness, 0
    if bevel:
        b = ob.modifiers.new('bevel', 'BEVEL')
        b.width, b.segments = bevel, 2
    return ob


def carve(target, cutter):
    """Cut `cutter` out of `target` (a scoop or a bay) and drop the cutter."""
    m = target.modifiers.new('carve', 'BOOLEAN')
    m.operation, m.object, m.solver = 'DIFFERENCE', cutter, 'EXACT'
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(cutter)


def scoop(target, loc, size, glow):
    """Enemy Unknown's arched intake in a saucer's front: carved, lit inside."""
    cutter = ball(loc, 1.0, 'panel', scale=size)
    carve(target, cutter)
    ball((loc[0], loc[1] + size[1] * 0.55, loc[2]), 1.0, 'panel', scale=(size[0] * 0.75, 0.05, size[2] * 0.7))
    ball((loc[0], loc[1] + size[1] * 0.5, loc[2] - size[2] * 0.15), 0.035, glow)


# --- The UFOs ------------------------------------------------------------------

PILLOW = [(0, 0.34), (0.5, 0.33), (0.8, 0.26), (0.96, 0.13), (1.0, 0.0), (0.96, -0.12), (0.8, -0.2),
          (0.4, -0.24), (0, -0.24)]
OVAL = [(0, 0.2), (0.6, 0.18), (0.9, 0.1), (1.0, 0.02), (1.02, 0.0), (1.0, -0.04), (0.9, -0.08), (0.6, -0.13),
        (0, -0.14)]


def scout_hull(scale=1.0):
    """Thick, rounded-square saucer with side bulges and a front scoop."""
    kw = dict(square=2.6, sx=1.0 * scale, sy=0.85 * scale)
    hull = lathe([(r, h * scale) for r, h in PILLOW], 'hull', **kw)
    scoop(hull, (0, -0.86 * scale, 0.02), (0.36 * scale, 0.22 * scale, 0.16 * scale), 'cyan')
    band(0.62, 0.3 * scale, 'panel', **kw)
    band(0.9, 0.18 * scale, 'panel', **kw)
    for s in (-1, 1):
        ball((0.88 * s * scale, 0.05, 0.03), 0.2 * scale, 'hull', scale=(0.55, 1.3, 0.75))
        ball((1.0 * s * scale, -0.12 * scale, 0.03), 0.03, 'cyan')
    lights(0.99, -0.02, 7, 0.022, 'cyan', arc=(math.pi * 1.2, math.pi * 1.8), **kw)


def scout():
    scout_hull()


def fighter():
    scout_hull(0.85)
    for s in (-1, 1):
        plate([(0.55 * s, -0.2, -0.02), (1.35 * s, 0.35, -0.12), (1.45 * s, 0.7, -0.14), (1.1 * s, 0.7, -0.1),
               (0.6 * s, 0.4, -0.02)], 0.05, 'hull_dark')
        ball((1.4 * s, 0.6, -0.13), 0.04, 'cyan')
    plate([(0, 0.35, 0.25), (0, 0.8, 0.55), (0, 0.95, 0.55), (0, 0.75, 0.22)], 0.04, 'hull_dark')


def oval_hull(sx=1.35, sy=1.0, material='hull', glow='cyan', scale=1.0):
    """The wide, flat oval with a layered rim and a front scoop."""
    kw = dict(sx=sx * scale, sy=sy * scale)
    hull = lathe(OVAL, material, **kw)
    lathe([(0.96, 0.0), (1.08, 0.0), (1.08, -0.06), (0.96, -0.06), (0.96, 0.0)], 'hull_dark', **kw)
    lathe([(0, 0.27), (0.4, 0.25), (0.5, 0.18), (0, 0.18)], material, sx=0.9 * scale, sy=0.7 * scale)
    scoop(hull, (0, -1.0 * sy * scale, 0.0), (0.42 * scale, 0.2 * scale, 0.11 * scale), glow)
    band(0.72, 0.13, 'panel', **kw)
    band(0.98, 0.04, glow, w=0.012, t=0.008, **kw)
    return kw


def destroyer():
    oval_hull(material='hull_dark', glow='violet')
    for s in (-1, 1):
        rod((1.28 * s, 0.35, -0.02), (1.28 * s, -0.55, -0.02), 0.07, 'hull')
        ball((1.28 * s, -0.57, -0.02), 0.04, 'violet')


def raider():
    oval_hull(scale=0.8)
    box((3.0, 0.2, 0.14), (0, 0, 0.02), 'hull_dark', bevel=0.06)
    for s in (-1, 1):
        cone((1.55 * s, 0, 0.02), 0.09, 0.16, 'hull_dark', rot=(0, math.pi / 2 * s, 0))
        ball((1.62 * s, 0, 0.02), 0.045, 'amber' if s < 0 else 'cyan')


def overseer():
    kw = dict(sx=1.5, sy=1.0)
    lathe([(0, 0.17), (0.5, 0.15), (0.85, 0.08), (1.0, 0.0), (0.85, -0.07), (0.5, -0.12), (0, -0.13)], 'ethereal', **kw)
    band(0.55, 0.13, 'violet', w=0.015, t=0.008, **kw)
    band(0.86, 0.075, 'violet', w=0.015, t=0.008, **kw)
    lathe([(0, 0.22), (0.25, 0.2), (0.32, 0.15), (0, 0.15)], 'ethereal', sx=1.2, sy=0.8)
    lathe([(0, -0.12), (0.3, -0.12), (0.18, -0.2), (0, -0.2)], 'violet', sx=1.3)


def abductor(harvester=False):
    hull = 'hull_light' if harvester else 'hull'
    glow = 'green' if harvester else 'amber'
    # A wide, rounded block: a squarish revolved hull, flat below.
    kw = dict(square=3.5, sx=1.25, sy=0.8)
    lathe([(0, 0.32), (0.6, 0.31), (0.88, 0.25), (0.98, 0.12), (1.0, 0.0), (0.97, -0.14), (0.85, -0.22), (0, -0.24)],
          hull, **kw)
    band(0.75, 0.27, 'panel', **kw)
    band(0.99, 0.02, glow, w=0.012, t=0.008, **kw)
    # Rounded humps across the top, in a shallow arc.
    for i, x in enumerate((-0.66, -0.22, 0.22, 0.66)):
        y = 0.1 if i in (0, 3) else 0.0
        ball((x, y, 0.3), 0.2, hull, scale=(1, 1.15, 0.6))
        ball((x, y - 0.21, 0.31), 0.025, glow)
    # Short nacelles at the front corners, glowing intakes.
    for s in (-1, 1):
        ball((0.95 * s, -0.42, 0.0), 0.2, 'hull_dark', scale=(0.8, 1.4, 0.7))
        ball((0.95 * s, -0.69, 0.0), 0.09, glow, scale=(1, 0.3, 0.8))
    if harvester:
        for x, y in ((-0.55, -0.3), (0.55, -0.3), (-0.55, 0.35), (0.55, 0.35)):
            top, knee, foot = (x, y, -0.22), (x * 1.4, y * 1.4, -0.5), (x * 1.2, y * 1.2, -0.8)
            rod(top, knee, 0.04, 'hull_dark')
            rod(knee, foot, 0.035, 'hull_dark')
            ball(knee, 0.06, 'hull_dark')
            cone((foot[0], foot[1], foot[2] - 0.03), 0.06, 0.12, 'green', rot=(math.pi, 0, 0))
    else:
        lathe([(0, -0.24), (0.32, -0.24), (0.18, -0.36), (0, -0.36)], glow, segments=48)

def transport(terror=False):
    glow = 'red' if terror else 'cyan'
    hull = 'hull_dark' if terror else 'hull'
    box((2.2, 1.2, 0.8), (0, 0, 0), hull, bevel=0.18)
    box((1.4, 0.9, 0.3), (-0.3, 0, 0.5), hull, bevel=0.1)
    box((0.5, 1.25, 0.06), (-0.4, 0, 0.0), 'panel', bevel=0.01)
    box((0.5, 1.25, 0.06), (0.3, 0, 0.0), 'panel', bevel=0.01)
    # The thruster cluster: three by two big round nozzles in the end.
    for y in (-0.36, 0.0, 0.36):
        for z in (-0.18, 0.18):
            rod((1.05, y, z), (1.25, y, z), 0.16, 'hull_dark', vertices=32)
            ring((1.26, y, z), 0.12, 0.035, glow)
            ball((1.2, y, z), 0.1, glow, scale=(0.4, 1, 1))
    box((1.6, 0.02, 0.05), (-0.2, -0.61, 0.2), glow, bevel=0)
    if terror:
        for x, h in ((-0.8, 0.4), (-0.3, 0.55), (0.2, 0.4)):
            cone((x, 0, 0.65 + h / 2), 0.07, h, 'hull_dark')
            ball((x, 0, 0.66 + h), 0.03, 'red')
        for y in (-0.3, 0.3):
            cone((-1.35, y, 0.1), 0.09, 0.5, 'hull_dark', rot=(0, -math.pi / 2, 0))


def battleship(carrier=False):
    hull = 'hull'
    trim = 'amber' if carrier else 'cyan'
    # A long, angular hull with a wedge prow, a raised spine and swept wings.
    box((2.6, 0.7, 0.42), (0, 0, 0), hull, bevel=0.1)
    plate([(1.25, -0.33, 0.0), (1.25, 0.33, 0.0), (2.0, 0.0, 0.0)], 0.3, hull)
    box((1.8, 0.4, 0.26), (-0.2, 0, 0.32), 'hull_dark', bevel=0.06)
    box((0.6, 0.3, 0.2), (-0.5, 0, 0.55), hull, bevel=0.05)
    for s in (-1, 1):
        plate([(0.6, 0.3 * s, 0.0), (-0.9, 1.25 * s, -0.08), (-1.3, 1.25 * s, -0.08), (-1.0, 0.33 * s, 0.0)], 0.07,
              'hull_dark')
        plate([(0.2, 0.3 * s, 0.25), (-0.6, 0.75 * s, 0.6), (-0.85, 0.75 * s, 0.6), (-0.6, 0.3 * s, 0.25)], 0.05, hull)
        # Ring structures standing on the wing roots, lit inside.
        for x in ((-0.55,) if carrier else (0.0, -0.75)):
            ring((x, 0.62 * s, 0.12), 0.2, 0.045, 'hull_dark', axis=(1, 0, 0))
            ring((x, 0.62 * s, 0.12), 0.15, 0.012, trim, axis=(1, 0, 0))
        rod((-1.3, 0.2 * s, 0.0), (-1.45, 0.2 * s, 0.0), 0.12, 'hull_dark')
        ball((-1.46, 0.2 * s, 0.0), 0.1, 'cyan', scale=(0.4, 1, 1))
    box((2.2, 0.02, 0.04), (0, -0.36, 0.05), trim, bevel=0)
    if carrier:
        # A long flight deck and an open hangar bay under the prow.
        box((1.9, 0.6, 0.04), (-0.1, 0, 0.47), 'hull_light', bevel=0.02)
        box((0.8, 0.5, 0.2), (1.0, 0, -0.12), 'panel', bevel=0.02)
        box((0.02, 0.4, 0.04), (1.42, 0, -0.1), 'amber', bevel=0)
    else:
        for x in (0.5, 0.1, -0.9):
            box((0.2, 0.16, 0.1), (x, 0, 0.5 if x != -0.9 else 0.45), 'hull_dark', bevel=0.02)
            rod((x, 0, 0.53), (x + 0.3, 0, 0.56), 0.02, 'hull_dark')


# --- XCOM's jets ----------------------------------------------------------------


def interceptor():
    """A twin-tailed jet fighter: fuselage, swept wings, canards, canted tails."""
    body = lathe([(0, 1.25), (0.05, 1.12), (0.11, 0.85), (0.15, 0.5), (0.17, 0.0), (0.17, -0.65), (0.14, -0.85),
                  (0, -0.88)], 'xcom', segments=48, sx=1.0, sy=1.25)
    body.rotation_euler = (0, math.pi / 2, 0)
    ball((0.55, 0, 0.12), 0.2, 'glass', scale=(1.7, 0.55, 0.45))
    for s in (-1, 1):
        plate([(0.35, 0.15 * s, 0), (-0.45, 0.95 * s, -0.04), (-0.7, 0.95 * s, -0.04), (-0.55, 0.15 * s, 0)], 0.035,
              'xcom')
        plate([(0.85, 0.12 * s, 0.02), (0.6, 0.38 * s, 0.0), (0.5, 0.38 * s, 0.0), (0.6, 0.12 * s, 0.02)], 0.025,
              'xcom')
        plate([(-0.45, 0.14 * s, 0.1), (-0.78, 0.26 * s, 0.48), (-0.92, 0.26 * s, 0.48), (-0.8, 0.14 * s, 0.1)], 0.025,
              'xcom_dark')
        plate([(-0.6, 0.15 * s, 0), (-0.85, 0.48 * s, -0.02), (-0.95, 0.48 * s, -0.02), (-0.85, 0.15 * s, 0)], 0.025,
              'xcom')
        rod((-0.82, 0.08 * s, 0), (-0.95, 0.08 * s, 0), 0.07, 'xcom_dark')
        ball((-0.96, 0.08 * s, 0), 0.06, 'cyan', scale=(0.4, 1, 1))
        rod((0.1, 0.17 * s, -0.04), (-0.4, 0.17 * s, -0.04), 0.008, 'cyan')


def firestorm():
    """XCOM's alien-alloy craft: a crescent with forward-curving wings, a pod
    in the middle and a glowing engine ring behind."""
    verts, faces, n = [], [], 31
    for i in range(n):
        t = -1 + 2 * i / (n - 1)
        a = math.radians(150 * t)
        b = math.radians(135 * t)
        verts.append((0.25 - 0.75 * math.cos(a), 0.95 * math.sin(a), 0.0))   # outer edge
        verts.append((0.6 - 0.55 * math.cos(b), 0.62 * math.sin(b), 0.0))    # inner edge
    for i in range(n - 1):
        faces.append((2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1))
    me = bpy.data.meshes.new('crescent')
    me.from_pydata(verts, [], faces)
    wing = finish(bpy.data.objects.new('crescent', me), 'xcom', smooth=False)
    m = wing.modifiers.new('solid', 'SOLIDIFY')
    m.thickness, m.offset = 0.1, 0
    bv = wing.modifiers.new('bevel', 'BEVEL')
    bv.width, bv.segments = 0.03, 2
    ball((-0.05, 0, 0.05), 0.5, 'xcom', scale=(1.4, 0.42, 0.3))
    ball((0.3, 0, 0.14), 0.18, 'glass', scale=(1.6, 0.6, 0.45))
    ring((-0.75, 0, 0.05), 0.16, 0.05, 'xcom_dark')
    ball((-0.74, 0, 0.05), 0.14, 'cyan', scale=(0.3, 1, 1))
    for s in (-1, 1):
        rod((0.2, 0.75 * s, 0.05), (-0.25, 0.6 * s, 0.05), 0.012, 'cyan')

MODELS = {
    1: interceptor, 3: firestorm,
    4: scout, 10: fighter, 5: destroyer, 11: raider, 9: overseer,
    6: abductor, 12: lambda: abductor(harvester=True),
    7: transport, 13: lambda: transport(terror=True),
    8: battleship, 14: lambda: battleship(carrier=True),
}
JETS = {1, 3}


def frame(sc, direction):
    """An orthographic camera looking along `direction`, fitted to the model
    with a margin, 2:1."""
    pts = [o.matrix_world @ Vector(c) for o in sc.objects if o.type == 'MESH' for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centre = (lo + hi) / 2
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = 'ORTHO'
    d = Vector(direction).normalized()
    cam.location = centre + d * 10
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    local = [inv @ p for p in pts]
    w = max(p.x for p in local) - min(p.x for p in local)
    h = max(p.y for p in local) - min(p.y for p in local)
    cam.data.ortho_scale = max(w, 2 * h) * 1.08
    cam.data.shift_x = ((max(p.x for p in local) + min(p.x for p in local)) / 2) / cam.data.ortho_scale
    cam.data.shift_y = ((max(p.y for p in local) + min(p.y for p in local)) / 2) / cam.data.ortho_scale


def main():
    os.makedirs(OUT, exist_ok=True)
    for t, build in MODELS.items():
        if ONLY and t not in ONLY:
            continue
        MATS.clear()
        sc = reset()
        build()
        bpy.context.view_layer.update()
        frame(sc, (0.15, -1.0, 0.55) if t in JETS else (0.25, -1.0, 0.32))
        sc.render.filepath = os.path.abspath(os.path.join(OUT, f'{t}.webp'))
        bpy.ops.render.render(write_still=True)
        print('wrote', sc.render.filepath)


main()
