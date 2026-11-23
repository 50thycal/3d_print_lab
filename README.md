# PrintLab AI

Turn a description or a reference photo into an editable 3D model for a household FDM print. Start with the sample bracket to try the preview, feature edits, and STL export without an AI connection.

## Create a part

1. Describe the part, upload a reference photo, or do both. The camera button opens the rear camera on supported phones.
2. Supply a measured dimension and any critical hole spacing, thickness, or clearance. A photo provides shape cues, while actual measurements establish scale and fit.
3. Use **AI settings** to connect an OpenAI API key for this browser tab and generate in the app. Alternatively, use **Use ChatGPT** to copy the prompt, attach the photo in ChatGPT, and import the JSON it returns.
4. Inspect the model, confirm any provisional dimensions, then download the STL. Import it into your slicer in millimeters, select your printer and material, and inspect the sliced layers before printing.

Use **Edit features** to adjust dimensions, positions, or angles directly. Describe a follow-up change to revise the existing model with AI. You can undo model changes during the session or save the editable JSON. The last successful editable design is saved to this browser. Photos and credentials are held in tab memory and sent when making an AI request with a key.

## Scope

The first version targets single, connected mechanical parts such as brackets, spacers, plates, and simple housings assembled from a small set of parametric primitives. It uses a photo as a reference for reconstructing shape. Complex organic or obscured geometry may be approximate or outside its modeling capabilities. The app checks the shape in software. A physical fit, load capacity, and printer-specific settings still need verification.

## Development

Requires Node.js 20.19 or later.

```sh
npm install
npm run dev
npm test
npm run build
```

Vercel builds and serves the Vite application and the `/api/design` function. No server environment key or database is required. The API uses the key supplied by the caller and sends it only to OpenAI. The frontend builds the validated feature model with Manifold and renders it with Three.js. Native subscription sign-in is separate from the ChatGPT copy-and-import workflow.
