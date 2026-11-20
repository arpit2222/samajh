/**
 * Compress and resize phone photos client-side before upload.
 * Keeps textbook pages razor-sharp (max 1600px on longest edge) while shrinking
 * 8-12 MB phone captures down to ~250-450 KB JPEG for fast, reliable live demos.
 */
export async function preparePhotoForUpload(file, { maxDim = 1600, quality = 0.86 } = {}) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        const base64 = dataUrl.split(",")[1];
        URL.revokeObjectURL(objectUrl);

        resolve({
          imageBase64: base64,
          mimeType: "image/jpeg",
          previewUrl: dataUrl,
          width,
          height,
          approxKB: Math.round((base64.length * 3) / 4 / 1024),
        });
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      // Fallback: read raw file as base64 if browser cannot decode into canvas (e.g. HEIC)
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const match = result.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) {
          reject(new Error("Could not read image file. Please try a JPEG or PNG photo."));
          return;
        }
        resolve({
          imageBase64: match[2],
          mimeType: match[1] || file.type || "image/jpeg",
          previewUrl: result,
          width: 0,
          height: 0,
          approxKB: Math.round(file.size / 1024),
        });
      };
      reader.onerror = () => reject(new Error("Could not read selected image file."));
      reader.readAsDataURL(file);
    };

    img.src = objectUrl;
  });
}
