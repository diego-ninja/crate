import { vec3, mat4 } from 'gl-matrix';

class Camera {
  projectionMatrix: mat4 = mat4.create();
  viewMatrix: mat4 = mat4.create();
  fovy: number = 45;
  aspectRatio: number = 1;
  near: number = 0.1;
  far: number = 1000;
  position: vec3;
  target: vec3;

  constructor(position: vec3, target: vec3) {
    this.position = vec3.clone(position);
    this.target = vec3.clone(target);
    mat4.lookAt(this.viewMatrix, this.position, this.target, vec3.fromValues(0, 1, 0));
  }

  setAspectRatio(aspectRatio: number) {
    this.aspectRatio = aspectRatio;
  }

  updateProjectionMatrix() {
    mat4.perspective(this.projectionMatrix, this.fovy, this.aspectRatio, this.near, this.far);
  }

  update() {
    mat4.lookAt(this.viewMatrix, this.position, this.target, vec3.fromValues(0, 1, 0));
  }
}

export default Camera;
