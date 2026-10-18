"""Render the air war's UFO pictures with Blender: our own models, built from
simple shapes here (the game's art stays Firaxis's), one per UFO type.

    blender -b -P scripts/ufo_art.py -- public/ufos [type ...]

Writes <type>.webp (EShipType number) at 400 × 200 with a transparent
background, three-quarter view from slightly above, each model filling the
frame (the page scales them by size class). Cycles on the CPU, a few
seconds each.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'public/ufos'
ONLY = [int(x) for x in sys.argv[sys.argv.index('--') + 2:]] if '--' in sys.argv else []

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
        ('rim', (-4, 4, 2), 700, 4, (0.55, 0.75, 1.0)),
        ('fill', (-1, -5, -1.5), 120, 6, (0.8, 0.85, 1.0)),
    ):
        light = bpy.data.lights.new(name, 'AREA')
        light.energy, light.size, light.color = energy, size, color
        o = bpy.data.objects.new(name, light)
        o.location = loc
        o.rotation_euler = (-Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        sc.collection.objects.link(o)
    return sc


MATS = {}


def mat(name):
    if name in MATS:
        return MATS[name]
    spec = {
        'hull': dict(color=(0.30, 0.32, 0.36), metal=0.9, rough=0.32),
        'hull_light': dict(color=(0.52, 0.54, 0.58), metal=0.9, rough=0.28),
        'hull_dark': dict(color=(0.09, 0.09, 0.12), metal=0.85, rough=0.38),
        'ethereal': dict(color=(0.07, 0.05, 0.10), metal=0.9, rough=0.22),
        'panel': dict(color=(0.04, 0.04, 0.05), metal=0.4, rough=0.6),
        'glass': dict(color=(0.05, 0.12, 0.14), metal=0.1, rough=0.04, emit=(0.25, 0.85, 1.0), strength=0.8),
        'cyan': dict(color=(0.2, 0.8, 1.0), metal=0, rough=0.4, emit=(0.25, 0.85, 1.0), strength=9),
        'violet': dict(color=(0.7, 0.3, 1.0), metal=0, rough=0.4, emit=(0.72, 0.35, 1.0), strength=9),
        'amber': dict(color=(1.0, 0.6, 0.2), metal=0, rough=0.4, emit=(1.0, 0.55, 0.15), strength=9),
        'red': dict(color=(1.0, 0.25, 0.15), metal=0, rough=0.4, emit=(1.0, 0.22, 0.1), strength=9),
        'green': dict(color=(0.4, 1.0, 0.5), metal=0, rough=0.4, emit=(0.4, 1.0, 0.5), strength=8),
    }[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*spec['color'], 1)
    b.inputs['Metallic'].default_value = spec['metal']
    b.inputs['Roughness'].default_value = spec['rough']
    if 'emit' in spec:
        b.inputs['Emission Color'].default_value = (*spec['emit'], 1)
        b.inputs['Emission Strength'].default_value = spec['strength']
    MATS[name] = m
    return m


def link(ob, material, smooth=True):
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(mat(material))
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    return ob


# --- Shapes ------------------------------------------------------------------


def lathe(profile, material, segments=128, sx=1.0, sy=1.0, z=0.0, x=0.0):
    """Revolve (radius, height) points, top to bottom, around the vertical axis."""
    verts, faces, n = [], [], len(profile)
    for s in range(segments):
        a = 2 * math.pi * s / segments
        for r, h in profile:
            verts.append((x + r * math.cos(a) * sx, r * math.sin(a) * sy, z + h))
    for s in range(segments):
        t = (s + 1) % segments
        for i in range(n - 1):
            faces.append((s * n + i, t * n + i, t * n + i + 1, s * n + i + 1))
    me = bpy.data.meshes.new('lathe')
    me.from_pydata(verts, [], faces)
    return link(bpy.data.objects.new('lathe', me), material)


def band(r, h, material, w=0.03, t=0.012, **kw):
    """A thin ring standing proud of a surface: a panel line or a light strip."""
    return lathe([(r - w / 2, h + t), (r + w / 2, h + t), (r + w / 2, h - t), (r - w / 2, h - t), (r - w / 2, h + t)], material, **kw)


def ball(loc, r, material, segments=24):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=segments, ring_count=segments // 2)
    ob = bpy.context.active_object
    ob.data.materials.append(mat(material))
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def lights(r, h, n, size, material, sx=1.0, sy=1.0, phase=0.0):
    for i in range(n):
        a = 2 * math.pi * (i + phase) / n
        ball((r * math.cos(a) * sx, r * math.sin(a) * sy, h), size, material, 12)


def box(size, loc, material, bevel=0.04, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        m = ob.modifiers.new('bevel', 'BEVEL')
        m.width, m.segments = bevel, 3
    ob.data.materials.append(mat(material))
    return ob


def rod(a, b, r, material):
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, location=(a + b) / 2, vertices=24)
    ob = bpy.context.active_object
    ob.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    ob.data.materials.append(mat(material))
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def cone(loc, r, depth, material, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(radius1=r, depth=depth, location=loc, rotation=rot, vertices=24)
    ob = bpy.context.active_object
    ob.data.materials.append(mat(material))
    return ob


def plate(points, thickness, material):
    """A flat polygon (x, y, z points) given thickness: fins and wings."""
    me = bpy.data.meshes.new('plate')
    me.from_pydata(points, [], [tuple(range(len(points)))])
    ob = link(bpy.data.objects.new('plate', me), material, smooth=False)
    m = ob.modifiers.new('solid', 'SOLIDIFY')
    m.thickness = thickness
    m.offset = 0
    b = ob.modifiers.new('bevel', 'BEVEL')
    b.width, b.segments = 0.01, 2
    return ob


# --- The UFOs ------------------------------------------------------------------

DISC = [(0, 0.20), (0.3, 0.19), (0.7, 0.11), (0.97, 0.03), (1.0, 0.0), (0.97, -0.04), (0.7, -0.10), (0.3, -0.13), (0, -0.13)]


def saucer(scale=1.0, material='hull', dome=True, z=0.0):
    lathe([(r * scale, h * scale) for r, h in DISC], material, z=z)
    band(0.55 * scale, 0.155 * scale + z, 'panel')
    band(0.86 * scale, 0.07 * scale + z, 'panel')
    if dome:
        lathe([(0, 0.44), (0.12, 0.42), (0.24, 0.35), (0.30, 0.25), (0.31, 0.18), (0, 0.18)], 'glass',
              z=z, sx=scale, sy=scale)


def scout():
    saucer()
    lights(1.0, 0.0, 14, 0.028, 'amber')
    band(0.3, -0.13, 'cyan', w=0.08)


def fighter():
    lathe([(r * 0.82, h * 0.9) for r, h in DISC], 'hull')
    band(0.5, 0.13, 'panel')
    for s in (-1, 1):
        plate([(0.35 * s, -0.35, 0.0), (1.35 * s, 0.25, -0.1), (1.5 * s, 0.7, -0.12), (1.2 * s, 0.75, -0.1),
               (0.45 * s, 0.45, 0.0)], 0.05, 'hull_light')
        ball((1.42 * s, 0.6, -0.11), 0.04, 'cyan')
        rod((0.6 * s, 0.0, -0.03), (1.2 * s, 0.4, -0.09), 0.012, 'cyan')
    plate([(0, 0.25, 0.15), (0, 0.8, 0.45), (0, 0.95, 0.45), (0, 0.7, 0.12)], 0.04, 'hull_light')
    lathe([(0, 0.36), (0.1, 0.34), (0.2, 0.28), (0.24, 0.19), (0.25, 0.15), (0, 0.15)], 'glass')
    band(0.25, -0.12, 'cyan', w=0.08)

def destroyer():
    lathe([(0, 0.24), (0.35, 0.22), (0.5, 0.17), (0.75, 0.1), (1.0, 0.03), (1.02, 0), (1.0, -0.05), (0.7, -0.12),
           (0.35, -0.16), (0, -0.16)], 'hull_dark')
    band(0.55, 0.16, 'panel')
    band(0.82, 0.09, 'violet', w=0.015)
    # A forward prow and a raised bridge.
    plate([(-0.45, -0.6, 0.08), (0.45, -0.6, 0.08), (0.0, -1.18, 0.02)], 0.07, 'hull')
    box((0.5, 0.35, 0.16), (0, -0.1, 0.3), 'hull', bevel=0.06)
    box((0.36, 0.02, 0.05), (0, -0.28, 0.32), 'violet', bevel=0)
    for s in (-1, 1):
        rod((0.95 * s, 0.4, 0.02), (0.95 * s, -0.75, 0.02), 0.085, 'hull')
        rod((0.95 * s, -0.75, 0.02), (0.95 * s, -0.95, 0.02), 0.05, 'hull_dark')
        ball((0.95 * s, -0.96, 0.02), 0.045, 'violet')
        box((0.3, 0.25, 0.07), (0.8 * s, 0.0, 0.0), 'hull_dark')
    lights(1.0, 0.0, 16, 0.024, 'violet', phase=0.5)

def raider():
    box((2.8, 0.22, 0.16), (0, 0, 0), 'hull_dark', bevel=0.06)
    box((2.2, 0.12, 0.05), (0, 0, 0.1), 'panel', bevel=0.02)
    lathe([(r * 0.75, h * 0.9) for r, h in DISC], 'hull')
    band(0.45, 0.12, 'panel')
    lathe([(0, 0.36), (0.1, 0.34), (0.18, 0.28), (0.22, 0.18), (0, 0.18)], 'glass')
    for s in (-1, 1):
        cone((1.45 * s, 0, 0), 0.1, 0.18, 'hull_dark', rot=(0, math.pi / 2 * s, 0))
        ball((1.52 * s, 0, 0), 0.05, 'amber' if s < 0 else 'cyan')
    lights(0.75, 0.0, 10, 0.024, 'amber')


def overseer():
    lathe([(0, 0.17), (0.4, 0.15), (0.8, 0.08), (1.0, 0.0), (0.8, -0.08), (0.4, -0.14), (0, -0.15)], 'ethereal', sx=2.1, sy=0.75)
    band(0.7, 0.1, 'violet', w=0.02, sx=2.1, sy=0.75)
    band(0.45, 0.14, 'panel', sx=2.1, sy=0.75)
    lathe([(0, 0.32), (0.12, 0.3), (0.2, 0.24), (0.24, 0.15), (0, 0.15)], 'violet')
    for s in (-1, 1):
        plate([(1.2 * s, 0, 0.05), (1.75 * s, 0, 0.32), (1.85 * s, 0, 0.32), (1.6 * s, 0, 0.04)], 0.03, 'ethereal')
        ball((2.05 * s, 0, 0), 0.04, 'violet')


def abductor(harvester=False):
    hull = 'hull_light' if harvester else 'hull'
    glow = 'green' if harvester else 'amber'
    lathe([(0, 0.3), (0.42, 0.28), (0.62, 0.24), (0.75, 0.15), (1.0, 0.06), (1.04, 0.0), (1.0, -0.08),
           (0.78, -0.14), (0.75, -0.2), (0.45, -0.22), (0, -0.22)], hull, segments=8 if not harvester else 128)
    band(0.62, 0.24, 'panel', segments=8 if not harvester else 128)
    band(0.76, -0.17, glow, w=0.04, segments=8 if not harvester else 128)
    lights(1.0, 0.0, 16, 0.028, glow, phase=0.5)
    if harvester:
        lathe([(0, 0.5), (0.14, 0.48), (0.24, 0.42), (0.3, 0.3), (0, 0.3)], 'glass')
        for i in range(4):
            a = math.pi / 4 + i * math.pi / 2
            top = (0.45 * math.cos(a), 0.45 * math.sin(a), -0.2)
            knee = (0.8 * math.cos(a), 0.8 * math.sin(a), -0.45)
            foot = (0.62 * math.cos(a), 0.62 * math.sin(a), -0.75)
            rod(top, knee, 0.04, 'hull_dark')
            rod(knee, foot, 0.035, 'hull_dark')
            ball(knee, 0.06, 'hull_dark')
            cone((foot[0], foot[1], foot[2] - 0.02), 0.06, 0.12, 'green', rot=(math.pi, 0, 0))
    else:
        # An armoured octagonal tower and a tractor-beam emitter below.
        lathe([(0, 0.62), (0.2, 0.62), (0.3, 0.52), (0.34, 0.3), (0, 0.3)], 'hull_dark', segments=8)
        band(0.32, 0.45, 'amber', w=0.012, segments=8)
        lathe([(0, -0.22), (0.3, -0.22), (0.16, -0.36), (0, -0.36)], 'amber', segments=48)

def transport(terror=False):
    glow = 'red' if terror else 'cyan'
    hull = 'hull_dark' if terror else 'hull'
    # A long rounded hull: a lathe stretched along x, flattened below.
    lathe([(0, 0.45), (0.5, 0.42), (0.85, 0.3), (1.0, 0.1), (1.0, -0.12), (0.85, -0.28), (0.4, -0.32), (0, -0.32)],
          hull, sx=1.5, sy=0.55, segments=96)
    for x in (-0.9, -0.45, 0.0, 0.45, 0.9):
        box((0.035, 1.12, 0.62), (x, 0, 0.06), 'panel', bevel=0.01)
    box((2.1, 0.02, 0.05), (0, -0.56, 0.05), glow, bevel=0)
    box((0.9, 0.45, 0.16), (-0.25, 0, 0.5), 'hull_light' if not terror else hull, bevel=0.06)
    box((0.6, 0.02, 0.04), (-0.25, -0.23, 0.5), glow, bevel=0)
    for y in (-0.22, 0.22):
        rod((1.42, y, 0.0), (1.52, y, 0.0), 0.09, glow)
    if terror:
        for x, h in ((-0.7, 0.4), (-0.25, 0.55), (0.2, 0.4)):
            cone((x, 0, 0.62 + h / 2), 0.07, h, 'hull_dark')
            ball((x, 0, 0.63 + h), 0.03, 'red')
        for y in (-0.2, 0.2):
            cone((-1.65, y, 0.0), 0.08, 0.5, 'hull_dark', rot=(0, -math.pi / 2, 0))

def battleship(carrier=False):
    lathe([(0, 0.1), (1.3, 0.06), (1.42, 0.0), (1.3, -0.08), (0.6, -0.16), (0, -0.16)], 'hull')
    lathe([(0, 0.32), (0.95, 0.27), (1.02, 0.18), (1.0, 0.1), (0, 0.1)], 'hull_dark')
    band(1.15, 0.04, 'panel')
    band(0.8, 0.29, 'panel')
    lights(1.42, 0.0, 28, 0.026, 'cyan')
    lights(1.01, 0.15, 18, 0.024, 'violet', phase=0.5)
    if carrier:
        lathe([(0, 0.5), (0.5, 0.46), (0.55, 0.32), (0, 0.32)], 'hull')
        # An open hangar bay in the front of the rim, lit inside.
        box((1.1, 0.5, 0.26), (0, -1.28, 0.0), 'hull_light', bevel=0.05)
        box((0.86, 0.06, 0.15), (0, -1.52, 0.0), 'panel', bevel=0.01)
        box((0.8, 0.02, 0.03), (0, -1.55, -0.05), 'amber', bevel=0)
        box((0.8, 0.02, 0.02), (0, -1.55, 0.06), 'amber', bevel=0)
        for x in (-0.6, 0.6):
            ball((x, -1.5, 0.1), 0.035, 'amber')
        box((0.3, 0.06, 0.24), (0, 0.0, 0.62), 'hull_light', bevel=0.03)
        ball((0, 0, 0.78), 0.03, 'amber')
    else:
        lathe([(0, 0.55), (0.55, 0.5), (0.6, 0.42), (0.6, 0.32), (0, 0.32)], 'hull')
        # A command spire.
        lathe([(0, 1.0), (0.05, 0.98), (0.12, 0.8), (0.22, 0.6), (0.26, 0.55), (0, 0.55)], 'hull_dark', segments=6)
        ball((0, 0, 1.0), 0.04, 'violet')
        for i in range(6):
            a = math.pi / 6 + i * math.pi / 3
            c, d = math.cos(a), math.sin(a)
            box((0.2, 0.14, 0.09), (0.8 * c, 0.8 * d, 0.33), 'hull_light', bevel=0.02, rot=(0, 0, a))
            rod((0.8 * c, 0.8 * d, 0.36), (1.1 * c, 1.1 * d, 0.4), 0.025, 'hull_light')
            ball((1.1 * c, 1.1 * d, 0.4), 0.025, 'violet')

MODELS = {
    4: scout, 10: fighter, 5: destroyer, 11: raider, 9: overseer,
    6: abductor, 12: lambda: abductor(harvester=True),
    7: transport, 13: lambda: transport(terror=True),
    8: battleship, 14: lambda: battleship(carrier=True),
}


def frame(sc):
    """An orthographic camera from the front, slightly above and to one side,
    fitted to the model with a margin, 2:1."""
    pts = [o.matrix_world @ Vector(c) for o in sc.objects if o.type == 'MESH' for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centre = (lo + hi) / 2
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = 'ORTHO'
    direction = Vector((0.25, -1.0, 0.32)).normalized()
    cam.location = centre + direction * 10
    cam.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
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
        frame(sc)
        sc.render.filepath = os.path.abspath(os.path.join(OUT, f'{t}.webp'))
        bpy.ops.render.render(write_still=True)
        print('wrote', sc.render.filepath)


main()
