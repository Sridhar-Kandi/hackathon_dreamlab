"""Scenes for the harness: the stock Dream YAM Sim scene, and variants built by editing its MJCF.

A scene is a function returning the MJCF string. make_env(name) returns a yam_env.YamEnv on that scene, so the
runner, cameras, actuators and Dream contract are exactly the stock ones.

Blocks are registered in BLOCKS (half-size in metres) so detectors can reason about stacking geometry.
"""

import xml.etree.ElementTree as ET

import mujoco
import runner  # noqa: F401  (puts the stock example on sys.path)
import yam_env

## Block name -> half edge length (m). Filled by the scenes that add blocks.
BLOCKS = {}

STOCK_OBJECTS = ("apple", "banana", "orange", "water_bottle", "bowl", "plate")


def _block(world, name, half, pos, rgba, mass):
    body = ET.SubElement(world, "body", name=name, pos=f"{pos[0]} {pos[1]} {0.76 + half + 0.0005}")
    ET.SubElement(body, "freejoint", name=f"{name}_free")
    ET.SubElement(body, "geom", type="box", size=f"{half} {half} {half}", rgba=rgba, mass=str(mass),
                  friction="1.2 .01 .001")
    BLOCKS[name] = half


def stock():
    return yam_env.build_xml()


def blocks2():
    """Two blocks, nothing else on the table: a large red block and a small blue block."""
    root = ET.fromstring(yam_env.build_xml())
    world = root.find("worldbody")
    for body in list(world.findall("body")):
        if body.get("name") in STOCK_OBJECTS:
            world.remove(body)
    _block(world, "red_block", 0.025, (-0.06, 0.11), ".80 .12 .10 1", 0.08)
    _block(world, "blue_block", 0.0175, (0.07, 0.11), ".12 .30 .85 1", 0.03)
    return ET.tostring(root, encoding="unicode")


def blocks3():
    """Three blocks of different sizes for a 3-high stack: yellow 6 cm, red 5 cm, blue 4 cm.
    The smallest stays at 4 cm (the 3.5 cm blue of blocks2 was the grasp bottleneck)."""
    root = ET.fromstring(yam_env.build_xml())
    world = root.find("worldbody")
    for body in list(world.findall("body")):
        if body.get("name") in STOCK_OBJECTS:
            world.remove(body)
    _block(world, "yellow_block", 0.030, (0.0, 0.10), ".95 .78 .10 1", 0.12)
    _block(world, "red_block", 0.025, (-0.13, 0.12), ".80 .12 .10 1", 0.08)
    _block(world, "blue_block", 0.020, (0.13, 0.12), ".12 .30 .85 1", 0.04)
    return ET.tostring(root, encoding="unicode")


## Tower of Hanoi: three flat pads (pegs) and three blocks, largest at the bottom, stacked on pad A.
PAD_HALF, PAD_THICK = 0.045, 0.002
PADS = {  # name -> (xy, rgba, word used in prompts)
    "pad_a": ((0.14, 0.10), ".20 .62 .28 1", "green"),
    "pad_b": ((0.0, 0.10), ".95 .95 .95 1", "white"),
    "pad_c": ((-0.14, 0.10), ".10 .10 .10 1", "black"),
}
HANOI_BLOCKS = (("yellow_block", 0.030, ".95 .78 .10 1", 0.12),  # bottom (largest) first
                ("red_block", 0.025, ".80 .12 .10 1", 0.08),
                ("blue_block", 0.020, ".12 .30 .85 1", 0.04))


def hanoi():
    """Tower of Hanoi, 3 discs: a yellow 6 / red 5 / blue 4 cm tower on the green pad; goal: the same tower on the
    black pad, moving one block at a time and never a larger block onto a smaller one (7 moves optimal)."""
    root = ET.fromstring(yam_env.build_xml())
    world = root.find("worldbody")
    for body in list(world.findall("body")):
        if body.get("name") in STOCK_OBJECTS:
            world.remove(body)
    for name, ((x, y), rgba, _) in PADS.items():
        pad = ET.SubElement(world, "body", name=name, pos=f"{x} {y} {0.76 + PAD_THICK}")
        ET.SubElement(pad, "geom", type="box", size=f"{PAD_HALF} {PAD_HALF} {PAD_THICK}", rgba=rgba,
                      friction="1.2 .01 .001")
    (x, y), z = PADS["pad_a"][0], 0.76 + 2 * PAD_THICK
    for name, half, rgba, mass in HANOI_BLOCKS:
        body = ET.SubElement(world, "body", name=name, pos=f"{x} {y} {z + half + 0.0005}")
        ET.SubElement(body, "freejoint", name=f"{name}_free")
        ET.SubElement(body, "geom", type="box", size=f"{half} {half} {half}", rgba=rgba, mass=str(mass),
                      friction="1.2 .01 .001")
        BLOCKS[name] = half
        z += 2 * half + 0.001
    return ET.tostring(root, encoding="unicode")


def _empty_table():
    root = ET.fromstring(yam_env.build_xml())
    world = root.find("worldbody")
    for body in list(world.findall("body")):
        if body.get("name") in STOCK_OBJECTS:
            world.remove(body)
    return root, world


def racks():
    """Sorting: a red and a blue sample tube into fixed colour-coded racks. Each tube starts on the side of the other
    colour's rack (red tube on the left-arm side, red rack on the right-arm side, and vice versa)."""
    import bimanual

    root, world = _empty_table()
    bimanual.add_container(ET, world, "red_rack", (-0.08, 0.14), 0.024, 0.045, ".55 .55 .55 1", ".85 .12 .10 1")
    bimanual.add_container(ET, world, "blue_rack", (0.08, 0.14), 0.024, 0.045, ".55 .55 .55 1", ".12 .30 .85 1")
    bimanual.add_tube(ET, world, "red_tube", (0.16, 0.02), ".85 .12 .10 1")
    bimanual.add_tube(ET, world, "blue_tube", (-0.16, 0.02), ".12 .30 .85 1")
    return ET.tostring(root, encoding="unicode")


def hold_fill():
    """Coordination: a white cup with a handle pointing at the left arm, and a red tube on the right-arm side.
    Goal: one arm holds the cup up while the other puts the tube in."""
    import bimanual

    root, world = _empty_table()
    bimanual.add_container(ET, world, "cup", (0.0, 0.10), 0.028, 0.06, ".92 .92 .92 1", ".92 .92 .92 1",
                           free=True, mass=0.06, handle=(0.12, 0.010, 0.022))
    bimanual.add_tube(ET, world, "red_tube", (-0.13, 0.08), ".85 .12 .10 1")
    return ET.tostring(root, encoding="unicode")


SCENES = {"stock": stock, "blocks2": blocks2, "blocks3": blocks3, "hanoi": hanoi, "racks": racks,
          "hold_fill": hold_fill}


class SceneEnv(yam_env.YamEnv):
    def __init__(self, scene):
        self.model = mujoco.MjModel.from_xml_string(SCENES[scene]())
        self.data = mujoco.MjData(self.model)
        self.renderer = None
        self.reset()


def make_env(scene="stock"):
    return yam_env.YamEnv() if scene == "stock" else SceneEnv(scene)


def free_objects(model):
    """Names of all bodies with a free joint (the movable objects)."""
    out = []
    for b in range(model.nbody):
        adr = model.body_jntadr[b]
        if adr >= 0 and model.jnt_type[adr] == mujoco.mjtJoint.mjJNT_FREE:
            out.append(model.body(b).name)
    return out


def free_joint_qposadr(model, body):
    return model.jnt_qposadr[model.body_jntadr[model.body(body).id]]
