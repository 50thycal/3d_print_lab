import wasmUrl from '@cad-wasm?url';
import './style.css';
import { axes, bracket, bracketDescription, checkPhotoScale, portablePrompt, validateDesign } from './spec.js';
import { buildModel, encodeSTL } from './geometry.js';
import { createViewer } from './viewer.js';
import { subscriptionUI } from './subscription.js';

const $ = id => document.getElementById(id);
const storageKey = 'printlab-draft-v1';
const description = $('description');
const measurement = $('measurement');
const formStatus = $('form-status');
const viewerMessage = $('viewer-message');
let viewer;
let model;
let mode = 'sample';
let image = null;
let photoRequest = 0;
let apiKey = '';
let history = [];
let busy = false;

function status(element, message = '', error = false) {
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle('error', error);
}
function showConnection(connected) {
  $('open-settings').classList.toggle('connected', Boolean(connected || apiKey));
}
const subscription = subscriptionUI({ onChange: state => showConnection(state.connected) });

function refreshControls() {
  const revising = mode === 'design';
  $('description-label').textContent = revising ? 'What would you like to change?' : 'What should it make?';
  $('generate-label').textContent = busy ? 'Working…' : revising ? 'Revise model' : 'Generate model';
  $('new-design').hidden = !revising;
  for (const id of ['generate', 'apply-edits', 'load-sample', 'new-design', 'import-json']) $(id).disabled = busy;
  $('undo').disabled = busy || !history.length;
  $('reset-view').disabled = !model || !viewer;
  $('export-stl').disabled = busy || !model || (model.design.needsReview && !$('confirm-dimensions').checked);
}

function renderFeatures() {
  const { features } = model.design;
  $('feature-count').textContent = String(features.length);
  $('feature-list').replaceChildren(...features.map((feature, index) => {
    const item = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = feature.label + (feature.action === 'cut' ? ' · Cut' : '');
    item.append(summary);
    const inputs = document.createElement('div');
    inputs.className = 'feature-grid';
    for (const group of ['size', 'center', 'rotation']) {
      for (const axis of axes) {
        if (group === 'size' && (feature.kind !== 'box' && axis === 'y' || feature.kind === 'sphere' && axis === 'z')) continue;
        const label = document.createElement('label');
        if (group === 'size' && feature.kind !== 'box') {
          label.textContent = axis === 'x' ? 'Diameter (mm)' : 'Height (mm)';
        } else {
          const names = { size: 'Size', center: 'Position', rotation: 'Angle' };
          label.textContent = `${names[group]} ${axis.toUpperCase()} (${group === 'rotation' ? '°' : 'mm'})`;
        }
        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.value = feature[group][axis];
        Object.assign(input.dataset, { index, group, axis });
        label.append(input);
        inputs.append(label);
      }
    }
    item.append(inputs);
    return item;
  }));
}

function showModel() {
  const { design, dimensions, triangles } = model;
  $('preview-name').textContent = mode === 'sample' ? design.name + ' · Sample' : design.name;
  $('model-dimensions').textContent = dimensions.map(n => Number(n.toFixed(2))).join(' × ') + ' mm';
  $('model-check').textContent = 'One connected solid · ' + triangles.toLocaleString() + ' triangles';
  $('model-summary').textContent = design.summary;
  $('model-check').title = design.summary;
  $('review').hidden = !design.needsReview;
  $('confirm-dimensions').checked = false;
  $('assumptions').replaceChildren(...design.assumptions.map(text => {
    const listItem = document.createElement('li');
    listItem.textContent = text;
    return listItem;
  }));
  $('features').hidden = false;
  status($('feature-status'));
  renderFeatures();
  if (viewer) {
    viewer.setModel(model);
    status(viewerMessage);
  }
  refreshControls();
}

function persist() {
  try {
    if (mode === 'design') localStorage.setItem(storageKey, JSON.stringify(model.design));
    else localStorage.removeItem(storageKey);
  } catch {
    // Editing and export still work with local storage disabled.
  }
}
async function setModel(design, nextMode, keepHistory = true) {
  const candidate = await buildModel(design, wasmUrl);
  if (keepHistory && model) history = [...history.slice(-9), { model, mode }];
  model = candidate;
  mode = nextMode;
  showModel();
  persist();
}
async function runAction(element, callback) {
  if (busy) return;
  busy = true;
  status(element);
  refreshControls();
  try {
    await callback();
  } catch (error) {
    status(element, error.message || 'The model could not be built.', true);
  } finally {
    busy = false;
    refreshControls();
  }
}

async function resizePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function addPhoto(file) {
  if (!file) return;
  const request = ++photoRequest;
  try {
    const next = await resizePhoto(file);
    if (request !== photoRequest) return;
    image = next;
    $('photo-preview').src = image;
    $('photo-preview').hidden = false;
    $('photo-drop').hidden = true;
    $('remove-photo').hidden = false;
    status(formStatus);
  } catch {
    if (request === photoRequest) status(formStatus, 'This photo could not be opened. Try a JPEG, PNG, or WebP.', true);
  } finally {
    $('photo').value = '';
    $('camera').value = '';
  }
}
function clearPhoto() {
  photoRequest++;
  image = null;
  $('photo-preview').removeAttribute('src');
  $('photo-preview').hidden = true;
  $('photo-drop').hidden = false;
  $('remove-photo').hidden = true;
  $('photo').value = '';
  $('camera').value = '';
}
function currentInput() {
  return {
    description: description.value.trim(), measurement: measurement.value.trim(), image,
    previous: mode === 'design' ? model.design : null,
  };
}
function afterGeneration() {
  description.value = '';
  if (matchMedia('(max-width: 760px)').matches) $('preview-title').scrollIntoView({ block: 'start' });
}
function saveFile(body, name, type) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const slug = () => model.design.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'printlab-part';

$('take-photo').addEventListener('click', () => $('camera').click());
for (const id of ['photo', 'camera']) $(id).addEventListener('change', event => addPhoto(event.target.files[0]));
$('remove-photo').addEventListener('click', clearPhoto);
for (const name of ['dragover', 'dragleave', 'drop']) {
  $('photo-drop').addEventListener(name, event => {
    event.preventDefault();
    $('photo-drop').classList.toggle('dragging', name === 'dragover');
    if (name === 'drop') addPhoto(event.dataTransfer.files[0]);
  });
}
$('open-settings').addEventListener('click', () => {
  $('api-key').value = '';
  status($('settings-error'), apiKey ? 'An API key is connected for this tab.' : '');
  $('settings').showModal();
  void subscription.open();
});
$('settings-form').addEventListener('submit', event => {
  event.preventDefault();
  const value = $('api-key').value.trim();
  if (!/^sk-[\w-]{12,300}$/.test(value)) {
    status($('settings-error'), 'Enter a valid OpenAI API key.', true);
    return;
  }
  apiKey = value;
  $('api-key').value = '';
  showConnection(subscription.connected());
  $('settings').close();
  status(formStatus, 'AI connected. Generate a model to use it.');
});
$('disconnect').addEventListener('click', () => {
  apiKey = '';
  $('api-key').value = '';
  showConnection(subscription.connected());
  $('settings').close();
  status(formStatus, 'AI disconnected.');
});
for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => $(button.dataset.close).close());
}
$('design-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = currentInput();
  if (!input.description && !input.image) {
    status(formStatus, 'Describe a part or choose a reference photo.', true);
    return;
  }
  const withSubscription = subscription.connected();
  if (!apiKey && !withSubscription) {
    $('open-settings').click();
    return;
  }
  void runAction(formStatus, async () => {
    status(formStatus, input.previous ? 'Revising your model…' : 'Building your model…');
    let payload;
    if (withSubscription) {
      payload = await subscription.generate(input);
    } else {
      const response = await fetch('/api/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify(input),
      });
      try { payload = await response.json(); } catch { throw new Error('The design service did not respond. Try again.'); }
      if (!response.ok) throw new Error(payload.error || 'The design service could not complete the request.');
    }
    await setModel(payload.design, 'design');
    status(formStatus, 'Model updated.');
    afterGeneration();
  });
});

$('load-sample').addEventListener('click', () => runAction(formStatus, async () => {
  await setModel(bracket, 'design');
  clearPhoto();
  measurement.value = '64 mm overall width, 5 mm hole diameter';
  description.value = '';
  status(formStatus, 'Sample loaded. Edit its features or ask for a revision.');
  afterGeneration();
}));
$('new-design').addEventListener('click', () => runAction(formStatus, async () => {
  await setModel(bracket, 'sample');
  clearPhoto();
  measurement.value = '';
  description.value = '';
  description.focus();
}));
$('undo').addEventListener('click', () => {
  if (busy || !history.length) return;
  ({ model, mode } = history.pop());
  showModel();
  persist();
});
$('reset-view').addEventListener('click', () => viewer?.reset());
$('confirm-dimensions').addEventListener('change', refreshControls);
$('feature-list').addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.matches('input')) $('apply-edits').click();
});
$('apply-edits').addEventListener('click', () => runAction($('feature-status'), async () => {
  const edited = structuredClone(model.design);
  for (const field of $('feature-list').querySelectorAll('input')) {
    const { index, group, axis } = field.dataset;
    edited.features[index][group][axis] = field.valueAsNumber;
  }
  if (JSON.stringify(validateDesign(edited)) === JSON.stringify(model.design)) {
    status($('feature-status'), 'No dimensions changed.');
    return;
  }
  await setModel(edited, 'design');
  status($('feature-status'), 'Changes applied.');
}));
$('export-stl').addEventListener('click', () => saveFile(encodeSTL(model), slug() + '.stl', 'model/stl'));
$('export-json').addEventListener('click', () => saveFile(JSON.stringify(model.design, null, 2), slug() + '.json', 'application/json'));

$('open-bridge').addEventListener('click', () => {
  status($('bridge-status'));
  $('bridge').showModal();
});
$('copy-prompt').addEventListener('click', async () => {
  const input = currentInput();
  if (!input.description && !input.image) {
    if (input.previous) {
      status($('bridge-status'), 'Enter the change you want in the design brief, then copy it here.', true);
      return;
    }
    input.description = bracketDescription;
  }
  const text = portablePrompt(input);
  try {
    await navigator.clipboard.writeText(text);
    status($('bridge-status'), 'Design prompt copied.');
  } catch {
    $('import-text').value = text;
    $('import-text').select();
    status($('bridge-status'), 'Copy the selected prompt, then replace it with the design JSON.');
  }
});
$('import-json').addEventListener('click', () => runAction($('bridge-status'), async () => {
  const raw = $('import-text').value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('Paste the complete JSON design, then try again.'); }
  await setModel(checkPhotoScale(validateDesign(data), currentInput()), 'design');
  $('bridge').close();
  $('import-text').value = '';
  afterGeneration();
}));

try {
  viewer = createViewer($('viewport'));
} catch {
  status(viewerMessage, '3D preview requires WebGL. You can still inspect dimensions and download the model.');
}
void runAction(formStatus, async () => {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      await setModel(JSON.parse(saved), 'design', false);
      return;
    }
  } catch {
    // Fall back to the built-in sample if storage is unavailable or the draft is invalid.
  }
  try {
    await setModel(bracket, 'sample', false);
  } catch (error) {
    status(viewerMessage, 'The geometry engine could not load.');
    throw error;
  }
});
