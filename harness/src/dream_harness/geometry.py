"""Scene geometry and contact queries on the Dream YAM MuJoCo scene, read from simulator ground truth."""

import mujoco
import numpy as np

TABLE_TOP_Z = 0.76  # table geom: pos z .73, half-height .03
BOWL = {"center": np.array([0.0, -0.04]), "inner_radius": 0.075, "rim_z": 0.76 + 0.058}
PLATE = {"center": np.array([-0.22, -0.045]), "radius": 0.068, "top_z": 0.764 + 0.004}


def free_objects(model):
    """Names of all bodies with a free joint (the movable objects in any scene)."""
    out = []
    for b in range(model.nbody):
        adr = model.body_jntadr[b]
        if adr >= 0 and model.jnt_type[adr] == mujoco.mjtJoint.mjJNT_FREE:
            out.append(model.body(b).name)
    return out


def body_pos(env, name):
    return env.data.body(name).xpos.copy()


def body_speed(env, name):
    """Linear speed of a free body (m/s)."""
    vel = np.zeros(6)
    mujoco.mj_objectVelocity(env.model, env.data, mujoco.mjtObj.mjOBJ_BODY, env.model.body(name).id, vel, 0)
    return float(np.linalg.norm(vel[3:]))


def is_arm_body(model, body_id):
    name = model.body(body_id).name
    return name.startswith("left_") or name.startswith("right_")


def arm_side(model, body_id):
    name = model.body(body_id).name
    return "left" if name.startswith("left_") else "right" if name.startswith("right_") else None


def arm_touching(env, obj):
    """Which arms ('left'/'right') touch the object right now."""
    m, d = env.model, env.data
    obj_id = m.body(obj).id
    sides = set()
    for i in range(d.ncon):
        c = d.contact[i]
        b1, b2 = m.geom_bodyid[c.geom1], m.geom_bodyid[c.geom2]
        if b1 == obj_id and is_arm_body(m, b2):
            sides.add(arm_side(m, b2))
        elif b2 == obj_id and is_arm_body(m, b1):
            sides.add(arm_side(m, b1))
    return sides


def touching(env, a, b):
    m, d = env.model, env.data
    ia, ib = m.body(a).id, m.body(b).id
    for i in range(d.ncon):
        c = d.contact[i]
        if {m.geom_bodyid[c.geom1], m.geom_bodyid[c.geom2]} == {ia, ib}:
            return True
    return False


_HALF_CACHE = {}


def half_height(model, body):
    """Half height of a body: its box geometry (blocks), else the z half-extent of its colliding geoms' bounding
    boxes in the body frame (fruit meshes/ellipsoids; assumes the body rests upright, as spawned)."""
    bid = model.body(body).id
    boxes = [model.geom_size[g][2] for g in range(model.ngeom)
             if model.geom_bodyid[g] == bid and model.geom_type[g] == mujoco.mjtGeom.mjGEOM_BOX]
    if boxes:
        return max(boxes)
    key = (id(model), bid)
    if key not in _HALF_CACHE:
        signs = np.array([[x, y, z] for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)])
        zs = []
        for g in range(model.ngeom):
            if model.geom_bodyid[g] != bid or not model.geom_contype[g]:
                continue
            rot = np.zeros(9)
            mujoco.mju_quat2Mat(rot, model.geom_quat[g])
            corners = signs * model.geom_aabb[g][3:] + model.geom_aabb[g][:3]
            zs.append((corners @ rot.reshape(3, 3).T + model.geom_pos[g])[:, 2])
        z = np.concatenate(zs)
        _HALF_CACHE[key] = float(z.max() - z.min()) / 2
    return _HALF_CACHE[key]
