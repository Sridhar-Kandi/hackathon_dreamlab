/* Overview hero: the real YAM arm (I2RT meshes, MIT) rendered with three.js.
   The kinematic chain is rebuilt from the URDF joint origins; the pick-and-place poses were solved
   offline by inverse kinematics against the same chain (assets/yam/keys.json). The hero shows one
   still frame: the orange grasped and lifted. */
import * as THREE from "/assets/vendor/three.module.min.js";
import { STLLoader } from "/assets/vendor/STLLoader.js";

const holder = document.getElementById("arm3d");
const $ = id => document.getElementById(id);

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

async function start() {
  const keys = await (await fetch("/assets/yam/keys.json")).json();
  const view = await (await fetch("/assets/yam/view.json")).json();

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  holder.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x16140f, 1.6, 3.4);
  const camera = new THREE.PerspectiveCamera(30, 1, .01, 20);
  const focus = new THREE.Vector3(.2, .1, 0);

  /* Light: warm key with soft shadows, a cool fill, and an orange rim from behind for the brand accent. */
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x1a1712, .55));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(.9, 1.6, .9);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -.6; key.shadow.camera.right = .9; key.shadow.camera.top = .8; key.shadow.camera.bottom = -.6;
  key.shadow.radius = 4;
  key.shadow.bias = -.0005;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fb4ff, .35);
  fill.position.set(-1, .6, 1);
  scene.add(fill);
  const rim = new THREE.PointLight(0xff5a1f, 2.2, 2.5, 1.6);
  rim.position.set(-.25, .55, -.45);
  scene.add(rim);

  /* Floor: dark matte table, faint drafting grid, and a soft glow under the work area. */
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshStandardMaterial({ color: 0x1f1c17, roughness: .95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(4, 80, 0x4a443a, 0x2d2a24);
  grid.position.y = .0005;
  grid.material.transparent = true;
  grid.material.opacity = .55;
  scene.add(grid);
  const glowTexture = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const g = c.getContext("2d"); const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    r.addColorStop(0, "rgba(255,90,31,.55)"); r.addColorStop(1, "rgba(255,90,31,0)");
    g.fillStyle = r; g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  })();
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(.9, .9), new THREE.MeshBasicMaterial({ map: glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(.3, .001, 0);
  scene.add(glow);

  /* Robot: z-up URDF frame turned into three.js y-up. */
  const robot = new THREE.Group();
  robot.rotation.x = -Math.PI / 2;
  scene.add(robot);
  const toThree = ([x, y, z]) => new THREE.Vector3(x, z, -y);

  const white = new THREE.MeshStandardMaterial({ color: 0xeeeae2, roughness: .42, metalness: .05 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1b1a18, roughness: .5, metalness: .25 });
  const materialFor = { base_link: black, link_1: black, link_2: white, link_3: white, link_4: black, link_5: black, link_6: black };
  const loader = new STLLoader();
  const loadMesh = (file, material) => new Promise((resolve, reject) => loader.load("/assets/yam/" + file, geometry => {
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    resolve(mesh);
  }, undefined, reject));

  const joints = [];
  let parent = robot;
  robot.add(await loadMesh("base_link.stl", materialFor.base_link));
  for (const [index, joint] of keys.chain.entries()) {
    const origin = new THREE.Object3D();
    origin.position.set(...joint.xyz);
    origin.rotation.set(joint.rpy[0], joint.rpy[1], joint.rpy[2], "ZYX");
    const pivot = new THREE.Object3D();
    origin.add(pivot);
    parent.add(origin);
    const link = "link_" + (index + 1);
    pivot.add(await loadMesh(link + ".stl", materialFor[link]));
    joints.push(pivot);
    parent = pivot;
  }
  const wrist = parent;
  const jaws = [];
  for (const jaw of view.jaws) {
    const [w, x, y, z, px, py, pz] = jaw.pose;
    const mesh = await loadMesh(jaw.mesh, black);
    mesh.quaternion.set(x, y, z, w);
    const base = new THREE.Vector3(px, py, pz);
    mesh.position.copy(base);
    wrist.add(mesh);
    jaws.push({ mesh, base, axis: new THREE.Vector3(...jaw.axis) });
  }
  const tcp = new THREE.Object3D();
  tcp.position.set(...keys.tcp);
  wrist.add(tcp);

  /* Props: the orange and a ceramic bowl at the solved positions. */
  const orangeHome = toThree(keys.orange);
  const orange = new THREE.Mesh(new THREE.SphereGeometry(.034, 40, 28),
    new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: .55, emissive: 0x401000, emissiveIntensity: .35 }));
  orange.castShadow = true;
  orange.position.copy(orangeHome);
  scene.add(orange);
  const bowlProfile = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    bowlProfile.push(new THREE.Vector2(.028 + .052 * Math.sin(t * Math.PI / 2), .05 * (1 - Math.cos(t * Math.PI / 2)) + .004));
  }
  bowlProfile.unshift(new THREE.Vector2(0, .004));
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(bowlProfile, 64),
    new THREE.MeshStandardMaterial({ color: 0xf6f2ea, roughness: .25, side: THREE.DoubleSide }));
  bowl.castShadow = true;
  bowl.receiveShadow = true;
  bowl.position.copy(toThree(keys.bowl));
  scene.add(bowl);

  /* Tool path: the last moments of the fingertip, drawn as a fading orange line. */
  const TRAIL = 140;
  const trailPositions = new Float32Array(TRAIL * 3);
  const trailColors = new Float32Array(TRAIL * 3);
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute("position", new THREE.BufferAttribute(trailPositions, 3));
  trailGeometry.setAttribute("color", new THREE.BufferAttribute(trailColors, 3));
  const trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false }));
  trail.frustumCulled = false;
  scene.add(trail);
  const points = [];

  /* Pose state the timeline animates. */
  const pose = { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0, close: 0 };
  const names = ["j1", "j2", "j3", "j4", "j5", "j6"];
  const asPose = q => Object.fromEntries(q.map((v, i) => [names[i], v]));
  const home = { j1: .05, j2: 1.25, j3: 1.05, j4: -.75, j5: 0, j6: 0 };
  Object.assign(pose, home);
  const world = new THREE.Vector3();
  const local = new THREE.Vector3();

  function apply() {
    names.forEach((n, i) => { joints[i].rotation.z = pose[n]; });
    for (const jaw of jaws) jaw.mesh.position.copy(jaw.base).addScaledVector(jaw.axis, pose.close);
    robot.updateMatrixWorld(true);
    tcp.getWorldPosition(world);
    points.push(world.clone());
    if (points.length > TRAIL) points.shift();
    points.forEach((p, i) => {
      trailPositions.set([p.x, p.y, p.z], i * 3);
      const k = (i / points.length) ** 2;
      trailColors.set([1 * k, .35 * k, .12 * k], i * 3);
    });
    trailGeometry.setDrawRange(0, points.length);
    trailGeometry.attributes.position.needsUpdate = true;
    trailGeometry.attributes.color.needsUpdate = true;
    robot.worldToLocal(local.copy(world));
    $("ro-j1").textContent = names.slice(0, 3).map(n => (pose[n] * 180 / Math.PI).toFixed(0) + "°").join(" ");
    $("ro-j2").textContent = names.slice(3).map(n => (pose[n] * 180 / Math.PI).toFixed(0) + "°").join(" ");
    $("ro-tcp").textContent = [local.x, local.y, local.z].map(v => Math.round(v * 1000)).join(", ");
    $("ro-grip").textContent = Math.round(100 - pose.close / .0475 * 100) + "%";
  }
  apply();

  /* A still frame: the arm has grasped the orange and lifted it. */
  const k = keys.keys;
  const CLOSED = .011;  // finger travel until the jaws meet the orange
  Object.assign(pose, asPose(k.grasp), { close: CLOSED });
  apply();
  wrist.attach(orange);
  Object.assign(pose, asPose(k.lift));
  apply();
  trail.visible = false;
  $("ro-phase").textContent = "lift";

  const angle = .62, radius = 1.18;
  camera.position.set(focus.x + Math.sin(angle) * radius, .5, focus.z + Math.cos(angle) * radius);
  camera.lookAt(focus);
  function resize() {
    const { width, height } = holder.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  new ResizeObserver(resize).observe(holder);
  resize();
  holder.classList.add("ready");
}

if (holder && webglAvailable()) {
  Promise.resolve().then(start).catch(error => {
    console.warn("3D hero unavailable:", error);
    holder.classList.add("failed");
  });
} else if (holder) holder.classList.add("failed");
