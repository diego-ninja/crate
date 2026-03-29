import { vec3, vec4 } from 'gl-matrix';
import Drawable from '../rendering/Drawable';
import { gl } from '../globals';

class Icosphere extends Drawable {
  buffer!: ArrayBuffer;
  indices!: Uint32Array;
  positions!: Float32Array;
  normals!: Float32Array;
  center: vec4;

  constructor(center: vec3, public radius: number, public subdivisions: number, public mode: GLenum) {
    super();
    this.center = vec4.fromValues(center[0], center[1], center[2], 1);
  }

  create() {
    const X = 0.525731112119133606;
    const Z = 0.850650808352039932;
    const N = 0;

    const maxIndexCount = 20 * Math.pow(4, this.subdivisions);
    const maxVertexCount = 10 * Math.pow(4, this.subdivisions) + 2;

    const buffer0 = new ArrayBuffer(
      maxIndexCount * 3 * Uint32Array.BYTES_PER_ELEMENT +
      maxVertexCount * 4 * Float32Array.BYTES_PER_ELEMENT +
      maxVertexCount * 4 * Float32Array.BYTES_PER_ELEMENT
    );
    const buffer1 = new ArrayBuffer(
      maxIndexCount * 3 * Uint32Array.BYTES_PER_ELEMENT
    );
    const buffers: ArrayBuffer[] = [buffer0, buffer1];
    let b = 0;

    const indexByteOffset = 0;
    const vertexByteOffset = maxIndexCount * 3 * Uint32Array.BYTES_PER_ELEMENT;
    const normalByteOffset = vertexByteOffset;
    const positionByteOffset = vertexByteOffset + maxVertexCount * 4 * Float32Array.BYTES_PER_ELEMENT;

    let triangles: Uint32Array[] = new Array(20);
    let nextTriangles: Uint32Array[] = [];
    for (let i = 0; i < 20; ++i) {
      triangles[i] = new Uint32Array(buffers[b]!, indexByteOffset + i * 3 * Uint32Array.BYTES_PER_ELEMENT, 3);
    }

    const vertices: Float32Array[] = new Array(12);
    for (let i = 0; i < 12; ++i) {
      vertices[i] = new Float32Array(buffer0, vertexByteOffset + i * 4 * Float32Array.BYTES_PER_ELEMENT, 4);
    }

    vertices[0]!.set([-X, N, Z, 0]);
    vertices[1]!.set([X, N, Z, 0]);
    vertices[2]!.set([-X, N, -Z, 0]);
    vertices[3]!.set([X, N, -Z, 0]);
    vertices[4]!.set([N, Z, X, 0]);
    vertices[5]!.set([N, Z, -X, 0]);
    vertices[6]!.set([N, -Z, X, 0]);
    vertices[7]!.set([N, -Z, -X, 0]);
    vertices[8]!.set([Z, X, N, 0]);
    vertices[9]!.set([-Z, X, N, 0]);
    vertices[10]!.set([Z, -X, N, 0]);
    vertices[11]!.set([-Z, -X, N, 0]);

    triangles[0]!.set([0, 4, 1]);
    triangles[1]!.set([0, 9, 4]);
    triangles[2]!.set([9, 5, 4]);
    triangles[3]!.set([4, 5, 8]);
    triangles[4]!.set([4, 8, 1]);
    triangles[5]!.set([8, 10, 1]);
    triangles[6]!.set([8, 3, 10]);
    triangles[7]!.set([5, 3, 8]);
    triangles[8]!.set([5, 2, 3]);
    triangles[9]!.set([2, 7, 3]);
    triangles[10]!.set([7, 10, 3]);
    triangles[11]!.set([7, 6, 10]);
    triangles[12]!.set([7, 11, 6]);
    triangles[13]!.set([11, 0, 6]);
    triangles[14]!.set([0, 1, 6]);
    triangles[15]!.set([6, 1, 10]);
    triangles[16]!.set([9, 0, 11]);
    triangles[17]!.set([9, 11, 2]);
    triangles[18]!.set([9, 2, 5]);
    triangles[19]!.set([7, 2, 11]);

    for (let s = 0; s < this.subdivisions; ++s) {
      b = 1 - b;
      nextTriangles.length = triangles.length * 4;
      let triangleIdx = 0;

      const edgeMap: Map<string, number> = new Map();
      function mid(v0: number, v1: number): number {
        const key = [v0, v1].sort().join('_');
        if (!edgeMap.has(key)) {
          const midpoint = new Float32Array(buffer0, vertexByteOffset + vertices.length * 4 * Float32Array.BYTES_PER_ELEMENT, 4);
          vec4.add(midpoint as unknown as vec4, vertices[v0]! as unknown as vec4, vertices[v1]! as unknown as vec4);
          vec4.normalize(midpoint as unknown as vec4, midpoint as unknown as vec4);
          edgeMap.set(key, vertices.length);
          vertices.push(midpoint);
        }
        return edgeMap.get(key)!;
      }

      for (let t = 0; t < triangles.length; ++t) {
        const tri = triangles[t]!;
        const v0 = tri[0]!;
        const v1 = tri[1]!;
        const v2 = tri[2]!;
        const v3 = mid(v0, v1);
        const v4 = mid(v1, v2);
        const v5 = mid(v2, v0);

        const buf = buffers[b]!;
        nextTriangles[triangleIdx] = new Uint32Array(buf, indexByteOffset + (triangleIdx) * 3 * Uint32Array.BYTES_PER_ELEMENT, 3);
        nextTriangles[triangleIdx]!.set([v0, v3, v5]);
        triangleIdx++;

        nextTriangles[triangleIdx] = new Uint32Array(buf, indexByteOffset + (triangleIdx) * 3 * Uint32Array.BYTES_PER_ELEMENT, 3);
        nextTriangles[triangleIdx]!.set([v3, v4, v5]);
        triangleIdx++;

        nextTriangles[triangleIdx] = new Uint32Array(buf, indexByteOffset + (triangleIdx) * 3 * Uint32Array.BYTES_PER_ELEMENT, 3);
        nextTriangles[triangleIdx]!.set([v3, v1, v4]);
        triangleIdx++;

        nextTriangles[triangleIdx] = new Uint32Array(buf, indexByteOffset + (triangleIdx) * 3 * Uint32Array.BYTES_PER_ELEMENT, 3);
        nextTriangles[triangleIdx]!.set([v5, v4, v2]);
        triangleIdx++;
      }

      const temp = triangles;
      triangles = nextTriangles;
      nextTriangles = temp;
    }

    if (b === 1) {
      const temp0 = new Uint32Array(buffer0, 0, 3 * triangles.length);
      const temp1 = new Uint32Array(buffer1, 0, 3 * triangles.length);
      temp0.set(temp1);
    }

    for (let i = 0; i < vertices.length; ++i) {
      const pos = new Float32Array(buffer0, positionByteOffset + i * 4 * Float32Array.BYTES_PER_ELEMENT, 4) as unknown as vec4;
      vec4.scaleAndAdd(pos, this.center, vertices[i]! as unknown as vec4, this.radius);
    }

    this.buffer = buffer0;
    this.indices = new Uint32Array(this.buffer, indexByteOffset, triangles.length * 3);
    this.normals = new Float32Array(this.buffer, normalByteOffset, vertices.length * 4);
    this.positions = new Float32Array(this.buffer, positionByteOffset, vertices.length * 4);

    this.generateIdx();
    this.generatePos();
    this.generateNor();

    this.count = this.indices.length;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bufIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indices, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufNor);
    gl.bufferData(gl.ARRAY_BUFFER, this.normals, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.bufferData(gl.ARRAY_BUFFER, this.positions, gl.STATIC_DRAW);
  }

  drawMode(): GLenum {
    return this.mode;
  }
}

export default Icosphere;
