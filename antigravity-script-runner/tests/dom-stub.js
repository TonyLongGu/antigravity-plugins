/**
 * 極簡 DOM / 瀏覽器環境模擬層（僅供測試使用，不進 IDE 執行路徑）
 *
 * 目的：讓 media/<viewer>/viewer.js 能在 Node 中載入、回應事件並被觀察，
 *       取代真實 VS Code Webview，使「互動語意」可在無 IDE 的情況下驗證。
 *
 * 已知限制（測試結果的解讀邊界）：
 *   - 不做版面計算與事件冒泡：所有 rect 皆為固定假值，查詢一律回傳傀儡元素。
 *   - 因此「純視覺／版面／CSS 佈局」類問題測不到，需靠真實 IDE 煙霧測試補足。
 */
'use strict';

const vm = require('node:vm');

/** CSSStyleDeclaration 模擬（支援 style.foo = x 與 setProperty/getPropertyValue） */
function createStyle() {
  const store = {};
  return new Proxy(store, {
    get(target, prop) {
      if (prop === 'setProperty') return (k, v) => { target[k] = v; };
      if (prop === 'removeProperty') return (k) => { delete target[k]; };
      if (prop === 'getPropertyValue') return (k) => (k in target ? target[k] : '');
      if (typeof prop === 'symbol') return target[prop];
      return prop in target ? target[prop] : '';
    },
    set(target, prop, value) { target[prop] = value; return true; }
  });
}

/** CanvasRenderingContext2D 模擬：任何方法皆回傳安全假值，避免繪圖程式碼拋錯 */
function createCtx2d() {
  return new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return { addColorStop() {} };
        if (prop === 'getImageData') return { data: new Uint8ClampedArray(4) };
        if (prop === 'measureText') return { width: 0 };
        return undefined;
      };
    }
  });
}

/**
 * 元素模擬
 * @param {string} id
 * @param {string} [tag]
 * @returns {object} 具備 addEventListener / classList / style / dataset 的假元素
 */
function createElement(id, tag = 'div') {
  const classes = new Set();
  const listeners = new Map();
  const el = {
    id,
    tagName: String(tag).toUpperCase(),
    style: createStyle(),
    dataset: {},
    options: [],
    children: [],
    value: '',
    textContent: '',
    innerHTML: '',
    title: '',
    src: '',
    disabled: false,
    checked: false,
    complete: true,
    naturalWidth: 100,
    naturalHeight: 100,
    duration: 100,
    currentTime: 0,
    paused: true,
    volume: 1,
    muted: false,
    playbackRate: 1,
    loop: false,
    ended: false,
    offsetWidth: 100,
    offsetHeight: 100,
    clientWidth: 800,
    clientHeight: 600,
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : !!force;
        on ? classes.add(c) : classes.delete(c);
        return on;
      }
    },
    addEventListener(type, cb) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(cb);
    },
    removeEventListener() {},
    dispatchEvent() { return true; },
    /** 測試專用：直接觸發已註冊的監聽器（不做冒泡） */
    _fire(type, ev) {
      (listeners.get(type) || []).forEach((cb) => cb(ev || {
        type, preventDefault() {}, stopPropagation() {}, target: el, clientX: 0, clientY: 0
      }));
    },
    click() { el._fire('click'); },
    focus() {}, blur() {}, select() {}, scrollIntoView() {},
    appendChild() {}, removeChild() {}, remove() {}, insertAdjacentHTML() {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, hasAttribute() { return false; },
    closest() { return null; }, contains() { return false; },
    querySelector() { return createElement('query-result'); },
    querySelectorAll() { return []; },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
    getContext: () => createCtx2d(),
    play: () => Promise.resolve(),
    pause() {},
    load() {},
    requestFullscreen: () => Promise.resolve(),
    setPointerCapture() {},
    releasePointerCapture() {}
  };
  return el;
}

module.exports = { createContext, createElement, createStyle, createCtx2d };

/**
 * 建立一個可供 viewer.js 執行的 vm context
 * @returns {{context: object, getEl: Function, posted: Array, fireWindow: Function, fireDocument: Function, fireMessage: Function, vscodeApi: object}}
 */
function createContext() {
  const elements = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const storage = new Map();
  const posted = [];

  const getEl = (id, tag) => {
    if (!elements.has(id)) elements.set(id, createElement(id, tag));
    return elements.get(id);
  };

  const document = {
    documentElement: getEl('html', 'html'),
    body: getEl('body', 'body'),
    head: getEl('head', 'head'),
    activeElement: null,
    visibilityState: 'visible',
    readyState: 'complete',
    getElementById: (id) => getEl(id),
    createElement: (tag) => createElement('created-' + tag, tag),
    createElementNS: (ns, tag) => createElement('created-' + tag, tag),
    createDocumentFragment: () => createElement('fragment'),
    createRange: () => ({ selectNodeContents() {}, setStart() {}, setEnd() {}, collapse() {} }),
    hasFocus: () => true,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(type, cb) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(cb);
    },
    removeEventListener() {},
    exitFullscreen: () => Promise.resolve(),
    fullscreenElement: null
  };

  const fireWindow = (type, ev) => (windowListeners.get(type) || []).forEach((cb) => cb(ev || {
    type, preventDefault() {}, stopPropagation() {}, ctrlKey: false, altKey: false, metaKey: false
  }));
  const fireDocument = (type, ev) => (documentListeners.get(type) || []).forEach((cb) => cb(ev || {
    type, preventDefault() {}, stopPropagation() {}, target: document.body, ctrlKey: false, altKey: false, metaKey: false
  }));

  const window = {
    document,
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    },
    navigator: { userAgent: 'node-test', clipboard: { writeText: () => Promise.resolve() } },
    location: { href: 'vscode-webview://test' },
    innerWidth: 1200,
    innerHeight: 800,
    devicePixelRatio: 1,
    addEventListener(type, cb) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(cb);
    },
    removeEventListener() {},
    dispatchEvent: (ev) => { fireWindow(ev && ev.type, ev); return true; },
    focus() {},
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    scrollTo() {},
    getComputedStyle: () => createStyle(),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    Blob: class {},
    Image: class { constructor() { return createElement('image-created', 'img'); } },
    Audio: class { constructor() { return createElement('audio-created', 'audio'); } },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    AudioContext: class {
      constructor() { this.state = 'running'; this.destination = {}; this.sampleRate = 48000; }
      createAnalyser() {
        return {
          fftSize: 2048, frequencyBinCount: 1024,
          connect() {}, disconnect() {}, getByteFrequencyData() {}, getByteTimeDomainData() {}
        };
      }
      createMediaElementSource() { return { connect() {}, disconnect() {} }; }
      createGain() { return { connect() {}, gain: { value: 1 } }; }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
    },
    CSS: { escape: (s) => String(s).replace(/["\\]/g, '\\$&') },
    performance: { now: () => Date.now() }
  };
  window.window = window;
  window.globalThis = window;
  window.self = window;
  window.webkitAudioContext = window.AudioContext;

  const vscodeApi = {
    postMessage: (msg) => { posted.push(msg); },
    getState: () => null,
    setState: () => {}
  };

  const context = {
    window, document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    location: window.location,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    acquireVsCodeApi: () => vscodeApi,
    IntersectionObserver: window.IntersectionObserver,
    ResizeObserver: window.ResizeObserver,
    AudioContext: window.AudioContext,
    Audio: window.Audio,
    Image: window.Image,
    Blob: window.Blob,
    URL: window.URL,
    CSS: window.CSS,
    performance: window.performance,
    console, Date, Math, JSON, Object, Array, Set, Map, Promise, Number, String, Boolean,
    Error, RegExp, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') })
  };
  context.globalThis = context;
  vm.createContext(context);

  return {
    context,
    getEl,
    posted,
    fireWindow,
    fireDocument,
    fireMessage: (data) => fireWindow('message', { data }),
    vscodeApi
  };
}

