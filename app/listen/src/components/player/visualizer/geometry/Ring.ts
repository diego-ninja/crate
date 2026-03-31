import Drawable from '../rendering/Drawable';
import { gl } from '../globals';

class Ring extends Drawable {
  indices!: Uint32Array;
  positions!: Float32Array;
  normals!: Float32Array;

  constructor(
    public radius: number = 1,
    public segments: number = 256,
    public mode: GLenum = gl.LINES,
  ) {
    super();
  }

  create() {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < this.segments; i++) {
      const t = (i / this.segments) * Math.PI * 2;
      const x = Math.cos(t) * this.radius;
      const y = Math.sin(t) * this.radius;
      positions.push(x, y, 0, 1);
      normals.push(x, y, 0, 0);

      const next = (i + 1) % this.segments;
      indices.push(i, next);
    }

    this.indices = new Uint32Array(indices);
    this.positions = new Float32Array(positions);
    this.normals = new Float32Array(normals);

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

export default Ring;
