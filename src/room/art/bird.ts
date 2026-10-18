import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

export interface BirdAnimationState {
  time: number;
  /** 0 … 1 through a single hop; null while both feet are on the floor. */
  hopPhase: number | null;
  heading: number;
  moving: boolean;
  reducedMotion: boolean;
}

/**
 * Original little room bird, sculpted against the supplied three-view reference.
 * Local -Z is forward and the soles rest at Y=0; total height is 0.45 metres.
 * Root position / rotation belongs to the NPC controller, never the animation.
 */
export function createBird() {
  const group = new THREE.Group();
  group.name = "bird-npc";
  group.userData.damageable = false;
  const sculpture = new THREE.Group();
  sculpture.name = "bird-soft-body";
  group.add(sculpture);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const remember = <T extends THREE.BufferGeometry>(geometry: T): T => {
    geometries.add(geometry);
    return geometry;
  };
  function smoothSculpt(geometry: THREE.BufferGeometry) {
    // Weld the UV seam and pole vertices after sculpting. Otherwise smooth
    // normals on a deformed sphere leave a visible stripe down the silhouette.
    geometry.deleteAttribute("normal");
    geometry.deleteAttribute("uv");
    const welded = mergeVertices(geometry, 0.000001);
    welded.computeVertexNormals();
    geometry.dispose();
    return remember(welded);
  }
  const satin = (color: string, roughness: number) => {
    const result = new THREE.MeshPhysicalMaterial({
      color,
      roughness,
      metalness: 0,
      clearcoat: 0.07,
      clearcoatRoughness: 0.48,
      sheen: 0.16,
      sheenRoughness: 0.8,
      sheenColor: new THREE.Color(color),
    });
    if (roughness > 0.5) {
      // A broad-light diffuse response keeps the little satin sculpture soft
      // under the room's directional sun. Leave glossy eyes and bill unchanged.
      result.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <lights_physical_pars_fragment>",
          THREE.ShaderChunk.lights_physical_pars_fragment.replace(
            "reflectedLight.directDiffuse += irradiance * BRDF_Lambert",
            `float broadDot = dot( geometryNormal, directLight.direction );
             float broadWidth = 0.45;
             float broadLambert = broadDot > broadWidth ? broadDot :
               pow( max( broadDot + broadWidth, 0.0 ), 2.0 ) / ( 4.0 * broadWidth );
             reflectedLight.directDiffuse += ( irradiance + ( broadLambert - dotNL ) * directLight.color ) * BRDF_Lambert`,
          ),
        );
      };
      result.customProgramCacheKey = () => "bird-satin-broad-light-v1";
    }
    materials.add(result);
    return result;
  };
  const white = satin("#f4f1ee", 0.66);
  const wingMaterial = satin("#ffffff", 0.62);
  wingMaterial.vertexColors = true;
  const tailMaterial = satin("#484e5a", 0.64);
  const feetMaterial = satin("#543b30", 0.66);
  const beakMaterial = satin("#ffffff", 0.38);
  beakMaterial.vertexColors = true;
  const eyeMaterial = satin("#211a16", 0.14);
  eyeMaterial.clearcoat = 0.8;
  eyeMaterial.clearcoatRoughness = 0.1;
  const glintMaterial = new THREE.MeshBasicMaterial({
    color: "#fffaf0",
    toneMapped: false,
  });
  materials.add(glintMaterial);
  const sphere = remember(new THREE.SphereGeometry(1, 24, 16));

  function mesh(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    parent: THREE.Object3D = sculpture,
  ) {
    const result = new THREE.Mesh(geometry, material);
    result.name = name;
    result.castShadow = true;
    result.receiveShadow = true;
    parent.add(result);
    return result;
  }
  function oval(
    name: string,
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.Material,
    parent: THREE.Object3D = sculpture,
  ) {
    const result = mesh(name, sphere, material, parent);
    result.position.set(...position);
    result.scale.set(...size);
    return result;
  }

  // Three tangent-continuous Bezier arcs: round belly, quiet upright cheeks,
  // and a domed crown. The side silhouette is sculpted separately below.
  const outline = new THREE.CurvePath<THREE.Vector2>();
  const arc = (points: number[][]) => outline.add(new THREE.CubicBezierCurve(
    ...points.map(([x, y]) => new THREE.Vector2(x, y)) as [THREE.Vector2, THREE.Vector2, THREE.Vector2, THREE.Vector2],
  ));
  arc([[0, 0.069], [0.080, 0.069], [0.141, 0.117], [0.141, 0.183]]);
  arc([[0.141, 0.183], [0.141, 0.242], [0.115, 0.277], [0.115, 0.337]]);
  arc([[0.115, 0.337], [0.115, 0.408], [0.084, 0.451], [0, 0.451]]);
  const bodyProfile = outline.getPoints(32);
  // The white rump projects behind the head; the breast stays quieter. This
  // is the body beneath the feathers, not a bulge faked by oversized wings.
  const bodyDepthAt = (height: number, depth: number, radius: number) => {
    const rear = radius > 0.000001 ? Math.max(0, depth / radius) : 0;
    const rump = 0.032 * Math.exp(-(((height - 0.218) / 0.100) ** 2))
      * THREE.MathUtils.smoothstep(radius, 0, 0.08);
    const headForward = 0.006 * THREE.MathUtils.smoothstep(height, 0.265, 0.365);
    return depth * 0.94 + rear * rear * rump - headForward;
  };
  const bodyGeometry = new THREE.LatheGeometry(bodyProfile, 64);
  const bodyPositions = bodyGeometry.getAttribute("position");
  for (let i = 0; i < bodyPositions.count; i++) {
    const radius = Math.hypot(bodyPositions.getX(i), bodyPositions.getZ(i));
    bodyPositions.setZ(i, bodyDepthAt(bodyPositions.getY(i), bodyPositions.getZ(i), radius));
  }
  mesh("bird-continuous-white-pear", smoothSculpt(bodyGeometry), white);
  const bodyRadiusAt = (height: number) => {
    const index = bodyProfile.findIndex((point) => point.y >= height);
    if (index <= 0) return bodyProfile[Math.max(0, index)].x;
    const previous = bodyProfile[index - 1], next = bodyProfile[index];
    return THREE.MathUtils.lerp(previous.x, next.x, (height - previous.y) / (next.y - previous.y));
  };

  // A folded wing wraps around the pear, rather than sitting beside it as an
  // ellipsoid. The wide forward shoulder sweeps toward the central rear tail.
  const wingGeometry = new THREE.SphereGeometry(1, 64, 48);
  const wingPositions = wingGeometry.getAttribute("position");
  const wingColors: number[] = [];
  const shoulderColor = new THREE.Color("#787b87");
  const featherColor = new THREE.Color("#444956");
  const color = new THREE.Color();
  for (let i = 0; i < wingPositions.count; i++) {
    const x = wingPositions.getX(i), y = wingPositions.getY(i), z = wingPositions.getZ(i);
    const t = (1 - y) / 2;
    const height = 0.298 - t * 0.158;
    const spread = z < 0 ? 1.14 : 0.65;
    const angle = 0.30 + t * 0.63 + z * spread * (1 - t * 0.24);
    const radius = bodyRadiusAt(height);
    wingPositions.setXYZ(i,
      Math.cos(angle) * (radius + 0.007) + x * 0.018 - 0.11,
      height - 0.285,
      bodyDepthAt(height, Math.sin(angle) * radius, radius) + Math.sin(angle) * 0.012,
    );
    const dark = THREE.MathUtils.smoothstep(t + z * 0.35, 0.76, 0.82);
    color.copy(shoulderColor).lerp(featherColor, dark);
    wingColors.push(color.r, color.g, color.b);
  }
  wingGeometry.setAttribute("color", new THREE.Float32BufferAttribute(wingColors, 3));
  const smoothWingGeometry = smoothSculpt(wingGeometry);
  const wings = [-1, 1].map((side) => {
    const root = new THREE.Group();
    root.name = side < 0 ? "bird-left-wing-pivot" : "bird-right-wing-pivot";
    root.position.set(side * 0.11, 0.285, 0);
    sculpture.add(root);
    const wing = mesh("bird-folded-wing", smoothWingGeometry, wingMaterial, root);
    wing.scale.x = side;
    return root;
  });

  const tail = new THREE.Group();
  tail.name = "bird-tail-pivot";
  tail.position.set(0, 0.173, 0.130);
  sculpture.add(tail);
  // A single flattened feather: broad at the rump, thin and gently pointed
  // behind. Its downward sweep also makes a rounded point in the back view.
  const tailGeometry = new THREE.SphereGeometry(1, 40, 28);
  const tailPositions = tailGeometry.getAttribute("position");
  for (let i = 0; i < tailPositions.count; i++) {
    const x = tailPositions.getX(i), y = tailPositions.getY(i), z = tailPositions.getZ(i);
    const t = (z + 1) / 2;
    tailPositions.setXYZ(i,
      x * 0.043 * (1 - t * 0.55),
      y * 0.015 * (1 - t * 0.25) - THREE.MathUtils.smoothstep(t, 0, 1) * 0.027,
      -0.008 + t * 0.083,
    );
  }
  mesh("bird-short-tail", smoothSculpt(tailGeometry), tailMaterial, tail);

  const eyes = [-1, 1].map((side) => {
    const root = new THREE.Group();
    root.name = side < 0 ? "bird-left-eye" : "bird-right-eye";
    const eyeHeight = 0.356;
    const eyeX = 0.061;
    const faceRadius = bodyRadiusAt(eyeHeight);
    const faceDepth = bodyDepthAt(eyeHeight, -Math.sqrt(faceRadius ** 2 - eyeX ** 2), faceRadius);
    root.position.set(side * eyeX, eyeHeight, faceDepth);
    root.rotation.y = side * -0.49;
    root.rotation.x = -0.02;
    sculpture.add(root);
    oval("bird-glossy-eye", [0.0128, 0.0120, 0.0072], [0, 0, -0.0005], eyeMaterial, root);
    const glint = oval("bird-eye-small-softbox", [0.0016, 0.0023, 0.0006], [-0.0028, 0.0042, -0.0071], glintMaterial, root);
    glint.castShadow = false;
    glint.receiveShadow = false;
    return root;
  });

  // A short broad-rooted bill, with its root sunk into the face and a rounded
  // tip. Its lower half is warmer and darker, like the reference's soft bill.
  const beakGeometry = new THREE.SphereGeometry(1, 48, 32);
  const beakPositions = beakGeometry.getAttribute("position");
  const beakColors: number[] = [];
  const upperBeak = new THREE.Color("#e7b219");
  const lowerBeak = new THREE.Color("#ac832b");
  for (let i = 0; i < beakPositions.count; i++) {
    const x = beakPositions.getX(i), y = beakPositions.getY(i), z = beakPositions.getZ(i);
    const front = (1 - z) / 2;
    beakPositions.setXYZ(i,
      x * 0.039 * (1 - front * 0.55),
      y * 0.024 * (1 - front * 0.45) - front * 0.003,
      0.027 - front * 0.065,
    );
    color.copy(lowerBeak).lerp(upperBeak, THREE.MathUtils.smoothstep(y, -0.32, 0.19));
    beakColors.push(color.r, color.g, color.b);
  }
  beakGeometry.setAttribute("color", new THREE.Float32BufferAttribute(beakColors, 3));
  const billHeight = 0.340;
  const billRadius = bodyRadiusAt(billHeight);
  const billRoot = bodyDepthAt(billHeight, -billRadius, billRadius);
  mesh("bird-rounded-yellow-bill", smoothSculpt(beakGeometry), beakMaterial).position.set(0, billHeight, billRoot - 0.017);

  const feet = [-1, 1].map((side) => {
    const root = new THREE.Group();
    root.name = side < 0 ? "bird-left-foot-pivot" : "bird-right-foot-pivot";
    root.position.set(side * 0.047, 0, 0.003);
    group.add(root);
    const pieces: THREE.BufferGeometry[] = [];
    const tube = (points: number[][], radius: number) => {
      const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
      pieces.push(new THREE.TubeGeometry(curve, 12, radius, 12, false));
    };
    tube([[0, 0.089, 0.002], [0, 0.054, 0.001], [0, 0.018, 0], [0, 0.01, -0.01]], 0.0087);
    for (const splay of [-1, 0, 1]) {
      const toeX = splay * 0.023;
      const toeZ = splay === 0 ? -0.037 : -0.026;
      tube([[0, 0.012, -0.005], [toeX * 0.5, 0.009, toeZ * 0.65], [toeX, 0.008, toeZ]], 0.0074);
      pieces.push(sphere.clone().scale(0.0074, 0.0074, 0.0074).translate(toeX, 0.008, toeZ));
    }
    tube([[0, 0.011, 0], [side * 0.003, 0.008, 0.016], [side * 0.006, 0.008, 0.021]], 0.006);
    pieces.push(sphere.clone().scale(0.006, 0.006, 0.006).translate(side * 0.006, 0.008, 0.021));
    const geometry = remember(mergeGeometries(pieces)!);
    for (const piece of pieces) piece.dispose();
    mesh("bird-brown-three-toed-foot", geometry, feetMaterial, root);
    return root;
  });

  let disposed = false;
  return {
    group,
    animate({ time, hopPhase, moving, reducedMotion }: BirdAnimationState) {
      if (disposed) return;
      const airborne = hopPhase !== null;
      const phase = hopPhase ?? 0;
      const lift = airborne ? Math.sin(phase * Math.PI) : 0;
      const decoration = reducedMotion ? 0 : 1;
      // Flight stretches by a few percent, with a compact soft landing at each
      // end of the hop; the controller owns the actual ballistic root motion.
      const squash = airborne
        ? 0.055 * lift ** 2 - 0.065 * Math.sin(phase * Math.PI * 2) ** 2
        : 0;
      sculpture.scale.set(1 - squash * 0.42 * decoration, 1 + squash * decoration, 1 - squash * 0.42 * decoration);
      sculpture.rotation.x = (airborne ? Math.sin(phase * Math.PI * 2) * 0.065 : 0) * decoration;
      sculpture.rotation.z = (!moving ? Math.sin(time * 1.1) * 0.018 : 0) * decoration;
      sculpture.position.y = (!moving ? Math.sin(time * 2.1) * 0.0014 : 0) * decoration;
      for (let i = 0; i < wings.length; i++) {
        const side = i === 0 ? -1 : 1;
        wings[i].rotation.z = side * (lift * 0.095 + Math.sin(time * 1.7) * 0.008) * decoration;
      }
      tail.rotation.x = (lift * -0.1 + Math.sin(time * 1.6) * 0.018) * decoration;
      for (const foot of feet) {
        foot.rotation.x = lift * -0.22 * decoration;
        foot.position.y = lift * 0.012 * decoration;
      }
      // A quick, infrequent blink reads naturally without constantly twitching.
      const blinkClock = (time + 0.8) % 5.3;
      const blink = blinkClock < 0.15 ? Math.sin((blinkClock / 0.15) * Math.PI) : 0;
      for (const eye of eyes) eye.scale.y = 1 - blink * 0.93 * decoration;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      group.clear();
    },
  };
}
