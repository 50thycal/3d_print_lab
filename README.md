# PrintLab AI

Turn a description or a reference photo into an editable 3D model for a household FDM print. Start with the sample bracket to try the preview, feature edits, and STL export without an AI connection.

## Create a part

1. Describe the part, upload a reference photo, or do both. The camera button opens the rear camera on supported phones.
2. Supply a measured dimension and any critical hole spacing, thickness, or clearance. A photo provides shape cues, while actual measurements establish scale and fit.
3. Use **AI settings → Connect ChatGPT** to generate and revise with your ChatGPT plan. OpenAI handles sign-in. You can also use **Import from ChatGPT** to copy a brief and paste the returned design JSON.
4. Inspect the model, confirm any provisional dimensions, then download the STL. Import it into your slicer in millimeters, select your printer and material, and inspect the sliced layers before printing.

Use **Edit features** to adjust dimensions, positions, or angles directly. Describe a follow-up change to revise the existing model with AI. You can undo model changes during the session or save the editable JSON. The last successful editable design is saved to this browser. The reference photo stays in the tab until generation. If you explicitly select the OpenAI API key option, the key stays in the tab and applies only to that route.

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

Vercel serves the Vite app. The browser builds the validated feature model with Manifold and renders it with Three.js. The optional `/api/design` function forwards a caller-provided API key only to OpenAI. When a ChatGPT subscription is connected, generation uses the separate subscription route and does not switch to API billing on errors.

## Vercel subscription setup

1. Define a high-entropy `PRINTLAB_OWNER_CODE` (at least 24 characters) in the Vercel project's Production environment and deploy. Keep its value private. Rotating it invalidates existing owner-browser sessions.
2. In **AI settings**, enter that code to unlock the browser, then choose **Connect ChatGPT**. Approve the device code at the official OpenAI sign-in page. Enable device-code authorization in ChatGPT's Security settings if required.
3. Return to PrintLab. Once it shows the account as connected, **Generate model** and **Revise model** use the signed-in ChatGPT plan.

The single-owner subscription route starts a private, named Vercel Sandbox only after browser authorization. It launches the pinned official Codex App Server over stdio. Codex manages and refreshes its credentials in the sandbox, whose private filesystem persists between sessions. PrintLab never reads those credentials or forwards them as API tokens. There are no exposed sandbox ports, and each design uses an ephemeral read-only thread. As with any Codex session, plan/credit limits still apply. The public sample and manual export still work without authentication. See [Codex App Server](https://learn.chatgpt.com/docs/app-server) and [Vercel Sandbox](https://vercel.com/docs/sandbox).

