import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createVisitorEyeRelief } from "../src/room/art/visitorEyeRelief";

describe("visitor closed-eye relief", () => {
  it("adjusts only the eye blink morph and restores shared geometry on disposal", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      0.15, 0.634, -0.092, // 目の中央（凹みの大きい側）
      0.15, 0.634, 0.092, // 反対側の目
      0.15, 0.5, 0.092, // 口元・頬など、目から離れた部位
      0.04, 0.634, -0.092, // 正面の顔より奥にある形状
      0.15, 0.568, -0.07, // 口周辺に近い、目の楕円の下端
    ], 3));
    const originalBlink = new THREE.Float32BufferAttribute([
      -0.02, 0.001, 0.002, -0.02, 0.001, 0.002,
      -0.02, 0.001, 0.002, -0.02, 0.001, 0.002,
      -0.02, 0.001, 0.002,
    ], 3);
    originalBlink.name = "blink";
    const breath = new THREE.Float32BufferAttribute(new Float32Array(15), 3);
    breath.name = "breath";
    geometry.morphTargetsRelative = true;
    geometry.morphAttributes.position = [originalBlink, breath];
    const material = new THREE.MeshStandardMaterial();
    const first = new THREE.Mesh(geometry, material);
    const second = new THREE.Mesh(geometry, material);
    const relief = createVisitorEyeRelief([first, second]);
    expect(relief).toBeDefined();
    expect(first.geometry).toBe(second.geometry);
    expect(first.geometry).not.toBe(geometry);
    const adjusted = first.geometry.morphAttributes.position![0];
    expect(adjusted.getX(0) - originalBlink.getX(0)).toBeCloseTo(0.012, 6);
    expect(adjusted.getX(1) - originalBlink.getX(1)).toBeCloseTo(0.006, 6);
    expect(adjusted.getX(2)).toBe(originalBlink.getX(2));
    expect(adjusted.getX(3)).toBe(originalBlink.getX(3));
    expect(adjusted.getX(4)).toBe(originalBlink.getX(4));
    expect(adjusted.getY(0)).toBe(originalBlink.getY(0));
    expect(originalBlink.getX(0)).toBeCloseTo(-0.02, 6);
    expect(first.geometry.morphAttributes.position![1].array).toEqual(breath.array);
    const disposeClone = vi.spyOn(first.geometry, "dispose");
    relief!.dispose(); relief!.dispose();
    expect(first.geometry).toBe(geometry);
    expect(second.geometry).toBe(geometry);
    expect(disposeClone).toHaveBeenCalledTimes(1);
    geometry.dispose(); material.dispose();
  });
});
