# ONNX Runtime Web browser assets

For local development, this directory contains unmodified CPU/WebAssembly assets from the official
`onnxruntime-web` npm package, version `1.23.2`. The application serves these
files from the same origin as the page; no third-party CDN is required at
inference time.

The generated runtime and legal-notice files are ignored by Git. The Pages
workflow downloads the pinned package and upstream-tag legal files, checks
their SHA-256 values, and assembles them into the deployed site. See
`.github/workflows/pages.yml` for the reproducible extraction commands.

Package source:
https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.23.2.tgz

Archive SHA-256: `0b8707d7efab9a2bea63564d66cad79e897cfd0bd627e5ae000488ffc1c45c7d`.

The downloaded archive was verified against the npm registry integrity value:

```text
sha512-T09JUtMn+CZLk3mFwqiH0lgQf+4S7+oYHHtk6uhaYAAJI95bTcKi5bOOZYwORXfS/RLZCjDDEXGWIuOCAFlEjg==
```

Runtime files and SHA-256 checksums:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `ort.wasm.min.mjs` | 49856 | `69751720f611e37d1ce2fa3c6ebaa80f949014752636c5f8887a63d40feadcc7` |
| `ort-wasm-simd-threaded.mjs` | 20321 | `90a557d15c02bac4504d95b67f431d8594635ed2a0a62a7f2cd83d090ff91d3e` |
| `ort-wasm-simd-threaded.wasm` | 11905541 | `45eaee27761ad883742a8d4b8fce1538d60ce43b51adf1726fafccc59b8c1a15` |

`ort.wasm.min.mjs` contains the public ONNX Runtime API and the WASM backend.
It dynamically imports `ort-wasm-simd-threaded.mjs`, which loads
`ort-wasm-simd-threaded.wasm`. The native Node.js imports in the generated
module are conditional and are not executed in the browser.

The application uses one WASM thread and disables the optional proxy feature.
It does not require WebGPU, a dedicated GPU, or cross-origin isolation headers.
The supplied WASM binary requires a browser with WebAssembly SIMD support.

Deployment documentation:
https://onnxruntime.ai/docs/tutorials/web/deploy.html

`LICENSE` and the complete `ThirdPartyNotices.txt` were copied without changes
from the corresponding upstream `v1.23.2` tag:

- https://raw.githubusercontent.com/microsoft/onnxruntime/v1.23.2/LICENSE
- https://raw.githubusercontent.com/microsoft/onnxruntime/v1.23.2/ThirdPartyNotices.txt

The upstream notices cover the complete ONNX Runtime project; not every listed
component is part of this WebAssembly-only deployment.
