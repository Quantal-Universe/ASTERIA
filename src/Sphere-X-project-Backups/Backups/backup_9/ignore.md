// ==UserScript==
// @name         LOTUS CHEATS
// @author       https://github.com/ho9
// @description  deadshot.io cheat (advertised by W cheats)
// @match        *://*deadshot.io/*
// @run-at       document-start
// @version      1.0
// @license      lotus 
// @grant        none
// @namespace https://greasyfork.org/users/1574706
// @downloadURL https://update.greasyfork.org/scripts/573015/LOTUS%20CHEATS.user.js
// @updateURL https://update.greasyfork.org/scripts/573015/LOTUS%20CHEATS.meta.js
// ==/UserScript==

(function() {
    'use strict';

    const PLAYER_FLAGS = ['color', 'normal', 'position', 'skinIndex', 'skinWeight', 'uv'];
    const ENEMY_FLAGS = ['normal', 'position', 'skinIndex', 'skinWeight', 'uv'];
    const WEAPON_FLAGS = ['position', 'normal', 'uv', 'color'];
    const WORLD_FLAGS = ['position', 'uv', 'color', 'uv2'];

    const cfg = {
        menuOpen: true,
        debugUnlocked: false,

        playerTargetId: 0,
        enemyTargetId: 0,
        weaponTargetId: 0,

        espEnabled: false,
        espType: 1,
        drawDistance: false,
        espColorVis: '#ff7300',
        espColorWall: '#c04dfe',
        espHeight: 2.3,
        espYOffset: 0.0,
        espWidth: 0.6,
        espThickness: 2,

        tracerLines: false,
        tracerColorVis: '#ff7300',
        tracerColorWall: '#c04dfe',

        enemyChamsEnabled: false,
        enemyChamsMode: 1,
        enemyChamsColorVis: '#ff7300',
        enemyChamsColorWall: '#ff2600',

        handChamsEnabled: false,
        handChamsMode: 0,
        handChamsColor: '#ff7300',

        weaponChamsEnabled: false,
        weaponChamsMode: 0,
        weaponChamsColor: '#1e00ff',

        worldManipulationEnabled: false,
        worldColor: '#6b6b6b',

        removeScopeOverlay: false,

        handsDepthThreshold: 1.5,
        vertexThreshold: 50,
        antiDupeDist: 0.5,

        aimEnabled: false,
        aimVisCheck: false,
        aimKey: 1,
        aimFov: 30,
        aimSmooth: 0,
        aimBone: 0,
        drawFov: false,

        triggerEnabled: false,
        triggerDelay: 60,

        debugSearch: '',
        debugSortBy: 0,
        debugShowOnlyActive: true,
        debugPrograms: {}
    };

    const SAVE_KEYS = [
        'espEnabled', 'espType', 'drawDistance', 'espColorVis', 'espColorWall',
        'tracerLines', 'tracerColorVis', 'tracerColorWall',
        'enemyChamsEnabled', 'enemyChamsMode', 'enemyChamsColorVis', 'enemyChamsColorWall',
        'handChamsEnabled', 'handChamsMode', 'handChamsColor',
        'weaponChamsEnabled', 'weaponChamsMode', 'weaponChamsColor',
        'worldManipulationEnabled', 'worldColor',
        'removeScopeOverlay',
        'aimEnabled', 'aimVisCheck', 'aimKey', 'aimFov', 'aimSmooth', 'aimBone', 'drawFov',
        'triggerEnabled', 'triggerDelay'
    ];

    const loadCfg = () => {
        try {
            const saved = localStorage.getItem('lotus_cfg');
            if (saved) {
                const parsed = JSON.parse(saved);
                for (const k of SAVE_KEYS) {
                    if (parsed[k] !== undefined) cfg[k] = parsed[k];
                }
                if (parsed.espColor !== undefined) cfg.espColorWall = parsed.espColor;
                if (parsed.tracerColor !== undefined) cfg.tracerColorWall = parsed.tracerColor;
                if (parsed.enemyChamsColor !== undefined) cfg.enemyChamsColorWall = parsed.enemyChamsColor;
            }
        } catch (e) {}
    };

    const saveCfg = () => {
        try {
            const toSave = {};
            for (const k of SAVE_KEYS) toSave[k] = cfg[k];
            localStorage.setItem('lotus_cfg', JSON.stringify(toSave));
        } catch (e) {}
    };

    loadCfg();

    const state = {
        programs: new Map(),
        stats: new Map(),
        programMeta: new Map(),
        progCount: 0,
        activeProg: null,
        uniforms: new WeakMap(),
        programOpacities: new Map(),
        matrices: {
            vpName: null,
            vpHeur1: null,
            vpHeur2: null,
            mName: null,
            mHeur: null,
            mvpName: null
        },
        renderQueue: [],
        debugRenderQueues: {},
        canvas2d: null,
        ctx: null,
        ui: null,
        bestTarget: null,
        lmb: false,
        rmb: false,
        rmbPressTime: 0,
        aimDx: 0,
        aimDy: 0,
        hadPointerLock: false,
        shaderSources: new Map(),
        programAttributes: new Map(),
        programUniforms: new Map(),
        programDrawCalls: new Map(),
        programMatrices: new Map(),
        glContext: null,
        selectedDebugPid: null,
        rebuildTabs: null,

        queries: new Map(),
        triggerActive: false,
        triggerTargetAcquiredTime: 0,
        lastShootTime: 0
    };

    const getDebugProgramConfig = (pid) => {
        if (!cfg.debugPrograms[pid]) {
            cfg.debugPrograms[pid] = {
                chams: false,
                chamsColor: '#000033',
                chamsMode: 4,
                esp: false,
                espColor: '#00FF00',
                espMatrix: 0,
                espMethod: 0,
                hidden: false,
                highlight: false
            };
        }
        return cfg.debugPrograms[pid];
    };

    const getFovPixels = () => cfg.aimFov / 90 * 500;

    const origGetOPD = Object.getOwnPropertyDescriptor;
    const mxDesc = origGetOPD(MouseEvent.prototype, 'movementX');
    const myDesc = origGetOPD(MouseEvent.prototype, 'movementY');

    const mxProxy = new Proxy(mxDesc.get, {
        apply(t, th, a) {
            if (cfg.menuOpen) return 0;
            let v = Reflect.apply(t, th, a);
            if (state.aimDx) {
                v += state.aimDx;
                state.aimDx = 0;
            }
            return v;
        }
    });

    const myProxy = new Proxy(myDesc.get, {
        apply(t, th, a) {
            if (cfg.menuOpen) return 0;
            let v = Reflect.apply(t, th, a);
            if (state.aimDy) {
                v += state.aimDy;
                state.aimDy = 0;
            }
            return v;
        }
    });

    Object.defineProperty(MouseEvent.prototype, 'movementX', {
        get: mxProxy,
        configurable: true,
        enumerable: true
    });
    Object.defineProperty(MouseEvent.prototype, 'movementY', {
        get: myProxy,
        configurable: true,
        enumerable: true
    });

    Object.getOwnPropertyDescriptor = new Proxy(origGetOPD, {
        apply(t, th, a) {
            if (a[0] === MouseEvent.prototype) {
                if (a[1] === 'movementX') return mxDesc;
                if (a[1] === 'movementY') return myDesc;
            }
            return Reflect.apply(t, th, a);
        }
    });

    const blockFullscreen = () => {
        const wrap = (proto, prop) => {
            if (proto && proto[prop]) proto[prop] = function() {
                return Promise.resolve();
            };
        };
        wrap(Element.prototype, 'requestFullscreen');
        wrap(Element.prototype, 'webkitRequestFullscreen');
        wrap(Element.prototype, 'mozRequestFullScreen');
        wrap(Element.prototype, 'msRequestFullscreen');
    };
    blockFullscreen();

    const originalPointerLock = Element.prototype.requestPointerLock;
    Element.prototype.requestPointerLock = function() {
        if (cfg.menuOpen) return Promise.resolve();
        return originalPointerLock.apply(this, arguments);
    };

    const toggleMenu = () => {
        cfg.menuOpen = !cfg.menuOpen;
        if (state.ui) state.ui.style.display = cfg.menuOpen ? 'flex' : 'none';
        const canvas = document.querySelector('canvas');

        if (cfg.menuOpen) {
            state.hadPointerLock = !!document.pointerLockElement;
            if (document.pointerLockElement) document.exitPointerLock();
            if (canvas) canvas.style.pointerEvents = 'none';
            state.lmb = false;
            state.rmb = false;
        } else {
            if (canvas) {
                canvas.style.pointerEvents = 'auto';
                canvas.focus();
                if (state.hadPointerLock) {
                    try {
                        canvas.requestPointerLock();
                    } catch (e) {}
                }
            }
            window.focus();
        }
    };

    Object.defineProperty(Document.prototype, 'visibilityState', {
        get: () => 'visible'
    });
    Object.defineProperty(Document.prototype, 'hidden', {
        get: () => false
    });
    Object.defineProperty(Document.prototype, 'hasFocus', {
        get: () => () => true
    });

    const showSecretGif = () => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483647; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.85); pointer-events: none; opacity: 0; transition: opacity 0.5s;';

        const text = document.createElement('div');
        text.textContent = 'debug mode enabled';
        text.style.cssText = 'color: #DB87D4; font-family: monospace; font-size: 24px; margin-bottom: 20px;';
        wrap.appendChild(text);

        const img = document.createElement('img');
        img.src = 'https://i.ibb.co/1tMtXvSy/0401.gif';
        img.style.cssText = 'max-width: 80%; max-height: 80%;';
        wrap.appendChild(img);

        document.body.appendChild(wrap);

        requestAnimationFrame(() => {
            wrap.style.opacity = '1';
        });
        setTimeout(() => {
            wrap.style.opacity = '0';
            setTimeout(() => wrap.remove(), 500);
        }, 3500);
    };

    const keyState = {
        ShiftLeft: false,
        ShiftRight: false
    };

    const blockPauseEvents = ['pointerlockchange', 'mozpointerlockchange', 'webkitpointerlockchange', 'blur', 'visibilitychange', 'mouseleave'];
    const blockPauseLogic = (e) => {
        if (cfg.menuOpen) {
            e.stopImmediatePropagation();
            e.stopPropagation();
        }
    };
    blockPauseEvents.forEach(evt => {
        document.addEventListener(evt, blockPauseLogic, true);
        window.addEventListener(evt, blockPauseLogic, true);
    });

    const allInputEvents = ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'wheel', 'contextmenu', 'pointerdown', 'pointerup', 'pointermove'];
    allInputEvents.forEach(evt => {
        window.addEventListener(evt, e => {
            if (!cfg.menuOpen) return;
            if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'Insert') return;
            const isUI = state.ui && e.composedPath().includes(state.ui);
            if (isUI) return;
            e.stopImmediatePropagation();
            e.stopPropagation();
            if (evt !== 'mouseup' && evt !== 'mousemove') e.preventDefault();
        }, true);
    });

    window.addEventListener('keydown', e => {
        if (e.code === 'ShiftLeft') keyState.ShiftLeft = true;
        if (e.code === 'ShiftRight') keyState.ShiftRight = true;

        if (e.code === 'ShiftRight' || e.code === 'Insert') {
            if (keyState.ShiftLeft && keyState.ShiftRight && !cfg.debugUnlocked) {
                cfg.debugUnlocked = true;
                showSecretGif();
                if (state.rebuildTabs) state.rebuildTabs();
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }
            e.preventDefault();
            e.stopImmediatePropagation();
            toggleMenu();
        }
    }, true);

    window.addEventListener('keyup', e => {
        if (e.code === 'ShiftLeft') keyState.ShiftLeft = false;
        if (e.code === 'ShiftRight') keyState.ShiftRight = false;
    }, true);

    window.addEventListener('mousedown', e => {
        if (cfg.menuOpen) return;
        if (e.button === 0) state.lmb = true;
        if (e.button === 2) {
            if (!state.rmb) state.rmbPressTime = Date.now();
            state.rmb = true;
        }
    });

    window.addEventListener('mouseup', e => {
        if (cfg.menuOpen) return;
        if (e.button === 0) state.lmb = false;
        if (e.button === 2) {
            state.rmb = false;
            state.rmbPressTime = 0;
        }
    });

    const WGL = WebGL2RenderingContext.prototype;
    const WGL1 = WebGLRenderingContext.prototype;
    const proxyCache = new WeakMap();

    const glTypeNames = {
        0x1400: 'BYTE', 0x1401: 'UNSIGNED_BYTE', 0x1402: 'SHORT', 0x1403: 'UNSIGNED_SHORT',
        0x1404: 'INT', 0x1405: 'UNSIGNED_INT', 0x1406: 'FLOAT',
        0x8B50: 'FLOAT_VEC2', 0x8B51: 'FLOAT_VEC3', 0x8B52: 'FLOAT_VEC4',
        0x8B53: 'INT_VEC2', 0x8B54: 'INT_VEC3', 0x8B55: 'INT_VEC4',
        0x8B56: 'BOOL', 0x8B57: 'BOOL_VEC2', 0x8B58: 'BOOL_VEC3', 0x8B59: 'BOOL_VEC4',
        0x8B5A: 'FLOAT_MAT2', 0x8B5B: 'FLOAT_MAT3', 0x8B5C: 'FLOAT_MAT4',
        0x8B5E: 'SAMPLER_2D', 0x8B60: 'SAMPLER_CUBE'
    };

    const glDrawModes = {
        0: 'POINTS', 1: 'LINES', 2: 'LINE_LOOP', 3: 'LINE_STRIP',
        4: 'TRIANGLES', 5: 'TRIANGLE_STRIP', 6: 'TRIANGLE_FAN'
    };

    const hookContext = () => {
        const origGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function() {
            if (arguments[1]) arguments[1].preserveDrawingBuffer = false;
            const ctx = origGetContext.apply(this, arguments);
            if (!ctx || (arguments[0] !== 'webgl' && arguments[0] !== 'webgl2')) return ctx;
            if (proxyCache.has(ctx)) return proxyCache.get(ctx);
            state.glContext = ctx;
            const proxy = new Proxy(ctx, wglHandler);
            proxyCache.set(ctx, proxy);
            if (cfg.menuOpen && ctx.canvas) ctx.canvas.style.pointerEvents = 'none';
            return proxy;
        };
    };

    const shaderSources = new WeakMap();

    const proxySource = {
        apply(t, th, a) {
            shaderSources.set(a[0], a[1]);
            return Reflect.apply(t, th, a);
        }
    };
    WGL.shaderSource = new Proxy(WGL.shaderSource, proxySource);
    WGL1.shaderSource = new Proxy(WGL1.shaderSource, proxySource);

    const recordVariable = (prog, name) => {
        if (!name) return;
        const cleanName = name.split('[')[0];
        const pid = state.programs.get(prog);
        if (pid) {
            if (!state.programMeta.has(pid)) state.programMeta.set(pid, { vars: new Set() });
            state.programMeta.get(pid).vars.add(cleanName);
        }
    };

    const wglHandler = {
        get(target, prop) {
            const val = target[prop];
            if (typeof val !== 'function') return val;

            if (prop === 'linkProgram') {
                return function(p) {
                    const result = val.apply(target, arguments);
                    const shaders = target.getAttachedShaders(p);
                    if (shaders) {
                        const pid = state.programs.get(p);
                        if (pid) {
                            const sources = { vertex: null, fragment: null };
                            for (const sh of shaders) {
                                const type = target.getShaderParameter(sh, target.SHADER_TYPE);
                                const src = shaderSources.get(sh) || target.getShaderSource(sh);
                                if (type === target.VERTEX_SHADER) sources.vertex = src;
                                else if (type === target.FRAGMENT_SHADER) sources.fragment = src;
                            }
                            state.shaderSources.set(pid, sources);
                        }
                    }
                    return result;
                };
            }

            if (prop === 'useProgram') {
                return function(p) {
                    state.activeProg = p;
                    if (p && !state.programs.has(p)) {
                        state.progCount++;
                        state.programs.set(p, state.progCount);
                        state.stats.set(state.progCount, {
                            draws: 0, totalVerts: 0, lastVerts: 0, frameVerts: 0
                        });
                        state.programMeta.set(state.progCount, { vars: new Set() });
                        state.programAttributes.set(state.progCount, new Map());
                        state.programUniforms.set(state.progCount, new Map());
                        state.programDrawCalls.set(state.progCount, {
                            mode: -1, count: 0, totalVerts: 0, calls: 0
                        });
                        state.programMatrices.set(state.progCount, { vp: null, m: null, mvp: null });

                        setTimeout(() => {
                            try {
                                const pid = state.programs.get(p);
                                const numAttribs = target.getProgramParameter(p, target.ACTIVE_ATTRIBUTES);
                                const attribMap = state.programAttributes.get(pid);
                                for (let i = 0; i < numAttribs; i++) {
                                    const info = target.getActiveAttrib(p, i);
                                    if (info) {
                                        const loc = target.getAttribLocation(p, info.name);
                                        attribMap.set(info.name, {
                                            location: loc, size: info.size, type: info.type,
                                            typeName: glTypeNames[info.type] || info.type
                                        });
                                    }
                                }

                                const numUniforms = target.getProgramParameter(p, target.ACTIVE_UNIFORMS);
                                const uniformMap = state.programUniforms.get(pid);
                                for (let i = 0; i < numUniforms; i++) {
                                    const info = target.getActiveUniform(p, i);
                                    if (info) {
                                        const loc = target.getUniformLocation(p, info.name);
                                        uniformMap.set(info.name, {
                                            location: loc, size: info.size, type: info.type,
                                            typeName: glTypeNames[info.type] || info.type
                                        });
                                    }
                                }
                            } catch (e) {}
                        }, 0);
                    }
                    return val.apply(target, arguments);
                };
            }

            if (prop === 'getAttribLocation') {
                return function(p, name) {
                    const loc = val.apply(target, arguments);
                    if (loc !== -1) recordVariable(p, name);
                    return loc;
                };
            }

            if (prop === 'getUniformLocation') {
                return function(p, name) {
                    const loc = val.apply(target, arguments);
                    if (loc) {
                        recordVariable(p, name);
                        const n = name.toLowerCase();
                        if (n.includes('viewprojection') || n === 'u_viewprojection') state.uniforms.set(loc, 'vpName');
                        else if (n.includes('modelviewprojection') || n.includes('worldprojection')) state.uniforms.set(loc, 'mvpName');
                        else if (n.includes('model') && !n.includes('view')) state.uniforms.set(loc, 'mName');
                        else if (n.includes('opacity') || n.includes('alpha') || n === 'u_a') {
                            state.uniforms.set(loc, 'opacity_var');
                        }
                        else if (n.includes('color') || n.includes('diffuse') || n.includes('tint')) {
                            state.uniforms.set(loc, 'color_alpha_var');
                        }
                    }
                    return loc;
                };
            }

            if (prop === 'uniform1f') {
                return function(loc, x) {
                    if (loc && state.uniforms.get(loc) === 'opacity_var') {
                        const pid = state.activeProg ? state.programs.get(state.activeProg) : null;
                        if (pid) state.programOpacities.set(pid, x);
                    }
                    return val.apply(target, arguments);
                };
            }
            if (prop === 'uniform1fv') {
                return function(loc, data) {
                    if (loc && data && data.length > 0 && state.uniforms.get(loc) === 'opacity_var') {
                        const pid = state.activeProg ? state.programs.get(state.activeProg) : null;
                        if (pid) state.programOpacities.set(pid, data[0]);
                    }
                    return val.apply(target, arguments);
                };
            }
            if (prop === 'uniform4f') {
                return function(loc, x, y, z, w) {
                    if (loc && state.uniforms.get(loc) === 'color_alpha_var') {
                        const pid = state.activeProg ? state.programs.get(state.activeProg) : null;
                        if (pid) state.programOpacities.set(pid, w);
                    }
                    return val.apply(target, arguments);
                };
            }
            if (prop === 'uniform4fv') {
                return function(loc, data) {
                    if (loc && data && data.length >= 4 && state.uniforms.get(loc) === 'color_alpha_var') {
                        const pid = state.activeProg ? state.programs.get(state.activeProg) : null;
                        if (pid) state.programOpacities.set(pid, data[3]);
                    }
                    return val.apply(target, arguments);
                };
            }

            if (prop === 'getActiveUniform' || prop === 'getActiveAttrib') {
                return function(p, index) {
                    const info = val.apply(target, arguments);
                    if (info && info.name) recordVariable(p, info.name);
                    return info;
                };
            }

            if (prop === 'uniformMatrix4fv') {
                return function(loc, trans, data) {
                    if (data && data.length === 16) {
                        const type = state.uniforms.get(loc);
                        if (type) state.matrices[type] = new Float32Array(data);
                        if (Math.abs(data[15]) < 0.1 && (Math.abs(data[14]) > 0.1 || Math.abs(data[11]) > 0.1)) state.matrices.vpHeur1 = new Float32Array(data);
                        if (Math.abs(data[11] + 1) < 0.1 && Math.abs(data[15]) < 0.1) state.matrices.vpHeur2 = new Float32Array(data);
                        state.matrices.mHeur = new Float32Array(data);

                        const pid = state.activeProg ? state.programs.get(state.activeProg) : null;
                        if (pid) {
                            const pm = state.programMatrices.get(pid);
                            if (pm) {
                                if (type === 'mvpName') pm.mvp = new Float32Array(data);
                                else if (type === 'vpName') pm.vp = new Float32Array(data);
                                else if (type === 'mName') pm.m = new Float32Array(data);
                                pm.lastMat = new Float32Array(data);
                                if (Math.abs(data[15]) < 0.1 && (Math.abs(data[14]) > 0.1 || Math.abs(data[11]) > 0.1)) pm.heur1 = new Float32Array(data);
                                if (Math.abs(data[11] + 1) < 0.1 && Math.abs(data[15]) < 0.1) pm.heur2 = new Float32Array(data);
                            }
                        }
                    }
                    return val.apply(target, arguments);
                };
            }

            if (prop === 'drawElements' || prop === 'drawArrays') {
                return function() {
                    const gl = target;
                    const pid = state.activeProg ? state.programs.get(state.activeProg) : null;
                    const verts = arguments[1] || 0;
                    const drawMode = arguments[0];

                    if (pid) {
                        const s = state.stats.get(pid);
                        if (s) {
                            s.draws++;
                            s.totalVerts += verts;
                            s.lastVerts = verts;
                            s.frameVerts = (s.frameVerts || 0) + verts;
                        }

                        const dc = state.programDrawCalls.get(pid);
                        if (dc) {
                            dc.mode = drawMode;
                            dc.count = verts;
                            dc.totalVerts += verts;
                            dc.calls++;
                        }

                        if (cfg.removeScopeOverlay) {
                            const attrs = state.programAttributes.get(pid);
                            const unis = state.programUniforms.get(pid);
                            const meta = state.programMeta.get(pid);
                            let isScope = false;

                            if (meta && meta.vars.size === 1 && meta.vars.has('position')) {
                                isScope = true;
                            } else if (attrs && attrs.size === 1 && attrs.has('position') && (!unis || unis.size === 0)) {
                                isScope = true;
                            }

                            if (!isScope && attrs && attrs.size === 2 && attrs.has('position') && attrs.has('uv')) {
                                if (unis) {
                                    for (const u of unis.keys()) {
                                        if (u.toLowerCase().includes('scopetex')) {
                                            isScope = true;
                                            break;
                                        }
                                    }
                                }
                            }

                            if (isScope) return;
                        }
                    }

                    const drawChamsHelper = (mode, colorHex) => {
                        let origMode = arguments[0];
                        let wDepth = gl.isEnabled(gl.DEPTH_TEST);
                        let wBlend = gl.isEnabled(gl.BLEND);
                        let wCull = gl.isEnabled(gl.CULL_FACE);

                        let isXray = mode < 4;

                        if (mode === 1) arguments[0] = gl.LINES;

                        if (isXray) {
                            gl.disable(gl.CULL_FACE);
                            if (!wDepth) gl.enable(gl.DEPTH_TEST);
                            gl.depthFunc(gl.ALWAYS);
                        }

                        let r = parseInt(colorHex.slice(1, 3), 16) / 255;
                        let g = parseInt(colorHex.slice(3, 5), 16) / 255;
                        let b = parseInt(colorHex.slice(5, 7), 16) / 255;
                        gl.blendColor(r, g, b, 1.0);

                        if (!gl.isEnabled(gl.BLEND)) gl.enable(gl.BLEND);

                        if (mode === 2) {
                            gl.blendEquation(gl.FUNC_ADD);
                            gl.blendFunc(gl.CONSTANT_COLOR, gl.ZERO);
                        } else if (mode === 3) {
                            gl.blendEquation(gl.FUNC_ADD);
                            gl.blendFunc(gl.ZERO, gl.CONSTANT_COLOR);
                        } else if (mode === 4) {
                            gl.blendEquation(gl.FUNC_ADD);
                            gl.blendFunc(gl.CONSTANT_COLOR, gl.ZERO);
                        } else {
                            gl.blendEquation(gl.FUNC_ADD);
                            gl.blendFuncSeparate(gl.CONSTANT_COLOR, gl.ONE, gl.SRC_ALPHA, gl.ONE);
                        }

                        let res;
                        try {
                            let passes = (mode === 2 || mode === 3 || mode === 4) ? 1 : 5;
                            for (let p = 0; p < passes; p++) res = val.apply(target, arguments);
                        } catch (e) {}

                        arguments[0] = origMode;

                        gl.blendEquation(gl.FUNC_ADD);
                        if (isXray) {
                            gl.cullFace(gl.BACK);
                            if (wCull && !gl.isEnabled(gl.CULL_FACE)) gl.enable(gl.CULL_FACE);
                            if (!wCull && gl.isEnabled(gl.CULL_FACE)) gl.disable(gl.CULL_FACE);
                            gl.depthFunc(gl.LEQUAL);
                        }

                        if (wDepth && !gl.isEnabled(gl.DEPTH_TEST)) gl.enable(gl.DEPTH_TEST);
                        if (!wDepth && gl.isEnabled(gl.DEPTH_TEST)) gl.disable(gl.DEPTH_TEST);
                        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                        if (!wBlend) gl.disable(gl.BLEND);
                        if (wBlend) gl.enable(gl.BLEND);

                        return res;
                    };

                    if (cfg.debugUnlocked && pid && pid !== cfg.playerTargetId && pid !== cfg.enemyTargetId && pid !== cfg.weaponTargetId) {
                        const meta = state.programMeta.get(pid);
                        const isWorld = meta ? WORLD_FLAGS.every(f => meta.vars.has(f)) : false;

                        if (!isWorld || !cfg.worldManipulationEnabled) {
                            const debugCfg = getDebugProgramConfig(pid);

                            if (debugCfg.hidden) return;

                            if (debugCfg.esp) {
                                const pm = state.programMatrices.get(pid);
                                let vpMatrix = null;
                                let worldX = 0, worldY = 0, worldZ = 0;

                                switch (debugCfg.espMatrix) {
                                    case 0:
                                        vpMatrix = pm?.mvp || state.matrices.mvpName; break;
                                    case 1:
                                        vpMatrix = pm?.heur1 || pm?.vp || state.matrices.vpHeur1;
                                        if (pm?.m) { worldX = pm.m[12]; worldY = pm.m[13]; worldZ = pm.m[14]; }
                                        else if (pm?.lastMat) { worldX = pm.lastMat[12]; worldY = pm.lastMat[13]; worldZ = pm.lastMat[14]; }
                                        else if (state.matrices.mHeur) { worldX = state.matrices.mHeur[12]; worldY = state.matrices.mHeur[13]; worldZ = state.matrices.mHeur[14]; }
                                        break;
                                    case 2:
                                        vpMatrix = pm?.heur2 || pm?.vp || state.matrices.vpHeur2;
                                        if (pm?.m) { worldX = pm.m[12]; worldY = pm.m[13]; worldZ = pm.m[14]; }
                                        else if (pm?.lastMat) { worldX = pm.lastMat[12]; worldY = pm.lastMat[13]; worldZ = pm.lastMat[14]; }
                                        else if (state.matrices.mHeur) { worldX = state.matrices.mHeur[12]; worldY = state.matrices.mHeur[13]; worldZ = state.matrices.mHeur[14]; }
                                        break;
                                    case 3:
                                        vpMatrix = pm?.vp || state.matrices.vpName;
                                        if (pm?.m) { worldX = pm.m[12]; worldY = pm.m[13]; worldZ = pm.m[14]; }
                                        else if (pm?.lastMat) { worldX = pm.lastMat[12]; worldY = pm.lastMat[13]; worldZ = pm.lastMat[14]; }
                                        else if (state.matrices.mHeur) { worldX = state.matrices.mHeur[12]; worldY = state.matrices.mHeur[13]; worldZ = state.matrices.mHeur[14]; }
                                        break;
                                    case 4:
                                        vpMatrix = pm?.lastMat || pm?.vp || state.matrices.mHeur; break;
                                }

                                if (vpMatrix) {
                                    if (!state.debugRenderQueues[pid]) state.debugRenderQueues[pid] = [];
                                    state.debugRenderQueues[pid].push({
                                        vp: new Float32Array(vpMatrix),
                                        wx: worldX, wy: worldY, wz: worldZ,
                                        color: debugCfg.espColor, method: debugCfg.espMethod
                                    });
                                }
                            }

                            if (debugCfg.chams) {
                                return drawChamsHelper(debugCfg.chamsMode, debugCfg.chamsColor);
                            }

                            if (debugCfg.highlight) {
                                val.apply(target, arguments);
                                let origMode = arguments[0];
                                arguments[0] = gl.LINE_STRIP;
                                let r = parseInt(debugCfg.chamsColor.slice(1, 3), 16) / 255;
                                let g = parseInt(debugCfg.chamsColor.slice(3, 5), 16) / 255;
                                let b = parseInt(debugCfg.chamsColor.slice(5, 7), 16) / 255;
                                gl.blendColor(r, g, b, 1.0);
                                gl.enable(gl.BLEND);
                                gl.blendFunc(gl.CONSTANT_COLOR, gl.ZERO);
                                val.apply(target, arguments);
                                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                                arguments[0] = origMode;
                                return;
                            }
                        }
                    }

                    if (pid === cfg.enemyTargetId && verts > cfg.vertexThreshold) {
                        let isDead = false;

                        const isBlending = gl.isEnabled(gl.BLEND);

                        if (isBlending && state.programOpacities.has(pid)) {
                            if (state.programOpacities.get(pid) <= 0.1) {
                                isDead = true;
                            }
                        }

                        if (!isDead) {
                            const pm = state.programMatrices.get(pid);
                            let vp = pm?.heur1 || pm?.vp || state.matrices.vpHeur1;
                            let m = pm?.m || pm?.lastMat || state.matrices.mHeur;
                            let isVisible = true;

                            const needsVisCheck = cfg.triggerEnabled || cfg.aimVisCheck || cfg.espEnabled || cfg.tracerLines || cfg.enemyChamsEnabled || cfg.aimEnabled;

                            if (needsVisCheck && gl instanceof WebGL2RenderingContext && m) {
                                let wx = m[12], wy = m[13], wz = m[14];
                                let now = Date.now();

                                let isBehindCamera = false;
                                if (vp) {
                                    let wCoord = wx * vp[3] + wy * vp[7] + wz * vp[11] + vp[15];
                                    if (wCoord < 0.1) isBehindCamera = true;
                                }

                                let bestId = null;
                                let bestDist = Infinity;
                                for (const [id, q] of state.queries.entries()) {
                                    let dx = q.x - wx, dy = q.y - wy, dz = q.z - wz;
                                    let dist = dx*dx + dy*dy + dz*dz;
                                    if (dist < 25.0 && dist < bestDist) {
                                        bestDist = dist;
                                        bestId = id;
                                    }
                                }

                                let qObj;
                                if (bestId) {
                                    qObj = state.queries.get(bestId);
                                    qObj.x = wx; qObj.y = wy; qObj.z = wz;
                                } else {
                                    let newId = Math.random().toString(36).substring(2);
                                    qObj = {
                                        q: gl.createQuery(), x: wx, y: wy, z: wz,
                                        pending: false, rawVis: false, confirmedVis: false,
                                        stateChangeTime: now, lastSeen: now
                                    };
                                    state.queries.set(newId, qObj);
                                }
                                qObj.lastSeen = now;

                                if (isBehindCamera) {
                                    qObj.rawVis = false;
                                    qObj.confirmedVis = false;
                                    isVisible = false;
                                } else {
                                    if (!qObj.pending) {
                                        gl.colorMask(false, false, false, false);
                                        gl.depthMask(false);

                                        gl.beginQuery(gl.ANY_SAMPLES_PASSED, qObj.q);
                                        val.apply(target, arguments);
                                        gl.endQuery(gl.ANY_SAMPLES_PASSED);

                                        gl.colorMask(true, true, true, true);
                                        gl.depthMask(true);
                                        qObj.pending = true;
                                    } else {
                                        let available = gl.getQueryParameter(qObj.q, gl.QUERY_RESULT_AVAILABLE);
                                        if (available) {
                                            let currentRawVis = gl.getQueryParameter(qObj.q, gl.QUERY_RESULT) > 0;

                                            if (currentRawVis !== qObj.rawVis) {
                                                qObj.rawVis = currentRawVis;
                                                qObj.stateChangeTime = now;
                                            }

                                            if (qObj.rawVis === false) {
                                                qObj.confirmedVis = false;
                                            } else {
                                                if (now - qObj.stateChangeTime >= 10) {
                                                    qObj.confirmedVis = true;
                                                }
                                            }

                                            qObj.pending = false;
                                        }
                                    }
                                    isVisible = qObj.confirmedVis;
                                }
                            }

                            if (cfg.espEnabled || cfg.aimEnabled || cfg.tracerLines || cfg.triggerEnabled) {
                                if (vp && m) state.renderQueue.push({
                                    vp: new Float32Array(vp),
                                    wx: m[12], wy: m[13], wz: m[14],
                                    visible: isVisible
                                });
                            }

                            if (cfg.enemyChamsEnabled) {
                                if (cfg.enemyChamsMode === 5) return;
                                let drawColor = isVisible ? cfg.enemyChamsColorVis : cfg.enemyChamsColorWall;
                                return drawChamsHelper(cfg.enemyChamsMode, drawColor);
                            }
                        }

                        return val.apply(target, arguments);
                    }

                    if (pid === cfg.playerTargetId && verts > cfg.vertexThreshold) {
                        let vp = state.matrices.mvpName;
                        let m = state.matrices.mHeur;
                        let isHand = false;

                        if (vp) {
                            let depthW = vp[15];
                            if (m) depthW = m[12] * vp[3] + m[13] * vp[7] + m[14] * vp[11] + vp[15];
                            if (Math.abs(depthW) < cfg.handsDepthThreshold) isHand = true;
                        }

                        if (!isHand) {
                            if (cfg.enemyChamsEnabled) return;
                            return val.apply(target, arguments);
                        } else {
                            if (cfg.handChamsEnabled) {
                                if (cfg.handChamsMode === 5) return;
                                return drawChamsHelper(cfg.handChamsMode, cfg.handChamsColor);
                            }
                            return val.apply(target, arguments);
                        }
                    }

                    if (pid === cfg.weaponTargetId && verts > cfg.vertexThreshold) {
                        if (cfg.weaponChamsEnabled) {
                            if (cfg.weaponChamsMode === 5) return;
                            return drawChamsHelper(cfg.weaponChamsMode, cfg.weaponChamsColor);
                        }
                        return val.apply(target, arguments);
                    }

                    if (cfg.worldManipulationEnabled && pid && pid !== cfg.playerTargetId && pid !== cfg.enemyTargetId && pid !== cfg.weaponTargetId) {
                        const meta = state.programMeta.get(pid);
                        if (meta && WORLD_FLAGS.every(f => meta.vars.has(f))) {
                            return drawChamsHelper(4, cfg.worldColor);
                        }
                    }

                    return val.apply(target, arguments);
                };
            }
            return val.bind ? val.bind(target) : val;
        }
    };

    const project3D = (m, x, y, z, w, h) => {
        const X = x * m[0] + y * m[4] + z * m[8] + m[12];
        const Y = x * m[1] + y * m[5] + z * m[9] + m[13];
        const W = x * m[3] + y * m[7] + z * m[11] + m[15];
        if (W < 0.1) return null;
        return {
            x: (X / W + 1) * w * 0.5,
            y: (-Y / W + 1) * h * 0.5,
            w: W,
            X_clip: X,
            Y_clip: Y
        };
    };

    const initCanvas = () => {
        if (!state.canvas2d) {
            state.canvas2d = document.createElement('canvas');
            state.canvas2d.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:999998;pointer-events:none;";
            document.documentElement.appendChild(state.canvas2d);
            state.ctx = state.canvas2d.getContext('2d');
            const r = () => {
                state.canvas2d.width = window.innerWidth;
                state.canvas2d.height = window.innerHeight;
            };
            window.addEventListener('resize', r);
            r();
        }
    };

    const drawCornerBox = (ctx, x, y, w, h, color, thickness) => {
        const cornerLength = Math.min(w, h) * 0.25;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = thickness + 2;
        ctx.lineCap = 'square';
        ctx.beginPath();
        ctx.moveTo(x, y + cornerLength);
        ctx.lineTo(x, y);
        ctx.lineTo(x + cornerLength, y);
        ctx.moveTo(x + w - cornerLength, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w, y + cornerLength);
        ctx.moveTo(x + w, y + h - cornerLength);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x + w - cornerLength, y + h);
        ctx.moveTo(x + cornerLength, y + h);
        ctx.lineTo(x, y + h);
        ctx.lineTo(x, y + h - cornerLength);
        ctx.stroke();
        ctx.strokeStyle = color;
        ctx.lineWidth = thickness;
        ctx.beginPath();
        ctx.moveTo(x, y + cornerLength);
        ctx.lineTo(x, y);
        ctx.lineTo(x + cornerLength, y);
        ctx.moveTo(x + w - cornerLength, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w, y + cornerLength);
        ctx.moveTo(x + w, y + h - cornerLength);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x + w - cornerLength, y + h);
        ctx.moveTo(x + cornerLength, y + h);
        ctx.lineTo(x, y + h);
        ctx.lineTo(x, y + h - cornerLength);
        ctx.stroke();
    };

    const drawNormalBox = (ctx, x, y, w, h, color, thickness) => {
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = thickness + 2;
        ctx.strokeRect(x, y, w, h);
        ctx.strokeStyle = color;
        ctx.lineWidth = thickness;
        ctx.strokeRect(x, y, w, h);
    };

    const drawCircle = (ctx, x, y, r, color, thickness) => {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = thickness + 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = thickness;
        ctx.stroke();
    };

    const drawDiamond = (ctx, x, y, w, h, color, thickness) => {
        const cx = x + w / 2;
        const cy = y + h / 2;
        ctx.beginPath();
        ctx.moveTo(cx, y);
        ctx.lineTo(x + w, cy);
        ctx.lineTo(cx, y + h);
        ctx.lineTo(x, cy);
        ctx.closePath();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = thickness + 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, y);
        ctx.lineTo(x + w, cy);
        ctx.lineTo(cx, y + h);
        ctx.lineTo(x, cy);
        ctx.closePath();
        ctx.strokeStyle = color;
        ctx.lineWidth = thickness;
        ctx.stroke();
    };

    const drawCross = (ctx, x, y, w, h, color, thickness) => {
        const cx = x + w / 2;
        const cy = y + h / 2;
        ctx.beginPath();
        ctx.moveTo(cx, y);
        ctx.lineTo(cx, y + h);
        ctx.moveTo(x, cy);
        ctx.lineTo(x + w, cy);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = thickness + 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, y);
        ctx.lineTo(cx, y + h);
        ctx.moveTo(x, cy);
        ctx.lineTo(x + w, cy);
        ctx.strokeStyle = color;
        ctx.lineWidth = thickness;
        ctx.stroke();
    };

    const drawTracerLine = (ctx, cx, cy, targetX, targetY, color) => {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(targetX, targetY);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(targetX, targetY);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
    };

    const drawDebugESP = (ctx, data, w, h) => {
        const bottom = project3D(data.vp, data.wx, data.wy, data.wz, w, h);
        const top = project3D(data.vp, data.wx, data.wy + 2.15, data.wz, w, h);

        if (!bottom || !top) return;
        if (bottom.x < -500 || bottom.x > w + 500 || bottom.y < -500 || bottom.y > h + 500) return;

        const boxH = Math.abs(bottom.y - top.y);
        const boxW = boxH * 0.6;
        if (boxH < 3 || boxH > h * 3) return;

        const boxX = bottom.x - boxW / 2;
        const boxY = Math.min(bottom.y, top.y);

        switch (data.method) {
            case 0: drawNormalBox(ctx, boxX, boxY, boxW, boxH, data.color, 2); break;
            case 1: drawCornerBox(ctx, boxX, boxY, boxW, boxH, data.color, 2); break;
            case 2: drawCircle(ctx, bottom.x, boxY + boxH / 2, boxH / 2, data.color, 2); break;
            case 3: drawDiamond(ctx, boxX, boxY, boxW, boxH, data.color, 2); break;
            case 4: drawCross(ctx, boxX, boxY, boxW, boxH, data.color, 2); break;
        }
    };

    const drawESP = () => {
        if (!state.canvas2d) initCanvas();
        const w = state.canvas2d.width;
        const h = state.canvas2d.height;
        const cx = w / 2;
        const cy = h / 2;
        const fovPixels = getFovPixels();
        state.ctx.clearRect(0, 0, w, h);

        let triggerTargetFound = false;

        if (cfg.debugUnlocked) {
            for (const pid in state.debugRenderQueues) {
                const queue = state.debugRenderQueues[pid];
                for (const data of queue) {
                    drawDebugESP(state.ctx, data, w, h);
                }
            }
        }
        state.debugRenderQueues = {};

        if (cfg.aimEnabled && cfg.drawFov && document.pointerLockElement && !cfg.menuOpen) {
            state.ctx.beginPath();
            state.ctx.arc(cx, cy, fovPixels, 0, Math.PI * 2);
            state.ctx.lineWidth = 4;
            state.ctx.strokeStyle = '#000000';
            state.ctx.stroke();
            state.ctx.beginPath();
            state.ctx.arc(cx, cy, fovPixels, 0, Math.PI * 2);
            state.ctx.lineWidth = 2;
            state.ctx.strokeStyle = '#FFFFFF';
            state.ctx.stroke();
        }

        if (state.renderQueue.length > 0) {
            const filtered = [];
            for (let i = 0; i < state.renderQueue.length; i++) {
                const q = state.renderQueue[i];
                let dupe = false;
                for (let j = 0; j < filtered.length; j++) {
                    const dx = q.wx - filtered[j].wx;
                    const dy = q.wy - filtered[j].wy;
                    const dz = q.wz - filtered[j].wz;
                    if ((dx * dx + dy * dy + dz * dz) < cfg.antiDupeDist) {
                        dupe = true;
                        if (q.visible) filtered[j].visible = true;
                        break;
                    }
                }
                if (!dupe) filtered.push(q);
            }

            let bDist = Infinity;
            let bVisible = false;
            state.bestTarget = null;

            for (let i = 0; i < filtered.length; i++) {
                const f = filtered[i];
                const bottom = project3D(f.vp, f.wx, f.wy + cfg.espYOffset, f.wz, w, h);
                const top = project3D(f.vp, f.wx, f.wy + cfg.espYOffset + cfg.espHeight, f.wz, w, h);
                if (!bottom || !top) continue;
                const boxH = Math.abs(bottom.y - top.y);
                const boxW = boxH * cfg.espWidth;
                if (boxH < 5 || boxH > h * 2) continue;
                const boxX = bottom.x - boxW / 2;
                const boxY = Math.min(bottom.y, top.y);

                if (cfg.triggerEnabled && document.pointerLockElement && !cfg.menuOpen) {
                    if (f.visible) {
                        let ty = top.y;
                        if (cfg.aimBone === 1) ty = (top.y + bottom.y) / 2;
                        const dist2D = Math.hypot(bottom.x - cx, ty - cy);
                        if (dist2D < boxW * 0.4) {
                            triggerTargetFound = true;
                        }
                    }
                }

                let curEspColor = f.visible ? cfg.espColorVis : cfg.espColorWall;
                let curTracerColor = f.visible ? cfg.tracerColorVis : cfg.tracerColorWall;

                if (cfg.tracerLines) drawTracerLine(state.ctx, cx, h, bottom.x, bottom.y, curTracerColor);

                if (cfg.espEnabled) {
                    if (cfg.espType === 0) drawNormalBox(state.ctx, boxX, boxY, boxW, boxH, curEspColor, cfg.espThickness);
                    else drawCornerBox(state.ctx, boxX, boxY, boxW, boxH, curEspColor, cfg.espThickness);

                    if (cfg.drawDistance) {
                        const p00 = Math.sqrt(f.vp[0]*f.vp[0] + f.vp[4]*f.vp[4] + f.vp[8]*f.vp[8]);
                        const p11 = Math.sqrt(f.vp[1]*f.vp[1] + f.vp[5]*f.vp[5] + f.vp[9]*f.vp[9]);

                        let realDist = bottom.w;
                        if (p00 > 0 && p11 > 0) {
                            const x_view = bottom.X_clip / p00;
                            const y_view = bottom.Y_clip / p11;
                            realDist = Math.sqrt(x_view*x_view + y_view*y_view + bottom.w*bottom.w);
                        }

                        const distText = Math.floor(realDist) + 'm';
                        const textY = boxY - 5;
                        state.ctx.font = '800 11px monospace';
                        state.ctx.textAlign = 'center';
                        state.ctx.fillStyle = '#000000';
                        state.ctx.fillText(distText, bottom.x + 1, textY + 1);
                        state.ctx.fillText(distText, bottom.x - 1, textY - 1);
                        state.ctx.fillText(distText, bottom.x + 1, textY - 1);
                        state.ctx.fillText(distText, bottom.x - 1, textY + 1);
                        state.ctx.fillStyle = curEspColor;
                        state.ctx.fillText(distText, bottom.x, textY);
                    }
                }

                if (cfg.aimEnabled && document.pointerLockElement && !cfg.menuOpen) {
                    let ty = top.y;
                    if (cfg.aimBone === 1) ty = (top.y + bottom.y) / 2;
                    const dist2D = Math.hypot(bottom.x - cx, ty - cy);

                    if (dist2D <= fovPixels) {
                        let isBetter = false;

                        if (cfg.aimVisCheck) {
                            if (f.visible && dist2D < bDist) {
                                isBetter = true;
                            }
                        } else {
                            if (f.visible && !bVisible) {
                                isBetter = true;
                            } else if (f.visible === bVisible && dist2D < bDist) {
                                isBetter = true;
                            }
                        }

                        if (isBetter) {
                            bDist = dist2D;
                            bVisible = f.visible;
                            state.bestTarget = { x: bottom.x, y: ty };
                        }
                    }
                }
            }
        } else {
            state.bestTarget = null;
        }

        if (cfg.removeScopeOverlay && document.pointerLockElement && !cfg.menuOpen) {
            const x = Math.floor(cx) + 0.5;
            const y = Math.floor(cy) + 0.5;
            const size = 14;

            state.ctx.beginPath();
            state.ctx.moveTo(x - size, y);
            state.ctx.lineTo(x + size, y);
            state.ctx.moveTo(x, y - size);
            state.ctx.lineTo(x, y + size);
            state.ctx.lineWidth = 3;
            state.ctx.strokeStyle = '#000000';
            state.ctx.stroke();

            state.ctx.beginPath();
            state.ctx.moveTo(x - size + 1, y);
            state.ctx.lineTo(x + size - 1, y);
            state.ctx.moveTo(x, y - size + 1);
            state.ctx.lineTo(x, y + size - 1);
            state.ctx.lineWidth = 1;
            state.ctx.strokeStyle = '#ffffff';
            state.ctx.stroke();
        }

        if (triggerTargetFound) {
            if (!state.triggerActive) {
                state.triggerActive = true;
                state.triggerTargetAcquiredTime = Date.now();
            }
        } else {
            state.triggerActive = false;
            state.triggerTargetAcquiredTime = 0;
        }

        state.renderQueue = [];
    };

    const doAim = () => {
        if (!cfg.aimEnabled || !state.bestTarget || !document.pointerLockElement || cfg.menuOpen) {
            state.aimDx = 0;
            state.aimDy = 0;
            return;
        }
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        const dx = state.bestTarget.x - cx;
        const dy = state.bestTarget.y - cy;
        let act = false;
        if (cfg.aimKey === 0) act = true;
        if (cfg.aimKey === 1 && state.rmb) act = true;
        if (cfg.aimKey === 2 && state.lmb) act = true;
        if (act) {
            let actualSmooth = Math.max(0.01, 1.0 - (cfg.aimSmooth / 100));
            state.aimDx = dx * actualSmooth;
            state.aimDy = dy * actualSmooth;
            document.pointerLockElement.dispatchEvent(new MouseEvent('mousemove', {
                bubbles: true,
                cancelable: true
            }));
        } else {
            state.aimDx = 0;
            state.aimDy = 0;
        }
    };

    const handleTriggerbot = () => {
        if (!cfg.triggerEnabled || cfg.menuOpen || !document.pointerLockElement) return;

        if (!state.rmb || (Date.now() - state.rmbPressTime < 250)) return;

        if (state.triggerActive && !state.lmb) {
            const now = Date.now();

            if (state.triggerTargetAcquiredTime > 0 && (now - state.triggerTargetAcquiredTime >= cfg.triggerDelay)) {

                if (now - state.lastShootTime >= 50) {
                    state.lastShootTime = now;
                    const canvas = document.querySelector('canvas');
                    if (canvas) {
                        canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
                        setTimeout(() => {
                            canvas.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
                        }, 25);
                    }
                }
            }
        }
    };

    const espLoop = () => {
        drawESP();
        doAim();
        handleTriggerbot();
        requestAnimationFrame(espLoop);
    };
    requestAnimationFrame(espLoop);

    let activeTabIdx = 0;
    let debugRefreshInterval = null;

    const buildUI = () => {
        if (document.getElementById('lotus-ui')) return;

        const CTRL_WIDTH = 130;
        const CTRL_HEIGHT = 18;
        const CTRL_SQUARE = 18;

        const style = document.createElement('style');
        style.innerHTML = `
            #lotus-ui * { font-family: monospace !important; font-weight: normal !important; cursor: default !important; }
            .lotus-ctrl { width: ${CTRL_WIDTH}px; height: ${CTRL_HEIGHT}px; background: #1a1a1a; border: 1px solid #333; box-sizing: border-box; display: flex; align-items: center; justify-content: center; }
            .lotus-cycle { color: #ccc; font-size: 11px; transition: background 0.1s; text-align: center; white-space: nowrap; overflow: hidden; }
            .lotus-slider-wrap { position: relative; overflow: hidden; }
            .lotus-slider-fill { position: absolute; left: 0; top: 0; height: 100%; background: #DB87D4; pointer-events: none; }
            .lotus-slider-input { position: absolute; left: 0; top: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer !important; margin: 0; }
            .lotus-color-wrap { position: relative; overflow: hidden; }
            .lotus-color-display { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
            .lotus-color-input { position: absolute; left: 0; top: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer !important; }
            .lotus-program-list { max-height: 180px; overflow-y: auto; background: #0d0d0d; border: 1px solid #333; }
            .lotus-program-item { padding: 4px 8px; border-bottom: 1px solid #222; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 10px; }
            .lotus-program-item:hover { background: #1c1c1c; }
            .lotus-program-item.selected { background: #2a1a2a; border-left: 2px solid #DB87D4; }
            .lotus-program-detail { background: #0d0d0d; border: 1px solid #333; padding: 8px; margin-top: 8px; font-size: 10px; max-height: 300px; overflow-y: auto; }
            .lotus-detail-row { display: flex; justify-content: space-between; padding: 2px 0; border-bottom: 1px solid #1a1a1a; }
            .lotus-detail-label { color: #888; }
            .lotus-detail-value { color: #DB87D4; max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
            .lotus-shader-source { background: #080808; border: 1px solid #222; padding: 4px; font-size: 9px; max-height: 80px; overflow: auto; white-space: pre-wrap; word-break: break-all; color: #6a6; margin-top: 4px; }
            .lotus-search-input { width: 100%; background: #1a1a1a; border: 1px solid #333; color: #ccc; padding: 4px 8px; font-size: 11px; box-sizing: border-box; }
            .lotus-mini-btn { padding: 2px 6px; background: #1a1a1a; border: 1px solid #333; color: #ccc; font-size: 9px; cursor: pointer; margin: 2px; }
            .lotus-mini-btn:hover { background: #2a2a2a; }
            .lotus-mini-btn.active { background: #DB87D4; color: #000; }
            .lotus-section-title { color: #888; font-size: 10px; padding: 4px 0; border-bottom: 1px solid #333; margin-top: 8px; }
            .lotus-category-title { color: #fff; font-size: 11px; font-weight: bold; margin-top: 6px; padding-bottom: 2px; border-bottom: 1px solid #333; }
        `;
        document.head.appendChild(style);

        const ui = document.createElement('div');
        ui.id = 'lotus-ui';
        ui.style.cssText = `position: fixed; top: 100px; left: 100px; width: 380px; background: #141414; border: 1px solid #333; z-index: 2147483647; display: flex; flex-direction: column; color: #ccc; box-shadow: 2px 2px 10px rgba(0,0,0,0.8); user-select: none; text-transform: lowercase; font-size: 11px;`;
        ui.oncontextmenu = e => e.preventDefault();

        allInputEvents.forEach(evt => {
            ui.addEventListener(evt, e => {
                if (cfg.menuOpen) e.stopPropagation();
            });
        });

        const header = document.createElement('div');
        header.style.cssText = `background: #1c1c1c; padding: 6px 10px; border-bottom: 1px solid #333; display: flex; justify-content: center; align-items: center; color: #fff;`;
        header.innerHTML = `<span>lotus</span>`;

        let isDrag = false, offsetX, offsetY;
        header.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            isDrag = true;
            offsetX = e.clientX - ui.offsetLeft;
            offsetY = e.clientY - ui.offsetTop;
            e.stopPropagation();
        }, true);
        window.addEventListener('mousemove', e => {
            if (isDrag && cfg.menuOpen) {
                ui.style.left = (e.clientX - offsetX) + 'px';
                ui.style.top = (e.clientY - offsetY) + 'px';
            }
        }, true);
        window.addEventListener('mouseup', e => {
            if (e.button === 0) isDrag = false;
        }, true);

        const tabsContainer = document.createElement('div');
        tabsContainer.style.cssText = `display: flex; background: #181818; border-bottom: 1px solid #333;`;

        const content = document.createElement('div');
        content.style.cssText = `padding: 12px; display: flex; flex-direction: column; gap: 8px; background: #141414; max-height: 70vh; overflow-y: auto;`;

        const rContent = () => {
            content.innerHTML = '';
            if (debugRefreshInterval) {
                clearInterval(debugRefreshInterval);
                debugRefreshInterval = null;
            }

            const addCheck = (label, key, obj = cfg) => {
                const w = document.createElement('div');
                w.style.cssText = `display: flex; align-items: center; justify-content: space-between;`;
                const l = document.createElement('span');
                l.textContent = label;
                w.appendChild(l);
                const box = document.createElement('div');
                box.className = 'lotus-ctrl';
                box.style.width = CTRL_SQUARE + 'px';
                box.style.background = obj[key] ? '#DB87D4' : '#1a1a1a';
                w.appendChild(box);
                w.onmousedown = (e) => {
                    e.stopPropagation();
                    obj[key] = !obj[key];
                    saveCfg();
                    rContent();
                };
                content.appendChild(w);
            };

            const addSlider = (label, key, min, max, step, obj = cfg) => {
                const w = document.createElement('div');
                w.style.cssText = `display: flex; align-items: center; justify-content: space-between;`;
                const l = document.createElement('span');
                l.textContent = `${label} (${obj[key]})`;
                w.appendChild(l);
                const sliderWrap = document.createElement('div');
                sliderWrap.className = 'lotus-ctrl lotus-slider-wrap';
                const fill = document.createElement('div');
                fill.className = 'lotus-slider-fill';
                fill.style.width = ((obj[key] - min) / (max - min)) * 100 + '%';
                const inp = document.createElement('input');
                inp.type = 'range';
                inp.min = min;
                inp.max = max;
                inp.step = step;
                inp.value = obj[key];
                inp.className = 'lotus-slider-input';
                inp.oninput = e => {
                    obj[key] = parseFloat(e.target.value);
                    l.textContent = `${label} (${obj[key]})`;
                    fill.style.width = ((obj[key] - min) / (max - min)) * 100 + '%';
                    saveCfg();
                };
                sliderWrap.appendChild(fill);
                sliderWrap.appendChild(inp);
                w.appendChild(sliderWrap);
                content.appendChild(w);
            };

            const addCycle = (label, key, opts, obj = cfg) => {
                const w = document.createElement('div');
                w.style.cssText = `display: flex; align-items: center; justify-content: space-between;`;
                const l = document.createElement('span');
                l.textContent = label;
                w.appendChild(l);
                const btn = document.createElement('div');
                btn.className = 'lotus-ctrl lotus-cycle';
                btn.textContent = opts[obj[key]];
                btn.onmousedown = (e) => {
                    e.stopPropagation();
                    obj[key] = (obj[key] + 1) % opts.length;
                    btn.textContent = opts[obj[key]];
                    saveCfg();
                };
                w.appendChild(btn);
                content.appendChild(w);
            };

            const addColor = (label, key, obj = cfg) => {
                const w = document.createElement('div');
                w.style.cssText = `display: flex; align-items: center; justify-content: space-between;`;
                const l = document.createElement('span');
                l.textContent = label;
                w.appendChild(l);
                const colorWrap = document.createElement('div');
                colorWrap.className = 'lotus-ctrl lotus-color-wrap';
                colorWrap.style.width = CTRL_SQUARE + 'px';
                const display = document.createElement('div');
                display.className = 'lotus-color-display';
                display.style.background = obj[key];
                const inp = document.createElement('input');
                inp.type = 'color';
                inp.value = obj[key];
                inp.className = 'lotus-color-input';
                inp.oninput = e => {
                    obj[key] = e.target.value;
                    display.style.background = obj[key];
                    saveCfg();
                };
                colorWrap.appendChild(display);
                colorWrap.appendChild(inp);
                w.appendChild(colorWrap);
                content.appendChild(w);
            };

            const addTitle = (label) => {
                const t = document.createElement('div');
                t.className = 'lotus-category-title';
                t.textContent = label;
                content.appendChild(t);
            };

            if (activeTabIdx === 0) {
                addTitle('aimbot');
                addCheck('enabled', 'aimEnabled');
                addCheck('visibility check', 'aimVisCheck');
                addCheck('draw fov', 'drawFov');
                addCycle('aim key', 'aimKey', ['always on', 'right click', 'left click']);
                addCycle('target bone', 'aimBone', ['head', 'chest']);
                addSlider('fov', 'aimFov', 5, 90, 1);
                addSlider('smooth', 'aimSmooth', 0, 100, 1);

                addTitle('triggerbot');
                addCheck('enabled', 'triggerEnabled');
                addSlider('shoot delay', 'triggerDelay', 0, 200, 10);
            }

            if (activeTabIdx === 1) {
                addTitle('box');
                addCheck('enabled', 'espEnabled');
                addCycle('type', 'espType', ['normal', 'corner']);
                addCheck('draw distance', 'drawDistance');
                addColor('visible color', 'espColorVis');
                addColor('behind wall color', 'espColorWall');

                addTitle('tracer');
                addCheck('enabled', 'tracerLines');
                addColor('visible color', 'tracerColorVis');
                addColor('behind wall color', 'tracerColorWall');
            }

            if (activeTabIdx === 2) {
                addTitle('player');
                addCheck('enabled', 'enemyChamsEnabled');
                addCycle('type', 'enemyChamsMode', ['additive', 'wireframe', 'flat', 'darken', 'tint', 'hide']);
                addColor('visible color', 'enemyChamsColorVis');
                addColor('behind wall color', 'enemyChamsColorWall');

                addTitle('arms');
                addCheck('enabled', 'handChamsEnabled');
                addCycle('type', 'handChamsMode', ['additive', 'wireframe', 'flat', 'darken', 'tint', 'hide']);
                addColor('color', 'handChamsColor');

                addTitle('weapon');
                addCheck('enabled', 'weaponChamsEnabled');
                addCycle('type', 'weaponChamsMode', ['additive', 'wireframe', 'flat', 'darken', 'tint', 'hide']);
                addColor('color', 'weaponChamsColor');

                addTitle('world');
                addCheck('enabled', 'worldManipulationEnabled');
                addColor('color', 'worldColor');

                addTitle('misc');
                addCheck('remove scope overlay', 'removeScopeOverlay');
            }

            if (activeTabIdx === 3 && cfg.debugUnlocked) {
                const searchWrap = document.createElement('div');
                const searchInput = document.createElement('input');
                searchInput.className = 'lotus-search-input';
                searchInput.placeholder = 'search by id/variable:';
                searchInput.value = cfg.debugSearch;
                searchInput.oninput = (e) => {
                    cfg.debugSearch = e.target.value.toLowerCase();
                    renderProgramList();
                };
                searchWrap.appendChild(searchInput);
                content.appendChild(searchWrap);

                const sortWrap = document.createElement('div');
                sortWrap.style.cssText = 'display: flex; gap: 4px; flex-wrap: wrap;';
                ['id', 'draws', 'verts', 'calls'].forEach((s, i) => {
                    const btn = document.createElement('button');
                    btn.className = 'lotus-mini-btn' + (cfg.debugSortBy === i ? ' active' : '');
                    btn.textContent = 'sort: ' + s;
                    btn.onclick = () => {
                        cfg.debugSortBy = i;
                        rContent();
                    };
                    sortWrap.appendChild(btn);
                });
                const activeOnlyBtn = document.createElement('button');
                activeOnlyBtn.className = 'lotus-mini-btn' + (cfg.debugShowOnlyActive ? ' active' : '');
                activeOnlyBtn.textContent = 'active only';
                activeOnlyBtn.onclick = () => {
                    cfg.debugShowOnlyActive = !cfg.debugShowOnlyActive;
                    rContent();
                };
                sortWrap.appendChild(activeOnlyBtn);
                content.appendChild(sortWrap);

                const listWrap = document.createElement('div');
                listWrap.className = 'lotus-program-list';
                listWrap.id = 'lotus-program-list';
                content.appendChild(listWrap);

                const detailWrap = document.createElement('div');
                detailWrap.id = 'lotus-detail-panel';
                content.appendChild(detailWrap);

                const renderProgramList = () => {
                    const list = document.getElementById('lotus-program-list');
                    if (!list) return;
                    list.innerHTML = '';

                    let programs = [];
                    for (const [id, s] of state.stats.entries()) {
                        const meta = state.programMeta.get(id);
                        const dc = state.programDrawCalls.get(id);
                        programs.push({
                            id,
                            draws: s.draws,
                            totalVerts: dc?.totalVerts || 0,
                            calls: dc?.calls || 0,
                            vars: meta?.vars || new Set(),
                            lastVerts: s.lastVerts || 0,
                            frameVerts: s.frameVerts || 0
                        });
                    }

                    if (cfg.debugSearch) {
                        programs = programs.filter(p => {
                            if (String(p.id).includes(cfg.debugSearch)) return true;
                            for (const v of p.vars)
                                if (v.toLowerCase().includes(cfg.debugSearch)) return true;
                            return false;
                        });
                    }

                    if (cfg.debugShowOnlyActive) {
                        programs = programs.filter(p => p.draws > 0 || p.calls > 0);
                    }

                    switch (cfg.debugSortBy) {
                        case 0: programs.sort((a, b) => a.id - b.id); break;
                        case 1: programs.sort((a, b) => b.draws - a.draws); break;
                        case 2: programs.sort((a, b) => b.totalVerts - a.totalVerts); break;
                        case 3: programs.sort((a, b) => b.calls - a.calls); break;
                    }

                    for (const p of programs) {
                        const item = document.createElement('div');
                        item.className = 'lotus-program-item' + (state.selectedDebugPid === p.id ? ' selected' : '');

                        const debugCfg = getDebugProgramConfig(p.id);
                        const flags = [];
                        if (debugCfg.chams) flags.push('C');
                        if (debugCfg.esp) flags.push('E');
                        if (debugCfg.hidden) flags.push('H');

                        if (p.id === cfg.playerTargetId) flags.push('<span style="color:#ff0">[P]</span>');
                        if (p.id === cfg.enemyTargetId) flags.push('<span style="color:#f00">[E]</span>');
                        if (p.id === cfg.weaponTargetId) flags.push('<span style="color:#66f">[W]</span>');

                        const isPlayer = PLAYER_FLAGS.every(f => p.vars.has(f));
                        const hasMapUniform = state.programUniforms.get(p.id)?.has('map');
                        const isEnemy = ENEMY_FLAGS.every(f => p.vars.has(f)) && !p.vars.has('color') && !hasMapUniform;
                        const isWeapon = WEAPON_FLAGS.every(f => p.vars.has(f)) && !p.vars.has('skinIndex');
                        const isWorld = WORLD_FLAGS.every(f => p.vars.has(f));

                        let labelColor = '#ccc';
                        if (isPlayer) labelColor = '#6f6';
                        else if (isEnemy) labelColor = '#f66';
                        else if (isWeapon) labelColor = '#6bf';
                        else if (isWorld) labelColor = '#aa88ff';

                        item.innerHTML = `
                            <span style="color: ${labelColor}">
                                [${p.id}] ${flags.join('')}
                            </span>
                            <span style="color: #888">
                                d:${p.draws} v:${p.frameVerts} c:${p.calls}
                            </span>
                        `;

                        item.onclick = () => {
                            state.selectedDebugPid = p.id;
                            renderProgramList();
                            renderDetailPanel();
                        };

                        list.appendChild(item);
                    }
                };

                const renderDetailPanel = () => {
                    const panel = document.getElementById('lotus-detail-panel');
                    if (!panel || state.selectedDebugPid === null) {
                        if (panel) panel.innerHTML = '<div style="color:#666;padding:8px;">select a program</div>';
                        return;
                    }

                    const pid = state.selectedDebugPid;
                    const s = state.stats.get(pid);
                    const meta = state.programMeta.get(pid);
                    const dc = state.programDrawCalls.get(pid);
                    const attrs = state.programAttributes.get(pid);
                    const unis = state.programUniforms.get(pid);
                    const sources = state.shaderSources.get(pid);
                    const matrices = state.programMatrices.get(pid);
                    const debugCfg = getDebugProgramConfig(pid);

                    const isPlayer = meta ? PLAYER_FLAGS.every(f => meta.vars.has(f)) : false;
                    const hasMapUniform = unis ? unis.has('map') : false;
                    const isEnemy = meta ? (ENEMY_FLAGS.every(f => meta.vars.has(f)) && !meta.vars.has('color') && !hasMapUniform) : false;
                    const isWeapon = meta ? (WEAPON_FLAGS.every(f => meta.vars.has(f)) && !meta.vars.has('skinIndex')) : false;
                    const isWorld = meta ? WORLD_FLAGS.every(f => meta.vars.has(f)) : false;

                    panel.innerHTML = '';
                    panel.className = 'lotus-program-detail';

                    const headerEl = document.createElement('div');
                    headerEl.style.cssText = 'font-size: 12px; color: #DB87D4; margin-bottom: 8px;';

                    let tags = '';
                    if (isPlayer) tags += ' <span style="color:#6f6">[player shader?]</span>';
                    if (isEnemy) tags += ' <span style="color:#f66">[enemy shader?]</span>';
                    if (isWeapon) tags += ' <span style="color:#6bf">[weapon shader?]</span>';
                    if (isWorld) tags += ' <span style="color:#aa88ff">[world shader?]</span>';
                    if (pid === cfg.playerTargetId) tags += ' <span style="color:#ff0">[P_TARGET]</span>';
                    if (pid === cfg.enemyTargetId) tags += ' <span style="color:#f00">[E_TARGET]</span>';
                    if (pid === cfg.weaponTargetId) tags += ' <span style="color:#66f">[W_TARGET]</span>';

                    headerEl.innerHTML = `program #${pid} ${tags}`;
                    panel.appendChild(headerEl);

                    const isManaged = isPlayer || isEnemy || isWeapon || isWorld;

                    if (isManaged) {
                        const managedMsg = document.createElement('div');
                        managedMsg.style.cssText = 'color: #888; font-size: 10px; margin-bottom: 8px; padding: 6px; border-left: 2px solid #DB87D4; background: #1a1a1a;';
                        managedMsg.textContent = 'this shader is managed by the main menu. debug overrides disabled.';
                        panel.appendChild(managedMsg);
                    } else {
                        const actions = document.createElement('div');
                        actions.style.cssText = 'display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;';

                        const makeBtn = (label, active, onClick) => {
                            const btn = document.createElement('button');
                            btn.className = 'lotus-mini-btn' + (active ? ' active' : '');
                            btn.textContent = label;
                            btn.onclick = onClick;
                            return btn;
                        };

                        actions.appendChild(makeBtn('chams', debugCfg.chams, () => {
                            debugCfg.chams = !debugCfg.chams; renderDetailPanel();
                        }));
                        actions.appendChild(makeBtn('esp', debugCfg.esp, () => {
                            debugCfg.esp = !debugCfg.esp; renderDetailPanel();
                        }));
                        actions.appendChild(makeBtn('hidden', debugCfg.hidden, () => {
                            debugCfg.hidden = !debugCfg.hidden; renderDetailPanel();
                        }));
                        actions.appendChild(makeBtn('highlight', debugCfg.highlight, () => {
                            debugCfg.highlight = !debugCfg.highlight; renderDetailPanel();
                        }));
                        panel.appendChild(actions);

                        const colorRow = document.createElement('div');
                        colorRow.style.cssText = 'display: flex; gap: 8px; margin-bottom: 8px; align-items: center;';
                        colorRow.innerHTML = `<span>chams:</span><input type="color" value="${debugCfg.chamsColor}" style="width:24px;height:18px;border:none;"><span>esp:</span><input type="color" value="${debugCfg.espColor}" style="width:24px;height:18px;border:none;">`;
                        const [chamsInput, espInput] = colorRow.querySelectorAll('input');
                        chamsInput.oninput = e => debugCfg.chamsColor = e.target.value;
                        espInput.oninput = e => debugCfg.espColor = e.target.value;
                        panel.appendChild(colorRow);

                        const chamsRow = document.createElement('div');
                        chamsRow.style.cssText = 'display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 4px;';
                        chamsRow.innerHTML = '<span style="width:100%;color:#888;font-size:9px;">chams mode:</span>';

                        ['additive', 'wireframe', 'flat', 'darken', 'tint (night)'].forEach((m, i) => {
                            chamsRow.appendChild(makeBtn(m, debugCfg.chamsMode === i, () => {
                                debugCfg.chamsMode = i; renderDetailPanel();
                            }));
                        });
                        panel.appendChild(chamsRow);

                        const espMethodRow = document.createElement('div');
                        espMethodRow.style.cssText = 'display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 4px;';
                        espMethodRow.innerHTML = '<span style="width:100%;color:#888;font-size:9px;">esp style:</span>';
                        ['box', 'corner', 'circle', 'diamond', 'cross'].forEach((m, i) => {
                            espMethodRow.appendChild(makeBtn(m, debugCfg.espMethod === i, () => {
                                debugCfg.espMethod = i; renderDetailPanel();
                            }));
                        });
                        panel.appendChild(espMethodRow);

                        const espMatrixRow = document.createElement('div');
                        espMatrixRow.style.cssText = 'display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px;';
                        espMatrixRow.innerHTML = '<span style="width:100%;color:#888;font-size:9px;">esp matrix:</span>';
                        ['mvpName', 'heur1+m', 'heur2+m', 'vpName+m', 'lastMat'].forEach((m, i) => {
                            espMatrixRow.appendChild(makeBtn(m, debugCfg.espMatrix === i, () => {
                                debugCfg.espMatrix = i; renderDetailPanel();
                            }));
                        });
                        panel.appendChild(espMatrixRow);
                    }

                    const statsSection = document.createElement('div');
                    statsSection.innerHTML = '<div class="lotus-section-title">statistics</div>';
                    const addRow = (parent, label, value) => {
                        const row = document.createElement('div');
                        row.className = 'lotus-detail-row';
                        row.innerHTML = `<span class="lotus-detail-label">${label}</span><span class="lotus-detail-value">${value}</span>`;
                        parent.appendChild(row);
                    };
                    addRow(statsSection, 'draws', s?.draws || 0);
                    addRow(statsSection, 'frame verts', s?.frameVerts || 0);
                    addRow(statsSection, 'last verts', s?.lastVerts || 0);
                    addRow(statsSection, 'total verts', dc?.totalVerts || 0);
                    addRow(statsSection, 'calls', dc?.calls || 0);
                    addRow(statsSection, 'draw mode', glDrawModes[dc?.mode] || dc?.mode || 'N/A');
                    panel.appendChild(statsSection);

                    if (matrices) {
                        const matSection = document.createElement('div');
                        matSection.innerHTML = '<div class="lotus-section-title">matrices</div>';
                        const fmtPos = (m) => m ? `[${m[12].toFixed(1)}, ${m[13].toFixed(1)}, ${m[14].toFixed(1)}]` : 'null';
                        addRow(matSection, 'mvp', matrices.mvp ? 'yes' : 'no');
                        addRow(matSection, 'vp', matrices.vp ? 'yes' : 'no');
                        addRow(matSection, 'm pos', fmtPos(matrices.m));
                        addRow(matSection, 'heur1', matrices.heur1 ? 'yes' : 'no');
                        addRow(matSection, 'heur2', matrices.heur2 ? 'yes' : 'no');
                        panel.appendChild(matSection);
                    }

                    if (attrs && attrs.size > 0) {
                        const attrSection = document.createElement('div');
                        attrSection.innerHTML = '<div class="lotus-section-title">attributes (' + attrs.size + ')</div>';
                        for (const [name, info] of attrs) {
                            addRow(attrSection, name, info.typeName || info.type);
                        }
                        panel.appendChild(attrSection);
                    }

                    if (unis && unis.size > 0) {
                        const uniSection = document.createElement('div');
                        uniSection.innerHTML = '<div class="lotus-section-title">uniforms (' + unis.size + ')</div>';
                        for (const [name, info] of unis) {
                            addRow(uniSection, name, info.typeName || info.type);
                        }
                        panel.appendChild(uniSection);
                    }

                    if (meta && meta.vars.size > 0) {
                        const varSection = document.createElement('div');
                        varSection.innerHTML = '<div class="lotus-section-title">variables (' + meta.vars.size + ')</div>';
                        const varList = document.createElement('div');
                        varList.style.cssText = 'font-size: 9px; color: #888; word-wrap: break-word;';
                        varList.textContent = Array.from(meta.vars).join(', ');
                        varSection.appendChild(varList);
                        panel.appendChild(varSection);
                    }

                    if (sources) {
                        const srcSection = document.createElement('div');
                        srcSection.innerHTML = '<div class="lotus-section-title">shaders</div>';

                        if (sources.vertex) {
                            const vSrc = document.createElement('div');
                            vSrc.className = 'lotus-shader-source';
                            vSrc.textContent = sources.vertex.substring(0, 500) + (sources.vertex.length > 500 ? '...' : '');
                            srcSection.appendChild(vSrc);
                            const copyV = document.createElement('button');
                            copyV.className = 'lotus-mini-btn';
                            copyV.textContent = 'copy vertex';
                            copyV.onclick = () => navigator.clipboard.writeText(sources.vertex);
                            srcSection.appendChild(copyV);
                        }

                        if (sources.fragment) {
                            const fSrc = document.createElement('div');
                            fSrc.className = 'lotus-shader-source';
                            fSrc.style.color = '#a66';
                            fSrc.textContent = sources.fragment.substring(0, 500) + (sources.fragment.length > 500 ? '...' : '');
                            srcSection.appendChild(fSrc);
                            const copyF = document.createElement('button');
                            copyF.className = 'lotus-mini-btn';
                            copyF.textContent = 'copy fragment';
                            copyF.onclick = () => navigator.clipboard.writeText(sources.fragment);
                            srcSection.appendChild(copyF);
                        }

                        panel.appendChild(srcSection);
                    }
                };

                renderProgramList();
                renderDetailPanel();

                debugRefreshInterval = setInterval(() => {
                    if (activeTabIdx === 3 && cfg.debugUnlocked && cfg.menuOpen) {
                        renderProgramList();
                    }
                }, 500);
            }
        };

        const buildTabs = () => {
            tabsContainer.innerHTML = '';
            const tabsList = ['aim', 'esp', 'chams'];
            if (cfg.debugUnlocked) tabsList.push('debug');

            tabsList.forEach((t, i) => {
                const b = document.createElement('div');
                b.textContent = t;
                b.style.cssText = `flex: 1; text-align: center; padding: 6px 0; border-bottom: 2px solid transparent; color: #888; transition: 0.1s; cursor: pointer;`;
                if (i === activeTabIdx) {
                    b.style.color = '#fff';
                    b.style.borderBottom = '2px solid #DB87D4';
                    b.style.background = '#1c1c1c';
                }
                b.onmousedown = (e) => {
                    e.stopPropagation();
                    activeTabIdx = i;
                    buildTabs();
                    rContent();
                };
                tabsContainer.appendChild(b);
            });
        };

        state.rebuildTabs = buildTabs;
        buildTabs();

        ui.appendChild(header);
        ui.appendChild(tabsContainer);
        ui.appendChild(content);
        document.body.appendChild(ui);
        state.ui = ui;
        rContent();
    };

    const buildWatermark = () => {
        const wm = document.createElement('div');
        wm.id = 'lotus-watermark';
        wm.style.cssText = `position: fixed; top: 10%; left: 50%; transform: translateX(-50%); background: #1c1c1c; border: 1px solid #333; border-bottom: 2px solid #DB87D4; padding: 6px 12px; font-family: monospace; font-size: 11px; color: #fff; z-index: 2147483647; pointer-events: none; text-transform: lowercase;`;
        wm.textContent = 'lotus | fps: 0';
        document.body.appendChild(wm);

        let frames = 0;
        let lastTime = performance.now();
        const updateFPS = () => {
            frames++;
            const now = performance.now();
            if (now - lastTime >= 1000) {
                wm.textContent = `lotus | fps: ${frames}`;
                frames = 0;
                lastTime = now;
            }
            requestAnimationFrame(updateFPS);
        };
        requestAnimationFrame(updateFPS);
    };

    setInterval(() => {
        const now = Date.now();
        if (state.glContext && state.glContext instanceof WebGL2RenderingContext) {
            for (const [id, qObj] of state.queries.entries()) {
                if (now - qObj.lastSeen > 2000) {
                    state.glContext.deleteQuery(qObj.q);
                    state.queries.delete(id);
                }
            }
        }
    }, 2000);

    setInterval(() => {
        let bestPlayerId = cfg.playerTargetId;
        let bestEnemyId = cfg.enemyTargetId;
        let bestWeaponId = cfg.weaponTargetId;

        let highestPlayerDraws = 0;
        let highestEnemyDraws = 0;
        let highestWeaponVerts = 0;

        for (const [id, s] of state.stats.entries()) {
            if (s.draws > 0) {
                const meta = state.programMeta.get(id);
                const unis = state.programUniforms.get(id);
                if (meta) {
                    const hasPlayerFlags = PLAYER_FLAGS.every(flag => meta.vars.has(flag));
                    const hasMapUniform = unis ? unis.has('map') : false;
                    const hasEnemyFlags = ENEMY_FLAGS.every(flag => meta.vars.has(flag)) && !meta.vars.has('color') && !hasMapUniform;
                    const hasWeaponFlags = WEAPON_FLAGS.every(flag => meta.vars.has(flag)) && !meta.vars.has('skinIndex');

                    if (hasPlayerFlags && s.draws > highestPlayerDraws) {
                        highestPlayerDraws = s.draws;
                        bestPlayerId = id;
                    }
                    if (hasEnemyFlags && s.draws > highestEnemyDraws) {
                        highestEnemyDraws = s.draws;
                        bestEnemyId = id;
                    }
                    if (hasWeaponFlags && s.frameVerts > highestWeaponVerts) {
                        highestWeaponVerts = s.frameVerts;
                        bestWeaponId = id;
                    }
                }
            }
        }

        if (bestPlayerId !== cfg.playerTargetId && highestPlayerDraws > 0) cfg.playerTargetId = bestPlayerId;
        if (bestEnemyId !== cfg.enemyTargetId && highestEnemyDraws > 0) cfg.enemyTargetId = bestEnemyId;
        if (bestWeaponId !== cfg.weaponTargetId && highestWeaponVerts > 0) cfg.weaponTargetId = bestWeaponId;

        for (const [id, s] of state.stats) {
            s.draws = 0;
            s.frameVerts = 0;
        }
        for (const [id, dc] of state.programDrawCalls) {
            dc.calls = 0;
        }
    }, 1000);

    hookContext();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            buildUI();
            buildWatermark();
        });
    } else {
        buildUI();
        buildWatermark();
    }

})();