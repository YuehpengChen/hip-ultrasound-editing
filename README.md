# Geometry-controlled hip ultrasound editing

Browser-only research demonstration for **Geometry-Controlled Editing of Infant Hip Ultrasound**.

Authors: Yueh-Peng Chen, Tzuo-Yau Fan, Hsuan-Kai Kao.

[Open the browser demonstration](https://yuehpengchen.github.io/hip-ultrasound-editing/). The public site, trained weights and exactly three examples are available. Genuine two-stage inference has been verified on the public site; no inference server is needed.

The paper presentation includes the manuscript title, authors, affiliations, manuscript abstract and conceptual workflow. Manuscript and supplementary PDFs are not published through this website. The citation describes this research demonstration, not an accepted journal publication.

The app accepts a locally selected PNG/JPEG/WebP, five manually placed source landmarks and optional femoral-head diameter endpoints. It constructs requested geometry, runs the genuine fixed generator through ONNX Runtime Web, and performs the original mask/head/seam composites. There is no inference server and no image-upload API. Uploaded pixels stay in the browser.

## Included

- Genuine FP32 inference weights, opset 17, 77,144,129 bytes, provided as a [release asset](https://github.com/YuehpengChen/hip-ultrasound-editing/releases/tag/v0.1.0-browser).
- Client-side inference and faithful geometric preprocessing/compositing.
- Exactly three de-identified full-size 1024 × 768 examples from the non-training test partition; no identifiers in filenames or metadata. Only the identifying header is blacked out; the complete ultrasound field is retained.
- Plain English editing controls and full-image grayscale difference display.

Source and edited previews preserve the complete image and its aspect ratio. The generator still uses its original native 256 × 256 region without rescaling; its result is placed back into the original full frame. All pixels outside that region are preserved, and the difference image is zero there. Restoring the example frames does not change their original model inputs or landmark geometry.

The original image, five source landmarks, original H endpoints, source f and native crop are captured as a fixed baseline. Each edit is calculated from that baseline, never from the previous output or target coordinates. Uploaded-image annotations are editable until five source points have been completed; missing H endpoints can then be annotated once. Clear points or Remove H explicitly starts a new annotation. The edited-image and parameter-download buttons are not provided.

Target p4*/p5* can be dragged or entered numerically; they request the corresponding roof angles through the original solver, retaining initial segment lengths and orientation. Source p1/p2/p3 and original f cannot be dragged. The left image labels p4* and p5*, while text labels p1/p2/p3 remain hidden; their markers remain. The fixed blue circle is centred on initial p4 and has a radius of 0.8 times the original p4–p5 segment length: 20% smaller than the preceding p5-centred circle. Its intersection with the initial crop limits p4*, not p5*. Target p5* remains inside the initial crop. Angle requests outside the allowed geometry are limited to the nearest feasible angle pair and the controls show the applied values. These are software interaction limits, not clinically validated motion ranges.

The left image displays the fixed initial f as a blue point, the target H1/H2 as blue handles, and their midpoint f* in yellow. A blue rim remains visible when f* overlaps f. Dragging either H handle or f* translates the target diameter rigidly. Each target endpoint is rebuilt from the original H annotation and the absolute displacement δ = f* − f, not accumulated from a previous target. The fixed yellow circle is centred on original f, with a radius 10% larger than the preceding head-control circle: 1.1 times the smaller of half the original head radius and the original f's closest native-crop-edge distance. Target f* is constrained to the circle intersected with the initial crop. The circles remain fixed during editing. Changing an angle, point or operation updates the controls and clears an outdated result, but never starts model loading or inference. Press Run to generate the current request. Changing images does not start inference.

The controls have directional dependencies. Changing p4*/α moves p4* and p5* through the original fixed-length solver. Without a manual H override, α also computes f* and rigidly translated H1/H2. Changing p5*/β does not move p4* or f* when the current α is feasible. Moving H1/H2/f* never changes roof landmarks or angles; the manual target persists until Reset target H restores the angle-derived target.

The right image shows fixed source references p1/p2/p3 and original f in blue, and requested p4*/p5* in yellow. When H translation is applied, it also shows requested H1*/H2*/f* in yellow. The p1/p2/p3/p5 labels stay hidden. When H is off, the right image does not display a manual head target that was not applied. All these overlays are supplied or analytically constructed coordinates, not landmarks detected or re-measured in the generated output.

H-handle/f* edits enable H translation and boundary refinement and use the genuine two-stage generator route. The translation samples the original source crop at coordinates displaced by δ, blends that translated texture into the first generator output, and performs a second boundary-refinement call. The integer-nearest sampler may show no pixel change for subpixel movements smaller than half a pixel. A head-only translation runs even at unchanged roof angles; zero displacement at unchanged angles correctly returns the original image. Reset target H restores the angle-derived f*, within the same fixed range. Unchecking H disables the translation operation during inference; moving a head control enables it again. Neither editing limits nor control markers establish achieved anatomy.

Manual target placement is a browser-interface extension of the paper's angle-derived f* rule. It uses the same rigid source texture translation, mask, blending weights and seam refinement; it is not an independently evaluated result in the manuscript. Neither f* nor the other target markers are re-measured output anatomy.

**Training code and training images are not distributed.** The public model does not include the discriminator, optimizer, checkpoint training metadata or training pipeline.

## Research limits

The landmarks and head displacement describe requested controls, not re-measured output anatomy. The model does not automatically locate landmarks, diagnose dysplasia, establish clinical Graf classification or guarantee achieved angles. Independent anatomical, clinical and educational validation remains necessary. Do not use generated images for clinical decisions.

The three examples are verified disjoint from the training filename groups and have no source-file or native-crop pixel duplicates with the training images. Filename groups are not verified patient identifiers; this is not a claim of independent patient-level validation.

## Local use

The public HTTPS address opens on external computers without an account, installation, SSH connection, or dedicated GPU. Inference uses the visitor's CPU. A current browser with WebAssembly SIMD and sufficient memory is required; speed and compatibility cannot be guaranteed on every device. Internet access is needed to load the page, runtime and model.

Serve this directory over localhost using a static server for local development. The model runs in a dedicated browser worker, using single-thread WASM so GitHub Pages does not require cross-origin isolation. First use downloads the weights; subsequent edits reuse the loaded session. Unmodified `onnxruntime-web@1.23.2` WASM runtime assets are served from the same website under `runtime/`; no third-party runtime CDN, authentication service, or image-upload API is used. No analytics are installed. The upstream runtime license is provided in `runtime/LICENSE`.

For a local checkout, download `angleviz_v4_fp32.onnx` from the release above and place it in `models/`. Populate `runtime/` with the three version-pinned files and legal notices documented in [runtime/README.md](runtime/README.md). These generated runtime files are not tracked in Git. GitHub Pages downloads the pinned runtime package and model during deployment, verifies their checksums, and serves them from the site itself; visitors do not contact the upstream package registry.

```text
python3 -m http.server 8786 --bind 127.0.0.1
http://127.0.0.1:8786/
```

## Provenance

Model SHA-256: `af028a3ffb524b7c9dc90a93e9f21e59cb154d23749a8a34aa35d0990d8dce07`.

The ONNX model was compared with its original PyTorch generator using non-patient synthetic tensors: maximum absolute output difference 1.61e-6. The browser geometry adapter was compared with the canonical preprocessing in eight synthetic configurations, including optional H and seam refinement; tested Float32 maps and composites were bit-identical. A separate genuine two-call browser test verified 17 synthetic fixture checksums; final-composite maximum absolute difference from the canonical PyTorch reference was 4.53e-6 (threshold 1e-4). These checks assess implementation consistency, not clinical validity.

Original source-dataset publication: Chen et al., [Automatic and human level Graf’s type identification for detecting developmental dysplasia of the hip](https://doi.org/10.1016/j.bj.2023.100614).

ONNX Runtime is a Microsoft open-source project provided under its [MIT license](https://github.com/microsoft/onnxruntime/blob/main/LICENSE). No license for unrestricted redistribution of the study model or example images is implied by this demonstration.
