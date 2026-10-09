# Geometry-controlled hip ultrasound editing

Browser-only research demonstration for **Geometry-Controlled Editing of Infant Hip Ultrasound**.

Authors: Yueh-Peng Chen, Tzuo-Yau Fan, Hsuan-Kai Kao.

[Open the browser demonstration](https://yuehpengchen.github.io/hip-ultrasound-editing/). The public site, trained weights and exactly three examples are available. Genuine two-stage inference has been verified on the public site; no inference server is needed.

The app accepts a locally selected PNG/JPEG/WebP, five manually placed source landmarks and optional femoral-head diameter endpoints. It constructs requested geometry, runs the genuine fixed generator through ONNX Runtime Web, and performs the original mask/head/seam composites. There is no inference server and no image-upload API. Uploaded pixels stay in the browser.

## Included

- Genuine FP32 inference weights, opset 17, 77,144,129 bytes, provided as a [release asset](https://github.com/YuehpengChen/hip-ultrasound-editing/releases/tag/v0.1.0-browser).
- Client-side inference and faithful geometric preprocessing/compositing.
- Exactly three de-identified native 256 × 256 examples from the non-training test partition; no identifiers in filenames or metadata.
- Editing controls, grayscale difference display, edited crop and parameter downloads.

**Training code and training images are not distributed.** The public model does not include the discriminator, optimizer, checkpoint training metadata or training pipeline.

## Research limits

The landmarks and head displacement describe requested controls, not re-measured output anatomy. The model does not automatically locate landmarks, diagnose dysplasia, establish clinical Graf classification or guarantee achieved angles. Independent anatomical, clinical and educational validation remains necessary. Do not use generated images for clinical decisions.

The three examples are verified disjoint from the training filename groups and have no source-file or native-crop pixel duplicates with the training images. Filename groups are not verified patient identifiers; this is not a claim of independent patient-level validation.

## Local use

Serve this directory over localhost using a static server, then open it in a current desktop browser supporting WebAssembly SIMD. The model runs in a dedicated browser worker, using single-thread WASM so GitHub Pages does not require cross-origin isolation. First use downloads the weights; subsequent edits reuse the loaded session. Runtime assets use pinned `onnxruntime-web@1.23.2` from jsDelivr. No analytics are installed.

For a local checkout, download `angleviz_v4_fp32.onnx` from the release above and place it in `models/`. GitHub Pages downloads and verifies the same release during deployment, then serves it from the site itself.

```text
python3 -m http.server 8786 --bind 127.0.0.1
http://127.0.0.1:8786/
```

## Provenance

Model SHA-256: `af028a3ffb524b7c9dc90a93e9f21e59cb154d23749a8a34aa35d0990d8dce07`.

The ONNX model was compared with its original PyTorch generator using non-patient synthetic tensors: maximum absolute output difference 1.61e-6. The browser geometry adapter was compared with the canonical preprocessing in eight synthetic configurations, including optional H and seam refinement; tested Float32 maps and composites were bit-identical. A separate genuine two-call browser test verified 17 synthetic fixture checksums; final-composite maximum absolute difference from the canonical PyTorch reference was 4.53e-6 (threshold 1e-4). These checks assess implementation consistency, not clinical validity.

Original source-dataset publication: Chen et al., [Automatic and human level Graf’s type identification for detecting developmental dysplasia of the hip](https://doi.org/10.1016/j.bj.2023.100614).

ONNX Runtime is a Microsoft open-source project provided under its [MIT license](https://github.com/microsoft/onnxruntime/blob/main/LICENSE). No license for unrestricted redistribution of the study model or example images is implied by this demonstration.
