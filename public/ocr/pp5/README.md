# public/ocr/pp5 — 화면 사진 글자 인식 엔진 (PP-OCRv5 · ONNX Runtime Web)

자산 평가액 추이 「📷 주문내역 사진」의 **AI 없이 읽기**(src/screenOcr.ts)가 쓴다. 사진은 기기 밖으로 나가지 않는다 — 이 파일들만 처음 한 번 받는다.
출처: 사용자의 학습 사이트(nomin7916/pe-study) `vendor/ort` · `vendor/ppocr` 를 그대로 옮겼다(2026-11-26, pe-study b5481ff). 고치지 말 것 — 바꾸려면 새 폴더(pp6 …)로.

| 파일 | 내용 |
| --- | --- |
| `ort.wasm.bundle.min.mjs` · `ort-wasm-simd-threaded.mjs` | ONNX Runtime Web 1.30.0 (MIT — LICENSE-onnxruntime) |
| `ort-wasm-simd-threaded.wasm.gz` | 위 엔진의 WASM(gzip — 화면이 DecompressionStream 으로 푼다) |
| `det.onnx.gz` | 글줄 찾기 모델 PP-OCRv5 mobile det (Apache License 2.0, PaddlePaddle/PaddleOCR) |
| `rec.onnx.gz` | 한글·영어 글줄 읽기 모델 PP-OCRv5 korean mobile rec (Apache License 2.0) |
| `dict.txt` | 읽기 모델의 글자표 11,945자(한글·영문·숫자·기호) |

PaddleOCR: https://github.com/PaddlePaddle/PaddleOCR (Apache License 2.0) · ONNX Runtime: https://github.com/microsoft/onnxruntime (MIT)
