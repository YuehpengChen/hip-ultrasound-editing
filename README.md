# Geometry-controlled hip ultrasound editing

Browser-only research demonstration for **Geometry-Controlled Editing of Infant Hip Ultrasound**.

Authors: Yueh-Peng Chen, Tzuo-Yau Fan, Hsuan-Kai Kao.

[Open the browser demonstration](https://yuehpengchen.github.io/hip-ultrasound-editing/). The public site, trained weights and exactly three examples are available. Genuine two-stage inference has been verified on the public site; no inference server is needed.

The paper presentation includes the manuscript title, authors, affiliations, manuscript abstract and conceptual workflow. Manuscript and supplementary PDFs are not published through this website. The citation describes this research demonstration, not an accepted journal publication.

The app accepts a locally selected PNG/JPEG/WebP and first runs the existing Graf-line model through ONNX Runtime Web. Three predicted line heatmaps are decoded into five initial source landmarks. Review and adjust those landmarks, then press Confirm points to fix the source geometry. Press Run separately to execute the image-editing generator and the original mask/head/seam composites. The line model does not predict H1/H2 or the femoral-head centre; its optional diameter endpoints must be annotated manually. The three examples use their saved source annotations and do not automatically run the detector. There is no inference server and no image-upload API. Uploaded pixels stay in the browser.

## Included

- Genuine FP32 image-editing weights, opset 17, 77,144,129 bytes, provided as a [release asset](https://github.com/YuehpengChen/hip-ultrasound-editing/releases/tag/v0.1.0-browser).
- Genuine FP32 Graf-line inference weights, 36,643,847 bytes, in the same release. The detector receives a resized 512 × 512 RGB image and returns three 512 × 512 line heatmaps. Its decoded points are mapped back to the complete original image.
- Client-side inference and faithful geometric preprocessing/compositing.
- Exactly three de-identified full-size 1024 × 768 examples from the non-training test partition; no identifiers in filenames or metadata. Only the identifying header is blacked out; the complete ultrasound field is retained.
- Plain English editing controls and full-image grayscale difference display.

Source and edited previews preserve the complete image and its aspect ratio. The generator still uses its original native 256 × 256 region without rescaling; its result is placed back into the original full frame. All pixels outside that region are preserved, and the difference image is zero there. Restoring the example frames does not change their original model inputs or landmark geometry.

The original image, five source landmarks, original H endpoints, source f and native crop are captured as a fixed baseline. Every image edit starts from the original pixels and confirmed source geometry, not a previous generated output. After automatic detection, all five uploaded-image source points remain editable until Confirm points is pressed; Run and target-angle controls are disabled during this review. Detection never starts the image-editing generator. If detection fails, source points can be placed manually before confirmation. Missing H endpoints can be annotated manually once, without changing the confirmed roof points or crop. Clear points returns to source-point review; Remove H clears the head annotation. The edited-image and parameter-download buttons are not provided.

Dragging target p4*, or changing its coordinate fields, directly changes that point and leaves p5* in place. Neither the p3–p4* nor p4*–p5* length is locked for this operation. Dragging target p5*, or changing its coordinate fields, directly changes p5* while leaving p4* in place; the p4*–p5* length is not locked. These explicit target coordinates, not an angle-only reconstruction, are sent to the generator. Source p1/p2/p3 and original f cannot be dragged after confirmation. The left image labels p4* and p5*, while text labels p1/p2/p3 remain hidden; their markers remain. Two fixed blue circles are centred on the confirmed initial p4 and p5, each with a radius of 0.8 times the original p4–p5 segment length. Direct placement is limited to the corresponding circle intersected with the fixed initial crop. Neither circle moves or changes size during editing.

The numerical target α*/β* controls retain the original angle solver, including both initial roof segment lengths and source orientation. Using an angle control leaves direct-coordinate mode and reconstructs the targets from the confirmed source, not the previous free-length targets. Both target points must stay within their respective initial p4/p5 circles and the fixed crop; numerical angle controls show the applied feasible values when a request cannot satisfy these limits. These are software interaction limits, not clinically validated motion ranges.

When H has been annotated, the left image displays the fixed initial f as a blue point, the target H1/H2 as blue handles, and their midpoint f* in yellow. A blue rim remains visible when f* overlaps f. Dragging either H handle or f* translates the target diameter rigidly. Each target endpoint is rebuilt from the original H annotation and the absolute displacement δ = f* − f, not accumulated from a previous target. The fixed yellow circle is centred on original f, with a radius 10% larger than the preceding head-control circle: 1.1 times the smaller of half the original head radius and the original f's closest native-crop-edge distance. Target f* is constrained to the circle intersected with the initial crop. The circles remain fixed during editing. Changing an angle, point or operation updates the controls and clears an outdated result, but never starts image-editing model loading or inference. Press Run to generate the current request. Selecting a new uploaded image runs only the source-point detector; selecting a saved example runs neither model.

The controls have directional dependencies. Directly moving p4* changes both measured roof angles but does not move p5*. Directly moving p5* changes β without moving p4* or changing α. The numerical α*/β* controls use the original fixed-length solver instead. Without a manual H override, the current target α also computes f* and rigidly translated H1/H2 from the confirmed source. Moving H1/H2/f* never changes roof landmarks or angles; the manual target persists until Reset target H restores the angle-derived target.

The right image shows fixed source references p1/p2/p3 and original f in blue, and requested p4*/p5* in yellow. When H translation is applied, it also shows requested H1*/H2*/f* in yellow. The p1/p2/p3/p5 labels stay hidden. When H is off, the right image does not display a manual head target that was not applied. All these overlays are supplied or analytically constructed coordinates, not landmarks detected or re-measured in the generated output.

H-handle/f* edits enable H translation and boundary refinement and use the genuine two-stage generator route. The translation samples the original source crop at coordinates displaced by δ, blends that translated texture into the first generator output, and performs a second boundary-refinement call. The integer-nearest sampler may show no pixel change for subpixel movements smaller than half a pixel. A head-only translation runs even at unchanged roof angles; zero displacement at unchanged angles correctly returns the original image. Reset target H restores the angle-derived f*, within the same fixed range. Unchecking H disables the translation operation during inference; moving a head control enables it again. Neither editing limits nor control markers establish achieved anatomy.

Direct p4*/p5* placement and manual head targets are browser-interface extensions of the paper's angle-controlled design. They use the same target maps, mask, rigid source texture translation, blending weights and seam refinement; free-length dragging is not an independently evaluated result in the manuscript. Neither f* nor the other target markers are re-measured output anatomy.

**Training code and training images are not distributed.** The public inference exports contain the trained weights and inference graphs, not the discriminator, optimizer, checkpoint training metadata or training pipeline.

## Research limits

The initial detector landmarks are proposals that require review and confirmation. The decoder rejects missing, non-finite, degenerate or weak line outputs; its minimum raw heatmap peak of 0.05 is a software guard, not a calibrated confidence score or a clinical accuracy threshold. Target landmarks and head displacement describe requested controls, not re-measured output anatomy. Neither model diagnoses dysplasia, establishes clinical Graf classification or guarantees achieved angles. Independent anatomical, clinical and educational validation remains necessary. Do not use generated images for clinical decisions.

The three examples are verified disjoint from the training filename groups and have no source-file or native-crop pixel duplicates with the training images. Filename groups are not verified patient identifiers; this is not a claim of independent patient-level validation.

## Local use

The public HTTPS address opens on external computers without an account, installation, SSH connection, or dedicated GPU. Inference uses the visitor's CPU. A current browser with WebAssembly SIMD and sufficient memory is required; speed and compatibility cannot be guaranteed on every device. Internet access is needed to load the page, runtime and model.

Serve this directory over localhost using a static server for local development. The detector and editor run in separate dedicated browser workers, using single-thread WASM so GitHub Pages does not require cross-origin isolation. First image upload downloads the detector weights; subsequent uploads reuse that session. The editing weights are loaded only when an explicit Run requires synthesis, then reused for subsequent Runs. Unmodified `onnxruntime-web@1.23.2` WASM runtime assets are served from the same website under `runtime/`; no third-party runtime CDN, authentication service, or image-upload API is used. No analytics are installed. The upstream runtime license is provided in `runtime/LICENSE`.

For a local checkout, download `angleviz_v4_fp32.onnx` and `graf_keypoints_fp32.onnx` from the release above and place both in `models/`. Populate `runtime/` with the three version-pinned files and legal notices documented in [runtime/README.md](runtime/README.md). These generated runtime files are not tracked in Git. GitHub Pages runs the geometry/control unit checks, downloads the pinned runtime package and both models during deployment, verifies their checksums, and serves them from the site itself; visitors do not contact the upstream package registry.

```text
python3 -m http.server 8786 --bind 127.0.0.1
http://127.0.0.1:8786/
```

## Provenance

Image-editing model SHA-256: `af028a3ffb524b7c9dc90a93e9f21e59cb154d23749a8a34aa35d0990d8dce07`.

Graf-line model SHA-256: `4be6ed5d9dbe98b9248ccc95fc40d10b9d6735c86dbf5abadcf1ea519f199f6d` (36,643,847 bytes).

The image-editing ONNX model was compared with its original PyTorch generator using non-patient synthetic tensors: maximum absolute output difference 1.61e-6. The browser geometry adapter was compared with the canonical preprocessing in eight synthetic configurations, including optional H and seam refinement; tested Float32 maps and composites were bit-identical. A separate genuine two-call browser test verified 17 synthetic fixture checksums; final-composite maximum absolute difference from the canonical PyTorch reference was 4.53e-6 (threshold 1e-4).

The Graf-line ONNX export was compared with the original PyTorch model: maximum absolute heatmap difference 2.80e-6. Its browser RGB preprocessing was checked against the original 512 × 512 resize and tensor conversion and was bit-identical. These checks assess implementation consistency, not clinical validity or calibrated detector confidence.

Original source-dataset publication: Chen et al., [Automatic and human level Graf’s type identification for detecting developmental dysplasia of the hip](https://doi.org/10.1016/j.bj.2023.100614).

ONNX Runtime is a Microsoft open-source project provided under its [MIT license](https://github.com/microsoft/onnxruntime/blob/main/LICENSE). No license for unrestricted redistribution of the study model or example images is implied by this demonstration.
