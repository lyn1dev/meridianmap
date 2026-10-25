import * as THREE from "three";
import L from "leaflet";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

/*
 * Meridian: the Earth map as a 3D globe.
 *
 * The map is a 1:300 equirectangular Earth (371.2 blocks per degree, block x 0 at 180 W, block z 0 at 75 N), so every
 * map tile wraps straight onto a sphere. What's drawn:
 *   - space: a Milky Way baked once into a small cube map, plus a few thousand point stars;
 *   - the Earth: a base texture of the whole map built once from the zoomed-out tiles (relief baked in, ice past the
 *     map's 75 N / 74 S edges), always there under everything;
 *   - sharper tiles for whatever is on screen, picked by how many blocks a screen pixel covers at that spot and
 *     streamed in as you zoom (a coarser tile stays up until its replacement has loaded, then the new one fades in);
 *   - the map's overlays: claims and other shapes as fills and lines on the surface, icons, players and popups as
 *     HTML on top;
 *   - an atmosphere: a glow round the globe and haze towards the horizon.
 * The camera looks at a point on the surface from a range, with a tilt and heading, like Google Earth.
 *
 * It only draws when something changed (a drag, a zoom, a tile arriving), so an idle globe costs nothing.
 */

const MAP_W = 133632;
const MAP_H = 55296;
const BPD = MAP_W / 360; // blocks per degree
const LAT_TOP = 75;
const R_BLOCKS = MAP_W / (2 * Math.PI); // the globe's radius in blocks
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const FOV = 32;
const TAN_HALF = Math.tan((FOV / 2) * D2R);
const MAX_TILT = 70 * D2R;
const BASE_ZOOM = 1;
const TILE_PX = 512;
const TILE_R = 1.00004;
const FILL_R = 1.00008;
const LINE_R = 1.0002;
const MAX_TILE_MESHES = 56;
const FADE_MS = 220;
const Y = new THREE.Vector3(0, 1, 0);

export function worldToGeo(x, z) {
    return { lon: -180 + x / BPD, lat: LAT_TOP - z / BPD };
}

export function geoToWorld(lon, lat) {
    return { x: (lon + 180) * BPD, z: (LAT_TOP - lat) * BPD };
}

function geoToVec(lon, lat, r = 1, out = new THREE.Vector3()) {
    const phi = lat * D2R;
    const lam = lon * D2R;
    const c = Math.cos(phi);
    return out.set(r * c * Math.sin(lam), r * Math.sin(phi), r * c * Math.cos(lam));
}

function worldToVec(x, z, r = 1, out = new THREE.Vector3()) {
    return geoToVec(-180 + x / BPD, LAT_TOP - z / BPD, r, out);
}

function vecToWorld(v) {
    const len = v.length();
    const lat = Math.asin(Math.max(-1, Math.min(1, v.y / len))) * R2D;
    const lon = Math.atan2(v.x, v.z) * R2D;
    const w = geoToWorld(lon, lat);
    return { x: ((w.x % MAP_W) + MAP_W) % MAP_W, z: w.z };
}

/** A curved patch of the sphere over a block rectangle; uv (0,0) is its north-west corner. */
function patchGeometry(x0, z0, x1, z1, segX, segZ, r) {
    const pos = new Float32Array((segX + 1) * (segZ + 1) * 3);
    const uv = new Float32Array((segX + 1) * (segZ + 1) * 2);
    const v = new THREE.Vector3();
    let p = 0;
    let q = 0;
    for (let j = 0; j <= segZ; j++) {
        const fz = j / segZ;
        const z = z0 + (z1 - z0) * fz;
        for (let i = 0; i <= segX; i++) {
            const fx = i / segX;
            worldToVec(x0 + (x1 - x0) * fx, z, r, v);
            pos[p++] = v.x;
            pos[p++] = v.y;
            pos[p++] = v.z;
            uv[q++] = fx;
            uv[q++] = fz;
        }
    }
    const count = segX * segZ * 6;
    const idx = (segX + 1) * (segZ + 1) > 65535 ? new Uint32Array(count) : new Uint16Array(count);
    let k = 0;
    for (let j = 0; j < segZ; j++) {
        for (let i = 0; i < segX; i++) {
            const a = j * (segX + 1) + i;
            const b = a + segX + 1;
            // counter-clockwise seen from outside, so the far side of the globe is culled
            idx[k++] = a;
            idx[k++] = b;
            idx[k++] = a + 1;
            idx[k++] = b;
            idx[k++] = b + 1;
            idx[k++] = a + 1;
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g;
}

// ---------------------------------------------------------------------- shaders

const SURFACE_VERT = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vV;
    varying vec3 vP;
    void main() {
        vUv = uv;
        vP = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normalize(position));
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
    }
`;

const SURFACE_FRAG = /* glsl */ `
    uniform sampler2D map;
    uniform vec3 uLight;
    uniform vec3 uHaze;
    uniform float uShade;
    uniform float uAlpha;
    uniform float uIce;
    uniform vec2 uEdges;
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vV;
    varying vec3 vP;
    float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }
    float noise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
    }
    float fbm(vec3 p) {
        float s = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
            s += a * noise(p);
            p = p * 2.03 + vec3(1.7, 9.2, 4.1);
            a *= 0.5;
        }
        return s / 0.9375;
    }
    /* Past the map's edges (75 N, 74 S): sea ice and ice sheet, worked out on the sphere so nothing stretches at the
       poles, with a few dark cracks of open water, blended into the map over a ragged edge a few degrees deep. */
    vec3 ice(vec3 c) {
        float lat = 90.0 - vUv.y * 180.0;
        float past = max(lat - uEdges.x, uEdges.y - lat);
        if (past < -8.0) return c;
        float n = fbm(vP * 6.0);
        float a = clamp((past + (n - 0.5) * 6.0 + 4.0) / 5.0, 0.0, 1.0);
        if (a <= 0.0) return c;
        float fine = fbm(vP * 40.0 + 5.0);
        vec3 col = vec3(0.95, 0.968, 0.985) * (0.88 + n * 0.12 + (fine - 0.5) * 0.06);
        float crack = abs(fbm(vP * 14.0 - 7.0) - 0.5);
        col = mix(col, vec3(0.42, 0.55, 0.68), (1.0 - smoothstep(0.0, 0.007, crack)) * 0.45);
        return mix(c, pow(col, vec3(2.2)), a);
    }
    void main() {
        vec4 t = texture2D(map, vUv);
        if (t.a < 0.01) discard;
        if (uIce > 0.5) t.rgb = ice(t.rgb);
        vec3 n = normalize(vN);
        float lam = max(dot(n, uLight), 0.0);
        float shade = mix(1.0, mix(0.4, 1.06, lam), uShade);
        // looking across the surface (the globe's edge, or the horizon when tilted) goes hazy blue
        float graze = 1.0 - max(dot(n, normalize(vV)), 0.0);
        float haze = pow(graze, 3.0) * 0.75;
        vec3 c = mix(t.rgb * shade, uHaze, haze);
        gl_FragColor = vec4(c, t.a * uAlpha);
        #include <colorspace_fragment>
    }
`;

const GLOW_VERT = /* glsl */ `
    varying vec3 vN;
    varying vec3 vV;
    void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
    }
`;

const GLOW_FRAG = /* glsl */ `
    uniform vec3 uColor;
    uniform float uLimb;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
        // The back faces of a slightly bigger sphere. A ray that just grazes the Earth meets them at x = uLimb, from
        // outside (a ring round the globe) and from inside (a band over the horizon) alike: brightest there, fading
        // out to nothing at the atmosphere's outer edge and upwards into space.
        float x = -dot(normalize(vN), normalize(vV));
        float i = x < uLimb ? pow(clamp(x / uLimb, 0.0, 1.0), 2.4) : exp(-(x - uLimb) * 4.5);
        gl_FragColor = vec4(uColor * i * 0.85, i * 0.85);
        #include <colorspace_fragment>
    }
`;

const SKY_VERT = /* glsl */ `
    varying vec3 vDir;
    void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

/** The Milky Way: a soft band with a brighter, warmer core, dark dust lanes and a little nebula colour. Baked once. */
const SKY_FRAG = /* glsl */ `
    varying vec3 vDir;
    float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }
    float noise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x),
                       mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                       mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
    }
    float fbm(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 6; i++) {
            v += a * noise(p);
            p = p * 2.03 + vec3(1.7, 9.2, 4.1);
            a *= 0.5;
        }
        return v;
    }
    void main() {
        vec3 d = normalize(vDir);
        vec3 pole = normalize(vec3(0.32, 0.86, -0.40));
        vec3 core = normalize(vec3(-0.62, 0.0, 0.78) - pole * dot(vec3(-0.62, 0.0, 0.78), pole));
        float b = dot(d, pole);
        float along = dot(d, core);

        float warp = fbm(d * 3.0) - 0.5;
        float bw = b + warp * 0.07;
        float thin = exp(-bw * bw / 0.006);
        float wide = exp(-bw * bw / 0.05);
        float coreGlow = pow(max(along, 0.0), 5.0) * exp(-bw * bw / 0.02);

        float cloud = fbm(d * 5.0 + 3.1);
        float fine = fbm(d * 16.0 + 7.7);
        float mw = (thin * 0.75 + wide * 0.22) * (0.35 + cloud * 1.1) * (0.6 + fine * 0.8) + coreGlow * 0.9;
        float dust = smoothstep(0.48, 0.72, fbm(d * 7.0 + 1.3)) * exp(-bw * bw / 0.0035);
        mw *= 1.0 - dust * 0.8;

        vec3 cool = vec3(0.52, 0.6, 0.86);
        vec3 warm = vec3(1.0, 0.8, 0.6);
        vec3 c = mix(cool, warm, clamp(coreGlow * 1.6 + max(along, 0.0) * 0.25, 0.0, 1.0)) * mw * 0.085;

        // faint nebula colour well away from the band too
        c += vec3(0.16, 0.05, 0.22) * smoothstep(0.58, 0.82, fbm(d * 1.6 + 11.0)) * 0.05;
        c += vec3(0.03, 0.08, 0.16) * smoothstep(0.55, 0.82, fbm(d * 2.2 - 5.0)) * 0.05;
        c += vec3(0.002, 0.003, 0.006);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
    }
`;

const STAR_VERT = /* glsl */ `
    attribute float size;
    attribute vec3 color;
    uniform float uScale;
    varying vec3 vColor;
    void main() {
        vColor = color;
        gl_PointSize = size * uScale;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const STAR_FRAG = /* glsl */ `
    varying vec3 vColor;
    void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, r);
        a *= a;
        gl_FragColor = vec4(vColor * a, a);
        #include <colorspace_fragment>
    }
`;

export class GlobeRenderer {
    constructor(options) {
        this.container = options.container;
        this.S = options.S;
        this.onError = options.onError;

        this.disposed = false;
        this.active = false;
        this.raf = 0;
        this.selfMove = false;
        this.ignoreMovesUntil = 0;

        // the camera looks at a surface point (dir) from a range (Earth radii), tilted from straight down, turned to a heading
        this.dir = new THREE.Vector3(0, 0, 1);
        this.alt = 2.9;
        // a shared link can carry the view's tilt and heading (degrees)
        const params = new URLSearchParams(window.location.search);
        this.tilt = 0;
        this.urlTilt = (Number(params.get("tilt")) || 0) * D2R;
        this.heading = (Number(params.get("heading")) || 0) * D2R;
        this.spin = null; // inertia after a drag: { axis, rate (rad/ms) }
        this.flight = null;
        this.zoomTo = null; // smooth zoom: { alt, sx, sy }
        this.orient = null; // smooth heading/tilt change: { heading, tilt }

        this.tiles = new Map(); // key -> { key, zoom, tx, tz, mesh, state, used, d2, born }
        this.queue = [];
        this.loading = 0;
        this.generation = 0; // bumped when the textures must be rebuilt (relief switched)
        this.lastTileUpdate = 0;
        this.fading = 0;

        this.shapes = new Map(); // signature -> { obj, layer, fill, area }
        this.icons = new Map(); // signature -> { el, layer, vec }
        this.players = new Map(); // uuid -> { el, name, vec }
        this.lineMaterials = new Set();

        this.init();
        if (import.meta.env?.DEV) window.__globe = this;
    }

    /** Anything that changes the picture asks for one frame; nothing is drawn otherwise. */
    get dirty() {
        return this._dirty;
    }

    set dirty(v) {
        this._dirty = v;
        if (v) this.requestFrame();
    }

    requestFrame() {
        if (!this.raf && this.active && !this.disposed && this.renderer) this.raf = requestAnimationFrame(this.loop);
    }

    // ------------------------------------------------------------------ setup

    init() {
        try {
            this.renderer = new THREE.WebGLRenderer({
                antialias: true,
                alpha: false,
                powerPreference: "high-performance",
            });
        } catch (e) {
            console.error("Globe: no WebGL", e);
            this.onError?.(e);
            return;
        }
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.renderer.setPixelRatio(this.dpr);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

        this.canvas = this.renderer.domElement;
        this.canvas.className = "globe-canvas";
        this.canvas.tabIndex = 0;
        this.canvas.setAttribute(
            "aria-label",
            "Globe. Drag to turn, scroll or pinch to zoom, Shift-drag or right-drag to tilt and rotate.",
        );
        this.canvas.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            this.onError?.(new Error("WebGL context lost"));
        });
        this.container.appendChild(this.canvas);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color("#020308");
        this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.001, 200);

        this.earth = new THREE.Group();
        this.tileGroup = new THREE.Group();
        this.fillGroup = new THREE.Group();
        this.lineGroup = new THREE.Group();
        this.earth.add(this.tileGroup, this.fillGroup, this.lineGroup);
        this.scene.add(this.earth);

        this.uniforms = {
            uLight: { value: new THREE.Vector3(-0.42, 0.5, 0.76).normalize() },
            uHaze: { value: new THREE.Color("#8fbbe8") },
            uShade: { value: 1 },
        };

        this.loop = this.loop.bind(this);
        this.buildSky();
        this.buildStars();
        this.buildBase();
        this.buildGlow();
        this.buildGraticule();
        this.buildDom();
        this.bindInput();
        this.bindMap();

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.container);
        this.resize();
    }

    surfaceMaterial(texture) {
        return new THREE.ShaderMaterial({
            uniforms: {
                map: { value: texture },
                uAlpha: { value: 1 },
                uIce: { value: 0 },
                uEdges: { value: new THREE.Vector2(LAT_TOP, LAT_TOP - MAP_H / BPD) },
                ...this.uniforms,
            },
            vertexShader: SURFACE_VERT,
            fragmentShader: SURFACE_FRAG,
            transparent: true,
        });
    }

    /** Bakes the Milky Way into a 512 px cube map once; after that the sky costs one texture lookup per pixel. */
    buildSky() {
        try {
            const rt = new THREE.WebGLCubeRenderTarget(512, {
                generateMipmaps: true,
                minFilter: THREE.LinearMipmapLinearFilter,
            });
            rt.texture.colorSpace = THREE.SRGBColorSpace;
            const skyScene = new THREE.Scene();
            const mat = new THREE.ShaderMaterial({
                vertexShader: SKY_VERT,
                fragmentShader: SKY_FRAG,
                side: THREE.BackSide,
                depthWrite: false,
            });
            const mesh = new THREE.Mesh(new THREE.SphereGeometry(5, 64, 32), mat);
            skyScene.add(mesh);
            const cubeCam = new THREE.CubeCamera(0.1, 10, rt);
            cubeCam.update(this.renderer, skyScene);
            mesh.geometry.dispose();
            mat.dispose();
            this.skyTarget = rt;
            this.scene.background = rt.texture;
        } catch (e) {
            console.warn("Globe: no Milky Way", e);
        }
    }

    /** Point stars, sharp at any screen size: most scattered evenly, more of them along the Milky Way. */
    buildStars() {
        const n = 4200;
        const pos = new Float32Array(n * 3);
        const col = new Float32Array(n * 3);
        const size = new Float32Array(n);
        let seed = 20261003;
        const rnd = () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 4294967296;
        };
        const pole = new THREE.Vector3(0.32, 0.86, -0.4).normalize();
        const v = new THREE.Vector3();
        for (let i = 0; i < n; i++) {
            v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
            const l = v.lengthSq();
            if (l > 1 || l < 0.01) {
                i--;
                continue;
            }
            v.normalize();
            // a third of the stars hug the galactic plane
            if (i % 3 === 0 && Math.abs(v.dot(pole)) > 0.18 * rnd()) {
                i--;
                continue;
            }
            v.multiplyScalar(100);
            pos.set([v.x, v.y, v.z], i * 3);
            const m = Math.pow(rnd(), 5); // a few bright stars, many faint ones
            size[i] = 1.0 + m * 2.6;
            const b = 0.22 + m * 0.78 + rnd() * 0.1;
            const t = rnd();
            col.set(t > 0.86 ? [b, b * 0.86, b * 0.68] : t < 0.22 ? [b * 0.76, b * 0.85, b] : [b, b, b * 0.98], i * 3);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        g.setAttribute("color", new THREE.BufferAttribute(col, 3));
        g.setAttribute("size", new THREE.BufferAttribute(size, 1));
        this.starMaterial = new THREE.ShaderMaterial({
            uniforms: { uScale: { value: this.dpr } },
            vertexShader: STAR_VERT,
            fragmentShader: STAR_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        this.stars = new THREE.Points(g, this.starMaterial);
        this.stars.frustumCulled = false;
        this.stars.renderOrder = -10;
        this.scene.add(this.stars);
    }

    /** The always-there Earth: lon -180..180, lat 90..-90, 1 degree per segment. */
    buildBase() {
        const g = patchGeometry(0, (LAT_TOP - 90) * BPD, MAP_W, (LAT_TOP + 90) * BPD, 360, 180, 1);
        const blank = new THREE.DataTexture(new Uint8Array([24, 54, 94, 255]), 1, 1);
        blank.needsUpdate = true;
        const mat = this.surfaceMaterial(blank);
        mat.transparent = false;
        mat.uniforms.uIce.value = 1;
        this.base = new THREE.Mesh(g, mat);
        this.base.renderOrder = 0;
        this.earth.add(this.base);
    }

    buildGlow() {
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color("#5b9cf0") },
                uLimb: { value: Math.sqrt(1 - 1 / (1.07 * 1.07)) },
            },
            vertexShader: GLOW_VERT,
            fragmentShader: GLOW_FRAG,
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        this.glow = new THREE.Mesh(new THREE.SphereGeometry(1.07, 128, 64), mat);
        this.glow.renderOrder = -5;
        this.scene.add(this.glow);
    }

    /** Faint lines every 15 degrees, only while the whole globe is in view. */
    buildGraticule() {
        const seg = [];
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const push = (lon0, lat0, lon1, lat1) => {
            geoToVec(lon0, lat0, LINE_R, a);
            geoToVec(lon1, lat1, LINE_R, b);
            seg.push(a.x, a.y, a.z, b.x, b.y, b.z);
        };
        for (let lat = -75; lat <= 75; lat += 15) {
            for (let lon = -180; lon < 180; lon += 1) push(lon, lat, lon + 1, lat);
        }
        for (let lon = -180; lon < 180; lon += 15) {
            for (let lat = -80; lat < 80; lat += 1) push(lon, lat, lon, lat + 1);
        }
        this.graticule = this.makeLines(seg, "#ffffff", 0.06, 1);
        this.graticule.renderOrder = 25;
        this.earth.add(this.graticule);
    }

    makeLines(positions, color, opacity, width) {
        const g = new LineSegmentsGeometry();
        g.setPositions(positions);
        const m = new LineMaterial({
            color: new THREE.Color(color),
            linewidth: width,
            transparent: true,
            opacity,
            depthWrite: false,
        });
        m.resolution.set(this.width || 1, this.height || 1);
        this.lineMaterials.add(m);
        const lines = new LineSegments2(g, m);
        lines.frustumCulled = false;
        return lines;
    }

    buildDom() {
        const el = (tag, cls, parent) => {
            const e = document.createElement(tag);
            if (cls) e.className = cls;
            parent?.appendChild(e);
            return e;
        };
        // .leaflet-container so the map's own tooltip, popup and icon styles apply up here too
        this.overlay = el("div", "globe-overlays leaflet-container", this.container);
        this.iconLayer = el("div", "globe-icons", this.overlay);
        this.playerLayer = el("div", "globe-players", this.overlay);

        this.tooltip = el("div", "leaflet-tooltip globe-tooltip", this.overlay);
        this.tooltip.hidden = true;

        this.popup = el("div", "leaflet-popup m-popup globe-popup", this.overlay);
        this.popup.hidden = true;
        this.popup._after = " translate(-50%, -100%)";
        const wrap = el("div", "leaflet-popup-content-wrapper", this.popup);
        this.popupContent = el("div", "leaflet-popup-content", wrap);
        const tipBox = el("div", "leaflet-popup-tip-container", this.popup);
        el("div", "leaflet-popup-tip", tipBox);
        const close = el("a", "leaflet-popup-close-button", this.popup);
        close.href = "#close";
        close.setAttribute("role", "button");
        close.setAttribute("aria-label", "Close popup");
        close.innerHTML = '<span aria-hidden="true">×</span>';
        close.addEventListener("click", (e) => {
            e.preventDefault();
            this.closePopup();
        });

        this.controls = el("div", "globe-ctl", this.container);
        const btn = (html, title, fn) => {
            const b = el("button", "", this.controls);
            b.type = "button";
            b.title = title;
            b.setAttribute("aria-label", title);
            b.innerHTML = html;
            b.addEventListener("click", fn);
            return b;
        };
        btn("+", "Zoom in", () => this.zoomBy(0.45));
        btn("&minus;", "Zoom out", () => this.zoomBy(2.2));
        this.compass = btn(
            '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M8 1.5 10.6 8H5.4z" fill="#f5c83d"/><path d="M8 14.5 5.4 8h5.2z" fill="currentColor" opacity=".55"/></svg>',
            "North up, straight down",
            () => {
                this.stopMotion();
                this.orient = { heading: 0, tilt: 0 };
                this.dirty = true;
            },
        );
        btn(
            '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><ellipse cx="8" cy="8" rx="2.6" ry="6"/><path d="M2 8h12"/></svg>',
            "Whole globe",
            () => {
                this.flyTo(this.dir.clone(), this.homeRange());
                this.orient = { heading: 0, tilt: 0 };
            },
        );
        if (this.S?.showControls === false) this.controls.hidden = true;

        this.coords = el("div", "m-coords globe-coords", this.container);
        this.coordsXZ = el("span", "xz", this.coords);
        this.coordsLL = el("span", "ll", this.coords);
        this.setCoords(null);
        if (this.S?.coordinates?.coords?.getContainer?.()?.hidden) this.coords.hidden = true;

        this.hint = el("div", "globe-hint", this.container);
        this.hint.textContent = "Drag to turn · scroll to zoom · Shift-drag to tilt";
    }

    // ------------------------------------------------------------------ camera

    maxZoom() {
        return this.S?.worldList?.curWorld?.zoom?.max ?? 7;
    }

    bppAt(distance) {
        return (distance * 2 * TAN_HALF * R_BLOCKS) / Math.max(1, this.height || 1);
    }

    altForZoom(zoom) {
        const bpp = Math.pow(2, this.maxZoom() - zoom);
        return Math.min(this.maxRange(), Math.max(this.minAlt(), (bpp * this.height) / (2 * TAN_HALF * R_BLOCKS)));
    }

    zoomForAlt(alt) {
        const max = this.maxZoom();
        const z = max - Math.log2(this.bppAt(alt));
        const extra = this.S?.worldList?.curWorld?.zoom?.extra ?? 0;
        return Math.max(0, Math.min(max + extra, Math.round(z * 10) / 10));
    }

    /** The narrower half-angle of the view (a phone held upright is narrow, not short). */
    halfView() {
        const aspect = (this.width || 1) / (this.height || 1);
        return Math.min(FOV / 2, Math.atan(TAN_HALF * aspect) * R2D) * D2R;
    }

    /** The whole globe with room round it. */
    homeRange() {
        return 1 / Math.sin(this.halfView() * 0.9) - 1;
    }

    /** As far out as you can go: the globe at about half the screen. */
    maxRange() {
        return 1 / Math.sin(this.halfView() * 0.5) - 1;
    }

    /** As close as the flat map goes: a quarter of a block per pixel. */
    minAlt() {
        return Math.max(0.0005, (0.25 * (this.height || 800)) / (2 * TAN_HALF * R_BLOCKS));
    }

    /** How far the camera may tilt at this range: none with the whole globe in view, up to 70 degrees closer in. */
    maxTilt(alt) {
        return MAX_TILT * (1 - THREE.MathUtils.smoothstep(alt, 0.35, 2.3));
    }

    clampCamera() {
        const max = 82 * D2R;
        const lat = Math.asin(Math.max(-1, Math.min(1, this.dir.y / this.dir.length())));
        if (Math.abs(lat) > max) {
            const h = Math.hypot(this.dir.x, this.dir.z) || 1;
            this.dir.set(
                (this.dir.x / h) * Math.cos(max),
                Math.sign(lat) * Math.sin(max),
                (this.dir.z / h) * Math.cos(max),
            );
        }
        this.dir.normalize();
        this.alt = Math.min(this.maxRange(), Math.max(this.minAlt(), this.alt));
        this.tilt = Math.max(0, Math.min(this.maxTilt(this.alt), this.tilt));
        this.heading = Math.atan2(Math.sin(this.heading), Math.cos(this.heading));
    }

    /** The local frame at the target: east and north along the surface. */
    frame(t = this.dir) {
        const east = new THREE.Vector3().crossVectors(Y, t);
        if (east.lengthSq() < 1e-10) east.set(1, 0, 0);
        east.normalize();
        const north = new THREE.Vector3().crossVectors(t, east).normalize();
        return { east, north };
    }

    updateCamera() {
        this.clampCamera();
        const t = this.dir;
        const { east, north } = this.frame(t);
        const fwd = north.multiplyScalar(Math.cos(this.heading)).addScaledVector(east, Math.sin(this.heading));
        const ct = Math.cos(this.tilt);
        const st = Math.sin(this.tilt);
        this.camera.position
            .copy(t)
            .addScaledVector(t, this.alt * ct)
            .addScaledVector(fwd, -this.alt * st);
        this.camera.up.copy(fwd).multiplyScalar(ct).addScaledVector(t, st);
        this.camera.lookAt(t);
        const height = this.camera.position.length() - 1;
        this.camera.near = Math.max(0.0001, height * 0.25);
        this.camera.far = 200;
        this.camera.updateProjectionMatrix();
        this.camera.updateMatrixWorld();

        // up close the globe is just a map: no shading or grid
        this.uniforms.uShade.value = THREE.MathUtils.smoothstep(this.alt, 0.1, 1.0);
        this.graticule.material.opacity = 0.06 * THREE.MathUtils.smoothstep(this.alt, 0.5, 1.6);
        this.graticule.visible = this.alt > 0.5;
        if (this.compass) this.compass.firstChild.style.transform = `rotate(${-this.heading * R2D}deg)`;
        this.dirty = true;
    }

    /** Where a screen point (CSS px in the canvas) meets the globe, or null. */
    pick(sx, sy, out = new THREE.Vector3()) {
        const o = this.camera.position;
        const d = this._ray || (this._ray = new THREE.Vector3());
        d.set((sx / this.width) * 2 - 1, -(sy / this.height) * 2 + 1, 0.5)
            .unproject(this.camera)
            .sub(o)
            .normalize();
        const b = o.dot(d);
        const disc = b * b - (o.lengthSq() - 1);
        if (disc < 0) return null;
        const t = -b - Math.sqrt(disc);
        if (t < 0) return null;
        return out.copy(o).addScaledVector(d, t);
    }

    /** Turn the whole view so that surface point `from` moves to where `to` is. */
    rotateBetween(from, to) {
        const q = new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
        const before = this.frame();
        const fwd = before.north
            .multiplyScalar(Math.cos(this.heading))
            .addScaledVector(before.east, Math.sin(this.heading))
            .applyQuaternion(q);
        this.dir.applyQuaternion(q).normalize();
        // keep the view's heading as the view turns (it would otherwise twist near the poles)
        const after = this.frame();
        this.heading = Math.atan2(fwd.dot(after.east), fwd.dot(after.north));
        return q;
    }

    zoomAt(sx, sy, factor) {
        const before = this.pick(sx, sy);
        this.alt *= factor;
        this.updateCamera();
        if (before) {
            const after = this.pick(sx, sy);
            if (after) {
                this.rotateBetween(after, before);
                this.updateCamera();
            }
        }
    }

    zoomBy(factor) {
        this.spin = null;
        this.flight = null;
        const from = this.zoomTo?.alt ?? this.alt;
        this.zoomTo = {
            alt: Math.min(this.maxRange(), Math.max(this.minAlt(), from * factor)),
            sx: this.width / 2,
            sy: this.height / 2,
        };
        this.dirty = true;
    }

    stopMotion() {
        this.spin = null;
        this.flight = null;
        this.zoomTo = null;
        this.orient = null;
    }

    /** A smooth flight: along the great circle, rising for long trips, like Google Earth. */
    flyTo(dir, alt, ms) {
        const to = dir.clone().normalize();
        const angle = this.dir.angleTo(to);
        const a0 = this.alt;
        const a1 = Math.min(this.maxRange(), Math.max(this.minAlt(), alt));
        const mid = Math.max(a0, a1, Math.min(this.maxRange(), angle * 1.1));
        this.stopMotion();
        this.flight = {
            from: this.dir.clone(),
            to,
            angle,
            l0: Math.log(a0),
            l1: Math.log(a1),
            lm: 2 * Math.log(mid) - 0.5 * (Math.log(a0) + Math.log(a1)),
            start: performance.now(),
            ms: ms ?? Math.min(2200, 600 + angle * 650 + Math.abs(Math.log(a1 / a0)) * 140),
        };
        this.dirty = true;
    }

    getView() {
        const w = vecToWorld(this.dir);
        return { x: Math.floor(w.x), z: Math.floor(w.z), zoom: this.zoomForAlt(this.alt) };
    }

    setView({ x, z, zoom }) {
        if (!this.renderer || !Number.isFinite(x) || !Number.isFinite(z)) return;
        this.stopMotion();
        worldToVec(x, z, 1, this.dir);
        // the flat map's zoomed-out levels show more than the whole Earth: on the globe that's the whole-globe view
        this.alt = Math.min(this.altForZoom(Number.isFinite(zoom) ? zoom : 1), this.homeRange());
        if (this.urlTilt) {
            this.tilt = this.urlTilt;
            this.urlTilt = 0;
        }
        this.updateCamera();
        this.updateTiles();
        this.syncLeaflet();
    }

    // ------------------------------------------------------------------ input

    bindInput() {
        const c = this.canvas;
        const pointers = new Map();
        let grab = null; // the surface point held under the pointer
        let pinch = null;
        let mode = null; // "pan" | "orbit"
        let moved = false;
        let downAt = null;
        let last = null;
        let samples = [];

        const local = (e) => {
            const r = c.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        };
        const firstUse = () => {
            if (this.hint && !this.hint.classList.contains("gone")) this.hint.classList.add("gone");
        };

        c.addEventListener("contextmenu", (e) => e.preventDefault());

        c.addEventListener("pointerdown", (e) => {
            c.focus({ preventScroll: true });
            c.setPointerCapture(e.pointerId);
            const p = local(e);
            pointers.set(e.pointerId, p);
            this.stopMotion();
            this.S?.playerList?.followPlayerMarker(null);
            firstUse();
            moved = false;
            downAt = p;
            last = p;
            samples = [];
            if (pointers.size === 1) {
                mode = e.button === 2 || e.shiftKey || e.ctrlKey || e.button === 1 ? "orbit" : "pan";
                grab = mode === "pan" ? this.pick(p.x, p.y) : null;
            } else if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                mode = "pan";
                pinch = {
                    d: Math.hypot(a.x - b.x, a.y - b.y),
                    alt: this.alt,
                    my: (a.y + b.y) / 2,
                    tilt: this.tilt,
                    angle: Math.atan2(b.y - a.y, b.x - a.x),
                    heading: this.heading,
                };
                grab = this.pick((a.x + b.x) / 2, (a.y + b.y) / 2);
            }
            c.classList.add("grabbing");
        });

        c.addEventListener("pointermove", (e) => {
            const p = local(e);
            if (!pointers.has(e.pointerId)) {
                this.hover(p);
                return;
            }
            pointers.set(e.pointerId, p);
            if (downAt && Math.hypot(p.x - downAt.x, p.y - downAt.y) > 4) moved = true;
            if (!moved) return;
            this.hideTooltip();

            if (mode === "orbit" && pointers.size === 1) {
                // tilt with up/down, turn with left/right, round the middle of the screen
                this.heading -= (p.x - last.x) * 0.006;
                this.tilt += (p.y - last.y) * 0.005;
                last = p;
                this.updateCamera();
                return;
            }

            let at = p;
            if (pointers.size >= 2 && pinch) {
                const [a, b] = [...pointers.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                this.alt = pinch.alt * (pinch.d / Math.max(1, d));
                // two fingers: twist to turn, slide up or down together to tilt
                const ang = Math.atan2(b.y - a.y, b.x - a.x);
                this.heading = pinch.heading - (ang - pinch.angle);
                const my = (a.y + b.y) / 2;
                if (Math.abs(d - pinch.d) < 40) this.tilt = pinch.tilt + (my - pinch.my) * 0.006;
                at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                this.updateCamera();
            }
            if (grab) {
                const now = this.pick(at.x, at.y);
                if (now) {
                    const q = this.rotateBetween(now, grab);
                    this.updateCamera();
                    samples.push({ t: performance.now(), q });
                    if (samples.length > 6) samples.shift();
                    last = p;
                    return;
                }
            }
            // off the edge of the globe: turn by screen distance instead
            const k = Math.min(0.006, this.bppAt(this.alt) / R_BLOCKS);
            const { east, north } = this.frame();
            const right = east
                .clone()
                .multiplyScalar(Math.cos(this.heading))
                .addScaledVector(north, -Math.sin(this.heading));
            const up = north
                .clone()
                .multiplyScalar(Math.cos(this.heading))
                .addScaledVector(east, Math.sin(this.heading));
            this.dir.addScaledVector(right, -(p.x - last.x) * k).addScaledVector(up, (p.y - last.y) * k);
            last = p;
            this.updateCamera();
        });

        const end = (e) => {
            if (!pointers.has(e.pointerId)) return;
            pointers.delete(e.pointerId);
            if (pointers.size === 1) {
                const [q] = [...pointers.values()];
                grab = this.pick(q.x, q.y);
                last = q;
                pinch = null;
                samples = [];
                return;
            }
            if (pointers.size > 0) return;
            c.classList.remove("grabbing");
            grab = null;
            pinch = null;
            if (!moved && e.type === "pointerup" && e.button === 0) {
                this.click(local(e), e);
                return;
            }
            // let go mid-drag: keep turning for a moment, slowing down
            const now = performance.now();
            const recent = samples.filter((s) => now - s.t < 90);
            if (mode === "pan" && recent.length >= 2) {
                const span = Math.max(16, now - recent[0].t);
                const total = new THREE.Quaternion();
                for (const s of recent) total.premultiply(s.q);
                if (total.w < 0) total.set(-total.x, -total.y, -total.z, -total.w);
                const angle = 2 * Math.acos(Math.min(1, total.w));
                if (angle > 1e-6) {
                    const axis = new THREE.Vector3(total.x, total.y, total.z).normalize();
                    this.spin = { axis, rate: angle / span };
                    this.dirty = true;
                }
            }
        };
        c.addEventListener("pointerup", end);
        c.addEventListener("pointercancel", end);
        c.addEventListener("pointerleave", () => {
            if (pointers.size === 0) {
                this.hideTooltip();
                this.setCoords(null);
            }
        });

        c.addEventListener(
            "wheel",
            (e) => {
                e.preventDefault();
                firstUse();
                const p = local(e);
                const lines = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
                const factor = Math.exp(Math.max(-0.6, Math.min(0.6, e.deltaY * lines * 0.0018)));
                this.spin = null;
                this.flight = null;
                const from = this.zoomTo?.alt ?? this.alt;
                this.zoomTo = {
                    alt: Math.min(this.maxRange(), Math.max(this.minAlt(), from * factor)),
                    sx: p.x,
                    sy: p.y,
                };
                this.dirty = true;
            },
            { passive: false },
        );

        c.addEventListener("dblclick", (e) => {
            e.preventDefault();
            const p = local(e);
            this.spin = null;
            this.flight = null;
            this.zoomTo = {
                alt: Math.min(this.maxRange(), Math.max(this.minAlt(), this.alt * (e.shiftKey ? 2.5 : 0.4))),
                sx: p.x,
                sy: p.y,
            };
            this.dirty = true;
        });

        c.addEventListener("keydown", (e) => {
            const step = Math.min(0.3, (this.bppAt(this.alt) * this.height * 0.12) / R_BLOCKS);
            const { east, north } = this.frame();
            const right = east
                .clone()
                .multiplyScalar(Math.cos(this.heading))
                .addScaledVector(north, -Math.sin(this.heading));
            const up = north
                .clone()
                .multiplyScalar(Math.cos(this.heading))
                .addScaledVector(east, Math.sin(this.heading));
            let handled = true;
            if (e.key === "+" || e.key === "=") this.zoomBy(0.5);
            else if (e.key === "-" || e.key === "_") this.zoomBy(2);
            else if (e.key === "n" || e.key === "N") this.orient = { heading: 0, tilt: 0 };
            else if (e.shiftKey && e.key === "ArrowLeft") this.heading += 0.12;
            else if (e.shiftKey && e.key === "ArrowRight") this.heading -= 0.12;
            else if (e.shiftKey && e.key === "ArrowUp") this.tilt += 0.08;
            else if (e.shiftKey && e.key === "ArrowDown") this.tilt -= 0.08;
            else if (e.key === "ArrowLeft") this.dir.addScaledVector(right, -step);
            else if (e.key === "ArrowRight") this.dir.addScaledVector(right, step);
            else if (e.key === "ArrowUp") this.dir.addScaledVector(up, step);
            else if (e.key === "ArrowDown") this.dir.addScaledVector(up, -step);
            else handled = false;
            if (handled) {
                e.preventDefault();
                firstUse();
                this.updateCamera();
            }
        });
    }

    /** Keep up with the flat map: its overlays, popups and anything that moves it (town search, player list). */
    bindMap() {
        const map = this.S?.map;
        if (!map) return;
        this.onLayers = () => this.syncOverlays();
        map.on("layeradd layerremove", this.onLayers);
        this.onMove = () => {
            // only real navigation (town search, player list, shops) moves the globe: not our own syncing, and not
            // Leaflet auto-panning its hidden map to fit a popup we opened
            if (!this.active || this.selfMove || performance.now() < this.ignoreMovesUntil) return;
            const p = this.S.toPoint(map.getCenter());
            const here = vecToWorld(this.dir);
            if (Math.hypot(p.x - here.x, p.y - here.z) < 2 && Math.abs(map.getZoom() - this.zoomForAlt(this.alt)) < 1)
                return;
            this.flyTo(worldToVec(p.x, p.y), Math.min(this.altForZoom(map.getZoom()), this.homeRange()));
        };
        map.on("moveend", this.onMove);
        this.onPopup = (e) => {
            if (!this.active) return;
            let content = e.popup.getContent();
            if (typeof content === "function") content = content(e.popup._source);
            const ll = e.popup.getLatLng();
            map.closePopup(e.popup);
            if (ll) {
                const p = this.S.toPoint(ll);
                this.popupAt = worldToVec(p.x, p.y, 1);
            }
            if (content != null) this.openPopup(content);
        };
        map.on("popupopen", this.onPopup);
    }

    hover(p) {
        const hit = this.pick(p.x, p.y);
        this.setCoords(hit ? vecToWorld(hit) : null);
        const now = performance.now();
        if (now - (this.lastHover || 0) < 50) return;
        this.lastHover = now;
        const shape = hit ? this.shapeAt(p) : null;
        const tip = shape ? this.tooltipOf(shape.layer) : null;
        this.canvas.classList.toggle("pointer", shape != null && this.clickable(shape.layer));
        if (tip) this.showTooltip(tip, p);
        else this.hideTooltip();
    }

    shapeAt(p) {
        const fills = [];
        for (const s of this.shapes.values()) if (s.fill) fills.push(s.fill);
        if (!fills.length) return null;
        const ray = this._raycaster || (this._raycaster = new THREE.Raycaster());
        ray.setFromCamera(new THREE.Vector2((p.x / this.width) * 2 - 1, -(p.y / this.height) * 2 + 1), this.camera);
        // only shapes on the near side: anything past the globe's own surface is round the back
        const ground = this.pick(p.x, p.y);
        const limit = ground ? ground.distanceTo(this.camera.position) + 0.001 : Infinity;
        let best = null;
        for (const h of ray.intersectObjects(fills, false)) {
            if (h.distance > limit) continue;
            const s = h.object.userData.shape;
            // the smallest shape under the pointer wins (a town over a bigger area)
            if (!best || s.area < best.area) best = s;
        }
        return best;
    }

    tooltipOf(layer) {
        const t = layer.getTooltip?.();
        if (!t) return null;
        let c = t.getContent();
        if (typeof c === "function") c = c(layer);
        return c;
    }

    clickable(layer) {
        return !!(layer.getPopup?.() || layer.listens?.("click"));
    }

    click(p, e) {
        this.closePopup();
        const hit = this.pick(p.x, p.y);
        if (!hit) return;
        const shape = this.shapeAt(p);
        if (shape && this.clickable(shape.layer)) {
            this.popupAt = hit.clone().normalize();
            this.fire(shape.layer, vecToWorld(hit), e);
        }
    }

    /** Clicks go through the map's own handlers; the popup they open is caught in bindMap and shown here. */
    fire(layer, w, e) {
        this.ignoreMovesUntil = performance.now() + 1500;
        const coords = this.S.coordinates?.coords;
        if (coords) {
            coords.x = Math.floor(w.x);
            coords.z = Math.floor(w.z);
        }
        layer.fire("click", { latlng: this.S.toLatLng(w.x, w.z), originalEvent: e });
    }

    openPopup(content) {
        if (content instanceof HTMLElement) this.popupContent.replaceChildren(content);
        else this.popupContent.innerHTML = String(content);
        this.popup.hidden = false;
        this.dirty = true;
    }

    closePopup() {
        this.popup.hidden = true;
        this.popupAt = null;
    }

    showTooltip(html, p) {
        if (html instanceof HTMLElement) {
            if (this.tooltip.firstChild !== html) this.tooltip.replaceChildren(html);
        } else if (this.tipHtml !== String(html)) {
            this.tipHtml = String(html);
            this.tooltip.innerHTML = this.tipHtml;
        }
        this.tooltip.hidden = false;
        this.tooltip.style.transform = `translate(${Math.round(p.x + 14)}px, ${Math.round(p.y + 14)}px)`;
    }

    hideTooltip() {
        if (!this.tooltip.hidden) this.tooltip.hidden = true;
        this.canvas.classList.remove("pointer");
    }

    setCoords(w) {
        if (!w) {
            this.coordsXZ.textContent = "X —  Z —";
            this.coordsLL.textContent = "";
            return;
        }
        const fmt = (n) => Math.floor(n).toLocaleString("en-US").replace("-", "−");
        this.coordsXZ.textContent = `X ${fmt(w.x)}  Z ${fmt(w.z)}`;
        const g = worldToGeo(w.x, w.z);
        if (this.S?.worldList?.curWorld?.type !== "normal" || g.lat > 90 || g.lat < -90) {
            this.coordsLL.textContent = "";
            return;
        }
        this.coordsLL.textContent = `${Math.abs(g.lat).toFixed(2)}° ${g.lat >= 0 ? "N" : "S"}  ${Math.abs(g.lon).toFixed(2)}° ${g.lon >= 0 ? "E" : "W"}`;
    }

    // ------------------------------------------------------------------ frame loop

    loop(now) {
        this.raf = 0;
        if (this.disposed || !this.active) return;
        const dt = Math.min(50, now - (this.lastFrame ?? now - 16));
        this.lastFrame = now;
        let moving = false;

        if (this.flight) {
            const f = this.flight;
            const t = Math.min(1, (now - f.start) / f.ms);
            const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            if (f.angle > 1e-7) {
                const axis = new THREE.Vector3().crossVectors(f.from, f.to);
                if (axis.lengthSq() < 1e-14) axis.copy(this.frame(f.from).north);
                this.dir.copy(f.from).applyAxisAngle(axis.normalize(), f.angle * e);
            }
            this.alt = Math.exp((1 - e) * (1 - e) * f.l0 + 2 * e * (1 - e) * f.lm + e * e * f.l1);
            this.updateCamera();
            if (t >= 1) this.flight = null;
            moving = true;
        } else if (this.zoomTo) {
            const z = this.zoomTo;
            const k = 1 - Math.exp(-dt / 75);
            const next = Math.exp(Math.log(this.alt) + (Math.log(z.alt) - Math.log(this.alt)) * k);
            this.zoomAt(z.sx, z.sy, next / this.alt);
            if (Math.abs(Math.log(this.alt / z.alt)) < 0.003) this.zoomTo = null;
            moving = true;
        } else if (this.spin) {
            this.dir.applyAxisAngle(this.spin.axis, this.spin.rate * dt);
            this.spin.rate *= Math.pow(0.994, dt);
            this.updateCamera();
            if (this.spin.rate < 3e-7) this.spin = null;
            moving = true;
        }
        if (this.orient) {
            const k = 1 - Math.exp(-dt / 90);
            const dh = Math.atan2(
                Math.sin(this.orient.heading - this.heading),
                Math.cos(this.orient.heading - this.heading),
            );
            this.heading += dh * k;
            this.tilt += (this.orient.tilt - this.tilt) * k;
            if (Math.abs(dh) < 0.002 && Math.abs(this.orient.tilt - this.tilt) < 0.002) {
                this.heading = this.orient.heading;
                this.tilt = this.orient.tilt;
                this.orient = null;
            }
            this.updateCamera();
            moving = true;
        }

        // tiles that just arrived fade in
        if (this.fading > 0) {
            this.fading = 0;
            for (const e of this.tiles.values()) {
                if (!e.mesh || !e.mesh.visible) continue;
                const a = Math.min(1, (now - e.born) / FADE_MS);
                e.mesh.material.uniforms.uAlpha.value = a;
                if (a < 1) this.fading++;
            }
            this._dirty = true;
        }

        if (this._dirty || this.domDirty) {
            if (this._dirty) {
                if (!moving || now - this.lastTileUpdate > 150) this.updateTiles();
                this.renderer.render(this.scene, this.camera);
            }
            this._dirty = false;
            this.domDirty = false;
            this.placeDom();
        }
        if (moving || this.fading > 0) this.requestFrame();
        else if (this.wasMoving) {
            this.updateTiles(); // settle: the exact tiles for where the camera stopped
            this.syncLeaflet();
        }
        this.wasMoving = moving;
    }

    /** Keeps the hidden flat map on the same spot, so anything that reads or nudges it starts from where we are. */
    syncLeaflet() {
        const map = this.S?.map;
        if (!map || !this.active) return;
        const v = this.getView();
        this.selfMove = true;
        try {
            map.setView(this.S.toLatLng(v.x, v.z), Math.round(v.zoom), { animate: false });
        } finally {
            this.selfMove = false;
        }
    }

    resize() {
        if (this.disposed || !this.renderer) return;
        this.width = Math.max(10, this.container.clientWidth);
        this.height = Math.max(10, this.container.clientHeight);
        this.camera.aspect = this.width / this.height;
        this.renderer.setSize(this.width, this.height, false);
        for (const m of this.lineMaterials) m.resolution.set(this.width, this.height);
        this.updateCamera();
    }

    setActive(active) {
        if (!this.renderer) return;
        this.active = active;
        if (!active) {
            this.stopMotion();
            this.closePopup();
            this.hideTooltip();
            if (this.raf) cancelAnimationFrame(this.raf);
            this.raf = 0;
            return;
        }
        this.resize();
        this.lastFrame = undefined;
        this.checkRelief();
        if (!this.baseLoaded) this.loadBase();
        this.syncOverlays(true);
        this.updateTiles();
        this.dirty = true;
    }

    // ------------------------------------------------------------------ textures

    worldName() {
        return this.S?.worldList?.curWorld?.name || "minecraft_overworld";
    }

    reliefOn() {
        const r = this.S?.layerControl?.reliefLayer;
        return r != null && this.S.map.hasLayer(r);
    }

    /** Switching relief on or off rebuilds every texture, so the globe matches the flat map. */
    checkRelief() {
        const on = this.reliefOn();
        if (this.relief === on) return;
        const first = this.relief === undefined;
        this.relief = on;
        if (first) return;
        this.generation++;
        this.baseLoaded = false;
        this.baseLoading = false;
        this.dropAllTiles();
        this.loadBase();
    }

    async fetchImage(url) {
        try {
            const res = await fetch(url);
            if (!res.ok) return null;
            const blob = await res.blob();
            if (!blob.size) return null;
            return await createImageBitmap(blob);
        } catch {
            return null;
        }
    }

    /** One map tile, with the relief shading on top like the flat map does (hard-light). */
    async tileImage(zoom, tx, tz) {
        const world = this.worldName();
        const [img, relief] = await Promise.all([
            this.fetchImage(`tiles/${world}/${zoom}/${tx}_${tz}.png`),
            this.relief ? this.fetchImage(`tiles/${world}/relief/${zoom}/${tx}_${tz}.png`) : null,
        ]);
        if (!img) {
            relief?.close();
            return null;
        }
        if (!relief) return img;
        const cv =
            typeof OffscreenCanvas !== "undefined"
                ? new OffscreenCanvas(TILE_PX, TILE_PX)
                : Object.assign(document.createElement("canvas"), { width: TILE_PX, height: TILE_PX });
        const g = cv.getContext("2d");
        g.drawImage(img, 0, 0, TILE_PX, TILE_PX);
        const settings = this.S?.worldList?.curWorld?.relief;
        g.globalCompositeOperation = settings?.blend_mode || "hard-light";
        g.globalAlpha = settings?.opacity ?? 1;
        g.drawImage(relief, 0, 0, TILE_PX, TILE_PX);
        img.close();
        relief.close();
        return cv;
    }

    texture(image) {
        const t =
            typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap
                ? new THREE.Texture(image)
                : new THREE.CanvasTexture(image);
        t.flipY = false;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = this.maxAniso;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.needsUpdate = true;
        return t;
    }

    /** The whole Earth from the zoom-1 tiles, ice past the map's edges, as one equirectangular texture. */
    async loadBase() {
        if (this.baseLoading) return;
        this.baseLoading = true;
        const gen = this.generation;
        const span = TILE_PX * Math.pow(2, this.maxZoom() - BASE_ZOOM);
        const scale = TILE_PX / span; // pixels per block
        const w = Math.round(MAP_W * scale);
        const h = Math.round(180 * BPD * scale);
        const top = Math.round((90 - LAT_TOP) * BPD * scale);
        const mapH = Math.round(MAP_H * scale);
        const cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        const g = cv.getContext("2d");
        g.fillStyle = "#16345c";
        g.fillRect(0, top, w, mapH);

        const jobs = [];
        for (let tx = 0; tx * span < MAP_W; tx++) {
            for (let tz = 0; tz * span < MAP_H; tz++) {
                jobs.push(
                    this.tileImage(BASE_ZOOM, tx, tz).then((img) => {
                        if (!img) return;
                        if (gen === this.generation) {
                            g.save();
                            g.beginPath();
                            g.rect(0, top, w, mapH);
                            g.clip();
                            g.drawImage(img, tx * TILE_PX, top + tz * TILE_PX, TILE_PX, TILE_PX);
                            g.restore();
                        }
                        img.close?.();
                    }),
                );
            }
        }
        await Promise.all(jobs);
        if (gen !== this.generation || this.disposed) return;

        // past the map's edges: the surface shader draws sea ice and ice sheet here
        g.fillStyle = "#d8e1e9";
        g.fillRect(0, 0, w, top);
        g.fillRect(0, top + mapH, w, h - top - mapH);

        const old = this.base.material.uniforms.map.value;
        this.base.material.uniforms.map.value = this.texture(cv);
        old.dispose();
        this.baseLoaded = true;
        this.baseLoading = false;
        this.container.classList.add("globe-loaded");
        this.updateTiles();
        this.dirty = true;
    }

    // ------------------------------------------------------------------ detail tiles

    tileSpan(zoom) {
        return TILE_PX * Math.pow(2, this.maxZoom() - zoom);
    }

    /**
     * Which tiles the view needs: rays through a grid of screen points, each asking for the tile zoom whose pixels
     * are about the size of a screen pixel there (so the horizon gets coarser tiles than the middle).
     */
    updateTiles() {
        if (!this.active || this.disposed || !this.baseLoaded) return;
        this.lastTileUpdate = performance.now();
        const max = this.maxZoom();
        const need = new Map();
        const step = 48;
        const hit = this._hit || (this._hit = new THREE.Vector3());
        const cam = this.camera.position;
        const cx = this.width / 2;
        const cy = this.height / 2;
        for (let sy = 0; sy <= this.height + step - 1; sy += step) {
            for (let sx = 0; sx <= this.width + step - 1; sx += step) {
                const px = Math.min(sx, this.width - 1);
                const py = Math.min(sy, this.height - 1);
                if (!this.pick(px, py, hit)) continue;
                // pixels per block across the surface here, allowing for how slanted it is to the view
                const dist = hit.distanceTo(cam);
                const slant = Math.max(0.35, Math.abs(hit.dot(this._ray)) / hit.length());
                const bpp = this.bppAt(dist) / Math.sqrt(slant) / this.dpr;
                const zoom = Math.min(max, Math.ceil(max - Math.log2(bpp) - 0.2));
                if (zoom <= BASE_ZOOM) continue;
                const w = vecToWorld(hit);
                if (w.z < 0 || w.z >= MAP_H) continue;
                const span = this.tileSpan(zoom);
                const tx = Math.floor(w.x / span);
                const tz = Math.floor(w.z / span);
                const key = `${zoom}/${tx}_${tz}`;
                const d2 = (px - cx) ** 2 + (py - cy) ** 2;
                const prev = need.get(key);
                if (!prev || d2 < prev.d2) need.set(key, { key, zoom, tx, tz, d2 });
            }
        }
        // a huge or very tilted view: settle for coarser tiles rather than hundreds of them
        let guard = 0;
        while (need.size > 40 && guard++ < 3) {
            const fewer = new Map();
            const top = Math.max(...[...need.values()].map((t) => t.zoom));
            for (const t of need.values()) {
                const c =
                    t.zoom === top && t.zoom > BASE_ZOOM + 1 ? { zoom: t.zoom - 1, tx: t.tx >> 1, tz: t.tz >> 1 } : t;
                const key = `${c.zoom}/${c.tx}_${c.tz}`;
                const prev = fewer.get(key);
                if (!prev || t.d2 < prev.d2) fewer.set(key, { key, zoom: c.zoom, tx: c.tx, tz: c.tz, d2: t.d2 });
            }
            need.clear();
            for (const [k, v] of fewer) need.set(k, v);
        }

        const tick = (this.tileTick = (this.tileTick || 0) + 1);
        const show = new Set();
        for (const t of need.values()) {
            let e = this.tiles.get(t.key);
            if (!e) {
                e = { ...t, state: "queued", mesh: null };
                this.tiles.set(t.key, e);
            }
            e.used = tick;
            e.d2 = t.d2;
            if (e.state === "ready") {
                show.add(e);
                continue;
            }
            // until it loads, the nearest loaded coarser tile stands in
            for (let z = t.zoom - 1, x = t.tx >> 1, y = t.tz >> 1; z > BASE_ZOOM; z--, x >>= 1, y >>= 1) {
                const up = this.tiles.get(`${z}/${x}_${y}`);
                if (up?.state === "ready") {
                    up.used = tick;
                    show.add(up);
                    break;
                }
            }
        }
        let changed = false;
        for (const e of this.tiles.values()) {
            if (!e.mesh) continue;
            const vis = show.has(e);
            if (e.mesh.visible !== vis) {
                e.mesh.visible = vis;
                changed = true;
            }
        }

        this.queue = [];
        for (const e of this.tiles.values()) if (e.state === "queued" && e.used === tick) this.queue.push(e);
        // middle of the screen first; a coarse tile before the sharp ones on top of it
        this.queue.sort((a, b) => a.d2 - b.d2 || a.zoom - b.zoom);
        this.pump();
        this.evict(tick);
        if (changed) {
            this._dirty = true;
            this.requestFrame();
        }
    }

    pump() {
        while (this.loading < 6 && this.queue.length) {
            const e = this.queue.shift();
            e.state = "loading";
            this.loading++;
            const gen = this.generation;
            this.tileImage(e.zoom, e.tx, e.tz)
                .then((img) => {
                    if (gen !== this.generation || this.disposed || this.tiles.get(e.key) !== e) {
                        img?.close?.();
                        return;
                    }
                    if (!img) {
                        e.state = "empty";
                        return;
                    }
                    const span = this.tileSpan(e.zoom);
                    const seg = Math.max(2, Math.min(96, Math.ceil(span / BPD / 0.45)));
                    const x0 = e.tx * span;
                    const z0 = e.tz * span;
                    const mat = this.surfaceMaterial(this.texture(img));
                    mat.depthTest = false;
                    mat.depthWrite = false;
                    mat.uniforms.uAlpha.value = 0;
                    e.mesh = new THREE.Mesh(patchGeometry(x0, z0, x0 + span, z0 + span, seg, seg, TILE_R), mat);
                    e.mesh.renderOrder = 1 + e.zoom;
                    e.mesh.frustumCulled = false;
                    e.mesh.visible = false;
                    e.born = performance.now();
                    this.tileGroup.add(e.mesh);
                    e.state = "ready";
                    this.fading++;
                })
                .catch(() => {
                    e.state = "empty";
                })
                .finally(() => {
                    this.loading--;
                    if (e.state === "loading") e.state = "queued";
                    if (gen === this.generation && !this.disposed) {
                        this.updateTiles();
                        this.dirty = true;
                    }
                });
        }
    }

    evict(tick) {
        const ready = [];
        for (const e of this.tiles.values()) if (e.mesh) ready.push(e);
        if (ready.length <= MAX_TILE_MESHES) return;
        ready.sort((a, b) => a.used - b.used);
        for (const e of ready.slice(0, ready.length - MAX_TILE_MESHES)) {
            if (e.used === tick) break;
            this.disposeTile(e);
            this.tiles.delete(e.key);
        }
    }

    disposeTile(e) {
        if (!e.mesh) return;
        this.tileGroup.remove(e.mesh);
        e.mesh.geometry.dispose();
        e.mesh.material.uniforms.map.value.dispose();
        e.mesh.material.dispose();
        e.mesh = null;
    }

    dropAllTiles() {
        for (const e of this.tiles.values()) this.disposeTile(e);
        this.tiles.clear();
        this.queue = [];
    }

    // ------------------------------------------------------------------ overlays

    syncOverlays(now) {
        if (!this.active || this.disposed) return;
        clearTimeout(this.syncTimer);
        if (now === true) this.doSync();
        else this.syncTimer = setTimeout(() => this.doSync(), 80);
    }

    doSync() {
        if (!this.active || this.disposed || !this.S?.map) return;
        this.checkRelief();
        const S = this.S;
        const playerMarkers = new Set();
        for (const p of S.playerList?.players?.values() ?? []) if (p.marker) playerMarkers.add(p.marker);

        const keepShapes = new Set();
        const keepIcons = new Set();
        let changed = false;
        S.map.eachLayer((layer) => {
            if (layer instanceof L.Marker) {
                if (playerMarkers.has(layer) || !layer.options.icon) return;
                const sig = this.iconSignature(layer);
                keepIcons.add(sig);
                const entry = this.icons.get(sig);
                if (entry) entry.layer = layer;
                else if (this.makeIcon(layer, sig)) changed = true;
            } else if (layer instanceof L.Path) {
                const sig = this.shapeSignature(layer);
                if (sig == null) return;
                keepShapes.add(sig);
                const entry = this.shapes.get(sig);
                if (entry) entry.layer = layer;
                else {
                    this.makeShape(layer, sig);
                    changed = true;
                }
            }
        });
        for (const [sig, s] of this.shapes) {
            if (keepShapes.has(sig)) continue;
            s.obj.traverse((o) => {
                o.geometry?.dispose();
                if (o.material) {
                    this.lineMaterials.delete(o.material);
                    o.material.dispose();
                }
            });
            s.obj.parent?.remove(s.obj);
            this.shapes.delete(sig);
            changed = true;
        }
        for (const [sig, i] of this.icons) {
            if (keepIcons.has(sig)) continue;
            i.el.remove();
            this.icons.delete(sig);
            changed = true;
        }
        this.syncPlayers();
        if (changed) this.dirty = true;
        else {
            this.domDirty = true;
            this.requestFrame();
        }
    }

    iconSignature(layer) {
        const ll = layer.getLatLng();
        const o = layer.options.icon.options || {};
        return `${ll.lat.toFixed(5)},${ll.lng.toFixed(5)}|${o.iconUrl || ""}|${o.html || ""}|${o.className || ""}`;
    }

    makeIcon(layer, sig) {
        let el;
        try {
            el = layer.options.icon.createIcon();
        } catch {
            return null;
        }
        el.classList.add("globe-icon");
        el.style.zIndex = "";
        el._after = " scale(var(--globe-icon-scale, 1))";
        // shrink round the icon's anchor point, which Leaflet placed with negative margins
        el.style.transformOrigin = `${-parseFloat(el.style.marginLeft) || 0}px ${-parseFloat(el.style.marginTop) || 0}px`;
        const p = this.S.toPoint(layer.getLatLng());
        const entry = { el, layer, vec: worldToVec(p.x, p.y, 1) };
        const tipAt = (e) => {
            const r = this.container.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        };
        el.addEventListener("mouseenter", (e) => {
            const tip = this.tooltipOf(entry.layer);
            if (tip) this.showTooltip(tip, tipAt(e));
        });
        el.addEventListener("mousemove", (e) => {
            if (!this.tooltip.hidden) {
                const p2 = tipAt(e);
                this.tooltip.style.transform = `translate(${Math.round(p2.x + 14)}px, ${Math.round(p2.y + 14)}px)`;
            }
        });
        el.addEventListener("mouseleave", () => this.hideTooltip());
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            this.closePopup();
            this.popupAt = entry.vec.clone();
            this.fire(entry.layer, vecToWorld(entry.vec), e);
        });
        this.iconLayer.appendChild(el);
        this.icons.set(sig, entry);
        return entry;
    }

    /** A shape's points in blocks: rings (polygons, with holes) or lines. */
    shapeData(layer) {
        const S = this.S;
        const toPts = (lls) => lls.map((ll) => S.toPoint(ll));
        if (layer instanceof L.CircleMarker) {
            if (!(layer instanceof L.Circle)) return null;
            const c = S.toPoint(layer.getLatLng());
            const r = S.metersToPixels(layer.getRadius());
            const ring = [];
            for (let i = 0; i < 64; i++)
                ring.push({
                    x: c.x + Math.cos((i / 64) * 2 * Math.PI) * r,
                    y: c.y + Math.sin((i / 64) * 2 * Math.PI) * r,
                });
            return { polys: [[ring]], lines: [] };
        }
        if (!layer.getLatLngs) return null;
        const lls = layer.getLatLngs();
        if (!lls?.length) return null;
        if (layer instanceof L.Polygon) {
            // LatLng[] | LatLng[][] (outer + holes) | LatLng[][][] (several polygons)
            const multi = L.LineUtil.isFlat(lls) ? [[lls]] : L.LineUtil.isFlat(lls[0]) ? [lls] : lls;
            return {
                polys: multi.map((poly) => poly.map(toPts).filter((r) => r.length >= 3)).filter((p) => p.length),
                lines: [],
            };
        }
        const lines = L.LineUtil.isFlat(lls) ? [lls] : lls;
        return { polys: [], lines: lines.map(toPts).filter((l) => l.length >= 2) };
    }

    /** Identifies a shape by its look and points, so the map re-adding the same claims every few seconds costs nothing. */
    shapeSignature(layer) {
        if (layer._globeSig !== undefined) return layer._globeSig;
        const data = this.shapeData(layer);
        let sig = null;
        if (data) {
            let minX = Infinity;
            let maxX = -Infinity;
            let h = 0;
            let n = 0;
            const eat = (pts) => {
                for (const p of pts) {
                    if (p.x < minX) minX = p.x;
                    if (p.x > maxX) maxX = p.x;
                    h = (Math.imul(h, 31) + Math.round(p.x)) | 0;
                    h = (Math.imul(h, 31) + Math.round(p.y)) | 0;
                    n++;
                }
            };
            for (const poly of data.polys) for (const ring of poly) eat(ring);
            for (const line of data.lines) eat(line);
            // the world border would only be a seam round the globe
            if (n > 0 && maxX - minX <= MAP_W * 0.8) {
                const o = layer.options;
                sig = `${o.color}|${o.fillColor}|${o.opacity}|${o.fillOpacity}|${o.weight}|${o.fill}|${o.stroke}|${n}|${h}`;
                layer._globeData = data;
            }
        }
        layer._globeSig = sig;
        return sig;
    }

    makeShape(layer, sig) {
        const data = layer._globeData || this.shapeData(layer);
        delete layer._globeData;
        if (!data) return;
        const o = layer.options;
        const group = new THREE.Group();
        const entry = { obj: group, layer, fill: null, area: Infinity };

        if (data.polys.length && o.fill !== false) {
            const pos = [];
            let area = 0;
            for (const poly of data.polys) {
                const outer = poly[0].map((p) => new THREE.Vector2(p.x, p.y));
                const holes = poly.slice(1).map((r) => r.map((p) => new THREE.Vector2(p.x, p.y)));
                area += Math.abs(THREE.ShapeUtils.area(outer));
                const all = outer.concat(...holes);
                for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(outer, holes))
                    this.pushTriangle(pos, all[a], all[b], all[c]);
            }
            if (pos.length) {
                const g = new THREE.BufferGeometry();
                g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
                g.computeBoundingSphere();
                const m = new THREE.MeshBasicMaterial({
                    color: new THREE.Color(o.fillColor || o.color || "#3388ff"),
                    transparent: true,
                    opacity: o.fillOpacity ?? 0.2,
                    depthTest: false,
                    depthWrite: false,
                    side: THREE.FrontSide,
                });
                const mesh = new THREE.Mesh(g, m);
                mesh.renderOrder = 20;
                mesh.userData.shape = entry;
                group.add(mesh);
                entry.fill = mesh;
                entry.area = area;
            }
        }
        if (o.stroke !== false && (o.weight ?? 3) > 0) {
            const seg = [];
            for (const poly of data.polys) for (const ring of poly) this.pushPath(seg, ring, true);
            for (const line of data.lines) this.pushPath(seg, line, false);
            if (seg.length) {
                const lines = this.makeLines(
                    seg,
                    o.color || "#3388ff",
                    o.opacity ?? 1,
                    Math.max(1, Math.min(3, (o.weight ?? 3) * 0.85)),
                );
                lines.renderOrder = 30;
                group.add(lines);
            }
        }
        if (!group.children.length) return;
        (entry.fill ? this.fillGroup : this.lineGroup).add(group);
        this.shapes.set(sig, entry);
    }

    /** Picks up colour changes made to the map's shapes after they were built (the town panel's diplomacy view). */
    restyleShapes() {
        if (!this.active || this.disposed) return;
        for (const s of this.shapes.values()) {
            const o = s.layer.options;
            s.obj.traverse((c) => {
                if (c === s.fill) {
                    c.material.color.set(o.fillColor || o.color || "#3388ff");
                    c.material.opacity = o.fillOpacity ?? 0.2;
                } else if (c.isLineSegments2) {
                    c.material.color.set(o.color || "#3388ff");
                    c.material.opacity = o.opacity ?? 1;
                }
            });
        }
        this.dirty = true;
        this.requestFrame();
    }

    /** A triangle on the sphere, split until its sides are short enough to hug the curve. */
    pushTriangle(out, a, b, c, depth = 0) {
        const long = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
        if (long > 0.4 * BPD && depth < 7) {
            const ab = a.clone().add(b).multiplyScalar(0.5);
            const bc = b.clone().add(c).multiplyScalar(0.5);
            const ca = c.clone().add(a).multiplyScalar(0.5);
            this.pushTriangle(out, a, ab, ca, depth + 1);
            this.pushTriangle(out, ab, b, bc, depth + 1);
            this.pushTriangle(out, ca, bc, c, depth + 1);
            this.pushTriangle(out, ab, bc, ca, depth + 1);
            return;
        }
        const A = worldToVec(a.x, a.y, FILL_R);
        const B = worldToVec(b.x, b.y, FILL_R);
        const C = worldToVec(c.x, c.y, FILL_R);
        const n = new THREE.Vector3().crossVectors(B.clone().sub(A), C.clone().sub(A));
        if (n.dot(A) < 0) out.push(A.x, A.y, A.z, C.x, C.y, C.z, B.x, B.y, B.z);
        else out.push(A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z);
    }

    /** Line segments along a path, split to at most a quarter of a degree so they don't dip under the surface. */
    pushPath(out, pts, closed) {
        const max = 0.25 * BPD;
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const n = closed ? pts.length : pts.length - 1;
        for (let i = 0; i < n; i++) {
            const p = pts[i];
            const q = pts[(i + 1) % pts.length];
            const steps = Math.max(1, Math.min(200, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / max)));
            worldToVec(p.x, p.y, LINE_R, a);
            for (let s = 1; s <= steps; s++) {
                const f = s / steps;
                worldToVec(p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f, LINE_R, b);
                out.push(a.x, a.y, a.z, b.x, b.y, b.z);
                a.copy(b);
            }
        }
    }

    playersShown() {
        const pl = this.S?.playerList;
        if (!pl) return false;
        for (const p of pl.players.values()) {
            if (!p.hidden && p.marker) return p.marker._map != null;
        }
        return true;
    }

    syncPlayers() {
        const S = this.S;
        const world = S?.worldList?.curWorld?.name;
        const seen = new Set();
        if (S?.playerList && this.playersShown()) {
            for (const p of S.playerList.players.values()) {
                if (p.hidden || p.world !== world) continue;
                seen.add(p.uuid);
                let e = this.players.get(p.uuid);
                if (!e) {
                    const el = document.createElement("div");
                    el.className = "globe-player";
                    el._after = " translate(-50%, -50%)";
                    const img = document.createElement("img");
                    img.alt = "";
                    img.src = p.getHeadUrl();
                    const name = document.createElement("span");
                    name.className = "n";
                    el.append(img, name);
                    e = { el, name, vec: new THREE.Vector3(), html: "" };
                    const entry = e;
                    el.addEventListener("click", (ev) => {
                        ev.stopPropagation();
                        this.flyTo(entry.vec.clone(), Math.min(this.alt, this.altForZoom(this.maxZoom() - 1)));
                    });
                    this.playerLayer.appendChild(el);
                    this.players.set(p.uuid, e);
                }
                if (e.html !== p.displayName) {
                    e.html = p.displayName;
                    e.name.innerHTML = p.displayName;
                }
                worldToVec(p.x, p.z, 1, e.vec);
            }
        }
        for (const [uuid, e] of this.players) {
            if (seen.has(uuid)) continue;
            e.el.remove();
            this.players.delete(uuid);
        }
    }

    /** Called by the map every second: players move. Only the HTML moves; the globe isn't redrawn. */
    updateMarkersScreenPos() {
        if (!this.active) return;
        this.syncPlayers();
        this.domDirty = true;
        this.requestFrame();
    }

    /** Puts the HTML markers where their spots are on screen, hiding the ones round the back. */
    placeDom() {
        const cam = this.camera.position;
        const camLen = cam.length();
        const horizon = 1 / camLen;
        const v = this._v || (this._v = new THREE.Vector3());
        const place = (el, vec, offsetY = 0) => {
            // a spot on a unit sphere faces the camera when p . c > 1
            const facing = vec.dot(cam) / camLen;
            if (facing <= horizon + 0.002) {
                if (!el.hidden) el.hidden = true;
                return false;
            }
            v.copy(vec).project(this.camera);
            const x = (v.x * 0.5 + 0.5) * this.width;
            const y = (-v.y * 0.5 + 0.5) * this.height + offsetY;
            if (v.z > 1 || x < -80 || y < -80 || x > this.width + 80 || y > this.height + 80) {
                if (!el.hidden) el.hidden = true;
                return false;
            }
            if (el.hidden) el.hidden = false;
            el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)${el._after || ""}`;
            el.style.opacity = String(Math.min(1, (facing - horizon) * 14));
            return true;
        };
        // icons shrink as you zoom out, like labels in Google Earth, so a continent of towns doesn't become a pile
        const bpp = this.bppAt(this.alt);
        const k = 1 - THREE.MathUtils.smoothstep(Math.log2(bpp), 3, 6) * 0.45;
        if (this.iconScale !== k) {
            this.iconScale = k;
            this.iconLayer.style.setProperty("--globe-icon-scale", k.toFixed(3));
        }
        for (const i of this.icons.values()) place(i.el, i.vec);
        this.playerLayer.classList.toggle("near", this.bppAt(this.alt) < 24);
        for (const p of this.players.values()) place(p.el, p.vec);
        if (this.popupAt && !this.popup.hidden) {
            const shown = place(this.popup, this.popupAt, -8);
            this.popup.hidden = false;
            this.popup.style.visibility = shown ? "" : "hidden";
        }
    }

    destroy() {
        this.disposed = true;
        this.active = false;
        if (this.raf) cancelAnimationFrame(this.raf);
        clearTimeout(this.syncTimer);
        this.resizeObserver?.disconnect();
        const map = this.S?.map;
        if (map) {
            map.off("layeradd layerremove", this.onLayers);
            map.off("moveend", this.onMove);
            map.off("popupopen", this.onPopup);
        }
        this.dropAllTiles();
        this.scene?.traverse((o) => {
            o.geometry?.dispose();
            o.material?.uniforms?.map?.value?.dispose?.();
            o.material?.dispose?.();
        });
        this.skyTarget?.dispose();
        this.renderer?.dispose();
        this.renderer?.forceContextLoss();
        this.canvas?.remove();
        this.overlay?.remove();
        this.controls?.remove();
        this.coords?.remove();
        this.hint?.remove();
    }
}
