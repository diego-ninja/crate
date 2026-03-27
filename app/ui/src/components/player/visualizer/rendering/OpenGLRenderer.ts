import { mat4, vec3 } from 'gl-matrix';
import Drawable from './Drawable';
import Camera from '../Camera';
import { gl } from '../globals';
import ShaderProgram from './ShaderProgram';

class OpenGLRenderer {
  constructor(public canvas: HTMLCanvasElement) {
  }

  setClearColor(r: number, g: number, b: number, a: number) {
    gl.clearColor(r, g, b, a);
  }

  setSize(width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  clear() {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  render(camera: Camera, prog: ShaderProgram, drawables: Array<Drawable>, scale: number = 1.0) {
    const model = mat4.create();
    const viewProj = mat4.create();

    mat4.identity(model);
    mat4.scale(model, model, vec3.fromValues(scale, scale, scale));
    mat4.multiply(viewProj, camera.projectionMatrix, camera.viewMatrix);
    prog.setModelMatrix(model);
    prog.setViewProjMatrix(viewProj);

    for (const drawable of drawables) {
      prog.draw(drawable);
    }
  }
}

export default OpenGLRenderer;
