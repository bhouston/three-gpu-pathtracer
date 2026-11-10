# Half-float accumulation experiment

Upstream at `6096de4ffcd` does **not** jitter accumulation weights. WebGL's
`PathTracingRenderer` uses RGBA32F targets and `1 / sampleCount` blending. Both
WebGPU backends also use RGBA32F color targets and a normalized running average,
with sample counts in a separate R32Uint texture. Camera-ray jitter and Sobol
sampling already present in the project serve a different purpose.

The [referenced Three.js discussion](https://github.com/mrdoob/three.js/pull/35431#issuecomment-6770404813)
describes a weighted **sum**, storing cumulative weight in alpha. This project's
alpha is already image coverage. Reusing it for weight would break transparent
backgrounds, so the implementation below retains the running-average layout.

## Prototype

Set `pathTracer.halfFloatAccumulation = true` on `WebGLPathTracer` or
`WebGPUPathTracer`. The default is `false`. Changing it recreates the color
storage, resets accumulation and restarts the display fade. Both WebGPU backends,
their pipeline formats, backend switching, and the low-resolution preview use
the selected format. Existing scene/denoiser storage is unaffected.

The mode combines RGBA16F targets with a bounded adaptation of the cited weight
jitter. For one-based sample `n` and pair `k = floor((n - 1) / 2) + 1`:

```text
a = min((2k - 1) / 2048, 0.5) * (2 * HaltonBase2(k) - 1)
odd sample:  weight = 1 + a, cumulative weight = n + a
even sample: weight = 1 - a, cumulative weight = n
blend factor = weight / cumulative weight
```

Every pair's weights sum to two. This provides exact normalization without an
additional weight texture, preserves coverage alpha, and keeps weights positive.
It differs from the original unpaired `1 ± n/2048` schedule. A simple
`jitteredWeight / sampleCount` would not normalize the average correctly.
WebGL tiles share a weight for their entire sample pass. Specialized low-level
renderers that compensate opacity retain their original weights; quilt rendering
was not validated.

Use this as an experimental memory option for bounded renders, roughly up to
1,024 samples. The amplitude cap prevents negative weights but does not restore
float32 precision at higher sample counts. Half precision can stall on small
updates and cannot represent radiance above 65,504. Jitter changes finite-sample
weights and can increase sampling error; it is not stochastic rounding.

## Memory

Texture count is unchanged. Color texture allocation is halved at the same
resolution. These sizes follow the formats used in the hardware-tested paths;
they are not measurements of total process VRAM, driver overhead or padding.

| WebGPU buffers | Float32 | Float16 | Saving |
| --- | ---: | ---: | ---: |
| Two color targets | 32 bytes/pixel | 16 bytes/pixel | 50% |
| Colors plus sample count | 36 bytes/pixel | 20 bytes/pixel | 44.4% |
| Colors plus count at 1920 × 1080 | 71.19 MiB | 39.55 MiB | 31.64 MiB |
| Colors plus count at 3840 × 2160 | 284.77 MiB | 158.20 MiB | 126.56 MiB |

WebGL color attachments similarly shrink from 16 to 8 bytes per pixel per target.
Its coverage path uses a primary target and two blend targets. Existing depth
attachments, scene textures, BVH/ray state, low-resolution targets, auxiliary
images and denoiser buffers must be accounted for separately. No render targets
were removed by this experiment.

## Hardware results

Windows, NVIDIA GeForce GTX 1050 (Pascal). WebGL reported ANGLE D3D11 on that
physical GPU. WebGPU explicitly selected its NVIDIA adapter/device; software
adapters and WebGL fallbacks are rejected. No software renderer was used.

The reproducible WebGL quality test uses a 64 × 64 linear-HDR image, three
bounces, a sphere/plane/directional-light scene, and the same stable ray samples
for each mode. The control uses half storage with ordinary weights. RMSE is over
all four image channels against the **float32 result at the same sample count**,
not a converged ground-truth image. The following is one recorded run; shader
sampling setup can differ across browser runs.

| Samples | Half, ordinary weights | Half, paired jitter |
| --- | ---: | ---: |
| 64 | 0.000279 | 0.000303 |
| 256 | 0.000717 | 0.000950 |
| 1,024 | 0.004812 | 0.003841 |

At 1,024 samples jitter reduced the difference by about 20%; it increased the
difference at 64 and 256 samples. The screenshot compares float32, half, and
half with jitter at 1,024 samples. This is evidence of a limited tradeoff, not
equivalent float32 quality or improved convergence to ground truth.

A second test isolates a low-noise gradient with opaque and 0.35 coverage. In
the existing running-average representation, both half modes have approximately
0.001870 RMSE at 1,024 samples for the opaque case: jitter did not fix rounding
stagnation. An isolated weighted-sum test using the **original unpaired Halton
schedule** and alpha as weight reduced half error from 0.09583 to 0.003488 at
1,024 samples. This reproduces the linked technique's benefit for sums, while
showing that its benefit does not transfer automatically to this running mean.

WebGPU tests validate both kernels with GPU-completed readbacks, full/half/full
switching, reset sample counts, resizing, backend switching, constant emissive
radiance, transparent corners, opaque centers and the preview transition. These
are correctness checks; the image-error table above is the WebGL experiment.
No sustained throughput benchmark was performed, and no speedup is claimed.

Recommendation: keep float32 as the default. The half mode offers a real color
allocation reduction and may suit memory-constrained, bounded previews, but the
jitter benefit is modest and scene-dependent for the current representation.
Do not treat it as a general float32 replacement. A sum-based redesign would
need separate coverage/normalization handling and its own memory/quality study.

## Reproduce

```powershell
npm ci
npm run test:accumulation
npm run lint
npm run build
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node scripts/test-accumulation.js <output-directory>
```

The hardware runner owns and closes its Vite server and Chrome process. It writes
`accumulation-results.json`, `accumulation-webgpu-results.json`, and
`accumulation.png`. `CHROME_PATH` is optional when Puppeteer's matching browser
is installed. The WebGPU experiment currently requires an identifiable physical
NVIDIA adapter. Root `build/` outputs are generated and must not be committed.
