import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// NaN/Inf guard for HDR colour. Bit test on the exponent: unlike isnan() or
// comparisons, drivers cannot optimise it away under fast-math assumptions.
const SANITIZE_GLSL = /* glsl */ `
vec4 sanitizeHDR(vec4 c) {
  uvec4 e = floatBitsToUint(c) & uvec4(0x7f800000u);
  if (any(equal(e, uvec4(0x7f800000u)))) return vec4(0.0);
  return clamp(c, 0.0, 1.0e3);
}
`;

const FinalShader = {
  name: 'FinalGrade',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uExposure: { value: 1 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.035 },
    uAberration: { value: 0.0 },
    uSaturation: { value: 1.08 },
    uFade: { value: 0 },
    uFlash: { value: 0 },
    uDream: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uExposure;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uSaturation;
    uniform float uFade;
    uniform float uFlash;
    uniform float uDream;
    varying vec2 vUv;

    ${SANITIZE_GLSL}
    vec3 hueRotate(vec3 c, float a) {
      const vec3 k = vec3(0.57735);
      float cs = cos(a);
      return c * cs + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cs);
    }

    // ACES fitted (Stephen Hill)
    vec3 RRTAndODTFit(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 aces(vec3 c) {
      const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
      const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
      c = inM * c;
      c = RRTAndODTFit(c);
      c = outM * c;
      return clamp(c, 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
    }
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      vec2 uv = vUv;
      vec2 dc = uv - 0.5;
      vec3 col;
      if (uAberration > 0.0001) {
        vec2 off = dc * uAberration;
        col.r = texture2D(tDiffuse, uv - off).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv + off).b;
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }
      col = sanitizeHDR(vec4(col, 1.0)).rgb;
      col *= uExposure / 0.6;
      col += uFlash;
      col = aces(col);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation + 0.28 * uDream);
      // the dream drifts through hues; reality stays true
      col = mix(col, clamp(hueRotate(col, sin(uTime * 0.045) * 0.35), 0.0, 1.0), uDream * 0.45);
      // gentle filmic S-curve
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.18);
      float aspect = uResolution.x / max(uResolution.y, 1.0);
      float v = length(dc * vec2(aspect, 1.0) * 0.9);
      col *= 1.0 - uVignette * smoothstep(0.35, 1.05, v);
      col = toSRGB(clamp(col, 0.0, 1.0));
      col += (hash(uv * uResolution + fract(uTime * 7.31) * 100.0) - 0.5) * uGrain;
      col = mix(col, vec3(0.0), uFade);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera, { bloom = true, msaa = 4 } = {}) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x * pr), Math.max(1, size.y * pr), {
      type: THREE.HalfFloatType,
      samples: msaa,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.42, 1.6);
    this.bloom.enabled = bloom;
    // Never let a stray NaN/Inf pixel into the bloom chain: the blur mips would
    // smear it over the whole frame and the screen would go black.
    const hp = this.bloom.materialHighPassFilter;
    hp.fragmentShader = SANITIZE_GLSL + hp.fragmentShader.replace(
      'vec4 texel = texture2D( tDiffuse, vUv );',
      'vec4 texel = texture2D( tDiffuse, vUv );\n\t\t\ttexel = sanitizeHDR( texel );',
    );
    hp.needsUpdate = true;
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.setSize(size.x, size.y, pr);
  }

  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.final.uniforms.uResolution.value.set(w * pr, h * pr);
  }

  setBloom(on) {
    this.bloom.enabled = on;
  }

  render(dt) {
    this.final.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
