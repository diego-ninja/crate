import { gl } from '../globals';

abstract class Drawable {
  count: number = 0;

  bufIdx!: WebGLBuffer;
  bufPos!: WebGLBuffer;
  bufNor!: WebGLBuffer;
  bufUV!: WebGLBuffer;

  idxBound: boolean = false;
  posBound: boolean = false;
  norBound: boolean = false;
  uvBound: boolean = false;

  abstract create(): void;

  destroy() {
    if (this.idxBound) gl.deleteBuffer(this.bufIdx);
    if (this.posBound) gl.deleteBuffer(this.bufPos);
    if (this.norBound) gl.deleteBuffer(this.bufNor);
    if (this.uvBound) gl.deleteBuffer(this.bufUV);
  }

  generateIdx() {
    this.idxBound = true;
    this.bufIdx = gl.createBuffer()!;
  }

  generatePos() {
    this.posBound = true;
    this.bufPos = gl.createBuffer()!;
  }

  generateNor() {
    this.norBound = true;
    this.bufNor = gl.createBuffer()!;
  }

  generateUV() {
    this.uvBound = true;
    this.bufUV = gl.createBuffer()!;
  }

  bindIdx(): boolean {
    if (this.idxBound) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bufIdx);
    }
    return this.idxBound;
  }

  bindPos(): boolean {
    if (this.posBound) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    }
    return this.posBound;
  }

  bindNor(): boolean {
    if (this.norBound) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufNor);
    }
    return this.norBound;
  }

  bindUV(): boolean {
    if (this.uvBound) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufUV);
    }
    return this.uvBound;
  }

  elemCount(): number {
    return this.count;
  }

  drawMode(): GLenum {
    return gl.TRIANGLES;
  }
}

export default Drawable;
