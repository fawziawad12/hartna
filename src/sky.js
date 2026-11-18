import * as THREE from 'three';

export function createSky() {
  const uniforms = {
    top: { value: new THREE.Color('#3d6fb0') },
    horizon: { value: new THREE.Color('#ffb070') },
    bottom: { value: new THREE.Color('#e8b27a') },
    sunDir: { value: new THREE.Vector3(0.6, 0.25, 0.4).normalize() },
    sunColor: { value: new THREE.Color('#fff0c0') },
    sunSize: { value: 1.0 },
    stars: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunSize; uniform float stars;
      varying vec3 vDir;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.55, h), 0.8)) : mix(horizon, bottom, smoothstep(0.0, -0.2, h));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        col += sunColor * (pow(s, 900.0 / sunSize) * 6.0 + pow(s, 12.0) * 0.35);
        if (stars > 0.0 && h > 0.05) {
          vec3 q = floor(d * 380.0);
          float st = step(0.9965, hash(q));
          col += vec3(st) * stars * smoothstep(0.05, 0.4, h);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}
