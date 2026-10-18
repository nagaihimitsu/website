import * as THREE from "three";

/**
 * Small, deterministic textile tiles. RGB is a neutral yarn colour; the second
 * texture packs height in R and roughness in G so both details share one upload.
 * Nothing is fetched, and the same tiles are shared by every fabric colour.
 */
type Textile = {
  colour: THREE.DataTexture;
  detail: THREE.DataTexture;
};

const TAU = Math.PI * 2;
const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));
const fraction = (value: number) => value - Math.floor(value);

function hash(x: number, y: number, seed: number) {
  let value = Math.imul(x + seed, 374761393) ^ Math.imul(y, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

/** Periodic value noise keeps every texture edge continuous when repeated. */
function noise(x: number, y: number, cells: number, seed: number) {
  const px = fraction(x) * cells;
  const py = fraction(y) * cells;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash((ix + 1) % cells, iy, seed);
  const c = hash(ix, (iy + 1) % cells, seed);
  const d = hash((ix + 1) % cells, (iy + 1) % cells, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

function tile(
  width: number,
  height: number,
  repeatX: number,
  repeatY: number,
  pixel: (x: number, y: number) => [number, number, number],
): Textile {
  const colourData = new Uint8Array(width * height * 4);
  const detailData = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [colour, bump, roughness] = pixel(x, y);
      const offset = (y * width + x) * 4;
      const tone = Math.round(clamp(colour) * 255);
      colourData[offset] = tone;
      colourData[offset + 1] = tone;
      colourData[offset + 2] = tone;
      colourData[offset + 3] = 255;
      detailData[offset] = Math.round(clamp(bump) * 255);
      detailData[offset + 1] = Math.round(clamp(roughness) * 255);
      detailData[offset + 2] = 0;
      detailData[offset + 3] = 255;
    }
  }
  const create = (data: Uint8Array, colour: boolean) => {
    const texture = new THREE.DataTexture(data, width, height);
    texture.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  };
  return {
    colour: create(colourData, true),
    detail: create(detailData, false),
  };
}

function plushTile(): Textile {
  const size = 512;
  const pile = new Float32Array(size * size);
  // Individual short, curved, anti-aliased fibres have a gently varying nap.
  // These are small reliefs; the silhouette fuzz is real model geometry.
  for (let strand = 0; strand < 36000; strand++) {
    const x = hash(strand, 0, 59) * size;
    const y = hash(strand, 1, 59) * size;
    const length = 3 + hash(strand, 2, 59) * 6;
    const angle =
      Math.PI * 0.5 +
      (noise(x / size, y / size, 8, 103) - 0.5) * 1.8 +
      (hash(strand, 3, 59) - 0.5) * 0.8;
    const bend = (hash(strand, 4, 59) - 0.5) * 1.7;
    const height = 0.1 + hash(strand, 5, 59) * 0.17;
    const steps = Math.ceil(length * 1.5);
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const curve = Math.sin(t * Math.PI) * bend;
      const px = x + Math.cos(angle) * length * t + Math.sin(angle) * curve;
      const py = y + Math.sin(angle) * length * t - Math.cos(angle) * curve;
      const ix = Math.floor(px);
      const iy = Math.floor(py);
      const dx = px - ix;
      const dy = py - iy;
      const strength = height * Math.sin(Math.PI * (0.12 + t * 0.76));
      for (let oy = 0; oy < 2; oy++) {
        for (let ox = 0; ox < 2; ox++) {
          const index =
            ((iy + oy + size) % size) * size + ((ix + ox + size) % size);
          const coverage = (ox ? dx : 1 - dx) * (oy ? dy : 1 - dy);
          pile[index] = Math.max(pile[index], strength * coverage);
        }
      }
    }
  }
  const result = tile(size, size, 2, 2, (x, y) => {
    const u = x / size;
    const v = y / size;
    const fibre = pile[y * size + x];
    const nap = noise(u, v, 12, 117) - 0.5;
    const fine = hash(x, y, 127) - 0.5;
    return [
      0.948 + nap * 0.033 + fibre * 0.16 + fine * 0.012,
      0.4 + nap * 0.12 + fibre * 1.1 + fine * 0.032,
      0.96 - fibre * 0.12 + fine * 0.018,
    ];
  });
  result.colour.name = "traveller-short-plush-colour";
  result.detail.name = "traveller-short-plush-height-roughness";
  return result;
}

function cottonTile(): Textile {
  const size = 512;
  const result = tile(size, size, 3, 3, (x, y) => {
    const u = x / size;
    const v = y / size;
    // Fine jersey loops, broken up by heathered fibres. At room scale mipmaps
    // blend these into soft cloth, without an oversized knit/checker pattern.
    const row = Math.floor(y / 8);
    const stitchX = fraction(x / 8 + (row % 2) * 0.5);
    const stitchY = fraction(y / 8);
    const left = stitchX - (0.48 - stitchY * 0.32);
    const right = stitchX - (0.52 + stitchY * 0.32);
    const loop = Math.exp(-left * left * 160) + Math.exp(-right * right * 160);
    const heather = noise(u, v, 64, 193) - 0.5;
    const fine = hash(x, y, 197) - 0.5;
    return [
      0.958 + heather * 0.037 + fine * 0.024 + (loop - 0.3) * 0.012,
      0.4 + loop * 0.13 + heather * 0.12 + fine * 0.075,
      0.966 + fine * 0.025 - loop * 0.018,
    ];
  });
  result.colour.name = "traveller-heathered-cotton-colour";
  result.detail.name = "traveller-heathered-cotton-height-roughness";
  return result;
}

function canvasTile(): Textile {
  const size = 512;
  const result = tile(size, size, 3, 3, (x, y) => {
    const u = x / size;
    const v = y / size;
    const warp = Math.pow(0.5 + 0.5 * Math.cos((TAU * x) / 8), 1.8);
    const weft = Math.pow(0.5 + 0.5 * Math.cos((TAU * y) / 8), 1.8);
    const top = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
    const weave = top ? warp * 0.8 + weft * 0.25 : weft * 0.8 + warp * 0.25;
    const yarn = noise(u, v, 64, 227) - 0.5;
    const fine = hash(x, y, 229) - 0.5;
    return [
      0.962 + (weave - 0.4) * 0.01 + yarn * 0.014 + fine * 0.008,
      0.35 + weave * 0.3 + yarn * 0.06 + fine * 0.024,
      0.955 + fine * 0.018 - weave * 0.025,
    ];
  });
  result.colour.name = "traveller-canvas-colour";
  result.detail.name = "traveller-canvas-height-roughness";
  return result;
}

function ribTile(): Textile {
  const result = tile(256, 128, 3, 2, (x, y) => {
    const rib = Math.pow(0.5 + 0.5 * Math.cos((x * TAU) / 16), 0.65);
    const loop = Math.cos((y * TAU) / 4 + Math.sin((x * TAU) / 16)) * 0.5;
    const fine = hash(x, y, 251) - 0.5;
    return [
      0.944 + rib * 0.022 + fine * 0.018,
      0.25 + rib * 0.37 + loop * 0.035 + fine * 0.05,
      0.973 + fine * 0.02,
    ];
  });
  result.colour.name = "traveller-cotton-ribbing-colour";
  result.detail.name = "traveller-cotton-ribbing-height-roughness";
  return result;
}

function cordTile(): Textile {
  // A small tubular braid: UV.x follows the cord, UV.y wraps around it.
  // Keep the relief shallow so the cord reads as soft cotton, not a screw.
  const result = tile(128, 128, 1, 1, (x, y) => {
    const u = x / 128;
    const v = y / 128;
    const clockwise = (0.5 + 0.5 * Math.cos(TAU * (u * 2 + v * 4))) ** 3;
    const counter = (0.5 + 0.5 * Math.cos(TAU * (u * 2 - v * 4))) ** 3;
    const braid =
      Math.max(clockwise, counter) * 0.65 + Math.min(clockwise, counter) * 0.15;
    const fibre = hash(x, y, 271) - 0.5;
    return [
      0.97 + braid * 0.018 + fibre * 0.012,
      0.35 + braid * 0.38 + fibre * 0.04,
      0.97,
    ];
  });
  result.colour.name = "traveller-cotton-cord-colour";
  result.detail.name = "traveller-cotton-cord-braid";
  return result;
}

/** A tiny neutral studio reflection gives the toy's eyes a curved, glassy read. */
function eyeReflection(): THREE.DataTexture {
  const width = 256;
  const height = 128;
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const latitude = Math.PI * (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const longitude = Math.PI * 2 * ((x + 0.5) / width - 0.5);
      const dy = -Math.cos(latitude);
      // Soft upper windows surround the whole room. A single forward-facing
      // panel loses every reflection when the traveller turns toward +Z.
      const panels = 0.32 + 0.16 * Math.cos(longitude * 2) ** 4;
      const softbox = Math.exp(-(((dy - 0.55) / 0.17) ** 4)) * panels;
      const bounce = Math.exp(-(((dy + 0.55) / 0.28) ** 2)) * 0.65;
      const offset = (y * width + x) * 4;
      data[offset] = 0.06 + softbox * 3.8 + bounce * 0.6;
      data[offset + 1] = 0.055 + softbox * 3.72 + bounce * 0.4;
      data[offset + 2] = 0.05 + softbox * 3.65 + bounce * 0.28;
      data[offset + 3] = 1;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.name = "traveller-eye-softbox-reflection";
  texture.needsUpdate = true;
  return texture;
}

export function createCharacterMaterials() {
  const plush = plushTile();
  const cotton = cottonTile();
  const canvas = canvasTile();
  const ribs = ribTile();
  const braid = cordTile();
  const eyeEnvironment = eyeReflection();
  const textures = [plush, cotton, canvas, ribs, braid].flatMap(
    ({ colour, detail }) => [colour, detail],
  );
  textures.push(eyeEnvironment);
  const owned: THREE.Material[] = [];
  function own<T extends THREE.Material>(material: T): T {
    owned.push(material);
    return material;
  }
  function textile(
    colour: string,
    maps: Textile,
    bump: number,
    sheen: number,
    sheenColour: string,
  ) {
    return own(
      new THREE.MeshPhysicalMaterial({
        color: colour,
        map: maps.colour,
        bumpMap: maps.detail,
        bumpScale: bump,
        roughnessMap: maps.detail,
        roughness: 0.97,
        metalness: 0,
        sheen,
        sheenColor: sheenColour,
        sheenRoughness: 0.86,
      }),
    );
  }
  // The reference reads as soft, short velvet with broad shading. Strong bump
  // and bright isolated fibres made the former head look granular from the side.
  const fur = textile("#a87c5e", plush, 0.0007, 0.52, "#c09a7f");
  const pawFur = textile("#79513c", plush, 0.00065, 0.42, "#ad8265");
  // Muted warm lining is a distinct inset fabric, visibly darker and less
  // golden than the outer plush even when the open ear catches the key light.
  const earOuter = textile("#a87c5e", plush, 0.00012, 0.45, "#c09a7f");
  const earInner = textile("#785447", plush, 0.00008, 0.28, "#a77f70");
  const hoodie = textile("#73747b", cotton, 0.00055, 0.35, "#a5a6af");
  const ribbing = textile("#6d6f76", ribs, 0.0009, 0.3, "#a3a5af");
  const hoodInterior = textile("#62656e", cotton, 0.0006, 0.3, "#959aa5");
  const pocketFabric = textile("#77787f", cotton, 0.00055, 0.35, "#aaabb4");
  const pants = textile("#353940", cotton, 0.0008, 0.25, "#70747d");
  const pantCuffs = textile("#464b55", ribs, 0.0011, 0.3, "#7c8390");
  const shoeUpper = textile("#454951", canvas, 0.0007, 0.2, "#838791");
  const shoeSole = own(
    new THREE.MeshStandardMaterial({
      color: "#e5e4e2",
      roughness: 0.83,
    }),
  );
  const cord = textile("#eeede8", braid, 0.00018, 0.38, "#fffdf6");
  const backpack = textile("#d1c8b9", canvas, 0.00065, 0.28, "#e5dac8");
  const backpackTrim = textile("#b9ad9c", canvas, 0.00065, 0.25, "#d8cbb9");
  const backpackLight = textile("#ddd3c3", canvas, 0.00065, 0.28, "#eae0d0");
  const feature = own(
    new THREE.MeshStandardMaterial({
      color: "#29201d",
      roughness: 0.43,
    }),
  );
  const eye = own(
    new THREE.MeshPhysicalMaterial({
      color: "#291d1a",
      roughness: 0.23,
      specularIntensity: 0.55,
      clearcoat: 0.25,
      clearcoatRoughness: 0.24,
      envMap: eyeEnvironment,
      envMapIntensity: 3.5,
    }),
  );
  const eyeRim = own(
    new THREE.MeshStandardMaterial({ color: "#3c2c25", roughness: 0.6 }),
  );
  const eyeLight = own(new THREE.MeshBasicMaterial({ color: "#fffdf5" }));
  // Opaque short strands avoid transparent shell sorting and depth artefacts.
  // Instanced geometry can vary this base colour slightly for a natural nap.
  const fibers = own(
    new THREE.MeshStandardMaterial({
      color: "#ac8163",
      roughness: 1,
      metalness: 0,
    }),
  );
  let disposed = false;
  return {
    fur,
    pawFur,
    earOuter,
    earInner,
    hoodie,
    ribbing,
    hoodInterior,
    pocketFabric,
    pants,
    pantCuffs,
    shoeUpper,
    shoeSole,
    cord,
    backpack,
    backpackTrim,
    backpackLight,
    feature,
    eye,
    eyeRim,
    eyeLight,
    fibers,
    textures: textures as readonly THREE.DataTexture[],
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const material of owned) material.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}
