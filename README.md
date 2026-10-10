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

Target p4*/p5* can be dragged or entered numerically; they request the corresponding roof angles through the original solver, retaining initial segment lengths and orientation. Source p1/p2/p3 and original f cannot be dragged. Text labels p1, p2, p3 and p5 are omitted from the images; their markers remain. A fixed circle centred on initial p5, intersected with the initial crop, limits target p5*; its radius is the original p4–p5 segment length. Angle requests outside this region are limited to the nearest feasible angle pair and the controls show the applied values. This is a software interaction limit, not a clinically validated motion range.

The left image displays the fixed initial f as a blue point, the target H1/H2 as blue handles, and their midpoint f* in yellow. A blue rim remains visible when f* overlaps f. Dragging either H handle or f* translates the target diameter rigidly. Each target endpoint is rebuilt from the original H annotation and the absolute displacement δ = f* − f, not accumulated from a previous target. A fixed circle centred on original f limits f*: its radius is half the original head radius, or the distance to the closest native-crop edge if smaller. The circles remain fixed during editing. The right image shows only yellow f*. Changing an angle or a target control automatically regenerates after pointer release or a coordinate-input commit. Rapid edits are combined into the latest request. Changing images does not start inference.

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
