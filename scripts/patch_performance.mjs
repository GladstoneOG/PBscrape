import fs from 'fs';
import path from 'path';

const ROOT_DIR = process.cwd();
const assetsDir = path.join(ROOT_DIR, 'assets');
const mainFile = fs
  .readdirSync(assetsDir)
  .find(f => f.startsWith('main-') && f.endsWith('.js') && fs.statSync(path.join(assetsDir, f)).size > 500_000);

if (!mainFile) {
  console.error('Could not find main game bundle in assets/');
  process.exit(1);
}

const bundlePath = path.join(assetsDir, mainFile);
let code = fs.readFileSync(bundlePath, 'utf8');

if (code.includes('/* PB_PERF_PATCH_V1 */')) {
  console.log(`[skip] ${mainFile} is already patched with PB_PERF_PATCH_V1.`);
  process.exit(0);
}

// Keep a clean backup of the unpatched bundle
const backupPath = `${bundlePath}.bak`;
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, code);
  console.log(`[backup] Saved original bundle to assets/${path.basename(backupPath)}`);
}

let applied = 0;
function replacePattern(label, regex, replacer) {
  const next = code.replace(regex, replacer);
  if (next === code) {
    console.warn(`  [warn] Pattern not matched for: ${label}`);
    return false;
  }
  code = next;
  applied++;
  console.log(`  [patched] ${label}`);
  return true;
}

console.log(`Applying GPU Performance & Older-Hardware Compatibility Patch to assets/${mainFile}...`);

// 1. Eliminate periodic gl.readPixels() pipeline stalls in watchBlack() after initial verification
replacePattern(
  '1. Stop periodic gl.readPixels() GPU pipeline stalls after initial frame verification',
  /if\(!e\)this\.wdBlack=0,this\.wdEvery=90;else if\(this\.wdEvery=30,!\(\+\+this\.wdBlack<4\)\)/,
  `if(!e){this.wdBlack=0,this.wdEvery=90;if((this.wdGood=(this.wdGood||0)+1)>=2)this.wdEvery=1e9}else if(this.wdEvery=30,!(++this.wdBlack<4))`
);

// 2. Merge outlinePass into finalLite when Bloom is off (saves 1 full-screen FBO read/write pass per frame)
replacePattern(
  '2a. Merge PixelOutline into finalLite single-pass composer chain',
  /this\.finalLite=new ([A-Za-z0-9_$]+)\(this\.camera,this\.tint,this\.grade,this\.vignette\)/,
  `this.finalLite=new $1(this.camera,this.outline,this.tint,this.grade,this.vignette)`
);

replacePattern(
  '2b. Disable separate outlinePass when finalLite is active',
  /pickFinal\(\)\{let e=this\.bloom\.intensity>\.001;this\.finalPass\.enabled=e,this\.finalLite\.enabled=!e,this\.finalPass\.renderToScreen=e,this\.finalLite\.renderToScreen=!e\}/,
  `pickFinal(){let e=this.bloom.intensity>.001;this.outlinePass.enabled=e,this.finalPass.enabled=e,this.finalLite.enabled=!e,this.finalPass.renderToScreen=e,this.finalLite.renderToScreen=!e}`
);

// 3. Split Pokémon Sprite Fragment Shader into kuFast (for 99% of enemies) and full Mastery shader (only when Mastery Look is used)
const kuFastShader = `/* PB_PERF_PATCH_V1 */
var __pbKuFast=\`
uniform sampler2D map; uniform vec2 uTexel; uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar; uniform vec3 uLight; uniform float uTime;
varying vec2 vUv; varying vec4 vFx; varying vec4 vTint; varying float vFogDepth; varying vec4 vRect; varying vec2 vLocal;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
vec3 hueShift(vec3 c, float a){ const vec3 k = vec3(0.57735); float ca = cos(a); return c*ca + cross(k, c)*sin(a) + k*dot(k, c)*(1. - ca); }
vec3 shinyTint(vec3 c, float h){
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float sat = (mx - mn) / max(mx, 1e-6);
  float w = 1. - smoothstep(.22, .5, sat);
  if (w <= 0.) return c;
  const vec3 lw = vec3(.299, .587, .114);
  float l = dot(c, lw);
  vec3 t = clamp(abs(mod(h * 0.95493 + vec3(0., 4., 2.), 6.) - 3.) - 1., 0., 1.);
  vec3 dT = t - dot(t, lw);
  float lp = l * (1. - .22 * smoothstep(.65, 1., l));
  float k = 1e9;
  for (int i = 0; i < 3; i++) { float d = dT[i]; if (d > 1e-6) k = min(k, (1. - lp) / d); else if (d < -1e-6) k = min(k, lp / -d); }
  vec3 o = clamp(lp + .6 * k * dT, 0., 1.);
  return mix(c, o, w);
}
float alphaAt(vec2 uv){ if(uv.x<vRect.x||uv.y<vRect.y||uv.x>vRect.z||uv.y>vRect.w) return 0.; return texture2D(map, uv).a; }
vec3 srgbToLin(vec3 c){ return pow(c, vec3(2.2)); }
vec3 linToSrgb(vec3 c){ return pow(c, vec3(1. / 2.2)); }
void main(){
  vec4 c = texture2D(map, vUv);
  float code = vFx.z;
  float a = c.a;
  if (a < 0.5) {
    if (code <= 0.5) discard;
    float outline = code > 12.95 ? 5. : code > 10.95 ? (code > 11.95 ? 3. : 0.) : code > 9.95 ? 3. : code > 8.9 ? 0. : code;
    if (outline <= 0.5) discard;
    float n = max(max(alphaAt(vUv+vec2(uTexel.x,0.)), alphaAt(vUv-vec2(uTexel.x,0.))), max(alphaAt(vUv+vec2(0.,uTexel.y)), alphaAt(vUv-vec2(0.,uTexel.y))));
    if (n < 0.5) discard;
    vec3 oc = outline < 1.5 ? vec3(1.,.85,.2) : outline < 2.5 ? vec3(1.,.15,.1) : outline < 3.5 ? vec3(1.) : outline < 4.5 ? vec3(.3,1.,1.)
      : outline > 7.5 ? vec3(.35,1.,.4) : outline > 6.5 ? vec3(.85,.35,1.) : 0.6 + 0.4*cos(uTime*4. + vUv.y*40. + vec3(0., 2.1, 4.2));
    float pulse = 0.75 + 0.25*sin(uTime*8.);
    gl_FragColor = vec4(oc * (outline < 3.5 && outline > 2.5 ? 1. : 1.6*pulse), 1.);
    return;
  }
  float diss = vFx.y;
  if (diss > 0.) {
    float n = hash(floor(vUv / uTexel));
    if (n < diss) discard;
    if (n < diss + 0.12) { gl_FragColor = vec4(vec3(1.,.95,.7)*2.2, 1.); return; }
  }
  vec3 col = c.rgb;
  if (code > 4.9) {
    float shinyHue = ((code > 4.9 && code < 6.5) || (code > 8.9 && code < 10.95)) ? fract(code) * 6.2832 : -1.;
    float tintHue = code > 10.95 ? fract(code) * 6.2832 : -1.;
    if (shinyHue >= 0.) col = hueShift(col, shinyHue);
    if (tintHue >= 0.) col = srgbToLin(shinyTint(linToSrgb(col), tintHue));
  }
  col *= uLight;
  if (vTint.w > 1.) {
    float l = dot(col, vec3(.299, .587, .114));
    col = mix(col, l * vec3(1.1, .78, 1.75) * 1.3 + vec3(.05, .025, .11), vTint.w - 1.);
  } else if (vTint.w > 0.) {
    col = mix(col, col * vTint.rgb * 1.4 + vTint.rgb*0.12, vTint.w);
  }
  col *= mix(0.82, 1.05, smoothstep(0.0, 0.5, vLocal.y));
  col = mix(col, vec3(1.), vFx.x);
  float fog = smoothstep(uFogNear, uFogFar, vFogDepth);
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, 1.);
}\``;

replacePattern(
  '3a. Add lightweight __pbKuFast sprite shader and default sprite batches to it',
  /this\.material=new ([A-Za-z0-9_$]+)\(\{vertexShader:([A-Za-z0-9_$]+),fragmentShader:([A-Za-z0-9_$]+),uniforms:\{map:\{value:c\},uTexel:\{value:new ([A-Za-z0-9_$]+)\(1\/256,1\/256\)\},uLean:\{value:\.35\},uLookPal:([A-Za-z0-9_$]+),uFogColor:n\.uFogColor,uFogNear:n\.uFogNear,uFogFar:n\.uFogFar,uLight:n\.uLight,uTime:n\.uTime\}\}\)/,
  (_, matCls, vsIdent, fsIdent, vec2Cls, palIdent) => {
    return `(window.__pbKuFull=${fsIdent},window.__pbKuFast||(${kuFastShader.replace('var __pbKuFast=', 'window.__pbKuFast=')})),this.hasLook=!1,this.material=new ${matCls}({vertexShader:${vsIdent},fragmentShader:window.__pbKuFast,uniforms:{map:{value:c},uTexel:{value:new ${vec2Cls}(1/256,1/256)},uLean:{value:.35},uLookPal:${palIdent},uFogColor:n.uFogColor,uFogNear:n.uFogNear,uFogFar:n.uFogFar,uLight:n.uLight,uTime:n.uTime}})`;
  }
);

replacePattern(
  '3b. Auto-upgrade sprite batch material to full Mastery shader when g > 0',
  /let ce=this\.aLook\.array;ce\[k\*2\]=g&15,ce\[k\*2\+1\]=g>>4\}/,
  `let ce=this.aLook.array;ce[k*2]=g&15,ce[k*2+1]=g>>4;(g&15)>0&&!this.hasLook&&(this.hasLook=!0,this.material.fragmentShader=window.__pbKuFull,this.material.needsUpdate=!0)}`
);

// 4. Terrain Cliff Shader Early-Exit (skip expensive rock(), atan(), and uMesas loop on flat lawn pixels)
replacePattern(
  '4a. Skip cliff rock(), atan(), and uMesas loop on flat ground in Title/Menu terrain',
  /\/\/ Wet zone round each fall[\s\S]*?col = mix\(col, r, isRock\);\s*col = mix\(col, hg, hang\);/,
  match => {
    const mesaMatch = match.match(/for \(int i = 0; i < (\d+); i\+\+\)/);
    const mesaLen = mesaMatch ? mesaMatch[1] : '6';
    return `vec3 col = mix(g, texture2D(tSand, uv).rgb, step(vW.y, uWater + 0.5 + (hash(pp) - 0.5) * 0.12));
          col *= 1. - 0.1 * smoothstep(1.5, 4., vCliff.x - vW.y) * step(slope, 0.3);
          col *= mix(1., 0.72, smoothstep(uWater + 0.15, uWater - 0.4, vW.y));
          float isRock = step(0.34 + (hash(pp) - 0.5) * 0.1, slope);
          if (isRock > 0.5) {
            float wet = 0.;
            for (int i = 0; i < 2; i++) {
              vec4 f = uFalls[i];
              wet = max(wet, (1. - smoothstep(1.4, 3.2, distance(vW.xz, f.xy))) * step(f.w - 0.5, vW.y) * step(vW.y, f.z + 0.3));
            }
            vec3 best = uMesas[0]; float bd = 1e9;
            for (int i = 0; i < ${mesaLen}; i++) { float dm = abs(distance(vW.xz, uMesas[i].xy) - uMesas[i].z); if (dm < bd) { bd = dm; best = uMesas[i]; } }
            float along = atan(vW.x - best.x, vW.z - best.y) * best.z + best.x * 3.7;
            float u = floor(along * uPx) / uPx, y = floor(vW.y * uPx) / uPx;
            vec3 r = rock(u, y, wet);
            r *= mix(1., 0.72, wet); r.b += 0.04 * wet;
            r *= mix(0.68, 1., smoothstep(0., 1.8, vW.y - vCliff.y));
            float d = vCliff.x - vW.y, colN = floor(along * uPx / 2.);
            float L = 0.22 + 0.3 * hash(vec2(colN, 1.3)) + 0.25 * vnoise(vec2(along * 0.9, 2.));
            float hang = step(d, L) * step(vCliff.x - vCliff.y, 30.) * step(1.2, vCliff.x - vCliff.y);
            vec3 hg = mix(g, vec3(0.2, 0.36, 0.2), step(L - 1.5 / uPx, d));
            col = mix(r, hg, hang);
          }`;
  }
);

replacePattern(
  '4b. Skip cliff rock() procedural bevel/moss noise on flat ground in Biome terrain',
  /#ifdef TOON_GROUND\s*\/\/ Coordinate along the wall:[\s\S]*?col = mix\(col, hg, hang\);\s*#else/,
  `#ifdef TOON_GROUND
          col *= 1. - 0.1 * smoothstep(1.5, 4., vCliff.x - vW.y) * step(slope, 0.3);
          if (isRock > 0.5) {
            float useZ = step(an.z + (bayer4(floor(vec2(vW.x + vW.z, vW.y) * uPx)) - 0.5) * 0.2, an.x);
            float along = mix(vW.x, vW.z, useZ);
            float u = floor(along * uPx) / uPx, y = floor(vW.y * uPx) / uPx;
            vec3 r = rock(u, y, 0.);
            r *= mix(0.68, 1., smoothstep(0., 1.8, vW.y - vCliff.y));
            float d = vCliff.x - vW.y, colN = floor(along * uPx / 2.);
            float L = 0.22 + 0.3 * hash(vec2(colN, 1.3)) + 0.25 * vnoise(vec2(along * 0.9, 2.));
            float hang = step(d, L) * step(1.2, vCliff.x - vCliff.y);
            vec3 hg = mix(g, g * vec3(0.5, 0.6, 0.62), step(L - 1.5 / uPx, d));
            col = mix(r, hg, hang);
          }
#else`
);

// 5. Spatial Quadrant Chunking for 3D Prop InstancedMeshes & Bounding Sphere Culling for scatterProps
replacePattern(
  '5a. Chunk 3D biome prop InstancedMeshes into spatial quadrants for automatic frustum culling',
  /let f=new ([A-Za-z0-9_$]+)\(c\.geo,d,t\.length\),p=u\?null:new \1\(c\.geo,s,t\.length\);t\.forEach\(\(e,t\)=>\{let s=Math\.sin\(e\.x\*12\.9898\+e\.z\*78\.233\)\*43758\.5453%1\*Math\.PI\*2;n\.compose\(o\.set\(e\.x,e\.y,e\.z\),r\.setFromAxisAngle\(i,s\),a\.setScalar\(e\.s\)\),f\.setMatrixAt\(t,n\),p\?\.setMatrixAt\(t,n\)\}\);for\(let e of p\?\[f,p\]:\[f\]\)e\.computeBoundingSphere\(\),e\.raycast=\(\)=>\{\},this\.group\.add\(e\)\}/,
  (_, instMeshCls) => {
    return `let chunks=t.length>12?[t.filter(e=>e.x<=0&&e.z<=0),t.filter(e=>e.x>0&&e.z<=0),t.filter(e=>e.x<=0&&e.z>0),t.filter(e=>e.x>0&&e.z>0)].filter(e=>e.length):[t];for(let ch of chunks){let f=new ${instMeshCls}(c.geo,d,ch.length),p=u?null:new ${instMeshCls}(c.geo,s,ch.length);ch.forEach((e,t)=>{let s=Math.sin(e.x*12.9898+e.z*78.233)*43758.5453%1*Math.PI*2;n.compose(o.set(e.x,e.y,e.z),r.setFromAxisAngle(i,s),a.setScalar(e.s)),f.setMatrixAt(t,n),p?.setMatrixAt(t,n)});for(let e of p?[f,p]:[f])e.computeBoundingSphere(),e.raycast=()=>{},this.group.add(e)}}`;
  }
);

replacePattern(
  '5b. Compute bounding spheres on procedural scatterProps InstancedMeshes',
  /for\(let n of\[t\.mat,u\]\)\{let r=new ([A-Za-z0-9_$]+)\(t\.geo,n,i\[e\]\.length\);i\[e\]\.forEach\(\(e,t\)=>r\.setMatrixAt\(t,e\)\),r\.instanceMatrix\.needsUpdate=!0,this\.group\.add\(r\)\}/,
  `for(let n of[t.mat,u]){let r=new $1(t.geo,n,i[e].length);i[e].forEach((e,t)=>r.setMatrixAt(t,e)),r.instanceMatrix.needsUpdate=!0,r.computeBoundingSphere(),r.raycast=()=>{},this.group.add(r)}`
);

// 6. Skip cloud fbm() evaluation on sky pixels where fade <= 0
replacePattern(
  '6. Skip 3x 4-octave fbm() sky cloud evaluations on horizon pixels where fade <= 0',
  /vec2 uv = dir\.xz \/ \(dir\.y \+ 0\.18\) \* 1\.1 \+ vec2\(uTime \* 0\.012, uTime \* 0\.004\);\s*float fade = smoothstep\(0\.02, 0\.2, dir\.y\);\s*float cl = clouds\(uv\) \* fade;\s*float edge = 0\.56 \+ \(dth - 0\.5\) \* 0\.02;\s*if \(cl > edge\) \{/,
  `vec2 uv = dir.xz / (dir.y + 0.18) * 1.1 + vec2(uTime * 0.012, uTime * 0.004);
          float fade = smoothstep(0.02, 0.2, dir.y);
          float edge = 0.56 + (dth - 0.5) * 0.02;
          float cl = fade > 0.01 ? clouds(uv) * fade : 0.0;
          if (cl > edge) {`
);

fs.writeFileSync(bundlePath, code);
console.log(`\nSuccessfully applied ${applied}/8 GPU performance optimizations to assets/${mainFile}!`);
