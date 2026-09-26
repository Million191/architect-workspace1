# reliability-lab

A tiny order desk plus a stand-in vendor (AI confirmation service) for practicing reliability engineering against a service you control.

Run: `node desk.js confirm 1001` (from this folder)

Set the vendor mode: `VENDOR_MODE=slow node desk.js confirm 1001` (modes: `ok`, `slow`, `down`, `garbage`; default `ok`)

Each successful call appends one JSON line to `data/sent.log`. Zero dependencies, Node.js only.
